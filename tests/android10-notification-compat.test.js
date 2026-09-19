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

  assert.deepEqual(payloads[0].android, { priority: 'high' });
});


test('Android app creates the DizyChat message notification channel during startup', () => {
  const activity = read('android/app/src/main/java/com/chat/dizychat/MainActivity.java');
  const service = read('android/app/src/main/java/com/chat/dizychat/DizyFirebaseMessagingService.java');
  const notifications = read('android/app/src/main/java/com/chat/dizychat/DizyNotificationManager.java');

  assert.match(activity, /DizyNotificationManager\.ensureChannel\(this\)/);
  assert.match(service, /void onCreate\(\)[\s\S]*DizyNotificationManager\.ensureChannel\(this\)/);
  assert.match(notifications, /static void ensureChannel\(Context context\)/);
  assert.match(notifications, /CHANNEL_ID\s*=\s*"dizychat_messages_v1"/);
  assert.match(notifications, /new NotificationChannel\([\s\S]*CHANNEL_ID[\s\S]*"DizyChat messages"[\s\S]*NotificationManager\.IMPORTANCE_HIGH/);
});
