const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ALLOWED_EXTENSIONS = new Set([".exe", ".yml", ".yaml", ".blockmap"]);

function sha256(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function inspectWindowsArtifactDirectory(directory) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`Répertoire d’artefacts introuvable : ${directory}`);
  }

  const files = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(directory, entry.name))
    .filter((file) => ALLOWED_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .sort();

  const installers = files.filter((file) => path.extname(file).toLowerCase() === ".exe");
  if (installers.length === 0) {
    throw new Error("Aucun installateur Windows .exe inspectable.");
  }

  return {
    generatedAt: new Date().toISOString(),
    platform: "win32",
    installerCount: installers.length,
    files: files.map((file) => ({
      name: path.basename(file),
      sizeBytes: fs.statSync(file).size,
      sha256: sha256(file),
    })),
  };
}

function writeManifest(directory, outputFile) {
  const manifest = inspectWindowsArtifactDirectory(directory);
  fs.writeFileSync(outputFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

if (require.main === module) {
  const directory = path.resolve(process.argv[2] || "dist-ci");
  const outputFile = path.resolve(process.argv[3] || path.join(directory, "artifact-manifest.json"));
  const manifest = writeManifest(directory, outputFile);
  process.stdout.write(`Artefact Windows inspecté : ${manifest.installerCount} installateur(s).\n`);
}

module.exports = {
  ALLOWED_EXTENSIONS,
  inspectWindowsArtifactDirectory,
  writeManifest,
};
