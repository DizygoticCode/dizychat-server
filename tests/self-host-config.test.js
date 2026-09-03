const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const configPath = path.join(__dirname, '..', 'public', 'app-config.js');
const serverPath = path.join(__dirname, '..', 'index.js');
const source = fs.readFileSync(configPath, 'utf8');
const serverSource = fs.readFileSync(serverPath, 'utf8');

assert.doesNotMatch(source, /onrender\.com/i, 'browser config must not reference Render');
assert.doesNotMatch(serverSource, /\bRender\b/i, 'server source must not describe the runtime as Render-hosted');
assert.match(source, /socketUrl:\s*""/, 'web clients should use the current origin');
assert.match(
  source,
  /defaultNativeSocketUrl:\s*"https:\/\/dizychat\.com"/,
  'native clients should default to the self-hosted public origin'
);

console.log('self-host config contract passed');
