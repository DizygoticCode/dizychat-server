'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverSource = fs.readFileSync(path.resolve(__dirname, '../../index.js'), 'utf8');

test('production server imports the public auth, reset-service, and Resend transport modules', () => {
  assert.match(serverSource, /require\(['"]\.\/src\/auth\/resend-password-reset-mailer['"]\)/);
  assert.match(serverSource, /require\(['"]\.\/src\/auth\/password-reset-service['"]\)/);
  assert.match(serverSource, /require\(['"]\.\/src\/auth\/public-auth-router['"]\)/);
});

test('production password-reset wiring uses only the approved Resend environment contract', () => {
  for (const envName of [
    'DIZYCHAT_RESEND_API_KEY',
    'DIZYCHAT_MAIL_FROM',
    'DIZYCHAT_MAIL_REPLY_TO',
    'DIZYCHAT_PUBLIC_BASE_URL',
  ]) {
    assert.match(serverSource, new RegExp(`process\\.env\\.${envName}`), envName);
  }
  assert.match(serverSource, /fetchImpl:\s*fetch/);
  assert.doesNotMatch(serverSource, /re_[A-Za-z0-9_-]{12,}/, 'a Resend API key literal must never be committed');
  assert.doesNotMatch(serverSource, /DIZYCHAT_(?:SMTP|MAILBOX)_PASSWORD/);
});

test('password reset service revokes the existing browser and durable mobile session authorities', () => {
  assert.match(
    serverSource,
    /createPasswordResetService\(\{[\s\S]*?UserModel:\s*User[\s\S]*?sessionStore:\s*accountSessions[\s\S]*?mobileSessionService:\s*mobileAccountSessions[\s\S]*?\}\)/
  );
});

test('Resend mailer is constructed lazily so missing production mail config cannot prevent DizyChat boot', () => {
  assert.match(
    serverSource,
    /sendPasswordReset:\s*async\s*\([^)]*\)\s*=>\s*\{[\s\S]*?createResendPasswordResetMailer\([\s\S]*?DIZYCHAT_RESEND_API_KEY[\s\S]*?DIZYCHAT_PUBLIC_BASE_URL[\s\S]*?sendPasswordReset/
  );
});

test('public auth router is mounted under /api/auth with the existing account and reset services', () => {
  assert.match(
    serverSource,
    /app\.use\(['"]\/api\/auth['"],\s*createPublicAuthRouter\(\{[\s\S]*?accountService[\s\S]*?passwordResetService[\s\S]*?\}\)\s*\)/
  );
});
