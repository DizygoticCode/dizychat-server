'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWebPushCoordinator } = require('../../src/push/web-push-coordinator');

const subscription = (canonicalUsername, endpoint) => ({
  canonicalUsername,
  endpoint,
  p256dh: 'p256dh',
  auth: 'auth',
});

test('web push activity fanout excludes the starter and carries a room activity route', async () => {
  const sent = [];
  const coordinator = createWebPushCoordinator({
    subscriptionService: {
      listRoomSubscriptions: async () => [
        subscription('rob', 'https://push.example/rob'),
        subscription('nick', 'https://push.example/nick'),
      ],
      retireEndpoint: async () => {},
    },
    transport: {
      send: async (target, payload) => {
        sent.push({ target, payload });
        return { ok: true };
      },
    },
    logger: { warn() {} },
  });

  const result = await coordinator.onActivityStarted({
    room: 'ShittyChat',
    activityType: 'watch-party',
    activityId: 'watch-123',
    sender: 'Rob',
  }, { senderCanonicalUsername: 'rob' });

  assert.deepEqual(result, { attempted: 1, sent: 1, failed: 0 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].target.canonicalUsername, 'nick');
  assert.equal(sent[0].payload.type, 'activity');
  assert.equal(sent[0].payload.title, 'Rob · ShittyChat');
  assert.equal(sent[0].payload.body, 'Started a watch party · Tap to open DizyChat');
  assert.equal(sent[0].payload.activityType, 'watch-party');
  assert.equal(sent[0].payload.activityId, 'watch-123');
  assert.match(sent[0].payload.url, /room=ShittyChat/);
  assert.match(sent[0].payload.url, /activity=watch-party/);
});
