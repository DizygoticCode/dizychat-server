'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  readWebPushConfig,
  createConfiguredWebPushTransport,
} = require('../../src/push/web-push-config');

test('disabled Web Push transport is explicit and never attempts delivery', async () => {
  const warnings = [];
  const transport = createConfiguredWebPushTransport({
    config: { enabled: false, publicKey: '', privateKey: '', subject: '' },
    logger: { warn: (...args) => warnings.push(args) },
  });
  assert.equal(transport.enabled, false);
  assert.deepEqual(await transport.send({}, {}), { skipped: true, reason: 'web-push-disabled' });
  assert.equal(warnings.some((entry) => String(entry[0]).includes('disabled')), true);
});

test('enabled Web Push requires complete VAPID configuration', () => {
  assert.throws(
    () => createConfiguredWebPushTransport({
      config: { enabled: true, publicKey: '', privateKey: '', subject: '' },
      webPushModule: {},
    }),
    /DIZYCHAT_WEB_PUSH_CONFIG_REQUIRED/,
  );
});

test('enabled Web Push configures VAPID and sends bounded JSON payloads', async () => {
  const calls = [];
  const module = {
    setVapidDetails: (...args) => calls.push(['vapid', ...args]),
    sendNotification: async (...args) => {
      calls.push(['send', ...args]);
      return { statusCode: 201 };
    },
  };
  const transport = createConfiguredWebPushTransport({
    config: {
      enabled: true,
      publicKey: 'public-key',
      privateKey: 'private-key',
      subject: 'mailto:admin@example.com',
    },
    webPushModule: module,
  });
  const result = await transport.send(
    { endpoint: 'https://push.example/sub', p256dh: 'p256dh', auth: 'auth' },
    { title: 'DizyChat', body: 'hello' },
  );
  assert.equal(transport.enabled, true);
  assert.equal(transport.publicKey, 'public-key');
  assert.deepEqual(calls[0], ['vapid', 'mailto:admin@example.com', 'public-key', 'private-key']);
  assert.equal(calls[1][0], 'send');
  assert.equal(JSON.parse(calls[1][2]).body, 'hello');
  assert.equal(result.statusCode, 201);
});

test('Web Push config parser requires explicit enable', () => {
  assert.deepEqual(readWebPushConfig({
    DIZYCHAT_WEB_PUSH_ENABLED: 'yes',
    DIZYCHAT_WEB_PUSH_VAPID_PUBLIC_KEY: ' pub ',
    DIZYCHAT_WEB_PUSH_VAPID_PRIVATE_KEY: ' priv ',
    DIZYCHAT_WEB_PUSH_SUBJECT: ' mailto:admin@example.com ',
  }), {
    enabled: true,
    publicKey: 'pub',
    privateKey: 'priv',
    subject: 'mailto:admin@example.com',
  });
  assert.equal(readWebPushConfig({ DIZYCHAT_WEB_PUSH_ENABLED: 'off' }).enabled, false);
});
