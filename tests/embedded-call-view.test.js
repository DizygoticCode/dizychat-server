'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const runtimePath = path.join(repoRoot, 'public', 'embedded-call-view.js');
const cssPath = path.join(repoRoot, 'public', 'embedded-call-view.css');
const bootstrapPath = path.join(repoRoot, 'public', 'mobile-bootstrap.js');

const runtime = require(runtimePath);

test('screen share outranks camera while audio-only stays compact', () => {
  assert.deepEqual(
    runtime.derivePresentationState({ connected: true, focus: false, cameraCount: 0, screenShareCount: 0 }),
    { connected: true, focus: false, mode: 'audio', primary: null, hasVisuals: false },
  );
  assert.deepEqual(
    runtime.derivePresentationState({ connected: true, focus: false, cameraCount: 2, screenShareCount: 0 }),
    { connected: true, focus: false, mode: 'camera-grid', primary: 'camera', hasVisuals: true },
  );
  assert.deepEqual(
    runtime.derivePresentationState({ connected: true, focus: true, cameraCount: 2, screenShareCount: 1 }),
    { connected: true, focus: true, mode: 'screen-share', primary: 'screen_share', hasVisuals: true },
  );
});

test('track source classification distinguishes screen share from camera', () => {
  assert.equal(runtime.classifyTrackSource({ source: 'screen_share' }), 'screen_share');
  assert.equal(runtime.classifyTrackSource({ source: 'screen_share_audio' }), 'screen_share');
  assert.equal(runtime.classifyTrackSource({ source: 'camera' }), 'camera');
  assert.equal(runtime.classifyTrackSource({ trackName: 'dizy-screen-share' }), 'screen_share');
  assert.equal(runtime.classifyTrackSource({}, { source: 'screen_share' }), 'screen_share');
  assert.equal(runtime.classifyTrackSource({}, {}), 'camera');
});

test('screen sharing is disabled for native Capacitor and missing display capture', () => {
  assert.equal(runtime.canShareScreen({ native: true, hasDisplayCapture: true }), false);
  assert.equal(runtime.canShareScreen({ native: false, hasDisplayCapture: false }), false);
  assert.equal(runtime.canShareScreen({ native: false, hasDisplayCapture: true }), true);
});

test('full-display system audio is gated to prevent remote-call feedback', () => {
  assert.equal(runtime.shouldPublishDisplayAudio({ getSettings: () => ({ displaySurface: 'monitor' }) }), false);
  assert.equal(runtime.shouldPublishDisplayAudio({ getSettings: () => ({}) }), false);
  assert.equal(runtime.shouldPublishDisplayAudio({ getSettings: () => ({ displaySurface: 'window' }) }), true);
  assert.equal(runtime.shouldPublishDisplayAudio({ getSettings: () => ({ displaySurface: 'browser' }) }), true);
});

test('embedded call stylesheet preserves full media frame and removes fixed popup geometry', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.match(css, /\.dizy-call-stage[\s\S]*object-fit:\s*contain/i);
  assert.match(css, /\.dizy-call-stage[\s\S]*\.voice-call-panel[\s\S]*position:\s*static\s*!important/i);
  assert.match(css, /@media\s*\(max-width:\s*768px\)/i);
  assert.match(css, /\.dizy-call-stage\.is-focus/i);
  assert.doesNotMatch(css, /\.dizy-call-stage[^{]*\{[^}]*width:\s*420px/i);
});

test('audio-only calls use a compact row instead of reserving a visual-media column', () => {
  const source = fs.readFileSync(runtimePath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.match(source, /dizy-call-audio-only/);
  assert.match(source, /dizy-call-has-visuals/);
  assert.match(css, /#chat-main\.dizy-call-layout\.dizy-call-audio-only[\s\S]*grid-template-areas:\s*"call users"\s*"chat users"/i);
  assert.match(css, /\.dizy-call-stage\s+\.voice-call-drag-hint[\s\S]*display:\s*none\s*!important/i);
});

test('focus and chat controls stay hidden until visual media exists', () => {
  const source = fs.readFileSync(runtimePath, 'utf8');
  assert.match(source, /state\.focusButton\.hidden\s*=\s*!presentation\.hasVisuals/);
  assert.match(source, /state\.chatButton\.hidden\s*=\s*!presentation\.hasVisuals/);
});

test('runtime includes focus chat overlays and native LiveKit screen sharing', () => {
  const source = fs.readFileSync(runtimePath, 'utf8');
  assert.match(source, /dizy-call-message-overlays/);
  assert.match(source, /data-dizy-call-action=["']focus["']/);
  assert.match(source, /data-dizy-call-action=["']chat["']/);
  assert.match(source, /data-dizy-call-action=["']screen["']/);
  assert.match(source, /getDisplayMedia\.call/);
  assert.match(source, /restrictOwnAudio:\s*true/);
  assert.match(source, /suppressLocalAudioPlayback:\s*false/);
  assert.doesNotMatch(source, /suppressLocalAudioPlayback:\s*true/);
  assert.match(source, /shouldPublishDisplayAudio/);
  assert.match(source, /publishTrack/);
  assert.match(source, /dizy-screen-share/);
  assert.match(source, /source:\s*LK\.Track\.Source\.ScreenShare/);
  assert.match(source, /source:\s*LK\.Track\.Source\.ScreenShareAudio/);
  assert.match(source, /audio:\s*\{[^}]*restrictOwnAudio:\s*true/);
  assert.match(source, /systemAudio:\s*['"]include['"]/);
  assert.match(source, /Capacitor/);
  assert.match(source, /MutationObserver/);
});

test('screen share previews immediately and does not block the UI on share-audio publication', () => {
  const source = fs.readFileSync(runtimePath, 'utf8');
  const previewIndex = source.indexOf('renderLocalScreenTile(stream);');
  const videoPublishIndex = source.indexOf('publishTrackWithTimeout(participant, videoMediaTrack');
  assert.ok(previewIndex >= 0, 'local screen preview must be rendered');
  assert.ok(videoPublishIndex > previewIndex, 'local preview must render before LiveKit video publication finishes');
  assert.match(source, /publishTrackWithTimeout/);
  assert.match(source, /void publishScreenAudio/);
  assert.match(source, /publishTrackWithTimeout\(participant, audioMediaTrack/);
  assert.doesNotMatch(source, /new LK\.LocalVideoTrack\(videoMediaTrack\)/);
  assert.doesNotMatch(source, /new LK\.LocalAudioTrack\(audioMediaTrack\)/);
});

test('connected room lifecycle uses an explicit bridge instead of patching SDK internals', () => {
  const source = fs.readFileSync(runtimePath, 'utf8');
  const chat = fs.readFileSync(path.join(repoRoot, 'public', 'chat.js'), 'utf8');
  assert.match(chat, /dizychat:call-room/);
  assert.match(chat, /publishCallRoomState\(room, LK\)/);
  assert.match(chat, /publishCallRoomState\(null\)/);
  assert.match(source, /addEventListener\(['"]dizychat:call-room['"]/);
  assert.match(source, /bridge\?\.room && bridge\?\.sdk/);
  assert.doesNotMatch(source, /Room\.prototype\.connect/);
});

test('server grants native screen sources and uses a per-tab identity suffix', () => {
  const server = fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');
  const chat = fs.readFileSync(path.join(repoRoot, 'public', 'chat.js'), 'utf8');
  assert.match(server, /'screen_share', 'screen_share_audio'/);
  assert.match(server, /username:\s*callSessionId \? `\$\{username\}--\$\{callSessionId\}` : username/);
  assert.match(chat, /const callSessionId = window\.crypto\?\.randomUUID/);
  assert.doesNotMatch(chat, /sessionStorage\?\.getItem\(key\)/);
  assert.match(chat, /callSessionId:\s*getCallSessionId\(\)/);
});

test('remote microphone and screen audio use independent track keys and shared participant controls', () => {
  const chat = fs.readFileSync(path.join(repoRoot, 'public', 'chat.js'), 'utf8');
  assert.match(chat, /const key = `\$\{participantSid\}:\$\{trackSid\}`/);
  assert.match(chat, /entry\.participantSid !== participantSid/);
  assert.match(chat, /if \(track && entry\.track === track\) return true/);
  assert.match(chat, /detachRemoteAudioTrack\(track, publication, participant\)/);
});

test('pre-existing remote screen publications are classified for late joiners', () => {
  const source = fs.readFileSync(runtimePath, 'utf8');
  const chat = fs.readFileSync(path.join(repoRoot, 'public', 'chat.js'), 'utf8');
  assert.match(source, /room\.remoteParticipants\?\.forEach/);
  assert.match(source, /tagRemoteTile\(track, publication, participant\)/);
  assert.match(chat, /publication\?\.source === ["']screen_share["']/);
  assert.match(chat, /tile\.classList\.add\(["']dizy-screen-share-tile["']\)/);
});

test('bootstrap loads embedded call view immediately after chat client', () => {
  const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');
  const chatIndex = bootstrap.indexOf("await loadScript('/chat.js');");
  const embeddedIndex = bootstrap.indexOf("await loadScript('/embedded-call-view.js');");
  assert.ok(chatIndex >= 0, 'chat.js bootstrap load must exist');
  assert.ok(embeddedIndex > chatIndex, 'embedded call view must load after chat.js');
});
