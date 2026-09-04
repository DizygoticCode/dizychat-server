'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

const requirePattern = (pattern, message) => {
  assert.match(source, pattern, message);
};

test('server constructs the Mongo-backed mobile session authority', () => {
  requirePattern(/require\(['"]\.\/src\/models\/mobile-session['"]\)/, 'MobileSession model must be imported');
  requirePattern(/createMobileSessionService/, 'mobile session service must be imported');
  requirePattern(/createMobileSessionService\(\{[\s\S]*MobileSessionModel:\s*MobileSession[\s\S]*UserModel:\s*User[\s\S]*\}\)/, 'mobile session service must use MobileSession and User models');
});

test('server defines the trusted Capacitor origins used to request durable mobile sessions', () => {
  requirePattern(/TRUSTED_NATIVE_ORIGINS\s*=\s*new Set\([\s\S]*https:\/\/localhost[\s\S]*http:\/\/localhost[\s\S]*capacitor:\/\/localhost[\s\S]*\)/, 'trusted native origins must be explicit');
  requirePattern(/isTrustedNativeOrigin/, 'native origin decision must be centralized');
});

test('Socket.IO handshake resolves either browser or durable mobile account tokens asynchronously', () => {
  requirePattern(/async function resolveAccountSessionToken|const resolveAccountSessionToken\s*=\s*async/, 'combined session resolver must be async');
  requirePattern(/accountSessions\.resolve\(/, 'combined resolver must preserve browser sessions');
  requirePattern(/mobileAccountSessions\.resolve\(/, 'combined resolver must accept durable mobile sessions');
  requirePattern(/io\.use\(async \(socket, next\)/, 'Socket.IO auth middleware must await the combined resolver');
  requirePattern(/await resolveAccountSessionToken\(sessionToken\)/, 'Socket.IO auth middleware must resolve the supplied token');
});

test('account login keeps browser sessions unchanged and issues durable sessions only to trusted native clients', () => {
  requirePattern(/payload\.sessionKind\s*===\s*['"]mobile['"]/, 'mobile persistence must be explicit');
  requirePattern(/isTrustedNativeOrigin\(socket\)/, 'mobile issuance must require a trusted native socket origin');
  requirePattern(/mobileAccountSessions\.issue\(principal/, 'native login must issue a durable mobile session');
  requirePattern(/accountSessions\.issue\(principal\)/, 'normal browser login must still issue the existing session');
});

test('account session validation and logout use the combined durable-aware authority', () => {
  requirePattern(/socket\.on\(['"]account session['"],[\s\S]*await resolveAccountSessionToken\(socket\.accountSessionToken\)/, 'account session must validate durable tokens');
  requirePattern(/async function revokeAccountSessionToken|const revokeAccountSessionToken\s*=\s*async/, 'combined revoker must be async');
  requirePattern(/mobileAccountSessions\.revoke\(/, 'combined revoker must revoke durable sessions');
  requirePattern(/socket\.on\(['"]account logout['"],[\s\S]*await revokeAccountSessionToken\(socket\.accountSessionToken\)/, 'logout must revoke whichever session kind owns the token');
});
