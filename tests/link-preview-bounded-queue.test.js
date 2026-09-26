'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  createPublicMediaAdmissionController,
  createQueuedPublicMediaAdmissionController,
} = require('../src/security/public-media-proxy-guard');

test('requests sharing the same gateway IP wait FIFO instead of exceeding active cap', async () => {
  const original = createPublicMediaAdmissionController({ maxConcurrent: 1, maxStarts: 10 });
  const gate = createQueuedPublicMediaAdmissionController({ admission: original });

  const first = await gate.acquire('192.168.1.1');
  const second = gate.acquire('192.168.1.1');
  const third = gate.acquire('192.168.1.1');
  assert.equal(first.ok, true);
  assert.equal(gate.getPendingCount(), 2);

  first.release();
  const held = await second;
  assert.equal(held.ok, true);
  assert.equal(gate.getPendingCount(), 1);
  const bypass = original.acquire('192.168.1.1');
  assert.equal(bypass.code, 'PUBLIC_MEDIA_CONCURRENCY_LIMIT');

  held.release();
  const last = await third;
  assert.equal(last.ok, true);
  last.release();
  assert.equal(gate.getPendingCount(), 0);
  assert.equal(gate.getPendingClientCount(), 0);
});

test('rate limits still reject queued requests once the original budget is exhausted', async () => {
  const original = createPublicMediaAdmissionController({ maxConcurrent: 1, maxStarts: 2 });
  const gate = createQueuedPublicMediaAdmissionController({ admission: original });
  const first = await gate.acquire('same-ip');
  const second = gate.acquire('same-ip');
  const third = gate.acquire('same-ip');
  first.release();
  const held = await second;
  assert.equal(held.ok, true);
  held.release();
  const denied = await third;
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'PUBLIC_MEDIA_RATE_LIMIT');
  assert.equal(gate.getPendingCount(), 0);
});

test('queue limits preserve explicit per-IP and global abuse bounds', async () => {
  const original = createPublicMediaAdmissionController({ maxConcurrent: 1, maxStarts: 10 });
  const gate = createQueuedPublicMediaAdmissionController({
    admission: original,
    maxPendingPerKey: 1,
    maxPendingTotal: 1,
  });
  const a = await gate.acquire('client-a');
  const b = await gate.acquire('client-b');
  const queued = gate.acquire('client-a');

  const overPerIp = await gate.acquire('client-a');
  const overGlobal = await gate.acquire('client-b');
  assert.equal(overPerIp.code, 'PUBLIC_MEDIA_CONCURRENCY_LIMIT');
  assert.equal(overGlobal.code, 'PUBLIC_MEDIA_CONCURRENCY_LIMIT');
  assert.equal(gate.getPendingCount(), 1);

  a.release();
  (await queued).release();
  b.release();
  assert.equal(gate.getPendingCount(), 0);
});

test('aborted browser requests vacate their queue position without consuming starts', async () => {
  const original = createPublicMediaAdmissionController({ maxConcurrent: 1, maxStarts: 2 });
  const gate = createQueuedPublicMediaAdmissionController({ admission: original });
  const first = await gate.acquire('browser-ip');
  const controller = new AbortController();
  const abandoned = gate.acquire('browser-ip', { signal: controller.signal });
  assert.equal(gate.getPendingCount(), 1);
  controller.abort();

  assert.equal((await abandoned).code, 'PUBLIC_MEDIA_CLIENT_CLOSED');
  assert.equal(gate.getPendingCount(), 0);
  first.release();

  const next = await gate.acquire('browser-ip');
  assert.equal(next.ok, true, 'abandoned waiting request must not spend the second start');
  next.release();
  assert.equal((await gate.acquire('browser-ip')).code, 'PUBLIC_MEDIA_RATE_LIMIT');
});

test('timed-out queue entries are removed and never acquired after release', async () => {
  const timers = [];
  const original = createPublicMediaAdmissionController({ maxConcurrent: 1, maxStarts: 2 });
  const gate = createQueuedPublicMediaAdmissionController({
    admission: original,
    setTimer: (callback) => { timers.push(callback); return timers.length; },
    clearTimer: () => {},
  });
  const first = await gate.acquire('browser-ip');
  const late = gate.acquire('browser-ip');
  assert.equal(gate.getPendingCount(), 1);
  timers[0]();
  assert.equal((await late).code, 'PUBLIC_MEDIA_CONCURRENCY_LIMIT');
  assert.equal(gate.getPendingCount(), 0);
  first.release();
  const next = await gate.acquire('browser-ip');
  assert.equal(next.ok, true);
  next.release();
});

test('the queued guard only wraps link previews; all other public media limits stay unchanged', () => {
  const root = path.resolve(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'server-core.js'), 'utf8');
  assert.match(server, /createQueuedPublicMediaAdmissionController\(\{\s*admission: linkPreviewAdmission,/);
  assert.match(server, /const guardLinkPreview = async \(req, res, next\)/);
  assert.match(server, /queuedLinkPreviewAdmission\.acquire\(/);
  assert.match(server, /if \(waitAbort\.signal\.aborted\) \{\s*if \(admission\.ok\) admission\.release\(\);/);
  assert.match(server, /res\.once\('finish', release\)/);
  assert.match(server, /res\.once\('close', release\)/);
  assert.match(server, /maxConcurrent: parsePositiveIntegerEnv\('LINK_PREVIEW_MAX_CONCURRENT_PER_IP', 3/);
  assert.match(server, /maxStarts: parsePositiveIntegerEnv\('LINK_PREVIEW_MAX_STARTS_PER_WINDOW', 30/);
});
