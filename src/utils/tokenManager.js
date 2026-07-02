let Store;
let encKey = null;

try {
  const crypto = require("crypto");

  // Ensure encryption key is provided; avoid insecure default.
  if (!process.env.AGENT_TOKEN_ENC_KEY) {
    throw new Error("AGENT_TOKEN_ENC_KEY environment variable is required for token encryption.");
  }

  encKey = crypto.createHash("sha256").update(process.env.AGENT_TOKEN_ENC_KEY).digest("base64").slice(0, 32);

  Store = require("electron-store");
} catch {
  // Tests: electron-store + secure storage may be missing.
  // Fallback en mémoire + clé chiffrage déterministe pour ne pas casser electron-store options.
  Store = class MemoryStore {
    constructor() {
      this.data = new Map();
    }

    get(key, fallback = null) {
      return this.data.has(key) ? this.data.get(key) : fallback;
    }

    set(key, value) {
      this.data.set(key, value);
    }

    delete(key) {
      this.data.delete(key);
    }
  };

  // Clé factice mais stable si pas d'env.
  encKey = encKey || "__test_enc_key_missing__";
}
const jwt = require("jsonwebtoken");

let store = null;

let initPromise = null;
async function initStore() {
  if (store) return store;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    store = new Store({
      name: "madsuite-agent",
      encryptionKey: encKey,
    });
    return store;
  })();
  return initPromise;
}

function getSecureToken() {
  if (!store) return null;
  const token = store.get("token", null);
  if (!token) return null;
  try {
    // Verify signature if verification key is configured.
    if (process.env.AGENT_TOKEN_SIGN_KEY) {
      const payload = jwt.verify(token, process.env.AGENT_TOKEN_SIGN_KEY);
      if (payload.exp && Date.now() >= payload.exp * 1000) {
        clearSecureToken();
        return null;
      }
      return token;
    } else {
      // Fallback to decode-only check when no signing key is set.
      const payload = jwt.decode(token);
      if (payload && payload.exp && Date.now() >= payload.exp * 1000) {
        clearSecureToken();
        return null;
      }
    }
  } catch (err) {
    // Invalid token – clear it.
    clearSecureToken();
    return null;
  }
  return token;
}

function setSecureToken(token) {
  if (!store) return;
  store.set("token", token || null);
}

function clearSecureToken() {
  if (!store) return;
  store.delete("token");
}

module.exports = {
  initStore,
  getSecureToken,
  setSecureToken,
  clearSecureToken,
};
