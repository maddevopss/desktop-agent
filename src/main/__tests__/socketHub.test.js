jest.mock("socket.io-client", () => ({ io: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn() }));

const { io } = require("socket.io-client");
const { connectHubSocket, disconnectHubSocket } = require("../socketHub");

describe("socketHub", () => {
  beforeEach(() => {
    disconnectHubSocket();
    jest.clearAllMocks();
  });

  test("authentifie le hub avec le canal auth attendu par le backend", () => {
    const handlers = new Map();
    const socket = {
      disconnect: jest.fn(),
      on: jest.fn((event, callback) => handlers.set(event, callback)),
    };
    const onConnectionState = jest.fn();
    io.mockReturnValue(socket);

    connectHubSocket({
      apiUrl: "https://api.example.test",
      getToken: () => "access-token",
      onTimerSync: jest.fn(),
      onTimerCommand: jest.fn(),
      onConnectionState,
    });

    expect(io).toHaveBeenCalledWith(
      "https://api.example.test/hub",
      expect.objectContaining({ auth: { token: "access-token" } }),
    );

    handlers.get("connect")();
    handlers.get("connect_error")(new Error("offline"));

    expect(onConnectionState).toHaveBeenNthCalledWith(1, { state: "connected" });
    expect(onConnectionState).toHaveBeenNthCalledWith(2, { state: "offline", reason: "connect-error" });
  });

  test("annonce hors ligne sans créer de socket quand aucun jeton n'est disponible", () => {
    const onConnectionState = jest.fn();

    expect(connectHubSocket({
      apiUrl: "https://api.example.test",
      getToken: () => null,
      onTimerSync: jest.fn(),
      onTimerCommand: jest.fn(),
      onConnectionState,
    })).toBeNull();

    expect(io).not.toHaveBeenCalled();
    expect(onConnectionState).toHaveBeenCalledWith({ state: "offline", reason: "missing-token" });
  });
});
