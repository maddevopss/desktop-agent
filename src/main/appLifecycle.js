const { app, globalShortcut, powerMonitor } = require("electron");
const logger = require("../utils/logger");

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
  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    widgetCallbacks.toggleBrainDumpWidget();
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
  setupLifecycleEvents
};
