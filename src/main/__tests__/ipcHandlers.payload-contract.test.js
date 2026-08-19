const fs = require("fs");
const path = require("path");

const handlersPath = path.join(__dirname, "..", "ipcHandlers.js");
const source = fs.readFileSync(handlersPath, "utf8");

const REQUIRED_BINDINGS = Object.freeze([
  ['ipcMain.handle("login"', "parseLoginCredentials(credentialsPayload)"],
  ['ipcMain.handle("start-tracking"', "parseToken(receivedToken)"],
  ['ipcMain.handle("agent-token-refreshed"', 'parseToken(newToken, "Nouveau token")'],
  ['ipcMain.handle("set-tracking-interval"', "parseTrackingInterval(seconds)"],
  ['ipcMain.handle("set-privacy-settings"', "parsePrivacySettings(nextSettings)"],
  ['ipcMain.handle("send-brain-dump"', "parseBrainDump(text)"],
  ['ipcMain.handle("set-autostart"', 'parseBoolean(enabled, "enabled")'],
]);

describe("branchement des schémas IPC", () => {
  test.each(REQUIRED_BINDINGS)("le handler %s utilise %s", (handler, parserCall) => {
    expect(source).toContain(handler);
    expect(source).toContain(parserCall);
  });

  test("ne réintroduit pas les conversions permissives retirées", () => {
    expect(source).not.toContain("const parsedSeconds = Number(seconds)");
    expect(source).not.toContain("enabled === true");
    expect(source).not.toContain('String(text || "").trim().slice(0, 5000)');
    expect(source).not.toContain("nextSettings?.trackingEnabled === true");
  });
});
