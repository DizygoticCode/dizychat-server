'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('MainActivity prepares rollback state before Capacitor starts and registers WebBundle', () => {
  const source = read('android/app/src/main/java/com/chat/dizychat/MainActivity.java');
  const prepare = source.indexOf('WebBundleStore.prepareActivityLaunch(this)');
  const bridgeStart = source.indexOf('super.onCreate(savedInstanceState)');

  assert.match(source, /registerPlugin\(WebBundlePlugin\.class\)/);
  assert.ok(prepare >= 0, 'bundle rollback preparation must run');
  assert.ok(bridgeStart > prepare, 'rollback/base-path selection must happen before the Capacitor bridge starts');
  assert.match(source, /WebBundleStore\.persistCapacitorBasePath\(this,\s*null\)/);
});

test('WebBundle plugin accepts only HTTPS, verifies every file, reuses verified files, and activates local files', () => {
  const source = read('android/app/src/main/java/com/chat/dizychat/WebBundlePlugin.java');
  assert.match(source, /@CapacitorPlugin\(name\s*=\s*"WebBundle"\)/);
  assert.match(source, /HttpsURLConnection/);
  assert.match(source, /setInstanceFollowRedirects\(false\)/);
  assert.match(source, /WebBundleManifest\.verifyFile/);
  assert.match(source, /findReusableFile/);
  assert.match(source, /setServerBasePath/);
  assert.doesNotMatch(source, /https:\/\/dizychat\.com/, 'native updater must reuse configured backend instead of hard-coding production');
});

test('WebBundle store persists only app-private versions and Capacitor local base-path state', () => {
  const source = read('android/app/src/main/java/com/chat/dizychat/WebBundleStore.java');
  assert.match(source, /getFilesDir\(\)/);
  assert.match(source, /getSharedPreferences/);
  assert.match(source, /WebView\.CAP_SERVER_PATH/);
  assert.match(source, /prepareLaunch\(\)/);
  assert.match(source, /KEY_PENDING/);
  assert.match(source, /KEY_PREVIOUS/);
});
