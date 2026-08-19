const childProcess = require("child_process");

jest.mock("child_process", () => ({
  exec: jest.fn(),
}));

describe("windowScanner", () => {
  let consoleWarn;
  let consoleError;
  let originalPlatform;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    originalPlatform = process.platform;
  });

  afterEach(() => {
    consoleWarn.mockRestore();
    consoleError.mockRestore();

    Object.defineProperty(process, "platform", {
      value: originalPlatform,
    });

    jest.dontMock("child_process");
  });

  function setPlatform(platform) {
    Object.defineProperty(process, "platform", {
      value: platform,
    });
  }

  function loadWindowScannerWithExecMock(execMock) {
    jest.doMock("child_process", () => ({
      exec: execMock,
    }));

    let mod;

    jest.isolateModules(() => {
      mod = require("../src/main/windowScanner");
    });

    return mod;
  }

  test("retourne [] hors Windows", async () => {
    setPlatform("darwin");

    const execMock = jest.fn();

    const { getOpenWindows } = loadWindowScannerWithExecMock(execMock);

    const result = await getOpenWindows();

    expect(result).toEqual([]);
    expect(consoleWarn).toHaveBeenCalledWith(
      "[desktop-agent] getOpenWindows: unsupported platform, returning empty list",
    );
    expect(execMock).not.toHaveBeenCalled();
  });

  test("retourne [] si PowerShell retourne une erreur", async () => {
    setPlatform("win32");

    const execMock = jest.fn((command, options, callback) => {
      callback(new Error("PowerShell failed"), "", "");
    });

    const { getOpenWindows } = loadWindowScannerWithExecMock(execMock);

    const result = await getOpenWindows();

    expect(result).toEqual([]);
    expect(consoleError).toHaveBeenCalled();
  });

  test("retourne [] si stdout est vide", async () => {
    setPlatform("win32");

    const execMock = jest.fn((command, options, callback) => {
      callback(null, "", "");
    });

    const { getOpenWindows } = loadWindowScannerWithExecMock(execMock);

    const result = await getOpenWindows();

    expect(result).toEqual([]);
  });

  test("parse un tableau JSON retourné par PowerShell", async () => {
    setPlatform("win32");

    const windows = [
      {
        ProcessName: "Code",
        MainWindowTitle: "ChronoMAD",
      },
      {
        ProcessName: "Chrome",
        MainWindowTitle: "GitHub",
      },
    ];

    const execMock = jest.fn((command, options, callback) => {
      callback(null, JSON.stringify(windows), "");
    });

    const { getOpenWindows } = loadWindowScannerWithExecMock(execMock);

    const result = await getOpenWindows();

    expect(result).toEqual(windows);
  });

  test("wrap un objet JSON unique dans un tableau", async () => {
    setPlatform("win32");

    const oneWindow = {
      ProcessName: "Code",
      MainWindowTitle: "ChronoMAD",
    };

    const execMock = jest.fn((command, options, callback) => {
      callback(null, JSON.stringify(oneWindow), "");
    });

    const { getOpenWindows } = loadWindowScannerWithExecMock(execMock);

    const result = await getOpenWindows();

    expect(result).toEqual([oneWindow]);
  });

  test("retourne [] si le JSON est invalide", async () => {
    setPlatform("win32");

    const execMock = jest.fn((command, options, callback) => {
      callback(null, "{invalid-json", "");
    });

    const { getOpenWindows } = loadWindowScannerWithExecMock(execMock);

    const result = await getOpenWindows();

    expect(result).toEqual([]);
    expect(consoleError).toHaveBeenCalled();
  });
});
