const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const SOURCE_ROOTS = ["main.js", "preload.js", "src", "utils", "renderer"];
const TEXT_EXTENSIONS = new Set([".js", ".cjs", ".mjs", ".jsx", ".json", ".html"]);

const FORBIDDEN_SOURCE_PATTERNS = [
  ["capture écran Electron", /\bdesktopCapturer\b/],
  ["capture écran navigateur", /\bgetDisplayMedia\b/],
  ["caméra ou microphone navigateur", /\bgetUserMedia\b/],
  ["enregistrement audio ou vidéo", /\bMediaRecorder\b/],
  ["accès audio natif", /\b(audio|microphone|webcam|camera)Capture\b/i],
  ["capture de contenu brut du presse-papiers", /clipboard\.(readText|readHTML|readImage)\s*\(/],
];

const FORBIDDEN_DEPENDENCIES = new Set([
  "screenshot-desktop",
  "desktop-screenshot",
  "node-webcam",
  "mic",
  "naudiodon",
  "robotjs",
  "iohook",
  "@nut-tree/nut-js",
]);

function collectFiles(target) {
  const absolute = path.join(repoRoot, target);
  if (!fs.existsSync(absolute)) return [];
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return [absolute];

  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", "dist", "dist-ci", "coverage", "build"].includes(entry.name)) return [];
    return collectFiles(path.relative(repoRoot, path.join(absolute, entry.name)));
  });
}

function relative(file) {
  return path.relative(repoRoot, file).replaceAll("\\", "/");
}

describe("interdits absolus MADPROOF-PRIVACY", () => {
  const sourceFiles = SOURCE_ROOTS.flatMap(collectFiles).filter((file) => TEXT_EXTENSIONS.has(path.extname(file)));

  test.each(FORBIDDEN_SOURCE_PATTERNS)("aucune surface de %s", (label, pattern) => {
    const violations = sourceFiles
      .filter((file) => !relative(file).includes("privacy.absolute-prohibitions.test.js"))
      .filter((file) => pattern.test(fs.readFileSync(file, "utf8")))
      .map(relative);

    expect(violations).toEqual([]);
  });

  test("aucune dépendance permettant une captation interdite", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    const installed = new Set([
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.devDependencies || {}),
      ...Object.keys(pkg.optionalDependencies || {}),
    ]);

    expect([...installed].filter((name) => FORBIDDEN_DEPENDENCIES.has(name))).toEqual([]);
  });

  test("la collecte autorisée reste limitée aux métadonnées de fenêtre", () => {
    const scannerPath = path.join(repoRoot, "src", "main", "windowScanner.js");
    const scanner = fs.readFileSync(scannerPath, "utf8");

    expect(scanner).not.toMatch(/screenshot|thumbnail|imageData|pixel|ocr/i);
  });
});
