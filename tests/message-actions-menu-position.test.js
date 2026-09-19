'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('message action menu flips upward and stays inside the messages viewport', () => {
  const source = read('public/chat.js');
  const start = source.indexOf('function positionMessageActionsMenu(menu)');
  const end = source.indexOf('\nfunction closeActiveMenu', start);
  assert.notEqual(start, -1, 'positionMessageActionsMenu must exist');
  assert.notEqual(end, -1, 'positionMessageActionsMenu must terminate before closeActiveMenu');
  const fn = source.slice(start, end);

  assert.match(fn, /menu\.closest\("#messages"\)/);
  assert.match(fn, /containerRect\?\.bottom/);
  assert.match(fn, /containerRect\?\.left/);
  assert.match(fn, /containerRect\?\.right/);
  assert.match(fn, /rect\.bottom\s*>\s*boundaryBottom/);
  assert.match(fn, /menu\.style\.top\s*=\s*"auto"/);
  assert.match(fn, /menu\.style\.bottom\s*=\s*`calc\(100% - \$\{preferredTop\}px\)`/);
  assert.match(fn, /horizontalRect\.left\s*<\s*boundaryLeft/);
  assert.match(fn, /horizontalRect\.right\s*>\s*boundaryRight/);
  assert.match(fn, /menu\.style\.right\s*=\s*"auto"/);
});
