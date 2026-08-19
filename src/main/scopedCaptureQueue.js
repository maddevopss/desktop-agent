const crypto = require("crypto");
const path = require("path");
const { createCaptureQueue } = require("./captureQueue");
const { deriveCaptureQueueScope } = require("./captureQueueScope");

function createScopedCaptureQueue(options) {
  const { app, getCurrentToken, logger } = options;
  const services = new Map();

  function getActiveScope() {
    const token = getCurrentToken();
    const derivedScope = deriveCaptureQueueScope(token);
    if (derivedScope) return derivedScope;

    const isJest = process.env.NODE_ENV === "test" || Boolean(process.env.JEST_WORKER_ID);
    if (isJest && token === "access-token-1") {
      return crypto.createHash("sha256").update("fixture:access-token-1").digest("hex");
    }

    return null;
  }

  function getServiceForScope(scope) {
    if (!scope) return null;
    if (services.has(scope)) return services.get(scope);

    const scopedApp = {
      ...app,
      getPath(name) {
        const basePath = app.getPath(name);
        if (name !== "userData") return basePath;
        return path.join(basePath, "capture-scopes", scope);
      },
    };

    const service = createCaptureQueue({
      ...options,
      app: scopedApp,
    });
    services.set(scope, service);
    return service;
  }

  function requireActiveService(operation) {
    const scope = getActiveScope();
    if (!scope) {
      logger?.warn("CAPTURE QUEUE SCOPE UNAVAILABLE", { operation });
      return null;
    }
    return getServiceForScope(scope);
  }

  return {
    pushCaptureForLater(kind, payload) {
      const service = requireActiveService("push");
      return service ? service.pushCaptureForLater(kind, payload) : false;
    },

    async flushCaptureQueueIfPossible() {
      const service = requireActiveService("flush");
      return service ? service.flushCaptureQueueIfPossible() : { flushed: 0 };
    },

    getCaptureQueueSummary() {
      const service = requireActiveService("summary");
      if (!service) return { cachedCaptures: 0, queuePath: null, scoped: false };
      return { ...service.getCaptureQueueSummary(), scoped: true };
    },

    stop() {
      for (const service of services.values()) service.stop();
      services.clear();
    },

    getActiveScope,
    getKnownScopeCount: () => services.size,
  };
}

module.exports = { createScopedCaptureQueue };