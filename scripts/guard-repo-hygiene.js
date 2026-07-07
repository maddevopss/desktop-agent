const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const forbiddenPathPatterns = [
  /(^|[\\/])\.env($|\.)/,
  /(^|[\\/])dist([\\/]|$)/,
  /(^|[\\/])dist-ci([\\/]|$)/,
  /(^|[\\/])release([\\/]|$)/,
  /(^|[\\/]).*\.(exe|msi|dmg|AppImage|p12|pfx)$/i,
];

function isAllowedEnvExample(relative) {
  return relative === '.env.example' || relative.endsWith(`${path.sep}.env.example`) || relative.endsWith('/.env.example');
}

function listGitVisibleFiles() {
  const output = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  return output.split('\0').filter(Boolean);
}

const violations = listGitVisibleFiles().filter(
  (relative) => !isAllowedEnvExample(relative) && forbiddenPathPatterns.some((pattern) => pattern.test(relative)),
);

if (violations.length) {
  console.error('\nMADSuite desktop-agent artifact hygiene guard failed.\n');
  violations.forEach((violation) => console.error(`- ${violation}`));
  console.error('\nRemove generated installers, signing files, build outputs, or env files before merging.\n');
  process.exit(1);
}

console.log('Desktop-agent artifact hygiene guard passed.');
