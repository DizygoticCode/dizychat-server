const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword } = require('../../src/auth/passwords');
const { readLegacyAdminCredentials } = require('../../src/auth/legacy-admin-credentials');

test('legacy credential parser prefers explicit scrypt credentials over plaintext for the same user', () => {
  const hashed = hashPassword('hashed-secret');
  const credentials = readLegacyAdminCredentials({
    ADMIN_CREDENTIALS_HASHED: `Dizygotic:${hashed}`,
    ADMIN_CREDENTIALS: 'Dizygotic:old-plaintext',
  });

  const entry = credentials.get('dizygotic');
  assert.equal(entry.username, 'Dizygotic');
  assert.equal(entry.kind, 'scrypt');
  assert.equal(entry.credential, hashed);
});

test('legacy credential parser preserves Psybin as an explicitly named migration source', () => {
  const credentials = readLegacyAdminCredentials({
    ADMIN_CREDENTIALS: 'Psybin:temporary-migration-password',
  });

  assert.deepEqual(credentials.get('psybin'), {
    username: 'Psybin',
    kind: 'plaintext',
    credential: 'temporary-migration-password',
    source: 'ADMIN_CREDENTIALS',
  });
});
