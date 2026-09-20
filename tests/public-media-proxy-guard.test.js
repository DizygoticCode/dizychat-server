'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createBoundedJsonFetcher,
  createPublicMediaAdmissionController,
  readPublicMediaProxyLimits,
} = require('../src/security/public-media-proxy-guard');

test('public media proxy guard permits normal requests and limits concurrent work per client', () => {
  const guard = createPublicMediaAdmissionController({
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
  assert.equal(third.code, 'PUBLIC_MEDIA_CONCURRENCY_LIMIT');

  first.release();
  const recovered = guard.acquire('203.0.113.10');
  assert.equal(recovered.ok, true);
  recovered.release();
  second.release();
});

test('public media proxy guard rate limits one client without affecting another', () => {
  let now = 1_000_000;
  const guard = createPublicMediaAdmissionController({
    now: () => now,
    maxStarts: 2,
    maxConcurrent: 4,
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
  assert.equal(limited.code, 'PUBLIC_MEDIA_RATE_LIMIT');
  assert.ok(limited.retryAfterMs > 0);

  const otherClient = guard.acquire('203.0.113.11');
  assert.equal(otherClient.ok, true);
  otherClient.release();

  now += 60_000;
  const recovered = guard.acquire('203.0.113.10');
  assert.equal(recovered.ok, true);
  recovered.release();
});

test('public media proxy guard evicts expired idle client state', () => {
  let now = 2_000_000;
  const guard = createPublicMediaAdmissionController({
    now: () => now,
    maxStarts: 10,
    maxConcurrent: 2,
    windowMs: 60_000,
  });

  const first = guard.acquire('203.0.113.10');
  first.release();
  assert.equal(guard.getTrackedClientCount(), 1);

  now += 61_000;
  const second = guard.acquire('203.0.113.11');
  second.release();
  assert.equal(guard.getTrackedClientCount(), 1);
});

test('public media proxy limits are configurable within safe bounds', () => {
  assert.deepEqual(readPublicMediaProxyLimits({}), {
    maxStarts: 60,
    maxConcurrent: 4,
    windowMs: 60_000,
    fetchTimeoutMs: 8000,
  });

  assert.deepEqual(readPublicMediaProxyLimits({
    PUBLIC_MEDIA_MAX_STARTS_PER_WINDOW: '120',
    PUBLIC_MEDIA_MAX_CONCURRENT_PER_IP: '6',
    PUBLIC_MEDIA_RATE_WINDOW_SECONDS: '120',
    PUBLIC_MEDIA_FETCH_TIMEOUT_MS: '12000',
  }), {
    maxStarts: 120,
    maxConcurrent: 6,
    windowMs: 120_000,
    fetchTimeoutMs: 12000,
  });

  assert.equal(readPublicMediaProxyLimits({ PUBLIC_MEDIA_MAX_CONCURRENT_PER_IP: '999' }).maxConcurrent, 20);
  assert.equal(readPublicMediaProxyLimits({ PUBLIC_MEDIA_FETCH_TIMEOUT_MS: '10' }).fetchTimeoutMs, 1000);
});

test('bounded public media JSON fetch times out through a stalled response body', async () => {
  let sawSignal = false;
  const fetchJson = createBoundedJsonFetcher({
    timeoutMs: 15,
    maxBytes: 1024,
    fetchImpl: async (_url, options = {}) => {
      const signal = options.signal;
      sawSignal = Boolean(signal);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: {
          async *[Symbol.asyncIterator]() {
            yield Buffer.from('{"ok":');
            await new Promise((resolve, reject) => {
              const abort = () => {
                const error = new Error('aborted');
                error.name = 'AbortError';
                reject(error);
              };
              if (signal?.aborted) return abort();
              signal?.addEventListener('abort', abort, { once: true });
            });
          },
        },
      };
    },
  });

  await assert.rejects(
    fetchJson('https://api.giphy.com/test'),
    (error) => error?.code === 'UPSTREAM_TIMEOUT',
  );
  assert.equal(sawSignal, true);
});

test('bounded public media JSON fetch stops streaming once the response cap is exceeded', async () => {
  let chunksRead = 0;
  const fetchJson = createBoundedJsonFetcher({
    timeoutMs: 1000,
    maxBytes: 8,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: {
        async *[Symbol.asyncIterator]() {
          chunksRead += 1;
          yield Buffer.from('{"a":');
          chunksRead += 1;
          yield Buffer.from('"12345"}');
          chunksRead += 1;
          yield Buffer.from('ignored');
        },
      },
    }),
  });

  await assert.rejects(
    fetchJson('https://tenor.com/oembed'),
    (error) => error?.code === 'UPSTREAM_RESPONSE_TOO_LARGE',
  );
  assert.equal(chunksRead, 2);
});

test('production GIPHY and Tenor routes use the shared public media proxy guard', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const server = fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');

  assert.match(
    server,
    /app\.get\('\/tenor-proxy', guardPublicMediaProxy, async/,
  );
  assert.match(
    server,
    /app\.get\('\/giphy-search', guardPublicMediaProxy, async/,
  );
  assert.match(server, /const fetchPublicMediaJson = createBoundedJsonFetcher/);
  assert.match(server, /res\.once\('finish', release\)/);
  assert.match(server, /res\.once\('close', release\)/);
  assert.match(server, /Retry-After/);
  assert.match(
    server,
    /fetchPublicMediaJson\(`https:\/\/tenor\.com\/oembed\?url=\$\{encodeURIComponent\(url\)\}`\)/,
  );
  assert.match(
    server,
    /const \{ response, data \} = await fetchPublicMediaJson\(`\$\{apiPath\}\?\$\{params\.toString\(\)\}`\)/,
  );
  assert.doesNotMatch(
    server,
    /app\.get\('\/giphy-search'[\s\S]{0,2200}await fetch\(`\$\{apiPath\}/,
  );
});
