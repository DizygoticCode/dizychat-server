import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// v1.12.4 memory-intelligence regression suite.
const sourcePath = new URL("../tampermonkey/dizygotic-rumble-chat-tool.user.js", import.meta.url);
const source = fs.readFileSync(sourcePath, "utf8");

function between(startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0, `missing start boundary: ${startNeedle}`);
  assert.ok(end > start, `missing end boundary: ${endNeedle}`);
  return source.slice(start, end);
}

test("Curated memory has explicit safe retrieval, one-angle selection, composition and novelty stages", () => {
  assert.match(source, /function buildBurnMemoryContext\(ctx, profile\)/);
  assert.match(source, /function chooseBurnMemoryAngle\(memoryContext\)/);
  assert.match(source, /function composeMemoryBurn\(memoryContext, angle/);
  assert.match(source, /function memoryBurnFingerprint\(text\)/);
  assert.match(source, /function isNovelMemoryBurn\(candidate, angle/);
  assert.match(source, /function rememberMemoryBurn\(candidate, angle/);

  const select = between("function selectCuratedBurnWithOptions(ctx, options = {})", "function markCuratedBurnUsed(selection)");
  const retrievalIndex = select.indexOf("buildBurnMemoryContext(");
  const angleIndex = select.indexOf("chooseBurnMemoryAngle(");
  const composeIndex = select.indexOf("composeMemoryBurn(");
  const noveltyIndex = select.indexOf("isNovelMemoryBurn(");
  assert.ok(retrievalIndex >= 0 && angleIndex > retrievalIndex && composeIndex > angleIndex && noveltyIndex > composeIndex,
    "Curated selection must flow retrieval -> angle -> composition -> novelty");
});

test("memory retrieval is bounded and rechecks safety before historical evidence is selectable", () => {
  const retrieval = between("function buildBurnMemoryContext(ctx, profile)", "function chooseBurnMemoryAngle(memoryContext)");
  assert.match(retrieval, /isCuratableMessage\(/);
  assert.match(retrieval, /isBlockedBurnSubject\(/);
  assert.match(retrieval, /evidence/);
  assert.match(retrieval, /\.slice\(0,\s*(?:6|8|10)\)/);
  assert.doesNotMatch(retrieval, /chatLog\.(?:filter|map|forEach)|readAllChatRecords|openChatTranscriptDb/,
    "hot-path retrieval must use curated indexes, not rescan the raw transcript");
});

test("angle chooser selects one primary angle and penalizes recently reused angles and families", () => {
  const chooser = between("function chooseBurnMemoryAngle(memoryContext)", "function composeMemoryBurn(memoryContext, angle");
  for (const angle of ["contradiction_callback", "repeat_callback", "brag_deflation", "attack_reversal", "bait_deflection", "generic_banter"]) {
    assert.match(chooser, new RegExp(angle));
  }
  assert.match(chooser, /recentAngleIds/);
  assert.match(chooser, /recentMemoryFamilies/);
  assert.match(chooser, /sort\(/);
  assert.doesNotMatch(chooser, /angles\.slice\(0,\s*[2-9]/,
    "one reply must not stack multiple selected angles");
});

test("novelty metadata is additive, compact and bounded without copying source messages", () => {
  const normalize = between("function normalizeCuratedStore(value)", "curatedBurnStore = normalizeCuratedStore(curatedBurnStore);");
  for (const field of ["recentResponseFingerprints", "recentAngleIds", "recentMemoryFamilies", "noveltyRerolls", "lastMemoryDiagnostic"]) {
    assert.match(normalize, new RegExp(field));
  }
  const prune = between("function pruneCuratedStore()", "function saveCuratedBurnStore()");
  assert.match(prune, /recentResponseFingerprints/);
  assert.match(prune, /recentAngleIds/);
  assert.match(prune, /recentMemoryFamilies/);

  const novelty = between("function memoryBurnFingerprint(text)", "function selectCuratedBurn(ctx)");
  assert.match(novelty, /simpleCuratedHash/);
  assert.match(novelty, /recentResponseFingerprints/);
  assert.match(source, /curatedBurnStore\.noveltyRerolls/);
  assert.doesNotMatch(novelty, /sourceMessage|rawHtml|chatLog/);
});

test("custom generator receives only structured bounded safe memory context and keeps legacy first argument", () => {
  const generate = between("function generateBurnResponse(ctx)", "async function maybeHandleAutoBurn(ctx)");
  assert.match(generate, /customMemoryContext/);
  assert.match(generate, /custom\(normalizedCtx,\s*customMemoryContext\)/);
  assert.match(generate, /angle/);
  assert.match(generate, /evidence/);
  assert.doesNotMatch(generate, /custom\([^\n]*(?:chatLog|curatedBurnStore\.users|profile)/,
    "custom generator must never receive raw transcript/profile state");
});

test("Curated panel exposes compact memory diagnostics without adding a second settings surface", () => {
  assert.match(source, /lastMemoryDiagnostic/);
  assert.match(source, /noveltyRerolls/);
  assert.match(source, /id="curatedBurnMemoryDiagnostic"/);
  assert.equal((source.match(/<b>Curated burn memory<\/b>/g) || []).length, 1);
});

test("existing final safety/output boundaries remain downstream of generated memory burns", () => {
  assert.match(source, /cleanGeneratedBurn\(/);
  assert.match(source, /clampBurnMessageForRumble\(/);
  assert.match(source, /BURN_DIRECT_THREAT_PATTERN/);
  assert.match(source, /isBlockedBurnSubject\(/);
});
