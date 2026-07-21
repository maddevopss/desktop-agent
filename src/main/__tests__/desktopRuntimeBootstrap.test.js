jest.mock("../captureQueueRuntime", () => ({
  createCaptureQueueRuntime: jest.fn(() => ({ stop: jest.fn() })),
}));

const { EventEmitter } = require("events");
const { createDesktopRuntimeBootstrap } = require("../desktopRuntimeBootstrap");

class FakeProcess extends EventEmitter {
  exit = jest.fn();
}

describe("bootstrap runtime sécurisé", () => {
  test("enregistre un seul handler par signal et nettoie à l'arrêt", async () => {
    const processTarget = new FakeProcess();
    const activityQueue = { forceFlush: jest.fn(async () => undefined) };
    const runtime = createDesktopRuntimeBootstrap({ processTarget, activityQueue, exit: processTarget.exit });

    runtime.registerProcessSignals();
    runtime.registerProcessSignals();

    expect(processTarget.listenerCount("SIGTERM")).toBe(1);
    expect(processTarget.listenerCount("SIGINT")).toBe(1);

    await runtime.shutdown("test");

    expect(activityQueue.forceFlush).toHaveBeenCalledTimes(1);
    expect(runtime.captureQueueService.stop).toHaveBeenCalledTimes(1);
    expect(processTarget.listenerCount("SIGTERM")).toBe(0);
    expect(processTarget.listenerCount("SIGINT")).toBe(0);
  });

  test("l'arrêt est idempotent", async () => {
    const runtime = createDesktopRuntimeBootstrap({
      processTarget: new FakeProcess(),
      activityQueue: { forceFlush: jest.fn(async () => undefined) },
    });

    await runtime.shutdown("first");
    await runtime.shutdown("second");

    expect(runtime.captureQueueService.stop).toHaveBeenCalledTimes(1);
    expect(runtime.isDisposed()).toBe(true);
  });
});
