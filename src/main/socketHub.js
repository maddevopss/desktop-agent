const { io } = require("socket.io-client");
const logger = require("../utils/logger");

let hubSocket = null;

function connectHubSocket({ apiUrl, getToken, onTimerSync, onTimerCommand, onConnectionState = () => {} }) {
  const token = getToken();
  if (!token) {
    onConnectionState({ state: "offline", reason: "missing-token" });
    return null;
  }
  
  if (hubSocket) {
    hubSocket.disconnect();
  }

  hubSocket = io(`${apiUrl}/hub`, {
    // Le backend lit socket.handshake.auth.token; query n'est pas un canal
    // d'authentification accepté par hub.socket.js.
    auth: { token },
    transports: ["websocket", "polling"],
    timeout: 10_000,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
    randomizationFactor: 0.5,
  });

  hubSocket.on("connect", () => {
    logger.info("Connecté au Hub Socket");
    onConnectionState({ state: "connected" });
  });

  hubSocket.on("connect_error", (error) => {
    logger.warn("Connexion Hub Socket impossible", { error: error?.message });
    onConnectionState({ state: "offline", reason: "connect-error" });
  });

  hubSocket.on("disconnect", (reason) => {
    if (reason !== "io client disconnect") {
      onConnectionState({ state: "offline", reason });
    }
  });

  hubSocket.on("hub:timer:sync", onTimerSync);
  hubSocket.on("hub:timer:command", onTimerCommand);
  
  return hubSocket;
}

function getHubSocket() {
  return hubSocket;
}

function disconnectHubSocket() {
  if (hubSocket) {
    hubSocket.disconnect();
    hubSocket = null;
  }
}

module.exports = {
  connectHubSocket,
  getHubSocket,
  disconnectHubSocket
};
