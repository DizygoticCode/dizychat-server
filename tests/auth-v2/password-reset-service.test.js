'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { hashPassword, verifyPassword } = require('../../src/auth/passwords');

let createPasswordResetService;
let moduleLoadError = null;
try {
  ({ createPasswordResetService } = require('../../src/auth/password-reset-service'));
} catch (error) {
  moduleLoadError = error;
}

const requireFactory = () => {
  assert.equal(moduleLoadError, null, moduleLoadError?.message || 'reset service module failed to load');
  assert.equal(typeof createPasswordResetService, 'function');
};

class FakeUserModel {
  static records = [];

  static reset(records = []) {
    this.records = records.map((record, index) => new FakeUserModel({ _id: `fake-${index}`, ...record }));
  }

  static async findOne(query = {}) {
    return this.records.find((record) => {
      if (query.canonicalUsername != null && record.canonicalUsername !== query.canonicalUsername) return false;
      if (query.passwordResetTokenHash != null && record.passwordResetTokenHash !== query.passwordResetTokenHash) return false;
      if (query.state != null && record.state !== query.state) return false;
      return true;
    }) || null;
  }

  constructor(data = {}) {
    Object.assign(this, data);
    this.passwordResetTokenHash ??= '';
    this.passwordResetExpiresAt ??= null;
    this.recoveryEmail ??= '';
  }

  async save() {
    return this;
  }
}

const makeAccount = (overrides = {}) => ({
  username: 'ResetUser',
  canonicalUsername: 'resetuser',
  passwordHash: hashPassword('old-password'),
  recoveryEmail: 'reset@example.com',
  passwordResetTokenHash: '',
  passwordResetExpiresAt: null,
  role: 'user',
  state: 'active',
  credentialSource: 'managed',
  ...overrides,
});

const makeService = ({
  records = [makeAccount()],
  nowMs = Date.UTC(2026, 8, 6, 19, 0, 0),
  tokenFactory = () => 'fixed-reset-token',
  mailer,
  browserRevocations = [],
  mobileRevocations = [],
  warnings = [],
} = {}) => {
  requireFactory();
  FakeUserModel.reset(records);
  return {
    service: createPasswordResetService({
      UserModel: FakeUserModel,
      mailer: mailer || {
        sendPasswordReset: async () => {},
      },
      sessionStore: {
        revokeUser: async (username) => {
          browserRevocations.push(username);
          return 1;
        },
      },
      mobileSessionService: {
        revokeUser: async (username) => {
          mobileRevocations.push(username);
          return 1;
        },
      },
      now: () => new Date(nowMs),
      tokenFactory,
      logger: {
        warn: (...args) => warnings.push(args),
      },
    }),
    browserRevocations,
    mobileRevocations,
    warnings,
  };
};

const rejectsWithCode = async (promise, code) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.code, code);
    return true;
  });
};

test('reset request is generic for unknown, disabled, or recovery-email-less accounts', async () => {
  requireFactory();
  let mailCount = 0;
  const mailer = { sendPasswordReset: async () => { mailCount += 1; } };

  for (const records of [
    [],
    [makeAccount({ state: 'disabled' })],
    [makeAccount({ recoveryEmail: '' })],
  ]) {
    const { service } = makeService({ records, mailer });
    assert.deepEqual(await service.requestReset('ResetUser'), { ok: true });
  }

  assert.equal(mailCount, 0);
});

test('reset request stores only SHA-256 token hash, expires in 30 minutes, and replaces an older token', async () => {
  const nowMs = Date.UTC(2026, 8, 6, 19, 0, 0);
  const sent = [];
  let sequence = 0;
  const tokens = ['first-public-token', 'second-public-token'];
  const { service } = makeService({
    nowMs,
    tokenFactory: () => tokens[sequence++],
    mailer: {
      sendPasswordReset: async (message) => sent.push(message),
    },
  });

  await service.requestReset(' RESETUSER ');
  const account = FakeUserModel.records[0];
  const firstHash = crypto.createHash('sha256').update(tokens[0], 'utf8').digest('hex');
  assert.equal(account.passwordResetTokenHash, firstHash);
  assert.notEqual(account.passwordResetTokenHash, tokens[0]);
  assert.equal(new Date(account.passwordResetExpiresAt).getTime(), nowMs + 30 * 60 * 1000);
  assert.equal(sent[0].token, tokens[0]);
  assert.equal(sent[0].to, 'reset@example.com');

  await service.requestReset('resetuser');
  const secondHash = crypto.createHash('sha256').update(tokens[1], 'utf8').digest('hex');
  assert.equal(account.passwordResetTokenHash, secondHash);
  assert.notEqual(account.passwordResetTokenHash, firstHash);
  assert.equal(sent[1].token, tokens[1]);
});

test('default reset-token factory produces a 32-byte base64url public token and stores only its hash', async () => {
  requireFactory();
  FakeUserModel.reset([makeAccount()]);
  let sentToken = '';
  const service = createPasswordResetService({
    UserModel: FakeUserModel,
    mailer: {
      sendPasswordReset: async ({ token }) => { sentToken = token; },
    },
    sessionStore: { revokeUser: async () => 0 },
    mobileSessionService: { revokeUser: async () => 0 },
    now: () => new Date('2026-09-06T19:00:00Z'),
    logger: { warn: () => {} },
  });

  await service.requestReset('resetuser');
  assert.equal(Buffer.from(sentToken, 'base64url').length, 32);
  assert.match(sentToken, /^[A-Za-z0-9_-]+$/);
  assert.equal(FakeUserModel.records[0].passwordResetTokenHash, crypto.createHash('sha256').update(sentToken, 'utf8').digest('hex'));
  assert.notEqual(FakeUserModel.records[0].passwordResetTokenHash, sentToken);
});

test('mail delivery failure keeps the reset request generic and logs no recipient or raw token', async () => {
  const warnings = [];
  const { service } = makeService({
    tokenFactory: () => 'secret-reset-token',
    warnings,
    mailer: {
      sendPasswordReset: async () => {
        const error = new Error('provider unavailable');
        error.code = 'PASSWORD_RESET_MAIL_FAILED';
        throw error;
      },
    },
  });

  assert.deepEqual(await service.requestReset('resetuser'), { ok: true });
  const warningText = JSON.stringify(warnings);
  assert.equal(warningText.includes('reset@example.com'), false);
  assert.equal(warningText.includes('secret-reset-token'), false);
});

test('valid reset changes password, clears token, is single-use, and revokes browser and mobile sessions', async () => {
  const token = 'one-time-token';
  const tokenHash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
  const nowMs = Date.UTC(2026, 8, 6, 19, 0, 0);
  const { service, browserRevocations, mobileRevocations } = makeService({
    nowMs,
    records: [makeAccount({
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: new Date(nowMs + 60_000),
    })],
  });
  const account = FakeUserModel.records[0];
  const oldHash = account.passwordHash;

  assert.deepEqual(await service.confirmReset({ token, password: 'new-password' }), { ok: true });
  assert.notEqual(account.passwordHash, oldHash);
  assert.equal(verifyPassword('new-password', account.passwordHash), true);
  assert.equal(verifyPassword('old-password', account.passwordHash), false);
  assert.equal(account.passwordResetTokenHash, '');
  assert.equal(account.passwordResetExpiresAt, null);
  assert.equal(account.credentialSource, 'self-registered');
  assert.deepEqual(browserRevocations, ['resetuser']);
  assert.deepEqual(mobileRevocations, ['resetuser']);

  await rejectsWithCode(
    service.confirmReset({ token, password: 'another-password' }),
    'PASSWORD_RESET_INVALID'
  );
  assert.equal(verifyPassword('new-password', account.passwordHash), true);
});

test('invalid and expired reset tokens never change the password', async () => {
  const token = 'expired-token';
  const tokenHash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
  const nowMs = Date.UTC(2026, 8, 6, 19, 0, 0);
  const { service } = makeService({
    nowMs,
    records: [makeAccount({
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: new Date(nowMs - 1),
    })],
  });
  const account = FakeUserModel.records[0];
  const oldHash = account.passwordHash;

  await rejectsWithCode(
    service.confirmReset({ token, password: 'new-password' }),
    'PASSWORD_RESET_INVALID'
  );
  await rejectsWithCode(
    service.confirmReset({ token: 'different-token', password: 'new-password' }),
    'PASSWORD_RESET_INVALID'
  );
  assert.equal(account.passwordHash, oldHash);
});

test('password reset enforces the public 8 to 256 character password policy', async () => {
  const token = 'password-policy-token';
  const tokenHash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
  const nowMs = Date.UTC(2026, 8, 6, 19, 0, 0);
  const { service } = makeService({
    nowMs,
    records: [makeAccount({
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: new Date(nowMs + 60_000),
    })],
  });

  await rejectsWithCode(
    service.confirmReset({ token, password: '1234567' }),
    'ACCOUNT_PASSWORD_INVALID'
  );
  await rejectsWithCode(
    service.confirmReset({ token, password: 'x'.repeat(257) }),
    'ACCOUNT_PASSWORD_INVALID'
  );
});
