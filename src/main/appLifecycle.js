const { app, globalShortcut, powerMonitor } = require("electron");
const logger = require("../utils/logger");

// Raccourci principal, puis repli si une autre application detient deja la combinaison.
const BRAIN_DUMP_SHORTCUTS = ["CommandOrControl+Shift+Space", "CommandOrControl+Alt+Space"];

/**
 * Enregistre le raccourci global de decharge mentale.
 *
 * register() renvoie false quand une autre application detient deja l'accelerateur.
 * Sans repli ni journalisation, la fonctionnalite paraitrait simplement morte.
 * @param {{ toggleBrainDumpWidget: () => void }} widgetCallbacks
 * @returns {string | null} L'accelerateur retenu, ou null si aucun n'a pu etre pris.
 */
function registerBrainDumpShortcut(widgetCallbacks) {
  for (const accelerator of BRAIN_DUMP_SHORTCUTS) {
    try {
      if (globalShortcut.register(accelerator, () => widgetCallbacks.toggleBrainDumpWidget())) {
        logger.info("BRAIN DUMP SHORTCUT REGISTERED", { accelerator });
        return accelerator;
      }
      logger.warn("BRAIN DUMP SHORTCUT UNAVAILABLE", { accelerator });
    } catch (err) {
      logger.warn("BRAIN DUMP SHORTCUT REGISTER FAILED", { accelerator, error: err?.message });
    }
  }

  logger.error("BRAIN DUMP SHORTCUT NONE AVAILABLE", { tried: BRAIN_DUMP_SHORTCUTS });
  return null;
}

function setupLifecycleEvents({
  trackingCallbacks,
  widgetCallbacks,
  handleProtocolUrl
}) {
  // Pilotage dynamique du tracker selon l'état du système
  if (powerMonitor) {
    powerMonitor.on("suspend", () => {
      logger.info("Système en veille - arrêt préventif du tracking");
      trackingCallbacks.stopTracking();
    });

    powerMonitor.on("resume", () => {
      logger.info("Système de retour de veille - tentative de reprise du tracking");
      trackingCallbacks.startTracking("SYSTEM_RESUME");
    });

    powerMonitor.on("lock-screen", () => {
      logger.info("Écran verrouillé - arrêt du tracking pour confidentialité");
      trackingCallbacks.stopTracking();
    });

    powerMonitor.on("unlock-screen", () => {
      logger.info("Écran déverrouillé - reprise du tracking");
      trackingCallbacks.startTracking("SYSTEM_UNLOCK");
    });
  }

  // Raccourci Global pour le Brain Dump
  registerBrainDumpShortcut(widgetCallbacks);

  // Sans ceci l'accelerateur reste reserve au niveau systeme apres la fermeture.
  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });

  // Protocol URL / Deep-linking
  if (app.setAsDefaultProtocolClient) {
    app.setAsDefaultProtocolClient("madsuite");
  }

  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleProtocolUrl(url);
  });
}

module.exports = {
  setupLifecycleEvents,
  registerBrainDumpShortcut,
  BRAIN_DUMP_SHORTCUTS
};
