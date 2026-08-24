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

test("Burn Bot has a persisted master switch above automatic triggers", () => {
  assert.match(source, /burnMasterEnabled:\s*true/);
  assert.match(source, /id="burnMasterToggle"[^>]*\$\{settings\.burnMasterEnabled \? " checked" : ""\}/);
  assert.match(source, /Burn Bot enabled/);
  assert.match(source, /settings\.burnMasterEnabled\s*=\s*!!panel\.querySelector\("#burnMasterToggle"\)\?\.checked/);
});

test("master-off clears queued burns and blocks generation and sending while Curated learning remains independent", () => {
  assert.match(source, /function setBurnMasterEnabled\(enabled/);
  const setter = between("function setBurnMasterEnabled(enabled", "function generateBurnResponse(ctx)");
  assert.match(setter, /burnTagQueue\.length\s*=\s*0/);
  assert.match(setter, /pendingCuratedBurnSelection\s*=\s*null/);
  assert.doesNotMatch(setter, /curatedBurnsEnabled\s*=\s*false/);

  const generate = between("function generateBurnResponse(ctx)", "async function maybeHandleAutoBurn(ctx)");
  assert.match(generate, /if \(!settings\.burnMasterEnabled\) return null;/);

  const queue = between("async function maybeHandleAutoBurn(ctx)", "/***********************\n     * Core message refresh");
  assert.match(queue, /if \(!settings\.burnMasterEnabled \|\| !settings\.autoBurnEnabled\) return;/);
  assert.match(queue, /if \(!settings\.burnMasterEnabled \|\| !settings\.autoBurnEnabled\)/);
  assert.match(queue, /burnTagQueue\.length\s*=\s*0/);
});

test("name aliases are configurable and default to Dizy and Dizygotic", () => {
  assert.match(source, /autoBurnNameAliases:\s*"Dizy,Dizygotic"/);
  assert.match(source, /id="autoBurnNameAliasesInput"[^>]*value="\$\{String\(settings\.autoBurnNameAliases/);
  assert.match(source, /Name aliases/);
  assert.match(source, /settings\.autoBurnNameAliases\s*=\s*panel\.querySelector\("#autoBurnNameAliasesInput"\)\?\.value/);
});

test("aliases use the same automatic burn queue with case-insensitive whole-token matching", () => {
  assert.match(source, /function matchesAutoBurnTrigger\(text, selfHandleLower\)/);
  const matcher = between("function matchesAutoBurnTrigger(text, selfHandleLower)", "function refreshBlockedMessages()");
  assert.match(matcher, /settings\.autoBurnNameAliases/);
  assert.match(matcher, /split\(","\)/);
  assert.match(matcher, /new RegExp\(/);
  assert.match(matcher, /\[\^A-Za-z0-9_\]/);
  assert.match(matcher, /"i"/);

  assert.match(source, /function refreshBlockedMessages\(\)[\s\S]*?matchesAutoBurnTrigger\(plainOriginal, selfHandleLower\)[\s\S]*?void maybeHandleAutoBurn\(/);
});

test("master toggle applies immediately and clears queued replies when turned off", () => {
  assert.match(source, /const burnMasterToggle = panel\.querySelector\("#burnMasterToggle"\)/);
  assert.match(source, /burnMasterToggle\.addEventListener\("change"/);
  assert.match(source, /setBurnMasterEnabled\(!!burnMasterToggle\.checked/);
});
