'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'chat.css'), 'utf8');

test('message chrome stays compact and touch-friendly', () => {
  assert.match(css, /\.message:hover\s*\{[^}]*translateY\(-1px\)/s);
  assert.match(css, /\.message \.reply-context\s*\{[^}]*padding:\s*5px 8px;[^}]*border-radius:\s*8px;/s);
  assert.match(css, /\.message \.reactions\s*\{[^}]*gap:\s*4px;/s);
  assert.match(css, /\.message \.reactions \.reaction-chip\s*\{[^}]*padding:\s*2px 6px;[^}]*font-size:\s*0\.78em;/s);
  assert.match(css, /\.message \.message-actions-menu\s*\{[^}]*min-width:\s*148px;[^}]*border-radius:\s*12px;/s);
});

test('composer uses a compact rounded input and consistent icon hit targets', () => {
  assert.match(css, /--input-field-padding-y:\s*7px;/);
  assert.match(css, /#input\s*\{[^}]*border-radius:\s*999px;[^}]*min-height:\s*36px;/s);
  assert.match(css, /#input:focus\s*\{[^}]*box-shadow:\s*0 0 0 3px/s);
  assert.match(css, /#form button\s*\{[^}]*min-width:\s*var\(--input-icon-size\);[^}]*min-height:\s*var\(--input-icon-size\);[^}]*border-radius:\s*999px;/s);
});

test('link cards and soundboard picker keep the denser unified visual treatment', () => {
  assert.match(css, /\.link-card\s*\{[^}]*padding:\s*9px;[^}]*gap:\s*10px;/s);
  assert.match(css, /\.link-card \.link-thumb\s*\{[^}]*width:\s*54px;[^}]*height:\s*54px;/s);
  assert.match(css, /\.soundboard-mode-tabs\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*1fr 1fr;[^}]*padding:\s*3px;/s);
  assert.match(css, /\.soundboard-mode-tab\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;/s);
  assert.match(css, /\.soundboard-item\s*\{[^}]*padding:\s*7px 9px;/s);
  assert.match(css, /\.soundboard-web-clip:hover,[\s\S]*border-color:\s*rgba\(187,134,252,0\.42\)/s);
});
