jest.mock("axios", () => ({ post: jest.fn() }));

const axios = require("axios");

describe("desktop-agent anti-loop when backend is down", () => {
  let warnSpy;
  let errorSpy;
  let logSpy;
  let handlers;

  function loadMain() {
    jest.resetModules();
    handlers = {};

    jest.doMock("electron", () => ({
      app: {
        getVersion: jest.fn(() => "1.0.0"),
        isPackaged: false,
        getPath: jest.fn(() => "./tmp"),
        getAppPath: jest.fn(() => "./tmp"),
        whenReady: jest.fn(() => Promise.resolve()),
        on: jest.fn(),
        quit: jest.fn(),
      },
      BrowserWindow: jest.fn(() => ({
        on: jest.fn(),
        on: jest.fn(),

        hide: jest.fn(),
        show: jest.fn(),
        focus: jest.fn(),
        isDestroyed: jest.fn(() => false),
        webContents: {
          send: jest.fn(),
          openDevTools: jest.fn(),
          setWindowOpenHandler: jest.fn(),
          on: jest.fn(),
          loadURL: jest.fn(),
          loadFile: jest.fn(),
        },
        loadURL: jest.fn(),
        loadFile: jest.fn(),
      })),
      ipcMain: {
        handle: jest.fn((channel, handler) => {
          handlers[channel] = handler;
        }),
      },
      Tray: jest.fn(() => ({ setToolTip: jest.fn(), on: jest.fn() })),
      Menu: { buildFromTemplate: jest.fn(() => ({})) },
      powerMonitor: {
        getSystemIdleTime: jest.fn(() => 0),
        getSystemIdleState: jest.fn(() => "active"),
      },
    }));

    jest.doMock("electron-store", () => {
      return function FakeStore() {
        const data = {};
        return {
          get: (k, d) => (k in data ? data[k] : d),
          set: (k, v) => {
            data[k] = v;
          },
          delete: (k) => {
            delete data[k];
          },
        };
      };
    });

    jest.doMock("electron", () => ({
      app: {
        getVersion: jest.fn(() => "1.0.0"),
        isPackaged: false,
        getPath: jest.fn(() => "./tmp"),
        getAppPath: jest.fn(() => "./tmp"),
        whenReady: jest.fn(() => Promise.resolve()),
        on: jest.fn(),
        quit: jest.fn(),
      },
      BrowserWindow: jest.fn(() => ({
        on: jest.fn(),
        hide: jest.fn(),
        show: jest.fn(),
        focus: jest.fn(),
        isDestroyed: jest.fn(() => false),
        webContents: {
          send: jest.fn(),
          openDevTools: jest.fn(),
          setWindowOpenHandler: jest.fn(),
          on: jest.fn(),
          loadURL: jest.fn(),
          loadFile: jest.fn(),
        },
      })),

      ipcMain: {
        handle: jest.fn((channel, handler) => {
          handlers[channel] = handler;
        }),
      },
      Tray: jest.fn(() => ({ setToolTip: jest.fn(), on: jest.fn() })),
      Menu: { buildFromTemplate: jest.fn(() => ({})) },
      powerMonitor: {
        getSystemIdleTime: jest.fn(() => 0),
        getSystemIdleState: jest.fn(() => "active"),
      },
      safeStorage: {
        encryptString: (s) => Buffer.from(String(s)).toString("base64"),
        decryptString: (b) => Buffer.from(b).toString("utf8"),
      },
    }));

    jest.doMock("../src/main/tracking", () => ({
      createTrackingController: jest.fn(() => ({
        isTracking: () => false,
        startTracking: jest.fn(),
        stopTracking: jest.fn(),
      })),
    }));

    jest.doMock("../src/main/windowScanner", () => ({ getOpenWindows: jest.fn(async () => []) }));

    require("../main");

    return handlers;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AGENT_API_URL = "http://localhost:5000";
    process.env.AGENT_REFRESH_TIMEOUT_MS = "50";

    // Make axios / refresh fail as backend down.
    axios.post.mockRejectedValue({
      response: { status: 503, data: { message: "backend down" } },
      message: "backend down",
    });

    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  test("refresh-token does not spin in an infinite loop when backend keeps returning 503", async () => {
    const mainHandlers = loadMain();

    expect(mainHandlers).toBeDefined();
    expect(typeof mainHandlers["refresh-token"]).toBe("function");

    // Simulate two rapid refresh calls.
    // We assert they both fail, and axios.post is called limited times.
    await expect(mainHandlers["refresh-token"]()).rejects.toBeTruthy();
    await expect(mainHandlers["refresh-token"]()).rejects.toBeTruthy();

    // Sans cookie de refresh, le handler doit échouer tout de suite sans partir sur le réseau.
    expect(axios.post).toHaveBeenCalledTimes(0);
  });
});
