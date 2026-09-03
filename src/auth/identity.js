'use strict';

const ROLES = Object.freeze({
  OWNER: 'owner',
  ADMIN: 'admin',
  USER: 'user',
  GUEST: 'guest',
});

const ACCOUNT_STATES = Object.freeze({
  ACTIVE: 'active',
  DISABLED: 'disabled',
  UNCLAIMED: 'unclaimed',
});

const canonicalizeUsername = (value) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const PROTECTED_ACCOUNTS = Object.freeze([
  Object.freeze({
    username: 'Dizygotic',
    canonicalUsername: 'dizygotic',
    role: ROLES.OWNER,
  }),
  Object.freeze({
    username: 'Psybin',
    canonicalUsername: 'psybin',
    role: ROLES.ADMIN,
  }),
]);

const getProtectedAccount = (value) => {
  const canonicalUsername = canonicalizeUsername(value);
  if (!canonicalUsername) return null;
  return PROTECTED_ACCOUNTS.find(
    (account) => account.canonicalUsername === canonicalUsername
  ) || null;
};

module.exports = {
  ROLES,
  ACCOUNT_STATES,
  PROTECTED_ACCOUNTS,
  canonicalizeUsername,
  getProtectedAccount,
};
