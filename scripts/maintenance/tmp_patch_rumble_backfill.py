from pathlib import Path

script_path = Path('scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js')
text = script_path.read_text()

old_version = '// @version      1.12.6'
if text.count(old_version) != 1:
    raise SystemExit(f'expected exactly one old version marker, found {text.count(old_version)}')
text = text.replace(old_version, '// @version      1.12.7', 1)

old_constants = '    const CHAT_TRANSCRIPT_READ_BATCH_SIZE = 250;\n    const CURATED_BURNS_KEY = "rumbleCuratedBurnsV1";'
new_constants = '    const CHAT_TRANSCRIPT_READ_BATCH_SIZE = 250;\n    const CURATED_BACKFILL_BATCH_SIZE = 25;\n    const CURATED_BACKFILL_PROFILE_BATCH_SIZE = 5;\n    const CURATED_BURNS_KEY = "rumbleCuratedBurnsV1";'
if text.count(old_constants) != 1:
    raise SystemExit(f'expected constants seam once, found {text.count(old_constants)}')
text = text.replace(old_constants, new_constants, 1)

call = '            backfillCuratedBurnsFromTranscript();'
if text.count(call) != 2:
    raise SystemExit(f'expected two backfill call sites, found {text.count(call)}')
text = text.replace(call, '            await backfillCuratedBurnsFromTranscript();')

old_fn = '''    function backfillCuratedBurnsFromTranscript() {
        if (!settings.curatedBurnsEnabled || !chatLog.length) return;
        const lastProcessed = Number(curatedBurnStore.lastProcessedSeq) || 0;
        const pending = chatLog.filter((record) => (Number(record.seq) || 0) > lastProcessed);
        if (!pending.length) return;
        const touched = new Set();
        pending.forEach((record) => {
            ingestCuratedRecord(record, { deferSave: true, deferCurate: true });
            if (record?.username) touched.add(String(record.username).toLowerCase());
        });
        touched.forEach((username) => {
            const profile = curatedBurnStore.users[username];
            if (profile && profile.messageCount >= Math.max(3, Number(settings.curatedBurnMinMessages) || 8)) regenerateCuratedBurns(profile);
        });
        saveCuratedBurnStore();
    }'''

new_fn = '''    async function backfillCuratedBurnsFromTranscript() {
        if (!settings.curatedBurnsEnabled || !chatLog.length) return;
        const lastProcessed = Number(curatedBurnStore.lastProcessedSeq) || 0;
        const pending = chatLog.filter((record) => (Number(record.seq) || 0) > lastProcessed);
        if (!pending.length) return;
        const touched = new Set();

        for (let index = 0; index < pending.length; index += CURATED_BACKFILL_BATCH_SIZE) {
            const batchEnd = Math.min(index + CURATED_BACKFILL_BATCH_SIZE, pending.length);
            for (let offset = index; offset < batchEnd; offset += 1) {
                const record = pending[offset];
                ingestCuratedRecord(record, { deferSave: true, deferCurate: true });
                if (record?.username) touched.add(String(record.username).toLowerCase());
            }
            if (batchEnd < pending.length) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        }

        const touchedUsers = Array.from(touched);
        for (let index = 0; index < touchedUsers.length; index += CURATED_BACKFILL_PROFILE_BATCH_SIZE) {
            const batchEnd = Math.min(index + CURATED_BACKFILL_PROFILE_BATCH_SIZE, touchedUsers.length);
            for (let offset = index; offset < batchEnd; offset += 1) {
                const profile = curatedBurnStore.users[touchedUsers[offset]];
                if (profile && profile.messageCount >= Math.max(3, Number(settings.curatedBurnMinMessages) || 8)) regenerateCuratedBurns(profile);
            }
            if (batchEnd < touchedUsers.length) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        }

        saveCuratedBurnStore();
    }'''
if text.count(old_fn) != 1:
    raise SystemExit(f'expected synchronous backfill function once, found {text.count(old_fn)}')
text = text.replace(old_fn, new_fn, 1)
script_path.write_text(text)

version_test = Path('scripts/tests/rumble-userscript-version-source.test.mjs')
version_text = version_test.read_text()
if 'v1.12.6' not in version_text or r'1\.12\.6' not in version_text:
    raise SystemExit('version regression test is not at v1.12.6')
version_text = version_text.replace('v1.12.6', 'v1.12.7').replace(r'1\.12\.6', r'1\.12\.7')
version_test.write_text(version_text)
