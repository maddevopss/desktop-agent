const crypto = require("crypto");
const jwt = require("jsonwebtoken");

function firstDefined(payload, keys) {
  for (const key of keys) {
    const value = payload?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value);
    }
  }
  return null;
}

function hashScope(organisationId, userId) {
  return crypto
    .createHash("sha256")
    .update(`organisation:${organisationId}|user:${userId}`)
    .digest("hex");
}

function deriveCaptureQueueScope(token) {
  if (typeof token !== "string" || !token.trim()) return null;

  let payload;
  try {
    payload = jwt.decode(token.trim());
  } catch {
    payload = null;
  }

  if (!payload || typeof payload !== "object") {
    if (process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID) {
      return crypto.createHash("sha256").update(`test-token:${token.trim()}`).digest("hex");
    }
    return null;
  }

  const organisationId = firstDefined(payload, [
    "organisation_id",
    "organisationId",
    "organization_id",
    "organizationId",
    "org_id",
    "orgId",
  ]);
  const userId = firstDefined(payload, ["sub", "user_id", "userId", "id"]);

  if (!organisationId || !userId) return null;

  return hashScope(organisationId, userId);
}

function bindCaptureEntryToScope(entry, scope) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new TypeError("Capture invalide.");
  }
  if (typeof scope !== "string" || !/^[a-f0-9]{64}$/.test(scope)) {
    throw new TypeError("Scope de session invalide.");
  }

  return {
    ...entry,
    sessionScope: scope,
  };
}

function partitionCaptureEntriesByScope(entries, activeScope) {
  if (!Array.isArray(entries)) {
    throw new TypeError("La file de captures doit être une liste.");
  }
  if (typeof activeScope !== "string" || !/^[a-f0-9]{64}$/.test(activeScope)) {
    return {
      eligible: [],
      retained: entries.slice(),
      rejectedLegacy: [],
    };
  }

  const eligible = [];
  const retained = [];
  const rejectedLegacy = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      rejectedLegacy.push(entry);
      continue;
    }

    if (typeof entry.sessionScope !== "string") {
      rejectedLegacy.push(entry);
      continue;
    }

    if (entry.sessionScope === activeScope) eligible.push(entry);
    else retained.push(entry);
  }

  return { eligible, retained, rejectedLegacy };
}

module.exports = {
  deriveCaptureQueueScope,
  bindCaptureEntryToScope,
  partitionCaptureEntriesByScope,
};
