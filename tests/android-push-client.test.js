'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPushController, decorateIoFactory } = require('../public/mobile-push-runtime');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const tick = () => new Promise((resolve) => setImmediate(resolve));

const createNativeHarness = ({ visibilityState = 'visible', screenOn = true } = {}) => {
  const pluginCalls = [];
  const listeners = new Map();
  const fetchCalls = [];
  const plugin = {
    configure: async (payload) => { pluginCalls.push(['configure', payload]); },
    getRegistration: async () => ({ deviceId: 'install-123', fcmToken: 'fcm-abc' }),
    requestNotificationPermission: async () => { pluginCalls.push(['permission']); return { state: 'granted' }; },
    isScreenOn: async () => ({ on: screenOn }),
    consumeLaunchRoute: async () => ({}),
    addListener: async (name, callback) => { listeners.set(name, callback); return { remove() {} }; },
  };
  const documentListeners = new Map();
  const win = {
    Capacitor: {
      isNativePlatform: () => true,
      Plugins: { DizyPush: plugin },
    },
    dizychatAuthV2: { readToken: () => 'mobile-bearer' },
    document: {
      visibilityState,
      addEventListener: (name, callback) => documentListeners.set(name, callback),
      querySelector: () => null,
    },
    console: { warn() {} },
    setTimeout,
    setInterval: () => 77,
    clearInterval() {},
    fetch: async (url, init) => {
      fetchCalls.push({ url, init, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  };
  return { win, pluginCalls, listeners, fetchCalls, documentListeners };
};

test('browser mode is inert and never decorates Socket.IO for push', async () => {
  const fetchCalls = [];
  const win = {
    Capacitor: { isNativePlatform: () => false, Plugins: {} },
    document: { visibilityState: 'visible', addEventListener() {} },
    fetch: async (...args) => { fetchCalls.push(args); },
    io() {},
  };
  const controller = createPushController(win, {
    backendOrigin: 'https://dizychat.com',
    auth: { readToken: () => 'browser-token' },
  });
  assert.equal(controller.native, false);
  assert.equal(decorateIoFactory(win, controller), false);
  assert.equal(await controller.register(), null);
  assert.deepEqual(fetchCalls, []);
});

test('native registration uses exact bearer, configured backend, stable device id, and FCM token', async () => {
  const harness = createNativeHarness();
  const controller = createPushController(harness.win, {
    backendOrigin: 'https://backend.example',
    auth: harness.win.dizychatAuthV2,
  });
  const registration = await controller.register();
  assert.deepEqual(registration, { deviceId: 'install-123', fcmToken: 'fcm-abc' });
  assert.deepEqual(harness.pluginCalls[0], ['configure', { backendOrigin: 'https://backend.example' }]);
  assert.equal(harness.fetchCalls[0].url, 'https://backend.example/api/mobile/push/register');
  assert.equal(harness.fetchCalls[0].init.headers.Authorization, 'Bearer mobile-bearer');
  assert.deepEqual(harness.fetchCalls[0].body, {
    deviceId: 'install-123',
    fcmToken: 'fcm-abc',
    platform: 'android',
    deviceLabel: 'Android',
  });
});

test('native authenticated join is decorated with device id and permission waits for join success', async () => {
  const harness = createNativeHarness();
  const emitted = [];
  const handlers = new Map();
  const socket = {
    emit(name, ...args) { emitted.push([name, ...args]); return this; },
    on(name, callback) { handlers.set(name, callback); return this; },
  };
  harness.win.io = () => socket;
  const controller = createPushController(harness.win, {
    backendOrigin: 'https://backend.example',
    auth: harness.win.dizychatAuthV2,
  });
  assert.equal(decorateIoFactory(harness.win, controller), true);
  const decoratedSocket = harness.win.io();
  decoratedSocket.emit('join room', { room: 'General Chat', username: 'Rob', password: '' });
  await tick();
  await tick();
  assert.equal(harness.pluginCalls.some(([name]) => name === 'permission'), false);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0][0], 'join room');
  assert.equal(emitted[0][1].deviceId, 'install-123');

  handlers.get('join room success')();
  await tick();
  await tick();
  assert.equal(harness.pluginCalls.filter(([name]) => name === 'permission').length, 1);
  const presence = harness.fetchCalls.find((call) => call.url.endsWith('/api/mobile/push/presence'));
  assert.equal(presence.body.deviceId, 'install-123');
  assert.equal(presence.body.interactive, true);
});

test('device-local suppression lease clears while hidden or screen-off and token rotation keeps device identity', async () => {
  const hidden = createNativeHarness({ visibilityState: 'hidden', screenOn: true });
  const controller = createPushController(hidden.win, {
    backendOrigin: 'https://backend.example',
    auth: hidden.win.dizychatAuthV2,
  });
  await controller.onChatReady();
  await controller.onRoomJoined('General Chat');
  const presence = hidden.fetchCalls.find((call) => call.url.endsWith('/api/mobile/push/presence'));
  assert.deepEqual(presence.body, { deviceId: 'install-123', interactive: false });

  const tokenChanged = hidden.listeners.get('tokenChanged');
  assert.equal(typeof tokenChanged, 'function');
  tokenChanged({ fcmToken: 'fcm-rotated' });
  await tick();
  await tick();
  const registrations = hidden.fetchCalls.filter((call) => call.url.endsWith('/api/mobile/push/register'));
  assert.equal(registrations.at(-1).body.deviceId, 'install-123');
  assert.equal(registrations.at(-1).body.fcmToken, 'fcm-rotated');
});

test('Android native boundary renders one room notification with tap, Reply, and Mark as read actions', () => {
  const pluginPath = 'android/app/src/main/java/com/chat/dizychat/DizyPushPlugin.java';
  const servicePath = 'android/app/src/main/java/com/chat/dizychat/DizyFirebaseMessagingService.java';
  const notificationPath = 'android/app/src/main/java/com/chat/dizychat/DizyNotificationManager.java';
  const receiverPath = 'android/app/src/main/java/com/chat/dizychat/DizyNotificationActionReceiver.java';
  const secureStorePath = 'android/app/src/main/java/com/chat/dizychat/SecureSessionStore.java';

  for (const file of [pluginPath, servicePath, notificationPath, receiverPath, secureStorePath]) {
    assert.equal(exists(file), true, `${file} must exist`);
  }

  const plugin = read(pluginPath);
  assert.match(plugin, /name\s*=\s*"DizyPush"/);
  assert.match(plugin, /getRegistration/);
  assert.match(plugin, /configure/);
  assert.match(plugin, /requestNotificationPermission/);
  assert.match(plugin, /isScreenOn/);
  assert.match(plugin, /consumeLaunchRoute/);

  const notification = read(notificationPath);
  assert.match(notification, /notificationKey/);
  assert.match(notification, /RemoteInput/);
  assert.match(notification, /"Reply"/);
  assert.match(notification, /"Mark as read"/);
  assert.match(notification, /messageId/);
  assert.match(notification, /notificationId\(identity\)/);

  const receiver = read(receiverPath);
  assert.match(receiver, /\/api\/read-state\/mark/);
  assert.match(receiver, /\/api\/mobile\/push\/reply/);
  assert.match(receiver, /SecureSessionStore/);
  assert.match(receiver, /Authorization/);
  assert.match(receiver, /Bearer/);
  assert.doesNotMatch(receiver, /https:\/\/dizychat\.com/i, 'native actions must use configured backend, not duplicate production URL');

  const activity = read('android/app/src/main/java/com/chat/dizychat/MainActivity.java');
  assert.match(activity, /registerPlugin\(DizyPushPlugin\.class\)/);
  assert.match(activity, /DizyPushPlugin\.handleIntent/);

  const manifest = read('android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /com\.capacitorjs\.plugins\.pushnotifications\.MessagingService[\s\S]*tools:node="remove"/);
  assert.match(manifest, /\.DizyFirebaseMessagingService/);
  assert.match(manifest, /android\.permission\.POST_NOTIFICATIONS/);
});

test('background mobile Reply derives account identity from bearer, active subscription, and canonical message service', () => {
  const source = read('index.js');
  const route = source.match(/app\.post\(['"]\/api\/mobile\/push\/reply['"][\s\S]{0,5000}/)?.[0] || '';
  assert.match(route, /requireHttpMobileAccount/);
  assert.match(route, /findActiveSubscription/);
  assert.match(route, /req\.accountPrincipal\.username/);
  assert.match(route, /req\.accountPrincipal\.canonicalUsername/);
  assert.match(route, /chatMessageService\.persistChatMessage/);
  assert.match(route, /replyToMessageId/);
  assert.doesNotMatch(route, /req\.body\.username|req\.body\.user/, 'native reply identity must never come from request body');

  const socketSource = source.match(/socket\.on\('chat message'[\s\S]{0,2500}/)?.[0] || '';
  assert.match(socketSource, /chatMessageService\.persistChatMessage/);
});

test('Android source keeps Firebase/server credentials external and never hard-codes a duplicate backend', () => {
  const javaDir = path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'chat', 'dizychat');
  const javaSources = fs.readdirSync(javaDir)
    .filter((name) => name.endsWith('.java'))
    .map((name) => fs.readFileSync(path.join(javaDir, name), 'utf8'))
    .join('\n');
  assert.doesNotMatch(javaSources, /BEGIN PRIVATE KEY|firebase-adminsdk|MONGO_URI|METADEFENDER_API_KEY/);
  assert.doesNotMatch(javaSources, /https:\/\/dizychat\.com/i, 'existing app config is the only production backend source');
});
