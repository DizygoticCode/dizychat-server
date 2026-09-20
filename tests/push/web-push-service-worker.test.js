'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('DizyChat service worker displays Web Push and handles notification clicks', () => {
  const source = read('public/dizychat-sw.js');
  assert.match(source, /addEventListener\(['"]push['"]/);
  assert.match(source, /showNotification/);
  assert.match(source, /addEventListener\(['"]notificationclick['"]/);
  assert.match(source, /clients\.openWindow/);
  assert.match(source, /includeUncontrolled:\s*true/);
});

test('manifest identifies DizyChat as a standalone Home Screen app', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.id, '/login.html');
  assert.equal(manifest.start_url, '/login.html');
});
