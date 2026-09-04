'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const loginSource = fs.readFileSync(path.resolve(__dirname, '../../public/login.html'), 'utf8');
const chatSource = fs.readFileSync(path.resolve(__dirname, '../../public/chat.js'), 'utf8');
const authClientSource = fs.readFileSync(path.resolve(__dirname, '../../public/auth-v2-client.js'), 'utf8');

test('landing exposes explicit registered-account and guest entry modes', () => {
  assert.match(loginSource, /id="registered-login"/);
  assert.match(loginSource, /id="account-username"/);
  assert.match(loginSource, /id="account-password"/);
  assert.match(loginSource, /id="registered-join-btn"/);
  assert.match(loginSource, /id="guest-login"/);
  assert.match(loginSource, /id="guest-username"/);
  assert.match(loginSource, /id="guest-join-btn"/);
});

test('legacy admin-password browser authority is removed', () => {
  assert.doesNotMatch(loginSource, /id="admin-password"/);
  assert.doesNotMatch(loginSource, /ADMIN_USERNAMES/);
  assert.doesNotMatch(chatSource, /adminPasswordInput/);
  assert.doesNotMatch(chatSource, /["']admin auth["']/);
});

test('registered browser session remains tab-scoped while chat reconnects through the Auth v2 adapter', () => {
  assert.match(authClientSource, /const SESSION_KEY\s*=\s*["']dizychat-account-session-v2["']/);
  assert.match(authClientSource, /window\.sessionStorage\.getItem\(SESSION_KEY\)/);
  assert.match(authClientSource, /window\.sessionStorage\.setItem\(SESSION_KEY/);
  assert.match(authClientSource, /window\.sessionStorage\.removeItem\(SESSION_KEY\)/);
  assert.doesNotMatch(authClientSource, /localStorage\.setItem/);

  assert.match(chatSource, /window\.dizychatAuthV2/);
  assert.match(chatSource, /accountAuth\?\.readToken\?\.\(\)/);
  assert.match(chatSource, /accountAuth\?\.writeToken\?\.\(token\)/);
  assert.match(chatSource, /sessionToken/);
  assert.match(chatSource, /socket\.auth/);
  assert.match(chatSource, /socket\.emit\(["']account login["']/);
  assert.match(chatSource, /socket\.emit\(["']account session["']/);
  assert.match(chatSource, /socket\.emit\(["']account logout["']/);
});

test('room passwords never enter navigation URLs and legacy password query keys are stripped', () => {
  assert.match(chatSource, /function updateQueryParams\(room\)/);
  assert.doesNotMatch(chatSource, /params\.set\(["']password["']/);
  assert.doesNotMatch(chatSource, /\.get\(["']password["']\)/);
  assert.match(chatSource, /params\.delete\(["']password["']\)/);
  assert.match(chatSource, /history\.replaceState/);
});

test('registered role metadata, not admin-password state, drives client moderation affordances', () => {
  assert.match(chatSource, /accountState/);
  assert.match(chatSource, /role\s*===\s*["']owner["']/);
  assert.match(chatSource, /role\s*===\s*["']admin["']/);
});