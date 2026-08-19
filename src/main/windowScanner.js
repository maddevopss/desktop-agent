const { execFile } = require("child_process");
const { platform } = require("process");
const logger = require("../utils/logger");

const POWERSHELL_SCRIPT =
  "Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object ProcessName,MainWindowTitle | ConvertTo-Json -Compress";
const WINDOWS_POWERSHELL_EXE = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const PWSH_EXE = "pwsh.exe";

function parseWindows(stdout) {
  if (!stdout || !stdout.trim()) return [];

  // Protection: stdout potentiellement énorme => éviter JSON.parse
  const MAX_STDOUT_CHARS = 1024 * 1024; // 1MB
  if (stdout.length > MAX_STDOUT_CHARS) {
    logger.error("WINDOW SCANNER STDOUT TROP GRAND", { length: stdout.length });
    return [];
  }

  const data = JSON.parse(stdout);
  return Array.isArray(data) ? data : [data];
}

function runScannerCommand(file, args, allowFallback, resolve) {
  execFile(file, args, { windowsHide: true }, (error, stdout, stderr) => {
    if (error) {
      if (allowFallback && error.code === "ENOENT") {
        logger.warn("Windows PowerShell introuvable, tentative avec pwsh.");
        return runScannerCommand(PWSH_EXE, ["-NoProfile", "-Command", POWERSHELL_SCRIPT], false, resolve);
      }

      logger.error("POWERSHELL ERROR", { message: error.message });
      return resolve([]);
    }

    if (stderr) logger.error("POWERSHELL STDERR", { stderr });

    try {
      resolve(parseWindows(stdout));
    } catch (err) {
      logger.error("JSON PARSE ERROR", { message: err.message });
      resolve([]);
    }
  });
}

function getOpenWindows() {
  return new Promise((resolve) => {
    // Windows-only approach
    if (platform !== "win32") {
      logger.warn("getOpenWindows: unsupported platform, returning empty list");
      return resolve([]);
    }

    runScannerCommand(
      WINDOWS_POWERSHELL_EXE,
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", POWERSHELL_SCRIPT],
      true,
      resolve,
    );
  });
}

module.exports = {
  getOpenWindows,
};
