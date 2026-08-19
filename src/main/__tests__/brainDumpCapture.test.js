/**
 * Fiabilite de la capture Brain Dump (raccourci global).
 *
 * Ce qui est couvert correspond aux echecs qui font disparaitre une idee sans trace :
 * mauvais endpoint, session expiree, backend injoignable, file saturee, rejeu en doublon.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const silentLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

// La file chiffre son fichier via safeStorage : on le desactive pour pouvoir relire le JSON.
const electronMock = {
  safeStorage: { isEncryptionAvailable: () => false },
  powerMonitor: { getSystemIdleTime: () => 0 },
  Notification: { isSupported: () => false },
};

describe("captureQueue — idees de decharge mentale", () => {
  let tmpDir;
  let mockAxios;
  let createCaptureQueue;
  let CAPTURE_KIND_BRAIN_DUMP;

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

  function readPersisted() {
    return JSON.parse(fs.readFileSync(path.join(tmpDir, "diagnostics", "capture-queue.json"), "utf8"));
  }

  beforeEach(() => {
    jest.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "madsuite-bd-"));

    mockAxios = { post: jest.fn() };
    jest.doMock("axios", () => mockAxios);
    jest.doMock("electron", () => electronMock);

    ({ createCaptureQueue, CAPTURE_KIND_BRAIN_DUMP } = require("../captureQueue"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("envoie l'idee sur son propre endpoint, pas dans le batch d'activite", async () => {
    mockAxios.post.mockResolvedValue({ status: 201, data: {} });
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
  });

  test("conserve la meme cle d'idempotence d'un rejeu a l'autre", async () => {
    mockAxios.post.mockRejectedValueOnce(new Error("ETIMEDOUT")).mockResolvedValueOnce({ status: 200, data: {} });
    const queue = buildQueue();

    queue.pushCaptureForLater(CAPTURE_KIND_BRAIN_DUMP, { raw_text: "rappeler le comptable" });
    await queue.flushCaptureQueueIfPossible();
    await queue.flushCaptureQueueIfPossible();
    queue.stop();

    expect(mockAxios.post).toHaveBeenCalledTimes(2);
    expect(mockAxios.post.mock.calls[0][1].client_capture_id).toBe(mockAxios.post.mock.calls[1][1].client_capture_id);
  });

  test("garde l'idee en file quand le backend la refuse", async () => {
    mockAxios.post.mockResolvedValue({ status: 500, data: {} });
    const queue = buildQueue();

    queue.pushCaptureForLater(CAPTURE_KIND_BRAIN_DUMP, { raw_text: "idee fragile" });
    const result = await queue.flushCaptureQueueIfPossible();
    queue.stop();

    expect(result.flushed).toBe(0);
    expect(queue.getCaptureQueueSummary().cachedCaptures).toBe(1);
  });

  test("l'echec du batch d'activite n'emporte pas l'idee deja envoyee", async () => {
    mockAxios.post.mockImplementation(async (url) => {
      if (url.includes("brain-dump-captures")) return { status: 201, data: {} };
      throw new Error("backend activity down");
    });

    const queue = buildQueue();
    queue.pushCaptureForLater("activity_post", { app_name: "vscode" });
    queue.pushCaptureForLater(CAPTURE_KIND_BRAIN_DUMP, { raw_text: "idee independante" });

    const result = await queue.flushCaptureQueueIfPossible();
    queue.stop();

    // Les deux flux echouent independamment : l'idee part, l'activite est reessayee.
    expect(result.flushed).toBe(1);
    const remaining = readPersisted().items;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].kind).toBe("activity_post");
  });

  test("sacrifie les captures d'activite avant les idees quand la file sature", () => {
    process.env.AGENT_CAPTURE_QUEUE_MAX_ITEMS = "3";
    jest.resetModules();
    jest.doMock("axios", () => mockAxios);
    jest.doMock("electron", () => electronMock);
    ({ createCaptureQueue, CAPTURE_KIND_BRAIN_DUMP } = require("../captureQueue"));

    const queue = buildQueue();
    queue.pushCaptureForLater(CAPTURE_KIND_BRAIN_DUMP, { raw_text: "idee a preserver" });
    for (let i = 0; i < 5; i += 1) {
      queue.pushCaptureForLater("activity_post", { app_name: `app-${i}` });
    }

    const persisted = readPersisted();
    queue.stop();
    delete process.env.AGENT_CAPTURE_QUEUE_MAX_ITEMS;

    expect(persisted.items).toHaveLength(3);
    const kept = persisted.items.filter((it) => it.kind === CAPTURE_KIND_BRAIN_DUMP);
    expect(kept).toHaveLength(1);
    expect(kept[0].payload.raw_text).toBe("idee a preserver");
  });
});

describe("ipcHandlers — send-brain-dump", () => {
  const handlers = {};
  let mockAxios;
  let pushCaptureForLater;

  function loadHandlers({ token = "token-valide", postImpl } = {}) {
    jest.resetModules();
    for (const key of Object.keys(handlers)) delete handlers[key];

    mockAxios = { post: jest.fn(postImpl || (async () => ({ status: 201 }))), delete: jest.fn() };
    pushCaptureForLater = jest.fn(() => true);

    jest.doMock("axios", () => mockAxios);
    jest.doMock("electron", () => ({
      ipcMain: {
        handle: jest.fn((channel, handler) => {
          handlers[channel] = handler;
        }),
      },
      app: { getPath: () => "/tmp", setLoginItemSettings: jest.fn(), getLoginItemSettings: () => ({}) },
      Notification: jest.fn(),
    }));

    const { registerIpcHandlers } = require("../ipcHandlers");

    registerIpcHandlers({
      authSession: {},
      startTrackingIfNeeded: jest.fn(),
      getStoreValue: jest.fn(),
      setStoreValue: jest.fn(),
      deleteStoreValue: jest.fn(),
      getCurrentToken: () => token,
      isUsableAccessToken: (t) => Boolean(t),
      clearStoredToken: jest.fn(),
      saveAccessToken: jest.fn(),
      resetAuthExpiredState: jest.fn(),
      getTrackingInterval: jest.fn(),
      getPrivacySettings: jest.fn(() => ({})),
      restartTrackingIfActive: jest.fn(),
      finishSessionExpired: jest.fn(),
      purgeSession: jest.fn(),
      tracking: { stopTracking: jest.fn() },
      updateTrayMenu: jest.fn(),
      hubSocket: () => null,
      windowManager: { hideBrainDumpWidget: jest.fn(), getFocusWidget: () => null, getMainWindow: () => null },
      captureQueueService: { pushCaptureForLater },
      getExportDiagnosticsState: jest.fn(() => ({})),
      API_URL: "https://api.test",
      getAccessCookieHeader: () => "access_token=token-valide",
    });
  }

  test("poste sur /api/brain-dump-captures avec le payload attendu par le backend", async () => {
    loadHandlers();

    const result = await handlers["send-brain-dump"](null, "penser a payer l'hydro");

    expect(result).toEqual({ ok: true, queued: false });
    const [url, body] = mockAxios.post.mock.calls[0];
    expect(url).toBe("https://api.test/api/brain-dump-captures");
    expect(body).toEqual({ raw_text: "penser a payer l'hydro", source: "spotlight" });
  });

  test("met l'idee en file au lieu de l'abandonner quand la session est expiree", async () => {
    loadHandlers({ token: null });

    const result = await handlers["send-brain-dump"](null, "idee hors session");

    expect(result).toEqual({ ok: true, queued: true });
    expect(mockAxios.post).not.toHaveBeenCalled();
    expect(pushCaptureForLater).toHaveBeenCalledWith("brain_dump_capture", {
      raw_text: "idee hors session",
      source: "spotlight",
    });
  });

  test("met l'idee en file quand le backend repond en erreur", async () => {
    loadHandlers({ postImpl: async () => ({ status: 404 }) });

    const result = await handlers["send-brain-dump"](null, "idee sur route absente");

    expect(result).toEqual({ ok: true, queued: true });
    expect(pushCaptureForLater).toHaveBeenCalledTimes(1);
  });

  test("met l'idee en file quand le reseau tombe", async () => {
    loadHandlers({
      postImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });

    const result = await handlers["send-brain-dump"](null, "idee hors ligne");

    expect(result).toEqual({ ok: true, queued: true });
    expect(pushCaptureForLater).toHaveBeenCalledTimes(1);
  });

  test("refuse une saisie vide avant tout appel reseau", async () => {
    loadHandlers();

    await expect(handlers["send-brain-dump"](null, "   ")).rejects.toThrow();
    expect(mockAxios.post).not.toHaveBeenCalled();
    expect(pushCaptureForLater).not.toHaveBeenCalled();
  });
});
