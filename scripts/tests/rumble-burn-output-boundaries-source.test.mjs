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

test("quote-backs are gated to a deterministic minority of eligible burns", () => {
  assert.match(source, /const BURN_QUOTE_BUCKETS = 5;/);
  assert.match(source, /function shouldUseBurnQuote\(ctx, source = "curated"\)/);
  const quoteGate = between("function shouldUseBurnQuote(ctx, source = \"curated\")", "function noteBurnPressure(username)");
  assert.match(quoteGate, /simpleCuratedHash/);
  assert.match(quoteGate, /% BURN_QUOTE_BUCKETS === 0/);

  const retrieval = between("function buildBurnMemoryContext(ctx, profile)", "function chooseBurnMemoryAngle(memoryContext)");
  assert.match(retrieval, /shouldUseBurnQuote\(ctx, "curated"\)/);
  assert.match(retrieval, /safeBurnQuote\(ctx\.message \|\| ""\)/);

  const generate = between("function generateBurnResponse(ctx)", "async function maybeHandleAutoBurn(ctx)");
  assert.match(generate, /shouldUseBurnQuote\(normalizedCtx, "compromise"\)/);
  assert.match(generate, /shouldUseBurnQuote\(normalizedCtx, "rita"\)/);
});

test("DRILL SARGE preserves the full sanitized username", () => {
  const drill = between("function drillPrivateName(target)", "const drillSargeBurns = [");
  assert.match(drill, /return \(clean \|\| "RECRUIT"\)\.toUpperCase\(\);/);
  assert.doesNotMatch(drill, /withoutDigits/);
  assert.doesNotMatch(drill, /slice\(0,\s*18\)/);
});

test("Burn Bot output is bounded to one 200-character Rumble message while preserving the mention", () => {
  assert.match(source, /const RUMBLE_CHAT_MESSAGE_LIMIT = 200;/);
  assert.match(source, /function clampBurnMessageForRumble\(message, target, maxLength = RUMBLE_CHAT_MESSAGE_LIMIT\)/);
  const clamp = between("function clampBurnMessageForRumble(message, target, maxLength = RUMBLE_CHAT_MESSAGE_LIMIT)", "function burnResponseKey(text)");
  assert.match(clamp, /const mention = `@\$\{safeTarget\}`;/);
  assert.match(clamp, /Array\.from/);
  assert.match(clamp, /…/);

  const clean = between("function cleanGeneratedBurn(text, target)", "function burnResponseKey(text)");
  assert.match(clean, /clampBurnMessageForRumble\(candidate, target\)/);

  const send = between("async function sendChatMessage(message, meta = {})", "function generateBurnResponse(ctx)");
  assert.match(send, /const outboundMessage = isBurn\s*\?\s*clampBurnMessageForRumble\(message, meta\.target \|\| ""\)\s*:\s*message;/);
  assert.match(send, /setOutgoingComposerValue\(composer, outboundMessage\)/);
  assert.match(send, /rememberPendingBurnEcho\(outboundMessage, formatted, meta\)/);
});
