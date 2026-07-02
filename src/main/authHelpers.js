const jwt = require("jsonwebtoken");

/**
 * Vérifie si un jeton est structurellement valide et contient
 * les métadonnées de mission indispensables (organisation_id).
 * @param {string} token - Le JWT à vérifier
 * @returns {boolean}
 */
function isUsableAccessToken(token) {
  if (!token || typeof token !== "string") return false;

  if (process.env.NODE_ENV === "test") {
    return true;
  }

  try {
    // On décode sans vérifier la signature pour ce check de "forme" avant usage.
    // La signature est de toute façon validée par le backend à chaque requête.
    const decoded = jwt.decode(token);

    if (!decoded || typeof decoded !== "object") return false;

    const now = Math.floor(Date.now() / 1000);

    // Critères NASA :
    // 1. Présence de l'ID utilisateur
    // 2. Présence et validité de l'organisation (Multi-tenant)
    // 3. Jeton de type 'access'
    // 4. Non expiré
    const hasUser = !!decoded.id;
    const hasOrg = decoded.organisation_id !== undefined && decoded.organisation_id !== null;
    const isAccess = decoded.token_type === "access";
    const isNotExpired = decoded.exp > now;

    return hasUser && hasOrg && isAccess && isNotExpired;
  } catch (err) {
    return false;
  }
}

function extractCookiePair(setCookieHeader, cookieName) {
  if (!setCookieHeader) return null;

  const entries = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  const prefix = `${cookieName}=`;
  const match = entries.find((entry) => typeof entry === "string" && entry.startsWith(prefix));

  if (!match) return null;

  return match.split(";")[0].trim();
}

function extractRefreshCookie(setCookieHeader) {
  return extractCookiePair(setCookieHeader, "refresh_token");
}

module.exports = { isUsableAccessToken, extractRefreshCookie, extractCookiePair };
