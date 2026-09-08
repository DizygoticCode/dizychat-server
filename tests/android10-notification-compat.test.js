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
