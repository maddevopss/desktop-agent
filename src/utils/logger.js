const SENSITIVE_KEYS = ["authorization", "token", "password", "secret", "cookie", "jwt", "bearer"];

/**
 * Nettoie récursivement les objets pour masquer les informations sensibles avant le log.
 * Gère également les objets d'erreur (comme ceux d'Axios).
 */
function sanitize(obj, seen = new WeakSet()) {
  if (obj === null || typeof obj !== "object") return obj;
  if (seen.has(obj)) return "[Circular]";
  seen.add(obj);

  if (Array.isArray(obj)) return obj.map((v) => sanitize(v, seen));

  const clean = {};
  const props = Object.getOwnPropertyNames(obj);
  for (const key of props) {
    if (SENSITIVE_KEYS.some((k) => key.toLowerCase().includes(k))) {
      clean[key] = "[REDACTED]";
    } else {
      const val = obj[key];
      clean[key] = typeof val === "object" ? sanitize(val, seen) : val;
    }
  }
  return clean;
}

function formatMeta(meta) {
  if (!meta) return "";
  try {
    return ` ${JSON.stringify(sanitize(meta))}`;
  } catch {
    return " [unloggable metadata]";
  }
}

function log(level, message, meta) {
  const line = `[desktop-agent] ${message}${formatMeta(meta)}`;

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}

module.exports = {
  info: (message, meta) => log("info", message, meta),
  warn: (message, meta) => log("warn", message, meta),
  error: (message, meta) => log("error", message, meta),
};
