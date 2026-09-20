'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const mobileRuntime = require('../public/mobile-runtime');
const { createPushController } = require('../public/mobile-push-runtime');

test('iOS Capacitor CI regenerates and compiles the native bridge on macOS', () => {
  const workflow = read('.github/workflows/ios-capacitor-ci.yml');
  assert.match(workflow, /runs-on:\s*macos-latest/);
  assert.match(workflow, /@capacitor\/ios@7\.4\.4/);
  assert.match(workflow, /npx cap add ios/);
  assert.match(workflow, /node scripts\/prepare-ios-firebase\.js/);
  assert.match(workflow, /node scripts\/prepare-ios-native\.js/);
  assert.match(workflow, /DIZYCHAT_GOOGLE_SERVICE_INFO_PLIST_B64/);
  assert.match(workflow, /generic\/platform=iOS/);
  assert.match(workflow, /xcodebuild/);
  assert.match(workflow, /CODE_SIGNING_ALLOWED=NO/);
});

test('iOS native preparation keeps Android-independent secure/session and push boundaries', () => {
  const prep = read('scripts/prepare-ios-native.js');
  assert.match(prep, /DizyBridgeViewController/);
  assert.match(prep, /registerPluginInstance\(SecureSessionPlugin\(\)\)/);
  assert.match(prep, /registerPluginInstance\(MobileShellPlugin\(\)\)/);
  assert.match(prep, /registerPluginInstance\(DizyPushPlugin\(\)\)/);
  assert.match(prep, /registerPluginInstance\(WebBundlePlugin\(\)\)/);
  assert.match(prep, /kSecClassGenericPassword/);
  assert.match(prep, /kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly/);
  assert.match(prep, /NSCameraUsageDescription/);
  assert.match(prep, /NSMicrophoneUsageDescription/);
  assert.match(prep, /UIBackgroundModes/);
  assert.match(prep, /remote-notification/);
  assert.match(prep, /didReceiveRemoteNotification/);
  assert.match(prep, /launchOptions\?\[\.remoteNotification\]/);
  assert.match(prep, /captureLaunchNotification/);
  assert.match(prep, /capacitorDidRegisterForRemoteNotifications/);
  assert.match(prep, /Messaging\.messaging\(\)\.apnsToken/);
  assert.doesNotMatch(prep, /BEGIN PRIVATE KEY|firebase-adminsdk|GOOGLE_APPLICATION_CREDENTIALS/);
});

test('iOS verified WebBundle updater mirrors the Android manifest safety boundary', () => {
  const source = read('ios-native/WebBundlePlugin.swift');
  for (const file of [
    'app-config.js',
    'auth-v2-client.js',
    'chat.css',
    'chat.js',
    'embedded-call-view.css',
    'embedded-call-view.js',
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
  ]) {
    assert.equal(source.includes(`"${file}"`), true, `${file} must remain allowlisted`);
  }
  assert.match(source, /schemaVersion = 1/);
  assert.match(source, /entryPath = "login\.html"/);
  assert.match(source, /maxFileBytes = 8 \* 1024 \* 1024/);
  assert.match(source, /maxTotalBytes = 32 \* 1024 \* 1024/);
  assert.match(source, /CryptoKit/);
  assert.match(source, /SHA256\.hash/);
  assert.match(source, /\/api\/mobile-web\/manifest/);
  assert.match(source, /\/api\/mobile-web\/assets\//);
  assert.match(source, /bridge\.setServerBasePath/);
  assert.match(source, /healthyActiveBundle/);
  assert.doesNotMatch(source, /http:\/\//i, 'native updater must never downgrade its backend transport');
});

test('iOS push bridge keeps Firebase token rotation and Android-parity notification actions', () => {
  const source = read('ios-native/DizyPushPlugin.swift');
  assert.match(source, /MessagingDelegate/);
  assert.match(source, /didReceiveRegistrationToken/);
  assert.match(source, /Messaging\.messaging\(\)\.apnsToken/);
  assert.match(source, /remainingApnsChecks/);
  assert.match(source, /DIZYCHAT_MESSAGE/);
  assert.match(source, /DIZYCHAT_REPLY/);
  assert.match(source, /DIZYCHAT_MARK_READ/);
  assert.match(source, /UNTextInputNotificationAction/);
  assert.match(source, /\/api\/mobile\/push\/reply/);
  assert.match(source, /\/api\/read-state\/mark/);
  assert.match(source, /SecureSessionPlugin\.readStoredToken/);
  assert.match(source, /captureLaunchNotification/);
  assert.match(source, /handleRemoteNotification/);
  assert.match(source, /read-control/);
});

test('iOS WKWebView keeps native getUserMedia unwrapped so Apple owns camera/mic permission prompts', () => {
  const original = async (constraints) => ({ constraints });
  const win = {
    Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
      Plugins: {},
    },
    location: { origin: 'capacitor://localhost', protocol: 'capacitor:' },
    navigator: { mediaDevices: { getUserMedia: original } },
  };

  assert.equal(mobileRuntime.installNativeMediaPermissions(win), true);
  assert.equal(win.navigator.mediaDevices.getUserMedia, original);
});

test('native push client registers an iPhone as ios while retaining the existing FCM token API', async () => {
  const calls = [];
  const win = {
    Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
      Plugins: {
        DizyPush: {
          configure: async () => {},
          getRegistration: async () => ({
            deviceId: 'iphone-install-123',
            fcmToken: 'ios-fcm-token',
          }),
        },
      },
    },
    document: { visibilityState: 'visible', addEventListener() {} },
    fetch: async (url, init = {}) => {
      calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  };
  const auth = { readToken: () => 'mobile-bearer' };
  const controller = createPushController(win, {
    backendOrigin: 'https://backend.example',
    auth,
    fetchImpl: win.fetch,
  });

  const registration = await controller.register();
  assert.deepEqual(registration, {
    deviceId: 'iphone-install-123',
    fcmToken: 'ios-fcm-token',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://backend.example/api/mobile/push/register');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer mobile-bearer');
  assert.deepEqual(calls[0].body, {
    deviceId: 'iphone-install-123',
    fcmToken: 'ios-fcm-token',
    platform: 'ios',
    deviceLabel: 'iPhone',
  });
});

test('iOS asks Apple notification permission before first FCM registration', async () => {
  const events = [];
  const posts = [];
  const plugin = {
    configure: async () => { events.push('configure'); },
    requestNotificationPermission: async () => {
      events.push('permission');
      return { state: 'granted' };
    },
    getRegistration: async () => {
      events.push('registration');
      return { deviceId: 'iphone-1', fcmToken: 'fcm-ios-1' };
    },
    isScreenOn: async () => ({ on: false }),
    consumeLaunchRoute: async () => ({}),
    addListener: async () => {},
  };
  const win = {
    Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
      Plugins: { DizyPush: plugin },
    },
    document: { visibilityState: 'hidden', addEventListener() {} },
    fetch: async (url, init = {}) => {
      posts.push({ url, body: init.body ? JSON.parse(init.body) : null });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
    console,
  };
  const controller = createPushController(win, {
    backendOrigin: 'https://backend.example',
    auth: { readToken: () => 'mobile-bearer' },
    fetchImpl: win.fetch,
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {},
  });

  await controller.onChatReady();
  assert.equal(events.includes('registration'), false, 'iOS must not pre-register before APNs permission');

  await controller.onRoomJoined('General Chat');
  assert.ok(events.indexOf('permission') >= 0);
  assert.ok(events.indexOf('registration') > events.indexOf('permission'));
  assert.equal(posts[0].body.platform, 'ios');
});

test('server native-device model accepts iOS without changing Android default', () => {
  const model = read('src/models/push-device.js');
  const service = read('src/push/push-device-service.js');
  const server = read('server-core.js');
  assert.match(model, /enum:\s*\['android', 'ios'\]/);
  assert.match(model, /default:\s*'android'/);
  assert.match(service, /normalizedPlatform/);
  assert.match(service, /normalizedPlatform === 'ios'/);
  assert.match(server, /platform:\s*req\.body\?\.platform/);
});
