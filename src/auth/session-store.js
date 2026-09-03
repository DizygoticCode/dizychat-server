'use strict';

const crypto = require('crypto');
const { canonicalizeUsername } = require('./identity');

const createSessionStore = ({
  ttlMs = 30 * 60 * 1000,
  now = Date.now,
  tokenFactory = crypto.randomUUID,
} = {}) => {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new TypeError('session ttlMs must be a positive number');
  }
  if (typeof now !== 'function' || typeof tokenFactory !== 'function') {
    throw new TypeError('session clock and token factory must be functions');
  }

  const sessionsByToken = new Map();
  const tokensByUser = new Map();

  const unlinkToken = (token, session) => {
    sessionsByToken.delete(token);
    const canonicalUsername = session?.principal?.canonicalUsername;
    if (!canonicalUsername) return;
    const tokens = tokensByUser.get(canonicalUsername);
    if (!tokens) return;
    tokens.delete(token);
    if (!tokens.size) tokensByUser.delete(canonicalUsername);
  };

  const issue = (principal) => {
    const canonicalUsername = canonicalizeUsername(principal?.canonicalUsername);
    if (principal?.kind !== 'account' || !canonicalUsername) {
      throw new TypeError('account principal with canonicalUsername is required');
    }

    const token = String(tokenFactory());
    if (!token) throw new Error('session token factory returned an empty token');
    const issuedAt = now();
    const session = {
      token,
      issuedAt,
      expiresAt: issuedAt + ttlMs,
      principal: {
        ...principal,
        canonicalUsername,
      },
    };

    sessionsByToken.set(token, session);
    let tokens = tokensByUser.get(canonicalUsername);
    if (!tokens) {
      tokens = new Set();
      tokensByUser.set(canonicalUsername, tokens);
    }
    tokens.add(token);
    return session;
  };

  const resolve = (token) => {
    if (typeof token !== 'string' || !token) return null;
    const session = sessionsByToken.get(token);
    if (!session) return null;
    if (session.expiresAt <= now()) {
      unlinkToken(token, session);
      return null;
    }
    return session;
  };

  const revoke = (token) => {
    if (typeof token !== 'string' || !token) return false;
    const session = sessionsByToken.get(token);
    if (!session) return false;
    unlinkToken(token, session);
    return true;
  };

  const revokeUser = (username) => {
    const canonicalUsername = canonicalizeUsername(username);
    if (!canonicalUsername) return 0;
    const tokens = tokensByUser.get(canonicalUsername);
    if (!tokens) return 0;
    const tokenList = [...tokens];
    tokenList.forEach((token) => revoke(token));
    return tokenList.length;
  };

  return {
    issue,
    resolve,
    revoke,
    revokeUser,
  };
};

module.exports = {
  createSessionStore,
};
