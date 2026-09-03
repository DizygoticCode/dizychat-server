'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const chatSource = fs.readFileSync(path.resolve(__dirname, '../../public/chat.js'), 'utf8');

const count = (pattern) => (chatSource.match(pattern) || []).length;

// Regression: guarded Task 6 retries must keep one canonical browser join implementation.
test('Auth v2 browser account join wiring is installed exactly once', () => {
  assert.equal(count(/function joinCurrentRoomAsAccount\(/g), 1);
  assert.equal(count(/function emitRegisteredJoinRequest\(/g), 1);
});
