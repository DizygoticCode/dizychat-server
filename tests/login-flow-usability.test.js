'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'login.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'chat.css'), 'utf8');

test('login flow identifies the user before exposing room selection', () => {
  const identityAt = html.indexOf('Choose how you want to join');
  const roomAt = html.indexOf('id="room-entry-step"');
  assert.ok(identityAt >= 0 && roomAt > identityAt, 'identity step must appear before room selection');
  assert.match(html, /id="room-entry-step"[^>]*class="[^"]*is-locked[^"]*"[^>]*aria-disabled="true"/);
  assert.match(html, /<input(?=[^>]*id="room-input")[^>]*disabled/);
  assert.match(html, /<input(?=[^>]*id="room-password")[^>]*disabled/);
  assert.match(html, /<button(?=[^>]*id="guest-join-btn")[^>]*disabled>Join room<\/button>/);
});

test('account credentials keep standard autofill semantics while room and guest fields opt out', () => {
  assert.match(html, /<input(?=[^>]*id="account-username")(?=[^>]*name="username")(?=[^>]*autocomplete="username")[^>]*>/);
  assert.match(html, /<input(?=[^>]*id="account-password")(?=[^>]*name="password")(?=[^>]*autocomplete="current-password")[^>]*>/);

  const roomPassword = html.match(/<input(?=[^>]*id="room-password")[^>]*>/)?.[0] || '';
  assert.match(roomPassword, /name="room-access-password"/);
  assert.match(roomPassword, /autocomplete="off"/);
  assert.match(roomPassword, /data-1p-ignore/);
  assert.match(roomPassword, /data-lpignore="true"/);
  assert.match(roomPassword, /data-bwignore="true"/);
  assert.doesNotMatch(roomPassword, /autocomplete="current-password"/);

  const guest = html.match(/<input(?=[^>]*id="guest-username")[^>]*>/)?.[0] || '';
  assert.match(guest, /name="guest-display-name"/);
  assert.match(guest, /autocomplete="off"/);
  assert.match(guest, /data-1p-ignore/);
});

test('login inputs have visible labels and staged UI styles', () => {
  for (const id of ['account-username', 'account-password', 'guest-username', 'room-input', 'room-password']) {
    assert.match(html, new RegExp(`<label[^>]*for="${id}"`));
  }

  assert.match(css, /\.auth-step-number\s*\{/);
  assert.match(css, /\.room-entry-card\.is-locked\s*\{[^}]*opacity:/s);
  assert.match(css, /\.room-entry-card\.is-unlocked\s*\{[^}]*border-color:/s);
  assert.match(css, /\.auth-entry-card\.is-selected\s*\{/);
});

test('room join action stays pill-shaped and enables only for a room name', () => {
  const js = fs.readFileSync(path.join(root, 'public', 'chat.js'), 'utf8');

  assert.match(js, /const roomReady = Boolean\(String\(roomInput\?\.value \|\| ""\)\.trim\(\)\);/);
  assert.match(js, /joinBtn\.disabled = !identityReady \|\| !roomReady \|\| accountState\.busy;/);
  assert.match(js, /roomInput\.addEventListener\("input", syncLandingJoinFlow\);/);

  assert.match(css, /\.room-join-btn\s*\{[^}]*border-radius:\s*var\(--radius\);[^}]*background:\s*var\(--accent\);/s);
  assert.match(css, /\.room-join-btn:disabled\s*\{[^}]*background:\s*color-mix\([^}]*cursor:\s*not-allowed;[^}]*opacity:\s*1;/s);
});
