const path = require("path");
const { spawnSync } = require("child_process");

const modulePath = path.join(__dirname, "..", "tokenManager.js");

function runNode(env) {
  return spawnSync(
    process.execPath,
    ["-e", `require(${JSON.stringify(modulePath)})`],
    {
      encoding: "utf8",
      env,
    },
  );
}

describe("tokenManager fail-closed", () => {
  test("refuse de démarrer hors tests sans clé de chiffrement", () => {
    const env = { ...process.env, NODE_ENV: "production" };
    delete env.AGENT_TOKEN_ENC_KEY;
    delete env.JEST_WORKER_ID;

    const result = runNode(env);

    expect(result.status).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toContain(
      "AGENT_TOKEN_ENC_KEY environment variable is required for token encryption.",
    );
  });

  test("autorise le repli mémoire uniquement en environnement de test", () => {
    const env = { ...process.env, NODE_ENV: "test" };
    delete env.AGENT_TOKEN_ENC_KEY;
    delete env.JEST_WORKER_ID;

    const result = runNode(env);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });
});
