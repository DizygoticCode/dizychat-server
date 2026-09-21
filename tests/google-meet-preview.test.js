'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Google Meet links get a deterministic join preview without depending on remote Open Graph metadata', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const client = fs.readFileSync(path.join(repoRoot, 'public', 'chat.js'), 'utf8');

  assert.match(client, /function getGoogleMeetPreview\(url\) \{/);
  assert.match(client, /parsed\.protocol !== "https:"/);
  assert.match(client, /hostname !== "meet\.google\.com"/);
  assert.match(client, /!pathParts\.length/);
  assert.match(client, /siteName: "Google Meet"/);
  assert.match(client, /title: "Join this Google Meet"/);
  assert.match(client, /description: "Join this link in Google Meet\."/);
  assert.match(
    client,
    /const d = getGoogleMeetPreview\(normalized\) \|\| await fetchPreview\(normalized\);/,
  );
});

test('Google Meet preview continues through the existing accessible link-card open behavior', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const client = fs.readFileSync(path.join(repoRoot, 'public', 'chat.js'), 'utf8');

  assert.match(client, /card\.className = "link-card"/);
  assert.match(client, /card\.setAttribute\("role", "button"\)/);
  assert.match(client, /card\.setAttribute\("tabindex", "0"\)/);
  assert.match(client, /const open = \(\) => window\.open\(normalized, "_blank", "noopener"\)/);
  assert.match(client, /event\.key === "Enter" \|\| event\.key === " " \|\| event\.key === "Spacebar"/);
});
