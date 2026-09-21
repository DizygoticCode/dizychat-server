'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { readBoundedBody } = require('../src/security/public-media-proxy-guard');

test('bounded upstream body reader rejects streamed bodies above the byte cap', async () => {
  let chunksRead = 0;
  const response = {
    headers: { get: () => null },
    body: {
      async *[Symbol.asyncIterator]() {
        chunksRead += 1;
        yield Buffer.from('1234');
        chunksRead += 1;
        yield Buffer.from('56789');
        chunksRead += 1;
        yield Buffer.from('ignored');
      },
    },
  };

  await assert.rejects(
    readBoundedBody(response, 8),
    (error) => error?.code === 'UPSTREAM_RESPONSE_TOO_LARGE',
  );
  assert.equal(chunksRead, 2);
});

test('public Psybin metadata proxy has per-IP admission and bounded upstream bodies', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const server = fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');

  assert.match(
    server,
    /PSYBIN_METADATA_MAX_BYTES = parsePositiveIntegerEnv\('PSYBIN_METADATA_MAX_BYTES', 512 \* 1024, \{ min: 1024, max: 4 \* 1024 \* 1024 \}\)/,
  );
  assert.match(
    server,
    /PSYBIN_TEXT_MAX_BYTES = parsePositiveIntegerEnv\('PSYBIN_TEXT_MAX_BYTES', 64 \* 1024, \{ min: 256, max: 1024 \* 1024 \}\)/,
  );
  assert.match(
    server,
    /const psybinMetadataAdmission = createPublicMediaAdmissionController\(\{/,
  );
  assert.match(
    server,
    /PSYBIN_METADATA_MAX_STARTS_PER_WINDOW', 30, \{ min: 6, max: 300 \}/,
  );
  assert.match(
    server,
    /PSYBIN_METADATA_MAX_CONCURRENT_PER_IP', 3, \{ min: 1, max: 10 \}/,
  );
  assert.match(
    server,
    /app\.get\('\/api\/psybin\/now-playing', guardPsybinMetadata, async/,
  );
  assert.match(server, /res\.setHeader\('Retry-After', String\(retryAfterSeconds\)\)/);
  assert.match(server, /error: 'RATE_LIMITED'/);
  assert.match(server, /readBoundedBody\(response, PSYBIN_METADATA_MAX_BYTES\)/);
  assert.match(server, /readBoundedBody\(songResponse, PSYBIN_TEXT_MAX_BYTES\)/);
  assert.match(server, /readBoundedBody\(timeResponse, PSYBIN_TEXT_MAX_BYTES\)/);
});
