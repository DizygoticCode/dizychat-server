'use strict';

const crypto = require('crypto');
const { canonicalizeUsername } = require('./identity');
const { hashPassword } = require('./passwords');
const { validatePublicPassword } = require('./account-service');

const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

const createResetError = (code, message) => {
  const error = new Error(message || code);
  error.code = code;
  return error;
};

const hashResetToken = (token) =>
  crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');

const createPasswordResetService = ({
  UserModel,
  mailer,
  sessionStore,
  mobileSessionService,
  now = () => new Date(),
  tokenFactory = () => crypto.randomBytes(32).toString('base64url'),
  logger = console,
} = {}) => {
  if (!UserModel || typeof UserModel.findOne !== 'function') {
    throw new TypeError('UserModel with findOne is required');
  }
  if (!mailer || typeof mailer.sendPasswordReset !== 'function') {
    throw new TypeError('password reset mailer is required');
  }
  if (!sessionStore || typeof sessionStore.revokeUser !== 'function') {
    throw new TypeError('browser session revoker is required');
  }
  if (!mobileSessionService || typeof mobileSessionService.revokeUser !== 'function') {
    throw new TypeError('mobile session revoker is required');
  }
  if (typeof now !== 'function' || typeof tokenFactory !== 'function') {
    throw new TypeError('password reset clock and token factory must be functions');
  }

  const currentDate = () => {
    const value = now();
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new Error('password reset clock returned an invalid date');
    }
    return date;
  };

  const requestReset = async (username) => {
    const canonicalUsername = canonicalizeUsername(username);
    if (!canonicalUsername) return { ok: true };

    const account = await UserModel.findOne({ canonicalUsername });
    if (!account || account.state !== 'active' || !String(account.recoveryEmail || '').trim()) {
      return { ok: true };
    }

    const token = String(tokenFactory() || '').trim();
    if (!token) {
      logger?.warn?.('[Auth] password reset token generation failed', { code: 'EMPTY_TOKEN' });
      return { ok: true };
    }

    const issuedAt = currentDate();
    account.passwordResetTokenHash = hashResetToken(token);
    account.passwordResetExpiresAt = new Date(issuedAt.getTime() + PASSWORD_RESET_TTL_MS);
    if (typeof account.save !== 'function') {
      throw new TypeError('password reset account document must be saveable');
    }
    await account.save();

    try {
      await mailer.sendPasswordReset({
        to: String(account.recoveryEmail || '').trim(),
        username: String(account.username || '').trim(),
        token,
      });
    } catch (error) {
      logger?.warn?.('[Auth] password reset email delivery failed', {
        code: String(error?.code || 'unexpected'),
      });
    }

    return { ok: true };
  };

  const confirmReset = async ({ token, password } = {}) => {
    if (!validatePublicPassword(password)) {
      throw createResetError(
        'ACCOUNT_PASSWORD_INVALID',
        'password must be between 8 and 256 characters'
      );
    }

    const publicToken = String(token || '').trim();
    if (!publicToken) {
      throw createResetError('PASSWORD_RESET_INVALID', 'password reset token is invalid or expired');
    }

    const account = await UserModel.findOne({
      passwordResetTokenHash: hashResetToken(publicToken),
      state: 'active',
    });
    if (!account) {
      throw createResetError('PASSWORD_RESET_INVALID', 'password reset token is invalid or expired');
    }

    const expiresAt = account.passwordResetExpiresAt instanceof Date
      ? account.passwordResetExpiresAt
      : new Date(account.passwordResetExpiresAt);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= currentDate().getTime()) {
      throw createResetError('PASSWORD_RESET_INVALID', 'password reset token is invalid or expired');
    }

    account.passwordHash = hashPassword(password);
    account.passwordResetTokenHash = '';
    account.passwordResetExpiresAt = null;
    if (account.role === 'user') {
      account.credentialSource = 'self-registered';
    }
    if (typeof account.save !== 'function') {
      throw new TypeError('password reset account document must be saveable');
    }
    await account.save();

    const canonicalUsername = canonicalizeUsername(account.canonicalUsername || account.username);
    await Promise.all([
      Promise.resolve(sessionStore.revokeUser(canonicalUsername)),
      Promise.resolve(mobileSessionService.revokeUser(canonicalUsername)),
    ]);

    return { ok: true };
  };

  return {
    confirmReset,
    requestReset,
  };
};

module.exports = {
  PASSWORD_RESET_TTL_MS,
  createPasswordResetService,
  hashResetToken,
};
