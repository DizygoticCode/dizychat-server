'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('expensive joined-room socket reads share a bounded per-socket query budget', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const server = fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');

  assert.match(
    server,
    /SOCKET_QUERY_RATE_WINDOW_MS = parsePositiveIntegerEnv\('SOCKET_QUERY_RATE_WINDOW_MS', 2000, \{ min: 500, max: 60_000 \}\)/,
  );
  assert.match(
    server,
    /SOCKET_QUERY_MAX_PER_WINDOW = parsePositiveIntegerEnv\('SOCKET_QUERY_MAX_PER_WINDOW', 8, \{ min: 2, max: 100 \}\)/,
  );
  assert.match(server, /const socketQueryTimestamps = new Map\(\)/);
  assert.match(server, /const canRunSocketQuery = \(socketId\) => \{/);

  assert.match(
    server,
    /socket\.on\('request older messages'[\s\S]{0,900}if \(!canRunSocketQuery\(socket\.id\)\)[\s\S]{0,500}rateLimited: true/,
  );
  assert.match(
    server,
    /socket\.on\('search messages'[\s\S]{0,500}if \(!canRunSocketQuery\(socket\.id\)\) return;/,
  );
  assert.match(
    server,
    /const safeQuery = typeof query === 'string' \? query\.trim\(\)\.slice\(0, 200\) : '';/,
  );
  assert.match(server, /query: safeQuery, filter, results: payload/);
});

test('rate-limited older-history response preserves the current cursor for a later retry', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const server = fs.readFileSync(path.join(repoRoot, 'server-core.js'), 'utf8');

  assert.match(
    server,
    /socket\.emit\('older messages', \{[\s\S]{0,220}messages: \[\],[\s\S]{0,120}hasMore: true,[\s\S]{0,120}cursor: String\(cursor\),[\s\S]{0,120}rateLimited: true/,
  );
});
