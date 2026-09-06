'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

let createPublicAuthRouter;
let moduleLoadError = null;
try {
  ({ createPublicAuthRouter } = require('../../src/auth/public-auth-router'));
} catch (error) {
  moduleLoadError = error;
}

const requireFactory = () => {
  assert.equal(moduleLoadError, null, moduleLoadError?.message || 'public auth router module failed to load');
  assert.equal(typeof createPublicAuthRouter, 'function');
};

const startServer = async ({ accountService, passwordResetService, now } = {}) => {
  requireFactory();
  const app = express();
  app.use('/api/auth', createPublicAuthRouter({
    accountService,
    passwordResetService,
    now,
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
};

const postJson = async (baseUrl, path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { response, json };
};

const makeDependencies = () => ({
  accountService: {
    registerPublicUser: async () => ({ username: 'CreatedUser', role: 'user' }),
  },
  passwordResetService: {
    requestReset: async () => ({ ok: true }),
    confirmReset: async () => ({ ok: true }),
  },
});

const codedError = (code) => Object.assign(new Error(code), { code });

test('POST /register creates a public account and returns only a success acknowledgement', async (t) => {
  const calls = [];
  const deps = makeDependencies();
  deps.accountService.registerPublicUser = async (input) => {
    calls.push(input);
    return { username: input.username, recoveryEmail: 'must-not-leak@example.com' };
  };
  const runtime = await startServer(deps);
  t.after(runtime.close);

  const { response, json } = await postJson(runtime.baseUrl, '/api/auth/register', {
    username: 'NewUser',
    password: 'password',
    recoveryEmail: 'new@example.com',
  });

  assert.equal(response.status, 201);
  assert.deepEqual(json, { ok: true });
  assert.deepEqual(calls, [{ username: 'NewUser', password: 'password', recoveryEmail: 'new@example.com' }]);
});

test('registration maps stable validation and conflict codes without exposing account data', async (t) => {
  const cases = [
    ['ACCOUNT_USERNAME_REQUIRED', 400],
    ['ACCOUNT_PASSWORD_INVALID', 400],
    ['ACCOUNT_RECOVERY_EMAIL_INVALID', 400],
    ['ACCOUNT_USERNAME_TAKEN', 409],
    ['ACCOUNT_USERNAME_PROTECTED', 409],
  ];

  for (const [code, expectedStatus] of cases) {
    const deps = makeDependencies();
    deps.accountService.registerPublicUser = async () => { throw codedError(code); };
    const runtime = await startServer(deps);
    t.after(runtime.close);
    const { response, json } = await postJson(runtime.baseUrl, '/api/auth/register', {
      username: 'Candidate',
      password: 'password',
    });
    assert.equal(response.status, expectedStatus, code);
    assert.deepEqual(json, { ok: false, code });
  }
});

test('password-reset request always returns the same public success payload for a valid username', async (t) => {
  const calls = [];
  const deps = makeDependencies();
  deps.passwordResetService.requestReset = async (username) => {
    calls.push(username);
    return { ok: true, accountExists: true, recoveryEmail: 'never-leak@example.com' };
  };
  const runtime = await startServer(deps);
  t.after(runtime.close);

  const { response, json } = await postJson(runtime.baseUrl, '/api/auth/password-reset/request', {
    username: 'MaybeUser',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(json, { ok: true });
  assert.deepEqual(calls, ['MaybeUser']);
});

test('password-reset request rejects only syntactically empty usernames before the generic service boundary', async (t) => {
  const deps = makeDependencies();
  let calls = 0;
  deps.passwordResetService.requestReset = async () => { calls += 1; return { ok: true }; };
  const runtime = await startServer(deps);
  t.after(runtime.close);

  const { response, json } = await postJson(runtime.baseUrl, '/api/auth/password-reset/request', { username: '   ' });
  assert.equal(response.status, 400);
  assert.deepEqual(json, { ok: false, code: 'PASSWORD_RESET_REQUEST_INVALID' });
  assert.equal(calls, 0);
});

test('password-reset confirm returns success and maps invalid token/password to stable non-secret codes', async (t) => {
  const calls = [];
  const deps = makeDependencies();
  deps.passwordResetService.confirmReset = async (input) => {
    calls.push(input);
    if (input.token === 'bad') throw codedError('PASSWORD_RESET_INVALID');
    if (input.password === 'short') throw codedError('ACCOUNT_PASSWORD_INVALID');
    return { ok: true };
  };
  const runtime = await startServer(deps);
  t.after(runtime.close);

  let result = await postJson(runtime.baseUrl, '/api/auth/password-reset/confirm', {
    token: 'good', password: 'new-password',
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.json, { ok: true });

  result = await postJson(runtime.baseUrl, '/api/auth/password-reset/confirm', {
    token: 'bad', password: 'new-password',
  });
  assert.equal(result.response.status, 400);
  assert.deepEqual(result.json, { ok: false, code: 'PASSWORD_RESET_INVALID' });

  result = await postJson(runtime.baseUrl, '/api/auth/password-reset/confirm', {
    token: 'good', password: 'short',
  });
  assert.equal(result.response.status, 400);
  assert.deepEqual(result.json, { ok: false, code: 'ACCOUNT_PASSWORD_INVALID' });
  assert.equal(calls.length, 3);
});

test('route-local rate limits enforce registration 10/10m and reset request/confirm 10/15m independently', async (t) => {
  let nowMs = Date.UTC(2026, 8, 6, 20, 0, 0);
  const deps = makeDependencies();
  const runtime = await startServer({ ...deps, now: () => nowMs });
  t.after(runtime.close);

  const exercise = async (path, body) => {
    for (let i = 0; i < 10; i += 1) {
      const { response } = await postJson(runtime.baseUrl, path, body);
      assert.notEqual(response.status, 429, `${path} attempt ${i + 1}`);
    }
    const limited = await postJson(runtime.baseUrl, path, body);
    assert.equal(limited.response.status, 429, path);
    assert.deepEqual(limited.json, { ok: false, code: 'RATE_LIMITED' });
  };

  await exercise('/api/auth/register', { username: 'User', password: 'password' });
  await exercise('/api/auth/password-reset/request', { username: 'User' });
  await exercise('/api/auth/password-reset/confirm', { token: 'token', password: 'new-password' });

  nowMs += 10 * 60 * 1000 + 1;
  let result = await postJson(runtime.baseUrl, '/api/auth/register', { username: 'User', password: 'password' });
  assert.notEqual(result.response.status, 429);

  result = await postJson(runtime.baseUrl, '/api/auth/password-reset/request', { username: 'User' });
  assert.equal(result.response.status, 429);

  nowMs += 5 * 60 * 1000 + 1;
  result = await postJson(runtime.baseUrl, '/api/auth/password-reset/request', { username: 'User' });
  assert.notEqual(result.response.status, 429);
  result = await postJson(runtime.baseUrl, '/api/auth/password-reset/confirm', { token: 'token', password: 'new-password' });
  assert.notEqual(result.response.status, 429);
});

test('public auth JSON body is bounded', async (t) => {
  const runtime = await startServer(makeDependencies());
  t.after(runtime.close);
  const response = await fetch(`${runtime.baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'x'.repeat(40_000), password: 'password' }),
  });
  assert.equal(response.status, 413);
});
