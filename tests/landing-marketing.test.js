'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const landing = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

test('marketing landing reflects the current home-hosted identity-first platform', () => {
  assert.match(landing, /home-hosted/i);
  assert.match(landing, /No Big Tech core/i);
  assert.match(landing, /Identity-first onboarding/i);
  assert.match(landing, /Choose your identity/i);
  assert.match(landing, /Choose or create a room/i);
  assert.match(landing, /clean local ClamAV verdict/i);
  assert.match(landing, /GIPHY picker/i);
  assert.match(landing, /Self-hosted LiveKit/i);
  assert.match(landing, /Web, PWA &amp; native/i);

  assert.doesNotMatch(landing, /optional antivirus scanning/i);
  assert.doesNotMatch(landing, /Tenor GIF browser/i);
  assert.doesNotMatch(landing, /Enter your name and room/i);
});

test('README opens with current platform badges, status and self-hosted positioning', () => {
  assert.match(readme, /home-hosted, self-managed real-time community platform/i);
  assert.match(readme, /Home\/self-hosted Express \+ Socket\.IO \+ MongoDB/i);
  assert.match(readme, /UI verification:/i);

  for (const label of ['JavaScript', 'Node.js', 'Socket.IO', 'MongoDB', 'Android', 'iOS', 'LiveKit']) {
    assert.match(readme, new RegExp(`alt="${label.replace('.', '\\.')}"`));
  }

  assert.match(readme, /Identity & rooms/);
  assert.match(readme, /Media safety/);
  assert.match(readme, /Native iOS/);
  assert.match(readme, /current deployment uses the self-hosted LiveKit service/i);
});
