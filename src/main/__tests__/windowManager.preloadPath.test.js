/**
 * Le chemin du preload doit resoudre vers un fichier reel.
 *
 * Regression constatee : windowManager pointait la fenetre principale sur
 * path.join(__dirname, "..", "preload.js"), soit src/preload.js, qui n'existe pas.
 * Electron se contente alors de journaliser l'echec et poursuit, donc rien ne casse
 * bruyamment : window.agentAPI reste simplement indefini et tous les appels du renderer
 * echouent silencieusement. Un chemin errone doit desormais faire echouer un test.
 */

const fs = require("fs");

const capturedOptions = [];

jest.mock("electron", () => {
  const webContents = {
    on: jest.fn(),
    setWindowOpenHandler: jest.fn(),
    openDevTools: jest.fn(),
    send: jest.fn(),
  };

  return {
    app: { isPackaged: false },
    BrowserWindow: jest.fn(function BrowserWindowMock(options) {
      capturedOptions.push(options);
      return {
        on: jest.fn(),
        hide: jest.fn(),
        show: jest.fn(),
        focus: jest.fn(),
        center: jest.fn(),
        isDestroyed: jest.fn(() => false),
        isVisible: jest.fn(() => false),
        loadURL: jest.fn(),
        loadFile: jest.fn(() => Promise.resolve()),
        webContents,
      };
    }),
  };
});

describe("windowManager — chemin du preload", () => {
  beforeEach(() => {
    capturedOptions.length = 0;
    jest.resetModules();
  });

  test("la fenetre principale pointe sur un preload existant", () => {
    const windowManager = require("../windowManager");
    windowManager.createWindow(() => false);

    const { preload } = capturedOptions[0].webPreferences;

    expect(preload).toMatch(/preload\.js$/);
    expect(fs.existsSync(preload)).toBe(true);
  });

  test("le widget Brain Dump pointe sur un preload existant", () => {
    const windowManager = require("../windowManager");
    windowManager.toggleBrainDumpWidget();

    const { preload } = capturedOptions[0].webPreferences;

    expect(preload).toMatch(/brainDumpPreload\.js$/);
    expect(fs.existsSync(preload)).toBe(true);
  });

  test("les deux fenetres conservent le durcissement attendu", () => {
    const windowManager = require("../windowManager");
    windowManager.createWindow(() => false);
    windowManager.toggleBrainDumpWidget();

    expect(capturedOptions).toHaveLength(2);
    for (const options of capturedOptions) {
      expect(options.webPreferences).toMatchObject({
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      });
    }
  });
});
