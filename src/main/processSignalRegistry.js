function createProcessSignalRegistry(targetProcess = process) {
  const handlers = new Map();

  function register(signal, handler) {
    if (handlers.has(signal)) {
      targetProcess.off(signal, handlers.get(signal));
    }
    handlers.set(signal, handler);
    targetProcess.on(signal, handler);
  }

  function dispose() {
    for (const [signal, handler] of handlers) {
      targetProcess.off(signal, handler);
    }
    handlers.clear();
  }

  return {
    register,
    dispose,
    size: () => handlers.size,
  };
}

module.exports = { createProcessSignalRegistry };
