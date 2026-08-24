import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const sourcePath = new URL("../tampermonkey/dizygotic-rumble-chat-tool.user.js", import.meta.url);
const source = fs.readFileSync(sourcePath, "utf8");

test("Tampermonkey metadata advertises v1.12.1 with scalable Curated memory and Burn Bot controls", () => {
  assert.match(source, /^\/\/ @version\s+1\.12\.1$/m);
  assert.match(source, /curatedBurnMaxPerUser:\s*60,/);
  assert.match(source, /curatedBurnMaxUsers:\s*0,/);
  assert.match(source, /burnMasterEnabled:\s*true,/);
  assert.match(source, /autoBurnNameAliases:\s*"Dizy,Dizygotic",/);
  assert.doesNotMatch(source, /const CURATED_MAX_USERS = 300;/);
});
