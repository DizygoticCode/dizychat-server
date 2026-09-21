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

test('any live display-audio track returned by the browser is publishable', () => {
  assert.equal(runtime.shouldPublishDisplayAudio({ readyState: 'live' }), true);
  assert.equal(runtime.shouldPublishDisplayAudio({}), true);
  assert.equal(runtime.shouldPublishDisplayAudio({ readyState: 'ended' }), false);
  assert.equal(runtime.shouldPublishDisplayAudio(null), false);
});

test('screen-share audio meter distinguishes silence from captured signal', () => {
  assert.equal(runtime.calculateAudioLevel(new Uint8Array([128, 128, 128, 128])), 0);
  assert.ok(runtime.calculateAudioLevel(new Uint8Array([118, 138, 118, 138])) > 0);
  assert.equal(runtime.calculateAudioLevel(new Uint8Array([0, 255, 0, 255])), 1);
});

test('embedded call stylesheet keeps uncropped non-resizable media above chat', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.match(css, /#chat-main\.dizy-call-layout[\s\S]*grid-template-areas:\s*"call users"\s*"chat users"/i);
  assert.match(css, /\.dizy-call-stage[\s\S]*object-fit:\s*contain/i);
  assert.match(css, /\.dizy-call-stage[\s\S]*\.call-video-element[\s\S]*height:\s*auto/i);
  assert.match(css, /\.dizy-call-stage[\s\S]*\.voice-call-panel[\s\S]*position:\s*static\s*!important/i);
  assert.match(css, /\.voice-call-panel[\s\S]*resize:\s*none\s*!important/i);
  assert.match(css, /background:\s*var\(--surface\)/i);
  assert.match(css, /border-color:\s*var\(--accent\)/i);
  assert.match(css, /@media\s*\(max-width:\s*768px\)/i);
  assert.match(css, /\.dizy-call-stage\.is-focus/i);
  assert.doesNotMatch(css, /grid-template-areas:\s*"call chat users"/i);
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

test('media actions are integrated into the native call header', () => {
  const source = fs.readFileSync(runtimePath, 'utf8');
  assert.match(source, /const callHeader = panel\.querySelector\(['"]\.voice-call-header['"]\)/);
  assert.match(source, /callHeader\.appendChild\(toolbar\)/);
});

test('focus and chat controls stay hidden until visual media exists', () => {
  const source = fs.readFileSync(runtimePath, 'utf8');
  assert.match(source, /state\.focusButton\.hidden\s*=\s*!presentation\.hasVisuals/);
  assert.match(source, /state\.chatButton\.hidden\s*=\s*!presentation\.hasVisuals/);
});

test('every media tile can be hidden locally and restored from the call header', () => {
  const source = fs.readFileSync(runtimePath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.match(source, /data-dizy-media-action=["']hide["']/);
  assert.match(source, /setTileHidden\(tile, true\)/);
  assert.match(source, /state\.hiddenTileKeys\.add\(key\)/);
  assert.match(source, /const visibleTiles = tiles\.filter\(\(tile\) => !tile\.hidden\)/);
  assert.match(source, /data-dizy-call-action=["']restore-hidden["']/);
  assert.match(source, /Show hidden media \(/);
  assert.match(source, /restoreHiddenTiles/);
  assert.match(css, /\.dizy-media-hide-button/);
  assert.match(css, /\.call-video-tile\[hidden\][\s\S]*display:\s*none\s*!important/i);
});

test('every media tile gets an in-chat expanded-view control with Escape exit', () => {
  const source = fs.readFileSync(runtimePath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.match(source, /ensureTileFullscreenControl/);
  assert.match(source, /data-dizy-media-action=["']fullscreen["']/);
  assert.match(source, /control\.textContent = ['"]×['"]/);
  assert.match(source, /control\.setAttribute\(['"]aria-label['"], ['"]Exit expanded media['"]\)/);
  assert.match(source, /event\?\.key === ['"]Escape['"]/);
  assert.match(source, /dizy-media-expanded/);
  assert.match(css, /\.dizy-media-fullscreen-button/);
  assert.match(css, /\.call-video-tile\.dizy-media-expanded[\s\S]*position:\s*fixed\s*!important/i);
  assert.match(css, /\.call-video-tile\.dizy-media-expanded[\s\S]*height:\s*100dvh\s*!important/i);
  assert.match(css, /\.dizy-media-expanded[\s\S]*object-fit:\s*contain\s*!important/i);
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /safe-area-inset-right/);
  assert.match(css, /\.dizy-screen-audio-meter/);
  assert.match(css, /\.dizy-screen-audio-meter-fill/);
});

test('runtime includes focus chat overlays and bounded browser screen sharing', () => {
  const source = fs.readFileSync(runtimePath, 'utf8');
  assert.match(source, /dizy-call-message-overlays/);
  assert.match(source, /data-dizy-call-action=["']focus["']/);
  assert.match(source, /data-dizy-call-action=["']chat["']/);
  assert.match(source, /data-dizy-call-action=["']screen["']/);
  assert.match(source, /getDisplayMedia\.call/);
  assert.match(source, /publishTrack/);
  assert.match(source, /dizy-screen-share/);
  assert.match(source, /source:\s*LK\.Track\.Source\.ScreenShare/);
  assert.match(source, /source:\s*LK\.Track\.Source\.ScreenShareAudio/);
  assert.match(source, /stream:\s*SCREEN_SHARE_TRACK_NAME/);
  assert.match(source, /state\.screenAudioState = shouldPublishDisplayAudio\(audioMediaTrack\) \? ['"]captured['"] : ['"]unavailable['"]/);
  assert.match(source, /state\.screenAudioState = ['"]published['"]/);
  assert.match(source, /startScreenAudioMeter\(audioMediaTrack\)/);
  assert.match(source, /createMediaStreamSource\(new MediaStreamCtor\(\[audioMediaTrack\]\)\)/);
  assert.match(source, /getByteTimeDomainData\(samples\)/);
  assert.match(source, /state\.screenAudioLevel = calculateAudioLevel\(samples\)/);
  assert.match(source, /audio:\s*\{[\s\S]*suppressLocalAudioPlayback:\s*false[\s\S]*restrictOwnAudio:\s*true[\s\S]*\}/);
  assert.match(source, /systemAudio:\s*['"]include['"]/);
  assert.match(source, /windowAudio:\s*['"]window['"]/);
  assert.match(source, /dtx:\s*false/);
  assert.match(source, /red:\s*false/);
  assert.match(source, /forceStereo:\s*true/);
  assert.match(source, /frameRate:\s*\{\s*ideal:\s*30,\s*max:\s*30\s*\}/);
  assert.match(source, /width:\s*\{\s*ideal:\s*1280,\s*max:\s*1920\s*\}/);
  assert.match(source, /height:\s*\{\s*ideal:\s*720,\s*max:\s*1080\s*\}/);
  assert.match(source, /simulcast:\s*false/);
  assert.match(source, /Capacitor/);
  assert.match(source, /MutationObserver/);
});

test('screen share previews immediately and publishes video without blocking the UI action', () => {
  const source = fs.readFileSync(runtimePath, 'utf8');
  const previewIndex = source.indexOf('renderLocalScreenTile(stream);');
  const publishDispatchIndex = source.indexOf('void publishScreenVideo({ participant, LK, stream, videoMediaTrack });');
  const audioPublishDispatchIndex = source.indexOf('void publishScreenAudio({ participant, LK, stream, audioMediaTrack });');
  assert.ok(previewIndex >= 0, 'local screen preview must be rendered');
  assert.ok(publishDispatchIndex > previewIndex, 'local preview must render before background LiveKit video publication is dispatched');
  assert.ok(audioPublishDispatchIndex > previewIndex, 'local preview must render before background LiveKit audio publication is dispatched');
  assert.match(source, /state\.screenBusy = false;[\s\S]*void publishScreenVideo/);
  assert.match(source, /publishTrackWithTimeout\(participant, videoMediaTrack/);
  assert.match(source, /publishTrackWithTimeout\(participant, audioMediaTrack/);
  assert.match(source, /if \(shouldPublishDisplayAudio\(audioMediaTrack\)\) \{\s*void publishScreenAudio/);
  assert.doesNotMatch(source, /displaySurface[\s\S]{0,220}publishScreenAudio/);
  assert.doesNotMatch(source, /await publishScreenVideo/);
  assert.doesNotMatch(source, /await publishScreenAudio/);
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

test('account sign-out and page exit explicitly disconnect an active LiveKit room', () => {
  const chat = fs.readFileSync(path.join(repoRoot, 'public', 'chat.js'), 'utf8');
  assert.match(chat, /for \(const button of \[accountLogoutBtn, lobbyAccountLogoutBtn\]\) \{\s*button\?\.addEventListener\(["']click["'], autoLeaveIfActive\);\s*\}/);
  assert.match(chat, /window\.addEventListener\(["']pagehide["'], autoLeaveIfActive\)/);
  assert.match(chat, /window\.addEventListener\(["']beforeunload["'], autoLeaveIfActive\)/);
  assert.match(chat, /const autoLeaveIfActive = \(\) => \{\s*if \(!callState\.room\) return;\s*leaveCall\(true\)\.catch\(\(\) => \{\}\);\s*\}/);
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
  assert.match(chat, /if \(track\?\.kind === LK\.Track\?\.Kind\?\.Audio\) \{\s*attachRemoteAudioTrack\(track, publication, participant\);\s*\}/);
  assert.match(chat, /const key = `\$\{participantSid\}:\$\{trackSid\}`/);
  assert.match(chat, /entry\.participantSid !== participantSid/);
  assert.match(chat, /if \(track && entry\.track === track\) return true/);
  assert.match(chat, /detachRemoteAudioTrack\(track, publication, participant\)/);
  assert.match(chat, /const attachRemoteAudioTrack = \(track, publication, participant\) => \{\s*if \(participant\?\.isLocal \|\|/);
  assert.match(chat, /const attachRemoteVideoTrack = \(track, publication, participant\) => \{\s*if \(participant\?\.isLocal \|\|/);
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


test('mixed screen share and portrait cameras stay contained above the message area', () => {
  const css = fs.readFileSync(cssPath, 'utf8');

  assert.match(
    css,
    /#chat-main\.dizy-call-layout\.dizy-call-has-visuals > \.dizy-call-stage\s*\{[^}]*max-height:\s*min\(56dvh, 640px\);/s,
  );
  assert.match(
    css,
    /\.dizy-call-stage\.has-visuals \.voice-call-panel\s*\{[^}]*flex:\s*1 1 auto;[^}]*overflow:\s*auto;[^}]*overscroll-behavior:\s*contain;/s,
  );
  assert.match(
    css,
    /\.dizy-call-stage\.has-screen-share \.call-video-grid\s*\{[^}]*minmax\(min\(180px, 100%\), 1fr\)/s,
  );
  assert.match(
    css,
    /\.dizy-screen-share-tile[\s\S]{0,220}max-height:\s*min\(36dvh, 440px\);/s,
  );
  assert.match(
    css,
    /\.call-video-tile:not\(\.dizy-screen-share-tile\)[\s\S]{0,260}max-height:\s*min\(24dvh, 280px\);/s,
  );

  // Preserve the no-crop contract and the existing escape hatches.
  assert.match(css, /object-fit:\s*contain/);
  assert.match(css, /\.call-video-tile\.dizy-media-expanded[\s\S]*height:\s*100dvh\s*!important/i);
  assert.match(css, /\.dizy-media-hide-button/);
});
