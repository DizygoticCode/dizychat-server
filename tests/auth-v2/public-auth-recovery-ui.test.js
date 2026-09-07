'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

const { createAccountService } = require('../../src/auth/account-service');
const { createPublicAuthRouter } = require('../../src/auth/public-auth-router');

const repoRoot = path.resolve(__dirname, '../..');
const readPublic = (name) => fs.readFileSync(path.join(repoRoot, 'public', name), 'utf8');

class FakeUserModel {
  static records = new Map();

  static reset() {
    this.records = new Map();
  }

  static async findOne(query = {}) {
    const canonical = String(query.canonicalUsername || '').trim();
    return canonical ? this.records.get(canonical) || null : null;
  }

  static async create(data) {
    const doc = new FakeUserModel(data);
    await doc.save();
    return doc;
  }

  constructor(data = {}) {
    Object.assign(this, data);
    this._id = data._id || `fake-${data.canonicalUsername}`;
  }

  async save() {
    FakeUserModel.records.set(this.canonicalUsername, this);
    return this;
  }
}

const startAuthServer = async ({ accountService, resolveAccountSessionToken }) => {
  const app = express();
  app.use('/api/auth', createPublicAuthRouter({
    accountService,
    resolveAccountSessionToken,
    passwordResetService: {
      requestReset: async () => ({ ok: true }),
      confirmReset: async () => ({ ok: true }),
    },
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
};

const postJson = async (baseUrl, route, body, token = '') => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  return { response, json };
};

test('registered-account landing restores room guidance, create-account, recovery email, and forgot-password controls', () => {
  const login = readPublic('login.html');

  assert.match(login, /Choose or create a room/i);
  assert.match(login, /join existing or create new/i);
  assert.match(login, /remember|save/i);
  assert.match(login, /room name/i);
  assert.match(login, /room password/i);
  assert.match(login, /Room name[^"']*join existing or create new/i);

  assert.match(login, /id="create-account-btn"/);
  assert.match(login, />\s*Create account\s*</i);
  assert.match(login, /id="register-recovery-email"[^>]*type="email"/);
  assert.match(login, /optional[^<]*password recovery/i);
  assert.match(login, /id="forgot-password-btn"/);
  assert.match(login, />\s*Forgot password\?\s*</i);

  assert.match(login, /id="recovery-email-manage"/);
  assert.match(login, /id="recovery-email-update"[^>]*type="email"/);
  assert.match(login, /Add or change recovery email/i);
});

test('common bootstrap loads the public-auth UI only after chat account handlers are ready', () => {
  const bootstrap = readPublic('mobile-bootstrap.js');
  assert.match(
    bootstrap,
    /await loadScript\('\/chat\.js'\);[\s\S]*?await loadScript\('\/public-auth-ui\.js'\);/
  );
});

test('public auth UI posts registration/reset/recovery to the shared API and reuses existing sign-in', () => {
  const scriptPath = path.join(repoRoot, 'public', 'public-auth-ui.js');
  assert.equal(fs.existsSync(scriptPath), true, 'public/public-auth-ui.js must exist');
  const source = fs.readFileSync(scriptPath, 'utf8');

  assert.match(source, /\/api\/auth\/register/);
  assert.match(source, /\/api\/auth\/password-reset\/request/);
  assert.match(source, /\/api\/auth\/recovery-email/);
  assert.match(source, /Authorization[\s\S]*Bearer/);
  assert.match(source, /registeredJoinBtn\.click\(\)/);
  assert.match(source, /If an account with a recovery email exists/i);
});

test('reset page exists and confirms through the native-aware configured backend boundary', () => {
  const htmlPath = path.join(repoRoot, 'public', 'reset-password.html');
  const scriptPath = path.join(repoRoot, 'public', 'reset-password.js');
  assert.equal(fs.existsSync(htmlPath), true, 'public/reset-password.html must exist');
  assert.equal(fs.existsSync(scriptPath), true, 'public/reset-password.js must exist');

  const html = fs.readFileSync(htmlPath, 'utf8');
  const source = fs.readFileSync(scriptPath, 'utf8');
  assert.match(html, /id="reset-password-form"/);
  assert.match(html, /id="reset-password"[^>]*type="password"/);
  assert.match(html, /id="reset-password-confirm"[^>]*type="password"/);
  assert.match(html, /\/app-config\.js/);
  assert.match(html, /\/mobile-runtime\.js/);
  assert.match(html, /\/reset-password\.js/);
  assert.match(source, /URLSearchParams/);
  assert.match(source, /resolveBackendOrigin/);
  assert.match(source, /installBackendFetchRouting/);
  assert.match(source, /\/api\/auth\/password-reset\/confirm/);
});

test('authenticated accounts can add or change a private normalized recovery email', async () => {
  FakeUserModel.reset();
  const service = createAccountService({ UserModel: FakeUserModel });
  await service.registerPublicUser({ username: 'ExistingUser', password: 'password' });

  assert.equal(typeof service.updateRecoveryEmail, 'function');
  const result = await service.updateRecoveryEmail(
    { kind: 'account', canonicalUsername: 'existinguser', username: 'ExistingUser', role: 'user' },
    '  Existing.User@Example.COM  '
  );

  const stored = await FakeUserModel.findOne({ canonicalUsername: 'existinguser' });
  assert.equal(stored.recoveryEmail, 'existing.user@example.com');
  assert.equal(result.recoveryEmail, undefined);
  await assert.rejects(
    service.updateRecoveryEmail(
      { kind: 'account', canonicalUsername: 'existinguser' },
      'not-an-email'
    ),
    (error) => error?.code === 'ACCOUNT_RECOVERY_EMAIL_INVALID'
  );
});

test('recovery-email endpoint requires a valid account session and never returns the address', async (t) => {
  const calls = [];
  const runtime = await startAuthServer({
    accountService: {
      registerPublicUser: async () => ({ ok: true }),
      updateRecoveryEmail: async (principal, recoveryEmail) => {
        calls.push({ principal, recoveryEmail });
        return { username: principal.username, recoveryEmail: 'must-not-leak@example.com' };
      },
    },
    resolveAccountSessionToken: async (token) => token === 'valid-token'
      ? {
          principal: {
            kind: 'account',
            username: 'ExistingUser',
            canonicalUsername: 'existinguser',
            role: 'user',
          },
        }
      : null,
  });
  t.after(runtime.close);

  let result = await postJson(runtime.baseUrl, '/api/auth/recovery-email', {
    recoveryEmail: 'new@example.com',
  });
  assert.equal(result.response.status, 401);
  assert.deepEqual(result.json, { ok: false, code: 'ACCOUNT_AUTH_REQUIRED' });

  result = await postJson(runtime.baseUrl, '/api/auth/recovery-email', {
    recoveryEmail: 'new@example.com',
  }, 'valid-token');
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.json, { ok: true });
  assert.deepEqual(calls, [{
    principal: {
      kind: 'account',
      username: 'ExistingUser',
      canonicalUsername: 'existinguser',
      role: 'user',
    },
    recoveryEmail: 'new@example.com',
  }]);
});
