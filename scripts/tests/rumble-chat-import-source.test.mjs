import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const sourcePath = new URL("../tampermonkey/dizygotic-rumble-chat-tool.user.js", import.meta.url);
const source = fs.readFileSync(sourcePath, "utf8");

test("chat transcript JSON can be merged back into IndexedDB without clearing existing history", () => {
  assert.match(source, /async function importChatLogFile\(file\)/);
  assert.match(source, /await initializeChatTranscriptStorage\(\)/);
  assert.match(source, /async function putChatRecordsInBatches\(db, records, batchSize = 2000\)/);
  assert.match(source, /await putChatRecords\(db, records\.slice\(index, index \+ batchSize\)\)/);
  assert.match(source, /await putChatRecordsInBatches\(db, importedRecords\)/);
  const importBlock = source.match(/async function importChatLogFile\(file\)[\s\S]*?\n    }\n/);
  assert.ok(importBlock, "missing importChatLogFile implementation");
  assert.doesNotMatch(importBlock[0], /clearChatRecords|\.clear\(\)/);
});

test("chat import accepts old exported array/object shapes and deduplicates before resequencing", () => {
  assert.match(source, /parsed\.chatLog/);
  assert.match(source, /parsed\.messages/);
  assert.match(source, /parsed\.transcript/);
  assert.match(source, /chatImportFingerprint/);
  assert.match(source, /existingFingerprints/);
  assert.match(source, /seq:\s*\+\+chatSequence/);
});

test("settings panel exposes a separate Chat Import button", () => {
  assert.match(source, /createAccentButton\("Chat Import"/);
  assert.match(source, /accept = "\.json"/);
  assert.match(source, /importChatLogFile\(file\)/);
});
