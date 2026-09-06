'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMobileSessionService } = require('../../src/auth/mobile-session-service');

const principal = {
  kind: 'account',
  userId: 'u1',
  username: 'Rob',
  canonicalUsername: 'rob',
  role: 'user',
};

const model = (stored, user = null) => ({
  MobileSessionModel: {
    create: async () => stored,
    findOne: async () => stored,
    updateOne: async () => ({ modifiedCount: 0 }),
    updateMany: async () => ({ modifiedCount: 0 }),
  },
  UserModel: {
    findOne: async () => user,
  },
});

test('issue returns persisted session id without exposing tokenHash', async () => {
  const deps = model({ _id: '507f1f77bcf86cd799439011' });
  const service = createMobileSessionService({ ...deps, tokenFactory: () => 'abc' });

  const result = await service.issue(principal);

  assert.equal(result.sessionId, '507f1f77bcf86cd799439011');
  assert.equal(result.kind, 'mobile');
  assert.equal(Object.hasOwn(result, 'tokenHash'), false);
});

test('resolve returns persisted session id without exposing tokenHash', async () => {
  const deps = model(
    { _id: '507f1f77bcf86cd799439012', canonicalUsername: 'rob', revokedAt: null },
    { _id: 'u1', username: 'Rob', canonicalUsername: 'rob', role: 'user', state: 'active' },
  );
  const service = createMobileSessionService(deps);

  const result = await service.resolve('dcm1.test');

  assert.equal(result.sessionId, '507f1f77bcf86cd799439012');
  assert.equal(result.kind, 'mobile');
  assert.equal(Object.hasOwn(result, 'tokenHash'), false);
});
