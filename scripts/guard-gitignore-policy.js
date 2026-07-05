const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const content = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');

const requiredRules = [
  'node_modules/',
  'dist/',
  'dist-ci/',
  'release/',
  '*.exe',
  '*.msi',
  '*.p12',
  '*.pfx',
  '.env',
  '.env.*',
  '!.env.example',
];

const lines = content.split(/\r?\n/);
const missing = requiredRules.filter((rule) => !lines.includes(rule));

if (missing.length) {
  console.error('\nMADSuite desktop-agent .gitignore policy failed.\n');
  missing.forEach((rule) => console.error(`- missing: ${rule}`));
  process.exit(1);
}

console.log('Desktop-agent .gitignore policy passed.');
