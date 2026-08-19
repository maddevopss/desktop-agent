const { ipcMain, app, Notification } = require("electron");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const logger = require("../utils/logger");
const {
  parseLoginCredentials,
  parseToken,
  parseTrackingInterval,
  parsePrivacySettings,
  parseBrainDump,
  parseBoolean,
} = require("../shared/ipcPayloadSchemas");

const MAX_SOCKET_PAYLOAD_BYTES = 4096;
const TIMER_SYNC_FIELDS = new Set([
  "id",
  "taskId",
  "projectId",
  "clientId",
  "status",
  "startedAt",
  "stoppedAt",
  "elapsedSeconds",
  "source",
]);
const TIMER_COMMAND_FIELDS = new Set(["command", "id", "taskId", "source"]);
const ALLOWED_TIMER_COMMANDS = new Set(["start", "stop", "pause", "resume", "sync"]);

function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function payloadSize(payload) {
  return Buffer.byteLength(JSON.stringify(payload || {}), "utf8");
}

function pickAllowedFields(payload, allowedFields) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;

  const sanitized = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!allowedFields.has(key)) continue;
    if (["string", "number", "boolean"].includes(typeof value) || value === null) {
      sanitized[key] = typeof value === "string" ? value.slice(0, 500) : value;
    }
  }

  return sanitized;
}

function sanitizeTimerSyncPayload(payload) {
  const sanitized = pickAllowedFields(payload, TIMER_SYNC_FIELDS);
  if (!sanitized) return null;
  if (payloadSize(sanitized) > MAX_SOCKET_PAYLOAD_BYTES) return null;
  return sanitized;
}

function sanitizeTimerCommandPayload(payload) {
  const sanitized = pickAllowedFields(payload, TIMER_COMMAND_FIELDS);
  if (!sanitized) return null;
  if (!ALLOWED_TIMER_COMMANDS.has(sanitized.command)) return null;
  if (payloadSize(sanitized) > MAX_SOCKET_PAYLOAD_BYTES) return null;
  return sanitized;
}

function sanitizeDiagnosticsConfig(config = {}) {
  return {
    apiUrlConfigured: Boolean(config.apiUrl),
    platform: config.platform,
    trackingInterval: config.trackingInterval,
    privacySettings: {
      trackingEnabled: config.privacySettings?.trackingEnabled === true,
      ignoredAppsCount: Array.isArray(config.privacySettings?.ignoredApps) ? config.privacySettings.ignoredApps.length : 0,
      ignoredKeywordsCount: Array.isArray(config.privacySettings?.ignoredKeywords) ? config.privacySettings.ignoredKeywords.length : 0,
    },
  };
}

function registerIpcHandlers(context) {
  const {
    authSession,
    startTrackingIfNeeded,
    getStoreValue,
    setStoreValue,
    deleteStoreValue,
    getCurrentToken,
    isUsableAccessToken,
    clearStoredToken,
    saveAccessToken,
    resetAuthExpiredState,
    getTrackingInterval,
    getPrivacySettings,
    restartTrackingIfActive,
    finishSessionExpired,
    purgeSession,
    tracking,
    updateTrayMenu,
    hubSocket,
    windowManager,
    captureQueueService,
    getExportDiagnosticsState,
    API_URL,
    getAccessCookieHeader,
  } = context;

  ipcMain.handle("login", async (event, credentialsPayload) => {
    const credentials = parseLoginCredentials(credentialsPayload);
    const result = await authSession.loginWithApi(credentials);
    startTrackingIfNeeded("LOGIN REUSSI");
    logger.info("Login reussi - token sauvegarde");
    return result;
  });

  ipcMain.handle("get-stored-token", () => null);

  ipcMain.handle("restore-token", () => authSession.restoreToken());

  ipcMain.handle("start-tracking", async (event, receivedToken) => {
    const token = parseToken(receivedToken);

    if (!isUsableAccessToken(token)) {
      clearStoredToken();
      authSession.clearRefreshCookieMemory();
      throw new Error("Token invalide ou sans organisation.");
    }

    resetAuthExpiredState();
    saveAccessToken(token);
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
    const token = parseToken(newToken, "Nouveau token");
    saveAccessToken(token);
    resetAuthExpiredState();
    startTrackingIfNeeded("TOKEN RAFRAICHI PAR RENDERER");
    return { success: true };
  });

  ipcMain.handle("agent-refresh-failed", async () => {
    finishSessionExpired("refresh failed by renderer");
    logger.info("Refresh echec signale par renderer");
    return { success: true };
  });

  ipcMain.handle("get-tracking-interval", () => getTrackingInterval());

  ipcMain.handle("set-tracking-interval", (event, seconds) => {
    const parsedSeconds = parseTrackingInterval(seconds);
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
    const normalized = parsePrivacySettings(nextSettings);
    setStoreValue("privacySettings", normalized);

    if (normalized.trackingEnabled) startTrackingIfNeeded("REGLAGES CONFIDENTIALITE");
    else tracking?.stopTracking();

    return { success: true, ...normalized };
  });

  let lastDeleteHistoryAtMs = 0;
  ipcMain.handle("delete-activity-history", async () => {
    const now = Date.now();
    if (now - lastDeleteHistoryAtMs < 30_000) {
      throw new Error("Action trop fréquente. Réessayez plus tard.");
    }

    const currentToken = getCurrentToken();
    if (!currentToken) throw new Error("Connexion requise pour supprimer l'historique.");
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
    const result = purgeSession("logout explicite");
    logger.info("Tracking arrêté et session locale purgée");
    return result;
  });

  ipcMain.handle("timer-sync", (event, payload) => {
    const safePayload = sanitizeTimerSyncPayload(payload);
    if (!safePayload) throw new Error("Payload timer invalide.");

    setStoreValue("focusTimer", safePayload);
    const sock = hubSocket();
    if (sock && sock.connected) {
      sock.emit("hub:timer:update", safePayload);
    }
    const focusWidget = windowManager.getFocusWidget();
    const mainWindow = windowManager.getMainWindow();
    if (focusWidget && !focusWidget.isDestroyed() && event.sender !== focusWidget.webContents) {
      focusWidget.webContents.send("timer-updated", safePayload);
    }
    if (mainWindow && !mainWindow.isDestroyed() && event.sender !== mainWindow.webContents) {
      mainWindow.webContents.send("timer-updated", safePayload);
    }
  });

  ipcMain.handle("timer-command", (event, payload) => {
    const safePayload = sanitizeTimerCommandPayload(payload);
    if (!safePayload) throw new Error("Commande timer invalide.");

    const sock = hubSocket();
    if (sock && sock.connected) {
      sock.emit("hub:timer:command", safePayload);
    }
    const focusWidget = windowManager.getFocusWidget();
    const mainWindow = windowManager.getMainWindow();
    if (focusWidget && !focusWidget.isDestroyed() && event.sender !== focusWidget.webContents) {
      focusWidget.webContents.send("timer-command", safePayload);
    }
    if (mainWindow && !mainWindow.isDestroyed() && event.sender !== mainWindow.webContents) {
      mainWindow.webContents.send("timer-command", safePayload);
    }
  });

  ipcMain.handle("toggle-focus-widget", () => {
    windowManager.toggleFocusWidget();
    return { success: true };
  });

  ipcMain.handle("hide-brain-dump-widget", () => {
    windowManager.hideBrainDumpWidget();
  });

  ipcMain.handle("send-brain-dump", async (event, text) => {
    const content = parseBrainDump(text);
    const currentToken = getCurrentToken();
    if (!currentToken || !isUsableAccessToken(currentToken)) return;
    try {
      await axios.post(
        `${API_URL}/api/intelligence/brain-dump`,
        { content },
        {
          timeout: 10000,
          headers: { Cookie: getAccessCookieHeader() },
        },
      );
      logger.info("Brain dump envoyé depuis le desktop agent");
    } catch (err) {
      logger.error("Erreur lors de l'envoi du brain dump", { error: err.message });
    }
  });

  ipcMain.handle("set-autostart", (event, enabled) => {
    const safeEnabled = parseBoolean(enabled, "enabled");
    app.setLoginItemSettings({
      openAtLogin: safeEnabled,
      openAsHidden: true,
    });
    return { success: true, enabled: safeEnabled };
  });

  ipcMain.handle("get-autostart", () => {
    const settings = app.getLoginItemSettings();
    return settings.openAtLogin;
  });

  ipcMain.handle("test-notification", () => {
    if (Notification.isSupported()) {
      const notif = new Notification({
        title: "MADSuite - Test",
        body: "Vérification du BadgeLogo dans les notifications.",
        silent: false,
      });
      notif.show();
      return { success: true };
    }
    return { success: false, message: "Notifications non supportées" };
  });

  ipcMain.handle("export-diagnostics", async () => {
    try {
      const diagnosticsDir = path.join(app.getPath("userData"), "diagnostics");
      ensureDirSync(diagnosticsDir);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const rand = crypto.randomBytes(6).toString("hex");
      const file = path.join(diagnosticsDir, `diagnostics-${stamp}-${rand}.json`);

      const diagState = getExportDiagnosticsState();
      const payload = {
        createdAt: new Date().toISOString(),
        trackingState: diagState.trackingState,
        trackingStateReason: diagState.trackingStateReason,
        refresh: {
          hasRefreshCookie: authSession.hasRefreshCookie(),
          refreshInProgress: authSession.isRefreshInProgress(),
          backendDownConsecutiveFailures: diagState.backendDownConsecutiveFailures,
          backendDownUntil: diagState.backendDownUntilMs ? new Date(diagState.backendDownUntilMs).toISOString() : null,
        },
        config: sanitizeDiagnosticsConfig(diagState.config),
        cachedCaptures: captureQueueService.getCaptureQueueSummary(),
      };

      fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
      return { success: true, file };
    } catch (err) {
      logger.error("EXPORT DIAGNOSTICS FAILED", { error: err?.message });
      return { success: false, message: err?.message || "EXPORT DIAGNOSTICS FAILED" };
    }
  });
}

module.exports = {
  registerIpcHandlers,
  sanitizeTimerSyncPayload,
  sanitizeTimerCommandPayload,
  sanitizeDiagnosticsConfig,
};
