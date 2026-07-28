'use strict';

const {
  REQUIRED_CONTROLS,
  evaluateDesktopV1Certification
} = require('../src/main/desktopV1Certification');

describe('desktop V1 certification', () => {
  const validEvidence = () => ({
    controls: Object.fromEntries(REQUIRED_CONTROLS.map((control) => [control, true])),
    sourceCommit: 'abc123',
    artifactSha256: 'a'.repeat(64),
    approvedBy: 'release-owner'
  });

  test('certifies only a complete evidence set', () => {
    expect(evaluateDesktopV1Certification(validEvidence())).toMatchObject({
      certified: true,
      status: 'certified',
      missing: []
    });
  });

  test('blocks when runtime, artifact or approval evidence is missing', () => {
    const evidence = validEvidence();
    evidence.controls.bounded_retries = false;
    evidence.artifactSha256 = 'invalid';
    evidence.approvedBy = '';

    expect(evaluateDesktopV1Certification(evidence)).toMatchObject({
      certified: false,
      status: 'blocked',
      missing: expect.arrayContaining([
        'bounded_retries',
        'artifact_sha256',
        'approved_by'
      ])
    });
  });
});
