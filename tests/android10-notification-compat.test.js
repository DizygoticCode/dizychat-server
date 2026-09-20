'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFcmTransport } = require('../src/push/transports/fcm-transport');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('enabled desktop notification bell has an obvious accent pressed state', () => {
  const css = read('public/chat.css');
  assert.match(
    css,
    /\.header-right button#toggle-desktop-notifications\[aria-pressed="true"\]\s*\{[^}]*background:\s*var\(--accent\);[^}]*border-color:\s*var\(--accent\);[^}]*color:\s*#fff;/s,
  );
});

test('chat message FCM payload requests high-priority Android delivery', async () => {
  const payloads = [];
  const transport = createFcmTransport({
    projectId: 'dizychat-test',
    messagingFactory: () => ({
      send: async (payload) => {
        payloads.push(payload);
        return 'ok';
      },
    }),
  });

  await transport.send({
    type: 'message',
    room: 'General Chat',
    messageId: '507f1f77bcf86cd799439099',
    sender: 'Alice',
    preview: 'hello',
    notificationKey: '0123456789abcdef01234567',
    timestamp: '2026-09-08T19:00:00.000Z',
  }, 'p30-token');

  assert.deepEqual(payloads[0].notification, {
    title: 'Alice · General Chat',
    body: 'hello',
  });
  assert.deepEqual(payloads[0].android, {
    priority: 'high',
    notification: { channelId: 'dizychat_messages_v2', proxy: 'allow' },
  });
});


test('Android app creates the DizyChat message notification channel during startup', () => {
  const activity = read('android/app/src/main/java/com/chat/dizychat/MainActivity.java');
  const service = read('android/app/src/main/java/com/chat/dizychat/DizyFirebaseMessagingService.java');
  const notifications = read('android/app/src/main/java/com/chat/dizychat/DizyNotificationManager.java');

  assert.match(activity, /DizyNotificationManager\.ensureChannel\(this\)/);
  assert.match(service, /void onCreate\(\)[\s\S]*DizyNotificationManager\.ensureChannel\(this\)/);
  assert.match(notifications, /static void ensureChannel\(Context context\)/);
  assert.match(notifications, /CHANNEL_ID\s*=\s*"dizychat_messages_v2"/);
  assert.match(notifications, /new NotificationChannel\([\s\S]*CHANNEL_ID[\s\S]*"DizyChat messages"[\s\S]*NotificationManager\.IMPORTANCE_HIGH/);
  assert.match(notifications, /ACTIVITY_CHANNEL_ID\s*=\s*"dizychat_activities_v1"/);
  assert.match(notifications, /new NotificationChannel\([\s\S]*ACTIVITY_CHANNEL_ID[\s\S]*"DizyChat activities"[\s\S]*NotificationManager\.IMPORTANCE_HIGH/);
  assert.match(notifications, /messageChannel\.enableVibration\(true\)/);
  assert.match(notifications, /activityChannel\.enableVibration\(true\)/);
  assert.match(notifications, /activityChannel\.setVibrationPattern\(new long\[\]\{0, 180, 120, 180\}\)/);
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android\.permission\.VIBRATE/);
});


test('native push path emits bounded DizyPushTrace diagnostics', () => {
  const service = read('android/app/src/main/java/com/chat/dizychat/DizyFirebaseMessagingService.java');
  const notifications = read('android/app/src/main/java/com/chat/dizychat/DizyNotificationManager.java');

  assert.match(service, /private static final String TAG = "DizyPushTrace"/);
  assert.match(service, /onMessageReceived id=/);
  assert.match(service, /drop: empty data payload/);
  assert.match(service, /drop: required field missing/);
  assert.match(service, /drop: unsupported type=/);
  assert.match(service, /dispatch message room=/);
  assert.match(service, /dispatch activity room=/);
  assert.match(service, /DizyNotificationManager\.showActivityNotification/);

  assert.match(notifications, /showMessageNotification start room=/);
  assert.match(notifications, /showActivityNotification/);
  assert.match(notifications, /NotificationCompat\.CATEGORY_EVENT/);
  assert.match(notifications, /setTimeoutAfter\(120000L\)/);
  assert.match(notifications, /recordMessage ok notificationId=/);
  assert.match(notifications, /showMessageNotification failed:/);
  assert.match(notifications, /notify start id=/);
  assert.match(notifications, /notify complete id=/);
});


test('activity FCM payload stays data-only so old APKs fail closed while the new APK owns rendering', async () => {
  const payloads = [];
  const transport = createFcmTransport({
    projectId: 'dizychat-test',
    messagingFactory: () => ({
      send: async (payload) => {
        payloads.push(payload);
        return 'ok';
      },
    }),
  });

  await transport.send({
    type: 'activity',
    room: 'General Chat',
    messageId: '',
    sender: 'Alice',
    preview: 'Started sharing their screen',
    notificationKey: 'screen-key',
    timestamp: '2026-09-20T02:30:00.000Z',
    activityType: 'screen-share',
    activityId: 'call-1:alice:screen-share',
  }, 'p30-token');

  assert.equal(payloads[0].notification, undefined);
  assert.deepEqual(payloads[0].android, { priority: 'high', ttl: 120000 });
});
