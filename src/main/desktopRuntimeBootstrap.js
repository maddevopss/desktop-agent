const { createCaptureQueueRuntime } = require("./captureQueueRuntime");
const { createProcessSignalRegistry } = require("./processSignalRegistry");

function createDesktopRuntimeBootstrap(options) {
  const {
    processTarget = process,
    activityQueue,
    exit = (code) => processTarget.exit(code),
    logger,
  } = options;

  const captureQueueService = createCaptureQueueRuntime(options);
  const signalRegistry = createProcessSignalRegistry(processTarget);
  let disposed = false;

  async function shutdown(signal = "shutdown") {
    if (disposed) return;
    disposed = true;

    try {
      await activityQueue?.forceFlush?.();
    } catch (error) {
      logger?.warn("ACTIVITY QUEUE FINAL FLUSH FAILED", {
        signal,
        error: error?.message,
      });
    } finally {
      captureQueueService.stop();
      signalRegistry.dispose();
    }
  }

  function registerProcessSignals() {
    const handleSignal = (signal) => async () => {
      await shutdown(signal);
      exit(0);
    };

    signalRegistry.register("SIGTERM", handleSignal("SIGTERM"));
    signalRegistry.register("SIGINT", handleSignal("SIGINT"));
  }

  return {
    captureQueueService,
    registerProcessSignals,
    shutdown,
    isDisposed: () => disposed,
    getSignalCount: () => signalRegistry.size(),
  };
}

module.exports = { createDesktopRuntimeBootstrap };
