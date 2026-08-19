const {
  VALID_TRACKING_INTERVALS,
  parseLoginCredentials,
  parseToken,
  parseTrackingInterval,
  parsePrivacySettings,
  parseBrainDump,
  parseBoolean,
} = require("../ipcPayloadSchemas");

describe("schémas des payloads IPC", () => {
  test("normalise les identifiants de connexion", () => {
    expect(parseLoginCredentials({ email: " TEST@EXAMPLE.COM ", password: "secret" })).toEqual({
      email: "test@example.com",
      password: "secret",
    });
  });

  test.each([
    null,
    [],
    {},
    { email: "invalide", password: "secret" },
    { email: "test@example.com", password: "" },
    { email: "test@example.com", password: "secret", admin: true },
  ])("refuse les identifiants invalides %#", (payload) => {
    expect(() => parseLoginCredentials(payload)).toThrow();
  });

  test("accepte uniquement un JWT borné", () => {
    expect(parseToken(" aaa.bbb.ccc ")).toBe("aaa.bbb.ccc");
    expect(() => parseToken("opaque-token")).toThrow("Token invalide");
    expect(() => parseToken({ token: "aaa.bbb.ccc" })).toThrow("Token invalide");
    expect(() => parseToken(`a.${"b".repeat(17000)}.c`)).toThrow("Token invalide");
  });

  test("accepte uniquement les intervalles numériques déclarés", () => {
    for (const interval of VALID_TRACKING_INTERVALS) {
      expect(parseTrackingInterval(interval)).toBe(interval);
    }
    expect(() => parseTrackingInterval("60")).toThrow("Intervalle invalide");
    expect(() => parseTrackingInterval(15)).toThrow("Intervalle invalide");
    expect(() => parseTrackingInterval(NaN)).toThrow("Intervalle invalide");
  });

  test("normalise les réglages de confidentialité", () => {
    expect(
      parsePrivacySettings({
        trackingEnabled: false,
        ignoredApps: [" Slack "],
        ignoredKeywords: [" privé "],
      }),
    ).toEqual({
      trackingEnabled: false,
      ignoredApps: ["Slack"],
      ignoredKeywords: ["privé"],
    });
  });

  test.each([
    null,
    {},
    { trackingEnabled: "false" },
    { trackingEnabled: true, ignoredApps: "Slack" },
    { trackingEnabled: true, ignoredKeywords: [""] },
    { trackingEnabled: true, captureScreen: true },
  ])("refuse les réglages de confidentialité invalides %#", (payload) => {
    expect(() => parsePrivacySettings(payload)).toThrow();
  });

  test("borne strictement le brain dump", () => {
    expect(parseBrainDump("  une idée  ")).toBe("une idée");
    expect(() => parseBrainDump(123)).toThrow();
    expect(() => parseBrainDump("   ")).toThrow();
    expect(() => parseBrainDump("x".repeat(5001))).toThrow();
  });

  test("refuse les pseudo-booléens", () => {
    expect(parseBoolean(true, "enabled")).toBe(true);
    expect(parseBoolean(false, "enabled")).toBe(false);
    expect(() => parseBoolean("false", "enabled")).toThrow("enabled doit être un booléen");
    expect(() => parseBoolean(0, "enabled")).toThrow("enabled doit être un booléen");
  });
});
