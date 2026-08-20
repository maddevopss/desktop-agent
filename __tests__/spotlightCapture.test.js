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

  test("notifie une seule fois l'expiration de session apres un 401 du batch", async () => {
    const onAuthExpired = jest.fn();
    mockAxios.post.mockResolvedValue({ status: 401, data: { message: "expired" } });
    const queue = createCaptureQueue({
      apiUrl: "https://api.test",
      app: { getPath: () => tmpDir },
      getCurrentToken: () => "token-valide",
      isUsableAccessToken: () => true,
      logger: silentLogger,
      isQuitting: () => false,
      onAuthExpired,
    });

    queue.pushCaptureForLater("activity_post", { app_name: "Code" });
    await queue.flushCaptureQueueIfPossible();
    await queue.flushCaptureQueueIfPossible();
    queue.stop();

    expect(onAuthExpired).toHaveBeenCalledTimes(1);
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
// Contrat IPC et cycle de vie du raccourci global
// ============================================================

describe("Spotlight contracts", () => {
  test("expose seulement les canaux Spotlight autorises", () => {
    const { INVOKE_CHANNELS } = require("../src/shared/ipcChannels");

    expect(INVOKE_CHANNELS).toContain("send-brain-dump");
    expect(INVOKE_CHANNELS).toContain("hide-brain-dump-widget");
    expect(INVOKE_CHANNELS).not.toContain("capture-idea");
    expect(INVOKE_CHANNELS).not.toContain("close-spotlight");
  });

  test("enregistre et libere le raccourci global lors de l'arret", () => {
    jest.resetModules();

    const appHandlers = {};
    const globalShortcut = {
      register: jest.fn(() => true),
      unregisterAll: jest.fn(),
    };

    jest.doMock("electron", () => ({
      app: {
        on: jest.fn((event, handler) => {
          appHandlers[event] = handler;
        }),
        setAsDefaultProtocolClient: jest.fn(),
      },
      globalShortcut,
      powerMonitor: { on: jest.fn() },
    }));

    const {
      BRAIN_DUMP_SHORTCUTS,
      setupLifecycleEvents,
    } = require("../src/main/appLifecycle");

    setupLifecycleEvents({
      trackingCallbacks: { startTracking: jest.fn(), stopTracking: jest.fn() },
      widgetCallbacks: { toggleBrainDumpWidget: jest.fn() },
      handleProtocolUrl: jest.fn(),
    });

    expect(globalShortcut.register).toHaveBeenCalledWith(
      BRAIN_DUMP_SHORTCUTS[0],
      expect.any(Function),
    );
    expect(typeof appHandlers["will-quit"]).toBe("function");

    appHandlers["will-quit"]();

    expect(globalShortcut.unregisterAll).toHaveBeenCalledTimes(1);
  });
});
