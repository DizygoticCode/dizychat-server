'use strict';

const crypto = require('crypto');
const { canonicalizeUsername } = require('./identity');

const MOBILE_TOKEN_PREFIX = 'dcm1.';

const hashMobileToken = (token) =>
  crypto.createHash('sha256').update(token, 'utf8').digest('hex');

const createMobileSessionService = ({
  MobileSessionModel,
  UserModel,
  tokenFactory = () => crypto.randomBytes(32).toString('base64url'),
  now = () => new Date(),
} = {}) => {
  if (!MobileSessionModel || typeof MobileSessionModel.create !== 'function' || typeof MobileSessionModel.findOne !== 'function') {
    throw new TypeError('MobileSessionModel with create/findOne is required');
  }
  if (typeof MobileSessionModel.updateOne !== 'function' || typeof MobileSessionModel.updateMany !== 'function') {
    throw new TypeError('MobileSessionModel with updateOne/updateMany is required');
  }
  if (!UserModel || typeof UserModel.findOne !== 'function') {
    throw new TypeError('UserModel with findOne is required');
  }
  if (typeof tokenFactory !== 'function' || typeof now !== 'function') {
    throw new TypeError('mobile session token factory and clock must be functions');
  }

  const currentDate = () => {
    const value = now();
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error('mobile session clock returned an invalid date');
    return date;
  };

  const parseTokenHash = (token) => {
    if (typeof token !== 'string' || !token.startsWith(MOBILE_TOKEN_PREFIX)) return '';
    const secret = token.slice(MOBILE_TOKEN_PREFIX.length);
    if (!secret) return '';
    return hashMobileToken(token);
  };

  const principalFromAccount = (account) => ({
    kind: 'account',
    userId: account?._id ? String(account._id) : '',
    username: String(account?.username || ''),
    canonicalUsername: canonicalizeUsername(account?.canonicalUsername),
    role: String(account?.role || 'user'),
  });

  const issue = async (principal, metadata = {}) => {
    const canonicalUsername = canonicalizeUsername(principal?.canonicalUsername);
    if (principal?.kind !== 'account' || !canonicalUsername) {
      throw new TypeError('account principal with canonicalUsername is required');
    }

    const secret = String(tokenFactory() || '').trim();
    if (!secret) throw new Error('mobile session token factory returned an empty secret');
    const token = `${MOBILE_TOKEN_PREFIX}${secret}`;
    const deviceLabel = typeof metadata.deviceLabel === 'string' && metadata.deviceLabel.trim()
      ? metadata.deviceLabel.trim().slice(0, 120)
      : 'Android';

    await MobileSessionModel.create({
      tokenHash: hashMobileToken(token),
      canonicalUsername,
      userId: String(principal.userId || ''),
      deviceLabel,
      revokedAt: null,
    });

    return {
      token,
      kind: 'mobile',
      principal: {
        kind: 'account',
        userId: String(principal.userId || ''),
        username: String(principal.username || ''),
        canonicalUsername,
        role: String(principal.role || 'user'),
      },
    };
  };

  const resolve = async (token) => {
    const tokenHash = parseTokenHash(token);
    if (!tokenHash) return null;

    const stored = await MobileSessionModel.findOne({ tokenHash, revokedAt: null });
    if (!stored) return null;

    const canonicalUsername = canonicalizeUsername(stored.canonicalUsername);
    if (!canonicalUsername) return null;

    const account = await UserModel.findOne({ canonicalUsername });
    if (!account || account.state !== 'active') {
      await MobileSessionModel.updateOne(
        { tokenHash, revokedAt: null },
        { $set: { revokedAt: currentDate() } }
      );
      return null;
    }

    const principal = principalFromAccount(account);
    if (!principal.canonicalUsername || !principal.username) return null;

    return { token, kind: 'mobile', principal };
  };

  const revoke = async (token) => {
    const tokenHash = parseTokenHash(token);
    if (!tokenHash) return false;
    const result = await MobileSessionModel.updateOne(
      { tokenHash, revokedAt: null },
      { $set: { revokedAt: currentDate() } }
    );
    return Number(result?.modifiedCount || 0) > 0;
  };

  const revokeUser = async (username) => {
    const canonicalUsername = canonicalizeUsername(username);
    if (!canonicalUsername) return 0;
    const result = await MobileSessionModel.updateMany(
      { canonicalUsername, revokedAt: null },
      { $set: { revokedAt: currentDate() } }
    );
    return Number(result?.modifiedCount || 0);
  };

  return {
    issue,
    resolve,
    revoke,
    revokeUser,
  };
};

module.exports = {
  MOBILE_TOKEN_PREFIX,
  createMobileSessionService,
  hashMobileToken,
};
