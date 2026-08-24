import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Source-contract regression for the Tampermonkey burn-delay controls and send ordering introduced in v1.9.6.
const sourcePath = new URL("../tampermonkey/dizygotic-rumble-chat-tool.user.js", import.meta.url);
const source = fs.readFileSync(sourcePath, "utf8");

function autoBurnBlockSource() {
  const start = source.indexOf("async function maybeHandleAutoBurn(ctx)");
  const end = source.indexOf("/***********************\n     * Core message refresh", start);
  assert.ok(start >= 0, "maybeHandleAutoBurn must exist");
  assert.ok(end > start, "auto-burn boundary must be discoverable");
  return source.slice(start, end);
}

test("burn reply delay remains bounded with a 5 second default", () => {
  assert.match(source, /autoBurnReplyDelaySeconds:\s*5/);
  assert.match(source, /id="autoBurnReplyDelayInput"[^>]*min="0"[^>]*max="120"[^>]*value="\$\{settings\.autoBurnReplyDelaySeconds\}"/);
  assert.match(source, /settings\.autoBurnReplyDelaySeconds\s*=\s*Number\.isFinite\(replyDelaySeconds\)[\s\S]*?Math\.max\(0, Math\.min\(120, replyDelaySeconds\)\)[\s\S]*?:\s*5;/);
});

test("auto-burn cooldown accepts zero so every queued tag can be processed", () => {
  assert.match(source, /id="autoBurnCooldownInput" min="0"/);
  assert.match(source, /settings\.autoBurnCooldownSeconds\s*=\s*Math\.max\(0,/);
  const block = autoBurnBlockSource();
  assert.match(block, /Math\.max\(0,/);
  assert.doesNotMatch(block, /Math\.max\(5, settings\.autoBurnCooldownSeconds/);
});

test("tags received during the reply delay are queued instead of dropped", () => {
  const block = autoBurnBlockSource();
  assert.match(source, /const burnTagQueue = \[\];/);
  assert.match(source, /let burnQueueDrainPromise = null;/);
  assert.match(block, /burnTagQueue\.push\(/);
  assert.match(block, /if \(!burnQueueDrainPromise\)/);
  assert.doesNotMatch(block, /if \(!settings\.autoBurnEnabled \|\| burnSendInFlight\) return;/);
  assert.match(source, /queued:/);
});

test("the queue drains serially and keeps the configured reply delay between tag replies", () => {
  const block = autoBurnBlockSource();
  assert.match(block, /while \(burnTagQueue\.length\)/);
  assert.match(block, /await processQueuedAutoBurn\(/);
  assert.match(block, /await new Promise\(\(resolve\) => setTimeout\(resolve, replyDelayMs\)\);/);
  assert.match(block, /await sendChatMessage\(/);
  assert.match(block, /Math\.max\(0, Math\.min\(120, configuredReplyDelay\)\)/);
  assert.match(block, /if \(!settings\.autoBurnEnabled\)/);
});
