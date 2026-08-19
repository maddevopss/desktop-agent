const logger = require("../utils/logger");
const {
  shouldIgnoreActivity,
  getActivitySignature,
} = require("../utils/trackingFilter");

const {
  addActivityPostFromPayload,
  addWindowLogsPost,
  addActivityDurationPatch,
} = require("./trackingQueue");

// Le tracking passe par trackingQueue pour batcher /api/activity/batch.

// /windows envoyé uniquement quand la liste des fenêtres change
// OU toutes les N itérations.
const WINDOWS_THROTTLE_TICKS = 3;

// P0.3 — minimisation idle
const IDLE_OPEN_WINDOWS_THRESHOLD_SEC = Number(
  process.env.AGENT_IDLE_OPEN_WINDOWS_THRESHOLD_SEC || 60,
);

const IDLE_OPEN_WINDOWS_SKIP_SEC = Number(
  process.env.AGENT_IDLE_OPEN_WINDOWS_SKIP_SEC || 180,
);

function sanitizeWindowTitle(rawTitle) {
  const title = String(rawTitle ?? "").trim();

  if (!title) {
    return "";
  }

  // Redaction stricte :
  // ne jamais stocker ou propager de secrets via les titres.
  const patterns = [
    /\bbearer\b\s+[^\s]+/i,
    /\bauthorization\b\s*[:=]\s*[^\s]+/i,
    /\baccess[_-]?token\b\s*[:=]\s*[^\s]+/i,
    /\btoken\b\s*[:=]\s*[^\s]+/i,
    /\beyJ[A-Za-z0-9\-_]+/i,
    /[A-Za-z0-9\-_]{20,}\.[A-Za-z0-9\-_]{20,}/,
    /\bnas\b/i,
  ];

  if (patterns.some((pattern) => pattern.test(title))) {
    return "[redacted]";
  }

  // Protection contre les payloads anormalement volumineux.
  return title.length > 300
    ? `${title.slice(0, 300)}…`
    : title;
}

function sanitizeAppName(rawAppName) {
  const appName = String(rawAppName ?? "").trim();

  if (!appName) {
    return "";
  }

  const patterns = [
    /\bbearer\b/i,
    /\bauthorization\b/i,
    /\baccess[_-]?token\b/i,
    /\btoken\b/i,
    /\beyJ[A-Za-z0-9\-_]+/i,
    /\bnas\b/i,
  ];

  if (patterns.some((pattern) => pattern.test(appName))) {
    return "[redacted]";
  }

  return appName.length > 200
    ? `${appName.slice(0, 200)}…`
    : appName;
}

function serializeWindows(windows) {
  return JSON.stringify(
    (windows || [])
      .map((window) => ({
        name: sanitizeAppName(
          window.ProcessName ||
            window.name ||
            "",
        ),
        title: sanitizeWindowTitle(
          window.MainWindowTitle ||
            window.title ||
            "",
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
}

function createTrackingController({
  getToken,
  getTrackingInterval,
  getIdleSeconds,
  isUserIdle,
  getActiveWindow,
  getOpenWindows,
  getPrivacySettings = () => ({}),
  onActivityCaptured,
  onAuthExpired,
}) {
  let lastActivityId = null;
  let lastActivitySignature = null;
  let trackingInterval = null;
  let didAuthExpired = false;

  // Déduplication /windows
  let lastWindowsSignature = null;
  let windowsTickCounter = 0;

  function expireAuthOnce() {
    if (didAuthExpired) {
      return;
    }

    didAuthExpired = true;
    stopTracking();
    onAuthExpired?.();
  }

  async function saveActiveWindowTick(intervalSeconds) {
    const token = getToken();
    const activeWin = getActiveWindow();

    // P0.3 — aucune capture lorsque l'utilisateur est idle.
    if (isUserIdle()) {
      return;
    }

    if (!activeWin || !token) {
      return;
    }

    const activeWindow = await activeWin();

    if (!activeWindow) {
      return;
    }

    const idleSeconds = getIdleSeconds();

    const payload = {
      app_name: sanitizeAppName(
        activeWindow.owner?.name || "Unknown",
      ),
      window_title: sanitizeWindowTitle(
        activeWindow.title || "",
      ),
      duration_seconds: intervalSeconds,
      is_idle: isUserIdle(),
      idle_seconds: idleSeconds,
    };

    if (shouldIgnoreActivity(payload, getPrivacySettings())) {
      logger.info("TRACKING IGNORED", {
        appName: payload.app_name,
      });

      lastActivitySignature = null;
      lastActivityId = null;

      return;
    }

    onActivityCaptured?.({
      app_name: payload.app_name,
      window_title: payload.window_title,
      captured_at: new Date().toISOString(),
    });

    const signature = getActivitySignature(payload);

    payload.activity_signature = signature;

    /*
     * Si un ID d'activité est disponible, une activité identique
     * peut être convertie en mise à jour de durée.
     */
    if (
      signature === lastActivitySignature &&
      lastActivityId
    ) {
      addActivityDurationPatch({
        activityId: lastActivityId,
        duration_seconds: intervalSeconds,
        is_idle: payload.is_idle,
        idle_seconds: idleSeconds,
      });

      logger.info("ACTIVITY DURATION QUEUED");

      return;
    }

    /*
     * Nouvelle activité.
     *
     * L'écriture réseau est déléguée à trackingQueue.
     */
    addActivityPostFromPayload(payload);

    /*
     * L'ID réel n'est pas connu avant le flush du batch.
     * On évite donc d'envoyer un PATCH avant que l'insertion
     * correspondante existe.
     */
    lastActivitySignature = signature;
    lastActivityId = null;

    logger.info("ACTIVITY LOG QUEUED");
  }

  async function saveOpenWindowsTick(intervalSeconds) {
    const token = getToken();

    if (!token) {
      return;
    }

    /*
     * P0.3 — minimisation lorsque l'utilisateur est idle.
     */
    if (isUserIdle()) {
      const idleSeconds = getIdleSeconds();

      if (idleSeconds >= IDLE_OPEN_WINDOWS_SKIP_SEC) {
        logger.info("WINDOW LOGS SKIPPED", {
          reason: "idle_skip",
          idleSeconds,
        });

        return;
      }
    }

    const privacySettings = getPrivacySettings();

    const openWindows = (
      (await getOpenWindows()) || []
    ).filter(
      (window) =>
        !shouldIgnoreActivity(
          {
            app_name:
              window.ProcessName ||
              window.name ||
              "",
            window_title:
              window.MainWindowTitle ||
              window.title ||
              "",
          },
          privacySettings,
        ),
    );

    if (openWindows.length === 0) {
      return;
    }

    windowsTickCounter += 1;

    const signature = serializeWindows(openWindows);
    const hasChanged =
      signature !== lastWindowsSignature;

    /*
     * Hors idle :
     *   - envoyer lors d'un changement
     *   - ou périodiquement.
     *
     * En idle prolongé :
     *   - envoyer uniquement lorsqu'une fenêtre change.
     */
    let effectiveWindowsThrottleTicks =
      WINDOWS_THROTTLE_TICKS;

    if (isUserIdle()) {
      const idleSeconds = getIdleSeconds();

      if (
        idleSeconds >=
        IDLE_OPEN_WINDOWS_THRESHOLD_SEC
      ) {
        effectiveWindowsThrottleTicks = 999_999;
      }
    }

    const shouldSend =
      hasChanged ||
      windowsTickCounter >=
        effectiveWindowsThrottleTicks;

    if (!shouldSend) {
      logger.info("WINDOW LOGS SKIPPED", {
        reason: "unchanged_throttled",
      });

      return;
    }

    windowsTickCounter = 0;
    lastWindowsSignature = signature;

    const windowsPayload = {
      windows: openWindows,
      duration_seconds: intervalSeconds,
      is_idle: isUserIdle(),
      idle_seconds: getIdleSeconds(),
    };

    addWindowLogsPost(windowsPayload);

    logger.info("WINDOW LOGS QUEUED", {
      reason: hasChanged
        ? "changed"
        : "throttled_tick",
    });
  }

  function startTracking() {
    if (trackingInterval) {
      return;
    }

    if (!getToken()) {
      logger.info("TRACKING NOT STARTED", {
        reason: "missing_token",
      });

      return;
    }

    const intervalSeconds =
      getTrackingInterval();

    const intervalMs =
      intervalSeconds * 1000;

    logger.info("TRACKING STARTED", {
      intervalSeconds,
    });

    didAuthExpired = false;

    let tickInProgress = false;

    trackingInterval = setInterval(
      async () => {
        if (tickInProgress) {
          logger.info(
            "TRACKING TICK SKIPPED",
            {
              reason: "inflight",
            },
          );

          return;
        }

        tickInProgress = true;

        try {
          if (!getToken()) {
            stopTracking();
            return;
          }

          await saveActiveWindowTick(
            intervalSeconds,
          );

          if (!getToken()) {
            stopTracking();
            return;
          }

          await saveOpenWindowsTick(
            intervalSeconds,
          );
        } catch (err) {
          const status =
            err?.response?.status;

          logger.error("TRACKING ERROR", {
            status,
            detail:
              err?.response?.data ||
              err.message,
          });

          if (status === 401) {
            expireAuthOnce();
          }
        } finally {
          tickInProgress = false;
        }
      },
      intervalMs,
    );
  }

  function stopTracking() {
    if (trackingInterval) {
      clearInterval(trackingInterval);
      trackingInterval = null;
    }

    lastActivityId = null;
    lastActivitySignature = null;
    lastWindowsSignature = null;
    windowsTickCounter = 0;
  }

  return {
    isTracking: () =>
      Boolean(trackingInterval),

    saveActiveWindowTick,
    saveOpenWindowsTick,
    startTracking,
    stopTracking,
  };
}

module.exports = {
  createTrackingController,
};
