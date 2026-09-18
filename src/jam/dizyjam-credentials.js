'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const AUTH_USERNAME_MAX = 63;

const clampTtlSeconds = (value, fallback = 14400) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(86400, Math.max(300, parsed));
};

const safeAuthUsername = (displayName, socketId) => {
  const base = String(displayName || 'guest')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_.-]+/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '')
    .slice(0, 40) || 'guest';
  const suffix = crypto.createHash('sha256').update(String(socketId || '')).digest('hex').slice(0, 12);
  return `${base}-${suffix}`.slice(0, AUTH_USERNAME_MAX);
};

const sha512Crypt = (password, { spawnSyncImpl = spawnSync } = {}) => {
  const secret = String(password || '');
  if (!secret) throw new Error('DizyJam credential password is empty.');

  const salt = crypto.randomBytes(8).toString('hex').slice(0, 16);
  const result = spawnSyncImpl(
    'openssl',
    ['passwd', '-6', '-salt', salt, '-stdin'],
    {
      input: `${secret}\n`,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024,
      timeout: 5000,
    },
  );

  if (result?.error) throw result.error;
  if (result?.status !== 0) {
    throw new Error(`openssl passwd failed: ${String(result?.stderr || '').trim() || 'unknown error'}`);
  }

  const hash = String(result.stdout || '').trim();
  if (!hash.startsWith(`$6$${salt}$`)) {
    throw new Error('openssl returned an unexpected SHA-512 crypt hash.');
  }
  return hash;
};

class DizyJamCredentialStore {
  constructor({
    credentialsFile,
    ttlSeconds = 14400,
    now = () => Date.now(),
    spawnSyncImpl = spawnSync,
  } = {}) {
    if (!credentialsFile) throw new Error('DizyJam credentials file path is required.');
    this.credentialsFile = path.resolve(credentialsFile);
    this.ttlMs = clampTtlSeconds(ttlSeconds) * 1000;
    this.now = now;
    this.spawnSyncImpl = spawnSyncImpl;
    this.leases = new Map();
  }

  initialiseEmpty() {
    this.leases.clear();
    this.writeFile();
  }

  issue({ socketId, displayName, room, identityKind }) {
    const cleanSocketId = String(socketId || '').trim();
    const cleanDisplayName = String(displayName || '').trim();
    const cleanRoom = String(room || '').trim();
    if (!cleanSocketId || !cleanDisplayName || !cleanRoom) {
      throw new Error('DizyJam credential issue requires socket, user and room.');
    }

    this.pruneExpired();
    const username = safeAuthUsername(cleanDisplayName, cleanSocketId);
    const password = `djt_${crypto.randomBytes(24).toString('base64url')}`;
    const passwordHash = sha512Crypt(password, { spawnSyncImpl: this.spawnSyncImpl });
    const expiresAt = this.now() + this.ttlMs;

    this.leases.set(cleanSocketId, {
      socketId: cleanSocketId,
      username,
      passwordHash,
      displayName: cleanDisplayName,
      room: cleanRoom,
      identityKind: String(identityKind || 'guest'),
      expiresAt,
    });
    this.writeFile();

    return {
      username,
      password,
      displayName: cleanDisplayName,
      room: cleanRoom,
      identityKind: String(identityKind || 'guest'),
      expiresAt,
    };
  }

  revokeSocket(socketId) {
    const key = String(socketId || '').trim();
    if (!key) return false;
    const removed = this.leases.delete(key);
    if (removed) this.writeFile();
    return removed;
  }

  getActiveRooms() {
    this.pruneExpired();
    return [...new Set([...this.leases.values()].map((lease) => lease.room).filter(Boolean))];
  }

  getActiveLeaseCount() {
    this.pruneExpired();
    return this.leases.size;
  }

  pruneExpired() {
    const now = this.now();
    let changed = false;
    for (const [key, lease] of this.leases) {
      if (!lease?.expiresAt || lease.expiresAt <= now) {
        this.leases.delete(key);
        changed = true;
      }
    }
    if (changed) this.writeFile();
    return changed;
  }

  writeFile() {
    const dir = path.dirname(this.credentialsFile);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

    const lines = [...this.leases.values()]
      .sort((a, b) => a.username.localeCompare(b.username))
      .map((lease) => `${lease.username}:${lease.passwordHash}:*`);
    const payload = lines.length ? `${lines.join('\n')}\n` : '';

    const tmp = `${this.credentialsFile}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    fs.writeFileSync(tmp, payload, { encoding: 'utf8', mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, this.credentialsFile);
    fs.chmodSync(this.credentialsFile, 0o600);
  }
}

module.exports = {
  AUTH_USERNAME_MAX,
  DizyJamCredentialStore,
  clampTtlSeconds,
  safeAuthUsername,
  sha512Crypt,
};
