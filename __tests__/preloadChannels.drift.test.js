/**
 * Garde-fou anti-derive des allowlists de canaux IPC.
 *
 * Les preloads tournent avec sandbox: true et ne peuvent donc pas importer
 * src/shared/ipcChannels.js : leurs allowlists y sont recopiees. Ce module reste la
 * reference, et ce test echoue des que les copies divergent — sinon un canal ajoute
 * cote main process resterait injoignable depuis le renderer, ou l'inverse.
 *
 * Ce fichier de test tourne en Node, pas dans un preload sandboxe : il peut charger
 * les deux cotes et les comparer.
 */

jest.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: jest.fn() },
  ipcRenderer: { invoke: jest.fn(), on: jest.fn(), removeListener: jest.fn() },
}));

const shared = require("../src/shared/ipcChannels");

function sorted(channels) {
  return [...channels].sort();
}

describe("allowlists IPC — preload.js vs src/shared/ipcChannels.js", () => {
  let preload;

  beforeEach(() => {
    jest.resetModules();
    preload = require("../preload");
  });

  test("les canaux invoke sont identiques", () => {
    expect(sorted(preload.INVOKE_CHANNELS)).toEqual(sorted(shared.INVOKE_CHANNELS));
  });

  test("les canaux subscribe sont identiques", () => {
    expect(sorted(preload.SUBSCRIBE_CHANNELS)).toEqual(sorted(shared.SUBSCRIBE_CHANNELS));
  });

  test("le preload refuse un canal absent de l'allowlist", () => {
    expect(() => preload.invoke("canal-inexistant")).toThrow(/interdit/);
    expect(() => preload.subscribe("canal-inexistant", () => {})).toThrow(/interdit/);
  });

  test("le preload accepte tous les canaux declares dans la reference", () => {
    for (const channel of shared.INVOKE_CHANNELS) {
      expect(() => preload.invoke(channel)).not.toThrow();
    }
    for (const channel of shared.SUBSCRIBE_CHANNELS) {
      expect(() => preload.subscribe(channel, () => {})).not.toThrow();
    }
  });
});

describe("allowlist IPC — widget Brain Dump", () => {
  test("ses canaux sont un sous-ensemble de la reference", () => {
    jest.resetModules();
    const { ALLOWED_CHANNELS } = require("../src/widgets/brainDumpPreload");

    expect(ALLOWED_CHANNELS.size).toBeGreaterThan(0);
    for (const channel of ALLOWED_CHANNELS) {
      expect(shared.INVOKE_CHANNELS).toContain(channel);
    }
  });

  test("le widget n'expose rien d'autre que la capture et la fermeture", () => {
    jest.resetModules();
    const { ALLOWED_CHANNELS } = require("../src/widgets/brainDumpPreload");

    // Une fenetre sans cadre declenchable par raccourci global ne doit pas pouvoir
    // atteindre login, delete-activity-history ou export-diagnostics.
    expect(sorted(ALLOWED_CHANNELS)).toEqual(["hide-brain-dump-widget", "send-brain-dump"]);
  });
});
