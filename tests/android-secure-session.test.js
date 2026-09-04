'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const authSource = fs.readFileSync(path.resolve(__dirname, '../public/auth-v2-client.js'), 'utf8');

const makeSessionStorage = () => {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
};

const loadAuth = ({ native = false, plugin } = {}) => {
  const sessionStorage = makeSessionStorage();
  const window = {
    sessionStorage,
    Capacitor: {
      isNativePlatform: () => native,
      Plugins: plugin ? { SecureSession: plugin } : {},
    },
  };
  const context = { window, sessionStorage, console };
  vm.runInNewContext(authSource, context, { filename: 'auth-v2-client.js' });
  return { auth: window.dizychatAuthV2, sessionStorage };
};

test('normal website remains sessionStorage-only', async () => {
  let nativeWrites = 0;
  const plugin = {
    async writeToken() { nativeWrites += 1; },
    async readToken() { return { token: 'native-token' }; },
    async clearToken() { nativeWrites += 1; },
  };
  const { auth } = loadAuth({ native: false, plugin });

  assert.equal(auth.isNativeSessionRuntime(), false);
  await auth.persistToken('browser-token');
  assert.equal(auth.readToken(), 'browser-token');
  assert.equal(nativeWrites, 0);
});

test('native restore copies the Keystore-backed token into the volatile session mirror', async () => {
  const plugin = {
    async readToken() { return { token: 'durable-token' }; },
    async writeToken() {},
    async clearToken() {},
  };
  const { auth } = loadAuth({ native: true, plugin });

  assert.equal(auth.readToken(), '');
  const restored = await auth.restoreNativeSession();
  assert.equal(restored, 'durable-token');
  assert.equal(auth.readToken(), 'durable-token');
});

test('native persist and clear update both secure storage and the volatile mirror', async () => {
  const calls = [];
  const plugin = {
    async readToken() { return { token: '' }; },
    async writeToken(payload) { calls.push(['write', payload]); },
    async clearToken() { calls.push(['clear']); },
  };
  const { auth } = loadAuth({ native: true, plugin });

  await auth.persistToken('abc123');
  assert.equal(auth.readToken(), 'abc123');
  assert.equal(calls[0]?.[0], 'write');
  assert.equal(calls[0]?.[1]?.token, 'abc123');

  await auth.clearPersistentToken();
  assert.equal(auth.readToken(), '');
  assert.deepEqual(calls[1], ['clear']);
});

test('native secure-storage failure rejects without a persistent browser fallback', async () => {
  const plugin = {
    async readToken() { return { token: '' }; },
    async writeToken() { throw new Error('keystore unavailable'); },
    async clearToken() {},
  };
  const { auth } = loadAuth({ native: true, plugin });

  await assert.rejects(() => auth.persistToken('volatile-only'), /keystore unavailable/);
  assert.equal(auth.readToken(), 'volatile-only', 'volatile current-process mirror may remain available');
  assert.equal(Object.prototype.hasOwnProperty.call(auth, 'localStorage'), false);
});

test('chat requests durable mobile sessions and routes persistence through the auth adapter', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../public/chat.js'), 'utf8');
  assert.match(source, /dizychatAuthV2/);
  assert.match(source, /isNativeSessionRuntime(?:\?\.)?\(\)/);
  assert.match(source, /sessionKind:\s*[^\n]*\?\s*["']mobile["']\s*:\s*["']browser["']/);
  assert.match(source, /persistToken\(token\)/);
  assert.match(source, /clearPersistentToken\(\)/);
});