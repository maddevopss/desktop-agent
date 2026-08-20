const { createTrackingController } = require("../src/main/tracking");

describe("tracking queue integration", () => {
  let consoleError;
  let consoleLog;

  beforeEach(() => {
    jest.useFakeTimers();
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    consoleLog = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    consoleError.mockRestore();
    consoleLog.mockRestore();
  });

  test("envoie l'activite a la file persistante", async () => {
    const onCaptureQueueFailed = jest.fn(() => true);

    const tracking = createTrackingController({
      getToken: () => "expired-token",
      getTrackingInterval: () => 10,
      getIdleSeconds: () => 0,
      isUserIdle: () => false,
      getActiveWindow: () => async () => ({
        owner: { name: "Code" },
        title: "Timesheet",
      }),
      getOpenWindows: jest.fn(async () => []),
      onCaptureQueueFailed,
    });

    tracking.startTracking();
    expect(tracking.isTracking()).toBe(true);

    await jest.advanceTimersByTimeAsync(10000);

    expect(onCaptureQueueFailed).toHaveBeenCalledWith({
      kind: "activity_post",
      payload: expect.objectContaining({
        app_name: "Code",
        window_title: "Timesheet",
        duration_seconds: 10,
      }),
    });
    expect(tracking.isTracking()).toBe(true);

    tracking.stopTracking();
  });
});
