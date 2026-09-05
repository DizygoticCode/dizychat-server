'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createMobileSessionService } = require('../src/auth/mobile-session-service');

const ownerAccount = {
  _id: 'owner-id',
  username: 'Dizygotic',
  canonicalUsername: 'dizygotic',
  role: 'owner',
  state: 'active',
};

const ownerPrincipal = {
  kind: 'account',
  userId: 'owner-id',
  username: 'Dizygotic',
  canonicalUsername: 'dizygotic',
  role: 'owner',
};

const matches = (doc, query = {}) => Object.entries(query).every(([key, value]) => {
  if (value === null) return doc[key] == null;
  return doc[key] === value;
});

function createHarness() {
  const documents = [];
  const users = new Map([['dizygotic', { ...ownerAccount }]]);

  const MobileSessionModel = {
    async create(input) {
      const doc = { _id: `session-${documents.length + 1}`, ...input };
      documents.push(doc);
      return doc;
    },
    async findOne(query) {
      return documents.find((doc) => matches(doc, query)) || null;
    },
    async updateOne(query, update) {
      const doc = documents.find((candidate) => matches(candidate, query));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      const values = update?.$set || {};
      const changed = Object.entries(values).some(([key, value]) => doc[key] !== value);
      Object.assign(doc, values);
      return { matchedCount: 1, modifiedCount: changed ? 1 : 0 };
    },
    async updateMany(query, update) {
      let modifiedCount = 0;
      for (const doc of documents) {
        if (!matches(doc, query)) continue;
        Object.assign(doc, update?.$set || {});
        modifiedCount += 1;
      }
      return { modifiedCount };
    },
  };

  const UserModel = {
    async findOne({ canonicalUsername }) {
      return users.get(canonicalUsername) || null;
    },
  };

  return { documents, users, MobileSessionModel, UserModel };
}

function buildService(harness, overrides = {}) {
  return createMobileSessionService({
    MobileSessionModel: harness.MobileSessionModel,
    UserModel: harness.UserModel,
    tokenFactory: () => 'fixed-mobile-secret',
    now: () => new Date('2026-09-04T12:00:00.000Z'),
    ...overrides,
  });
}

test('mobile session issuance returns the raw token once and persists only its SHA-256 hash', async () => {
  const harness = createHarness();
  const service = buildService(harness);

  const issued = await service.issue(ownerPrincipal, { deviceLabel: 'Rob Android' });

  assert.equal(issued.token, 'dcm1.fixed-mobile-secret');
  assert.equal(issued.kind, 'mobile');
  assert.deepEqual(issued.principal, ownerPrincipal);
  assert.equal(harness.documents.length, 1);

  const stored = harness.documents[0];
  const expectedHash = crypto.createHash('sha256').update(issued.token).digest('hex');
  assert.equal(stored.tokenHash, expectedHash);
  assert.equal(stored.canonicalUsername, 'dizygotic');
  assert.equal(stored.userId, 'owner-id');
  assert.equal(stored.deviceLabel, 'Rob Android');
  assert.equal(stored.revokedAt, null);
  assert.equal(Object.prototype.hasOwnProperty.call(stored, 'token'), false);
  assert.equal(JSON.stringify(stored).includes('fixed-mobile-secret'), false);
});

test('durable mobile token resolves after service recreation and uses the current account role', async () => {
  const harness = createHarness();
  const first = buildService(harness);
  const issued = await first.issue(ownerPrincipal);

  harness.users.get('dizygotic').role = 'admin';
  const recreated = buildService(harness, { tokenFactory: () => 'another-secret' });
  const resolved = await recreated.resolve(issued.token);

  assert.equal(resolved.kind, 'mobile');
  assert.equal(resolved.token, issued.token);
  assert.deepEqual(resolved.principal, {
    kind: 'account',
    userId: 'owner-id',
    username: 'Dizygotic',
    canonicalUsername: 'dizygotic',
    role: 'admin',
  });
});

test('malformed, unknown and revoked mobile tokens resolve to null', async () => {
  const harness = createHarness();
  const service = buildService(harness);
  const issued = await service.issue(ownerPrincipal);

  assert.equal(await service.resolve('browser-session-token'), null);
  assert.equal(await service.resolve('dcm1.unknown-secret'), null);
  assert.equal(await service.revoke(issued.token), true);
  assert.equal(await service.resolve(issued.token), null);
  assert.equal(await service.revoke(issued.token), false);
});

test('a disabled account invalidates an otherwise matching durable token', async () => {
  const harness = createHarness();
  const service = buildService(harness);
  const issued = await service.issue(ownerPrincipal);

  harness.users.get('dizygotic').state = 'disabled';

  assert.equal(await service.resolve(issued.token), null);
});

test('revokeUser invalidates every durable token for one account', async () => {
  const harness = createHarness();
  let tokenNumber = 0;
  const service = buildService(harness, { tokenFactory: () => `secret-${++tokenNumber}` });
  const first = await service.issue(ownerPrincipal);
  const second = await service.issue(ownerPrincipal);

  assert.equal(await service.revokeUser('DIZYGOTIC'), 2);
  assert.equal(await service.resolve(first.token), null);
  assert.equal(await service.resolve(second.token), null);
});

test('mobile session service rejects non-account principals', async () => {
  const harness = createHarness();
  const service = buildService(harness);

  await assert.rejects(
    () => service.issue({ kind: 'guest', username: 'Guest' }),
    /account principal/i
  );
});
