const { createSessionPurge } = require("../sessionPurge");

describe("pause immédiate du tracking", () => {
  test("arrête le tracking avant toute autre opération de purge", () => {
    const calls = [];
    const purgeSession = createSessionPurge({
      stopTracking: () => calls.push("stopTracking"),
      disconnectHubSocket: () => calls.push("disconnectHubSocket"),
      clearStoredToken: () => calls.push("clearStoredToken"),
      clearRefreshCookieMemory: () => calls.push("clearRefreshCookieMemory"),
      deleteStoreValue: (key) => calls.push(`delete:${key}`),
      resetAuthExpiredState: () => calls.push("resetAuthExpiredState"),
      updateTrayMenu: () => calls.push("updateTrayMenu"),
      logger: { info: () => calls.push("log") },
    });

    purgeSession("pause utilisateur");

    expect(calls[0]).toBe("stopTracking");
    expect(calls.indexOf("stopTracking")).toBeLessThan(calls.indexOf("disconnectHubSocket"));
    expect(calls.indexOf("stopTracking")).toBeLessThan(calls.indexOf("clearStoredToken"));
  });

  test("ne planifie aucun délai avant l'arrêt", () => {
    const stopTracking = jest.fn();
    const setTimeoutSpy = jest.spyOn(global, "setTimeout");
    const purgeSession = createSessionPurge({
      stopTracking,
      clearStoredToken: jest.fn(),
      clearRefreshCookieMemory: jest.fn(),
      disconnectHubSocket: jest.fn(),
      deleteStoreValue: jest.fn(),
      resetAuthExpiredState: jest.fn(),
      updateTrayMenu: jest.fn(),
      logger: { info: jest.fn() },
    });

    purgeSession("pause utilisateur");

    expect(stopTracking).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
  });

  test("reste sûre quand le tracking est déjà arrêté", () => {
    const purgeSession = createSessionPurge({
      stopTracking: jest.fn(() => undefined),
      clearStoredToken: jest.fn(),
      clearRefreshCookieMemory: jest.fn(),
      disconnectHubSocket: jest.fn(),
      deleteStoreValue: jest.fn(),
      resetAuthExpiredState: jest.fn(),
      updateTrayMenu: jest.fn(),
      logger: { info: jest.fn() },
    });

    expect(() => purgeSession("pause répétée")).not.toThrow();
    expect(() => purgeSession("pause répétée")).not.toThrow();
  });
});
