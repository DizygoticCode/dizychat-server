const test = require('node:test');
const assert = require('node:assert/strict');
const User = require('../../src/models/user');

test('User model persists canonical identity, role, state, and credential provenance', () => {
  const canonical = User.schema.path('canonicalUsername');
  const username = User.schema.path('username');
  const passwordHash = User.schema.path('passwordHash');
  const role = User.schema.path('role');
  const state = User.schema.path('state');
  const credentialSource = User.schema.path('credentialSource');

  assert.equal(canonical.options.required, true);
  assert.equal(canonical.options.unique, true);
  assert.equal(username.options.required, true);
  assert.equal(passwordHash.options.default, '');
  assert.deepEqual(role.enumValues, ['owner', 'admin', 'user']);
  assert.deepEqual(state.enumValues, ['active', 'disabled', 'unclaimed']);
  assert.deepEqual(credentialSource.enumValues, [
    'legacy-plaintext',
    'legacy-scrypt',
    'managed',
    'unclaimed',
  ]);
  assert.equal(User.schema.options.timestamps, true);
});
