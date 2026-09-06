'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

test('native mobile runtime registers exact device and owns only device-local suppression lease', () => {
  const runtime = read('public/mobile-runtime.js');
  assert.match(runtime, /createPushController/);
  assert.match(runtime, /Capacitor\?\.Plugins\?\.DizyPush/);
  assert.match(runtime, /\/api\/mobile\/push\/register/);
  assert.match(runtime, /\/api\/mobile\/push\/presence/);
  assert.match(runtime, /Authorization/);
  assert.match(runtime, /Bearer/);
  assert.match(runtime, /deviceId/);
  assert.match(runtime, /notificationToken|pushToken|fcmToken/);
  assert.match(runtime, /onRoomJoined/);
  assert.match(runtime, /requestNotificationPermission/);
  assert.match(runtime, /visibilityState/);
  assert.match(runtime, /isScreenOn/);
  assert.match(runtime, /active:\s*false/);
  assert.match(runtime, /tokenChanged|registrationChanged/);
});

test('chat joins carry native device id and successful admission activates push lifecycle', () => {
  const chat = read('public/chat.js');
  assert.match(chat, /deviceId:\s*[^,}\n]+/);
  assert.match(chat, /join room success[\s\S]*onRoomJoined/);
  assert.match(chat, /account logout[\s\S]*(clearPush|onLogout|disablePush|clearRegistration)/);
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
  assert.match(plugin, /@CapacitorPlugin\(name\s*=\s*"DizyPush"/);
  assert.match(plugin, /getRegistration/);
  assert.match(plugin, /configure/);
  assert.match(plugin, /requestNotificationPermission/);
  assert.match(plugin, /isScreenOn/);
  assert.match(plugin, /consumeLaunchRoute/);

  const notification = read(notificationPath);
  assert.match(notification, /notificationKey/);
  assert.match(notification, /RemoteInput/);
  assert.match(notification, /Reply/);
  assert.match(notification, /Mark as read/);
  assert.match(notification, /messageId/);
  assert.match(notification, /room/);

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
});

test('background mobile Reply derives account identity from bearer and uses canonical chat persistence path', () => {
  const source = read('index.js');
  assert.match(source, /app\.post\(['"]\/api\/mobile\/push\/reply['"]/);
  assert.match(source, /requireHttpMobileAccount/);
  assert.match(source, /replyToMessageId/);
  assert.match(source, /persistAndBroadcastChatMessage|persistChatMessage|saveChatMessage/);
  assert.doesNotMatch(
    source.match(/app\.post\(['"]\/api\/mobile\/push\/reply['"][\s\S]{0,5000}/)?.[0] || '',
    /req\.body\.username|req\.body\.user/,
    'native reply identity must never come from request body',
  );
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
