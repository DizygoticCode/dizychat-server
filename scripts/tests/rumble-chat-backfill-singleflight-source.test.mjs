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

test("curated transcript backfill is single-flight and rechecks history after cooperative yields", () => {
  const backfill = between("async function backfillCuratedBurnsFromTranscript()", "function clearCuratedBurns(options = {})");
  assert.match(source, /let curatedBackfillPromise = null;/);
  assert.match(backfill, /if \(curatedBackfillPromise\) return curatedBackfillPromise;/);
  assert.match(backfill, /curatedBackfillPromise = \(async \(\) => \{/);
  assert.match(backfill, /while \(settings\.curatedBurnsEnabled\)/);
  assert.match(backfill, /const lastProcessed = Number\(curatedBurnStore\.lastProcessedSeq\) \|\| 0;/);
  assert.match(backfill, /const pending = chatLog\.filter\(\(record\) => \(Number\(record\.seq\) \|\| 0\) > lastProcessed\)/);
  assert.match(backfill, /if \(!pending\.length\) break;/);
  assert.match(backfill, /finally[\s\S]*?curatedBackfillPromise = null;/);
});
