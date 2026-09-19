'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { selectProbeDevice, buildProbeMessage, safeCredentialIdentity } = require('../../scripts/diagnose-android-push');
const device = { fcmToken: 'test-token', canonicalUsername: 'dizygotic' };
test('probe selects only the exact current phone fingerprint and refuses missing/ambiguous targets', () => {
  assert.equal(selectProbeDevice([device, { fcmToken: 'old-token' }], '4c5dc9b77089'), device);
  assert.throws(() => selectProbeDevice([device], ''), /FINGERPRINT_INVALID/);
  assert.throws(() => selectProbeDevice([device], 'aaaaaaaaaaaa'), /TARGET_NOT_UNIQUE/);
  assert.throws(() => selectProbeDevice([device, device], '4c5dc9b77089'), /TARGET_NOT_UNIQUE/);
});
test('probe reaches custom service as high priority data-only with valid renderer fields', () => {
  const message = buildProbeMessage(device, '507f1f77bcf86cd799439099', new Date('2026-09-19T20:00:00Z'));
  assert.equal(message.token, 'test-token');
  assert.deepEqual(message.android, { priority: 'high', ttl: 60000, restrictedPackageName: 'com.chat.dizychat' });
  assert.equal(message.notification, undefined);
  assert.equal(message.data.type, 'message');
  assert.match(message.data.messageId, /^[a-f0-9]{24}$/);
  assert.match(message.data.notificationKey, /^[a-f0-9]{24}$/);
  assert.equal(message.data.room, 'FCM diagnostic');
  assert.equal(message.data.timestamp, '2026-09-19T20:00:00.000Z');
});
test('credential identity allowlists public metadata and hashes principal; never returns keys', () => {
  const out = safeCredentialIdentity({ type: 'service_account', project_id: 'dizychat', client_email: 'private-principal', private_key: 'SECRET', private_key_id: 'SECRET2' });
  assert.equal(out.credentialProjectId, 'dizychat');
  assert.equal(out.credentialType, 'service_account');
  assert.match(out.principalFingerprint, /^[a-f0-9]{12}$/);
  assert.equal(JSON.stringify(out).includes('SECRET'), false);
  assert.equal(JSON.stringify(out).includes('private-principal'), false);
});
