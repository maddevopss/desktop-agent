jest.mock("axios", () => jest.fn());

const axios = require("axios");
const { createTrackingController } = require("../src/main/tracking");

describe("tracking auth expiration", () => {
  let consoleError;
  let consoleLog;

  beforeEach(() => {
    jest.useFakeTimers();
    axios.mockReset();
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    consoleLog = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    consoleError.mockRestore();
    consoleLog.mockRestore();
  });

  test("stops tracking and notifies auth expiration once after a 401", async () => {
    const onAuthExpired = jest.fn();
    axios.mockRejectedValue({ response: { status: 401, data: { message: "expired" } } });

    const tracking = createTrackingController({
      apiUrl: "http://localhost:5000",
      getToken: () => "expired-token",
      getTrackingInterval: () => 10,
      getIdleSeconds: () => 0,
      isUserIdle: () => false,
      getActiveWindow: () => async () => ({
        owner: { name: "Code" },
        title: "Timesheet",
      }),
      getOpenWindows: jest.fn(async () => []),
      onAuthExpired,
    });

    tracking.startTracking();
    expect(tracking.isTracking()).toBe(true);

    await jest.advanceTimersByTimeAsync(10000);

    expect(onAuthExpired).toHaveBeenCalledTimes(1);
    expect(tracking.isTracking()).toBe(false);
    expect(axios).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(30000);

    expect(onAuthExpired).toHaveBeenCalledTimes(1);
    expect(axios).toHaveBeenCalledTimes(1);
  });
});
