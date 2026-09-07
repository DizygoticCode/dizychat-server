from pathlib import Path

script_path = Path("scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js")
version_test_path = Path("scripts/tests/rumble-userscript-version-source.test.mjs")

source = script_path.read_text()

old_globals = """    let pendingChatWrites = [];
    let curatedBackfillInProgress = false;
    let pendingLiveCuratedRecords = [];
"""
new_globals = """    let pendingChatWrites = [];
    let curatedBackfillInProgress = false;
    let curatedBackfillPromise = null;
    let pendingLiveCuratedRecords = [];
"""
if old_globals not in source:
    raise SystemExit("expected curated backfill globals not found")
source = source.replace(old_globals, new_globals, 1)

old_backfill = """    async function backfillCuratedBurnsFromTranscript() {
        if (!settings.curatedBurnsEnabled || !chatLog.length) return;
        const lastProcessed = Number(curatedBurnStore.lastProcessedSeq) || 0;
        const pending = chatLog.filter((record) => (Number(record.seq) || 0) > lastProcessed);
        const touched = new Set();
        const yieldEvery = 250;
        curatedBackfillInProgress = true;
        try {
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
            if (pending.length) saveCuratedBurnStore();

            const queuedLiveRecords = pendingLiveCuratedRecords.splice(0);
            queuedLiveRecords.sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0));
            queuedLiveRecords.forEach((record) => ingestCuratedRecord(record));
        } finally {
            curatedBackfillInProgress = false;
        }
    }
"""
new_backfill = """    async function backfillCuratedBurnsFromTranscript() {
        if (!settings.curatedBurnsEnabled || !chatLog.length) return;
        if (curatedBackfillPromise) return curatedBackfillPromise;

        curatedBackfillPromise = (async () => {
            const yieldEvery = 250;
            curatedBackfillInProgress = true;
            try {
                while (settings.curatedBurnsEnabled) {
                    const lastProcessed = Number(curatedBurnStore.lastProcessedSeq) || 0;
                    const pending = chatLog.filter((record) => (Number(record.seq) || 0) > lastProcessed);
                    if (!pending.length) break;

                    const touched = new Set();
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

                const queuedLiveRecords = pendingLiveCuratedRecords.splice(0);
                queuedLiveRecords.sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0));
                queuedLiveRecords.forEach((record) => ingestCuratedRecord(record));
            } finally {
                curatedBackfillInProgress = false;
            }
        })();

        try {
            return await curatedBackfillPromise;
        } finally {
            curatedBackfillPromise = null;
        }
    }
"""
if old_backfill not in source:
    raise SystemExit("expected curated backfill function not found")
source = source.replace(old_backfill, new_backfill, 1)
source = source.replace("// @version      1.12.8", "// @version      1.12.9", 1)
script_path.write_text(source)

version_test = version_test_path.read_text()
version_test = version_test.replace(
    'test("Tampermonkey metadata advertises v1.12.8 with serialized cooperative transcript hydration", () => {',
    'test("Tampermonkey metadata advertises v1.12.9 with single-flight cooperative transcript hydration", () => {'
)
version_test = version_test.replace(r'/^\\/\\/ @version\\s+1\\.12\\.8$/m', r'/^\\/\\/ @version\\s+1\\.12\\.9$/m')
version_test_path.write_text(version_test)
