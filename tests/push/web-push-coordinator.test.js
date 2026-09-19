'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWebPushCoordinator } = require('../../src/push/web-push-coordinator');

const message = {
  _id: '507f1f77bcf86cd799439099',
  room: 'ShittyChat',
  user: 'Alice',
  text: 'hello from web push',
};

test('Web Push excludes the sending account and delivers to other room subscriptions', async () => {
  const sent = [];
  const coordinator = createWebPushCoordinator({
    subscriptionService: {
      listRoomSubscriptions: async () => [
        { canonicalUsername: 'alice', endpoint: 'https://push.example/alice' },
        { canonicalUsername: 'bob', endpoint: 'https://push.example/bob' },
      ],
      retireEndpoint: async () => {},
    },
    transport: {
      send: async (subscription, payload) => {
        sent.push({ subscription, payload });
        return { statusCode: 201 };
      },
    },
  });

  const result = await coordinator.onMessageStored(message, { senderCanonicalUsername: 'alice' });
  assert.deepEqual(result, { attempted: 1, sent: 1, failed: 0 });
  assert.equal(sent[0].subscription.endpoint, 'https://push.example/bob');
  assert.equal(sent[0].payload.room, 'ShittyChat');
  assert.equal(sent[0].payload.messageId, message._id);
  assert.match(sent[0].payload.url, /room=ShittyChat/);
});

test('expired Web Push endpoint is retired without leaking endpoint in logs', async () => {
  const retired = [];
  const logs = [];
  const coordinator = createWebPushCoordinator({
    subscriptionService: {
      listRoomSubscriptions: async () => [
        { canonicalUsername: 'bob', endpoint: 'https://push.example/secret-endpoint' },
      ],
      retireEndpoint: async (...args) => retired.push(args),
    },
    transport: {
      send: async () => {
        const error = new Error('gone https://push.example/secret-endpoint');
        error.statusCode = 410;
        throw error;
      },
    },
    logger: { warn: (...args) => logs.push(args) },
  });

  const result = await coordinator.onMessageStored(message, { senderCanonicalUsername: 'alice' });
  assert.deepEqual(result, { attempted: 1, sent: 0, failed: 1 });
  assert.deepEqual(retired, [['https://push.example/secret-endpoint', 'push-endpoint-gone']]);
  assert.equal(JSON.stringify(logs).includes('secret-endpoint'), false);
});
