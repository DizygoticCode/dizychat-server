const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');

function collectTests(dir, matcher) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTests(fullPath, matcher));
    } else if (entry.isFile() && matcher(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

const files = [
  ...collectTests(path.join(repoRoot, 'scripts', 'tests'), (name) => name.endsWith('.test.mjs')),
  ...collectTests(path.join(repoRoot, 'tests'), (name) => name.endsWith('.test.js')),
].sort();

if (!files.length) {
  console.error('No deterministic tests found.');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: repoRoot,
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
