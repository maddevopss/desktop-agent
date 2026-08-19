let Store;

try {
  Store = require("electron-store");
} catch {
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
}

let store = null;

async function initStore() {
  if (!store) {
    store = new Store({
      name: "chronomad-agent",
    });
  }

  return store;
}

let safeStorage = null;
try {
  const electron = require("electron");
  if (electron.app) {
    safeStorage = electron.safeStorage;
  }
} catch (e) {
  // Non-electron environment
}

function getSecureToken() {
  if (!store) return null;
  const val = store.get("token", null);
  if (!val) return null;
  
  if (safeStorage && safeStorage.isEncryptionAvailable()) {
    try {
      // Try to decrypt
      const buffer = Buffer.from(val, "base64");
      return safeStorage.decryptString(buffer);
    } catch (e) {
      // Fallback if it wasn't encrypted or key is wrong
      return val;
    }
  }
  return val;
}

function setSecureToken(token) {
  if (!store) return;
  if (!token) {
    store.set("token", null);
    return;
  }
  
  if (safeStorage && safeStorage.isEncryptionAvailable()) {
    try {
      const encrypted = safeStorage.encryptString(token).toString("base64");
      store.set("token", encrypted);
    } catch (e) {
      throw new Error("Erreur de chiffrement du jeton.");
    }
  } else {
    throw new Error("Chiffrement matériel indisponible. Sécurité compromise.");
  }
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
