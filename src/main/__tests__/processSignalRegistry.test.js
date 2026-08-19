const { EventEmitter } = require("events");
const { createProcessSignalRegistry } = require("../processSignalRegistry");

describe("registre des signaux processus", () => {
  test("remplace un handler existant sans accumulation", () => {
    const emitter = new EventEmitter();
    const registry = createProcessSignalRegistry(emitter);
    const first = jest.fn();
    const second = jest.fn();

    registry.register("SIGTERM", first);
    registry.register("SIGTERM", second);

    expect(emitter.listenerCount("SIGTERM")).toBe(1);
    emitter.emit("SIGTERM");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  test("dispose retire tous les écouteurs", () => {
    const emitter = new EventEmitter();
    const registry = createProcessSignalRegistry(emitter);
    registry.register("SIGTERM", jest.fn());
    registry.register("SIGINT", jest.fn());

    registry.dispose();

    expect(emitter.listenerCount("SIGTERM")).toBe(0);
    expect(emitter.listenerCount("SIGINT")).toBe(0);
    expect(registry.size()).toBe(0);
  });
});
