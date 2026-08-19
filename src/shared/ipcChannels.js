const INVOKE_CHANNELS = Object.freeze([
  "login",
  "start-tracking",
  "stop-tracking",
  "start-task",
  "stop-task",
  "toggle-focus-widget",
  "timer-sync",
  "timer-command",
  "get-revenue",
  "send-brain-dump",
  "hide-brain-dump-widget",
  "restore-token",
  "get-stored-token",
  "refresh-token",
  "agent-token-refreshed",
  "agent-refresh-failed",
  "get-tracking-interval",
  "set-tracking-interval",
  "get-privacy-settings",
  "set-privacy-settings",
  "delete-activity-history",
  "export-diagnostics",
  "test-notification",
  "get-autostart",
  "set-autostart",
]);

const SUBSCRIBE_CHANNELS = Object.freeze([
  "protocol-auth-token",
  "agent-refresh-needed",
  "agent-state-changed",
  "agent-token-refreshed",
  "session-expired",
  "app-close",
  "auth-expired",
  "timer-updated",
  "timer-command",
  "onSyncStatusUpdate",
]);

const INVOKE_CHANNEL_SET = new Set(INVOKE_CHANNELS);
const SUBSCRIBE_CHANNEL_SET = new Set(SUBSCRIBE_CHANNELS);

function assertAllowedInvokeChannel(channel) {
  if (!INVOKE_CHANNEL_SET.has(channel)) {
    throw new Error(`Canal IPC invoke interdit : ${String(channel)}`);
  }
  return channel;
}

function assertAllowedSubscribeChannel(channel) {
  if (!SUBSCRIBE_CHANNEL_SET.has(channel)) {
    throw new Error(`Canal IPC subscribe interdit : ${String(channel)}`);
  }
  return channel;
}

module.exports = {
  INVOKE_CHANNELS,
  SUBSCRIBE_CHANNELS,
  assertAllowedInvokeChannel,
  assertAllowedSubscribeChannel,
};
