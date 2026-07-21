const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 1024;
const MAX_TOKEN_LENGTH = 16_384;
const MAX_BRAIN_DUMP_LENGTH = 5_000;
const MAX_PRIVACY_ITEMS = 50;
const MAX_PRIVACY_ITEM_LENGTH = 200;
const VALID_TRACKING_INTERVALS = Object.freeze([30, 60, 90, 120, 300]);

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} doit être un objet.`);
  }
  return value;
}

function assertNoUnknownFields(value, allowedFields, label) {
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      throw new TypeError(`${label} contient un champ interdit : ${key}.`);
    }
  }
}

function parseLoginCredentials(value) {
  const credentials = assertPlainObject(value, "Les identifiants");
  assertNoUnknownFields(credentials, new Set(["email", "password"]), "Les identifiants");

  const email = typeof credentials.email === "string" ? credentials.email.trim().toLowerCase() : "";
  const password = typeof credentials.password === "string" ? credentials.password : "";

  if (!email || email.length > MAX_EMAIL_LENGTH || !email.includes("@")) {
    throw new TypeError("Adresse courriel invalide.");
  }
  if (!password || password.length > MAX_PASSWORD_LENGTH) {
    throw new TypeError("Mot de passe invalide.");
  }

  return { email, password };
}

function parseToken(value, label = "Token") {
  if (typeof value !== "string") throw new TypeError(`${label} invalide.`);
  const token = value.trim();
  if (!token || token.length > MAX_TOKEN_LENGTH || token.split(".").length !== 3) {
    throw new TypeError(`${label} invalide.`);
  }
  return token;
}

function parseTrackingInterval(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || !VALID_TRACKING_INTERVALS.includes(value)) {
    throw new TypeError(`Intervalle invalide. Valeurs acceptées : ${VALID_TRACKING_INTERVALS.join(", ")}s.`);
  }
  return value;
}

function normalizeStringList(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${label} doit être une liste.`);
  if (value.length > MAX_PRIVACY_ITEMS) throw new TypeError(`${label} dépasse la limite de ${MAX_PRIVACY_ITEMS} éléments.`);

  return value.map((item) => {
    if (typeof item !== "string") throw new TypeError(`${label} contient une valeur invalide.`);
    const normalized = item.trim();
    if (!normalized || normalized.length > MAX_PRIVACY_ITEM_LENGTH) {
      throw new TypeError(`${label} contient une valeur invalide.`);
    }
    return normalized;
  });
}

function parsePrivacySettings(value) {
  const settings = assertPlainObject(value, "Les réglages de confidentialité");
  assertNoUnknownFields(
    settings,
    new Set(["trackingEnabled", "ignoredApps", "ignoredKeywords"]),
    "Les réglages de confidentialité",
  );

  if (typeof settings.trackingEnabled !== "boolean") {
    throw new TypeError("trackingEnabled doit être un booléen.");
  }

  return {
    trackingEnabled: settings.trackingEnabled,
    ignoredApps: normalizeStringList(settings.ignoredApps, "ignoredApps"),
    ignoredKeywords: normalizeStringList(settings.ignoredKeywords, "ignoredKeywords"),
  };
}

function parseBrainDump(value) {
  if (typeof value !== "string") throw new TypeError("Le contenu doit être une chaîne.");
  const content = value.trim();
  if (!content || content.length > MAX_BRAIN_DUMP_LENGTH) {
    throw new TypeError(`Le contenu doit contenir entre 1 et ${MAX_BRAIN_DUMP_LENGTH} caractères.`);
  }
  return content;
}

function parseBoolean(value, label) {
  if (typeof value !== "boolean") throw new TypeError(`${label} doit être un booléen.`);
  return value;
}

module.exports = {
  VALID_TRACKING_INTERVALS,
  parseLoginCredentials,
  parseToken,
  parseTrackingInterval,
  parsePrivacySettings,
  parseBrainDump,
  parseBoolean,
};
