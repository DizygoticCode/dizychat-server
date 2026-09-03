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
    sanitizeAccount,
  };
};

module.exports = {
  createAccountService,
  sanitizeAccount,
};
