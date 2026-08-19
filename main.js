const path = require("path");
const axios = require("axios");

// MADPROOF R1: Gestion des erreurs globales
process.on("uncaughtException", (error) => {
  try {
    const logger = require("./src/utils/logger");
    logger.error("UNCAUGHT EXCEPTION (FATAL)", { message: error?.message, stack: error?.stack });
  } catch (e) {
    console.error("FATAL ERROR: Logger failed during uncaughtException", e);
  }
  const { app } = require("electron");
  if (app && app.isReady()) {
    app.quit();
  } else {
    process.exit(1);
  }
});

process.on("unhandledRejection", (reason) => {
  try {
    const logger = require("./src/utils/logger");
    logger.error("UNHANDLED REJECTION", { reason: reason?.toString(), stack: reason?.stack });
  } catch (e) {
    console.error("UNHANDLED REJECTION: Logger failed", e);
  }
});
const { config } = require("./src/main/config");
const { app, BrowserWindow, ipcMain, Tray, Menu, powerMonitor, globalShortcut } = require("electron");
const { createTrackingController } = require("./src/main/tracking");
const { getOpenWindows } = require("./src/main/windowScanner");
const tokenManager = require("./src/utils/tokenManager");
const { createCaptureQueue, CAPTURE_KIND_BRAIN_DUMP } = require("./src/main/captureQueue");
const { createAuthSession } = require("./src/main/authSession");
const logger = require("./src/utils/logger");
const { isUsableAccessToken } = require("./src/main/auth");

// Shutdown graceful avec timeout (P0.4)
let isCleaningUp = false;
let store = null;
let token = null;
let tracking = null;
let mainWindow = null;
let spotlightWindow = null;
let spotlightShortcut = null;
let tray = null;
let activeWin = async () => null;
let authExpiredHandled = false;
let isQuitting = false;
let isDev = process.env.NODE_ENV !== "production";
let trackingState = "OFF";
let trackingStateReason = null;
let backendDownConsecutiveFailures = 0;
let backendDownUntilMs = null;

const TRACKING_STATES = {
  OFF: "OFF",
  STARTING: "STARTING",
  AUTH_EXPIRED: "AUTH_EXPIRED",
  AUTH_OK: "AUTH_OK",
};

const DEFAULT_INTERVAL = 30;
const VALID_INTERVALS = [30, 60, 90, 120, 300];
const DEFAULT_PRIVACY_SETTINGS = {
  trackingEnabled: true,
  ignoredApps: [],
  ignoredKeywords: [],
};
const BACKEND_DOWN_MAX_FAILURES = Number(process.env.AGENT_BACKEND_DOWN_MAX_FAILURES || 2);
const BACKEND_DOWN_THROTTLE_MS = Number(process.env.AGENT_BACKEND_DOWN_THROTTLE_MS || 60_000);
const REFRESH_TIMEOUT_MS = Number(process.env.AGENT_REFRESH_TIMEOUT_MS || 15000);
const FRONTEND_DEV_URL = process.env.AGENT_FRONTEND_URL || "http://localhost:3000";

try {
  require("dotenv").config({
    path: path.join(__dirname, app.isPackaged ? ".env.prod" : ".env"),
  });
} catch {
  logger.warn("dotenv non installe dans desktop-agent, variables .env ignorees.");
}

const API_URL = config.AGENT_API_URL;
const authSession = createAuthSession({
  apiUrl: API_URL,
  getStoreValue,
  setStoreValue,
  deleteStoreValue,
  getSecureToken: () => tokenManager.getSecureToken(),
  saveAccessToken,
  clearStoredToken,
  resetAuthExpiredState,
  registerBackendDownFailure,
  registerBackendHealthy,
  isBackendDownThrottled,
  logger,
  isUsableAccessToken,
});
const captureQueueService = createCaptureQueue({
  apiUrl: API_URL,
  app,
  getCurrentToken,
  isUsableAccessToken,
  logger,
  isQuitting: () => isQuitting,
});

function transitionAuthOk(reason) {
  trackingState = TRACKING_STATES.AUTH_OK;
  trackingStateReason = reason;
}

function transitionAuthExpired(reason) {
  trackingState = TRACKING_STATES.AUTH_EXPIRED;
  trackingStateReason = reason;
}

function transitionStartIfAllowed(allowedStates, reason) {
  if (!Array.isArray(allowedStates) || !allowedStates.includes(trackingState)) return false;
  trackingState = TRACKING_STATES.STARTING;
  trackingStateReason = reason;
  return true;
}

function isBackendDownThrottled() {
  return Boolean(backendDownUntilMs && Date.now() < backendDownUntilMs);
}

function registerBackendHealthy() {
  backendDownConsecutiveFailures = 0;
  backendDownUntilMs = null;
}

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

function getStoreValue(key, fallback = null) {
  if (!store) return fallback;
  return store.get(key, fallback);
}

function setStoreValue(key, value) {
  if (!store) return;
  store.set(key, value);
}

function deleteStoreValue(key) {
  if (!store) return;
  store.delete(key);
}

function getCurrentToken() {
  // getSecureToken() lit dÃ©sormais directement dans le store chiffrÃ©
  const storedToken = tokenManager.getSecureToken() || token;

  if (storedToken !== token) {
    token = storedToken;
  }

  return token;
}

function getAccessCookieHeader() {
  const currentToken = getCurrentToken();
  if (!currentToken || !isUsableAccessToken(currentToken)) {
    return null;
  }

  return `access_token=${currentToken}`;
}

function getTrackingInterval() {
  const saved = getStoreValue("trackingInterval", DEFAULT_INTERVAL);
  return VALID_INTERVALS.includes(saved) ? saved : DEFAULT_INTERVAL;
}

function getPrivacySettings() {
  const saved = getStoreValue("privacySettings", {});
  return {
    ...DEFAULT_PRIVACY_SETTINGS,
    ...saved,
    ignoredApps: Array.isArray(saved.ignoredApps) ? saved.ignoredApps : [],
    ignoredKeywords: Array.isArray(saved.ignoredKeywords) ? saved.ignoredKeywords : [],
  };
}

function getIdleSeconds() {
  return powerMonitor.getSystemIdleTime();
}

function isUserIdle() {
  const idleState = powerMonitor.getSystemIdleState(60);
  return idleState === "idle" || idleState === "locked";
}

async function loadActiveWin() {
  // En mode Jest, on Ã©vite les imports dynamiques incompatibles.
  if (process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID) {
    activeWin = async () => null;
    return;
  }

  const mod = await import("get-windows");
  activeWin = mod.activeWindow;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  }) || {};

  mainWindow.on?.("close", (event) => {
    if (!isQuitting) {
      event?.preventDefault?.();
      mainWindow.hide?.();
      logger.info("Fenetre cachee, agent toujours actif");
    }
  });

  mainWindow.webContents?.on?.("did-finish-load", () => {
    logger.info("Fenetre React chargee - React appelera agentAPI.restoreToken()");
  });

  if (isDev) {
    mainWindow.loadURL?.(FRONTEND_DEV_URL);
    mainWindow.webContents?.openDevTools?.();
  } else {
    mainWindow.webContents?.on?.("before-input-event", (event, input) => {
      const opensDevTools = input.key === "F12" || (input.control && input.shift && input.key.toLowerCase() === "i");
      if (opensDevTools) event.preventDefault();
    });

    mainWindow.webContents?.setWindowOpenHandler?.(() => ({ action: "deny" }));

    const frontendBuildPath = path.join(
      app.isPackaged ? path.join(app.getAppPath(), "..") : __dirname,
      "frontend",
      "build",
      "index.html",
    );

    const fs = require("fs");
    if (!fs.existsSync(frontendBuildPath)) {
      logger.error("Frontend build introuvable, utilisation du fallback.html", { frontendBuildPath });
      mainWindow.loadFile?.(path.join(__dirname, "fallback.html"));
    } else {
      mainWindow.loadFile?.(frontendBuildPath);
    }
  }
}

function createTray() {
  tray = new Tray(path.join(__dirname, "icon.png")) || {};

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Ouvrir ChronoMAD",
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    {
      // Le raccourci reel est affiche ici : un hotkey global qu'on ne peut pas
      // retrouver quelque part est un hotkey qu'on oublie.
      label: spotlightShortcut
        ? `Décharge mentale (${spotlightShortcut.replace("CommandOrControl", "Ctrl").replace("Space", "Espace")})`
        : "Décharge mentale",
      click: () => toggleSpotlight(),
    },
    {
      label: "Quitter",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip?.("ChronoMAD Agent");
  tray.setContextMenu?.(contextMenu);

  tray.on?.("double-click", () => {
    mainWindow.show?.();
    mainWindow.focus?.();
  });
}

// ============================================================
// Spotlight TDAH — decharge mentale sans quitter son flux
// ============================================================

// Raccourci principal, puis repli si une autre application l'a deja reserve.
const SPOTLIGHT_SHORTCUTS = ["CommandOrControl+Shift+Space", "CommandOrControl+Alt+Space"];
const SPOTLIGHT_WIDTH = 620;
const SPOTLIGHT_HEIGHT = 80;

/**
 * Cree la barre flottante une fois pour toutes, cachee.
 *
 * La fenetre n'est jamais detruite : la recreer a chaque appui ajouterait un delai de
 * chargement visible, alors que l'interet de la fonction est justement l'immediatete.
 */
function createSpotlightWindow() {
  spotlightWindow =
    new BrowserWindow({
      width: SPOTLIGHT_WIDTH,
      height: SPOTLIGHT_HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      // Opaque : transparent + alwaysOnTop clignote a l'affichage sur Windows 11.
      backgroundColor: "#0f172a",
      webPreferences: {
        preload: path.join(__dirname, "preload-spotlight.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    }) || {};

  spotlightWindow.loadFile?.(path.join(__dirname, "renderer", "spotlight.html"));

  // Perdre le focus vaut annulation : la barre ne doit jamais rester en travers de l'ecran.
  spotlightWindow.on?.("blur", () => hideSpotlight());

  // Fermer la barre ne doit pas la detruire, sinon le raccourci suivant n'aurait plus de cible.
  spotlightWindow.on?.("close", (event) => {
    if (isQuitting) return;
    event?.preventDefault?.();
    hideSpotlight();
  });

  if (!isDev) {
    spotlightWindow.webContents?.setWindowOpenHandler?.(() => ({ action: "deny" }));
  }
}

function hideSpotlight() {
  if (!spotlightWindow || spotlightWindow.isDestroyed?.()) return;
  spotlightWindow.hide?.();
}

/**
 * Affiche la barre centree sur l'ecran actif, ou la masque si elle est deja visible
 * (le raccourci fait donc office de bascule).
 */
function toggleSpotlight() {
  if (!spotlightWindow || spotlightWindow.isDestroyed?.()) {
    createSpotlightWindow();
  }

  if (spotlightWindow.isVisible?.()) {
    hideSpotlight();
    return;
  }

  spotlightWindow.center?.();
  spotlightWindow.show?.();
  spotlightWindow.focus?.();
}

/**
 * Enregistre le raccourci global, avec repli si le systeme le refuse.
 *
 * register() renvoie false quand une autre application detient deja la combinaison :
 * echouer en silence donnerait l'impression d'une fonctionnalite morte.
 * @returns {string | null} Le raccourci retenu, ou null si aucun n'a pu etre pris.
 */
function registerSpotlightShortcut() {
  for (const accelerator of SPOTLIGHT_SHORTCUTS) {
    try {
      if (globalShortcut?.register?.(accelerator, toggleSpotlight)) {
        spotlightShortcut = accelerator;
        logger.info("SPOTLIGHT SHORTCUT REGISTERED", { accelerator });
        return accelerator;
      }
      logger.warn("SPOTLIGHT SHORTCUT UNAVAILABLE", { accelerator });
    } catch (err) {
      logger.warn("SPOTLIGHT SHORTCUT REGISTER FAILED", { accelerator, error: err?.message });
    }
  }

  logger.error("SPOTLIGHT SHORTCUT NONE AVAILABLE", { tried: SPOTLIGHT_SHORTCUTS });
  return null;
}

/**
 * Envoie une idee au backend, ou la met en file si le reseau/l'auth ne repond pas.
 *
 * Une idee perdue une seule fois suffit a ce que l'utilisateur n'ose plus se reposer sur
 * l'outil : tout echec bascule donc vers la file persistante plutot que d'etre signale.
 * @param {string} rawText - Texte brut saisi dans la barre.
 * @returns {Promise<{ ok: boolean, queued: boolean }>}
 */
async function captureIdea(rawText) {
  const text = String(rawText || "").trim().slice(0, 500);
  if (!text) return { ok: false, queued: false };

  const currentToken = getCurrentToken();

  if (!currentToken || !isUsableAccessToken(currentToken)) {
    captureQueueService.pushCaptureForLater(CAPTURE_KIND_BRAIN_DUMP, { raw_text: text, source: "spotlight" });
    logger.info("SPOTLIGHT CAPTURE QUEUED", { reason: "no usable token" });
    return { ok: true, queued: true };
  }

  try {
    const response = await axios.post(
      `${API_URL}/api/brain-dump-captures`,
      { raw_text: text, source: "spotlight" },
      {
        timeout: 10000,
        headers: { Cookie: getAccessCookieHeader() },
        validateStatus: () => true,
      },
    );

    if (response?.status >= 200 && response?.status < 300) {
      logger.info("SPOTLIGHT CAPTURE SENT");
      return { ok: true, queued: false };
    }

    throw new Error(`Capture refused with status ${response?.status}`);
  } catch (err) {
    captureQueueService.pushCaptureForLater(CAPTURE_KIND_BRAIN_DUMP, { raw_text: text, source: "spotlight" });
    logger.warn("SPOTLIGHT CAPTURE QUEUED", { error: err?.message });
    return { ok: true, queued: true };
  }
}

function notifyRenderer(channel, payload = undefined) {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents) return;
  mainWindow.webContents.send(channel, payload);
}

function clearStoredToken() {
  token = null;
  tokenManager.clearSecureToken();
  deleteStoreValue("user");
}

function saveAccessToken(newToken, user = undefined) {
  token = newToken;
  tokenManager.setSecureToken(newToken);

  if (user !== undefined) {
    setStoreValue("user", user || null);
  }
}

function resetAuthExpiredState() {
  authExpiredHandled = false;
}

function startTrackingIfNeeded(reason = "tracking") {
  if (!tracking) {
    logger.warn(`${reason} - tracking non initialise`);
    return;
  }

  // State machine guard: do not start while we are in auth expired
  if (trackingState === TRACKING_STATES.AUTH_EXPIRED) {
    logger.info(`${reason} - tracking refuse: auth expired`);
    return;
  }

  if (tracking.isTracking()) {
    logger.info(`${reason} - tracking deja actif, start ignore`);
    return;
  }

  if (!getPrivacySettings().trackingEnabled) {
    logger.info(`${reason} - tracking desactive dans les reglages`);
    return;
  }

  // During STARTING we allow start only if token is usable.
  const tok = getCurrentToken();
  if (trackingState === TRACKING_STATES.STARTING) {
    if (!tok || !isUsableAccessToken(tok)) {
      logger.info(`${reason} - tracking en STARTING mais token pas usable, skip`);
      return;
    }
  }

  transitionAuthOk("tracking start");
  tracking.startTracking();
  logger.info(`${reason} - tracking demarre`);
}

function restartTrackingIfActive(reason = "tracking") {
  if (!tracking) {
    logger.warn(`${reason} - tracking non initialise`);
    return;
  }

  if (!tracking.isTracking()) {
    logger.info(`${reason} - tracking inactif, restart ignore`);
    return;
  }

  tracking.stopTracking();
  tracking.startTracking();

  logger.info(`${reason} - tracking redemarre`);
}

function finishSessionExpired(reason = "AUTH_EXPIRED") {
  tracking?.stopTracking();
  clearStoredToken();
  authSession.clearRefreshCookieMemory();
  resetAuthExpiredState();

  transitionAuthExpired(reason);

  notifyRenderer("auth-expired");
  notifyRenderer("session-expired");

  logger.info(`Session expiree - ${reason} - token nettoye et tracking stoppe`);
}

async function tryRefreshAndResumeTracking() {
  try {
    const refreshed = await authSession.refreshAccessTokenViaApi();
    registerBackendHealthy();

    startTrackingIfNeeded("TOKEN RAFRAICHI AUTOMATIQUEMENT");

    // Flush best-effort after successful refresh/healthy auth
    captureQueueService.flushCaptureQueueIfPossible().catch(() => {});

    notifyRenderer("agent-token-refreshed", {
      token: refreshed.token,
      user: refreshed.user,
    });

    return refreshed;
  } catch (err) {
    logger.warn("Refresh automatique echoue", { error: err.message });
    throw err;
  }
}

function handleAuthExpired() {
  if (authExpiredHandled) return;
  authExpiredHandled = true;

  // State machine guard
  transitionAuthExpired("token expired");
  tracking?.stopTracking();

  logger.info("Auth expiree - tentative de refresh automatique");

  // Avoid refresh while backend is throttled
  if (isBackendDownThrottled()) {
    notifyRenderer("agent-refresh-needed");
    setTimeout(() => {
      if (!authExpiredHandled) return;
      finishSessionExpired("backend down / refresh throttled");
    }, REFRESH_TIMEOUT_MS);
    return;
  }

  tryRefreshAndResumeTracking()
    .then(() => {
      resetAuthExpiredState();
    })
    .catch(() => {
      notifyRenderer("agent-refresh-needed");

      setTimeout(() => {
        if (!authExpiredHandled) return;
        finishSessionExpired("refresh failed");
      }, REFRESH_TIMEOUT_MS);
    });
}

function createTracking() {
  tracking = createTrackingController({
    apiUrl: API_URL,
    getToken: getCurrentToken,
    getTrackingInterval,
    getIdleSeconds,
    isUserIdle,
    getActiveWindow: () => activeWin,
    getOpenWindows,
    getPrivacySettings,
    onActivityCaptured: (activity) => setStoreValue("lastCapturedActivity", activity),
    onAuthExpired: handleAuthExpired,
    onCaptureQueueFailed: ({ kind, payload }) => {
      captureQueueService.pushCaptureForLater(kind, payload);
    },
  });
}

ipcMain.handle("login", async (event, credentials) => {
  const email = credentials?.email;
  const password = credentials?.password;

  if (!email || !password) {
    throw new Error("Email et mot de passe requis.");
  }

  const result = await authSession.loginWithApi({ email, password });

  startTrackingIfNeeded("LOGIN REUSSI");

  logger.info("Login reussi - token sauvegarde");

  return result;
});

ipcMain.handle("capture-idea", async (event, rawText) => captureIdea(rawText));

ipcMain.handle("close-spotlight", () => {
  hideSpotlight();
  return { ok: true };
});

ipcMain.handle("get-stored-token", () => {
  return getStoreValue("token", null);
});

ipcMain.handle("restore-token", () => {
  return authSession.restoreToken();
});

ipcMain.handle("start-tracking", async (event, receivedToken) => {
  if (!receivedToken) throw new Error("Token manquant.");

  if (!isUsableAccessToken(receivedToken)) {
    clearStoredToken();
    authSession.clearRefreshCookieMemory();
    throw new Error("Token invalide ou sans organisation.");
  }

  resetAuthExpiredState();
  saveAccessToken(receivedToken);

  logger.info("Token recu et sauvegarde");

  startTrackingIfNeeded("START TRACKING");

  return { success: true };
});

ipcMain.handle("refresh-token", async () => {
  const result = await authSession.refreshAccessTokenViaApi();

  startTrackingIfNeeded("REFRESH TOKEN");

  return result;
});

ipcMain.handle("agent-token-refreshed", async (event, newToken) => {
  if (!newToken) {
    throw new Error("Nouveau token manquant.");
  }

  saveAccessToken(newToken);
  resetAuthExpiredState();

  startTrackingIfNeeded("TOKEN RAFRAICHI PAR RENDERER");

  return { success: true };
});

ipcMain.handle("agent-refresh-failed", async () => {
  finishSessionExpired();

  logger.info("Refresh echec signale par renderer");

  return { success: true };
});

ipcMain.handle("get-tracking-interval", () => {
  return getTrackingInterval();
});

ipcMain.handle("set-tracking-interval", (event, seconds) => {
  const parsedSeconds = Number(seconds);

  if (!VALID_INTERVALS.includes(parsedSeconds)) {
    throw new Error(`Intervalle invalide. Valeurs acceptees : ${VALID_INTERVALS.join(", ")}s`);
  }

  setStoreValue("trackingInterval", parsedSeconds);

  restartTrackingIfActive("INTERVALLE MODIFIE");

  return { success: true, interval: parsedSeconds };
});

ipcMain.handle("get-privacy-settings", () => ({
  ...getPrivacySettings(),
  interval: getTrackingInterval(),
  lastCapturedActivity: getStoreValue("lastCapturedActivity", null),
  platform: process.platform,
}));

ipcMain.handle("set-privacy-settings", (event, nextSettings) => {
  const normalized = {
    trackingEnabled: nextSettings?.trackingEnabled === true,
    ignoredApps: Array.isArray(nextSettings?.ignoredApps)
      ? nextSettings.ignoredApps
          .map((value) => String(value).trim())
          .filter(Boolean)
          .slice(0, 50)
      : [],
    ignoredKeywords: Array.isArray(nextSettings?.ignoredKeywords)
      ? nextSettings.ignoredKeywords
          .map((value) => String(value).trim())
          .filter(Boolean)
          .slice(0, 50)
      : [],
  };

  setStoreValue("privacySettings", normalized);

  if (normalized.trackingEnabled) startTrackingIfNeeded("REGLAGES CONFIDENTIALITE");
  else tracking?.stopTracking();

  return { success: true, ...normalized };
});

let lastDeleteHistoryAtMs = 0;

ipcMain.handle("delete-activity-history", async () => {
  const now = Date.now();
  // Rate limit simple: 1 requÃªte / 30s
  if (now - lastDeleteHistoryAtMs < 30_000) {
    throw new Error("Action trop frÃ©quente. RÃ©essayez plus tard.");
  }

  const currentToken = getCurrentToken();
  if (!currentToken) throw new Error("Connexion requise pour supprimer l'historique.");

  // VÃ©rifie que le token est bien un access token utilisable (et donc organisation_id existante)
  if (!isUsableAccessToken(currentToken)) {
    throw new Error("Token invalide. Connexion requise.");
  }

  lastDeleteHistoryAtMs = now;

  await axios.delete(`${API_URL}/api/activity/history`, {
    timeout: 10000,
    headers: { Cookie: getAccessCookieHeader() },
  });

  deleteStoreValue("lastCapturedActivity");
  return { success: true };
});

ipcMain.handle("stop-tracking", async () => {
  tracking?.stopTracking();

  resetAuthExpiredState();
  clearStoredToken();
  authSession.clearRefreshCookieMemory();

  logger.info("Tracking arrete");

  return { success: true };
});

function safeConfigWithoutSecrets() {
  // Agent config (sans tokens/cookies/secrets)
  return {
    apiUrl: API_URL,
    platform: process.platform,
    trackingInterval: getTrackingInterval(),
    privacySettings: getPrivacySettings(),
  };
}

ipcMain.handle("export-diagnostics", async () => {
  try {
    const fs = require("fs");
    const crypto = require("crypto");

    const diagnosticsDir = path.join(app.getPath("userData"), "diagnostics");
    ensureDirSync(diagnosticsDir);

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const rand = crypto.randomBytes(6).toString("hex");

    const file = path.join(diagnosticsDir, `diagnostics-${stamp}-${rand}.json`);

    const payload = {
      createdAt: new Date().toISOString(),
      trackingState,
      trackingStateReason,
      // Stats refresh/token/backend down (best-effort from current runtime variables)
      refresh: {
        hasRefreshCookie: authSession.hasRefreshCookie(),
        refreshInProgress: authSession.isRefreshInProgress(),
        backendDownConsecutiveFailures,
        backendDownUntil: backendDownUntilMs ? new Date(backendDownUntilMs).toISOString() : null,
      },
      config: safeConfigWithoutSecrets(),
      cachedCaptures: captureQueueService.getCaptureQueueSummary(),
    };

    fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");

    return { success: true, file };
  } catch (err) {
    logger.error("EXPORT DIAGNOSTICS FAILED", { error: err?.message });
    return { success: false, message: err?.message || "EXPORT DIAGNOSTICS FAILED" };
  }
});

app.whenReady().then(async () => {
  await initStore();
  authSession.bootstrapAuth();

  await loadActiveWin();

  createTracking();
  createWindow();
  createSpotlightWindow();
  // Avant createTray() : le menu du tray affiche le raccourci effectivement retenu.
  registerSpotlightShortcut();
  createTray();

  // P0.2 â€” Startup deterministic refresh
  // Rule: try refresh once if encrypted refresh cookie exists.
  const hasRefreshCookie = authSession.hasRefreshCookie();

  if (getCurrentToken() && isUsableAccessToken(getCurrentToken())) {
    logger.info("Token existant valide trouve - reprise du tracking automatique");
    transitionAuthOk("token existing");
    startTrackingIfNeeded("TOKEN EXISTANT");
    return;
  }

  if (token && !isUsableAccessToken(token)) {
    logger.info("Token existant invalide - nettoyage");
    clearStoredToken();
    // on garde refresh cookie chiffrÃ© : on peut retenter refresh
  }

  if (hasRefreshCookie) {
    // STARTING state and single refresh attempt
    transitionStartIfAllowed([TRACKING_STATES.OFF, TRACKING_STATES.AUTH_EXPIRED], "startup refresh");
    try {
      await tryRefreshAndResumeTracking();
      transitionAuthOk("startup refresh ok");
      resetAuthExpiredState();
    } catch (err) {
      // If refresh fails => auth required (no loop)
      const status = err?.statusCode || err?.response?.status;
      logger.warn("Startup refresh echoue", { status, message: err?.message });

      if (status && Number(status) >= 500) {
        registerBackendDownFailure(err);
        // keep in STARTING; tracking won't start
        return;
      }

      // 401/invalid refresh -> require login
      finishSessionExpired("refresh failed at startup");
      notifyRenderer("agent-refresh-needed");
    }
    return;
  }

  // No valid token and no refresh cookie
  finishSessionExpired("no auth");
});

app.on("before-quit", () => {
  isQuitting = true;

  // Sans ceci le raccourci global reste reserve au niveau systeme apres la fermeture.
  globalShortcut?.unregisterAll?.();
  spotlightShortcut = null;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app-close");
  }

  tracking?.stopTracking();
  captureQueueService.stop();
});

