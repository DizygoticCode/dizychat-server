import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Source-contract regression for the unbounded IndexedDB transcript storage introduced in v1.9.7.
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

test("legacy localStorage transcript migrates during lightweight storage readiness before the old key is removed", () => {
  const prepare = between("async function prepareChatTranscriptStorage()", "async function initializeChatTranscriptStorage()");
  const hydrate = between("async function initializeChatTranscriptStorage()", "let chatLogSaveTimer = null;");
  assert.match(prepare, /legacyChatLog/);
  assert.match(prepare, /await putChatRecords\(db, legacyChatLog\)/);
  assert.match(prepare, /await readLatestChatSequence\(db\)/);
  assert.match(prepare, /localStorage\.removeItem\(CHAT_LOG_KEY\)/);
  assert.doesNotMatch(prepare, /readAllChatRecords\(db\)/);
  assert.match(hydrate, /await readAllChatRecords\(db\)/);
  assert.ok(prepare.indexOf("await putChatRecords(db, legacyChatLog)") < prepare.indexOf("localStorage.removeItem(CHAT_LOG_KEY)"));
});

test("large transcript boot avoids spreading the full history into Math.max", () => {
  const init = between("async function initializeChatTranscriptStorage()", "function extractMentions(text)");
  assert.doesNotMatch(init, /Math\.max\(\.\.\.chatLog\.map/);
  assert.match(init, /chatLog\.reduce\(/);
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

test("boot prepares IndexedDB sequence state without hydrating history and panel opens hydration", () => {
  assert.match(source, /id="chatStorageStatus"/);
  assert.match(source, /chatStorageSummaryText\(\)/);
  const boot = between("async function boot()", "if (document.readyState");
  const panel = between("function showSettingsPanel()", "function ensureFloatingSettingsButton()");
  assert.match(boot, /await prepareChatTranscriptStorage\(\);/);
  assert.doesNotMatch(boot, /initializeChatTranscriptStorage\(\)/);
  assert.match(panel, /initializeChatTranscriptStorage\(\)/);
  assert.match(source, /navigator\.storage\?\.persist/);
});
