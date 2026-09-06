import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const userscriptPath = path.join(repoRoot, 'scripts', 'tampermonkey', 'dizygotic-rumble-chat-tool.user.js');
const source = fs.readFileSync(userscriptPath, 'utf8');

function functionBody(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const nextSection = source.indexOf('\n    /***********************', start + 1);
  return source.slice(start, nextSection === -1 ? source.length : nextSection);
}

test('Rumble Direct Message opens current DizyChat login with current prefill parameters', () => {
  const dm = functionBody('openDirectMessage');
  assert.doesNotMatch(dm, /dizychat-server\.onrender\.com/);
  assert.match(dm, /https:\/\/dizychat\.com\/login\.html/);
  assert.match(dm, /params\.set\(["']username["'],\s*resolvedNickname\)/);
  assert.match(dm, /params\.set\(["']room["'],\s*roomName\)/);
  assert.doesNotMatch(dm, /usernamePlaceholder|roomPlaceholder|params\.set\(["']invite["']/);
  assert.match(dm, /target.*dizychat/i, 'clicked Rumble username must feed the prefilled DM room');
});

test('normal Rumble boot does not hydrate the full IndexedDB transcript', () => {
  const boot = functionBody('boot');
  assert.doesNotMatch(boot, /await\s+initializeChatTranscriptStorage\s*\(/);
  assert.doesNotMatch(boot, /readAllChatRecords\s*\(/);
});

test('opening the settings panel starts transcript hydration on demand', () => {
  const panel = functionBody('showSettingsPanel');
  assert.match(panel, /initializeChatTranscriptStorage\s*\(/);
});

test('transcript history is read progressively instead of getAll loading it at once', () => {
  const storage = functionBody('readAllChatRecords');
  assert.doesNotMatch(storage, /\.getAll\s*\(/);
  assert.match(storage, /openCursor\s*\(/);
  assert.match(storage, /CHAT_TRANSCRIPT_READ_BATCH_SIZE/);
  assert.match(storage, /setTimeout\s*\(/, 'chunk loading must yield between batches');
});

test('existing rebuild control doubles as the explicit IndexedDB load/rebuild action', () => {
  assert.match(source, /id="rebuildCuratedBurnsBtn">Load \/ Rebuild IndexedDB transcript<\/button>/);
  assert.equal((source.match(/id="rebuildCuratedBurnsBtn"/g) || []).length, 1, 'reuse the existing rebuild button instead of adding a duplicate load control');
});
