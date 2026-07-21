const {
  INVOKE_CHANNELS,
  SUBSCRIBE_CHANNELS,
  assertAllowedInvokeChannel,
  assertAllowedSubscribeChannel,
} = require("../ipcChannels");

describe("contrat des canaux IPC", () => {
  test("autorise uniquement les canaux invoke déclarés", () => {
    for (const channel of INVOKE_CHANNELS) {
      expect(assertAllowedInvokeChannel(channel)).toBe(channel);
    }

    expect(() => assertAllowedInvokeChannel("shell:execute")).toThrow("Canal IPC invoke interdit");
    expect(() => assertAllowedInvokeChannel("fs:read-file")).toThrow("Canal IPC invoke interdit");
    expect(() => assertAllowedInvokeChannel(undefined)).toThrow("Canal IPC invoke interdit");
  });

  test("autorise uniquement les canaux subscribe déclarés", () => {
    for (const channel of SUBSCRIBE_CHANNELS) {
      expect(assertAllowedSubscribeChannel(channel)).toBe(channel);
    }

    expect(() => assertAllowedSubscribeChannel("desktop-capture")).toThrow("Canal IPC subscribe interdit");
    expect(() => assertAllowedSubscribeChannel("microphone-data")).toThrow("Canal IPC subscribe interdit");
    expect(() => assertAllowedSubscribeChannel(null)).toThrow("Canal IPC subscribe interdit");
  });

  test("ne contient aucun canal générique dangereux", () => {
    const channels = [...INVOKE_CHANNELS, ...SUBSCRIBE_CHANNELS];
    expect(channels).not.toEqual(expect.arrayContaining([
      "eval",
      "execute",
      "shell",
      "read-file",
      "write-file",
      "capture-screen",
      "camera",
      "microphone",
    ]));
  });
});
