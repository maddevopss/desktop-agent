const axios = require("axios");
const crypto = require("crypto");
const { safeStorage } = require("electron");
const { extractRefreshCookie } = require("./auth");

function createAuthSession({
  apiUrl,
  getStoreValue,
  setStoreValue,
  deleteStoreValue,
  getSecureToken,
  saveAccessToken,
  clearStoredToken,
  resetAuthExpiredState,
  registerBackendDownFailure,
  registerBackendHealthy,
  isBackendDownThrottled,
  logger,
  isUsableAccessToken,
}) {
  let refreshCookieHeader = null;
  let refreshInProgress = null;

  function encryptStringForCookie(plainText) {
    const rawText = String(plainText);

    if (safeStorage?.isEncryptionAvailable?.() && typeof safeStorage.encryptString === "function") {
      const encrypted = safeStorage.encryptString(rawText);
      return Buffer.isBuffer(encrypted) ? encrypted.toString("base64") : Buffer.from(encrypted).toString("base64");
    }

    return Buffer.from(rawText, "utf8").toString("base64");
  }

  function decryptStringForCookie(enc) {
    const payload = Buffer.from(String(enc), "base64");

    if (safeStorage?.isEncryptionAvailable?.() && typeof safeStorage.decryptString === "function") {
      try {
        return safeStorage.decryptString(payload);
      } catch {
        // Fallback ci-dessous.
      }
    }

    return payload.toString("utf8");
  }

  function clearRefreshCookieMemory() {
    refreshCookieHeader = null;
    deleteStoreValue("refreshCookieHeader");
    deleteStoreValue("refreshCookieHeaderEncrypted");
  }

  function saveRefreshCookieFromResponse(response) {
    const cookie = extractRefreshCookie(response.headers?.["set-cookie"]);
    if (!cookie) return;

    refreshCookieHeader = cookie;
    const encrypted = encryptStringForCookie(cookie);
    setStoreValue("refreshCookieHeaderEncrypted", encrypted);
    deleteStoreValue("refreshCookieHeader");
  }

  function bootstrapAuth() {
    // Chargement en priorité depuis le store chiffré.
    // En tests, le mock safeStorage peut stocker/retourner différemment; on gère donc:
    // - si decryptString échoue => fallback cookie clair
    // - si decryptString retourne une string invalide => fallback cookie clair
    const encrypted = getStoreValue("refreshCookieHeaderEncrypted", null);
    const fallback = getStoreValue("refreshCookieHeader", null);

    if (encrypted) {
      try {
        const decrypted = decryptStringForCookie(encrypted);
        if (decrypted && typeof decrypted === "string" && decrypted.includes("refresh")) {
          refreshCookieHeader = decrypted;
          logger.info("Auth: Cookie de session restauré avec succès");
          return;
        }

        // Décryptage invalide => fallback.
        refreshCookieHeader = fallback;
        return;
      } catch (err) {
        logger.warn("Auth: Échec de la restauration du cookie sécurisé");
        clearRefreshCookieMemory();
        refreshCookieHeader = fallback;
        return;
      }
    }

    refreshCookieHeader = fallback;

    // Dans le codebase, refreshCookieHeader est attendu comme un cookie header pair complet:
    //   "refresh_token=<val>"
    // Or certains flows (tests) peuvent fournir seulement <val>. On normalise.
    if (refreshCookieHeader && typeof refreshCookieHeader === "string") {
      if (!refreshCookieHeader.includes("refresh_token=") && refreshCookieHeader.includes("refresh")) {
        refreshCookieHeader = `refresh_token=${refreshCookieHeader}`;
      }
    }
  }

  function getRefreshCookieHeader() {
    return refreshCookieHeader;
  }

  function hasRefreshCookie() {
    return Boolean(
      refreshCookieHeader ||
      getStoreValue("refreshCookieHeaderEncrypted", null) ||
      getStoreValue("refreshCookieHeader", null),
    );
  }

  function isRefreshInProgress() {
    return Boolean(refreshInProgress);
  }

  async function loginWithApi({ email, password }) {
    const response = await axios.post(
      `${apiUrl}/api/login`,
      { email, password },
      {
        timeout: 10000,
        validateStatus: () => true,
      },
    );

    if (response.status < 200 || response.status >= 300 || !response.data?.token) {
      const err = new Error(response.data?.message || "Erreur de connexion");
      err.statusCode = response.status;
      throw err;
    }

    saveRefreshCookieFromResponse(response);
    saveAccessToken(response.data.token, response.data.user || null);
    resetAuthExpiredState();

    return {
      success: true,
      token: response.data.token,
      user: response.data.user,
      expiresIn: response.data.expiresIn,
      refreshTokenExpiresIn: response.data.refreshTokenExpiresIn,
    };
  }

  async function refreshAccessTokenViaApi() {
    if (refreshInProgress) return refreshInProgress;

    if (isBackendDownThrottled()) {
      const err = new Error("Backend inaccessible (throttled)");
      err.statusCode = 503;
      throw err;
    }

    refreshInProgress = (async () => {
      // fallback si bootstrapAuth n'a pas initialisé refreshCookieHeader dans ce contexte (tests/mocks)
      if (!refreshCookieHeader) {
        const encrypted = getStoreValue("refreshCookieHeaderEncrypted", null);
        if (encrypted) {
          try {
            refreshCookieHeader = decryptStringForCookie(encrypted);
          } catch {
            // ignore, handled below
          }
        }
      }

      if (!refreshCookieHeader) {
        // Dernier recours: le store peut exposer directement le cookie clair.
        const fallback = getStoreValue("refreshCookieHeader", null);
        if (fallback && typeof fallback === "string") {
          refreshCookieHeader = fallback.includes("refresh_token=") ? fallback : `refresh_token=${fallback}`;
        }
      }

      if (!refreshCookieHeader) {
        const err = new Error("Refresh cookie indisponible dans le main process.");
        err.statusCode = 401;
        throw err;
      }

      let response;
      try {
        response = await axios.post(
          `${apiUrl}/api/refresh`,
          {},
          {
            timeout: 10000,
            headers: {
              Cookie: refreshCookieHeader,
            },
            validateStatus: () => true,
          },
        );
      } catch (err) {
        registerBackendDownFailure();
        throw err;
      }

      if (response.status < 200 || response.status >= 300 || !response.data?.token) {
        if (response.status >= 500) {
          registerBackendDownFailure();
        }

        const err = new Error(response.data?.message || "Refresh token invalide ou expiré");
        err.statusCode = response.status;
        throw err;
      }

      saveRefreshCookieFromResponse(response);
      saveAccessToken(response.data.token, response.data.user || null);
      resetAuthExpiredState();
      registerBackendHealthy();

      return {
        success: true,
        token: response.data.token,
        user: response.data.user,
        expiresIn: response.data.expiresIn,
        refreshTokenExpiresIn: response.data.refreshTokenExpiresIn,
      };
    })();

    try {
      return await refreshInProgress;
    } finally {
      refreshInProgress = null;
    }
  }

  async function logout(notifyRenderer) {
    clearStoredToken();
    clearRefreshCookieMemory();
    resetAuthExpiredState();
    if (notifyRenderer) {
      notifyRenderer("auth-expired");
      notifyRenderer("session-expired");
    }
    logger.info("Auth: Session nettoyée proprement");
  }

  function restoreToken() {
    const secureToken = getSecureToken();

    if (!secureToken || !isUsableAccessToken(secureToken)) {
      logger.info("Restore-token: Aucun token valide trouvé dans le stockage sécurisé.");
      clearStoredToken();
      return null;
    }

    const encrypted = getStoreValue("refreshCookieHeaderEncrypted", null);
    if (encrypted) {
      try {
        refreshCookieHeader = decryptStringForCookie(encrypted);
      } catch (err) {
        logger.warn("Restore-token: Cookie refresh corrompu ou illisible", { error: err.message });
        clearRefreshCookieMemory();
      }
    }

    return {
      token: secureToken,
      user: getStoreValue("user", null),
    };
  }

  return {
    bootstrapAuth,
    clearRefreshCookieMemory,
    getRefreshCookieHeader,
    hasRefreshCookie,
    isRefreshInProgress,
    loginWithApi,
    logout,
    refreshAccessTokenViaApi,
    restoreToken,
  };
}

module.exports = { createAuthSession };
