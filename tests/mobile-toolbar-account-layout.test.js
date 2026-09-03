'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const loginSource = fs.readFileSync(path.resolve(__dirname, '../public/login.html'), 'utf8');
const cssSource = fs.readFileSync(path.resolve(__dirname, '../public/chat.css'), 'utf8');

test('authenticated identity and sign-out controls share one toolbar group', () => {
  assert.match(
    loginSource,
    /<div class="account-session-controls">[\s\S]*id="account-identity"[\s\S]*id="account-logout-btn"[\s\S]*<\/div>/,
  );
});

test('narrow chat toolbar becomes a width-contained stacked layout', () => {
  const mobileStart = cssSource.indexOf('@media (max-width: 600px)');
  assert.notEqual(mobileStart, -1, 'expected a 600px mobile toolbar breakpoint');
  const mobileSource = cssSource.slice(mobileStart);

  assert.match(mobileSource, /#chat-container > header\s*\{[\s\S]*align-items:\s*stretch;[\s\S]*\}/);
  assert.match(mobileSource, /#chat-container header \.header-right\s*\{[\s\S]*width:\s*100%;[\s\S]*padding-left:\s*0;[\s\S]*margin-left:\s*0;[\s\S]*\}/);
  assert.match(mobileSource, /#chat-container \.search-bar\s*\{[\s\S]*margin-left:\s*0;[\s\S]*width:\s*100%;[\s\S]*\}/);
});

test('mobile account controls keep identity compact and sign-out touch safe', () => {
  const mobileStart = cssSource.indexOf('@media (max-width: 600px)');
  assert.notEqual(mobileStart, -1, 'expected a 600px mobile toolbar breakpoint');
  const mobileSource = cssSource.slice(mobileStart);

  assert.match(mobileSource, /\.account-session-controls\s*\{[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;[\s\S]*\}/);
  assert.match(mobileSource, /\.account-identity\s*\{[\s\S]*overflow:\s*hidden;[\s\S]*text-overflow:\s*ellipsis;[\s\S]*white-space:\s*nowrap;[\s\S]*\}/);
  assert.match(mobileSource, /#account-logout-btn\s*\{[\s\S]*min-height:\s*44px;[\s\S]*\}/);
});
