const fs = require("fs");
const path = require("path");

const mainSource = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");

describe("contrat du runtime sécurisé dans main.js", () => {
  test("utilise le bootstrap sécurisé comme point d'entrée de la file", () => {
    expect(mainSource).toContain('createDesktopRuntimeBootstrap');
    expect(mainSource).toContain('const { captureQueueService } = desktopRuntime;');
    expect(mainSource).not.toContain('createCaptureQueue({');
  });

  test("enregistre les signaux avec le registre idempotent", () => {
    expect(mainSource).toContain('desktopRuntime.registerProcessSignals();');
    expect(mainSource).not.toMatch(/process\.on\(["']SIGTERM["']/);
    expect(mainSource).not.toMatch(/process\.on\(["']SIGINT["']/);
  });

  test("ferme le runtime lors de la sortie Electron", () => {
    expect(mainSource).toContain('desktopRuntime.shutdown("before-quit")');
    expect(mainSource).not.toContain('captureQueueService.stop();');
  });
});
