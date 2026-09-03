const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionStore } = require('../../src/auth/session-store');

const ownerPrincipal = {
  kind: 'account',
  userId: 'owner-id',
  username: 'Dizygotic',
  canonicalUsername: 'dizygotic',
  role: 'owner',
};

test('session store issues and resolves expiring account sessions', () => {
  let now = 1_000;
  let tokenNumber = 0;
  const store = createSessionStore({
    ttlMs: 5_000,
    now: () => now,
    tokenFactory: () => `token-${++tokenNumber}`,
  });

  const issued = store.issue(ownerPrincipal);
  assert.equal(issued.token, 'token-1');
  assert.equal(issued.expiresAt, 6_000);
  assert.deepEqual(store.resolve('token-1').principal, ownerPrincipal);

  now = 6_001;
  assert.equal(store.resolve('token-1'), null);
});

test('revoke removes one token immediately', () => {
  const store = createSessionStore({ ttlMs: 5_000, tokenFactory: () => 'one-token' });
  store.issue(ownerPrincipal);
  assert.equal(store.resolve('one-token') !== null, true);
  store.revoke('one-token');
  assert.equal(store.resolve('one-token'), null);
});

test('revokeUser invalidates every session for one account without touching another account', () => {
  const tokens = ['owner-a', 'owner-b', 'psybin-a'];
  const store = createSessionStore({
    ttlMs: 5_000,
    tokenFactory: () => tokens.shift(),
  });

  store.issue(ownerPrincipal);
  store.issue(ownerPrincipal);
  store.issue({
    kind: 'account', userId: 'psybin-id', username: 'Psybin',
    canonicalUsername: 'psybin', role: 'admin',
  });

  store.revokeUser('DIZYGOTIC');
  assert.equal(store.resolve('owner-a'), null);
  assert.equal(store.resolve('owner-b'), null);
  assert.equal(store.resolve('psybin-a')?.principal.username, 'Psybin');
});

test('session store refuses principals without a registered canonical account identity', () => {
  const store = createSessionStore({ ttlMs: 5_000 });
  assert.throws(() => store.issue({ kind: 'guest', username: 'Guest' }), /account principal/i);
});
