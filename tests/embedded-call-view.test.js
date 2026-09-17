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
  assert.equal(runtime.classifyTrackSource({}, { source: 'screen_share' }), 'screen_share');
  assert.equal(runtime.classifyTrackSource({}, {}), 'camera');
});

test('screen sharing is disabled for native Capacitor and missing display capture', () => {
  assert.equal(runtime.canShareScreen({ native: true, hasDisplayCapture: true }), false);
  assert.equal(runtime.canShareScreen({ native: false, hasDisplayCapture: false }), false);
  assert.equal(runtime.canShareScreen({ native: false, hasDisplayCapture: true }), true);
});

test('embedded call stylesheet preserves full media frame and removes fixed popup geometry', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.match(css, /\.dizy-call-stage[\s\S]*object-fit:\s*contain/i);
  assert.match(css, /\.dizy-call-stage[\s\S]*\.voice-call-panel[\s\S]*position:\s*static\s*!important/i);
  assert.match(css, /@media\s*\(max-width:\s*768px\)/i);
  assert.match(css, /\.dizy-call-stage\.is-focus/i);
  assert.doesNotMatch(css, /\.dizy-call-stage[^{]*\{[^}]*width:\s*420px/i);
});

test('runtime includes focus chat overlays and native-safe screen share controls', () => {
  const source = fs.readFileSync(runtimePath, 'utf8');
  assert.match(source, /dizy-call-message-overlays/);
  assert.match(source, /data-dizy-call-action=["']focus["']/);
  assert.match(source, /data-dizy-call-action=["']chat["']/);
  assert.match(source, /data-dizy-call-action=["']screen["']/);
  assert.match(source, /setScreenShareEnabled/);
  assert.match(source, /Capacitor/);
  assert.match(source, /MutationObserver/);
});

test('bootstrap loads embedded call view immediately after chat client', () => {
  const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');
  const chatIndex = bootstrap.indexOf("await loadScript('/chat.js');");
  const embeddedIndex = bootstrap.indexOf("await loadScript('/embedded-call-view.js');");
  assert.ok(chatIndex >= 0, 'chat.js bootstrap load must exist');
  assert.ok(embeddedIndex > chatIndex, 'embedded call view must load after chat.js');
});
