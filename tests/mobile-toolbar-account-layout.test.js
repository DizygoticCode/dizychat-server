'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const loginSource = fs.readFileSync(path.resolve(__dirname, '../public/login.html'), 'utf8');
const baseCssSource = fs.readFileSync(path.resolve(__dirname, '../public/chat.css'), 'utf8');
const mobileCssPath = path.resolve(__dirname, '../public/mobile-toolbar.css');
const mobileCssSource = fs.existsSync(mobileCssPath) ? fs.readFileSync(mobileCssPath, 'utf8') : '';
const cssSource = `${baseCssSource}\n${mobileCssSource}`;

test('chat loads the narrow-screen toolbar override after the base stylesheet', () => {
  assert.match(loginSource, /<link rel="stylesheet" href="\/chat\.css" \/>[\s\S]*<link rel="stylesheet" href="\/mobile-toolbar\.css" \/>/);
});

test('authenticated identity and sign-out controls share one toolbar group', () => {
  assert.match(
    loginSource,
    /<div class="account-session-controls">[\s\S]*id="account-identity"[\s\S]*id="account-logout-btn"[\s\S]*<\/div>/,
  );
});

test('narrow chat toolbar becomes a width-contained stacked layout', () => {
  const mobileStart = cssSource.lastIndexOf('@media (max-width: 600px)');
  assert.notEqual(mobileStart, -1, 'expected a 600px mobile toolbar breakpoint');
  const mobileSource = cssSource.slice(mobileStart);

  assert.match(mobileSource, /#chat-container > header\s*\{[\s\S]*align-items:\s*stretch;[\s\S]*\}/);
  assert.match(mobileSource, /#chat-container header \.header-right\s*\{[\s\S]*width:\s*100%;[\s\S]*padding-left:\s*0;[\s\S]*margin-left:\s*0;[\s\S]*\}/);
  assert.match(mobileSource, /#chat-container \.search-bar\s*\{[\s\S]*margin-left:\s*0;[\s\S]*width:\s*100%;[\s\S]*\}/);
});

test('mobile account controls keep identity compact and sign-out touch safe', () => {
  const mobileStart = cssSource.lastIndexOf('@media (max-width: 600px)');
  assert.notEqual(mobileStart, -1, 'expected a 600px mobile toolbar breakpoint');
  const mobileSource = cssSource.slice(mobileStart);

  assert.match(mobileSource, /\.account-session-controls\s*\{[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;[\s\S]*\}/);
  assert.match(mobileSource, /\.account-identity\s*\{[\s\S]*overflow:\s*hidden;[\s\S]*text-overflow:\s*ellipsis;[\s\S]*white-space:\s*nowrap;[\s\S]*\}/);
  assert.match(mobileSource, /#account-logout-btn\s*\{[\s\S]*min-height:\s*44px;[\s\S]*\}/);
});

test('mobile leave action is an icon control and six toolbar actions fit one row', () => {
  const mobileStart = cssSource.lastIndexOf('@media (max-width: 600px)');
  assert.notEqual(mobileStart, -1, 'expected a 600px mobile toolbar breakpoint');
  const mobileSource = cssSource.slice(mobileStart);

  assert.match(
    loginSource,
    /<button id="leave-btn"[^>]*>[\s\S]*<span class="icon"[^>]*>🚪<\/span>[\s\S]*<span class="label">Leave<\/span>[\s\S]*<\/button>/,
  );
  assert.match(
    mobileSource,
    /#chat-container header \.header-right\s*\{[\s\S]*grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\);[\s\S]*\}/,
  );
  assert.match(mobileSource, /#leave-btn \.label\s*\{[\s\S]*display:\s*none;[\s\S]*\}/);
  assert.doesNotMatch(mobileSource, /#leave-btn\s*\{[\s\S]*grid-column:\s*span\s+2;[\s\S]*\}/);
});
