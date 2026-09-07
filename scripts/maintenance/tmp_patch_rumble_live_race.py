from pathlib import Path

script_path = Path('scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js')
text = script_path.read_text()

old_version = '// @version      1.12.7'
if text.count(old_version) != 1:
    raise SystemExit(f'expected v1.12.7 once, found {text.count(old_version)}')
text = text.replace(old_version, '// @version      1.12.8', 1)

old_state = '    let pendingChatWrites = [];\n    let curatedBurnStore = (() => {'
new_state = '    let pendingChatWrites = [];\n    let curatedBackfillInProgress = false;\n    let pendingLiveCuratedRecords = [];\n    let curatedBurnStore = (() => {'
if text.count(old_state) != 1:
    raise SystemExit(f'expected curated state seam once, found {text.count(old_state)}')
text = text.replace(old_state, new_state, 1)

old_record = '''        maybeLearnSelfNickname(record);
        ingestCuratedRecord(record);
        scheduleChatLogSave();'''
new_record = '''        maybeLearnSelfNickname(record);
        if (settings.curatedBurnsEnabled && (chatStorageHydrating || curatedBackfillInProgress)) {
            pendingLiveCuratedRecords.push(record);
        } else {
            ingestCuratedRecord(record);
        }
        scheduleChatLogSave();'''
if text.count(old_record) != 1:
    raise SystemExit(f'expected live curated ingest seam once, found {text.count(old_record)}')
text = text.replace(old_record, new_record, 1)

old_import = '''            updateChatStorageStatus();
            backfillCuratedBurnsFromTranscript();'''
new_import = '''            updateChatStorageStatus();
            await backfillCuratedBurnsFromTranscript();'''
if text.count(old_import) != 1:
    raise SystemExit(f'expected import backfill call once, found {text.count(old_import)}')
text = text.replace(old_import, new_import, 1)

old_backfill = '''    async function backfillCuratedBurnsFromTranscript() {
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
    }'''

new_backfill = '''    async function backfillCuratedBurnsFromTranscript() {
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
    }'''
if text.count(old_backfill) != 1:
    raise SystemExit(f'expected cooperative backfill function once, found {text.count(old_backfill)}')
text = text.replace(old_backfill, new_backfill, 1)
script_path.write_text(text)

version_test = Path('scripts/tests/rumble-userscript-version-source.test.mjs')
version_text = version_test.read_text()
if 'v1.12.7' not in version_text or r'1\.12\.7' not in version_text:
    raise SystemExit('version regression test is not at v1.12.7')
version_text = version_text.replace('v1.12.7', 'v1.12.8').replace(r'1\.12\.7', r'1\.12\.8')
version_text = version_text.replace('cooperative transcript hydration', 'serialized cooperative transcript hydration')
version_test.write_text(version_text)
