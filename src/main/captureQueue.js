const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Les idees capturees via le widget Brain Dump sont irremplacables : contrairement a une
// capture d'activite, re-echantillonnee en continu, une idee perdue l'est definitivement.
// Ce kind est donc protege de l'eviction FIFO quand la file sature.
const CAPTURE_KIND_BRAIN_DUMP = "brain_dump_capture";

/**
 * Retire de la file le plus ancien element evincable, en epargnant les captures de
 * decharge mentale tant qu'il reste autre chose a sacrifier.
 * @param {Array<{ kind?: string }>} items - File modifiee en place.
 */
function dropOldestEvictable(items) {
  const index = items.findIndex((it) => it?.kind !== CAPTURE_KIND_BRAIN_DUMP);

  // Plus rien d'autre a jeter : on sacrifie la plus ancienne idee, faute de mieux.
  items.splice(index === -1 ? 0 : index, 1);
}

function createCaptureQueue({
  apiUrl,
  app,
  getCurrentToken,
  isUsableAccessToken,
  logger,
  isQuitting = () => false,
  onQueueStatsChanged = () => {},
  onAuthExpired = () => {},
}) {
  const captureQueueMaxItems = Number(process.env.AGENT_CAPTURE_QUEUE_MAX_ITEMS || 200);
  const captureQueueMaxBytes = Number(process.env.AGENT_CAPTURE_QUEUE_MAX_BYTES || 2_000_000);
  const captureQueueTtlMs = Number(process.env.AGENT_CAPTURE_QUEUE_TTL_MS || 7 * 24 * 3600_000);
  const captureQueueFlushDelayMs = Number(process.env.AGENT_CAPTURE_QUEUE_FLUSH_DELAY_MS || 30_000);

  let captureQueue = null;
  let captureQueueFlushTimer = null;
  let lastNudgeTime = 0;
  let authExpirationHandled = false;
  const NUDGE_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

  function createResponseError(message, response) {
    const error = new Error(message);
    error.response = {
      status: response?.status,
      data: response?.data,
    };
    return error;
  }

  function handleAuthExpired(error) {
    if (authExpirationHandled || error?.response?.status !== 401) return;

    authExpirationHandled = true;
    onAuthExpired();
  }

  function getCaptureQueuePath() {
    const diagnosticsDir = path.join(app.getPath("userData"), "diagnostics");
    return path.join(diagnosticsDir, "capture-queue.json");
  }

  function ensureDirSync(dirPath) {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  }

  function loadCaptureQueueIfNeeded() {
    if (captureQueue) return captureQueue;

    const queuePath = getCaptureQueuePath();
    const diagnosticsDir = path.dirname(queuePath);
    ensureDirSync(diagnosticsDir);

    let items = [];
    try {
      if (fs.existsSync(queuePath)) {
        const raw = fs.readFileSync(queuePath);
        let parsedStr = raw.toString("utf8");
        const { safeStorage } = require("electron");
        if (safeStorage && safeStorage.isEncryptionAvailable()) {
          try {
            parsedStr = safeStorage.decryptString(raw);
          } catch (e) {
            parsedStr = raw.toString("utf8");
          }
        }
        const parsed = JSON.parse(parsedStr);
        items = Array.isArray(parsed?.items) ? parsed.items : [];
      }
    } catch (err) {
      logger.warn("CAPTURE QUEUE LOAD FAILED", { error: err?.message });
      items = [];
    }

    const now = Date.now();
    items = items.filter(
      (it) => it && typeof it === "object" && typeof it.createdAt === "string" && now - new Date(it.createdAt).getTime() <= captureQueueTtlMs,
    );

    captureQueue = {
      path: queuePath,
      items,
      bytes: Buffer.byteLength(JSON.stringify(items)),
    };

    return captureQueue;
  }

  function persistCaptureQueue() {
    if (!captureQueue) return;
    ensureDirSync(path.dirname(captureQueue.path));
    const rawJson = JSON.stringify({ items: captureQueue.items }, null, 2);
    let dataToWrite = rawJson;
    const { safeStorage } = require("electron");
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      dataToWrite = safeStorage.encryptString(rawJson);
    }
    const tempPath = `${captureQueue.path}.tmp`;
    fs.writeFileSync(tempPath, dataToWrite);
    fs.renameSync(tempPath, captureQueue.path);
    
    try {
      onQueueStatsChanged({ pendingCount: captureQueue.items.length });
    } catch (e) {
      logger.warn("CAPTURE QUEUE STATS CALLBACK FAILED", { error: e?.message });
    }
  }

  function clearCaptureQueueFlushTimer() {
    if (captureQueueFlushTimer) {
      clearTimeout(captureQueueFlushTimer);
      captureQueueFlushTimer = null;
    }
  }

  function scheduleCaptureQueueFlush(reason = "capture-queue") {
    if (isQuitting()) return;
    if (captureQueueFlushTimer) return;

    captureQueueFlushTimer = setTimeout(async () => {
      captureQueueFlushTimer = null;

      if (isQuitting()) return;

      const currentTok = getCurrentToken();
      if (!currentTok || !isUsableAccessToken(currentTok)) return;

      try {
        const result = await flushCaptureQueueIfPossible();
        if ((result?.flushed || 0) > 0 || (captureQueue?.items?.length || 0) > 0) {
          scheduleCaptureQueueFlush(`${reason}:retry`);
        }
      } catch (err) {
        logger.warn("CAPTURE QUEUE FLUSH RETRY FAILED", { reason, error: err?.message });
        scheduleCaptureQueueFlush(`${reason}:error`);
      }
    }, captureQueueFlushDelayMs);
  }

  function sanitizeCapturePayload(payload) {
    try {
      const cloned = JSON.parse(JSON.stringify(payload));
      delete cloned?.token;
      delete cloned?.refreshToken;
      delete cloned?.authorization;
      delete cloned?.Authorization;
      delete cloned?.cookie;
      return {
        kind: payload?.kind || "activity",
        payload: cloned,
      };
    } catch {
      return null;
    }
  }

  function pushCaptureForLater(kind, payload) {
    try {
      const q = loadCaptureQueueIfNeeded();
      const safe = sanitizeCapturePayload({ kind, ...payload });
      if (!safe) return false;

      const entry = {
        id: crypto.randomBytes(8).toString("hex"),
        createdAt: new Date().toISOString(),
        kind,
        payload: safe.payload,
      };

      const newItems = q.items.concat([entry]);

      while (newItems.length > captureQueueMaxItems) dropOldestEvictable(newItems);

      let bytes = Buffer.byteLength(JSON.stringify(newItems));
      while (bytes > captureQueueMaxBytes && newItems.length > 1) {
        dropOldestEvictable(newItems);
        bytes = Buffer.byteLength(JSON.stringify(newItems));
      }

      q.items = newItems;
      q.bytes = bytes;

      persistCaptureQueue();
      scheduleCaptureQueueFlush("push");
      return true;
    } catch (err) {
      logger.warn("CAPTURE QUEUE PUSH FAILED", { error: err?.message });
      return false;
    }
  }

  async function flushCaptureQueueIfPossible() {
    if (!captureQueue || !captureQueue.items || captureQueue.items.length === 0) {
      loadCaptureQueueIfNeeded();
    }

    if (!captureQueue || !captureQueue.items || captureQueue.items.length === 0) return { flushed: 0 };

    const currentTok = getCurrentToken();
    if (!currentTok || !isUsableAccessToken(currentTok)) return { flushed: 0 };

    const itemsToFlush = captureQueue.items.slice(0, 100);

    // Les idees ne peuvent pas partir dans /api/activity/batch : elles ont leur propre
    // endpoint et leur propre cle d'idempotence. On separe donc les deux flux.
    const brainDumps = itemsToFlush.filter((it) => it?.kind === CAPTURE_KIND_BRAIN_DUMP);
    const activityEvents = itemsToFlush.filter((it) => it?.kind !== CAPTURE_KIND_BRAIN_DUMP);

    // On retire par identifiant et non par position : les deux flux echouent
    // independamment, la file n'est donc plus consommee comme un simple prefixe.
    const flushedIds = new Set();
    let flushed = 0;

    const authConfig = {
      timeout: 15000,
      headers: { Cookie: `access_token=${currentTok}` },
      validateStatus: () => true,
    };

    for (const item of brainDumps) {
      try {
        const response = await axios.post(
          `${apiUrl}/api/brain-dump-captures`,
          {
            raw_text: item.payload?.raw_text,
            source: item.payload?.source || "spotlight",
            // L'id de l'entree sert de cle d'idempotence : si un POST a reussi cote
            // serveur mais que la reponse a expire, le rejeu ne cree pas de doublon.
            client_capture_id: item.payload?.client_capture_id || item.id,
          },
          authConfig,
        );

        if (!response || response.status < 200 || response.status >= 300) {
          throw createResponseError(
            `Brain dump flush failed with status ${response?.status}`,
            response,
          );
        }

        flushedIds.add(item.id);
      } catch (err) {
        handleAuthExpired(err);
        // L'idee reste en file : elle sera rejouee au prochain flush.
        logger.warn("BRAIN DUMP FLUSH FAILED", { error: err?.message });
      }
    }

    if (activityEvents.length > 0) {
      try {
      const payload = { events: activityEvents };
      const response = await axios.post(`${apiUrl}/api/activity/batch`, payload, authConfig);

      if (!response || response.status < 200 || response.status >= 300) {
        throw createResponseError(
          `Queue flush batch failed with status ${response?.status}`,
          response,
        );
      }

      // --- TDAH NUDGES ---
      let failedEvents = [];
      if (response.data) {
        failedEvents = response.data.failed || response.data.errors || [];

        const { powerMonitor, Notification } = require("electron");
        if (Notification && Notification.isSupported()) {
          const now = Date.now();
          if (now - lastNudgeTime > NUDGE_COOLDOWN_MS) {
            
            // 1. Timer Oublié
            if (response.data.hasActiveTimer === false) {
              const systemIdleTime = powerMonitor ? powerMonitor.getSystemIdleTime() : 0;
              // Si l'utilisateur a bougé la souris récemment (pas inactif)
              if (systemIdleTime < 60) {
                const notif = new Notification({
                  title: "🧠 ChronoMAD - Timer Oublié ?",
                  body: "Tu as l'air concentré ! N'oublie pas de lancer ton timer si tu travailles.",
                });
                notif.show();
                lastNudgeTime = now;
              }
            } 
            // 2. Distraction Awareness Layer (Smart Focus Shield)
            else if (response.data.hasActiveTimer === true) {
              const distractions = ['youtube', 'facebook', 'instagram', 'tiktok', 'reddit', 'twitter', 'x.com', 'netflix'];
              const isDistracted = activityEvents.some(it => {
                if (it.kind === "activity_post" && it.payload) {
                  const txt = (it.payload.window_title + " " + it.payload.app_name).toLowerCase();
                  return distractions.some(d => txt.includes(d));
                }
                return false;
              });

              if (isDistracted) {
                const notif = new Notification({
                  title: "🛡️ Smart Focus Shield",
                  body: "Distraction détectée. Pause assumée ou retour au focus ?",
                });
                notif.show();
                lastNudgeTime = now;
              }
            }
          }
        }
      }

      if (failedEvents.length === 0) {
        activityEvents.forEach((it) => flushedIds.add(it.id));
      } else {
        logger.warn("BATCH FLUSH PARTIAL FAILURE - re-queuing failed events", {
          failedCount: failedEvents.length,
          failed: failedEvents,
        });
        // do not remove - keep failed items for retry
      }
      } catch (err) {
        handleAuthExpired(err);
        logger.warn("BATCH FLUSH FAILED", { error: err?.message });
        // Keep items in queue on failure
      }
    }

    if (flushedIds.size > 0) {
      captureQueue.items = captureQueue.items.filter((it) => !flushedIds.has(it.id));
      flushed = flushedIds.size;
    }

    captureQueue.bytes = Buffer.byteLength(JSON.stringify(captureQueue.items));

    persistCaptureQueue();

    if (flushed > 0) {
      logger.info("CAPTURE QUEUE FLUSHED", { flushed });
    }

    if (captureQueue.items.length > 0) {
      scheduleCaptureQueueFlush("remaining");
    } else {
      clearCaptureQueueFlushTimer();
    }

    return { flushed };
  }

  function getCaptureQueueSummary() {
    const q = captureQueue || loadCaptureQueueIfNeeded();
    return {
      cachedCaptures: q.items?.length || 0,
      queuePath: q.path,
    };
  }

  function stop() {
    clearCaptureQueueFlushTimer();
  }

  return {
    pushCaptureForLater,
    flushCaptureQueueIfPossible,
    getCaptureQueueSummary,
    stop,
  };
}

module.exports = { createCaptureQueue, CAPTURE_KIND_BRAIN_DUMP };
