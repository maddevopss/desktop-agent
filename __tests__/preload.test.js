const mockExposed = {};

const mockIpcRenderer = {
  invoke: jest.fn(),
  on: jest.fn(),
  removeListener: jest.fn(),
};

jest.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: jest.fn((name, api) => {
      mockExposed[name] = api;
    }),
  },
  ipcRenderer: mockIpcRenderer,
}));

describe("preload.js", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    for (const key of Object.keys(mockExposed)) {
      delete mockExposed[key];
    }

    global.localStorage = {
      clear: jest.fn(),
      removeItem: jest.fn(),
    };
  });

  test("expose agentAPI", () => {
    require("../preload");

    expect(mockExposed.agentAPI).toBeDefined();
  });

  test("expose les méthodes IPC principales", () => {
    require("../preload");

    expect(typeof mockExposed.agentAPI.login).toBe("function");
    expect(typeof mockExposed.agentAPI.startTracking).toBe("function");
    expect(typeof mockExposed.agentAPI.stopTracking).toBe("function");
    expect(typeof mockExposed.agentAPI.restoreToken).toBe("function");
    expect(typeof mockExposed.agentAPI.refreshToken).toBe("function");
    expect(typeof mockExposed.agentAPI.agentTokenRefreshed).toBe("function");
    expect(typeof mockExposed.agentAPI.agentRefreshFailed).toBe("function");
    expect(typeof mockExposed.agentAPI.getTrackingInterval).toBe("function");
    expect(typeof mockExposed.agentAPI.setTrackingInterval).toBe("function");
    expect(typeof mockExposed.agentAPI.getPrivacySettings).toBe("function");
    expect(typeof mockExposed.agentAPI.setPrivacySettings).toBe("function");
    expect(typeof mockExposed.agentAPI.deleteActivityHistory).toBe("function");
    expect(typeof mockExposed.agentAPI.onAgentRefreshNeeded).toBe("function");
    expect(typeof mockExposed.agentAPI.onSessionExpired).toBe("function");
  });

  test("login appelle ipcRenderer.invoke avec login", async () => {
    mockIpcRenderer.invoke.mockResolvedValue({ success: true, token: "abc-token" });

    require("../preload");

    await mockExposed.agentAPI.login({ email: "test@example.com", password: "1234" });

    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith("login", {
      email: "test@example.com",
      password: "1234",
    });
  });

  test("startTracking appelle ipcRenderer.invoke avec start-tracking", async () => {
    mockIpcRenderer.invoke.mockResolvedValue({ success: true });

    require("../preload");

    await mockExposed.agentAPI.startTracking("abc-token");

    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith("start-tracking", "abc-token");
  });

  test("stopTracking appelle ipcRenderer.invoke avec stop-tracking", async () => {
    mockIpcRenderer.invoke.mockResolvedValue({ success: true });

    require("../preload");

    await mockExposed.agentAPI.stopTracking();

    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith("stop-tracking");
  });

  test("restoreToken appelle ipcRenderer.invoke avec restore-token", async () => {
    mockIpcRenderer.invoke.mockResolvedValue("stored-token");

    require("../preload");

    const token = await mockExposed.agentAPI.restoreToken();

    expect(token).toBe("stored-token");
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith("restore-token");
  });

  test("refreshToken appelle ipcRenderer.invoke avec refresh-token", async () => {
    mockIpcRenderer.invoke.mockResolvedValue({
      success: true,
      token: "new-access-token",
    });

    require("../preload");

    const result = await mockExposed.agentAPI.refreshToken();

    expect(result).toEqual({
      success: true,
      token: "new-access-token",
    });

    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith("refresh-token");
  });

  test("agentTokenRefreshed transmet le nouveau token", async () => {
    mockIpcRenderer.invoke.mockResolvedValue({ success: true });

    require("../preload");

    await mockExposed.agentAPI.agentTokenRefreshed("fresh-token");

    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith("agent-token-refreshed", "fresh-token");
  });

  test("agentRefreshFailed appelle ipcRenderer.invoke avec agent-refresh-failed", async () => {
    mockIpcRenderer.invoke.mockResolvedValue({ success: true });

    require("../preload");

    await mockExposed.agentAPI.agentRefreshFailed();

    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith("agent-refresh-failed");
  });

  test("onAgentRefreshNeeded enregistre et retourne une fonction cleanup", () => {
    require("../preload");

    const callback = jest.fn();
    const cleanup = mockExposed.agentAPI.onAgentRefreshNeeded(callback);

    expect(mockIpcRenderer.on).toHaveBeenCalledTimes(1);
    expect(mockIpcRenderer.on.mock.calls[0][0]).toBe("agent-refresh-needed");
    expect(typeof mockIpcRenderer.on.mock.calls[0][1]).toBe("function");

    cleanup();

    expect(mockIpcRenderer.removeListener).toHaveBeenCalledWith("agent-refresh-needed", mockIpcRenderer.on.mock.calls[0][1]);
  });

  test("onAuthExpired enregistre et retourne une fonction cleanup", () => {
    require("../preload");

    const callback = jest.fn();
    const cleanup = mockExposed.agentAPI.onAuthExpired(callback);

    expect(mockIpcRenderer.on).toHaveBeenCalledTimes(1);
    expect(mockIpcRenderer.on.mock.calls[0][0]).toBe("auth-expired");

    cleanup();

    expect(mockIpcRenderer.removeListener).toHaveBeenCalledWith("auth-expired", mockIpcRenderer.on.mock.calls[0][1]);
  });

  test("onSessionExpired enregistre et retourne une fonction cleanup", () => {
    require("../preload");

    const callback = jest.fn();
    const cleanup = mockExposed.agentAPI.onSessionExpired(callback);

    expect(mockIpcRenderer.on).toHaveBeenCalledTimes(1);
    expect(mockIpcRenderer.on.mock.calls[0][0]).toBe("session-expired");

    cleanup();

    expect(mockIpcRenderer.removeListener).toHaveBeenCalledWith("session-expired", mockIpcRenderer.on.mock.calls[0][1]);
  });

  test("clearLocalSession supprime seulement les cles auth connues", () => {
    require("../preload");

    mockExposed.agentAPI.clearLocalSession();

    expect(global.localStorage.removeItem).toHaveBeenCalledWith("token");
    expect(global.localStorage.removeItem).toHaveBeenCalledWith("user");
    expect(global.localStorage.clear).not.toHaveBeenCalled();
  });

  test("getTrackingInterval appelle ipcRenderer.invoke", async () => {
    mockIpcRenderer.invoke.mockResolvedValue(30);

    require("../preload");

    const interval = await mockExposed.agentAPI.getTrackingInterval();

    expect(interval).toBe(30);
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith("get-tracking-interval");
  });

  test("setTrackingInterval appelle ipcRenderer.invoke avec la valeur", async () => {
    mockIpcRenderer.invoke.mockResolvedValue({ success: true, interval: 60 });

    require("../preload");

    const result = await mockExposed.agentAPI.setTrackingInterval(60);

    expect(result).toEqual({ success: true, interval: 60 });
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith("set-tracking-interval", 60);
  });

  test("expose les réglages de confidentialité", async () => {
    mockIpcRenderer.invoke.mockResolvedValue({ success: true });
    require("../preload");

    await mockExposed.agentAPI.getPrivacySettings();
    await mockExposed.agentAPI.setPrivacySettings({ trackingEnabled: false });
    await mockExposed.agentAPI.deleteActivityHistory();

    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith("get-privacy-settings");
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith("set-privacy-settings", { trackingEnabled: false });
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith("delete-activity-history");
  });
});
