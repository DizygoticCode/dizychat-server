'use strict';

const { canonicalizeUsername } = require('./identity');
const { isScryptHash } = require('./passwords');

const readLegacyAdminCredentials = (env = {}) => {
  const entries = new Map();

  const addCredential = (username, credentialValue, kind, source) => {
    if (typeof username !== 'string' || typeof credentialValue !== 'string') return;
    const trimmedUsername = username.trim();
    const credential = credentialValue.trim();
    const canonicalUsername = canonicalizeUsername(trimmedUsername);
    if (!canonicalUsername || !credential) return;
    if (kind === 'scrypt' && !isScryptHash(credential)) return;

    const candidate = {
      username: trimmedUsername,
      kind,
      credential,
      source,
    };
    const existing = entries.get(canonicalUsername);

    if (!existing || (candidate.kind === 'scrypt' && existing.kind !== 'scrypt')) {
      entries.set(canonicalUsername, candidate);
    }
  };

  const parseList = (raw, kind, source) => {
    if (typeof raw !== 'string' || !raw.trim()) return;
    raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((entry) => {
        const [rawUsername, ...rest] = entry.split(':');
        if (!rawUsername || rest.length === 0) return;
        addCredential(rawUsername, rest.join(':'), kind, source);
      });
  };

  parseList(env.ADMIN_CREDENTIALS_HASHED, 'scrypt', 'ADMIN_CREDENTIALS_HASHED');
  parseList(env.ADMIN_CREDENTIALS, 'plaintext', 'ADMIN_CREDENTIALS');

  const envAdminUsername = typeof env.ADMIN_USERNAME === 'string' && env.ADMIN_USERNAME.trim()
    ? env.ADMIN_USERNAME.trim()
    : 'Dizygotic';

  if (env.ADMIN_PASSWORD_HASH) {
    addCredential(envAdminUsername, env.ADMIN_PASSWORD_HASH, 'scrypt', 'ADMIN_PASSWORD_HASH');
  }

  if (env.ADMIN_PASSWORD) {
    addCredential(envAdminUsername, env.ADMIN_PASSWORD, 'plaintext', 'ADMIN_PASSWORD');
  }

  return entries;
};

module.exports = {
  readLegacyAdminCredentials,
};
