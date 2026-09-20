'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'chat.css'), 'utf8');

test('media-only image GIF and video bubbles stay compact without nested-card chrome', () => {
  assert.match(css, /\.message\.media-only\s*\{[^}]*max-width:\s*min\(380px, 96%\);/s);
  assert.match(css, /\.message\.media-only:not\(\.has-inline-audio\) \.inline-preview\s*\{[^}]*padding:\s*3px;[^}]*border-color:\s*transparent;[^}]*background:\s*transparent;/s);
  assert.match(css, /\.inline-preview\.inline-image\s*\{[^}]*width:\s*min\(360px, 100%\);[^}]*padding:\s*6px;/s);
  assert.match(css, /\.inline-preview\.tenor-inline\s*\{[^}]*width:\s*min\(260px, 100%\);[^}]*padding:\s*5px;/s);
  assert.match(css, /\.inline-preview\.inline-image \.preview-media img\s*\{[^}]*max-height:\s*min\(480px, 62vh\);/s);
});

test('reply preview and picker states match the compact chat visual language', () => {
  assert.match(css, /#reply-preview\s*\{[^}]*gap:\s*8px;[^}]*padding:\s*7px 10px;[^}]*border-radius:\s*10px;/s);
  assert.match(css, /\.soundboard-status\s*\{[^}]*padding:\s*9px 10px;[^}]*border:\s*1px solid rgba\(187,134,252,0\.24\);/s);
  assert.match(css, /#gif-picker \.gif-loading,[\s\S]*border-radius:\s*9px;[\s\S]*font-size:\s*0\.8rem;/s);
  assert.match(css, /body:not\(\.dark\) #gif-picker\s*\{[^}]*background:\s*rgba\(248,248,255,0\.98\);/s);
});

test('mobile toolbar remains accessible without clipping controls', () => {
  assert.match(css, /#chat-container header \.header-right\s*\{[^}]*overflow-x:\s*auto;[^}]*scrollbar-width:\s*none;[^}]*-webkit-overflow-scrolling:\s*touch;/s);
  assert.match(css, /#chat-container \.search-bar\s*\{[^}]*width:\s*min\(30vw, 150px\);[^}]*min-width:\s*104px;/s);
  assert.match(css, /#gif-picker\s*\{[^}]*bottom:\s*calc\(70px \+ env\(safe-area-inset-bottom\)\);[^}]*width:\s*min\(340px, calc\(100vw - 20px\)\);/s);
});

test('obsolete duplicate purple patch styles are removed', () => {
  assert.doesNotMatch(css, /DIZY PURPLE PATCH/);
  assert.doesNotMatch(css, /\.embed-card\s*\{/);
  assert.doesNotMatch(css, /\.link-preview-lite\s*\{/);
  assert.doesNotMatch(css, /#upload-progress\s*\{/);
  assert.match(css, /DIZY FUSION SUPERNOVA PATCH/);
});
