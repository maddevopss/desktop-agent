jest.mock("../captureQueue", () => ({
  createCaptureQueue: jest.fn(({ app }) => ({
    pushCaptureForLater: jest.fn(() => true),
    flushCaptureQueueIfPossible: jest.fn(async () => ({ flushed: 1 })),
    getCaptureQueueSummary: jest.fn(() => ({ cachedCaptures: 1, queuePath: app.getPath("userData") })),
    stop: jest.fn(),
  })),
}));

const jwt = require("jsonwebtoken");
const { createCaptureQueue } = require("../captureQueue");
const { createScopedCaptureQueue } = require("../scopedCaptureQueue");

function token(user, organisation) {
  return jwt.sign({ sub: user, organisation_id: organisation }, "test-secret");
}

describe("adaptateur de file scoppée", () => {
  test("crée une file physique différente par session", async () => {
    let currentToken = token("u1", "org-a");
    const queue = createScopedCaptureQueue({
      app: { getPath: () => "/tmp/madsuite" },
      getCurrentToken: () => currentToken,
      logger: { warn: jest.fn() },
    });

    expect(queue.pushCaptureForLater("activity", { title: "A" })).toBe(true);
    const summaryA = queue.getCaptureQueueSummary();

    currentToken = token("u1", "org-b");
    expect(queue.pushCaptureForLater("activity", { title: "B" })).toBe(true);
    const summaryB = queue.getCaptureQueueSummary();

    expect(summaryA.queuePath).not.toBe(summaryB.queuePath);
    expect(summaryA.queuePath).toContain("capture-scopes");
    expect(summaryB.queuePath).toContain("capture-scopes");
    expect(queue.getKnownScopeCount()).toBe(2);
    expect(createCaptureQueue).toHaveBeenCalledTimes(2);
  });

  test("échoue fermé sans identité de session exploitable", async () => {
    const logger = { warn: jest.fn() };
    const queue = createScopedCaptureQueue({
      app: { getPath: () => "/tmp/madsuite" },
      getCurrentToken: () => null,
      logger,
    });

    expect(queue.pushCaptureForLater("activity", {})).toBe(false);
    await expect(queue.flushCaptureQueueIfPossible()).resolves.toEqual({ flushed: 0 });
    expect(queue.getCaptureQueueSummary()).toEqual({ cachedCaptures: 0, queuePath: null, scoped: false });
    expect(createCaptureQueue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  test("arrête toutes les files connues", () => {
    let currentToken = token("u1", "org-a");
    const queue = createScopedCaptureQueue({
      app: { getPath: () => "/tmp/madsuite" },
      getCurrentToken: () => currentToken,
      logger: { warn: jest.fn() },
    });

    queue.pushCaptureForLater("activity", {});
    currentToken = token("u2", "org-b");
    queue.pushCaptureForLater("activity", {});
    queue.stop();

    const instances = createCaptureQueue.mock.results.map((result) => result.value);
    for (const instance of instances) expect(instance.stop).toHaveBeenCalledTimes(1);
    expect(queue.getKnownScopeCount()).toBe(0);
  });
});
