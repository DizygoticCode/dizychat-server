const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalizeUsername, PROTECTED_ACCOUNTS } = require('../../src/auth/identity');

test('canonical usernames are trimmed and case-insensitive', () => {
  assert.equal(canonicalizeUsername('  DiZyGoTiC  '), 'dizygotic');
  assert.equal(canonicalizeUsername(' Psybin '), 'psybin');
  assert.equal(canonicalizeUsername(null), '');
});

test('protected identities preserve owner/admin history', () => {
  assert.deepEqual(
    PROTECTED_ACCOUNTS.map(({ username, canonicalUsername, role }) => ({
      username,
      canonicalUsername,
      role,
    })),
    [
      { username: 'Dizygotic', canonicalUsername: 'dizygotic', role: 'owner' },
      { username: 'Psybin', canonicalUsername: 'psybin', role: 'admin' },
    ]
  );
});
