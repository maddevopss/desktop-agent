const fs = require("fs");
const path = require("path");

function loadEnvFileIfExists(envPath) {
  if (!envPath || !fs.existsSync(envPath)) return;

  try {
    require("dotenv").config({ path: envPath });
  } catch {
    // dotenv absent ou unusable: on garde les variables d'environnement déjà chargées.
  }
}

const envPaths = [
  path.join(__dirname, "..", "..", ".env"),
  path.join(__dirname, "..", "..", ".env.prod"),
];

if (process.resourcesPath) {
  envPaths.unshift(path.join(process.resourcesPath, ".env"));
  envPaths.push(path.join(process.resourcesPath, ".env.prod"));
}

for (const envPath of envPaths) {
  loadEnvFileIfExists(envPath);
}

const config = {
  AGENT_API_URL: process.env.AGENT_API_URL || "http://localhost:5000",
  AGENT_REFRESH_TIMEOUT_MS: Number(process.env.AGENT_REFRESH_TIMEOUT_MS || 15000),
};

module.exports = { config };
