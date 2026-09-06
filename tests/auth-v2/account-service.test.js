'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, isScryptHash } = require('../../src/auth/passwords');
const { createAccountService } = require('../../src/auth/account-service');

class FakeUserModel {
  static records = new Map();

  static reset() {
    this.records = new Map();
  }

  static async findOne(query = {}) {
    const canonical = query.canonicalUsername;
    return canonical ? this.records.get(canonical) || null : null;
  }

  static async create(data) {
    const doc = new FakeUserModel(data);
    await doc.save();
    return doc;
  }

  constructor(data = {}) {
    Object.assign(this, data);
    this._id = data._id || `fake-${data.canonicalUsername}`;
  }

  async save() {
    FakeUserModel.records.set(this.canonicalUsername, this);
    return this;
  }
}

const makeService = (legacyEntries = []) => {
  FakeUserModel.reset();
  return createAccountService({
    UserModel: FakeUserModel,
    legacyCredentials: new Map(legacyEntries),
  });
};

const rejectsWithCode = async (promise, code) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.code, code);
    return true;
  });
};

test('bootstrap creates Dizygotic owner and preserves Psybin admin as unclaimed without a credential', async () => {
  const service = makeService();
  await service.bootstrapProtectedAccounts();

  const dizy = await FakeUserModel.findOne({ canonicalUsername: 'dizygotic' });
  const psybin = await FakeUserModel.findOne({ canonicalUsername: 'psybin' });

  assert.equal(dizy.username, 'Dizygotic');
  assert.equal(dizy.role, 'owner');
  assert.equal(dizy.state, 'unclaimed');
  assert.equal(psybin.username, 'Psybin');
  assert.equal(psybin.role, 'admin');
  assert.equal(psybin.state, 'unclaimed');
});

test('bootstrap migrates plaintext legacy credentials into persisted scrypt hashes and is idempotent', async () => {
  const service = makeService([
    ['dizygotic', {
      username: 'Dizygotic',
      kind: 'plaintext',
      credential: 'temporary-owner-password',
      source: 'ADMIN_PASSWORD',
    }],
  ]);

  await service.bootstrapProtectedAccounts();
  await service.bootstrapProtectedAccounts();

  assert.equal(FakeUserModel.records.size, 2);
  const dizy = await FakeUserModel.findOne({ canonicalUsername: 'dizygotic' });
  assert.equal(dizy.state, 'active');
  assert.equal(dizy.credentialSource, 'legacy-plaintext');
  assert.equal(isScryptHash(dizy.passwordHash), true);
  assert.equal(dizy.passwordHash.includes('temporary-owner-password'), false);
  assert.equal(await service.authenticate('DIZYGOTIC', 'temporary-owner-password') !== null, true);
});

test('bootstrap reuses legacy scrypt without weakening it', async () => {
  const legacyHash = hashPassword('psybin-secret');
  const service = makeService([
    ['psybin', {
      username: 'Psybin',
      kind: 'scrypt',
      credential: legacyHash,
      source: 'ADMIN_CREDENTIALS_HASHED',
    }],
  ]);

  await service.bootstrapProtectedAccounts();
  const psybin = await FakeUserModel.findOne({ canonicalUsername: 'psybin' });
  assert.equal(psybin.passwordHash, legacyHash);
  assert.equal(psybin.credentialSource, 'legacy-scrypt');
  assert.equal(psybin.state, 'active');
});

test('bootstrap repairs a protected role upward but never demotes a stronger existing role', async () => {
  const service = makeService();
  await FakeUserModel.create({
    username: 'Dizygotic',
    canonicalUsername: 'dizygotic',
    passwordHash: '',
    role: 'user',
    state: 'unclaimed',
    credentialSource: 'unclaimed',
  });
  await FakeUserModel.create({
    username: 'Psybin',
    canonicalUsername: 'psybin',
    passwordHash: '',
    role: 'owner',
    state: 'unclaimed',
    credentialSource: 'unclaimed',
  });

  await service.bootstrapProtectedAccounts();
  assert.equal((await FakeUserModel.findOne({ canonicalUsername: 'dizygotic' })).role, 'owner');
  assert.equal((await FakeUserModel.findOne({ canonicalUsername: 'psybin' })).role, 'owner');
});

test('disabled and unclaimed accounts cannot authenticate', async () => {
  const service = makeService();
  const passwordHash = hashPassword('secret');

  await FakeUserModel.create({
    username: 'DisabledUser', canonicalUsername: 'disableduser', passwordHash,
    role: 'user', state: 'disabled', credentialSource: 'managed',
  });
  await FakeUserModel.create({
    username: 'UnclaimedUser', canonicalUsername: 'unclaimeduser', passwordHash,
    role: 'user', state: 'unclaimed', credentialSource: 'managed',
  });

  assert.equal(await service.authenticate('DisabledUser', 'secret'), null);
  assert.equal(await service.authenticate('UnclaimedUser', 'secret'), null);
});

test('owner can create managed users; non-owner cannot and protected owner identity cannot be replaced', async () => {
  const service = makeService();
  await service.bootstrapProtectedAccounts();

  const owner = { role: 'owner', canonicalUsername: 'dizygotic' };
  const account = await service.createManagedUser(owner, {
    username: 'SelectedUser',
    password: 'selected-user-password',
  });

  assert.equal(account.username, 'SelectedUser');
  assert.equal(account.role, 'user');
  assert.equal(account.state, 'active');
  assert.equal(await service.isRegisteredUsername(' selecteduser '), true);
  assert.equal((await service.authenticate('SelectedUser', 'selected-user-password')).role, 'user');

  await assert.rejects(
    service.createManagedUser({ role: 'admin' }, { username: 'Nope', password: 'password' }),
    /owner/i
  );
  await assert.rejects(
    service.createManagedUser(owner, { username: 'Dizygotic', password: 'replacement' }),
    /protected/i
  );
});

test('public registration creates an active user, normalizes optional recovery email, keeps it private, and authenticates', async () => {
  const service = makeService();
  const account = await service.registerPublicUser({
    username: '  NewPerson  ',
    password: 'correct-horse',
    recoveryEmail: '  New.Person@Example.COM  ',
  });

  const stored = await FakeUserModel.findOne({ canonicalUsername: 'newperson' });
  assert.equal(stored.username, 'NewPerson');
  assert.equal(stored.role, 'user');
  assert.equal(stored.state, 'active');
  assert.equal(stored.credentialSource, 'self-registered');
  assert.equal(stored.recoveryEmail, 'new.person@example.com');
  assert.equal(isScryptHash(stored.passwordHash), true);
  assert.equal(stored.passwordHash.includes('correct-horse'), false);
  assert.equal(account.recoveryEmail, undefined);
  assert.equal(account.passwordHash, undefined);
  assert.equal(account.passwordResetTokenHash, undefined);
  assert.equal((await service.authenticate('NEWPERSON', 'correct-horse')).username, 'NewPerson');
});

test('public registration permits no recovery email and stores an empty private value', async () => {
  const service = makeService();
  await service.registerPublicUser({ username: 'NoEmail', password: 'password' });
  const stored = await FakeUserModel.findOne({ canonicalUsername: 'noemail' });
  assert.equal(stored.recoveryEmail, '');
});

test('public registration rejects duplicate and protected usernames with stable codes', async () => {
  const service = makeService();
  await service.bootstrapProtectedAccounts();
  await service.registerPublicUser({ username: 'TakenName', password: 'password' });

  await rejectsWithCode(
    service.registerPublicUser({ username: ' takenname ', password: 'another-password' }),
    'ACCOUNT_USERNAME_TAKEN'
  );
  await rejectsWithCode(
    service.registerPublicUser({ username: 'DIZYGOTIC', password: 'another-password' }),
    'ACCOUNT_USERNAME_PROTECTED'
  );
  await rejectsWithCode(
    service.registerPublicUser({ username: 'psybin', password: 'another-password' }),
    'ACCOUNT_USERNAME_PROTECTED'
  );
});

test('public registration enforces 8 to 256 character passwords', async () => {
  const service = makeService();
  await rejectsWithCode(
    service.registerPublicUser({ username: 'TooShort', password: '1234567' }),
    'ACCOUNT_PASSWORD_INVALID'
  );
  await rejectsWithCode(
    service.registerPublicUser({ username: 'TooLong', password: 'x'.repeat(257) }),
    'ACCOUNT_PASSWORD_INVALID'
  );

  await service.registerPublicUser({ username: 'ExactlyEight', password: '12345678' });
  await service.registerPublicUser({ username: 'ExactlyMax', password: 'x'.repeat(256) });
  assert.equal(await service.isRegisteredUsername('ExactlyEight'), true);
  assert.equal(await service.isRegisteredUsername('ExactlyMax'), true);
});

test('public registration rejects malformed recovery email without making email mandatory', async () => {
  const service = makeService();
  await rejectsWithCode(
    service.registerPublicUser({ username: 'BadEmail', password: 'password', recoveryEmail: 'not-an-email' }),
    'ACCOUNT_RECOVERY_EMAIL_INVALID'
  );
});
