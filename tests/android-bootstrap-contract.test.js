'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const evaluateAppConfig = (win) => {
  const context = vm.createContext({ window: win });
  vm.runInContext(read('public/app-config.js'), context);
  return context.window.dizychatConfig;
};

test('app config exposes one canonical native backend and debug override', () => {
  const source = read('public/app-config.js');
  assert.match(source, /defaultNativeBackendUrl:\s*["']https:\/\/dizychat\.com["']/);
  assert.match(source, /backendUrlStorageKey:\s*["']dizychat-backend-url["']/);
  assert.doesNotMatch(source, /defaultNativeSocketUrl/);
  assert.doesNotMatch(source, /socketUrlStorageKey/);
});

test('app config pins the production Socket.IO endpoint only for packaged native runtime', () => {
  const nativeConfig = evaluateAppConfig({
    Capacitor: { isNativePlatform: () => true },
    dizychatConfig: {},
  });
  const webConfig = evaluateAppConfig({ dizychatConfig: {} });

  assert.equal(nativeConfig.socketUrl, 'https://dizychat.com');
  assert.equal(webConfig.socketUrl, '');
});

test('login page bootstraps runtime before chat instead of loading Socket.IO directly', () => {
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

test('mobile bootstrap checks WebBundle only on native and loads Socket.IO from backend', () => {
  const source = read('public/mobile-bootstrap.js');
  assert.match(source, /restoreNativeSession\(\)/);
  assert.match(source, /resolveBackendOrigin\(window,\s*window\.dizychatConfig\)/);
  assert.match(source, /installBackendFetchRouting\(window,\s*backend\)/);
  assert.match(source, /isNativeRuntime\(window\)/);
  assert.match(source, /Capacitor\?\.Plugins\?\.WebBundle/);
  assert.match(source, /syncAndActivate\(\{\s*backendUrl:\s*window\.dizychatConfig\?\.defaultNativeBackendUrl\s*\}\)/);
  assert.match(source, /`\$\{backend\}\/socket\.io\/socket\.io\.js`/);
  assert.match(source, /["']\/socket\.io\/socket\.io\.js["']/);
  assert.doesNotMatch(source, /\/vendor\/socket\.io\.min\.js/);
  assert.match(source, /loadScript\(socketClientUrl\)/);
  assert.match(source, /loadScript\(["']\/chat\.js["']\)/);
  assert.match(source, /dizychat-bootstrap-error/);
});

test('Android build prepares only canonical tiny-shell assets before Capacitor sync', () => {
  const scriptPath = path.join(root, 'scripts/prepare-android-assets.js');
  assert.equal(fs.existsSync(scriptPath), true, 'Android asset preparation script must exist');

  const prepareSource = fs.readFileSync(scriptPath, 'utf8');
  const workflow = read('.github/workflows/android-slice1-ci.yml');
  const pkg = JSON.parse(read('package.json'));
  const config = JSON.parse(read('capacitor.config.json'));

  assert.equal(pkg.scripts?.['android:prepare'], 'node scripts/prepare-android-assets.js');
  assert.equal(config.webDir, 'android-shell');
  assert.equal(Object.prototype.hasOwnProperty.call(config, 'server'), false, 'production shell must not use server.url');
  assert.match(prepareSource, /android-shell/);
  assert.match(prepareSource, /public[\\/]app-config\.js/);
  assert.match(prepareSource, /public[\\/]logo\.svg/);
  assert.doesNotMatch(prepareSource, /socket\.io/);
  assert.doesNotMatch(prepareSource, /public[\\/]vendor/);
  assert.match(workflow, /npm run android:prepare[\s\S]*npx cap sync android/);
});

test('native runtime exposes an idempotent API fetch router while bundle assets stay local', () => {
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

test('packaged Android launch is a tiny updater shell instead of the marketing application', () => {
  const config = JSON.parse(read('capacitor.config.json'));
  assert.equal(config.webDir, 'android-shell');
  assert.equal(fs.existsSync(path.join(root, 'android-shell/index.html')), true);
  assert.equal(fs.existsSync(path.join(root, 'android-shell/bootstrap.js')), true);
  const source = read('android-shell/index.html');
  assert.match(source, /app-config\.js/);
  assert.match(source, /bootstrap\.js/);
  assert.doesNotMatch(source, /chat\.js|mobile-bootstrap\.js|socket\.io/i);
  const bootstrap = read('android-shell/bootstrap.js');
  assert.match(bootstrap, /defaultNativeBackendUrl/);
  assert.match(bootstrap, /WebBundle/);
  assert.match(bootstrap, /syncAndActivate/);
  assert.match(bootstrap, /Retry/i);
});
