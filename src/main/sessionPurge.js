const SESSION_STORE_KEYS = Object.freeze([
  "user",
  "focusTimer",
  "lastCapturedActivity",
]);

function createSessionPurge(dependencies) {
  const {
    stopTracking,
    clearStoredToken,
    clearRefreshCookieMemory,
    disconnectHubSocket,
    deleteStoreValue,
    resetAuthExpiredState,
    updateTrayMenu,
    logger,
  } = dependencies;

  return function purgeSession(reason = "session cleared") {
    stopTracking?.();
    disconnectHubSocket?.();
    clearStoredToken();
    clearRefreshCookieMemory();

    for (const key of SESSION_STORE_KEYS) {
      deleteStoreValue(key);
    }

    resetAuthExpiredState();
    updateTrayMenu?.();
    logger?.info("Session locale purgée", { reason });

    return { success: true };
  };
}

module.exports = {
  SESSION_STORE_KEYS,
  createSessionPurge,
};
