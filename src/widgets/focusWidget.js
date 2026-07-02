// desktop-agent/src/widgets/focusWidget.js

const { BrowserWindow } = require('electron');
const path = require('path');

/**
 * Creates a small always‑on‑top window that shows the Focus Autonomous timer.
 * The window loads a minimal HTML page located in `renderer/focusWidget.html`.
 */
function createFocusWidget() {
  const widget = new BrowserWindow({
    width: 340,
    height: 180,
    alwaysOnTop: true,
    resizable: false,
    frame: false,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load the static HTML UI (bundled with the Electron build)
  const widgetHtmlPath = path.join(__dirname, '..', 'renderer', 'focusWidget.html');
  widget.loadFile(widgetHtmlPath).catch((e) => console.error('Failed to load focus widget', e));

  // Hide the widget when closed instead of destroying it, so it can be reopened quickly
  widget.on('close', (e) => {
    e.preventDefault();
    widget.hide();
  });

  return widget;
}

module.exports = { createFocusWidget };
