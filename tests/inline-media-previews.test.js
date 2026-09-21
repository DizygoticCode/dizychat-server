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
    /\.message\.has-inline-media\.has-inline-audio\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*min\(490px, 96%\);/s,
  );
  assert.match(
    css,
    /\.inline-preview\.inline-audio \.preview-media\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*width:\s*100%;[^}]*min-height:\s*0;[^}]*padding:\s*0;[^}]*overflow:\s*visible;[^}]*justify-content:\s*stretch;[^}]*align-items:\s*stretch;/s,
  );
  assert.match(
    css,
    /\.inline-preview\.inline-audio \.preview-media audio\s*\{[^}]*width:\s*100%;[^}]*height:\s*42px;/s,
  );
  assert.match(css, /\.message\.media-only\.has-inline-audio\s*\{[^}]*max-width:\s*min\(470px, 96%\);/s);
  assert.match(css, /\.message\.has-inline-audio \.inline-preview\.inline-audio\s*\{[^}]*width:\s*min\(440px, 100%\);/s);
  assert.match(
    css,
    /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*\.message\.has-inline-media\.has-inline-audio\s*\{[^}]*width:\s*min\(410px, 94%\);[^}]*max-width:\s*min\(430px, 94%\);/s,
  );
  assert.match(
    css,
    /\.message\.media-only\.has-inline-audio\s*\{[^}]*width:\s*min\(410px, 94%\);[^}]*max-width:\s*min\(430px, 94%\);/s,
  );
  assert.match(css, /\.message\.has-inline-audio \.inline-preview\.inline-audio\s*\{[^}]*width:\s*100%;/s);
  assert.ok(css.includes('width: min(440px, 100%);'));
  assert.ok(css.includes('justify-items: start;'));
  assert.match(client, /const isSoundboardAudio = previewType === "audio"/);
  assert.match(client, /pathname\.startsWith\("\/soundboards\/"\)/);
  assert.match(client, /node\.classList\.add\("has-soundboard-audio"\)/);
  assert.match(css, /\.message\.has-soundboard-audio \.text:not\(:empty\)\s*\{[^}]*margin-bottom:\s*2px;[^}]*font-weight:\s*600;/s);
  assert.match(client, /waveform\.className = "audio-waveform"/);
  assert.match(client, /const AUDIO_WAVEFORM_BAR_COUNT = 64/);
  assert.match(client, /AUDIO_WAVEFORM_MAX_DECODE_BYTES = 12 \* 1024 \* 1024/);
  assert.match(client, /decodeAudioWaveform\(audio\.src, waveformBars\.length\)/);
  assert.match(client, /context\.decodeAudioData\(encoded\.slice\(0\)\)/);
  assert.match(client, /waveform\.setAttribute\("role", "slider"\)/);
  assert.match(client, /waveform\.setAttribute\("tabindex", "0"\)/);
  assert.match(client, /waveform\.addEventListener\("pointerdown"/);
  assert.match(client, /waveform\.addEventListener\("pointermove"/);
  assert.match(client, /audio\.currentTime = progress \* duration/);
  assert.match(client, /event\.key === "ArrowLeft"/);
  assert.match(client, /event\.key === "ArrowRight"/);
  assert.match(client, /window\.requestAnimationFrame\(animateWaveform\)/);
  assert.match(client, /waveform\.dataset\.playing = audio\.paused \|\| audio\.ended \? "0" : "1"/);
  assert.match(client, /audio\.addEventListener\(eventName, syncAudioWaveform\)/);
  assert.match(css, /\.audio-waveform\s*\{[^}]*height:\s*42px;[^}]*touch-action:\s*none;/s);
  assert.match(css, /\.audio-waveform-bar\.is-played\s*\{[^}]*background:\s*var\(--accent\);/s);
  assert.match(css, /\.audio-waveform-playhead\s*\{[^}]*left:\s*var\(--wave-progress\);/s);
  assert.match(css, /\.inline-preview\.inline-audio \.preview-download\s*\{[^}]*min-width:\s*84px;[^}]*border-radius:\s*999px;/s);
});

test('video and embedded players keep enough responsive space for native controls', () => {
  const client = fs.readFileSync(path.join(repoRoot, 'public', 'chat.js'), 'utf8');
  const css = fs.readFileSync(path.join(repoRoot, 'public', 'chat.css'), 'utf8');

  assert.match(client, /if \(el\.tagName === "IFRAME"\) \{\s*node\.classList\.add\("has-inline-embed"\);/s);
  assert.match(css, /\.inline-preview\.inline-video \.preview-media\s*\{[^}]*aspect-ratio:\s*16 \/ 9;/s);
  assert.match(css, /\.inline-preview\.inline-video \.preview-media video\s*\{[^}]*object-fit:\s*contain;/s);
  assert.match(
    css,
    /\.message\.has-inline-embed\s*\{[^}]*width:\s*min\(500px, 94%\);[^}]*max-width:\s*min\(520px, 94%\);/s,
  );
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


test('decoded audio waveform work is bounded and degrades safely for large or unsupported media', () => {
  const client = fs.readFileSync(path.join(repoRoot, 'public', 'chat.js'), 'utf8');

  assert.match(client, /const AUDIO_WAVEFORM_CACHE_LIMIT = 48/);
  assert.match(client, /method: "HEAD"/);
  assert.match(client, /declaredBytes > AUDIO_WAVEFORM_MAX_DECODE_BYTES/);
  assert.match(client, /encoded\.byteLength > AUDIO_WAVEFORM_MAX_DECODE_BYTES/);
  assert.match(client, /return null;/);
  assert.match(client, /waveform\.dataset\.waveformSource = "fallback"/);
  assert.match(client, /waveform\.dataset\.waveformSource = "decoded"/);
});
