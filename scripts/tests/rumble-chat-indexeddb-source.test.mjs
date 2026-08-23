import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const sourcePath = new URL("../tampermonkey/dizygotic-rumble-chat-tool.user.js", import.meta.url);
const source = fs.readFileSync(sourcePath, "utf8");

function between(startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0, `missing start boundary: ${startNeedle}`);
  assert.ok(end > start, `missing end boundary: ${endNeedle}`);
  return source.slice(start, end);
}

test("v1.9.7 stores the transcript in IndexedDB with no app message-count ceiling", () => {
  assert.match(source, /\/\/ @version\s+1\.9\.7/);
  assert.match(source, /const CHAT_DB_NAME = "dizygoticRumbleChat";/);
  assert.match(source, /const CHAT_DB_STORE = "messages";/);
  assert.match(source, /indexedDB\.open\(CHAT_DB_NAME, CHAT_DB_VERSION\)/);
  assert.match(source, /createObjectStore\(CHAT_DB_STORE, \{ keyPath: "seq" \}\)/);
  assert.doesNotMatch(source, /CHAT_LOG_LIMIT/);
  assert.doesNotMatch(source, /chatLog\.splice\(0, chatLog\.length -/);
  assert.doesNotMatch(source, /localStorage\.setItem\(CHAT_LOG_KEY, JSON\.stringify\(chatLog\)\)/);
});

test("legacy localStorage transcript migrates before the old key is removed", () => {
  const init = between("async function initializeChatTranscriptStorage()", "function extractMentions(text)");
  assert.match(init, /legacyChatLog/);
  assert.match(init, /await putChatRecords\(db, legacyChatLog\)/);
  assert.match(init, /chatLog = await readAllChatRecords\(db\)/);
  assert.match(init, /localStorage\.removeItem\(CHAT_LOG_KEY\)/);
  assert.ok(init.indexOf("await putChatRecords(db, legacyChatLog)") < init.indexOf("localStorage.removeItem(CHAT_LOG_KEY)"));
  assert.ok(init.indexOf("chatLog = await readAllChatRecords(db)") < init.indexOf("localStorage.removeItem(CHAT_LOG_KEY)"));
});

test("new records are queued and batch-written to IndexedDB instead of rewriting the whole transcript", () => {
  const save = between("async function saveChatLog()", "function scheduleChatLogSave()");
  const record = between("function recordChatMessage(el, username, displayName, message)", "async function clearChatLog()");
  assert.match(save, /pendingChatWrites\.splice\(0\)/);
  assert.match(save, /await putChatRecords\(db, batch\)/);
  assert.match(record, /pendingChatWrites\.push\(record\)/);
  assert.doesNotMatch(record, /CHAT_LOG_LIMIT|chatLog\.splice/);
});

test("clear, export and curated rebuild operate on the full IndexedDB-backed history", () => {
  const clear = between("async function clearChatLog()", "function csvEscape(value)");
  const rebuild = between("async function rebuildCuratedBurnsFromTranscript(reset = true)", "function backfillCuratedBurnsFromTranscript()");
  const backfill = between("function backfillCuratedBurnsFromTranscript()", "function clearCuratedBurns(options = {})");
  assert.match(clear, /await clearChatRecords\(db\)/);
  assert.match(source, /async function exportChatLog\(format = "json"\)[\s\S]*?await initializeChatTranscriptStorage\(\)/);
  assert.match(rebuild, /await initializeChatTranscriptStorage\(\)/);
  assert.match(rebuild, /const records = chatLog\.slice\(\);/);
  assert.doesNotMatch(rebuild, /slice\(-5000\)/);
  assert.doesNotMatch(backfill, /slice\(-5000\)/);
});

test("boot waits for transcript storage and the panel reports IndexedDB status", () => {
  assert.match(source, /id="chatStorageStatus"/);
  assert.match(source, /chatStorageSummaryText\(\)/);
  assert.match(source, /async function boot\(\)[\s\S]*?await initializeChatTranscriptStorage\(\);[\s\S]*?backfillCuratedBurnsFromTranscript\(\);/);
  assert.match(source, /navigator\.storage\?\.persist/);
});
