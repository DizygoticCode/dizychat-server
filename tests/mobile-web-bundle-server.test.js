'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const express = require('express');

const repoRoot = path.resolve(__dirname, '..');
const publicDir = path.join(repoRoot, 'public');
const manifestModulePath = path.join(repoRoot, 'src', 'mobile-web', 'bundle-manifest.js');
const routerModulePath = path.join(repoRoot, 'src', 'mobile-web', 'public-bundle-router.js');

const REQUIRED_NATIVE_CORE = [
  'app-config.js',
  'auth-v2-client.js',
  'chat.css',
  'chat.js',
  'emojis.json',
  'index.html',
  'login.html',
  'logo-light.svg',
  'logo.svg',
  'mobile-bootstrap.js',
  'mobile-push-runtime.js',
  'mobile-runtime.js',
  'mobile-toolbar.css',
  'public-auth-ui.js',
  'public-auth.css',
];

const requireManifestModule = () => {
  assert.ok(fs.existsSync(manifestModulePath), 'mobile web bundle manifest module must exist');
  return require(manifestModulePath);
};

const requireRouterModule = () => {
  assert.ok(fs.existsSync(routerModulePath), 'mobile web bundle router module must exist');
  return require(routerModulePath);
};

test('server-managed Android bundle exposes only the explicit native core', async () => {
  const { buildMobileWebManifest } = requireManifestModule();
  const manifest = await buildMobileWebManifest({ publicDir });

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.entryPath, 'login.html');
  assert.match(manifest.bundleVersion, /^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(manifest.files));

  const paths = manifest.files.map((file) => file.path);
  assert.deepEqual(paths, [...paths].sort(), 'manifest file order must be deterministic');
  for (const required of REQUIRED_NATIVE_CORE) {
    assert.ok(paths.includes(required), `native bundle must include ${required}`);
  }

  for (const forbiddenPrefix of [
    'uploads/',
    'soundboards/',
    'emojis/',
    'vendor/',
  ]) {
    assert.equal(
      paths.some((entry) => entry.startsWith(forbiddenPrefix)),
      false,
      `native bundle must not cache ${forbiddenPrefix}`
    );
  }
  assert.equal(paths.includes('iphone-install.js'), false, 'native bundle does not need iPhone helper JS');
  assert.equal(paths.includes('iphone-install.css'), false, 'native bundle does not need iPhone helper CSS');
  assert.equal(paths.includes('reset-password.html'), false, 'email reset completion remains server/browser-side');

  for (const file of manifest.files) {
    assert.match(file.path, /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._\-/]+$/);
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(file.size) && file.size > 0);
    const bytes = fs.readFileSync(path.join(publicDir, file.path));
    assert.equal(file.size, bytes.length);
    assert.equal(file.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  }
});

test('bundle version is deterministic and changes when file metadata changes', () => {
  const { createBundleVersion } = requireManifestModule();
  const files = [
    { path: 'a.js', size: 3, sha256: 'a'.repeat(64) },
    { path: 'b.css', size: 4, sha256: 'b'.repeat(64) },
  ];
  const first = createBundleVersion(files);
  const second = createBundleVersion(files.map((entry) => ({ ...entry })));
  const changed = createBundleVersion([
    files[0],
    { ...files[1], sha256: 'c'.repeat(64) },
  ]);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, second);
  assert.notEqual(first, changed);
});

test('bundle path guard rejects traversal, absolute paths and encoded traversal', () => {
  const { isSafeBundlePath } = requireManifestModule();
  for (const safe of ['login.html', 'mobile-runtime.js', 'nested/file.css']) {
    assert.equal(isSafeBundlePath(safe), true, safe);
  }
  for (const unsafe of [
    '',
    '/login.html',
    '../secret',
    'nested/../secret',
    'nested\\file.js',
    'https://evil.example/x.js',
    '%2e%2e/secret',
    'nested/%2e%2e/secret',
  ]) {
    assert.equal(isSafeBundlePath(unsafe), false, unsafe);
  }
});

test('mobile bundle router serves only manifest-approved assets with no-store manifest caching', async (t) => {
  const { createMobileWebBundleRouter } = requireRouterModule();
  const app = express();
  app.use('/api/mobile-web', createMobileWebBundleRouter({ publicDir }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  const manifestResponse = await fetch(`${base}/api/mobile-web/manifest`);
  assert.equal(manifestResponse.status, 200);
  assert.match(String(manifestResponse.headers.get('cache-control') || ''), /no-store/i);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.entryPath, 'login.html');

  const loginResponse = await fetch(`${base}/api/mobile-web/assets/login.html`);
  assert.equal(loginResponse.status, 200);
  const loginBytes = Buffer.from(await loginResponse.arrayBuffer());
  const loginEntry = manifest.files.find((entry) => entry.path === 'login.html');
  assert.ok(loginEntry);
  assert.equal(crypto.createHash('sha256').update(loginBytes).digest('hex'), loginEntry.sha256);

  for (const forbidden of [
    '/api/mobile-web/assets/emojis/custom/alex1.gif',
    '/api/mobile-web/assets/uploads/test.png',
    '/api/mobile-web/assets/soundboards/test.mp3',
    '/api/mobile-web/assets/%2e%2e/index.js',
  ]) {
    const response = await fetch(base + forbidden);
    assert.ok([400, 404].includes(response.status), `${forbidden} returned ${response.status}`);
  }
});

test('mobile web router is mounted before server-core registers its GET catch-all', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'index.js'), 'utf8');
  const captureStart = source.indexOf('http.createServer = function captureDizyChatApp');
  const earlyMount = source.indexOf("requestListener.use('/api/mobile-web'");
  const serverCoreLoad = source.indexOf("require('./server-core')");
  const lateMount = source.indexOf("app.use('/api/mobile-web'");

  assert.ok(captureStart >= 0, 'index.js must intercept server-core app creation');
  assert.ok(earlyMount > captureStart, 'mobile web router must mount during app capture');
  assert.ok(earlyMount < serverCoreLoad, 'mobile web router must mount before server-core registers routes');
  assert.equal(lateMount, -1, 'mobile web router must not be mounted after server-core catch-all registration');
});
