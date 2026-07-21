const {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_DELAY_MS,
  createCaptureQueueRetryPolicy,
} = require("../captureQueueRetryPolicy");

describe("politique de retry de la file", () => {
  test("applique un backoff exponentiel plafonné", () => {
    const policy = createCaptureQueueRetryPolicy({ baseDelayMs: 1_000, maxDelayMs: 5_000, maxAttempts: 10 });

    expect(policy.nextDelayMs(1)).toBe(1_000);
    expect(policy.nextDelayMs(2)).toBe(2_000);
    expect(policy.nextDelayMs(3)).toBe(4_000);
    expect(policy.nextDelayMs(4)).toBe(5_000);
    expect(policy.nextDelayMs(20)).toBe(5_000);
  });

  test("cesse explicitement après le nombre maximal de tentatives", () => {
    const policy = createCaptureQueueRetryPolicy({ maxAttempts: 3, baseDelayMs: 100 });

    expect(policy.nextState({ attempt: 0 })).toEqual({
      attempt: 1,
      retryAllowed: true,
      delayMs: 100,
      exhausted: false,
    });
    expect(policy.nextState({ attempt: 1 }).retryAllowed).toBe(true);
    expect(policy.nextState({ attempt: 2 })).toEqual({
      attempt: 3,
      retryAllowed: false,
      delayMs: null,
      exhausted: true,
    });
  });

  test("les valeurs invalides retombent sur des limites sûres", () => {
    const policy = createCaptureQueueRetryPolicy({ maxAttempts: 0, baseDelayMs: -1, maxDelayMs: "non" });

    expect(policy.maxAttempts).toBe(DEFAULT_MAX_ATTEMPTS);
    expect(policy.maxDelayMs).toBe(DEFAULT_MAX_DELAY_MS);
    expect(policy.nextDelayMs(1)).toBeGreaterThan(0);
  });

  test("aucune tentative épuisée ne reçoit un nouveau délai", () => {
    const policy = createCaptureQueueRetryPolicy({ maxAttempts: 2 });
    const exhausted = policy.nextState({ attempt: 1 });

    expect(exhausted.exhausted).toBe(true);
    expect(exhausted.retryAllowed).toBe(false);
    expect(exhausted.delayMs).toBeNull();
  });
});
