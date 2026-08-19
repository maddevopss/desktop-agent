const { createScopedCaptureQueue } = require("./scopedCaptureQueue");
const { createCaptureQueueRetryPolicy } = require("./captureQueueRetryPolicy");

function createCaptureQueueRuntime(options) {
  const retryPolicy = createCaptureQueueRetryPolicy({
    maxAttempts: process.env.AGENT_CAPTURE_QUEUE_MAX_RETRIES,
    baseDelayMs: process.env.AGENT_CAPTURE_QUEUE_FLUSH_DELAY_MS,
    maxDelayMs: process.env.AGENT_CAPTURE_QUEUE_MAX_RETRY_DELAY_MS,
  });
  const scopedQueue = createScopedCaptureQueue(options);
  let retryState = { attempt: 0 };
  let retryTimer = null;

  function clearRetryTimer() {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  }

  function scheduleRetry(reason = "runtime") {
    clearRetryTimer();
    retryState = retryPolicy.nextState(retryState);
    if (!retryState.retryAllowed) {
      options.logger?.warn("CAPTURE QUEUE RETRIES EXHAUSTED", { reason, attempt: retryState.attempt });
      return false;
    }
    retryTimer = setTimeout(async () => {
      retryTimer = null;
      const result = await flushCaptureQueueIfPossible();
      if ((result?.remaining || 0) > 0) scheduleRetry(`${reason}:remaining`);
    }, retryState.delayMs);
    return true;
  }

  async function flushCaptureQueueIfPossible() {
    const result = await scopedQueue.flushCaptureQueueIfPossible();
    if ((result?.flushed || 0) > 0) retryState = { attempt: 0 };
    return result;
  }

  return {
    ...scopedQueue,
    flushCaptureQueueIfPossible,
    scheduleRetry,
    getRetryState: () => ({ ...retryState }),
    stop() {
      clearRetryTimer();
      scopedQueue.stop();
    },
  };
}

module.exports = { createCaptureQueueRuntime };
