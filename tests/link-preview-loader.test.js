'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createLinkPreviewLoader } = require('../public/link-preview-loader');

const tick = () => new Promise((resolve) => setImmediate(resolve));
const success = (title) => ({
  ok: true,
  status: 200,
  json: async () => ({ title }),
});

test('link preview metadata is serialized, deduplicated and cached per URL', async () => {
  let finishFirst;
  let active = 0;
  let maxActive = 0;
  const fetched = [];
  const loader = createLinkPreviewLoader({
    Observer: null,
    minGapMs: 0,
    fetchImpl: async (url) => {
      fetched.push(url);
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (url.includes('first')) await new Promise((resolve) => { finishFirst = resolve; });
      active -= 1;
      return success(url);
    },
  });

  const first = loader.request('https://example.com/first');
  const duplicate = loader.request('https://example.com/first');
  const second = loader.request('https://example.com/second');
  await tick();
  assert.equal(fetched.length, 1);
  finishFirst();
  const [firstData, duplicateData, secondData] = await Promise.all([first, duplicate, second]);

  assert.equal(maxActive, 1);
  assert.equal(fetched.length, 2);
  assert.deepEqual(firstData, duplicateData);
  assert.match(secondData.title, /second/);
  await loader.request('https://example.com/first');
  assert.equal(fetched.length, 2, 'successful previews should be reused');
});

test('link previews honor Retry-After on 429 rather than permanently dropping the card', async () => {
  const pauses = [];
  let attempts = 0;
  const loader = createLinkPreviewLoader({
    Observer: null,
    minGapMs: 0,
    wait: async (ms) => { pauses.push(ms); },
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) return {
        status: 429,
        ok: false,
        headers: { get: () => '2' },
      };
      return success('Recovered preview');
    },
  });

  assert.deepEqual(await loader.request('https://rumble.com/v1234'), { title: 'Recovered preview' });
  assert.equal(attempts, 2);
  assert.deepEqual(pauses, [2000]);
});

test('previews wait for viewport visibility and leave detached messages alone', async () => {
  let observer;
  let calls = 0;
  const container = {};
  class FakeObserver {
    constructor(callback, options) {
      observer = this;
      this.callback = callback;
      this.options = options;
    }
    observe(target) { this.target = target; }
    unobserve(target) { this.unobserved = target; }
  }

  const loader = createLinkPreviewLoader({
    fetchImpl: async () => { calls += 1; return success('Visible preview'); },
    Observer: FakeObserver,
    DomObserver: null,
    container,
    minGapMs: 0,
  });

  const node = { isConnected: true };
  const pending = loader.request('https://www.amazon.com/dp/123', node);
  await tick();
  assert.equal(calls, 0, 'historical messages should not fetch previews out of view');
  assert.equal(observer.options.root, container);
  observer.callback([{ target: node, isIntersecting: true }]);
  assert.deepEqual(await pending, { title: 'Visible preview' });
  assert.equal(calls, 1);
  assert.equal(observer.unobserved, node);

  const detached = { isConnected: false };
  assert.equal(await loader.request('https://example.com/detached', detached), null);
  assert.equal(calls, 1);
});

test('detaching a historical message clears its pending visibility work', async () => {
  let domObserver;
  const container = {};
  class FakeIntersectionObserver {
    constructor(callback) { this.callback = callback; }
    observe() {}
    unobserve() {}
  }
  class FakeMutationObserver {
    constructor(callback) { domObserver = this; this.callback = callback; }
    observe() {}
  }

  const loader = createLinkPreviewLoader({
    fetchImpl: async () => { throw new Error('Detached message must not request a preview'); },
    Observer: FakeIntersectionObserver,
    DomObserver: FakeMutationObserver,
    container,
    minGapMs: 0,
  });
  const node = { isConnected: true };
  const pending = loader.request('https://example.com/older', node);
  await tick();
  node.isConnected = false;
  domObserver.callback();
  assert.equal(await pending, null);
});

test('failed preview responses can recover after a later request', async () => {
  let calls = 0;
  const loader = createLinkPreviewLoader({
    Observer: null,
    minGapMs: 0,
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? { ok: false, status: 500 } : success('Retried');
    },
  });
  assert.equal(await loader.request('https://example.com/card'), null);
  assert.deepEqual(await loader.request('https://example.com/card'), { title: 'Retried' });
  assert.equal(calls, 2);
});

test('Rumble and ordinary Open Graph cards use the same guarded frontend loader', () => {
  const root = path.resolve(__dirname, '..');
  const bootstrap = fs.readFileSync(path.join(root, 'public/mobile-bootstrap.js'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'public/chat.js'), 'utf8');
  const start = bootstrap.indexOf("await loadScript('/link-preview-loader.js')");
  const chat = bootstrap.indexOf("await loadScript('/chat.js')");
  assert.ok(start >= 0 && chat > start);
  assert.match(client, /linkPreviewLoader\?\.request\(link, node\)/);
  assert.match(client, /linkPreviewLoader\?\.request\(url, node\)/);
  assert.doesNotMatch(client, /fetch\("\/link-preview\?url="/);
  assert.match(client, /createRumbleIframe\(preview\?\.embedUrl\)/);
  assert.match(client, /https:\/\/www\.youtube\.com\/embed/);
  assert.match(client, /https:\/\/w\.soundcloud\.com\/player\//);
});
