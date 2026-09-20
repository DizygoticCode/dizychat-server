'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('guest live soundboard routes share a bounded per-IP admission guard', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const server = fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');

  assert.match(server, /const soundboardLiveAdmission = createPublicMediaAdmissionController\(\{/);
  assert.match(
    server,
    /SOUNDBOARD_LIVE_MAX_STARTS_PER_WINDOW', 60, \{ min: 10, max: 600 \}/,
  );
  assert.match(
    server,
    /SOUNDBOARD_LIVE_MAX_CONCURRENT_PER_IP', 4, \{ min: 1, max: 20 \}/,
  );
  assert.match(
    server,
    /SOUNDBOARD_LIVE_RATE_WINDOW_SECONDS', 60, \{ min: 10, max: 60 \* 60 \}/,
  );

  assert.match(
    server,
    /app\.get\('\/api\/soundboards\/live-search', guardSoundboardLiveLookup, async/,
  );
  assert.match(
    server,
    /app\.get\('\/api\/soundboards\/live-board', guardSoundboardLiveLookup, async/,
  );
  assert.match(
    server,
    /app\.get\('\/api\/soundboards\/live-clip', guardSoundboardLiveLookup, async/,
  );

  assert.match(server, /res\.setHeader\('Retry-After', String\(retryAfterSeconds\)\)/);
  assert.match(server, /code: 'SOUNDBOARD_LIVE_RATE_LIMIT'/);
  assert.match(server, /res\.once\('finish', release\)/);
  assert.match(server, /res\.once\('close', release\)/);
  assert.match(server, /logSecurityEvent\('soundboard_live_lookup_rate_limited'/);
});
