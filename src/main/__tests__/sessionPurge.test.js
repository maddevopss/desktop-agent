const { SESSION_STORE_KEYS, createSessionPurge } = require("../sessionPurge");

describe("purge de session locale", () => {
  test("supprime toutes les données et connexions liées à la session", () => {
    const dependencies = {
      stopTracking: jest.fn(),
      clearStoredToken: jest.fn(),
      clearRefreshCookieMemory: jest.fn(),
      disconnectHubSocket: jest.fn(),
      deleteStoreValue: jest.fn(),
      resetAuthExpiredState: jest.fn(),
      updateTrayMenu: jest.fn(),
      logger: { info: jest.fn() },
    };

    const purgeSession = createSessionPurge(dependencies);

    expect(purgeSession("logout explicite")).toEqual({ success: true });
    expect(dependencies.stopTracking).toHaveBeenCalledTimes(1);
    expect(dependencies.disconnectHubSocket).toHaveBeenCalledTimes(1);
    expect(dependencies.clearStoredToken).toHaveBeenCalledTimes(1);
    expect(dependencies.clearRefreshCookieMemory).toHaveBeenCalledTimes(1);
    expect(dependencies.resetAuthExpiredState).toHaveBeenCalledTimes(1);
    expect(dependencies.updateTrayMenu).toHaveBeenCalledTimes(1);

    for (const key of SESSION_STORE_KEYS) {
      expect(dependencies.deleteStoreValue).toHaveBeenCalledWith(key);
    }
  });

  test("ne supprime pas les préférences durables de l’utilisateur", () => {
    expect(SESSION_STORE_KEYS).not.toContain("privacySettings");
    expect(SESSION_STORE_KEYS).not.toContain("trackingInterval");
  });
});
