const { BrowserWindow } = require('electron');
const path = require('path');

function createBrainDumpWidget() {
  const widget = new BrowserWindow({
    width: 600,
    height: 80,
    alwaysOnTop: true,
    resizable: false,
    frame: false,
    transparent: true,
    center: true,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const widgetHtmlPath = path.join(__dirname, '..', 'renderer', 'brainDumpWidget.html');
  widget.loadFile(widgetHtmlPath).catch((e) => console.error('Failed to load brain dump widget', e));

  // Cacher au lieu de détruire quand l'utilisateur perd le focus
  widget.on('blur', () => {
    widget.hide();
  });

  widget.on('close', (e) => {
    e.preventDefault();
    widget.hide();
  });

  return widget;
}

module.exports = { createBrainDumpWidget };
