const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  inspectWindowsArtifactDirectory,
  writeManifest,
} = require("../inspect-windows-artifact");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "madsuite-artifact-"));
}

describe("inspection des artefacts Windows", () => {
  test("produit un manifeste déterministe avec taille et SHA-256", () => {
    const directory = tempDir();
    const installer = path.join(directory, "MADSuite Setup.exe");
    fs.writeFileSync(installer, Buffer.from("fake-installer"));
    fs.writeFileSync(path.join(directory, "latest.yml"), "version: 2.0.0\n");

    const manifest = inspectWindowsArtifactDirectory(directory);
    const expectedHash = crypto.createHash("sha256").update(Buffer.from("fake-installer")).digest("hex");

    expect(manifest.platform).toBe("win32");
    expect(manifest.installerCount).toBe(1);
    expect(manifest.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "MADSuite Setup.exe",
          sizeBytes: 14,
          sha256: expectedHash,
        }),
      ]),
    );
  });

  test("ignore les fichiers non distribuables", () => {
    const directory = tempDir();
    fs.writeFileSync(path.join(directory, "MADSuite.exe"), "binary");
    fs.writeFileSync(path.join(directory, "debug.log"), "secret log");

    const manifest = inspectWindowsArtifactDirectory(directory);

    expect(manifest.files.map((file) => file.name)).toEqual(["MADSuite.exe"]);
  });

  test("échoue lorsque le build ne contient aucun installateur", () => {
    const directory = tempDir();
    fs.writeFileSync(path.join(directory, "latest.yml"), "version: 2.0.0\n");

    expect(() => inspectWindowsArtifactDirectory(directory)).toThrow(
      "Aucun installateur Windows .exe inspectable.",
    );
  });

  test("écrit un manifeste JSON réutilisable comme preuve CI", () => {
    const directory = tempDir();
    fs.writeFileSync(path.join(directory, "MADSuite.exe"), "binary");
    const outputFile = path.join(directory, "artifact-manifest.json");

    const manifest = writeManifest(directory, outputFile);
    const saved = JSON.parse(fs.readFileSync(outputFile, "utf8"));

    expect(saved.files).toEqual(manifest.files);
    expect(saved.installerCount).toBe(1);
  });
});
