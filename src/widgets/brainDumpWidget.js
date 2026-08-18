const { BrowserWindow } = require('electron');
const path = require('path');
const logger = require('../utils/logger');

const WIDGET_WIDTH = 620;
const WIDGET_HEIGHT = 80;

/**
 * Cree la barre flottante de decharge mentale.
 *
 * La fenetre est cachee et non detruite lorsqu'on la referme : la recreer a chaque appui
 * sur le raccourci global ajouterait un delai de chargement visible, alors que tout
 * l'interet de la fonction est l'immediatete.
 */
function createBrainDumpWidget() {
  const widget = new BrowserWindow({
    width: WIDGET_WIDTH,
    height: WIDGET_HEIGHT,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    frame: false,
    center: true,
    // Fenetre opaque : transparent + alwaysOnTop provoque un clignotement a
    // l'affichage sur Windows 11.
    backgroundColor: '#0f172a',
    webPreferences: {
      // Preload dedie, pas le preload.js principal : ce widget n'a besoin que de deux
      // canaux, inutile de lui exposer toute l'API de l'agent.
      preload: path.join(__dirname, 'brainDumpPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  const widgetHtmlPath = path.join(__dirname, '..', 'renderer', 'brainDumpWidget.html');
  widget.loadFile(widgetHtmlPath).catch((err) => {
    logger.error('Chargement du widget Brain Dump impossible', { error: err?.message });
  });

  widget.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  widget.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  // Perdre le focus vaut annulation : la barre ne doit jamais rester en travers de l'ecran.
  widget.on('blur', () => {
    widget.hide();
  });

  widget.on('close', (event) => {
    event.preventDefault();
    widget.hide();
  });

  return widget;
}

module.exports = { createBrainDumpWidget };
