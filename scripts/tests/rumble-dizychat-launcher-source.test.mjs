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

test("right-click DizyChat launcher uses the current production login URL", () => {
  const dm = between("function openDirectMessage(targetDisplayName)", "function attachContextMenuToUser(usernameEl)");
  assert.match(dm, /const landingBaseURL = "https:\/\/dizychat\.com\/login\.html";/);
  assert.doesNotMatch(dm, /dizychat-server\.onrender\.com/);
});

test("right-click DizyChat launcher prefills detected self username and clicked user room", () => {
  const dm = between("function openDirectMessage(targetDisplayName)", "function attachContextMenuToUser(usernameEl)");
  assert.match(dm, /params\.set\("username", resolvedNickname\)/);
  assert.match(dm, /params\.set\("room", target\)/);
  assert.doesNotMatch(dm, /params\.set\("invite"/);
});

test("context menu passes the clicked canonical Rumble username into the DizyChat launcher", () => {
  const context = between("function attachContextMenuToUser(usernameEl)", "/***********************\n     * Wire up everything");
  assert.match(context, /openDirectMessage\(username \|\| displayName\)/);
});
