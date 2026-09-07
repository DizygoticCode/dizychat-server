const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server-core.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'public', 'chat.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'chat.css'), 'utf8');

test('server advertises the maximum-quality Music Mode contract', () => {
  assert.match(server, /const MUSIC_MODE_AUDIO_BITRATE = 510000;/);
  assert.match(server, /sampleRate:\s*48000/);
  for (const expected of [
    'channelCount: 2',
    'echoCancellation: false',
    'noiseSuppression: false',
    'autoGainControl: false',
    'dtx: false',
    'red: false',
    'forceStereo: true',
  ]) {
    assert.ok(server.includes(expected), `server Music Mode must include ${expected}`);
  }
  assert.match(server, /musicMode,\s*\n\s*audioSettings:\s*musicMode \? MUSIC_MODE_AUDIO_SETTINGS : null/);
});

test('client pins LiveKit SDK and publishes raw 48 kHz stereo Music Mode at 510 kb/s', () => {
  assert.match(client, /const MUSIC_MODE_AUDIO_BITRATE = 510000;/);
  assert.match(client, /sampleRate:\s*48000/);
  assert.match(client, /livekit-client@2\.22\.2\/dist\/livekit-client\.umd\.min\.js/g);
  assert.match(client, /echoCancellation:\s*\{\s*exact:\s*false\s*\}/);
  assert.match(client, /noiseSuppression:\s*\{\s*exact:\s*false\s*\}/);
  assert.match(client, /autoGainControl:\s*\{\s*exact:\s*false\s*\}/);
  assert.match(client, /sampleRate:\s*\{\s*ideal:\s*musicSettings\.sampleRate \|\| 48000\s*\}/);
  assert.match(client, /channelCount:\s*\{\s*ideal:\s*musicSettings\.channelCount \|\| 2\s*\}/);
  assert.match(client, /options\.dtx = false;/);
  assert.match(client, /options\.red = false;/);
  assert.match(client, /options\.forceStereo = true;/);
  assert.match(client, /audioPreset = \{ maxBitrate: musicSettings\.audioBitrate \|\| MUSIC_MODE_AUDIO_BITRATE \}/);
  assert.match(client, /contentHint = "music"/);
  assert.match(client, /applyConstraints\(microphoneSettings\)/);
  assert.match(client, /Music mode refused to publish because browser voice processing is still enabled/);
});

test('Music Mode choice is explicit per connection and locked once joining starts', () => {
  assert.match(client, /const requestedMusicMode = callState\.musicModeEnabled === true;/);
  assert.match(client, /const locked = inCall \|\| callState\.joining;/);
  assert.match(client, /if \(callState\.room \|\| callState\.joining\)/);
  assert.match(client, /const fetchToken = async \(musicMode\) =>/);
  assert.match(client, /musicMode: musicMode === true/);
  assert.match(client, /tokenPayload\.musicMode !== requestedMusicMode/);
  assert.match(client, /getMicrophoneSettings\(tokenPayload, requestedMusicMode\)/);
  assert.match(client, /getAudioPublishOptions\(LK, tokenPayload, requestedMusicMode\)/);
  assert.match(client, /callState\.musicModeEnabled = null;/g);
  assert.match(client, /if \(!callState\.room && panel\.hidden\) resetMusicModeChoice\(\);/);
});

test('Live Call toolbar icon is red disconnected and green connected', () => {
  assert.match(css, /#voice-call-btn:not\(\.call-active\)\s*\{[^}]*background:\s*#8a2d2d/);
  assert.match(css, /#voice-call-btn\.call-active\s*\{[^}]*background:\s*#1f9d55/);
  assert.doesNotMatch(css, /#voice-call-btn\.call-muted\s*\{[^}]*background:/);
  assert.doesNotMatch(css, /#voice-call-btn\.call-video-active\s*\{[^}]*background:/);
});
