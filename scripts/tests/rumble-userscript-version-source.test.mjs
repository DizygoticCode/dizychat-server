import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const sourcePath = new URL("../tampermonkey/dizygotic-rumble-chat-tool.user.js", import.meta.url);
const source = fs.readFileSync(sourcePath, "utf8");

test("Tampermonkey metadata advertises v1.11.2 for scalable Curated memory", () => {
  assert.match(source, /^\/\/ @version\s+1\.11\.2$/m);
  assert.match(source, /curatedBurnMaxPerUser:\s*60,/);
  assert.match(source, /curatedBurnMaxUsers:\s*0,/);
  assert.doesNotMatch(source, /const CURATED_MAX_USERS = 300;/);
});
