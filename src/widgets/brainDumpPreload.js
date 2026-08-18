/**
 * Preload dedie au widget Brain Dump.
 *
 * Volontairement distinct du preload.js principal, qui expose login, deleteActivityHistory,
 * exportDiagnostics, setAutostart, etc. Une fenetre sans cadre, toujours au premier plan et
 * declenchable par raccourci global n'a aucun besoin de cette surface : elle capture du
 * texte et se referme.
 *
 * L'allowlist de canaux est recopiee ici au lieu d'etre importee de src/shared/ipcChannels :
 * un preload sandboxe ne peut pas charger de module applicatif relatif.
 */

const { contextBridge, ipcRenderer } = require("electron");

const ALLOWED_CHANNELS = new Set(["send-brain-dump", "hide-brain-dump-widget"]);

function invoke(channel, ...args) {
  if (!ALLOWED_CHANNELS.has(channel)) {
    throw new Error(`Canal IPC interdit depuis le widget Brain Dump : ${String(channel)}`);
  }
  return ipcRenderer.invoke(channel, ...args);
}

// Expose pour le test anti-derive, qui verifie que ces canaux restent un sous-ensemble
// de src/shared/ipcChannels.js.
module.exports = { ALLOWED_CHANNELS };

contextBridge.exposeInMainWorld("brainDumpAPI", {
  /**
   * Envoie une idee brute. Le process principal se charge du repli hors ligne.
   * @param {string} text
   * @returns {Promise<{ ok: boolean, queued: boolean }>}
   */
  send: (text) => invoke("send-brain-dump", text),

  /** Referme la barre sans rien envoyer (Echap ou perte de focus). */
  hide: () => invoke("hide-brain-dump-widget"),
});
