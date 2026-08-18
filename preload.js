const { contextBridge, ipcRenderer } = require("electron");

/**
 * Allowlists recopiees depuis src/shared/ipcChannels.js au lieu d'y etre importees.
 *
 * Ce preload tourne avec sandbox: true (recommandation Electron), et un preload sandboxe
 * ne peut pas charger de module applicatif relatif : son `require` est limite a electron
 * et a quelques modules natifs. Un import ferait donc echouer le preload au chargement,
 * laissant window.agentAPI indefini.
 *
 * La duplication est volontaire et surveillee : __tests__/preloadChannels.drift.test.js
 * echoue si ces listes divergent de src/shared/ipcChannels.js, qui reste la reference.
 * Si ce preload finit par dependre de plusieurs modules, le remplacer par un bundling
 * leger (esbuild) plutot que par un require.
 */
const INVOKE_CHANNELS = Object.freeze([
  "login",
  "start-tracking",
  "stop-tracking",
  "start-task",
  "stop-task",
  "toggle-focus-widget",
  "timer-sync",
  "timer-command",
  "get-revenue",
  "send-brain-dump",
  "hide-brain-dump-widget",
  "restore-token",
  "get-stored-token",
  "refresh-token",
  "agent-token-refreshed",
  "agent-refresh-failed",
  "get-tracking-interval",
  "set-tracking-interval",
  "get-privacy-settings",
  "set-privacy-settings",
  "delete-activity-history",
  "export-diagnostics",
  "test-notification",
  "get-autostart",
  "set-autostart",
]);

const SUBSCRIBE_CHANNELS = Object.freeze([
  "protocol-auth-token",
  "agent-refresh-needed",
  "agent-state-changed",
  "agent-token-refreshed",
  "session-expired",
  "app-close",
  "auth-expired",
  "timer-updated",
  "timer-command",
  "onSyncStatusUpdate",
]);

const INVOKE_CHANNEL_SET = new Set(INVOKE_CHANNELS);
const SUBSCRIBE_CHANNEL_SET = new Set(SUBSCRIBE_CHANNELS);

function assertAllowedInvokeChannel(channel) {
  if (!INVOKE_CHANNEL_SET.has(channel)) {
    throw new Error(`Canal IPC invoke interdit : ${String(channel)}`);
  }
  return channel;
}

function assertAllowedSubscribeChannel(channel) {
  if (!SUBSCRIBE_CHANNEL_SET.has(channel)) {
    throw new Error(`Canal IPC subscribe interdit : ${String(channel)}`);
  }
  return channel;
}

function invoke(channel, ...args) {
  return ipcRenderer.invoke(assertAllowedInvokeChannel(channel), ...args);
}

function subscribe(channel, callback) {
  const safeChannel = assertAllowedSubscribeChannel(channel);
  if (typeof callback !== "function") {
    throw new TypeError("Le callback IPC doit être une fonction.");
  }

  const listener = (event, payload) => callback(payload);
  ipcRenderer.on(safeChannel, listener);

  return () => ipcRenderer.removeListener(safeChannel, listener);
}

contextBridge.exposeInMainWorld("agentAPI", {
  login: (credentials) => invoke("login", credentials),
  startTracking: (token) => invoke("start-tracking", token),
  stopTracking: () => invoke("stop-tracking"),
  startTask: (params) => invoke("start-task", params),
  stopTask: () => invoke("stop-task"),
  toggleFocusWidget: () => invoke("toggle-focus-widget"),
  timerSync: (payload) => invoke("timer-sync", payload),
  timerCommand: (payload) => invoke("timer-command", payload),
  getRevenue: () => invoke("get-revenue"),
  sendBrainDump: (text) => invoke("send-brain-dump", text),
  hideBrainDumpWidget: () => invoke("hide-brain-dump-widget"),
  restoreToken: () => invoke("restore-token"),
  getStoredToken: () => invoke("get-stored-token"),
  refreshToken: () => invoke("refresh-token"),
  agentTokenRefreshed: (token) => invoke("agent-token-refreshed", token),
  agentRefreshFailed: () => invoke("agent-refresh-failed"),
  getTrackingInterval: () => invoke("get-tracking-interval"),
  setTrackingInterval: (seconds) => invoke("set-tracking-interval", seconds),
  getPrivacySettings: () => invoke("get-privacy-settings"),
  setPrivacySettings: (settings) => invoke("set-privacy-settings", settings),
  deleteActivityHistory: () => invoke("delete-activity-history"),
  exportDiagnostics: () => invoke("export-diagnostics"),
  testNotification: () => invoke("test-notification"),
  getAutoStart: () => invoke("get-autostart"),
  setAutoStart: (enabled) => invoke("set-autostart", enabled),

  onProtocolAuthToken: (callback) => subscribe("protocol-auth-token", callback),
  onAgentRefreshNeeded: (callback) => subscribe("agent-refresh-needed", callback),
  onAgentStateChanged: (callback) => subscribe("agent-state-changed", callback),
  onAgentTokenRefreshed: (callback) => subscribe("agent-token-refreshed", callback),
  onSessionExpired: (callback) => subscribe("session-expired", callback),
  onAppClose: (callback) => subscribe("app-close", callback),
  onAuthExpired: (callback) => subscribe("auth-expired", callback),

  clearLocalSession: () => {
    try {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
    } catch {}
  },
  onTimerUpdated: (callback) => subscribe("timer-updated", callback),
  onTimerCommand: (callback) => subscribe("timer-command", callback),
  onSyncStatusUpdate: (callback) => subscribe("onSyncStatusUpdate", callback),
});

module.exports = { invoke, subscribe, INVOKE_CHANNELS, SUBSCRIBE_CHANNELS };
