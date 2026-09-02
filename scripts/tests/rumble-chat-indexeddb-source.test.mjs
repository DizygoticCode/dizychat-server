import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Source-contract regression for responsive, unbounded IndexedDB transcript storage.
const sourcePath = new URL("../tampermonkey/dizygotic-rumble-chat-tool.user.js", import.meta.url);
const source = fs.readFileSync(sourcePath, "utf8");

function between(startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0, `missing start boundary: ${startNeedle}`);
  assert.ok(end > start, `missing end boundary: ${endNeedle}`);
  return source.slice(start, end);
}

test("transcript remains in IndexedDB with no app message-count ceiling", () => {
  assert.match(source, /const CHAT_DB_NAME = "dizygoticRumbleChat";/);
  assert.match(source, /const CHAT_DB_STORE = "messages";/);
  assert.match(source, /indexedDB\.open\(CHAT_DB_NAME, CHAT_DB_VERSION\)/);
  assert.match(source, /createObjectStore\(CHAT_DB_STORE, \{ keyPath: "seq" \}\)/);
  assert.doesNotMatch(source, /CHAT_LOG_LIMIT/);
  assert.doesNotMatch(source, /chatLog\.splice\(0, chatLog\.length -/);
  assert.doesNotMatch(source, /localStorage\.setItem\(CHAT_LOG_KEY, JSON\.stringify\(chatLog\)\)/);
});

test("legacy localStorage transcript migrates before the old key is removed", () => {
  const init = between("async function initializeChatTranscriptStorage()", "let chatLogSaveTimer = null;");
  assert.match(init, /legacyChatLog/);
  assert.match(init, /await putChatRecords\(db, legacyChatLog\)/);
  assert.match(init, /localStorage\.removeItem\(CHAT_LOG_KEY\)/);
  assert.ok(init.indexOf("await putChatRecords(db, legacyChatLog)") < init.indexOf("localStorage.removeItem(CHAT_LOG_KEY)"));
});

test("large transcript boot reads only the latest sequence then hydrates bounded batches in the background", () => {
  assert.match(source, /const CHAT_HISTORY_BATCH_SIZE = 250;/);
  const reads = between("async function readLatestChatSequence(db)", "async function clearChatRecords(db)");
  assert.match(reads, /openCursor\(null, "prev"\)/);
  assert.match(reads, /getAll\(range, CHAT_HISTORY_BATCH_SIZE\)/);
  assert.doesNotMatch(reads, /\.getAll\(\)/);
  assert.match(reads, /await new Promise\(\(resolve\) => setTimeout\(resolve, 0\)\)/);

  const init = between("async function initializeChatTranscriptStorage()", "let chatLogSaveTimer = null;");
  assert.match(init, /chatSequence = await readLatestChatSequence\(db\)/);
  assert.match(init, /chatHistoryLoadPromise = hydrateChatHistoryInBackground\(db, chatSequence\)/);
  assert.doesNotMatch(init, /await hydrateChatHistoryInBackground/);
});

test("new records are queued and batch-written to IndexedDB instead of rewriting the whole transcript", () => {
  const save = between("async function saveChatLog()", "function scheduleChatLogSave()");
  const record = between("function recordChatMessage(el, username, displayName, message)", "async function clearChatLog()");
  assert.match(save, /pendingChatWrites\.splice\(0\)/);
  assert.match(save, /await putChatRecords\(db, batch\)/);
  assert.match(record, /pendingChatWrites\.push\(record\)/);
  assert.doesNotMatch(record, /CHAT_LOG_LIMIT|chatLog\.splice/);
});

test("full-history operations wait for background hydration instead of exporting a partial transcript", () => {
  assert.match(source, /async function ensureChatHistoryLoaded\(\)/);
  const clear = between("async function clearChatLog()", "function csvEscape(value)");
  const exportBlock = between("async function exportChatLog(format = \"json\")", "function chatImportFingerprint(record)");
  const importBlock = between("async function importChatLogFile(file)", "function escapeRegex(value)");
  const rebuild = between("async function rebuildCuratedBurnsFromTranscript(reset = true)", "function backfillCuratedBurnsFromTranscript()");
  assert.match(clear, /await ensureChatHistoryLoaded\(\)/);
  assert.match(exportBlock, /await ensureChatHistoryLoaded\(\)/);
  assert.match(importBlock, /await ensureChatHistoryLoaded\(\)/);
  assert.match(rebuild, /await ensureChatHistoryLoaded\(\)/);
  assert.match(rebuild, /const records = chatLog\.slice\(\);/);
  assert.doesNotMatch(rebuild, /slice\(-5000\)/);
});

test("boot renders controls before kicking transcript hydration off asynchronously", () => {
  assert.match(source, /id="chatStorageStatus"/);
  assert.match(source, /chatStorageSummaryText\(\)/);
  const boot = between("function boot()", "if (document.readyState");
  assert.match(boot, /ensureFloatingSettingsButton\(\)/);
  assert.match(boot, /setTimeout\(\(\) => \{ void initializeChatTranscriptStorage\(\); \}, 0\)/);
  assert.doesNotMatch(boot, /await initializeChatTranscriptStorage\(\)/);
  assert.ok(boot.indexOf("ensureFloatingSettingsButton()") < boot.indexOf("initializeChatTranscriptStorage()"));
  assert.match(source, /navigator\.storage\?\.persist/);
});

test("Rumble right-click direct messages open the self-hosted DizyChat origin", () => {
  assert.match(source, /const landingBaseURL = "https:\/\/dizychat\.com\/";/);
  assert.doesNotMatch(source, /dizychat-server\.onrender\.com/);
});
