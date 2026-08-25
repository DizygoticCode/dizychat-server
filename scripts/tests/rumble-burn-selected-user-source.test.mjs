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

test("selected-user auto replies have independent persisted controls", () => {
  assert.match(source, /autoBurnSelectedUsersEnabled:\s*false/);
  assert.match(source, /autoBurnSelectedUsers:\s*""/);
  assert.match(source, /id="autoBurnSelectedUsersToggle"/);
  assert.match(source, /Reply to selected users/);
  assert.match(source, /id="autoBurnSelectedUsersInput"/);
  assert.match(source, /settings\.autoBurnSelectedUsersEnabled\s*=\s*!!panel\.querySelector\("#autoBurnSelectedUsersToggle"\)\?\.checked/);
  assert.match(source, /settings\.autoBurnSelectedUsers\s*=\s*panel\.querySelector\("#autoBurnSelectedUsersInput"\)\?\.value/);
});

test("selected users are matched as exact case-insensitive Rumble usernames", () => {
  assert.match(source, /function matchesSelectedAutoBurnUser\(username\)/);
  const matcher = between("function matchesSelectedAutoBurnUser(username)", "function refreshBlockedMessages()");
  assert.match(matcher, /settings\.autoBurnSelectedUsers/);
  assert.match(matcher, /split\(","\)/);
  assert.match(matcher, /replace\(\/\^@\+\//);
  assert.match(matcher, /toLowerCase\(\)/);
  assert.match(matcher, /includes\(/);
});

test("selected-user trigger is independent from name-tag trigger but shares the guarded FIFO queue", () => {
  assert.match(source, /function automaticBurnTriggersEnabled\(\)/);
  const queue = between("async function maybeHandleAutoBurn(ctx)", "/***********************\n     * Core message refresh");
  assert.match(queue, /if \(!settings\.burnMasterEnabled \|\| !automaticBurnTriggersEnabled\(\)\) return;/);
  assert.match(queue, /if \(!settings\.burnMasterEnabled \|\| !automaticBurnTriggersEnabled\(\)\)/);

  const refresh = between("function refreshBlockedMessages()", "function initChatObserver(container)");
  assert.match(refresh, /settings\.autoBurnEnabled\s*&&\s*matchesAutoBurnTrigger\(plainOriginal, selfHandleLower\)/);
  assert.match(refresh, /settings\.autoBurnSelectedUsersEnabled\s*&&\s*matchesSelectedAutoBurnUser\(username\)/);
  assert.match(refresh, /nameTriggerMatched\s*\|\|\s*selectedUserTriggerMatched/);
  assert.match(refresh, /trigger:\s*nameTriggerMatched\s*\?\s*"name\/tag"\s*:\s*"selected-user"/);
  assert.match(refresh, /void maybeHandleAutoBurn\(/);
});

test("bot transcript metadata records why the automatic reply fired", () => {
  assert.match(source, /botTrigger/);
  assert.match(source, /trigger:\s*String\(meta\.trigger \|\| ""\)/);
  assert.match(source, /botTrigger:\s*pendingBurnEcho\.trigger/);
  assert.match(source, /"botTrigger"/);
});
