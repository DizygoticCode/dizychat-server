const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverPath = path.join(__dirname, '..', 'index.js');
const serverSource = fs.readFileSync(serverPath, 'utf8');

assert.doesNotMatch(
  serverSource,
  /\bRender\b/i,
  'server runtime copy must not reference retired Render hosting'
);
assert.doesNotMatch(
  serverSource,
  /Add W2G_API_KEY in Render/i,
  'Watch2Gether setup guidance must point to the protected runtime environment'
);

console.log('self-host runtime copy contract passed');
