'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const bootstrapSource = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const coreSource = fs.readFileSync(path.join(__dirname, '..', 'server-core.js'), 'utf8');
const source = `${bootstrapSource}\n${coreSource}`;

test('server bootstrap delegates to the preserved server core', () => {
  assert.match(bootstrapSource, /require\(['"]\.\/server-core['"]\)/);
});

test('server wires room joins through persistent password authority', () => {
  assert.match(source, /createRoomPasswordService/);
  assert.match(source, /roomPasswordService\.claimOrVerify\(roomName, providedPassword\)/);
  assert.doesNotMatch(source, /roomPasswords\.set\(roomName, providedPassword\)/);
  assert.doesNotMatch(source, /storedPassword\s*!==\s*providedPassword/);
});

test('server hydrates room password visibility from Mongo after connect', () => {
  assert.match(source, /roomPasswordService\.ensureRooms\(PERSISTENT_ROOMS\)/);
  assert.match(source, /roomPasswordService\.loadAll\(\)/);
});
