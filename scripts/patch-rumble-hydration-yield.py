from pathlib import Path

source_path = Path("scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js")
source = source_path.read_text(encoding="utf-8")

old_call = "                backfillCuratedBurnsFromTranscript();"
new_call = "                await backfillCuratedBurnsFromTranscript();"
if source.count(old_call) != 1:
    raise SystemExit(f"expected exactly one hydrate backfill call, found {source.count(old_call)}")
source = source.replace(old_call, new_call, 1)

start_needle = "    function backfillCuratedBurnsFromTranscript() {"
end_needle = "    function clearCuratedBurns(options = {}) {"
start = source.find(start_needle)
end = source.find(end_needle, start + len(start_needle))
if start < 0 or end <= start:
    raise SystemExit(f"backfill boundaries not found: start={start}, end={end}")

new_backfill = """    async function backfillCuratedBurnsFromTranscript() {
        if (!settings.curatedBurnsEnabled || !chatLog.length) return;
        const lastProcessed = Number(curatedBurnStore.lastProcessedSeq) || 0;
        const pending = chatLog.filter((record) => (Number(record.seq) || 0) > lastProcessed);
        if (!pending.length) return;
        const touched = new Set();
        const yieldEvery = 250;
        for (let index = 0; index < pending.length; index += 1) {
            const record = pending[index];
            ingestCuratedRecord(record, { deferSave: true, deferCurate: true });
            if (record?.username) touched.add(String(record.username).toLowerCase());
            if ((index + 1) % yieldEvery === 0) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        }
        let finalized = 0;
        for (const username of touched) {
            const profile = curatedBurnStore.users[username];
            if (profile && profile.messageCount >= Math.max(3, Number(settings.curatedBurnMinMessages) || 8)) regenerateCuratedBurns(profile);
            finalized += 1;
            if (finalized % 50 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
        }
        saveCuratedBurnStore();
    }

"""
source = source[:start] + new_backfill + source[end:]

old_version = "// @version      1.12.6"
new_version = "// @version      1.12.7"
if source.count(old_version) != 1:
    raise SystemExit(f"expected userscript version 1.12.6 exactly once, found {source.count(old_version)}")
source = source.replace(old_version, new_version, 1)
source_path.write_text(source, encoding="utf-8")

version_path = Path("scripts/tests/rumble-userscript-version-source.test.mjs")
version_test = version_path.read_text(encoding="utf-8")
if "v1.12.6 with intelligent bounded Burn Bot memory" not in version_test:
    raise SystemExit("expected v1.12.6 version-test title")
if "1\\.12\\.6" not in version_test:
    raise SystemExit("expected v1.12.6 version-test regex")
version_test = version_test.replace(
    "v1.12.6 with intelligent bounded Burn Bot memory",
    "v1.12.7 with cooperative transcript hydration",
    1,
)
version_test = version_test.replace("1\\.12\\.6", "1\\.12\\.7", 1)
version_path.write_text(version_test, encoding="utf-8")
