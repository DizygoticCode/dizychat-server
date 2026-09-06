'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPushDeviceService } = require('../../src/push/push-device-service');

const matches = (doc, query = {}) => Object.entries(query).every(([key, expected]) => {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    if (Object.hasOwn(expected, '$ne')) return doc[key] !== expected.$ne;
    if (Object.hasOwn(expected, '$in')) return expected.$in.includes(doc[key]);
  }
  if (expected === null) return doc[key] == null;
  return String(doc[key] ?? '') === String(expected ?? '');
});

const model = (seed = []) => {
  const docs = seed.map((item) => ({ ...item }));
  return {
    docs,
    async findOne(query) { return docs.find((doc) => matches(doc, query)) || null; },
    async find(query) { return docs.filter((doc) => matches(doc, query)); },
    async findOneAndUpdate(query, update, options = {}) {
      let doc = docs.find((item) => matches(item, query));
      if (!doc && options.upsert) {
        doc = { ...query };
        for (const [key, value] of Object.entries(doc)) {
          if (value && typeof value === 'object') delete doc[key];
        }
        docs.push(doc);
      }
      if (!doc) return null;
      Object.assign(doc, update?.$setOnInsert || {}, update?.$set || {});
      return doc;
    },
    async updateOne(query, update) {
      const doc = docs.find((item) => matches(item, query));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(doc, update?.$set || {});
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async updateMany(query, update) {
      let modifiedCount = 0;
      docs.filter((item) => matches(item, query)).forEach((doc) => {
        Object.assign(doc, update?.$set || {});
        modifiedCount += 1;
      });
      return { modifiedCount };
    },
    async deleteOne(query) {
      const index = docs.findIndex((item) => matches(item, query));
      if (index < 0) return { deletedCount: 0 };
      docs.splice(index, 1);
      return { deletedCount: 1 };
    },
    async deleteMany(query) {
      let deletedCount = 0;
      for (let index = docs.length - 1; index >= 0; index -= 1) {
        if (!matches(docs[index], query)) continue;
        docs.splice(index, 1);
        deletedCount += 1;
      }
      return { deletedCount };
    },
  };
};

const session = (id, username = 'rob', revokedAt = null) => ({ _id: id, canonicalUsername: username, revokedAt });
const user = (username = 'rob', state = 'active') => ({ canonicalUsername: username, state });

function harness() {
  const PushDeviceModel = model();
  const SubscriptionModel = model();
  const MobileSessionModel = model([
    session('507f1f77bcf86cd799439011', 'rob'),
    session('507f1f77bcf86cd799439012', 'rob'),
    session('507f1f77bcf86cd799439013', 'nick'),
  ]);
  const UserModel = model([user('rob'), user('nick')]);
  const service = createPushDeviceService({
    PushDeviceModel,
    SubscriptionModel,
    MobileSessionModel,
    UserModel,
    now: () => new Date('2026-09-05T20:00:00.000Z'),
  });
  return { service, PushDeviceModel, SubscriptionModel, MobileSessionModel, UserModel };
}

const register = (service, overrides = {}) => service.registerDevice({
  sessionId: '507f1f77bcf86cd799439011', canonicalUsername: 'rob',
  deviceId: 'dev1', fcmToken: 'token1', deviceLabel: 'Pixel', ...overrides,
});

test('register requires a non-revoked mobile session and active account', async () => {
  const h = harness();
  await assert.rejects(() => register(h.service, { sessionId: '507f1f77bcf86cd799439099' }), /MOBILE_SESSION_INVALID/);
  h.UserModel.docs.find((item) => item.canonicalUsername === 'rob').state = 'disabled';
  await assert.rejects(() => register(h.service), /ACCOUNT_INACTIVE/);
});

test('registered device can subscribe only under its exact session and account', async () => {
  const h = harness();
  await register(h.service);
  await h.service.subscribeRoom({ sessionId: '507f1f77bcf86cd799439011', canonicalUsername: 'rob', deviceId: 'dev1', room: 'ShittyChat' });
  assert.ok(await h.service.findActiveSubscription({ sessionId: '507f1f77bcf86cd799439011', deviceId: 'dev1', room: 'ShittyChat' }));
  assert.equal(await h.service.findActiveSubscription({ sessionId: '507f1f77bcf86cd799439012', deviceId: 'dev1', room: 'ShittyChat' }), null);
  await assert.rejects(() => h.service.subscribeRoom({ sessionId: '507f1f77bcf86cd799439011', canonicalUsername: 'nick', deviceId: 'dev1', room: 'ShittyChat' }), /DEVICE_ACCOUNT_MISMATCH/);
});

test('token rotation retires the other active owner and preserves the incoming device', async () => {
  const h = harness();
  await register(h.service);
  await register(h.service, { sessionId: '507f1f77bcf86cd799439012', deviceId: 'dev2', fcmToken: 'token1' });
  const oldDevice = h.PushDeviceModel.docs.find((item) => item.deviceId === 'dev1');
  const newDevice = h.PushDeviceModel.docs.find((item) => item.deviceId === 'dev2');
  assert.ok(oldDevice.disabledAt instanceof Date);
  assert.equal(newDevice.disabledAt, null);
  assert.equal(newDevice.fcmToken, 'token1');
});

test('two devices on the same account retain independent subscriptions and leases', async () => {
  const h = harness();
  await register(h.service);
  await register(h.service, { sessionId: '507f1f77bcf86cd799439012', deviceId: 'dev2', fcmToken: 'token2' });
  await h.service.subscribeRoom({ sessionId: '507f1f77bcf86cd799439011', canonicalUsername: 'rob', deviceId: 'dev1', room: 'A' });
  await h.service.subscribeRoom({ sessionId: '507f1f77bcf86cd799439012', canonicalUsername: 'rob', deviceId: 'dev2', room: 'B' });
  await h.service.renewSuppressionLease({ sessionId: '507f1f77bcf86cd799439011', deviceId: 'dev1', ttlMs: 15000 });
  assert.ok(h.PushDeviceModel.docs.find((item) => item.deviceId === 'dev1').suppressionLeaseExpiresAt instanceof Date);
  assert.equal(h.PushDeviceModel.docs.find((item) => item.deviceId === 'dev2').suppressionLeaseExpiresAt ?? null, null);
  assert.equal(h.SubscriptionModel.docs.length, 2);
});

test('disableSession affects only that mobile session while disableUser clears the whole account', async () => {
  const h = harness();
  await register(h.service);
  await register(h.service, { sessionId: '507f1f77bcf86cd799439012', deviceId: 'dev2', fcmToken: 'token2' });
  await h.service.subscribeRoom({ sessionId: '507f1f77bcf86cd799439011', canonicalUsername: 'rob', deviceId: 'dev1', room: 'A' });
  await h.service.subscribeRoom({ sessionId: '507f1f77bcf86cd799439012', canonicalUsername: 'rob', deviceId: 'dev2', room: 'A' });
  await h.service.disableSession('507f1f77bcf86cd799439011', 'logout');
  assert.equal(h.SubscriptionModel.docs.some((item) => item.sessionId === '507f1f77bcf86cd799439011'), false);
  assert.equal(h.SubscriptionModel.docs.some((item) => item.sessionId === '507f1f77bcf86cd799439012'), true);
  await h.service.disableUser('rob', 'account-revoked');
  assert.equal(h.SubscriptionModel.docs.some((item) => item.canonicalUsername === 'rob'), false);
  assert.equal(h.PushDeviceModel.docs.filter((item) => item.canonicalUsername === 'rob' && item.disabledAt == null).length, 0);
});

test('recipient listing revalidates revoked sessions and inactive accounts', async () => {
  const h = harness();
  await register(h.service);
  await h.service.subscribeRoom({ sessionId: '507f1f77bcf86cd799439011', canonicalUsername: 'rob', deviceId: 'dev1', room: 'A' });
  assert.equal((await h.service.listRoomDevices('A')).length, 1);
  h.MobileSessionModel.docs[0].revokedAt = new Date();
  assert.equal((await h.service.listRoomDevices('A')).length, 0);
  h.MobileSessionModel.docs[0].revokedAt = null;
  h.UserModel.docs.find((item) => item.canonicalUsername === 'rob').state = 'disabled';
  assert.equal((await h.service.listRoomDevices('A')).length, 0);
});

test('account device listing returns only active devices backed by active mobile sessions', async () => {
  const h = harness();
  await register(h.service);
  await register(h.service, { sessionId: '507f1f77bcf86cd799439012', deviceId: 'dev2', fcmToken: 'token2' });
  await register(h.service, { sessionId: '507f1f77bcf86cd799439013', canonicalUsername: 'nick', deviceId: 'nick-dev', fcmToken: 'nick-token' });
  h.PushDeviceModel.docs.find((item) => item.deviceId === 'dev2').disabledAt = new Date('2026-09-05T20:00:01.000Z');
  assert.deepEqual((await h.service.listAccountDevices('ROB')).map((item) => item.deviceId), ['dev1']);
  h.MobileSessionModel.docs.find((item) => item._id === '507f1f77bcf86cd799439011').revokedAt = new Date('2026-09-05T20:00:02.000Z');
  assert.deepEqual(await h.service.listAccountDevices('rob'), []);
  assert.deepEqual((await h.service.listAccountDevices('nick')).map((item) => item.deviceId), ['nick-dev']);
});

test('retireToken disables only matching active token and clears its lease', async () => {
  const h = harness();
  await register(h.service);
  await h.service.renewSuppressionLease({ sessionId: '507f1f77bcf86cd799439011', deviceId: 'dev1', ttlMs: 15000 });
  await h.service.retireToken('token1', 'invalid-token');
  const device = h.PushDeviceModel.docs[0];
  assert.ok(device.disabledAt instanceof Date);
  assert.equal(device.disabledReason, 'invalid-token');
  assert.equal(device.suppressionLeaseExpiresAt, null);
});
