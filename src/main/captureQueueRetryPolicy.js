const DEFAULT_MAX_ATTEMPTS = 6;
const DEFAULT_BASE_DELAY_MS = 30_000;
const DEFAULT_MAX_DELAY_MS = 15 * 60_000;

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createCaptureQueueRetryPolicy(options = {}) {
  const maxAttempts = normalizePositiveInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS);
  const baseDelayMs = normalizePositiveInteger(options.baseDelayMs, DEFAULT_BASE_DELAY_MS);
  const maxDelayMs = normalizePositiveInteger(options.maxDelayMs, DEFAULT_MAX_DELAY_MS);

  function nextDelayMs(attempt) {
    const safeAttempt = normalizePositiveInteger(attempt, 1);
    return Math.min(baseDelayMs * 2 ** (safeAttempt - 1), maxDelayMs);
  }

  function canRetry(attempt) {
    const safeAttempt = normalizePositiveInteger(attempt, 1);
    return safeAttempt < maxAttempts;
  }

  function nextState(current = {}) {
    const attempt = normalizePositiveInteger(current.attempt, 0) + 1;
    return {
      attempt,
      retryAllowed: canRetry(attempt),
      delayMs: canRetry(attempt) ? nextDelayMs(attempt) : null,
      exhausted: !canRetry(attempt),
    };
  }

  return {
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    canRetry,
    nextDelayMs,
    nextState,
  };
}

module.exports = {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  createCaptureQueueRetryPolicy,
};
