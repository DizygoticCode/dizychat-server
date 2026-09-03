const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword, isScryptHash } = require('../../src/auth/passwords');

test('scrypt hashing never stores the plaintext password', () => {
  const password = 'correct horse battery staple';
  const encoded = hashPassword(password);
  assert.equal(isScryptHash(encoded), true);
  assert.equal(encoded.includes(password), false);
  assert.equal(verifyPassword(password, encoded), true);
  assert.equal(verifyPassword('wrong', encoded), false);
});

test('password verification rejects malformed hashes', () => {
  assert.equal(isScryptHash('not-a-hash'), false);
  assert.equal(verifyPassword('anything', 'not-a-hash'), false);
});
