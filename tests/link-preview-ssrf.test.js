'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  assertPublicHost,
  fetchPublicHtmlPreview,
  isPublicIpAddress,
  normalizePublicPreviewUrl,
  readBodyWithLimit,
} = require('../src/security/public-http-fetch');

const repoRoot = path.resolve(__dirname, '..');

const headers = (values = {}) => ({
  get(name) {
    return values[String(name || '').toLowerCase()] || '';
  },
});

test('link preview IP policy blocks loopback, private, link-local and special-purpose ranges', () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '100.64.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '192.0.2.10',
    '198.18.0.1',
    '198.51.100.10',
    '203.0.113.10',
    '224.0.0.1',
    '::1',
    'fe80::1',
    'fc00::1',
    '2001:db8::1',
  ]) {
    assert.equal(isPublicIpAddress(address), false, address);
  }

  assert.equal(isPublicIpAddress('8.8.8.8'), true);
  assert.equal(isPublicIpAddress('1.1.1.1'), true);
  assert.equal(isPublicIpAddress('2606:4700:4700::1111'), true);
});

test('link preview URL normalization only permits public HTTP(S) defaults', () => {
  assert.equal(normalizePublicPreviewUrl('example.com/a#fragment').toString(), 'http://example.com/a');
  assert.equal(normalizePublicPreviewUrl('https://example.com/path').toString(), 'https://example.com/path');

  assert.throws(() => normalizePublicPreviewUrl('http://localhost/test'), /Local or private/);
  assert.throws(() => normalizePublicPreviewUrl('http://printer.local/test'), /Local or private/);
  assert.throws(() => normalizePublicPreviewUrl('https://user:pass@example.com/'), /Credential-bearing/);
  assert.throws(() => normalizePublicPreviewUrl('https://example.com:8443/'), /Non-standard/);
  assert.throws(() => normalizePublicPreviewUrl('file:///etc/passwd'), /Link preview URL is invalid|protocol/i);
});

test('resolved preview hosts are rejected if any address is private', async () => {
  const url = normalizePublicPreviewUrl('https://example.com/');

  await assert.rejects(
    assertPublicHost(url, async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]),
    (error) => error?.code === 'LINK_PREVIEW_ADDRESS_BLOCKED',
  );

  const results = await assertPublicHost(url, async () => [
    { address: '93.184.216.34', family: 4 },
  ]);
  assert.equal(results[0].address, '93.184.216.34');
});

test('redirect targets are revalidated before a second outbound request', async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    return {
      status: 302,
      headers: headers({ location: 'http://127.0.0.1/admin' }),
    };
  };

  await assert.rejects(
    fetchPublicHtmlPreview({
      fetchImpl,
      url: 'https://example.com/start',
      lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
      lookupCallback: (_host, _options, callback) =>
        callback(null, [{ address: '93.184.216.34', family: 4 }]),
    }),
    (error) => error?.code === 'LINK_PREVIEW_ADDRESS_BLOCKED',
  );

  assert.deepEqual(requested, ['https://example.com/start']);
});

test('HTML preview bodies are capped before parsing', async () => {
  const response = {
    headers: headers({ 'content-length': '2048' }),
  };

  await assert.rejects(
    readBodyWithLimit(response, 1024),
    (error) => error?.code === 'LINK_PREVIEW_TOO_LARGE',
  );
});

test('safe link preview fetch returns HTML and final URL for ordinary public pages', async () => {
  const result = await fetchPublicHtmlPreview({
    url: 'https://example.com/page',
    lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
    lookupCallback: (_host, _options, callback) =>
      callback(null, [{ address: '93.184.216.34', family: 4 }]),
    fetchImpl: async () => ({
      status: 200,
      headers: headers({
        'content-type': 'text/html; charset=utf-8',
        'content-length': '42',
      }),
      body: (async function* body() {
        yield Buffer.from('<html><title>Safe preview</title></html>');
      })(),
    }),
  });

  assert.equal(result.isHtml, true);
  assert.equal(result.url, 'https://example.com/page');
  assert.match(result.html, /Safe preview/);
});

test('server link preview route uses the guarded fetch helper', () => {
  const server = fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');
  const routeStart = server.indexOf("app.get('/link-preview'");
  const routeEnd = server.indexOf("app.get('/tenor-proxy'", routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  const route = server.slice(routeStart, routeEnd);

  assert.match(route, /fetchPublicHtmlPreview\(\{/);
  assert.doesNotMatch(route, /await fetch\(url,/);
});
