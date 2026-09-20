'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

test('audio attachments use compact accessible chat-style controls', () => {
  const client = fs.readFileSync(path.join(repoRoot, 'public', 'chat.js'), 'utf8');
  const css = fs.readFileSync(path.join(repoRoot, 'public', 'chat.css'), 'utf8');

  assert.match(client, /audio\.setAttribute\("aria-label", labelText \|\| "Audio message"\)/);
  assert.match(client, /download\.textContent = "Download"/);
  assert.match(client, /download\.title = "Download audio"/);
  assert.match(client, /download\.setAttribute\("aria-label", "Download audio"\)/);

  assert.match(
    css,
    /\.message\.has-inline-media\.has-inline-audio\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*min\(400px, 94%\);/s,
  );
  assert.match(
    css,
    /\.inline-preview\.inline-audio \.preview-media\s*\{[^}]*min-height:\s*0;[^}]*padding:\s*0;[^}]*overflow:\s*visible;/s,
  );
  assert.match(
    css,
    /\.inline-preview\.inline-audio \.preview-media audio\s*\{[^}]*width:\s*100%;[^}]*height:\s*42px;/s,
  );
  assert.match(css, /\.message\.media-only\.has-inline-audio\s*\{[^}]*max-width:\s*min\(380px, 94%\);/s);
  assert.match(client, /waveform\.className = "audio-waveform"/);
  assert.match(client, /for \(let index = 0; index < 24; index \+= 1\)/);
  assert.match(client, /waveform\.dataset\.playing = audio\.paused \|\| audio\.ended \? "0" : "1"/);
  assert.match(client, /audio\.addEventListener\(eventName, syncAudioWaveform\)/);
  assert.match(css, /\.audio-waveform\s*\{[^}]*height:\s*28px;/s);
  assert.match(css, /\.audio-waveform-bar\.is-played\s*\{[^}]*background:\s*var\(--accent\);/s);
  assert.match(css, /\.inline-preview\.inline-audio \.preview-download\s*\{[^}]*min-width:\s*84px;[^}]*border-radius:\s*999px;/s);
});

test('video and embedded players keep enough responsive space for native controls', () => {
  const client = fs.readFileSync(path.join(repoRoot, 'public', 'chat.js'), 'utf8');
  const css = fs.readFileSync(path.join(repoRoot, 'public', 'chat.css'), 'utf8');

  assert.match(client, /if \(el\.tagName === "IFRAME"\) \{\s*node\.classList\.add\("has-inline-embed"\);/s);
  assert.match(css, /\.inline-preview\.inline-video \.preview-media\s*\{[^}]*aspect-ratio:\s*16 \/ 9;/s);
  assert.match(css, /\.inline-preview\.inline-video \.preview-media video\s*\{[^}]*object-fit:\s*contain;/s);
  assert.match(css, /\.message\.has-inline-embed\s*\{[^}]*max-width:\s*min\(520px, 94%\);/s);
  assert.match(
    css,
    /\.embed-iframe\.youtube,\s*\.embed-iframe\.rumble\s*\{[^}]*width:\s*100%;[^}]*aspect-ratio:\s*16 \/ 9;/s,
  );
  assert.match(css, /\.message\.media-only\.has-inline-video\s*\{[^}]*max-width:\s*min\(460px, 94%\);/s);
});

test('Rumble links resolve the canonical player URL instead of guessing page IDs', () => {
  const server = fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');
  const client = fs.readFileSync(path.join(repoRoot, 'public', 'chat.js'), 'utf8');

  assert.match(server, /let embedRaw = pick\(/);
  assert.match(server, /meta\[property="og:video:secure_url"\]/);
  assert.match(server, /meta\[name="twitter:player"\]/);
  assert.match(server, /candidateEmbed = ensureString\(chosen\.embedUrl \|\| chosen\.contentUrl\)/);
  assert.match(server, /embedUrl:\s*resolveAsset\(clean\(embedRaw\)\)/);

  assert.match(client, /function normaliseRumbleEmbedUrl\(value\)/);
  assert.match(client, /function createRumbleIframe\(embedUrl\)/);
  assert.match(client, /fetch\("\/link-preview\?url=" \+ encodeURIComponent\(link\)\)/);
  assert.match(client, /createRumbleIframe\(preview\?\.embedUrl\)/);
  assert.doesNotMatch(client, /const candidate = segments\.find\(\(segment\) => \/\^v/);
});
