const axios = require("axios");
const logger = require("../utils/logger");
const { shouldIgnoreActivity, getActivitySignature } = require("../utils/trackingFilter");

const activityQueue = require("./trackingQueue");

// NOTE: on utilise activityQueue pour batcher /api/activity/batch

const AXIOS_TIMEOUT = 5000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// /windows envoye uniquement quand la liste des fenetres change OU toutes les N ticks
const WINDOWS_THROTTLE_TICKS = 3; // 3 ticks * interval = 90s si 30s, 180s si 60s

// P0.3 — minimisation idle
const IDLE_OPEN_WINDOWS_THRESHOLD_SEC = Number(process.env.AGENT_IDLE_OPEN_WINDOWS_THRESHOLD_SEC || 60);
const IDLE_OPEN_WINDOWS_SKIP_SEC = Number(process.env.AGENT_IDLE_OPEN_WINDOWS_SKIP_SEC || 180);

async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios({
        url,
        timeout: AXIOS_TIMEOUT,
        ...options,
      });
      return response;
    } catch (err) {
      if (attempt === retries) throw err;

      const isRetryable = err.code === "ECONNABORTED" || err.code === "ETIMEDOUT" || err.response?.status >= 500;

      if (!isRetryable) throw err;

      logger.warn("REQUEST RETRY", { attempt, maxRetries: MAX_RETRIES, url, message: err.message });
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    }
  }
}

function sanitizeWindowTitle(rawTitle) {
  const t = String(rawTitle ?? "").trim();
  if (!t) return "";

  // Redaction stricte : on évite de stocker/propager des secrets via titles
  const patterns = [
    /\bbearer\b\s+[^\s]+/i,
    /\bauthorization\b\s*[:=]\s*[^\s]+/i,
    /\baccess[_-]?token\b\s*[:=]\s*[^\s]+/i,
    /\btoken\b\s*[:=]\s*[^\s]+/i,
    /\beyJ[A-Za-z0-9\-_]+/i, // JWT-like start (eyJ...)
    /[A-Za-z0-9\-_]{20,}\.[A-Za-z0-9\-_]{20,}/, // base64-ish segments
    /\bnas\b/i,
  ];

  if (patterns.some((re) => re.test(t))) return "[redacted]";
  // Protection contre abus / payloads énormes
  return t.length > 300 ? t.slice(0, 300) + "…" : t;
}

function sanitizeAppName(rawAppName) {
  const n = String(rawAppName ?? "").trim();
  if (!n) return "";

  // Même politique que pour window_title : jamais de tokens/bearer/cochonneries
  const patterns = [
    /\bbearer\b/i,
    /\bauthorization\b/i,
    /\baccess[_-]?token\b/i,
    /\btoken\b/i,
    /\beyJ[A-Za-z0-9\-_]+/i,
    /\bnas\b/i,
  ];

  if (patterns.some((re) => re.test(n))) return "[redacted]";
  return n.length > 200 ? n.slice(0, 200) + "…" : n;
}

function serializeWindows(windows) {
  return JSON.stringify(
    (windows || [])
      .map((w) => ({
        name: sanitizeAppName(w.ProcessName || w.ProcessName || w.name || ""),
        title: sanitizeWindowTitle(w.MainWindowTitle || w.title || ""),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
}

function createTrackingController({
  apiUrl,
  getToken,
  getTrackingInterval,
  getIdleSeconds,
  isUserIdle,
  getActiveWindow,
  getOpenWindows,
  getPrivacySettings = () => ({}),
  onActivityCaptured,
  onAuthExpired,
  onCaptureQueueFailed,
}) {
  let lastActivityId = null;
  let lastActivitySignature = null;
  let trackingInterval = null;
  let didAuthExpired = false;

  // Deduplication /windows
  let lastWindowsSignature = null;
  let windowsTickCounter = 0;

  // getAuthHeaders() conservé pour compat (mais plus utilisé quand on batch)
  function getAuthHeaders() {
    const tok = getToken();
    return tok ? { Cookie: `access_token=${tok}` } : {};
  }

  function expireAuthOnce() {
    if (didAuthExpired) return;
    didAuthExpired = true;
    stopTracking();
    onAuthExpired?.();
  }

  async function saveActiveWindowTick(intervalSeconds) {
    const activeWin = getActiveWindow();

    // P0.3 - Stop capture if idle (Integration SessionManager)
    if (isUserIdle()) {
      return;
    }

    if (!activeWin || !token) return;

    const activeWindow = await activeWin();
    const idleSeconds = getIdleSeconds();

    if (!activeWindow) return;

    const payload = {
      app_name: sanitizeAppName(activeWindow.owner?.name || "Unknown"),
      window_title: sanitizeWindowTitle(activeWindow.title || ""),
      duration_seconds: intervalSeconds,
      is_idle: isUserIdle(),
      idle_seconds: idleSeconds,
    };

    // Batch: on envoie via /api/activity/batch
    // (le backend regroupe selon kind)
    // On garde la logique de dedup ici (patch vs post)

    if (shouldIgnoreActivity(payload, getPrivacySettings())) {
      logger.info("TRACKING IGNORED", { appName: payload.app_name });
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

    if (signature === lastActivitySignature && lastActivityId) {
      // Batch duration patch
      activityQueue.add({
        kind: "activity_duration_patch",
        payload: {
          activity_id: lastActivityId,
          duration_seconds: intervalSeconds,
          is_idle: payload.is_idle,
          idle_seconds: idleSeconds,
        },
      });

      logger.info("ACTIVITY DURATION QUEUED");
      return;
    }

    // Batch activity post
    activityQueue.add({
      kind: "activity_post",
      payload,
    });

    // On ne sait pas encore l'id tant que le batch n'est pas flush.
    // Garder lastActivityId null évite les patches avant insertion.
    lastActivitySignature = signature;
    lastActivityId = null;

    logger.info("ACTIVITY LOG QUEUED");
  }

  async function saveOpenWindowsTick(intervalSeconds) {
    const tok = getToken();
    if (!tok) return;

    // P0.3 — minimisation idle: réduction/skip des open-windows
    if (isUserIdle()) {
      const idleSeconds = getIdleSeconds();
      if (idleSeconds >= IDLE_OPEN_WINDOWS_SKIP_SEC) {
        logger.info("WINDOW LOGS SKIPPED", { reason: "idle_skip", idleSeconds });
        return;
      }

      if (idleSeconds >= IDLE_OPEN_WINDOWS_THRESHOLD_SEC) {
        // En idle, on augmente la sensibilité au throttle en réduisant l’envoi aux changements uniquement
        // (hasChanged seul)
      }
    }

    const privacySettings = getPrivacySettings();
    const openWindows = ((await getOpenWindows()) || []).filter(
      (win) =>
        !shouldIgnoreActivity(
          {
            app_name: win.ProcessName || win.name || "",
            window_title: win.MainWindowTitle || win.title || "",
          },
          privacySettings,
        ),
    );

    if (!openWindows || openWindows.length === 0) return;

    windowsTickCounter++;
    const signature = serializeWindows(openWindows);

    // Throttle: on n'envoie que si changed ou toutes les N ticks
    const hasChanged = signature !== lastWindowsSignature;

    // En idle: on favorise hasChanged seulement (réduit le spam quand l'utilisateur ne bouge pas)
    let effectiveWindowsThrottleTicks = WINDOWS_THROTTLE_TICKS;
    if (isUserIdle()) {
      const idleSeconds = getIdleSeconds();
      if (idleSeconds >= IDLE_OPEN_WINDOWS_THRESHOLD_SEC) {
        effectiveWindowsThrottleTicks = 999_999; // effectively never-send-by-time while idle
      }
    }

    const shouldSend = hasChanged || windowsTickCounter >= effectiveWindowsThrottleTicks;

    if (!shouldSend) {
      logger.info("WINDOW LOGS SKIPPED", { reason: "unchanged_throttled" });
      return;
    }

    // Reset counter on change, decrement otherwise (avoids sending every Nth tick forever)
    if (hasChanged) {
      windowsTickCounter = 0;
    } else {
      windowsTickCounter = 0; // reset apres envoi throttle
    }

    lastWindowsSignature = signature;

    const windowsPayload = {
      windows: openWindows,
      duration_seconds: intervalSeconds,
      is_idle: isUserIdle(),
      idle_seconds: getIdleSeconds(),
    };

    // Batch windows logs
    activityQueue.add({
      kind: "activity_windows_post",
      payload: {
        windows: openWindows,
        duration_seconds: intervalSeconds,
        is_idle: windowsPayload.is_idle,
        idle_seconds: windowsPayload.idle_seconds,
      },
    });

    logger.info("WINDOW LOGS QUEUED", { reason: hasChanged ? "changed" : "throttled_tick" });
  }

  function startTracking() {
    if (trackingInterval) return;
    if (!getToken()) {
      logger.info("TRACKING NOT STARTED", { reason: "missing_token" });
      return;
    }

    const intervalSeconds = getTrackingInterval();
    const intervalMs = intervalSeconds * 1000;

    logger.info("TRACKING STARTED", { intervalSeconds });
    didAuthExpired = false;

    let tickInProgress = false;

    trackingInterval = setInterval(async () => {
      if (tickInProgress) {
        logger.info("TRACKING TICK SKIPPED", { reason: "inflight" });
        return;
      }

      tickInProgress = true;
      try {
        if (!getToken()) {
          stopTracking();
          return;
        }

        await saveActiveWindowTick(intervalSeconds);

        if (!getToken()) {
          stopTracking();
          return;
        }

        await saveOpenWindowsTick(intervalSeconds);
      } catch (err) {
        const status = err?.response?.status;
        logger.error("TRACKING ERROR", { status, detail: err?.response?.data || err.message });

        if (status === 401) {
          expireAuthOnce();
        }
      } finally {
        tickInProgress = false;
      }
    }, intervalMs);
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
    isTracking: () => Boolean(trackingInterval),
    saveActiveWindowTick,
    saveOpenWindowsTick,
    startTracking,
    stopTracking,
  };
}

module.exports = {
  createTrackingController,
};
