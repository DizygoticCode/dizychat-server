const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const configPath = path.join(__dirname, '..', 'public', 'app-config.js');
const securityRunbookPath = path.join(__dirname, '..', 'docs', 'security-runbook.md');
const serverPath = path.join(__dirname, '..', 'index.js');
const readmePath = path.join(__dirname, '..', 'README.md');
const gitignorePath = path.join(__dirname, '..', '.gitignore');
const soundboardKeepPath = path.join(__dirname, '..', 'public', 'soundboards', '.gitkeep');
const source = fs.readFileSync(configPath, 'utf8');
const securityRunbookSource = fs.readFileSync(securityRunbookPath, 'utf8');
const serverSource = fs.readFileSync(serverPath, 'utf8');
const readmeSource = fs.readFileSync(readmePath, 'utf8');
const gitignoreSource = fs.readFileSync(gitignorePath, 'utf8');

assert.doesNotMatch(source, /onrender\.com/i, 'browser config must not reference Render');
assert.doesNotMatch(securityRunbookSource, /\bRender\b/i, 'security runbook must describe self-hosted edge controls');
assert.doesNotMatch(serverSource, /\bRender\b/i, 'server runtime copy must not reference retired Render hosting');
assert.doesNotMatch(
  readmeSource,
  /Media uploads with antivirus scanning|Streams uploads to OPSWAT MetaDefender Cloud; rejects infected files|Accepts an allowlisted set of common/i,
  'README must not claim upload antivirus or file-type enforcement while those runtime gates are disabled'
);
assert.match(source, /socketUrl:\s*""/, 'web clients should use the current origin');
assert.match(
  source,
  /defaultNativeSocketUrl:\s*"https:\/\/dizychat\.com"/,
  'native clients should default to the self-hosted public origin'
);
assert.match(
  gitignoreSource,
  /^public\/soundboards$/m,
  'production soundboard runtime mount must be ignored as a path so a symlink does not dirty Git'
);
assert.match(
  gitignoreSource,
  /^public\/uploads$/m,
  'production upload runtime mount must be ignored as a path so a symlink does not dirty Git'
);
assert.equal(
  fs.existsSync(soundboardKeepPath),
  false,
  'runtime soundboard path must not contain a tracked placeholder that conflicts with the production symlink'
);

console.log('self-host config contract passed');
