'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createUploadAdmissionController,
  readUploadAbuseLimits,
} = require('../src/uploads/upload-abuse-guard');

const repoRoot = path.resolve(__dirname, '..');

test('upload abuse guard permits normal sequential uploads', () => {
  let now = 1_000_000;
  const guard = createUploadAdmissionController({
    now: () => now,
    maxStarts: 3,
    maxConcurrent: 2,
    windowMs: 60_000,
  });

  const first = guard.acquire('203.0.113.10');
  assert.equal(first.ok, true);
  first.release();

  now += 1000;
  const second = guard.acquire('203.0.113.10');
  assert.equal(second.ok, true);
  second.release();
});

test('upload abuse guard blocks excessive simultaneous uploads per client', () => {
  const guard = createUploadAdmissionController({
    maxStarts: 10,
    maxConcurrent: 2,
    windowMs: 60_000,
  });

  const first = guard.acquire('203.0.113.10');
  const second = guard.acquire('203.0.113.10');
  const third = guard.acquire('203.0.113.10');

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(third.ok, false);
  assert.equal(third.code, 'UPLOAD_CONCURRENCY_LIMIT');

  first.release();
  assert.equal(guard.acquire('203.0.113.10').ok, true);
  second.release();
});

test('upload abuse guard rate limits repeated starts without affecting another client', () => {
  let now = 2_000_000;
  const guard = createUploadAdmissionController({
    now: () => now,
    maxStarts: 2,
    maxConcurrent: 3,
    windowMs: 60_000,
  });

  for (let i = 0; i < 2; i += 1) {
    const admitted = guard.acquire('203.0.113.10');
    assert.equal(admitted.ok, true);
    admitted.release();
    now += 1000;
  }

  const limited = guard.acquire('203.0.113.10');
  assert.equal(limited.ok, false);
  assert.equal(limited.code, 'UPLOAD_RATE_LIMIT');
  assert.ok(limited.retryAfterMs > 0);

  const otherClient = guard.acquire('203.0.113.11');
  assert.equal(otherClient.ok, true);
  otherClient.release();

  now += 60_000;
  const recovered = guard.acquire('203.0.113.10');
  assert.equal(recovered.ok, true);
  recovered.release();
});

test('upload abuse limits are configurable but remain within safe bounds', () => {
  assert.deepEqual(readUploadAbuseLimits({}), {
    maxStarts: 20,
    maxConcurrent: 3,
    windowMs: 600_000,
  });

  assert.deepEqual(readUploadAbuseLimits({
    UPLOAD_MAX_STARTS_PER_WINDOW: '40',
    UPLOAD_MAX_CONCURRENT_PER_IP: '5',
    UPLOAD_RATE_WINDOW_SECONDS: '900',
  }), {
    maxStarts: 40,
    maxConcurrent: 5,
    windowMs: 900_000,
  });

  assert.equal(readUploadAbuseLimits({ UPLOAD_MAX_CONCURRENT_PER_IP: '999' }).maxConcurrent, 20);
  assert.equal(readUploadAbuseLimits({ UPLOAD_MAX_STARTS_PER_WINDOW: '1' }).maxStarts, 5);
});

test('production upload route applies the abuse guard before multer writes the body', () => {
  const server = fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');

  assert.match(
    server,
    /app\.post\('\/upload', validateUploadOrigin, guardUploadAbuse, uploadSingleMiddleware,/,
  );
  assert.match(server, /res\.once\('finish', release\)/);
  assert.match(server, /res\.once\('close', release\)/);
  assert.match(server, /Retry-After/);
});
