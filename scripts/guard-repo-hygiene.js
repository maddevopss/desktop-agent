const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const ignoredDirs = new Set(['.git', 'node_modules']);
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

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    const relative = path.relative(repoRoot, fullPath);

    if (!isAllowedEnvExample(relative) && forbiddenPathPatterns.some((pattern) => pattern.test(relative))) {
      files.push(relative);
      continue;
    }

    if (entry.isDirectory()) walk(fullPath, files);
  }
  return files;
}

const violations = walk(repoRoot);

if (violations.length) {
  console.error('\nMADSuite desktop-agent artifact hygiene guard failed.\n');
  violations.forEach((violation) => console.error(`- ${violation}`));
  console.error('\nRemove generated installers, signing files, build outputs, or env files before merging.\n');
  process.exit(1);
}

console.log('Desktop-agent artifact hygiene guard passed.');
