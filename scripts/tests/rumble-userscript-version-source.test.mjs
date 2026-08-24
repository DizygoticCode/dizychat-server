import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const sourcePath = new URL("../tampermonkey/dizygotic-rumble-chat-tool.user.js", import.meta.url);
const source = fs.readFileSync(sourcePath, "utf8");

test("Tampermonkey metadata advertises v1.11.1 for the 300-profile release", () => {
  assert.match(source, /^\/\/ @version\s+1\.11\.1$/m);
  assert.match(source, /const CURATED_MAX_USERS = 300;/);
});
