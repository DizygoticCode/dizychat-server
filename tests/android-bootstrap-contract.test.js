'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('app config exposes one canonical native backend and debug override', () => {
  const source = read('public/app-config.js');
  assert.match(source, /defaultNativeBackendUrl:\s*["']https:\/\/dizychat\.com["']/);
  assert.match(source, /backendUrlStorageKey:\s*["']dizychat-backend-url["']/);
  assert.doesNotMatch(source, /defaultNativeSocketUrl/);
  assert.doesNotMatch(source, /socketUrlStorageKey/);
});

test('login page bootstraps packaged runtime before chat instead of loading localhost Socket.IO directly', () => {
  const source = read('public/login.html');
  const config = source.indexOf('src="/app-config.js"');
  const auth = source.indexOf('src="/auth-v2-client.js"');
  const runtime = source.indexOf('src="/mobile-runtime.js"');
  const bootstrap = source.indexOf('src="/mobile-bootstrap.js"');

  assert.ok(config >= 0, 'app-config.js must be loaded');
  assert.ok(auth > config, 'auth adapter must load after config');
  assert.ok(runtime > auth, 'mobile runtime must load after auth');
  assert.ok(bootstrap > runtime, 'mobile bootstrap must load last');
  assert.doesNotMatch(source, /src="\/socket\.io\/socket\.io\.js"/);
  assert.doesNotMatch(source, /src="\/chat\.js"/);
});

test('mobile bootstrap restores session, loads backend Socket.IO, installs fetch routing, then loads chat', () => {
  const source = read('public/mobile-bootstrap.js');
  assert.match(source, /restoreNativeSession\(\)/);
  assert.match(source, /resolveBackendOrigin\(window,\s*window\.dizychatConfig\)/);
  assert.match(source, /installBackendFetchRouting\(window,\s*backend\)/);
  assert.match(source, /backend\s*\?\s*`\$\{backend\}\/socket\.io\/socket\.io\.js`\s*:\s*["']\/socket\.io\/socket\.io\.js["']/);
  assert.match(source, /loadScript\(["']\/chat\.js["']\)/);
  assert.match(source, /dizychat-bootstrap-error/);
});

test('native runtime exposes an idempotent fetch router that keeps bundled assets local', () => {
  const runtime = require('../public/mobile-runtime.js');
  assert.equal(typeof runtime.installBackendFetchRouting, 'function');

  const calls = [];
  const win = {
    fetch(input, init) {
      calls.push([input, init]);
      return Promise.resolve({ ok: true });
    },
  };

  const original = win.fetch;
  runtime.installBackendFetchRouting(win, 'https://dizychat.com');
  const installed = win.fetch;
  runtime.installBackendFetchRouting(win, 'https://dizychat.com');
  assert.equal(win.fetch, installed, 'second install should not wrap fetch again');
  assert.notEqual(installed, original);

  win.fetch('/upload', { method: 'POST' });
  win.fetch('/emojis.json');
  assert.equal(calls[0][0], 'https://dizychat.com/upload');
  assert.equal(calls[1][0], '/emojis.json');
});
