const activityQueue = require("../utils/activityQueue");

function normalizeWindowTitle(title) {
  return String(title ?? "").trim();
}

function normalizeAppName(appName) {
  return String(appName ?? "").trim();
}

// Map des événements de tracking => batch event schema backend
function addActivityPostFromPayload(payload) {
  // payload doit contenir: app_name, window_title, captured_at, duration_seconds, etc.
  activityQueue.add({
    kind: "activity_post",
    payload,
  });
}

function addWindowLogsPost(windowsPayload) {
  activityQueue.add({
    kind: "activity_windows_post",
    payload: {
      windows: windowsPayload.windows,
      duration_seconds: windowsPayload.duration_seconds,
      is_idle: windowsPayload.is_idle,
      idle_seconds: windowsPayload.idle_seconds,
    },
  });
}

function addActivityDurationPatch({ activityId, duration_seconds, is_idle, idle_seconds }) {
  activityQueue.add({
    kind: "activity_duration_patch",
    payload: {
      activity_id: activityId,
      duration_seconds,
      is_idle,
      idle_seconds,
    },
  });
}

module.exports = {
  addActivityPostFromPayload,
  addWindowLogsPost,
  addActivityDurationPatch,
};
