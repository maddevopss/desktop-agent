const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const listener = (event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);

  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("agentAPI", {
  login: (credentials) => ipcRenderer.invoke("login", credentials),
  startTracking: (token) => ipcRenderer.invoke("start-tracking", token),
  stopTracking: () => ipcRenderer.invoke("stop-tracking"),
  restoreToken: () => ipcRenderer.invoke("restore-token"),
  getStoredToken: () => ipcRenderer.invoke("get-stored-token"),
  refreshToken: () => ipcRenderer.invoke("refresh-token"),
  agentTokenRefreshed: (token) => ipcRenderer.invoke("agent-token-refreshed", token),
  agentRefreshFailed: () => ipcRenderer.invoke("agent-refresh-failed"),
  getTrackingInterval: () => ipcRenderer.invoke("get-tracking-interval"),
  setTrackingInterval: (seconds) => ipcRenderer.invoke("set-tracking-interval", seconds),
  getPrivacySettings: () => ipcRenderer.invoke("get-privacy-settings"),
  setPrivacySettings: (settings) => ipcRenderer.invoke("set-privacy-settings", settings),
  deleteActivityHistory: () => ipcRenderer.invoke("delete-activity-history"),
  exportDiagnostics: () => ipcRenderer.invoke("export-diagnostics"),

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
    } catch {
      // ignore
    }
  },
});
