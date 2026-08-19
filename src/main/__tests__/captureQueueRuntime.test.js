jest.useFakeTimers();

jest.mock("../scopedCaptureQueue", () => ({
  createScopedCaptureQueue: jest.fn(() => ({
    pushCaptureForLater: jest.fn(() => true),
    flushCaptureQueueIfPossible: jest.fn(async () => ({ flushed: 0, remaining: 1 })),
    getCaptureQueueSummary: jest.fn(() => ({ cachedCaptures: 1, scoped: true })),
    stop: jest.fn(),
  })),
}));

const { createScopedCaptureQueue } = require("../scopedCaptureQueue");
const { createCaptureQueueRuntime } = require("../captureQueueRuntime");

describe("coordinateur runtime de la file", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  test("utilise toujours la file scoppée", () => {
    createCaptureQueueRuntime({ logger: { warn: jest.fn() } });
    expect(createScopedCaptureQueue).toHaveBeenCalledTimes(1);
  });

  test("planifie un retry borné", () => {
    const runtime = createCaptureQueueRuntime({ logger: { warn: jest.fn() } });
    expect(runtime.scheduleRetry("test")).toBe(true);
    expect(runtime.getRetryState().attempt).toBe(1);
    expect(jest.getTimerCount()).toBe(1);
  });

  test("arrête le timer et les files", () => {
    const runtime = createCaptureQueueRuntime({ logger: { warn: jest.fn() } });
    runtime.scheduleRetry("test");
    const scoped = createScopedCaptureQueue.mock.results[0].value;
    runtime.stop();
    expect(jest.getTimerCount()).toBe(0);
    expect(scoped.stop).toHaveBeenCalledTimes(1);
  });
});
