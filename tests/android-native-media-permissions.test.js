'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const runtime = require('../public/mobile-runtime.js');

const nativeWindow = (requestPermissions, getUserMedia) => ({
  Capacitor: {
    isNativePlatform: () => true,
    Plugins: {
      NativePermissions: { requestPermissions },
    },
  },
  location: { origin: 'https://localhost', protocol: 'https:' },
  navigator: {
    mediaDevices: { getUserMedia },
  },
});

test('Android package declares camera and microphone permissions through the native permission plugin', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android\.permission\.RECORD_AUDIO/);
  assert.match(manifest, /android\.permission\.CAMERA/);

  const pluginPath = 'android/app/src/main/java/com/chat/dizychat/NativePermissionsPlugin.java';
  assert.equal(exists(pluginPath), true, 'NativePermissions plugin must exist');
  const plugin = read(pluginPath);
  assert.match(plugin, /@CapacitorPlugin\([\s\S]*name\s*=\s*"NativePermissions"/);
  assert.match(plugin, /Manifest\.permission\.RECORD_AUDIO/);
  assert.match(plugin, /alias\s*=\s*"microphone"/);
  assert.match(plugin, /Manifest\.permission\.CAMERA/);
  assert.match(plugin, /alias\s*=\s*"camera"/);

  const activity = read('android/app/src/main/java/com/chat/dizychat/MainActivity.java');
  assert.match(activity, /registerPlugin\(NativePermissionsPlugin\.class\)/);

  const bootstrap = read('public/mobile-bootstrap.js');
  assert.match(bootstrap, /installNativeMediaPermissions\(window\)/);
});

test('native media capture requests only the Android permissions implied by its constraints', async () => {
  assert.equal(typeof runtime.installNativeMediaPermissions, 'function');

  const permissionCalls = [];
  const captureCalls = [];
  const win = nativeWindow(
    async (payload) => {
      permissionCalls.push(payload);
      return Object.fromEntries(payload.permissions.map((alias) => [alias, 'granted']));
    },
    async (constraints) => {
      captureCalls.push(constraints);
      return { constraints };
    },
  );

  assert.equal(runtime.installNativeMediaPermissions(win), true);
  const installed = win.navigator.mediaDevices.getUserMedia;
  assert.equal(runtime.installNativeMediaPermissions(win), true);
  assert.equal(win.navigator.mediaDevices.getUserMedia, installed, 'second install must not wrap getUserMedia twice');

  await win.navigator.mediaDevices.getUserMedia({ audio: true });
  await win.navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
  await win.navigator.mediaDevices.getUserMedia({ audio: true, video: true });

  assert.deepEqual(permissionCalls, [
    { permissions: ['microphone'] },
    { permissions: ['camera'] },
    { permissions: ['microphone', 'camera'] },
  ]);
  assert.equal(captureCalls.length, 3);
});

test('denied native media permission blocks capture with a NotAllowedError', async () => {
  assert.equal(typeof runtime.installNativeMediaPermissions, 'function');

  let captureCount = 0;
  const win = nativeWindow(
    async () => ({ microphone: 'denied' }),
    async () => {
      captureCount += 1;
      return {};
    },
  );

  assert.equal(runtime.installNativeMediaPermissions(win), true);
  await assert.rejects(
    () => win.navigator.mediaDevices.getUserMedia({ audio: true }),
    (error) => error?.name === 'NotAllowedError' && /microphone/i.test(error?.message || ''),
  );
  assert.equal(captureCount, 0, 'capture must not start after permission denial');
});

test('ordinary web media capture is not wrapped by the Android permission router', () => {
  const original = async () => ({});
  const win = {
    location: { origin: 'https://dizychat.com', protocol: 'https:' },
    navigator: { mediaDevices: { getUserMedia: original } },
  };

  assert.equal(runtime.installNativeMediaPermissions(win), false);
  assert.equal(win.navigator.mediaDevices.getUserMedia, original);
});
