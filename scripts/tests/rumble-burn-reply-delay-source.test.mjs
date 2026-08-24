import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Source-contract regression for the Tampermonkey burn-delay controls and send ordering introduced in v1.9.6.
const sourcePath = new URL("../tampermonkey/dizygotic-rumble-chat-tool.user.js", import.meta.url);
const source = fs.readFileSync(sourcePath, "utf8");

function autoBurnFunctionSource() {
  const start = source.indexOf("async function maybeHandleAutoBurn(ctx)");
  const end = source.indexOf("/***********************\n     * Core message refresh", start);
  assert.ok(start >= 0, "maybeHandleAutoBurn must exist");
  assert.ok(end > start, "maybeHandleAutoBurn boundary must be discoverable");
  return source.slice(start, end);
}

test("burn reply delay remains bounded with a 5 second default", () => {
  assert.match(source, /autoBurnReplyDelaySeconds:\s*5/);
  assert.match(source, /id="autoBurnReplyDelayInput"[^>]*min="0"[^>]*max="120"[^>]*value="\$\{settings\.autoBurnReplyDelaySeconds\}"/);
  assert.match(source, /settings\.autoBurnReplyDelaySeconds\s*=\s*Number\.isFinite\(replyDelaySeconds\)[\s\S]*?Math\.max\(0, Math\.min\(120, replyDelaySeconds\)\)[\s\S]*?:\s*5;/);
});

test("auto-burn cooldown accepts the configured one-second minimum", () => {
  assert.match(source, /id="autoBurnCooldownInput" min="1"/);
  assert.match(source, /settings\.autoBurnCooldownSeconds\s*=\s*Math\.max\(1,/);
  const fn = autoBurnFunctionSource();
  assert.match(fn, /const cooldownMs = Math\.max\(1, settings\.autoBurnCooldownSeconds \|\| 45\) \* 1000;/);
});

test("auto-burn holds the in-flight lock while waiting and delays before send", () => {
  const fn = autoBurnFunctionSource();
  const lockIndex = fn.indexOf("burnSendInFlight = true;");
  const delayIndex = fn.indexOf("await new Promise((resolve) => setTimeout(resolve, replyDelayMs));");
  const sendIndex = fn.indexOf("await sendChatMessage(");

  assert.ok(lockIndex >= 0, "burn should be marked in-flight before the delay");
  assert.ok(delayIndex > lockIndex, "reply delay should happen after the in-flight lock is set");
  assert.ok(sendIndex > delayIndex, "reply delay should happen before sending the burn");
  assert.match(fn, /Math\.max\(0, Math\.min\(120, configuredReplyDelay\)\)/);
  assert.match(fn, /if \(!settings\.autoBurnEnabled\) \{[\s\S]*?cancelled: auto-burn disabled during reply delay[\s\S]*?return;/);
});
