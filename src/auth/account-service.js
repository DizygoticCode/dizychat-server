'use strict';

const {
  ACCOUNT_STATES,
  PROTECTED_ACCOUNTS,
  ROLES,
  canonicalizeUsername,
  getProtectedAccount,
} = require('./identity');
const { hashPassword, isScryptHash, verifyPassword } = require('./passwords');

const ROLE_RANK = Object.freeze({
  [ROLES.USER]: 1,
  [ROLES.ADMIN]: 2,
  [ROLES.OWNER]: 3,
});

const PUBLIC_PASSWORD_MIN_LENGTH = 8;
const PUBLIC_PASSWORD_MAX_LENGTH = 256;
const MAX_RECOVERY_EMAIL_LENGTH = 320;
const RECOVERY_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const createAccountError = (code, message) => {
  const error = new Error(message || code);
  error.code = code;
  return error;
};

const validatePublicPassword = (password) =>
  typeof password === 'string'
  && password.length >= PUBLIC_PASSWORD_MIN_LENGTH
  && password.length <= PUBLIC_PASSWORD_MAX_LENGTH;

const normalizeRecoveryEmail = (value) => {
  if (value == null) return '';
  if (typeof value !== 'string') {
    throw createAccountError('ACCOUNT_RECOVERY_EMAIL_INVALID', 'recovery email is invalid');
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) return '';
  if (normalized.length > MAX_RECOVERY_EMAIL_LENGTH || !RECOVERY_EMAIL_PATTERN.test(normalized)) {
    throw createAccountError('ACCOUNT_RECOVERY_EMAIL_INVALID', 'recovery email is invalid');
  }
  return normalized;
};

const sanitizeAccount = (account) => {
  if (!account) return null;
  return {
    userId: account._id ? String(account._id) : '',
    username: account.username,
    canonicalUsername: account.canonicalUsername,
    role: account.role,
    state: account.state,
  };
};

const createAccountService = ({ UserModel, legacyCredentials = new Map() } = {}) => {
  if (!UserModel || typeof UserModel.findOne !== 'function' || typeof UserModel.create !== 'function') {
    throw new TypeError('UserModel with findOne/create is required');
  }

  const findByCanonical = async (canonicalUsername) =>
    UserModel.findOne({ canonicalUsername });

  const resolveLegacyPassword = (entry) => {
    if (!entry || typeof entry.credential !== 'string' || !entry.credential) return null;
    if (entry.kind === 'scrypt') {
      if (!isScryptHash(entry.credential)) return null;
      return {
        passwordHash: entry.credential,
        credentialSource: 'legacy-scrypt',
      };
    }
    if (entry.kind === 'plaintext') {
      return {
        passwordHash: hashPassword(entry.credential),
        credentialSource: 'legacy-plaintext',
      };
    }
    return null;
  };

  const bootstrapProtectedAccounts = async () => {
    const bootstrapped = [];

    for (const protectedAccount of PROTECTED_ACCOUNTS) {
      const legacy = resolveLegacyPassword(
        legacyCredentials.get(protectedAccount.canonicalUsername)
      );
      let account = await findByCanonical(protectedAccount.canonicalUsername);

      if (!account) {
        account = await UserModel.create({
          username: protectedAccount.username,
          canonicalUsername: protectedAccount.canonicalUsername,
          passwordHash: legacy?.passwordHash || '',
          role: protectedAccount.role,
          state: legacy ? ACCOUNT_STATES.ACTIVE : ACCOUNT_STATES.UNCLAIMED,
          credentialSource: legacy?.credentialSource || 'unclaimed',
        });
        bootstrapped.push(sanitizeAccount(account));
        continue;
      }

      let changed = false;
      const existingRank = ROLE_RANK[account.role] || 0;
      const protectedRank = ROLE_RANK[protectedAccount.role] || 0;
      if (existingRank < protectedRank) {
        account.role = protectedAccount.role;
        changed = true;
      }

      if (account.username !== protectedAccount.username) {
        account.username = protectedAccount.username;
        changed = true;
      }

      if (!account.passwordHash && legacy) {
        account.passwordHash = legacy.passwordHash;
        account.credentialSource = legacy.credentialSource;
        if (account.state !== ACCOUNT_STATES.DISABLED) {
          account.state = ACCOUNT_STATES.ACTIVE;
        }
        changed = true;
      } else if (!account.passwordHash && account.state === ACCOUNT_STATES.ACTIVE) {
        account.state = ACCOUNT_STATES.UNCLAIMED;
        account.credentialSource = 'unclaimed';
        changed = true;
      }

      if (changed && typeof account.save === 'function') {
        await account.save();
      }
      bootstrapped.push(sanitizeAccount(account));
    }

    return bootstrapped;
  };

  const authenticate = async (username, password) => {
    const canonicalUsername = canonicalizeUsername(username);
    if (!canonicalUsername || typeof password !== 'string' || !password) return null;

    const account = await findByCanonical(canonicalUsername);
    if (!account || account.state !== ACCOUNT_STATES.ACTIVE || !account.passwordHash) return null;
    if (!verifyPassword(password, account.passwordHash)) return null;
    return sanitizeAccount(account);
  };

  const isRegisteredUsername = async (username) => {
    const canonicalUsername = canonicalizeUsername(username);
    if (!canonicalUsername) return false;
    return Boolean(await findByCanonical(canonicalUsername));
  };

  const registerPublicUser = async (input = {}) => {
    const username = typeof input.username === 'string' ? input.username.trim() : '';
    const canonicalUsername = canonicalizeUsername(username);
    if (!username || !canonicalUsername) {
      throw createAccountError('ACCOUNT_USERNAME_REQUIRED', 'username is required');
    }
    if (getProtectedAccount(canonicalUsername)) {
      throw createAccountError('ACCOUNT_USERNAME_PROTECTED', 'protected account cannot self-register');
    }
    if (!validatePublicPassword(input.password)) {
      throw createAccountError('ACCOUNT_PASSWORD_INVALID', 'password must be between 8 and 256 characters');
    }
    const recoveryEmail = normalizeRecoveryEmail(input.recoveryEmail);
    if (await findByCanonical(canonicalUsername)) {
      throw createAccountError('ACCOUNT_USERNAME_TAKEN', 'username is already registered');
    }

    try {
      const account = await UserModel.create({
        username,
        canonicalUsername,
        passwordHash: hashPassword(input.password),
        recoveryEmail,
        passwordResetTokenHash: '',
        passwordResetExpiresAt: null,
        role: ROLES.USER,
        state: ACCOUNT_STATES.ACTIVE,
        credentialSource: 'self-registered',
      });
      return sanitizeAccount(account);
    } catch (error) {
      if (error?.code === 11000 || error?.code === 'E11000') {
        throw createAccountError('ACCOUNT_USERNAME_TAKEN', 'username is already registered');
      }
      throw error;
    }
  };

  const createManagedUser = async (actor, input = {}) => {
    if (!actor || actor.role !== ROLES.OWNER) {
      throw new Error('owner role required to manage accounts');
    }

    const username = typeof input.username === 'string' ? input.username.trim() : '';
    const canonicalUsername = canonicalizeUsername(username);
    if (!username || !canonicalUsername) throw new Error('username is required');
    if (getProtectedAccount(canonicalUsername)) throw new Error('protected account cannot be replaced');

    const role = input.role || ROLES.USER;
    if (![ROLES.USER, ROLES.ADMIN].includes(role)) {
      throw new Error('managed account role must be user or admin');
    }
    if (typeof input.password !== 'string' || !input.password) {
      throw new Error('password is required');
    }

    const passwordHash = hashPassword(input.password);
    let account = await findByCanonical(canonicalUsername);

    if (!account) {
      account = await UserModel.create({
        username,
        canonicalUsername,
        passwordHash,
        role,
        state: ACCOUNT_STATES.ACTIVE,
        credentialSource: 'managed',
      });
    } else {
      if (account.role === ROLES.OWNER) {
        throw new Error('owner account cannot be replaced');
      }
      account.username = username;
      account.passwordHash = passwordHash;
      account.role = role;
      account.state = ACCOUNT_STATES.ACTIVE;
      account.credentialSource = 'managed';
      if (typeof account.save === 'function') await account.save();
    }

    return sanitizeAccount(account);
  };

  return {
    authenticate,
    bootstrapProtectedAccounts,
    createManagedUser,
    isRegisteredUsername,
    registerPublicUser,
    sanitizeAccount,
  };
};

module.exports = {
  PUBLIC_PASSWORD_MAX_LENGTH,
  PUBLIC_PASSWORD_MIN_LENGTH,
  createAccountService,
  normalizeRecoveryEmail,
  sanitizeAccount,
  validatePublicPassword,
};
