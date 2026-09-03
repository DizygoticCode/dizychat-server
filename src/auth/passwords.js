'use strict';

const crypto = require('crypto');

const SCRYPT_HASH_PREFIX = 'scrypt';
const DEFAULT_SCRYPT_PARAMS = Object.freeze({
  N: 16384,
  r: 8,
  p: 1,
  keyLength: 64,
  saltLength: 16,
});

const parsePositiveInteger = (value) => {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const decodeScryptHash = (encodedHash) => {
  if (typeof encodedHash !== 'string') return null;
  const parts = encodedHash.split('$');
  if (parts.length !== 7) return null;

  const [algorithm, rawN, rawR, rawP, saltBase64, keyBase64, rawKeyLength] = parts;
  if (algorithm !== SCRYPT_HASH_PREFIX) return null;

  const N = parsePositiveInteger(rawN);
  const r = parsePositiveInteger(rawR);
  const p = parsePositiveInteger(rawP);
  const keyLength = parsePositiveInteger(rawKeyLength);
  if (!N || !r || !p || !keyLength || !saltBase64 || !keyBase64) return null;

  let salt;
  let expectedKey;
  try {
    salt = Buffer.from(saltBase64, 'base64');
    expectedKey = Buffer.from(keyBase64, 'base64');
  } catch (_error) {
    return null;
  }

  if (!salt.length || expectedKey.length !== keyLength) return null;

  return { N, r, p, keyLength, salt, expectedKey };
};

const isScryptHash = (encodedHash) => Boolean(decodeScryptHash(encodedHash));

const hashPassword = (password, options = {}) => {
  if (typeof password !== 'string' || password.length === 0) {
    throw new TypeError('password must be a non-empty string');
  }

  const N = parsePositiveInteger(options.N) || DEFAULT_SCRYPT_PARAMS.N;
  const r = parsePositiveInteger(options.r) || DEFAULT_SCRYPT_PARAMS.r;
  const p = parsePositiveInteger(options.p) || DEFAULT_SCRYPT_PARAMS.p;
  const keyLength = parsePositiveInteger(options.keyLength) || DEFAULT_SCRYPT_PARAMS.keyLength;
  const saltLength = parsePositiveInteger(options.saltLength) || DEFAULT_SCRYPT_PARAMS.saltLength;
  const salt = crypto.randomBytes(saltLength);
  const key = crypto.scryptSync(password, salt, keyLength, { N, r, p });

  return [
    SCRYPT_HASH_PREFIX,
    N,
    r,
    p,
    salt.toString('base64'),
    key.toString('base64'),
    keyLength,
  ].join('$');
};

const verifyPassword = (password, encodedHash) => {
  if (typeof password !== 'string') return false;
  const decoded = decodeScryptHash(encodedHash);
  if (!decoded) return false;

  let actualKey;
  try {
    actualKey = crypto.scryptSync(password, decoded.salt, decoded.keyLength, {
      N: decoded.N,
      r: decoded.r,
      p: decoded.p,
    });
  } catch (_error) {
    return false;
  }

  if (actualKey.length !== decoded.expectedKey.length) return false;
  return crypto.timingSafeEqual(actualKey, decoded.expectedKey);
};

module.exports = {
  SCRYPT_HASH_PREFIX,
  DEFAULT_SCRYPT_PARAMS,
  hashPassword,
  verifyPassword,
  isScryptHash,
};
