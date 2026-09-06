const test = require('node:test');
const assert = require('node:assert/strict');
const User = require('../../src/models/user');

test('User model persists canonical identity, role, state, credential provenance, and private recovery state', () => {
  const canonical = User.schema.path('canonicalUsername');
  const username = User.schema.path('username');
  const passwordHash = User.schema.path('passwordHash');
  const recoveryEmail = User.schema.path('recoveryEmail');
  const passwordResetTokenHash = User.schema.path('passwordResetTokenHash');
  const passwordResetExpiresAt = User.schema.path('passwordResetExpiresAt');
  const role = User.schema.path('role');
  const state = User.schema.path('state');
  const credentialSource = User.schema.path('credentialSource');

  assert.equal(canonical.options.required, true);
  assert.equal(canonical.options.unique, true);
  assert.equal(username.options.required, true);
  assert.equal(passwordHash.options.default, '');
  assert.equal(recoveryEmail.options.default, '');
  assert.equal(recoveryEmail.options.trim, true);
  assert.equal(recoveryEmail.options.lowercase, true);
  assert.equal(passwordResetTokenHash.options.default, '');
  assert.equal(passwordResetExpiresAt.options.default, null);
  assert.deepEqual(role.enumValues, ['owner', 'admin', 'user']);
  assert.deepEqual(state.enumValues, ['active', 'disabled', 'unclaimed']);
  assert.deepEqual(credentialSource.enumValues, [
    'legacy-plaintext',
    'legacy-scrypt',
    'managed',
    'self-registered',
    'unclaimed',
  ]);
  assert.equal(User.schema.options.timestamps, true);
});
