const { app, BrowserWindow } = require("electron");
const path = require("path");
const logger = require("../utils/logger");
const { createFocusWidget } = require("../widgets/focusWidget");
const { createBrainDumpWidget } = require("../widgets/brainDumpWidget");

let mainWindow = null;
let focusWidget = null;
let brainDumpWidget = null;
const isDev = process.env.NODE_ENV !== "production";
const FRONTEND_DEV_URL = process.env.AGENT_FRONTEND_URL || "http://localhost:3000";
const SHOULD_OPEN_DEVTOOLS = process.env.AGENT_OPEN_DEVTOOLS === "1";

function getMainWindow() {
  return mainWindow;
}

function getFocusWidget() {
  return focusWidget;
}

function getBrainDumpWidget() {
  return brainDumpWidget;
}

function isAllowedNavigationUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    if (isDev && parsed.origin === FRONTEND_DEV_URL) return true;
    if (parsed.protocol === "file:") return true;
    return false;
  } catch {
    return false;
  }
}

function createWindow(isQuittingFn) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  mainWindow.on("close", (event) => {
    if (!isQuittingFn()) {
      event.preventDefault();
      mainWindow.hide();
      logger.info("Fenetre cachee, agent toujours actif");
    }
  });

  mainWindow.webContents.on("did-finish-load", () => {
    logger.info("Fenetre React chargee - React appelera agentAPI.restoreToken()");
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isAllowedNavigationUrl(targetUrl)) {
      event.preventDefault();
      logger.warn("Navigation externe bloquee", { targetUrl });
    }
  });

  if (isDev) {
    logger.info(`Mode DEV: Chargement du frontend depuis ${FRONTEND_DEV_URL}`);
    mainWindow.loadURL(FRONTEND_DEV_URL);
    if (SHOULD_OPEN_DEVTOOLS) {
      mainWindow.webContents.openDevTools();
    }
  } else {
    mainWindow.webContents.on("before-input-event", (event, input) => {
      const opensDevTools = input.key === "F12" || (input.control && input.shift && input.key.toLowerCase() === "i");
      if (opensDevTools) event.preventDefault();
    });

    const frontendBuildPath = app.isPackaged
      ? path.join(process.resourcesPath, "app.asar", "frontend-dist", "index.html")
      : path.join(__dirname, "..", "..", "frontend", "build", "index.html");

    const fs = require("fs");
    if (!fs.existsSync(frontendBuildPath)) {
      logger.error("Frontend build introuvable", { frontendBuildPath });
    }

    mainWindow.loadFile(frontendBuildPath);
  }
  return mainWindow;
}

function notifyRenderer(channel, payload = undefined) {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents) return;
  mainWindow.webContents.send(channel, payload);
}

function toggleFocusWidget() {
  if (!focusWidget || focusWidget.isDestroyed()) {
    focusWidget = createFocusWidget();
  } else {
    if (focusWidget.isVisible()) {
      focusWidget.hide();
    } else {
      focusWidget.show();
    }
  }
  return focusWidget;
}

function toggleBrainDumpWidget() {
  if (!brainDumpWidget || brainDumpWidget.isDestroyed()) {
    brainDumpWidget = createBrainDumpWidget();
  } else {
    if (brainDumpWidget.isVisible()) {
      brainDumpWidget.hide();
    } else {
      brainDumpWidget.show();
    }
  }
  return brainDumpWidget;
}

function hideBrainDumpWidget() {
  if (brainDumpWidget && !brainDumpWidget.isDestroyed()) {
    brainDumpWidget.hide();
  }
}

function destroyWidgets() {
  if (focusWidget && !focusWidget.isDestroyed()) {
    focusWidget.destroy();
  }
  if (brainDumpWidget && !brainDumpWidget.isDestroyed()) {
    brainDumpWidget.destroy();
  }
}

module.exports = {
  createWindow,
  getMainWindow,
  getFocusWidget,
  getBrainDumpWidget,
  notifyRenderer,
  toggleFocusWidget,
  toggleBrainDumpWidget,
  hideBrainDumpWidget,
  destroyWidgets,
  isAllowedNavigationUrl,
};
