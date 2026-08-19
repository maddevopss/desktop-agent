const logger = require("../utils/logger");

let getWindowsModule = null;

async function getOpenWindows() {
  try {
    if (!getWindowsModule) {
      getWindowsModule = await import("get-windows");
    }
    const { openWindows } = getWindowsModule;
    const windows = await openWindows();
    
    // Map properties back to what the tracker expects (ProcessName and MainWindowTitle)
    return windows.map(w => ({
      ProcessName: w.owner?.name || w.owner?.path || "Unknown",
      MainWindowTitle: w.title || ""
    }));
  } catch (err) {
    logger.error("GET-WINDOWS NATIVE ERROR", { message: err.message });
    return [];
  }
}

module.exports = {
  getOpenWindows,
};
