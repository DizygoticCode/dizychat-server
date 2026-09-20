'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

test('audio attachments use the compact inline media layout without a filename row', () => {
  const client = fs.readFileSync(path.join(repoRoot, 'public', 'chat.js'), 'utf8');
  const css = fs.readFileSync(path.join(repoRoot, 'public', 'chat.css'), 'utf8');

  assert.match(client, /type === "audio"[\s\S]{0,180}download\.textContent = "↓"/);
  assert.match(client, /download\.setAttribute\("aria-label", "Download audio"\)/);

  assert.match(
    css,
    /\.inline-preview\.inline-audio\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;[^}]*padding:\s*5px 6px;/s,
  );
  assert.match(
    css,
    /\.inline-preview\.inline-audio \.preview-media\s*\{[^}]*min-height:\s*0;[^}]*padding:\s*0;[^}]*border:\s*0;/s,
  );
  assert.match(
    css,
    /\.inline-preview\.inline-audio \.preview-media audio\s*\{[^}]*height:\s*40px;/s,
  );
  assert.doesNotMatch(
    css,
    /\.inline-preview\.inline-audio \.preview-media,\s*\.inline-preview\.inline-pdf/s,
  );
});

test('rich video embeds stay wide enough for native player controls', () => {
  const client = fs.readFileSync(path.join(repoRoot, 'public', 'chat.js'), 'utf8');
  const css = fs.readFileSync(path.join(repoRoot, 'public', 'chat.css'), 'utf8');

  assert.match(client, /if \(el\.tagName === "IFRAME"\)\s*\{\s*node\.classList\.add\("has-rich-embed"\)/);
  assert.match(
    css,
    /\.message\.has-rich-embed\s*\{[^}]*width:\s*min\(560px, 96%\);[^}]*max-width:\s*min\(560px, 96%\);/s,
  );
  assert.match(
    css,
    /\.embed-iframe\.youtube,\s*\.embed-iframe\.rumble\s*\{[^}]*width:\s*100%;[^}]*height:\s*clamp\(200px, 56\.25vw, 315px\);[^}]*min-height:\s*200px;/s,
  );
});

test('Rumble pages resolve a clean embed player instead of guessing from the page slug', () => {
  const server = fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');
  const client = fs.readFileSync(path.join(repoRoot, 'public', 'chat.js'), 'utf8');

  assert.match(server, /meta\[property="og:video:secure_url"\]/);
  assert.match(server, /meta\[property="og:video:url"\]/);
  assert.match(server, /chosen\.embedUrl/);
  assert.match(server, /embedUrl:\s*resolveAsset\(clean\(embedRaw\)\)/);

  assert.match(client, /async function resolveRumblePlayer/);
  assert.match(client, /payload\?\.embedUrl/);
  assert.match(client, /if \(!\/\^\\\/embed\\\//i\.test\(parsed\.pathname\)\) return null;/);
  assert.match(client, /placeholder\.replaceWith\(iframe\)/);
  assert.doesNotMatch(client, /const candidate = segments\.find\(\(segment\) => \/\^v\[a-z0-9\]\+\/i\.test\(segment\)\)/);
});
