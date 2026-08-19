/**
 * Preload dedie a la fenetre Spotlight.
 *
 * Volontairement distinct de preload.js : celui-ci expose login, deleteActivityHistory,
 * exportDiagnostics, etc. Une fenetre sans cadre, toujours au premier plan et declenchable
 * par raccourci global n'a aucun besoin de cette surface — elle capture du texte, rien de plus.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("spotlightAPI", {
  /**
   * Envoie une idee brute au backend (ou a la file offline si le reseau est indisponible).
   * @param {string} text - Contenu tape par l'utilisateur.
   * @returns {Promise<{ ok: boolean, queued?: boolean }>}
   */
  captureIdea: (text) => ipcRenderer.invoke("capture-idea", text),

  /** Ferme la barre sans rien envoyer (Escape ou perte de focus). */
  close: () => ipcRenderer.invoke("close-spotlight"),
});
