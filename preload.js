const { contextBridge, ipcRenderer } = require("electron");
const {
  assertAllowedInvokeChannel,
  assertAllowedSubscribeChannel,
} = require("./src/shared/ipcChannels");

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

module.exports = { invoke, subscribe };
