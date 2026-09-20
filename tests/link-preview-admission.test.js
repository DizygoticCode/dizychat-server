'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('public link preview route has bounded per-IP request admission', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const server = fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');

  assert.match(
    server,
    /const linkPreviewAdmission = createPublicMediaAdmissionController\(\{/,
  );
  assert.match(
    server,
    /LINK_PREVIEW_MAX_STARTS_PER_WINDOW', 30, \{ min: 5, max: 300 \}/,
  );
  assert.match(
    server,
    /LINK_PREVIEW_MAX_CONCURRENT_PER_IP', 3, \{ min: 1, max: 10 \}/,
  );
  assert.match(
    server,
    /LINK_PREVIEW_RATE_WINDOW_SECONDS', 60, \{ min: 10, max: 60 \* 60 \}/,
  );
  assert.match(
    server,
    /app\.get\('\/link-preview', guardLinkPreview, async/,
  );
  assert.match(server, /res\.setHeader\('Retry-After', String\(retryAfterSeconds\)\)/);
  assert.match(server, /res\.status\(429\)\.json\(\{ error: 'Too many link preview requests/);
  assert.match(server, /res\.once\('finish', release\)/);
  assert.match(server, /res\.once\('close', release\)/);
  assert.match(server, /logSecurityEvent\('link_preview_rate_limited'/);
});
