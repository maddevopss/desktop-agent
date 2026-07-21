const path = require("path");
const { app, powerMonitor } = require("electron");
const { config } = require("./src/main/config");
const { createTrackingController } = require("./src/main/tracking");
const { getOpenWindows } = require("./src/main/windowScanner");
const tokenManager = require("./src/utils/tokenManager");
const { createDesktopRuntimeBootstrap } = require("./src/main/desktopRuntimeBootstrap");
const { createAuthSession } = require("./src/main/authSession");
const { createSessionPurge } = require("./src/main/sessionPurge");
const logger = require("./src/utils/logger");
const { isUsableAccessToken } = require("./src/main/auth");
const activityQueue = require("./utils/activityQueue");

// --- Nouveaux modules ---
const windowManager = require("./src/main/windowManager");
const trayManager = require("./src/main/trayManager");
const socketHub = require("./src/main/socketHub");
const appLifecycle = require("./src/main/appLifecycle");
const ipcHandlers = require("./src/main/ipcHandlers");

// --- Variables d'état ---
let store = null;
let token = null;
let tracking = null;
let authExpiredHandled = false;
let isQuitting = false;

let trackingState = "OFF";
let trackingStateReason = null;
let backendDownConsecutiveFailures = 0;
let backendDownUntilMs = null;

const TRACKING_STATES = { OFF: "OFF", STARTING: "STARTING", AUTH_EXPIRED: "AUTH_EXPIRED", AUTH_OK: "AUTH_OK" };
const DEFAULT_INTERVAL = 30;
const DEFAULT_PRIVACY_SETTINGS = { trackingEnabled: true, ignoredApps: [], ignoredKeywords: [] };
const BACKEND_DOWN_MAX_FAILURES = Number(process.env.AGENT_BACKEND_DOWN_MAX_FAILURES || 2);
const BACKEND_DOWN_THROTTLE_MS = Number(process.env.AGENT_BACKEND_DOWN_THROTTLE_MS || 60_000);
const REFRESH_TIMEOUT_MS = Number(process.env.AGENT_REFRESH_TIMEOUT_MS || 15000);
const API_URL = config.AGENT_API_URL;

try {
  require("dotenv").config({ path: path.join(__dirname, app.isPackaged ? ".env.prod" : ".env") });
} catch {
  logger.warn("dotenv non installe, variables .env ignorees.");
}

if (app.isPackaged && !process.env.AGENT_API_URL) {
  logger.error("AGENT_API_URL manquant en build packagé.");
  process.exit(1);
}

// --- Fonctions utilitaires d'état ---
function transitionAuthOk(reason) { trackingState = TRACKING_STATES.AUTH_OK; trackingStateReason = reason; }
function transitionAuthExpired(reason) { trackingState = TRACKING_STATES.AUTH_EXPIRED; trackingStateReason = reason; }
function transitionStartIfAllowed(allowedStates, reason) {
  if (!Array.isArray(allowedStates) || !allowedStates.includes(trackingState)) return false;
  trackingState = TRACKING_STATES.STARTING; trackingStateReason = reason;
  return true;
}

function isBackendDownThrottled() { return Boolean(backendDownUntilMs && Date.now() < backendDownUntilMs); }
function registerBackendHealthy() { backendDownConsecutiveFailures = 0; backendDownUntilMs = null; }
function registerBackendDownFailure() {
  backendDownConsecutiveFailures += 1;
  if (backendDownConsecutiveFailures >= BACKEND_DOWN_MAX_FAILURES) {
    backendDownUntilMs = Date.now() + BACKEND_DOWN_THROTTLE_MS;
  }
}

async function initStore() {
  store = await tokenManager.initStore();
  token = tokenManager.getSecureToken();
  return store;
}

function getStoreValue(key, fallback = null) { return store ? store.get(key, fallback) : fallback; }
function setStoreValue(key, value) { if (store) store.set(key, value); }
function deleteStoreValue(key) { if (store) store.delete(key); }
function getCurrentToken() {
  const storedToken = tokenManager.getSecureToken() || token;
  if (storedToken !== token) token = storedToken;
  return token;
}
function clearStoredToken() { token = null; tokenManager.clearSecureToken(); deleteStoreValue("user"); }
function saveAccessToken(newToken, user = undefined) {
  token = newToken; tokenManager.setSecureToken(newToken);
  if (user !== undefined) setStoreValue("user", user || null);
}
function resetAuthExpiredState() { authExpiredHandled = false; }
function getAccessCookieHeader() {
  const currentToken = getCurrentToken();
  if (!currentToken || !isUsableAccessToken(currentToken)) return null;
  return `access_token=${currentToken}`;
}

function getTrackingInterval() { return getStoreValue("trackingInterval", DEFAULT_INTERVAL); }
function getPrivacySettings() {
  const saved = getStoreValue("privacySettings", {});
  return { ...DEFAULT_PRIVACY_SETTINGS, ...saved, ignoredApps: Array.isArray(saved.ignoredApps) ? saved.ignoredApps : [], ignoredKeywords: Array.isArray(saved.ignoredKeywords) ? saved.ignoredKeywords : [] };
}
function getIdleSeconds() { return powerMonitor.getSystemIdleTime(); }
function isUserIdle() {
  const idleState = powerMonitor.getSystemIdleState(60);
  return idleState === "idle" || idleState === "locked";
}

let activeWin = async () => null;
async function loadActiveWin() {
  if (process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID) { activeWin = async () => null; return; }
  const mod = await import("active-win");
  activeWin = mod.default;
}

// --- Services Core ---
const authSession = createAuthSession({
  apiUrl: API_URL, getStoreValue, setStoreValue, deleteStoreValue,
  getSecureToken: () => tokenManager.getSecureToken(), saveAccessToken, clearStoredToken,
  resetAuthExpiredState, registerBackendDownFailure, registerBackendHealthy, isBackendDownThrottled,
  logger, isUsableAccessToken,
});

const desktopRuntime = createDesktopRuntimeBootstrap({
  apiUrl: API_URL,
  app,
  activityQueue,
  getCurrentToken,
  isUsableAccessToken,
  logger,
  isQuitting: () => isQuitting,
  onQueueStatsChanged: (stats) => {
    const mw = windowManager.getMainWindow();
    if (mw && !mw.isDestroyed()) {
      mw.webContents.send("onSyncStatusUpdate", stats);
    }
  },
});
const { captureQueueService } = desktopRuntime;
desktopRuntime.registerProcessSignals();

const purgeSession = createSessionPurge({
  stopTracking: () => tracking?.stopTracking(),
  clearStoredToken,
  clearRefreshCookieMemory: () => authSession.clearRefreshCookieMemory(),
  disconnectHubSocket: () => socketHub.disconnectHubSocket(),
  deleteStoreValue,
  resetAuthExpiredState,
  updateTrayMenu: () => updateTrayMenuProxy(),
  logger,
});

// --- Actions Tracking ---
function startTrackingIfNeeded(reason = "tracking") {
  if (!tracking) return logger.warn(`${reason} - tracking non initialise`);
  if (trackingState === TRACKING_STATES.AUTH_EXPIRED) return logger.info(`${reason} - tracking refuse: auth expired`);
  if (tracking.isTracking()) return logger.info(`${reason} - tracking deja actif`);
  if (!getPrivacySettings().trackingEnabled) return logger.info(`${reason} - tracking desactive dans les reglages`);

  const tok = getCurrentToken();
  if (trackingState === TRACKING_STATES.STARTING && (!tok || !isUsableAccessToken(tok))) {
    return logger.info(`${reason} - tracking en STARTING mais token pas usable, skip`);
  }

  transitionAuthOk("tracking start");
  tracking.startTracking();
  updateTrayMenuProxy();
  logger.info(`${reason} - tracking demarre`);

  const sock = socketHub.getHubSocket();
  if (!sock) {
    socketHub.connectHubSocket({
      apiUrl: API_URL, getToken: getCurrentToken,
      onTimerSync: (payload) => {
        const fw = windowManager.getFocusWidget();
        const mw = windowManager.getMainWindow();
        if (fw && !fw.isDestroyed()) fw.webContents.send("timer-updated", payload);
        if (mw && !mw.isDestroyed()) mw.webContents.send("timer-updated", payload);
      },
      onTimerCommand: (payload) => {
        const fw = windowManager.getFocusWidget();
        const mw = windowManager.getMainWindow();
        if (fw && !fw.isDestroyed()) fw.webContents.send("timer-command", payload);
        if (mw && !mw.isDestroyed()) mw.webContents.send("timer-command", payload);
      }
    });
  }
}

function restartTrackingIfActive(reason = "tracking") {
  if (!tracking) return logger.warn(`${reason} - tracking non initialise`);
  if (!tracking.isTracking()) return logger.info(`${reason} - tracking inactif, restart ignore`);
  tracking.stopTracking(); tracking.startTracking();
  logger.info(`${reason} - tracking redemarre`);
}

function finishSessionExpired(reason = "AUTH_EXPIRED") {
  purgeSession(reason);
  transitionAuthExpired(reason);
  windowManager.notifyRenderer("auth-expired");
  windowManager.notifyRenderer("session-expired");
  logger.info(`Session expiree - ${reason} - données locales purgées`);
}

async function tryRefreshAndResumeTracking() {
  try {
    const refreshed = await authSession.refreshAccessTokenViaApi();
    registerBackendHealthy();
    startTrackingIfNeeded("TOKEN RAFRAICHI AUTOMATIQUEMENT");
    captureQueueService.flushCaptureQueueIfPossible().catch(() => {});
    windowManager.notifyRenderer("agent-token-refreshed", { token: refreshed.token, user: refreshed.user });
    return refreshed;
  } catch (err) {
    logger.warn("Refresh automatique echoue", { error: err.message });
    throw err;
  }
}

function handleAuthExpired() {
  if (authExpiredHandled) return;
  authExpiredHandled = true;
  transitionAuthExpired("token expired");
  tracking?.stopTracking();
  logger.info("Auth expiree - tentative de refresh automatique");

  if (isBackendDownThrottled()) {
    windowManager.notifyRenderer("agent-refresh-needed");
    setTimeout(() => { if (authExpiredHandled) finishSessionExpired("backend down / refresh throttled"); }, REFRESH_TIMEOUT_MS);
    return;
  }

  tryRefreshAndResumeTracking()
    .then(() => resetAuthExpiredState())
    .catch(() => {
      windowManager.notifyRenderer("agent-refresh-needed");
      setTimeout(() => { if (authExpiredHandled) finishSessionExpired("refresh failed"); }, REFRESH_TIMEOUT_MS);
    });
}

function createTracking() {
  const opts = {
    apiUrl: API_URL, getToken: getCurrentToken, getTrackingInterval, getIdleSeconds, isUserIdle,
    getActiveWindow: () => activeWin, getOpenWindows, getPrivacySettings,
    onActivityCaptured: (activity) => setStoreValue("lastCapturedActivity", activity),
    onAuthExpired: handleAuthExpired,
    onCaptureQueueFailed: ({ kind, payload }) => captureQueueService.pushCaptureForLater(kind, payload),
  };
  tracking = createTrackingController(opts);

  if (process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID) {
    global.__trackingController = tracking;
    if (global.__trackingController) {
      global.__trackingController.onCaptureQueueFailed = opts.onCaptureQueueFailed;
    }
  }
}

// Proxies for Tray
function updateTrayMenuProxy() {
  trayManager.updateTrayMenu({
    isTracking: () => tracking && tracking.isTracking(),
    showMainWindow: () => {
      const mw = windowManager.getMainWindow();
      if (mw) { mw.show(); mw.focus(); }
    },
    startTracking: startTrackingIfNeeded,
    stopTracking: () => tracking?.stopTracking(),
    forceSync: () => captureQueueService.flushCaptureQueueIfPossible(),
    quitApp: () => { isQuitting = true; windowManager.destroyWidgets(); app.quit(); }
  });
}

function getExportDiagnosticsState() {
  return {
    trackingState, trackingStateReason, backendDownConsecutiveFailures, backendDownUntilMs,
    config: { apiUrl: API_URL, platform: process.platform, trackingInterval: getTrackingInterval(), privacySettings: getPrivacySettings() }
  };
}

// --- IPC Initialization ---
ipcHandlers.registerIpcHandlers({
  authSession, startTrackingIfNeeded, getStoreValue, setStoreValue, deleteStoreValue,
  getCurrentToken, isUsableAccessToken, clearStoredToken, saveAccessToken, resetAuthExpiredState,
  getTrackingInterval, getPrivacySettings, restartTrackingIfActive, finishSessionExpired, purgeSession,
  tracking, updateTrayMenu: updateTrayMenuProxy, hubSocket: socketHub.getHubSocket, windowManager,
  captureQueueService, getExportDiagnosticsState, API_URL, getAccessCookieHeader
});

app.setAsDefaultProtocolClient?.("madsuite");
function handleProtocolUrl(url) {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "madsuite:" || parsedUrl.host !== "auth") return;

    const protocolToken = parsedUrl.searchParams.get("token");
    if (!protocolToken || !isUsableAccessToken(protocolToken)) {
      logger.warn("Protocol auth token invalide ou manquant");
      return;
    }

    saveAccessToken(protocolToken);
    resetAuthExpiredState();
    transitionAuthOk("protocol auth");
    startTrackingIfNeeded("PROTOCOL AUTH");
    windowManager.notifyRenderer("protocol-auth-token", { authenticated: true });
  } catch (e) { logger.warn("Erreur parsing protocol URL", { error: e.message }); }
}

// --- Lifecycle Bootstrap ---
const gotTheLock = typeof app.requestSingleInstanceLock === "function" ? app.requestSingleInstanceLock() : true;
if (!gotTheLock) {
  app.quit();
} else {
  app.on("before-quit", () => {
    isQuitting = true;
    windowManager.destroyWidgets();
    const mw = windowManager.getMainWindow();
    if (mw && !mw.isDestroyed()) mw.webContents.send("app-close");
    tracking?.stopTracking();
    void desktopRuntime.shutdown("before-quit");
  });

  app.on("second-instance", (event, commandLine) => {
    const mw = windowManager.getMainWindow();
    if (mw) { if (mw.isMinimized()) mw.restore(); mw.show(); mw.focus(); }
    const url = commandLine.find((arg) => arg.startsWith("madsuite://"));
    if (url) handleProtocolUrl(url);
  });

  const runWhenReady = async () => {
    await initStore();
    authSession.bootstrapAuth();
    await loadActiveWin();

    if (process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID) {
      createTracking(); return;
    }

    createTracking();
    windowManager.createWindow(() => isQuitting);
    trayManager.createTray({
      isTracking: () => tracking && tracking.isTracking(),
      showMainWindow: () => { const mw = windowManager.getMainWindow(); if (mw) { mw.show(); mw.focus(); } },
      startTracking: startTrackingIfNeeded,
      stopTracking: () => tracking?.stopTracking(),
      forceSync: () => captureQueueService.flushCaptureQueueIfPossible(),
      quitApp: () => { isQuitting = true; windowManager.destroyWidgets(); app.quit(); }
    });

    appLifecycle.setupLifecycleEvents({
      trackingCallbacks: {
        stopTracking: () => tracking?.stopTracking(),
        startTracking: startTrackingIfNeeded
      },
      widgetCallbacks: { toggleBrainDumpWidget: () => windowManager.toggleBrainDumpWidget() },
      handleProtocolUrl
    });

    const hasRefreshCookie = authSession.hasRefreshCookie();
    if (getCurrentToken() && isUsableAccessToken(getCurrentToken())) {
      transitionAuthOk("token existing"); startTrackingIfNeeded("TOKEN EXISTANT"); return;
    }
    if (token && !isUsableAccessToken(token)) { clearStoredToken(); }

    if (hasRefreshCookie) {
      transitionStartIfAllowed([TRACKING_STATES.OFF, TRACKING_STATES.AUTH_EXPIRED], "startup refresh");
      try {
        await tryRefreshAndResumeTracking();
        transitionAuthOk("startup refresh ok"); resetAuthExpiredState();
      } catch (err) {
        if (err?.statusCode >= 500) { registerBackendDownFailure(); return; }
        finishSessionExpired("refresh failed at startup");
        windowManager.notifyRenderer("agent-refresh-needed");
      }
      return;
    }
    finishSessionExpired("no auth");
  };

  if (process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID) {
    runWhenReady().catch(e => logger.error("runWhenReady failed", { error: e.message }));
  } else {
    app.whenReady().then(runWhenReady);
  }
}
