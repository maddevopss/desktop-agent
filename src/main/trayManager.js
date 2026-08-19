const { Tray, Menu } = require("electron");
const path = require("path");
const logger = require("../utils/logger");

let tray = null;

function createTray(callbacks) {
  tray = new Tray(path.join(__dirname, "..", "..", "icon.png"));
  updateTrayMenu(callbacks);
  tray.setToolTip("MADSuite Agent");
  tray.on("double-click", () => {
    callbacks.showMainWindow();
  });
  return tray;
}

function updateTrayMenu(callbacks) {
  if (!tray) return;

  const isTracking = callbacks.isTracking();
  const statusLabel = isTracking ? "Statut : En cours" : "Statut : En pause";

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Ouvrir MADSuite",
      click: () => callbacks.showMainWindow()
    },
    { type: "separator" },
    { label: statusLabel, enabled: false },
    {
      label: isTracking ? "Mettre en pause" : "Reprendre le suivi",
      click: () => {
        if (isTracking) {
          callbacks.stopTracking();
          logger.info("Tracking mis en pause manuellement depuis le Tray");
        } else {
          callbacks.startTracking("REPRISE_MANUELLE_TRAY");
        }
        updateTrayMenu(callbacks);
      }
    },
    {
      label: "Forcer la synchronisation",
      click: () => {
        callbacks.forceSync();
      }
    },
    { type: "separator" },
    {
      label: "Quitter",
      click: () => {
        callbacks.quitApp();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

module.exports = {
  createTray,
  updateTrayMenu
};
