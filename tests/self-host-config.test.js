const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const configPath = path.join(__dirname, '..', 'public', 'app-config.js');
const source = fs.readFileSync(configPath, 'utf8');

assert.doesNotMatch(source, /onrender\.com/i, 'browser config must not reference Render');
assert.match(source, /socketUrl:\s*""/, 'web clients should use the current origin');
assert.match(
  source,
  /defaultNativeSocketUrl:\s*"https:\/\/dizychat\.com"/,
  'native clients should default to the self-hosted public origin'
);

console.log('self-host config contract passed');
