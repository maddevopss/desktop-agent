const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, file), "utf8"));
}

describe("contrat de sécurité des mises à jour Desktop Agent", () => {
  test.each(["electron-builder.json", "electron-builder.ci.json"])(
    "%s exige la vérification de signature Windows",
    (filename) => {
      const config = readJson(filename);
      expect(config.win).toBeDefined();
      expect(config.win.verifyUpdateCodeSignature).toBe(true);
    },
  );

  test("la publication de production utilise uniquement la source générique configurée", () => {
    const config = readJson("electron-builder.json");

    expect(config.publish).toEqual([
      {
        provider: "generic",
        url: "${AGENT_UPDATE_URL}",
      },
    ]);
  });

  test("le build CI ne publie jamais automatiquement un artefact", () => {
    const config = readJson("electron-builder.ci.json");
    const pkg = readJson("package.json");

    expect(config.publish).toBeNull();
    expect(pkg.scripts["build:ci"]).toContain("--publish never");
  });

  test("la configuration de production exige un certificat et un éditeur explicite", () => {
    const config = readJson("electron-builder.json");

    expect(config.win.signtoolOptions).toEqual(
      expect.objectContaining({
        certificateFile: "${CERT_FILE}",
        certificatePassword: "${CERT_PASSWORD}",
        publisherName: "MAD",
      }),
    );
  });

  test("aucune configuration ne désactive la validation de signature", () => {
    for (const filename of ["electron-builder.json", "electron-builder.ci.json"]) {
      const raw = fs.readFileSync(path.join(repoRoot, filename), "utf8");
      expect(raw).not.toMatch(/verifyUpdateCodeSignature\s*"?\s*:\s*false/);
    }
  });
});
