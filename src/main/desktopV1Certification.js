'use strict';

const REQUIRED_CONTROLS = Object.freeze([
  'secure_bootstrap',
  'session_scoped_storage',
  'bounded_retries',
  'immediate_tracking_pause',
  'offline_queue_recovery',
  'ipc_least_privilege',
  'renderer_node_isolation',
  'backend_unavailable_recovery',
  'artifact_integrity_manifest',
  'human_release_approval'
]);

function evaluateDesktopV1Certification(evidence = {}) {
  const controls = evidence.controls || {};
  const missing = REQUIRED_CONTROLS.filter((control) => controls[control] !== true);
  const sourceCommit = String(evidence.sourceCommit || '').trim();
  const artifactSha256 = String(evidence.artifactSha256 || '').trim();
  const approvedBy = String(evidence.approvedBy || '').trim();

  if (!sourceCommit) missing.push('source_commit');
  if (!/^[a-f0-9]{64}$/i.test(artifactSha256)) missing.push('artifact_sha256');
  if (!approvedBy) missing.push('approved_by');

  return Object.freeze({
    certified: missing.length === 0,
    status: missing.length === 0 ? 'certified' : 'blocked',
    missing: Object.freeze([...new Set(missing)]),
    evaluatedAt: new Date().toISOString()
  });
}

module.exports = {
  REQUIRED_CONTROLS,
  evaluateDesktopV1Certification
};
