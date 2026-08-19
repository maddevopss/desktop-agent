const { powerMonitor, BrowserWindow } = require("electron");
const axios = require("axios");
const logger = require("./logger"); // Ton logger existant

class SessionManager {
  constructor() {
    this.accessToken = null;
    this.refreshTimer = null;
    this.isIdle = false;
    this.IDLE_THRESHOLD_SECONDS = 300; // 5 minutes

    // Écouter les événements système
    powerMonitor.on("suspend", () => this.handleSuspend());
    powerMonitor.on("resume", () => this.handleResume());
    powerMonitor.on("lock-screen", () => this.handleSuspend());
    powerMonitor.on("unlock-screen", () => this.handleResume());
  }

  setToken(token) {
    this.accessToken = token;
    this.scheduleProactiveRefresh();
  }

  /**
   * Calcule le délai avant expiration et programme le refresh
   */
  scheduleProactiveRefresh() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (!this.accessToken) return;

    try {
      // Décoder le JWT sans bibliothèque externe (atob equivalent)
      const payload = JSON.parse(Buffer.from(this.accessToken.split(".")[1], "base64").toString());
      const expiryMs = payload.exp * 1000;

      // On prévoit de rafraîchir 2 minutes avant l'expiration réelle
      const delay = expiryMs - Date.now() - 120 * 1000;

      if (delay > 0) {
        logger.info(`Refresh proactif programmé dans ${Math.round(delay / 1000 / 60)} minutes`);
        this.refreshTimer = setTimeout(() => this.executeRefresh(), delay);
      } else {
        // Si le token expire dans moins de 2 min, on refresh tout de suite
        this.executeRefresh();
      }
    } catch (err) {
      logger.error("Erreur lors de la programmation du refresh proactif", err);
    }
  }

  async executeRefresh() {
    // --- ANTI-GASPILLAGE : Vérification de l'Idle ---
    const systemIdleTime = powerMonitor.getSystemIdleTime();

    if (systemIdleTime >= this.IDLE_THRESHOLD_SECONDS) {
      logger.info(`Utilisateur inactif depuis ${systemIdleTime}s. Suspension du refresh proactif.`);
      this.isIdle = true;
      return; // On s'arrête là, handleResume() s'en occupera au réveil
    }

    try {
      logger.info("Exécution du rafraîchissement proactif du jeton...");

      // On utilise axios (ou ton instance configurée avec les cookies)
      const response = await axios.post(
        `${process.env.AGENT_API_URL}/api/refresh`,
        {},
        {
          withCredentials: true,
          headers: { Cookie: `refresh_token=${this.getRefreshTokenFromStore()}` }, // Selon ta gestion des cookies en Main
        },
      );

      const newToken = response.data?.data?.token;
      if (newToken) {
        this.setToken(newToken);
        this.broadcastToRenderers(newToken);
      }
    } catch (err) {
      logger.error("Échec du refresh proactif (réseau ou session expirée)", err.message);
      // On ne déconnecte pas forcément ici, le prochain appel API (tracking) s'en chargera via api.jsx
    }
  }

  handleSuspend() {
    logger.info("Système en veille. Pause du refresh timer.");
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
  }

  handleResume() {
    logger.info("Système actif. Vérification de la session...");
    this.isIdle = false;

    // Si on a un token, on vérifie s'il est temps de le rafraîchir
    if (this.accessToken) {
      this.scheduleProactiveRefresh();
    }
  }

  broadcastToRenderers(token) {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      win.webContents.send("agent:token-refreshed", { token });
    });
  }

  getRefreshTokenFromStore() {
    // Logique pour récupérer le cookie persistant si nécessaire
    // Ou laisser Axios gérer via le jar de cookies si configuré
  }
}

module.exports = new SessionManager();
