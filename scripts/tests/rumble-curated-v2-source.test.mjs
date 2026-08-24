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

function quotedStringCount(block) {
  return [...block.matchAll(/`(?:\\.|[^`])*`|"(?:\\.|[^"])*"/g)].length;
}

test("v1.10+ ships a bounded structured Curated seed bank", () => {
  assert.match(source, /\/\/ @version\s+1\.(?:10|11)\.\d+/);
  assert.match(source, /const CURATED_BURNS_SCHEMA = 2;/);
  const bank = between("const CURATED_SEED_BLUEPRINTS = Object.freeze({", "const CURATED_SEED_TEMPLATE_COUNT");
  const required = [
    "weak_comeback", "bad_argument", "overconfidence", "repetition", "contradiction",
    "moving_goalposts", "no_evidence", "too_much_talking", "failed_roast", "tag_pressure",
    "self_own", "topic_dodge", "finisher", "british_banter", "generic_savage"
  ];
  required.forEach((category) => assert.match(bank, new RegExp(`\\b${category}:\\s*\\{`)));

  const categoryPattern = /\b([a-z_]+):\s*\{\s*baseScore:\s*\d+,\s*openers:\s*\[([\s\S]*?)\],\s*closers:\s*\[([\s\S]*?)\]\s*\}/g;
  const categories = [...bank.matchAll(categoryPattern)];
  assert.equal(categories.length, required.length, "all seed categories should use the tested blueprint shape");
  const combinations = categories.reduce((sum, match) => sum + quotedStringCount(match[2]) * quotedStringCount(match[3]), 0);
  assert.ok(combinations >= 300, `expected at least 300 seed combinations, got ${combinations}`);
  assert.ok(combinations <= 520, `expected at most 520 seed combinations, got ${combinations}`);
  assert.match(source, /CURATED_SEED_TEMPLATE_COUNT\s*=\s*Object\.values\(CURATED_SEED_BLUEPRINTS\)/);
});

test("seed material is behavior-focused and excludes obvious identity/personal attack fuel", () => {
  const bank = between("const CURATED_SEED_BLUEPRINTS = Object.freeze({", "const CURATED_SEED_TEMPLATE_COUNT");
  assert.doesNotMatch(bank, /\b(?:race|racial|ethnic|religion|muslim|christian|jewish|hindu|sikh|gay|lesbian|bisexual|transgender|autism|autistic|disabled|disability|pregnant|cancer|hiv|address|postcode|phone|email|mother|mom|mum|father|dad|ugly|fat|skinny)\b/i);
  assert.match(source, /const CURATED_SEED_BLOCKED_PATTERN =/);
  assert.match(source, /function isSafeCuratedSeedTemplate\(text\)/);
});

test("Curated classifies live context into relevant roast families", () => {
  const classify = between("function classifyCuratedContext(ctx, profile)", "function buildSeededCuratedCandidates(");
  [
    "repetition", "contradiction", "moving_goalposts", "no_evidence", "overconfidence",
    "too_much_talking", "failed_roast", "tag_pressure", "self_own", "topic_dodge", "weak_comeback",
    "finisher", "british_banter"
  ].forEach((category) => assert.match(classify, new RegExp(`['\"]${category}['\"]`)));
  assert.match(classify, /tagCount/);
  assert.match(classify, /repeatStat/);
  assert.match(classify, /message\.length|currentText\.length/);
});

test("history outranks seeded material, while seeds work without a ready profile", () => {
  assert.match(source, /const CURATED_HISTORY_RANKS = Object\.freeze\(/);
  assert.match(source, /repeat:\s*5\d/);
  assert.match(source, /contradiction:\s*4\d/);
  const select = between("function selectCuratedBurn(ctx)", "function markCuratedBurnUsed(selection)");
  assert.match(select, /const profileReady =/);
  assert.match(select, /buildSeededCuratedCandidates\(/);
  assert.match(select, /ranked\.push\(\.\.\.seeded\)/);
  assert.doesNotMatch(select, /if \(!profile \|\|[^\n]*messageCount[^\n]*\) return null;/);
  assert.match(select, /pendingCuratedBurnSelection = \{[\s\S]*?kind:/);
});

test("seed novelty penalizes exact repeats and recently used families", () => {
  const seeded = between("function buildSeededCuratedCandidates(", "function buildCuratedCandidates(profile)");
  assert.match(seeded, /seedUsage/);
  assert.match(seeded, /recentSeedIds/);
  assert.match(seeded, /recentSeedFamilies/);
  assert.match(seeded, /timesUsed/);
  assert.match(seeded, /lastUsedAt/);

  const mark = between("function markCuratedBurnUsed(selection)", "/***********************\n     * Export / Import / Backup");
  assert.match(mark, /selection\.kind === "seed"/);
  assert.match(mark, /curatedBurnStore\.seedUsage/);
  assert.match(mark, /recentSeedIds/);
  assert.match(mark, /recentSeedFamilies/);
});

test("Curated v2 persists and prunes seed usage metadata", () => {
  const normalize = between("function normalizeCuratedStore(value)", "curatedBurnStore = normalizeCuratedStore(curatedBurnStore);");
  assert.match(normalize, /seedUsage/);
  assert.match(normalize, /recentSeedIds/);
  assert.match(normalize, /recentSeedFamilies/);
  const prune = between("function pruneCuratedStore()", "function saveCuratedBurnStore()");
  assert.match(prune, /seedUsage/);
  assert.match(prune, /recentSeedIds/);
  assert.match(prune, /recentSeedFamilies/);
});

test("transcript metadata identifies Curated strategy and context for later analysis", () => {
  assert.match(source, /botStrategy/);
  assert.match(source, /botContext/);
  assert.match(source, /strategy:\s*String\(meta\.strategy/);
  assert.match(source, /context:\s*String\(meta\.context/);
});

test("panel reports the Curated seed-bank size", () => {
  assert.match(source, /CURATED_SEED_TEMPLATE_COUNT\.toLocaleString\(\)/);
  assert.match(source, /seed combinations/);
});

test("Curated memory limits scale from the settings panel instead of hard-coded ceilings", () => {
  assert.match(source, /curatedBurnMaxPerUser:\s*60,/);
  assert.match(source, /curatedBurnMaxUsers:\s*0,/);
  assert.doesNotMatch(source, /const CURATED_MAX_USERS = 300;/);
  assert.match(source, /id="curatedBurnMaxPerUserInput" min="3" value=/);
  assert.doesNotMatch(source, /id="curatedBurnMaxPerUserInput"[^>]*max="40"/);
  assert.match(source, /id="curatedBurnMaxUsersInput" min="0" value=/);
  const prune = between("function pruneCuratedStore()", "function saveCuratedBurnStore()");
  assert.match(prune, /const maxUsers = Math\.max\(0,/);
  assert.match(prune, /if \(maxUsers > 0 && users\.length > maxUsers\)/);
});

test("Curated rebuild is single-flight, yields to the UI, and reports progress", () => {
  assert.match(source, /let curatedRebuildPromise = null;/);
  assert.match(source, /let curatedRebuildProgress =/);
  const rebuild = between("async function rebuildCuratedBurnsFromTranscript(reset = true)", "function backfillCuratedBurnsFromTranscript()");
  assert.match(rebuild, /if \(curatedRebuildPromise\) return curatedRebuildPromise;/);
  assert.match(rebuild, /curatedRebuildProgress\.processed/);
  assert.match(rebuild, /setTimeout\(resolve, 0\)/);
  assert.match(source, /Rebuilding curated memory/);
  assert.match(source, /rebuildCuratedBtn\.disabled = true/);
  assert.match(source, /rebuildCuratedBtn\.disabled = false/);
});
