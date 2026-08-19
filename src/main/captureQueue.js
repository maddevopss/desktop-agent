const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Les idees capturees via le Spotlight global sont irremplacables : contrairement a une
// capture d'activite (re-echantillonnee en continu), une idee perdue l'est definitivement.
// Ce kind est donc protege de l'eviction FIFO quand la file sature.
const CAPTURE_KIND_BRAIN_DUMP = "brain_dump_capture";

/**
 * Retire de la file le plus ancien element evincable, en epargnant les captures de
 * decharge mentale tant qu'il reste autre chose a sacrifier.
 * @param {Array<{ kind?: string }>} items - File modifiee en place.
 * @returns {boolean} True si un element a ete retire.
 */
function dropOldestEvictable(items) {
  const index = items.findIndex((it) => it?.kind !== CAPTURE_KIND_BRAIN_DUMP);

  // Plus rien d'autre a jeter : on sacrifie la plus ancienne idee, faute de mieux.
  items.splice(index === -1 ? 0 : index, 1);
  return items.length > 0;
}

function createCaptureQueue({
  apiUrl,
  app,
  getCurrentToken,
  isUsableAccessToken,
  logger,
  isQuitting = () => false,
}) {
  const captureQueueMaxItems = Number(process.env.AGENT_CAPTURE_QUEUE_MAX_ITEMS || 200);
  const captureQueueMaxBytes = Number(process.env.AGENT_CAPTURE_QUEUE_MAX_BYTES || 2_000_000);
  const captureQueueTtlMs = Number(process.env.AGENT_CAPTURE_QUEUE_TTL_MS || 7 * 24 * 3600_000);
  const captureQueueFlushDelayMs = Number(process.env.AGENT_CAPTURE_QUEUE_FLUSH_DELAY_MS || 30_000);

  let captureQueue = null;
  let captureQueueFlushTimer = null;

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
        const raw = fs.readFileSync(queuePath, "utf8");
        const parsed = JSON.parse(raw);
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
    fs.writeFileSync(captureQueue.path, JSON.stringify({ items: captureQueue.items }, null, 2), "utf8");
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

    const itemsToFlush = captureQueue.items.slice(0, 25);
    let flushed = 0;
    const remaining = [];

    for (const it of itemsToFlush) {
      try {
        if (!it?.payload) continue;

        const authConfig = {
          timeout: 10000,
          headers: { Cookie: `access_token=${currentTok}` },
          validateStatus: () => true,
        };

        let response = null;
        if (it.kind === "activity_post") {
          response = await axios.post(`${apiUrl}/api/activity`, it.payload, authConfig);
        } else if (it.kind === "activity_windows_post") {
          response = await axios.post(`${apiUrl}/api/activity/windows`, it.payload, authConfig);
        } else if (it.kind === CAPTURE_KIND_BRAIN_DUMP) {
          response = await axios.post(
            `${apiUrl}/api/brain-dump-captures`,
            {
              raw_text: it.payload.raw_text,
              source: it.payload.source || "spotlight",
              // L'id de l'entree de file sert de cle d'idempotence : si un POST a reussi
              // cote serveur mais que la reponse a expire, le rejeu renvoie 200 sans doublon.
              client_capture_id: it.payload.client_capture_id || it.id,
            },
            authConfig,
          );
        } else if (it.kind === "activity_duration_patch") {
          response = await axios.patch(
            `${apiUrl}/api/activity/${it.payload.activity_id}/duration`,
            {
              duration_seconds: it.payload.duration_seconds,
              is_idle: it.payload.is_idle,
              idle_seconds: it.payload.idle_seconds,
            },
            authConfig,
          );
        }

        if (!response || response.status < 200 || response.status >= 300) {
          throw new Error(`Queue flush failed with status ${response?.status}`);
        }

        flushed += 1;
      } catch {
        remaining.push(it);
      }
    }

    const notAttempted = captureQueue.items.slice(itemsToFlush.length);
    captureQueue.items = remaining.concat(notAttempted);
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
