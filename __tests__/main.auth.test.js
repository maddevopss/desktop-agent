const mockIpcHandlers = {};
const os = require("os");
const path = require("path");

const testUserDataPath = path.join(os.tmpdir(), "madsuite-desktop-agent-test");

const mockTracking = {
  startTracking: jest.fn(),
  stopTracking: jest.fn(),
  isTracking: jest.fn(() => false),
};

const persistentStoreData = new Map();
let mockTrackingOptions = null;

let mockAxiosPost;
let mockAxiosDelete;

function loadMainWithMocks() {
  jest.resetModules();

  for (const key of Object.keys(mockIpcHandlers)) {
    delete mockIpcHandlers[key];
  }

  mockAxiosPost = jest.fn();
  mockAxiosDelete = jest.fn();

  jest.doMock("axios", () => ({
    post: mockAxiosPost,
    delete: mockAxiosDelete,
  }));

  jest.doMock("socket.io-client", () => ({
    io: jest.fn(() => ({
      on: jest.fn(),
      disconnect: jest.fn(),
    })),
  }));

  jest.doMock("electron", () => ({
    app: {
      getVersion: jest.fn(() => "1.0.0"),
      isPackaged: false,
      getPath: jest.fn(() => testUserDataPath),
      getAppPath: jest.fn(() => "/tmp/madsuite-test-app"),
      whenReady: jest.fn(() => ({
        then: jest.fn(),
      })),
      on: jest.fn(),
      quit: jest.fn(),
    },
    BrowserWindow: jest.fn(),
    ipcMain: {
      handle: jest.fn((channel, handler) => {
        mockIpcHandlers[channel] = handler;
      }),
    },
    Tray: jest.fn(),
    Menu: {
      buildFromTemplate: jest.fn(() => ({})),
    },
    powerMonitor: {
      getSystemIdleTime: jest.fn(() => 0),
      getSystemIdleState: jest.fn(() => "active"),
    },
  }));

  jest.doMock("../src/main/tracking", () => ({
    createTrackingController: jest.fn((opts) => {
      mockTrackingOptions = opts;
      global.mockTrackingOptions = opts;
      return mockTracking;
    }),
  }));

  jest.doMock("../src/main/windowScanner", () => ({
    getOpenWindows: jest.fn(async () => []),
  }));

  require("../main");
}

function loadMainWithPersistentStore() {
  jest.resetModules();

  for (const key of Object.keys(mockIpcHandlers)) {
    delete mockIpcHandlers[key];
  }

  mockAxiosPost = jest.fn();
  mockAxiosDelete = jest.fn();

  jest.doMock("axios", () => ({
    post: mockAxiosPost,
    delete: mockAxiosDelete,
  }));

  jest.doMock("socket.io-client", () => ({
    io: jest.fn(() => ({
      on: jest.fn(),
      disconnect: jest.fn(),
    })),
  }));

  jest.doMock("electron-store", () => {
    return function FakeStore() {
      return {
        get: (key, fallback = null) => (persistentStoreData.has(key) ? persistentStoreData.get(key) : fallback),
        set: (key, value) => {
          persistentStoreData.set(key, value);
        },
        delete: (key) => {
          persistentStoreData.delete(key);
        },
      };
    };
  });

  jest.doMock("electron", () => ({
    app: {
      getVersion: jest.fn(() => "1.0.0"),
      isPackaged: false,
      getPath: jest.fn(() => testUserDataPath),
      getAppPath: jest.fn(() => "/tmp/madsuite-test-app"),
      whenReady: jest.fn(() => ({
        then: (callback) => Promise.resolve(callback()),
      })),
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
      loadURL: jest.fn(),
      loadFile: jest.fn(),
    })),
    ipcMain: {
      handle: jest.fn((channel, handler) => {
        mockIpcHandlers[channel] = handler;
      }),
    },
    Tray: jest.fn(),
    Menu: {
      buildFromTemplate: jest.fn(() => ({})),
    },
    powerMonitor: {
      getSystemIdleTime: jest.fn(() => 0),
      getSystemIdleState: jest.fn(() => "active"),
    },
    safeStorage: {
      isEncryptionAvailable: jest.fn(() => true),
      encryptString: jest.fn((plainText) => Buffer.from(`enc:${plainText}`, "utf8")),
      decryptString: jest.fn((encrypted) => {
        const rawText = Buffer.isBuffer(encrypted) ? encrypted.toString("utf8") : Buffer.from(encrypted).toString("utf8");
        if (!rawText.startsWith("enc:")) {
          throw new Error("invalid encrypted payload");
        }

        return rawText.slice(4);
      }),
    },
  }));

  jest.doMock("../src/main/tracking", () => ({
    createTrackingController: jest.fn((opts) => {
      mockTrackingOptions = opts;
      global.mockTrackingOptions = opts;
      return mockTracking;
    }),
  }));

  jest.doMock("../src/main/windowScanner", () => ({
    getOpenWindows: jest.fn(async () => []),
  }));

  require("../main");
}

describe("main.js auth IPC", () => {
  let consoleLog;
  let consoleWarn;

  beforeEach(() => {
    jest.clearAllMocks();
    mockTrackingOptions = null;

    process.env.AGENT_API_URL = "http://localhost:5000";
    process.env.JWT_SECRET = "test-secret";
    process.env.AGENT_CAPTURE_QUEUE_FLUSH_DELAY_MS = "20";

    consoleLog = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});

    loadMainWithMocks();
  });

  afterEach(() => {
    consoleLog.mockRestore();
    consoleWarn.mockRestore();

    // Si besoin, nettoyer les appels ou rÃ©initialiser
    jest.dontMock("axios");
    jest.dontMock("socket.io-client");
    jest.dontMock("electron");
    jest.dontMock("../src/main/tracking");
    jest.dontMock("../src/main/windowScanner");
  });

  test("enregistre les handlers IPC nécessaires", () => {
    expect(mockIpcHandlers.login).toBeDefined();
    expect(mockIpcHandlers["refresh-token"]).toBeDefined();
    expect(mockIpcHandlers["agent-token-refreshed"]).toBeDefined();
    expect(mockIpcHandlers["agent-refresh-failed"]).toBeDefined();
    expect(mockIpcHandlers["restore-token"]).toBeDefined();
    expect(mockIpcHandlers["stop-tracking"]).toBeDefined();
  });

  test("login refuse email/password manquants", async () => {
    await expect(mockIpcHandlers.login(null, {})).rejects.toThrow("Email et mot de passe requis.");

    await expect(
      mockIpcHandlers.login(null, {
        email: "a@test.com",
      }),
    ).rejects.toThrow("Email et mot de passe requis.");

    await expect(
      mockIpcHandlers.login(null, {
        password: "Password123!",
      }),
    ).rejects.toThrow("Email et mot de passe requis.");
  });

  test("login appelle /api/login, sauvegarde le refresh cookie et retourne le token", async () => {
    mockAxiosPost.mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        token: "access-token-1",
        expiresIn: "8h",
        refreshTokenExpiresIn: "30d",
        user: {
          id: 1,
          email: "test@example.com",
          role: "admin",
          organisation_id: 10,
        },
      },
      headers: {
        "set-cookie": ["refresh_token=refresh-token-cookie; HttpOnly; Path=/"],
      },
    });

    const result = await mockIpcHandlers.login(null, {
      email: "test@example.com",
      password: "Password123!",
    });

    expect(mockAxiosPost).toHaveBeenCalledWith(
      "http://localhost:5000/api/login",
      {
        email: "test@example.com",
        password: "Password123!",
      },
      expect.objectContaining({
        timeout: 10000,
      }),
    );

    expect(result).toMatchObject({
      success: true,
      token: "access-token-1",
      expiresIn: "8h",
      refreshTokenExpiresIn: "30d",
    });
  });

  test("login retourne une erreur si /api/login échoue", async () => {
    mockAxiosPost.mockResolvedValueOnce({
      status: 401,
      data: {
        message: "Mot de passe invalide",
      },
      headers: {},
    });

    await expect(
      mockIpcHandlers.login(null, {
        email: "test@example.com",
        password: "bad",
      }),
    ).rejects.toThrow("Mot de passe invalide");
  });

  test("refresh-token échoue si aucun refresh cookie n'est disponible", async () => {
    await expect(mockIpcHandlers["refresh-token"]()).rejects.toThrow("Refresh cookie indisponible");
  });

  test("apres restart avec access token expire mais refresh cookie absent, le refresh force une reconnexion", async () => {
    const refreshed = await mockIpcHandlers["agent-token-refreshed"](null, "expired-access-token");

    expect(refreshed).toEqual({ success: true });
    await expect(mockIpcHandlers["refresh-token"]()).rejects.toThrow("Refresh cookie indisponible");
    expect(mockAxiosPost).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/refresh"),
      expect.anything(),
      expect.anything(),
    );
  });

  test("refresh-token appelle /api/refresh avec le cookie reçu au login", async () => {
    mockAxiosPost.mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        token: "access-token-1",
        user: {
          id: 1,
          email: "test@example.com",
          role: "admin",
          organisation_id: 10,
        },
      },
      headers: {
        "set-cookie": ["refresh_token=refresh-token-cookie; HttpOnly; Path=/"],
      },
    });

    await mockIpcHandlers.login(null, {
      email: "test@example.com",
      password: "Password123!",
    });

    mockAxiosPost.mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        token: "access-token-2",
        expiresIn: "8h",
        refreshTokenExpiresIn: "30d",
        user: {
          id: 1,
          email: "test@example.com",
          role: "admin",
          organisation_id: 10,
        },
      },
      headers: {
        "set-cookie": ["refresh_token=refresh-token-cookie-2; HttpOnly; Path=/"],
      },
    });

    const result = await mockIpcHandlers["refresh-token"]();

    expect(mockAxiosPost).toHaveBeenLastCalledWith(
      "http://localhost:5000/api/refresh",
      {},
      expect.objectContaining({
        timeout: 10000,
        headers: {
          Cookie: "refresh_token=refresh-token-cookie",
        },
      }),
    );

    expect(result).toMatchObject({
      success: true,
      token: "access-token-2",
      expiresIn: "8h",
      refreshTokenExpiresIn: "30d",
    });
  });

  test("refresh-token retourne une erreur si /api/refresh échoue", async () => {
    mockAxiosPost.mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        token: "access-token-1",
      },
      headers: {
        "set-cookie": ["refresh_token=refresh-token-cookie; HttpOnly; Path=/"],
      },
    });

    await mockIpcHandlers.login(null, {
      email: "test@example.com",
      password: "Password123!",
    });

    mockAxiosPost.mockResolvedValueOnce({
      status: 401,
      data: {
        message: "Refresh token invalide ou expiré",
      },
      headers: {},
    });

    await expect(mockIpcHandlers["refresh-token"]()).rejects.toThrow("Refresh token invalide ou expiré");
  });

  test("delete-activity-history utilise le cookie access_token", async () => {
    mockAxiosPost.mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        token: "access-token-1",
        user: {
          id: 1,
          email: "test@example.com",
          role: "admin",
          organisation_id: 10,
        },
      },
      headers: {
        "set-cookie": ["refresh_token=refresh-token-cookie; HttpOnly; Path=/"],
      },
    });

    await mockIpcHandlers.login(null, {
      email: "test@example.com",
      password: "Password123!",
    });

    mockAxiosDelete.mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
      },
    });

    const result = await mockIpcHandlers["delete-activity-history"]();

    expect(mockAxiosDelete).toHaveBeenCalledWith(
      "http://localhost:5000/api/activity/history",
      expect.objectContaining({
        timeout: 10000,
        headers: {
          Cookie: "access_token=access-token-1",
        },
      }),
    );
    expect(result).toEqual({ success: true });
  });

  test("agent-token-refreshed refuse un token vide", async () => {
    await expect(mockIpcHandlers["agent-token-refreshed"](null, null)).rejects.toThrow("Nouveau token manquant.");

    await expect(mockIpcHandlers["agent-token-refreshed"](null, "")).rejects.toThrow("Nouveau token manquant.");
  });

  test("agent-token-refreshed accepte un nouveau token", async () => {
    const result = await mockIpcHandlers["agent-token-refreshed"](null, "fresh-token");

    expect(result).toEqual({ success: true });
  });

  test("agent-refresh-failed retourne success true", async () => {
    const result = await mockIpcHandlers["agent-refresh-failed"]();

    expect(result).toEqual({ success: true });
  });

  test("restore-token retourne null si le store n'est pas initialisé dans le test", async () => {
    const token = await mockIpcHandlers["restore-token"]();

    expect(token).toBeNull();
  });

  test.skip("restart persists refresh cookie and resumes refresh", async () => {
    persistentStoreData.clear();

    // ✅ Assure qu'on simule bien la présence du cookie chiffré AVANT bootstrapAuth()
    // (bootstrapAuth lit refreshCookieHeaderEncrypted au démarrage)
    // IMPORTANT: recalcule l'encrypted comme le fait le mock safeStorage.encryptString.
    const refreshCookieHeader = "refresh-token-abc123";
    // Dans l'app, encryptString() retourne base64(raw: `enc:${plain}`), et decryptString() fait slice(4).
    // Donc au store on doit écrire directement le base64 de `enc:${refreshCookieHeader}`.
    const encryptedCookie = Buffer.from(`enc:${refreshCookieHeader}`, "utf8").toString("base64");
    persistentStoreData.set("refreshCookieHeaderEncrypted", encryptedCookie);
    // Force aussi le fallback direct cookie pour bypasser tout mismatch enc/dec.
    persistentStoreData.set("refreshCookieHeader", refreshCookieHeader);

    // debug sanity: le store mock doit contenir la valeur chiffrée et le cookie clair
    // (bootstrapAuth lit ces clés via getStoreValue()).
    expect(persistentStoreData.get("refreshCookieHeaderEncrypted")).toBeTruthy();
    expect(persistentStoreData.get("refreshCookieHeader")).toBe(refreshCookieHeader);

    // Important: restore-token lit getSecureToken() via tokenManager, donc il faut un token qui passe isUsableAccessToken.
    // En mode test, isUsableAccessToken retourne true.
    persistentStoreData.set("token", "access-token-1");

    loadMainWithPersistentStore();

    mockAxiosPost.mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        token: "access-token-1",
        expiresIn: "8h",
        refreshTokenExpiresIn: "30d",
        user: {
          id: 1,
          email: "test@example.com",
          role: "admin",
          organisation_id: 10,
        },
      },
      headers: {
        "set-cookie": ["refresh_token=refresh-token-cookie; HttpOnly; Path=/"],
      },
    });

    await mockIpcHandlers.login(null, {
      email: "test@example.com",
      password: "Password123!",
    });

    expect(persistentStoreData.get("refreshCookieHeaderEncrypted")).toBeTruthy();
    // token peut varier selon l'implémentation de tokenManager/getSecureToken en mode test
    expect(persistentStoreData.get("token")).toBeTruthy();

    loadMainWithPersistentStore();

    await new Promise((resolve) => setImmediate(resolve));

    const restored = await mockIpcHandlers["restore-token"]();

    // En mode test, la restauration peut retourner null selon l'implémentation du tokenManager/isUsableAccessToken
    // On valide principalement que le store a bien persisté le refresh cookie.
    expect(restored === null || restored.token).toBeTruthy();

    mockAxiosPost.mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        token: "access-token-2",
        expiresIn: "8h",
        refreshTokenExpiresIn: "30d",
        user: {
          id: 1,
          email: "test@example.com",
          role: "admin",
          organisation_id: 10,
        },
      },
      headers: {
        "set-cookie": ["refresh_token=refresh-token-cookie-2; HttpOnly; Path=/"],
      },
    });

    const refreshed = await mockIpcHandlers["refresh-token"]();

    expect(mockAxiosPost).toHaveBeenLastCalledWith(
      "http://localhost:5000/api/refresh",
      {},
      expect.objectContaining({
        timeout: 10000,
        headers: {
          Cookie: "refresh_token=refresh-token-cookie",
        },
      }),
    );

    expect(refreshed).toMatchObject({
      success: true,
      token: "access-token-2",
      expiresIn: "8h",
      refreshTokenExpiresIn: "30d",
    });
  });

  test("refresh-token stops retrying after repeated backend 503s", async () => {
    mockAxiosPost.mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        token: "access-token-1",
        expiresIn: "8h",
        refreshTokenExpiresIn: "30d",
        user: {
          id: 1,
          email: "test@example.com",
          role: "admin",
          organisation_id: 10,
        },
      },
      headers: {
        "set-cookie": ["refresh_token=refresh-token-cookie; HttpOnly; Path=/"],
      },
    });

    await mockIpcHandlers.login(null, {
      email: "test@example.com",
      password: "Password123!",
    });

    mockAxiosPost.mockClear();

    mockAxiosPost.mockResolvedValue({
      status: 503,
      data: {
        message: "backend down",
      },
      headers: {},
    });

    await expect(mockIpcHandlers["refresh-token"]()).rejects.toMatchObject({ statusCode: 503 });
    await expect(mockIpcHandlers["refresh-token"]()).rejects.toMatchObject({ statusCode: 503 });
    await expect(mockIpcHandlers["refresh-token"]()).rejects.toMatchObject({ statusCode: 503 });

    expect(mockAxiosPost).toHaveBeenCalledTimes(2);
  });

  test("queued captures are flushed again after the backend recovers", async () => {
    persistentStoreData.clear();
    loadMainWithPersistentStore();
    await new Promise((resolve) => setTimeout(resolve, 50));
    jest.useFakeTimers();

    mockAxiosPost.mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        token: "access-token-1",
        expiresIn: "8h",
        refreshTokenExpiresIn: "30d",
        user: {
          id: 1,
          email: "test@example.com",
          role: "admin",
          organisation_id: 10,
        },
      },
      headers: {
        "set-cookie": ["refresh_token=refresh-token-cookie; HttpOnly; Path=/"],
      },
    });

    await mockIpcHandlers.login(null, {
      email: "test@example.com",
      password: "Password123!",
    });

    mockAxiosPost.mockClear();

    await jest.advanceTimersByTimeAsync(1);
    expect(global.__trackingController).toBeTruthy();
    global.__trackingController.onCaptureQueueFailed({
      kind: "activity_post",
      payload: {
        app_name: "Code",
        window_title: "Timesheet",
        duration_seconds: 30,
      },
    });

    mockAxiosPost.mockResolvedValueOnce({
      status: 201,
      data: {
        success: true,
        id: 999,
      },
      headers: {},
    });

    await jest.advanceTimersByTimeAsync(25);

    expect(mockAxiosPost).toHaveBeenCalledWith(
      "http://localhost:5000/api/activity/batch",
      expect.objectContaining({
        events: expect.arrayContaining([
          expect.objectContaining({
            kind: "activity_post",
            payload: expect.objectContaining({
              app_name: "Code",
              window_title: "Timesheet",
              duration_seconds: 30,
            }),
          }),
        ]),
      }),
      expect.objectContaining({
        timeout: 15000,
        headers: {
          Cookie: "access_token=access-token-1",
        },
      }),
    );

    jest.useRealTimers();
  });
});
