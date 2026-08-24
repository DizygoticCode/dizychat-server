import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Trigger the read-only PR verifier after its workflow exists on main.
const sourcePath = new URL("../tampermonkey/dizygotic-rumble-chat-tool.user.js", import.meta.url);
const source = fs.readFileSync(sourcePath, "utf8");

function between(startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0, `missing start boundary: ${startNeedle}`);
  assert.ok(end > start, `missing end boundary: ${endNeedle}`);
  return source.slice(start, end);
}

test("v1.10.1 adds a hard account-protection subject and threat firewall", () => {
  assert.match(source, /\/\/ @version\s+1\.10\.1/);
  assert.match(source, /const BURN_ACCOUNT_PROTECTION_PATTERN =/);
  assert.match(source, /jews\?|jewish/);
  assert.match(source, /military/);
  assert.match(source, /army/);
  assert.match(source, /navy/);
  assert.match(source, /marines/);
  assert.match(source, /air\\s\*force|air\\s\+force/);
  assert.match(source, /kill/);
  assert.match(source, /death|dead|die/);
  assert.match(source, /murder/);
  assert.match(source, /shoot/);
  assert.match(source, /const BURN_DIRECT_THREAT_PATTERN =/);
  assert.match(source, /function isBlockedBurnSubject\(text\)/);
});

test("risky incoming material is not learned or quoted", () => {
  const curatable = between("function isCuratableMessage(text)", "function curatedWords(text)");
  assert.match(curatable, /isBlockedBurnSubject\(raw\)/);

  const quote = between("function safeBurnQuote(text, maxLength = 72)", "function noteBurnPressure(username)");
  assert.match(quote, /isBlockedBurnSubject\(raw\)/);
});

test("every generated burn passes the final outbound account-protection firewall", () => {
  const clean = between("function cleanGeneratedBurn(text, target)", "function burnResponseKey(text)");
  assert.match(clean, /isBlockedBurnSubject\(candidate\)/);
  assert.match(clean, /BURN_DIRECT_THREAT_PATTERN\.test\(candidate\)/);

  const generate = between("function generateBurnResponse(ctx)", "async function maybeHandleAutoBurn(ctx)");
  assert.match(generate, /cleanGeneratedBurn\(result, normalizedCtx\.target\)/);
});

test("history candidates need live-message relevance before they can outrank seeds", () => {
  assert.match(source, /function curatedHistoryRelevance\(burn, currentTokens, currentText\)/);
  const select = between("function selectCuratedBurn(ctx)", "function markCuratedBurnUsed(selection)");
  assert.match(select, /curatedHistoryRelevance\(burn, currentTokens, currentText\)/);
  assert.match(select, /relevance > 0/);
  assert.match(select, /overlapCount\(currentTokens, burn\.keywords \|\| \[\]\)/);
});

test("risky incoming tags bypass history and quote-backs but can use safe unrelated seeds", () => {
  const select = between("function selectCuratedBurn(ctx)", "function markCuratedBurnUsed(selection)");
  assert.match(select, /const incomingBlocked = isBlockedBurnSubject\(ctx\.message \|\| ""\)/);
  assert.match(select, /const profileReady = !incomingBlocked/);
  assert.match(select, /const quote = incomingBlocked \? "" : safeBurnQuote/);
  assert.match(select, /incomingBlocked[\s\S]*generic_savage/);
});

test("live repeat and contradiction evidence stay above relevant history and seeds", () => {
  const select = between("function selectCuratedBurn(ctx)", "function markCuratedBurnUsed(selection)");
  assert.match(select, /rank:\s*7\d\s*\+\s*Math\.min\(10, statCount\(repeatStat\)\)/);
  assert.match(select, /context:\s*"contradiction"[\s\S]*rank:\s*6\d/);
});

test("Curated adds a profanity-allowed finisher family without putting profanity on the blocklist", () => {
  const bank = between("const CURATED_SEED_BLUEPRINTS = Object.freeze({", "const CURATED_SEED_TEMPLATE_COUNT");
  assert.match(bank, /\bfinisher:\s*\{/);
  assert.match(bank, /\bfuck(?:ed|ing)?\b|\bshit\b/i);
  const firewall = between("const BURN_ACCOUNT_PROTECTION_PATTERN =", "const CURATED_SEED_BLUEPRINTS = Object.freeze({");
  assert.doesNotMatch(firewall, /\bfuck\b|\bshit\b|\bcunt\b/i);
  const classify = between("function classifyCuratedContext(ctx, profile)", "function buildSeededCuratedCandidates(");
  assert.match(classify, /bump\("finisher"/);
});

test("Curated ships a British DIZY banter family and rotates local insults", () => {
  const bank = between("const CURATED_SEED_BLUEPRINTS = Object.freeze({", "const CURATED_SEED_TEMPLATE_COUNT");
  assert.match(bank, /\bbritish_banter:\s*\{/);
  for (const phrase of ["sod off", "wanker", "bellend", "muppet", "numpty", "pillock", "tosser", "git", "knobhead", "well bang out", "bang out of order"]) {
    assert.match(bank.toLowerCase(), new RegExp(phrase.replaceAll(" ", "\\s+")));
  }
  const classify = between("function classifyCuratedContext(ctx, profile)", "function buildSeededCuratedCandidates(");
  assert.match(classify, /bump\("british_banter"/);
  assert.match(source, /recentSeedFamilies/);
});
