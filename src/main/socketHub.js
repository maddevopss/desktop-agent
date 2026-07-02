const { io } = require("socket.io-client");
const logger = require("../utils/logger");

let hubSocket = null;

function connectHubSocket({ apiUrl, getToken, onTimerSync, onTimerCommand }) {
  const token = getToken();
  if (!token) return null;
  
  if (hubSocket) {
    hubSocket.disconnect();
  }

  hubSocket = io(`${apiUrl}/hub`, {
    query: { token },
  });

  hubSocket.on("connect", () => {
    logger.info("Connecté au Hub Socket");
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
