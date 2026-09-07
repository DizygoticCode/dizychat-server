import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '../..');
const userscript = fs.readFileSync(path.join(root, 'scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const rawUrl = 'https://raw.githubusercontent.com/DizygoticCode/dizychat-server/main/scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js';

test('Rumble userscript updates directly from the public GitHub source', () => {
  assert.match(userscript, new RegExp(`^// @updateURL\\s+${rawUrl.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}$`, 'm'));
  assert.match(userscript, new RegExp(`^// @downloadURL\\s+${rawUrl.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}$`, 'm'));
});

test('README documents GitHub as the userscript distribution source and contains no Greasy Fork reference', () => {
  assert.match(readme, /raw\.githubusercontent\.com\/DizygoticCode\/dizychat-server\/main\/scripts\/tampermonkey\/dizygotic-rumble-chat-tool\.user\.js/);
  assert.doesNotMatch(readme, /greasy\s*fork|greasyfork\.org/i);
});
