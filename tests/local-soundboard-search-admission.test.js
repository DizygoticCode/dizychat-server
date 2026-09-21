'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('public local soundboard search has a gentle per-IP admission guard', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const server = fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');

  assert.match(
    server,
    /SOUNDBOARD_LOCAL_MAX_STARTS_PER_WINDOW', 120, \{ min: 20, max: 1200 \}/,
  );
  assert.match(
    server,
    /SOUNDBOARD_LOCAL_MAX_CONCURRENT_PER_IP', 4, \{ min: 1, max: 20 \}/,
  );
  assert.match(
    server,
    /SOUNDBOARD_LOCAL_RATE_WINDOW_SECONDS', 60, \{ min: 10, max: 60 \* 60 \}/,
  );
  assert.match(server, /const guardSoundboardLocalLookup = \(req, res, next\) => \{/);
  assert.match(server, /soundboard_local_lookup_rate_limited/);
  assert.match(server, /code: 'SOUNDBOARD_LOCAL_RATE_LIMIT'/);
  assert.match(
    server,
    /app\.get\('\/soundboard-clips', guardSoundboardLocalLookup, \(req, res\) => \{/,
  );
});

test('local soundboard search bounds query inputs without changing normal response shape', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const server = fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');
  const start = server.indexOf("app.get('/soundboard-clips'");
  const end = server.indexOf("app.get('/api/watch-party/status'", start);
  assert.ok(start >= 0 && end > start);
  const route = server.slice(start, end);

  assert.match(route, /q\.trim\(\)\.slice\(0, 200\)/);
  assert.match(route, /board\.trim\(\)\.slice\(0, 120\)/);
  assert.match(route, /hits,/);
  assert.match(route, /total,/);
  assert.match(route, /totalHits: total/);
});
