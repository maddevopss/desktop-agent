/**
 * Couverture du Spotlight TDAH (Phase 10).
 *
 * Ce qui est teste ici correspond aux deux risques reels de la fonctionnalite :
 *   1. une idee perdue (echec reseau, file saturee, rejeu en doublon) ;
 *   2. un raccourci global laisse reserve au niveau systeme apres la fermeture.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

// ============================================================
// File offline : routage du nouveau kind et protection a l'eviction
// ============================================================

describe("captureQueue — captures de decharge mentale", () => {
  let tmpDir;
  let mockAxios;
  let createCaptureQueue;
  let CAPTURE_KIND_BRAIN_DUMP;

  const silentLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

  function buildQueue() {
    return createCaptureQueue({
      apiUrl: "https://api.test",
      app: { getPath: () => tmpDir },
      getCurrentToken: () => "token-valide",
      isUsableAccessToken: () => true,
      logger: silentLogger,
      isQuitting: () => false,
    });
  }

  beforeEach(() => {
    jest.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "madsuite-queue-"));

    mockAxios = { post: jest.fn(), patch: jest.fn() };
    jest.doMock("axios", () => mockAxios);

    ({ createCaptureQueue, CAPTURE_KIND_BRAIN_DUMP } = require("../src/main/captureQueue"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("envoie la capture sur /api/brain-dump-captures avec une cle d'idempotence", async () => {
    mockAxios.post.mockResolvedValue({ status: 201 });
    const queue = buildQueue();

    queue.pushCaptureForLater(CAPTURE_KIND_BRAIN_DUMP, { raw_text: "payer l'hydro", source: "spotlight" });
    const result = await queue.flushCaptureQueueIfPossible();
    queue.stop();

    expect(result.flushed).toBe(1);
    expect(mockAxios.post).toHaveBeenCalledTimes(1);

    const [url, body] = mockAxios.post.mock.calls[0];
    expect(url).toBe("https://api.test/api/brain-dump-captures");
    expect(body.raw_text).toBe("payer l'hydro");
    expect(body.source).toBe("spotlight");
    // Sans cette cle, un timeout apres un INSERT reussi dupliquerait l'idee a chaque rejeu.
    expect(typeof body.client_capture_id).toBe("string");
    expect(body.client_capture_id.length).toBeGreaterThan(0);
  });

  test("conserve la meme cle d'idempotence d'un rejeu a l'autre", async () => {
    mockAxios.post.mockRejectedValueOnce(new Error("ETIMEDOUT")).mockResolvedValueOnce({ status: 200 });
    const queue = buildQueue();

    queue.pushCaptureForLater(CAPTURE_KIND_BRAIN_DUMP, { raw_text: "rappeler le comptable" });
    await queue.flushCaptureQueueIfPossible();
    await queue.flushCaptureQueueIfPossible();
    queue.stop();

    expect(mockAxios.post).toHaveBeenCalledTimes(2);
    expect(mockAxios.post.mock.calls[0][1].client_capture_id).toBe(mockAxios.post.mock.calls[1][1].client_capture_id);
  });

  test("garde l'idee en file quand le backend refuse la capture", async () => {
    mockAxios.post.mockResolvedValue({ status: 500 });
    const queue = buildQueue();

    queue.pushCaptureForLater(CAPTURE_KIND_BRAIN_DUMP, { raw_text: "idee fragile" });
    const result = await queue.flushCaptureQueueIfPossible();
    queue.stop();

    expect(result.flushed).toBe(0);
    expect(queue.getCaptureQueueSummary().cachedCaptures).toBe(1);
  });

  test("sacrifie les captures d'activite avant les idees quand la file sature", () => {
    process.env.AGENT_CAPTURE_QUEUE_MAX_ITEMS = "3";
    jest.resetModules();
    jest.doMock("axios", () => mockAxios);
    ({ createCaptureQueue, CAPTURE_KIND_BRAIN_DUMP } = require("../src/main/captureQueue"));

    const queue = buildQueue();

    queue.pushCaptureForLater(CAPTURE_KIND_BRAIN_DUMP, { raw_text: "idee a preserver" });
    // Une capture d'activite est re-echantillonnee en continu : elle est remplacable.
    for (let i = 0; i < 5; i += 1) {
      queue.pushCaptureForLater("activity_post", { app_name: `app-${i}` });
    }

    const persisted = JSON.parse(fs.readFileSync(path.join(tmpDir, "diagnostics", "capture-queue.json"), "utf8"));
    queue.stop();
    delete process.env.AGENT_CAPTURE_QUEUE_MAX_ITEMS;

    expect(persisted.items).toHaveLength(3);
    const kept = persisted.items.filter((it) => it.kind === CAPTURE_KIND_BRAIN_DUMP);
    expect(kept).toHaveLength(1);
    expect(kept[0].payload.raw_text).toBe("idee a preserver");
  });
});

// ============================================================
// main.js : IPC de capture et liberation du raccourci global
// ============================================================

describe("main — Spotlight", () => {
  const ipcHandlers = {};
  const appHandlers = {};
  let mockAxiosPost;
  let mockGlobalShortcut;
  let mockQueuePush;

  function loadMain() {
    jest.resetModules();
    for (const key of Object.keys(ipcHandlers)) delete ipcHandlers[key];
    for (const key of Object.keys(appHandlers)) delete appHandlers[key];

    mockAxiosPost = jest.fn();
    mockQueuePush = jest.fn(() => true);
    mockGlobalShortcut = {
      register: jest.fn(() => true),
      unregisterAll: jest.fn(),
    };

    jest.doMock("axios", () => ({ post: mockAxiosPost, delete: jest.fn() }));

    jest.doMock("electron", () => ({
      app: {
        isPackaged: false,
        getPath: jest.fn(() => "/tmp/chronomad-test"),
        getAppPath: jest.fn(() => "/tmp/chronomad-test-app"),
        whenReady: jest.fn(() => ({ then: jest.fn() })),
        on: jest.fn((event, handler) => {
          appHandlers[event] = handler;
        }),
        quit: jest.fn(),
      },
      BrowserWindow: jest.fn(),
      ipcMain: {
        handle: jest.fn((channel, handler) => {
          ipcHandlers[channel] = handler;
        }),
      },
      Tray: jest.fn(),
      Menu: { buildFromTemplate: jest.fn(() => ({})) },
      powerMonitor: {
        getSystemIdleTime: jest.fn(() => 0),
        getSystemIdleState: jest.fn(() => "active"),
      },
      globalShortcut: mockGlobalShortcut,
    }));

    jest.doMock("../src/main/captureQueue", () => ({
      CAPTURE_KIND_BRAIN_DUMP: "brain_dump_capture",
      createCaptureQueue: jest.fn(() => ({
        pushCaptureForLater: mockQueuePush,
        flushCaptureQueueIfPossible: jest.fn(async () => ({ flushed: 0 })),
        getCaptureQueueSummary: jest.fn(() => ({ cachedCaptures: 0 })),
        stop: jest.fn(),
      })),
    }));

    jest.doMock("../src/main/tracking", () => ({
      createTrackingController: jest.fn(() => ({
        isTracking: () => false,
        startTracking: jest.fn(),
        stopTracking: jest.fn(),
      })),
    }));

    jest.doMock("../src/main/windowScanner", () => ({
      getOpenWindows: jest.fn(async () => []),
    }));

    require("../main");
  }

  beforeEach(() => {
    loadMain();
  });

  test("expose les canaux du Spotlight", () => {
    expect(typeof ipcHandlers["capture-idea"]).toBe("function");
    expect(typeof ipcHandlers["close-spotlight"]).toBe("function");
  });

  test("met l'idee en file quand aucun token utilisable n'est disponible", async () => {
    const result = await ipcHandlers["capture-idea"](null, "penser a payer l'hydro");

    // Pas de token en environnement de test : la capture ne doit pas etre perdue pour autant.
    expect(result).toEqual({ ok: true, queued: true });
    expect(mockQueuePush).toHaveBeenCalledWith("brain_dump_capture", {
      raw_text: "penser a payer l'hydro",
      source: "spotlight",
    });
    expect(mockAxiosPost).not.toHaveBeenCalled();
  });

  test("ignore une saisie vide sans rien envoyer ni mettre en file", async () => {
    const result = await ipcHandlers["capture-idea"](null, "   ");

    expect(result).toEqual({ ok: false, queued: false });
    expect(mockQueuePush).not.toHaveBeenCalled();
    expect(mockAxiosPost).not.toHaveBeenCalled();
  });

  test("libere le raccourci global a la fermeture", () => {
    expect(typeof appHandlers["before-quit"]).toBe("function");

    appHandlers["before-quit"]();

    // Un accelerateur non libere reste reserve au niveau systeme apres la sortie.
    expect(mockGlobalShortcut.unregisterAll).toHaveBeenCalled();
  });
});
