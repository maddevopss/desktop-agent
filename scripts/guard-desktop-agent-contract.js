const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const mainPath = path.join(repoRoot, "main.js");
const preloadPath = path.join(repoRoot, "preload.js");
const ipcPath = path.join(repoRoot, "src", "main", "ipcHandlers.js");
const windowManagerPath = path.join(repoRoot, "src", "main", "windowManager.js");
const socketHubPath = path.join(repoRoot, "src", "main", "socketHub.js");

const violations = [];

function read(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

const main = read(mainPath);
const preload = read(preloadPath);
const ipc = read(ipcPath);
const windowManager = read(windowManagerPath);
const socketHub = read(socketHubPath);

if (!main) violations.push("main.js is missing.");
if (!preload) violations.push("preload.js is missing.");
if (!ipc) violations.push("src/main/ipcHandlers.js is missing.");
if (!windowManager) violations.push("src/main/windowManager.js is missing.");
if (!socketHub) violations.push("src/main/socketHub.js is missing.");

if (main && main.includes("console.error")) {
  violations.push("main.js must not use console.error; use logger.");
}

if (main && !main.includes("isUsableAccessToken(protocolToken)")) {
  violations.push("protocol auth token must be validated before use.");
}

if (main && main.includes('notifyRenderer("protocol-auth-token", { token')) {
  violations.push("protocol auth must not send raw token to renderer.");
}

if (main && !main.includes('notifyRenderer("protocol-auth-token", { authenticated: true })')) {
  violations.push("protocol auth should only notify renderer with authenticated=true.");
}

if (preload && !preload.includes("contextBridge.exposeInMainWorld")) {
  violations.push("preload must expose APIs through contextBridge only.");
}

if (preload && preload.includes("require('fs')") || preload.includes('require("fs")')) {
  violations.push("preload must not expose fs access.");
}

if (windowManager && !windowManager.includes("contextIsolation: true")) {
  violations.push("BrowserWindow must enable contextIsolation.");
}

if (windowManager && !windowManager.includes("nodeIntegration: false")) {
  violations.push("BrowserWindow must disable nodeIntegration.");
}

if (windowManager && !windowManager.includes("sandbox: true")) {
  violations.push("BrowserWindow must enable sandbox.");
}

if (windowManager && !windowManager.includes("webSecurity: true")) {
  violations.push("BrowserWindow must keep webSecurity enabled.");
}

if (windowManager && !windowManager.includes("allowRunningInsecureContent: false")) {
  violations.push("BrowserWindow must block insecure content.");
}

if (windowManager && !windowManager.includes("setWindowOpenHandler(() => ({ action: \"deny\" }))")) {
  violations.push("BrowserWindow must deny window.open.");
}

if (windowManager && !windowManager.includes("will-navigate")) {
  violations.push("BrowserWindow must guard navigation.");
}

if (ipc && !ipc.includes("MAX_SOCKET_PAYLOAD_BYTES = 4096")) {
  violations.push("IPC timer payloads must keep a 4096-byte cap.");
}

if (ipc && !ipc.includes("TIMER_SYNC_FIELDS")) {
  violations.push("IPC timer sync payload must use an allowlist.");
}

if (ipc && !ipc.includes("TIMER_COMMAND_FIELDS")) {
  violations.push("IPC timer command payload must use an allowlist.");
}

if (ipc && !ipc.includes("ALLOWED_TIMER_COMMANDS")) {
  violations.push("IPC timer commands must use an allowlist.");
}

if (ipc && ipc.includes('return getStoreValue("token"')) {
  violations.push("IPC get-stored-token must not return raw token.");
}

if (ipc && !/ipcMain\.handle\("get-stored-token",\s*\(\)\s*=>\s*{\s*return null;\s*}\);/.test(ipc)) {
  violations.push("IPC get-stored-token must return null.");
}

if (ipc && !ipc.includes("sanitizeDiagnosticsConfig")) {
  violations.push("diagnostics export must sanitize config/privacy data.");
}

if (ipc && !ipc.includes("ignoredAppsCount")) {
  violations.push("diagnostics export must expose privacy counts, not raw app lists.");
}

if (ipc && !ipc.includes("ignoredKeywordsCount")) {
  violations.push("diagnostics export must expose privacy counts, not raw keyword lists.");
}

if (ipc && !ipc.includes("String(text || \"\").trim().slice(0, 5000)")) {
  violations.push("brain dump IPC must trim and cap text before sending.");
}

if (ipc && !ipc.includes("timeout: 10000")) {
  violations.push("external IPC HTTP calls should keep a 10s timeout.");
}

if (socketHub && !socketHub.includes("query: { token }")) {
  violations.push("socket hub must pass token explicitly for backend auth.");
}

if (violations.length > 0) {
  console.error("\nMADSuite desktop-agent contract guard failed.\n");
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log("Desktop-agent contract guard passed.");
