const jwt = require("jsonwebtoken");
const {
  deriveCaptureQueueScope,
  bindCaptureEntryToScope,
  partitionCaptureEntriesByScope,
} = require("../captureQueueScope");

function makeToken(payload) {
  return jwt.sign(payload, "test-secret");
}

describe("scope de session de la file de captures", () => {
  test("dérive un scope stable sans exposer les identifiants bruts", () => {
    const token = makeToken({ sub: "user-7", organisation_id: "org-42" });
    const scope = deriveCaptureQueueScope(token);

    expect(scope).toMatch(/^[a-f0-9]{64}$/);
    expect(scope).not.toContain("user-7");
    expect(scope).not.toContain("org-42");
    expect(deriveCaptureQueueScope(token)).toBe(scope);
  });

  test("sépare deux organisations même pour le même utilisateur", () => {
    const scopeA = deriveCaptureQueueScope(makeToken({ sub: "user-7", organisation_id: "org-a" }));
    const scopeB = deriveCaptureQueueScope(makeToken({ sub: "user-7", organisation_id: "org-b" }));

    expect(scopeA).not.toBe(scopeB);
  });

  test("refuse les tokens sans identité complète", () => {
    expect(deriveCaptureQueueScope(null)).toBeNull();
    expect(deriveCaptureQueueScope("opaque-token")).toBeNull();
    expect(deriveCaptureQueueScope(makeToken({ sub: "user-7" }))).toBeNull();
    expect(deriveCaptureQueueScope(makeToken({ organisation_id: "org-42" }))).toBeNull();
  });

  test("lie explicitement une capture à son scope", () => {
    const scope = deriveCaptureQueueScope(makeToken({ sub: "user-7", organisation_id: "org-42" }));
    const entry = bindCaptureEntryToScope({ id: "capture-1", payload: { app: "Code" } }, scope);

    expect(entry).toEqual({
      id: "capture-1",
      payload: { app: "Code" },
      sessionScope: scope,
    });
  });

  test("ne rend éligibles que les captures de la session active", () => {
    const scopeA = deriveCaptureQueueScope(makeToken({ sub: "user-a", organisation_id: "org-a" }));
    const scopeB = deriveCaptureQueueScope(makeToken({ sub: "user-b", organisation_id: "org-b" }));
    const entryA = bindCaptureEntryToScope({ id: "a" }, scopeA);
    const entryB = bindCaptureEntryToScope({ id: "b" }, scopeB);
    const legacy = { id: "legacy" };

    const partition = partitionCaptureEntriesByScope([entryA, entryB, legacy], scopeA);

    expect(partition.eligible).toEqual([entryA]);
    expect(partition.retained).toEqual([entryB]);
    expect(partition.rejectedLegacy).toEqual([legacy]);
  });

  test("échoue fermé lorsqu’aucun scope actif n’est disponible", () => {
    const scope = deriveCaptureQueueScope(makeToken({ sub: "user-a", organisation_id: "org-a" }));
    const entry = bindCaptureEntryToScope({ id: "a" }, scope);

    expect(partitionCaptureEntriesByScope([entry], null)).toEqual({
      eligible: [],
      retained: [entry],
      rejectedLegacy: [],
    });
  });
});
