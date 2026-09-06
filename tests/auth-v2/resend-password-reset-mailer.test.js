'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

let createResendPasswordResetMailer;
let moduleLoadError = null;
try {
  ({ createResendPasswordResetMailer } = require('../../src/auth/resend-password-reset-mailer'));
} catch (error) {
  moduleLoadError = error;
}

const requireFactory = () => {
  assert.equal(moduleLoadError, null, moduleLoadError?.message || 'mailer module failed to load');
  assert.equal(typeof createResendPasswordResetMailer, 'function');
};

test('Resend password reset transport sends through the emails API with scoped bearer auth and safe defaults', async () => {
  requireFactory();
  const calls = [];
  const fetchImpl = async (...args) => {
    calls.push(args);
    return { ok: true, status: 200 };
  };
  const mailer = createResendPasswordResetMailer({
    fetchImpl,
    apiKey: 're_test_not_a_real_secret',
    publicBaseUrl: 'https://dizychat.com/',
  });

  await mailer.sendPasswordReset({
    to: 'recovery@example.com',
    username: 'ExampleUser',
    token: 'token_value-123',
  });

  assert.equal(calls.length, 1);
  const [url, options] = calls[0];
  assert.equal(url, 'https://api.resend.com/emails');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.Authorization, 'Bearer re_test_not_a_real_secret');
  assert.equal(options.headers['Content-Type'], 'application/json');

  const body = JSON.parse(options.body);
  assert.equal(body.from, 'DizyChat <no-reply@dizychat.com>');
  assert.deepEqual(body.to, ['recovery@example.com']);
  assert.equal(body.reply_to, 'dizychat@proton.me');
  assert.equal(body.subject, 'Reset your DizyChat password');
  assert.match(body.text, /https:\/\/dizychat\.com\/reset-password\.html\?token=token_value-123/);
  assert.match(body.html, /https:\/\/dizychat\.com\/reset-password\.html\?token=token_value-123/);
  assert.match(body.text, /ExampleUser/);
});

test('Resend transport honors configured sender and Reply-To without requiring a mailbox password', async () => {
  requireFactory();
  let payload = null;
  const mailer = createResendPasswordResetMailer({
    fetchImpl: async (_url, options) => {
      payload = JSON.parse(options.body);
      return { ok: true, status: 202 };
    },
    apiKey: 're_test_key',
    from: 'DizyChat Security <security@dizychat.com>',
    replyTo: 'dizychat@proton.me',
    publicBaseUrl: 'https://dizychat.com',
  });

  await mailer.sendPasswordReset({
    to: 'person@example.net',
    username: 'Person',
    token: 'abc_DEF-123',
  });

  assert.equal(payload.from, 'DizyChat Security <security@dizychat.com>');
  assert.equal(payload.reply_to, 'dizychat@proton.me');
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'password'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'smtp'), false);
});

test('Resend transport URL-encodes the reset token and trims the public base URL', async () => {
  requireFactory();
  let payload = null;
  const mailer = createResendPasswordResetMailer({
    fetchImpl: async (_url, options) => {
      payload = JSON.parse(options.body);
      return { ok: true, status: 200 };
    },
    apiKey: 're_test_key',
    publicBaseUrl: 'https://dizychat.com///',
  });

  await mailer.sendPasswordReset({
    to: 'person@example.net',
    username: 'Person',
    token: 'token with ? and &',
  });

  assert.match(payload.text, /https:\/\/dizychat\.com\/reset-password\.html\?token=token%20with%20%3F%20and%20%26/);
});

test('Resend transport fails closed on missing configuration and non-success API responses', async () => {
  requireFactory();
  assert.throws(
    () => createResendPasswordResetMailer({ fetchImpl: async () => ({ ok: true }), publicBaseUrl: 'https://dizychat.com' }),
    /api key/i
  );
  assert.throws(
    () => createResendPasswordResetMailer({ fetchImpl: async () => ({ ok: true }), apiKey: 're_test_key' }),
    /public base url/i
  );

  const mailer = createResendPasswordResetMailer({
    fetchImpl: async () => ({ ok: false, status: 403 }),
    apiKey: 're_test_key',
    publicBaseUrl: 'https://dizychat.com',
  });
  await assert.rejects(
    mailer.sendPasswordReset({ to: 'person@example.net', username: 'Person', token: 'token' }),
    (error) => {
      assert.equal(error?.code, 'PASSWORD_RESET_MAIL_FAILED');
      assert.equal(String(error?.message || '').includes('person@example.net'), false);
      assert.equal(String(error?.message || '').includes('token'), false);
      return true;
    }
  );
});
