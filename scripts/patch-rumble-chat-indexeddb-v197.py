from pathlib import Path

path = Path("scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js")
source = path.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    source = source.replace(old, new, 1)


replace_once("// @version      1.9.6", "// @version      1.9.7", "version")
replace_once(
    "    const CHAT_LOG_KEY = \"rumbleChatTranscriptLogV1\";\n"
    "    const CHAT_LOG_LIMIT = 20000;\n"
    "    const CURATED_BURNS_KEY = \"rumbleCuratedBurnsV1\";",
    "    const CHAT_LOG_KEY = \"rumbleChatTranscriptLogV1\";\n"
    "    const CHAT_DB_NAME = \"dizygoticRumbleChat\";\n"
    "    const CHAT_DB_VERSION = 1;\n"
    "    const CHAT_DB_STORE = \"messages\";\n"
    "    const CURATED_BURNS_KEY = \"rumbleCuratedBurnsV1\";",
    "chat storage constants",
)
replace_once(
    "    let blockedUsers = JSON.parse(localStorage.getItem(STORAGE_KEY) || \"[]\");\n"
    "    let settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || \"{}\");\n"
    "    let chatLog = JSON.parse(localStorage.getItem(CHAT_LOG_KEY) || \"[]\");\n"
    "    if (!Array.isArray(chatLog)) chatLog = [];\n"
    "    let chatSequence = chatLog.length ? Math.max(...chatLog.map((r) => Number(r.seq) || 0)) : 0;",
    "    let blockedUsers = JSON.parse(localStorage.getItem(STORAGE_KEY) || \"[]\");\n"
    "    let settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || \"{}\");\n"
    "    const legacyChatLog = (() => {\n"
    "        try {\n"
    "            const parsed = JSON.parse(localStorage.getItem(CHAT_LOG_KEY) || \"[]\");\n"
    "            return Array.isArray(parsed) ? parsed : [];\n"
    "        } catch (err) {\n"
    "            console.warn(\"Unable to parse legacy chat transcript\", err);\n"
    "            return [];\n"
    "        }\n"
    "    })();\n"
    "    let chatLog = [];\n"
    "    let chatSequence = 0;\n"
    "    let chatDbPromise = null;\n"
    "    let chatStorageInitPromise = null;\n"
    "    let chatStorageMode = \"loading\";\n"
    "    let chatStorageLastError = \"\";\n"
    "    let pendingChatWrites = [];",
    "legacy transcript load",
)
replace_once(
    "    // v1.9.6 adds a configurable pre-send reply delay while keeping auto-burn hands-off; retire any persisted review prompt.",
    "    // v1.9.7 moves transcript persistence to IndexedDB while keeping the v1.9.6 delayed auto-burn behaviour.",
    "version comment",
)

old_storage = '''    let chatLogSaveTimer = null;
    function saveChatLog() {
        if (chatLogSaveTimer) { clearTimeout(chatLogSaveTimer); chatLogSaveTimer = null; }
        try {
            localStorage.setItem(CHAT_LOG_KEY, JSON.stringify(chatLog));
        } catch (err) {
            console.warn("Chat transcript storage full; trimming oldest records", err);
            chatLog = chatLog.slice(-Math.floor(CHAT_LOG_LIMIT / 2));
            try {
                localStorage.setItem(CHAT_LOG_KEY, JSON.stringify(chatLog));
            } catch (retryErr) {
                console.warn("Unable to persist chat transcript", retryErr);
            }
        }
    }

    function scheduleChatLogSave() {
        if (chatLogSaveTimer) return;
        chatLogSaveTimer = setTimeout(saveChatLog, 750);
    }
'''
new_storage = '''    function openChatTranscriptDb() {
        if (chatDbPromise) return chatDbPromise;
        chatDbPromise = new Promise((resolve, reject) => {
            if (!("indexedDB" in window)) {
                reject(new Error("IndexedDB is not available in this browser context"));
                return;
            }
            const request = indexedDB.open(CHAT_DB_NAME, CHAT_DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(CHAT_DB_STORE)) {
                    db.createObjectStore(CHAT_DB_STORE, { keyPath: "seq" });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error("Unable to open IndexedDB transcript storage"));
            request.onblocked = () => console.warn("IndexedDB transcript upgrade is blocked by another Rumble tab");
        });
        return chatDbPromise;
    }

    function waitForChatTransaction(transaction) {
        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error || new Error("Transcript IndexedDB transaction failed"));
            transaction.onabort = () => reject(transaction.error || new Error("Transcript IndexedDB transaction aborted"));
        });
    }

    async function putChatRecords(db, records) {
        if (!Array.isArray(records) || !records.length) return;
        const transaction = db.transaction(CHAT_DB_STORE, "readwrite");
        const completed = waitForChatTransaction(transaction);
        const store = transaction.objectStore(CHAT_DB_STORE);
        records.forEach((record) => store.put(record));
        await completed;
    }

    async function readAllChatRecords(db) {
        const transaction = db.transaction(CHAT_DB_STORE, "readonly");
        const completed = waitForChatTransaction(transaction);
        const request = transaction.objectStore(CHAT_DB_STORE).getAll();
        const records = await new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error || new Error("Unable to read transcript IndexedDB"));
        });
        await completed;
        return records.sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0));
    }

    async function clearChatRecords(db) {
        const transaction = db.transaction(CHAT_DB_STORE, "readwrite");
        const completed = waitForChatTransaction(transaction);
        transaction.objectStore(CHAT_DB_STORE).clear();
        await completed;
    }

    function chatStorageSummaryText() {
        const mode = chatStorageMode === "indexeddb"
            ? "IndexedDB"
            : chatStorageMode === "memory"
                ? "memory only"
                : chatStorageMode === "error"
                    ? "IndexedDB write retrying"
                    : "loading storage…";
        return `${chatLog.length.toLocaleString()} saved messages · ${mode}`;
    }

    function updateChatStorageStatus(root = document) {
        const status = root?.querySelector?.("#chatStorageStatus");
        if (!status) return;
        status.textContent = chatStorageSummaryText();
        status.title = chatStorageLastError || "Transcript storage has no app-level message-count ceiling.";
    }

    async function initializeChatTranscriptStorage() {
        if (chatStorageInitPromise) return chatStorageInitPromise;
        chatStorageInitPromise = (async () => {
            try {
                const db = await openChatTranscriptDb();
                if (legacyChatLog.length) await putChatRecords(db, legacyChatLog);
                chatLog = await readAllChatRecords(db);
                chatSequence = chatLog.length ? Math.max(...chatLog.map((r) => Number(r.seq) || 0)) : 0;
                localStorage.removeItem(CHAT_LOG_KEY);
                chatStorageMode = "indexeddb";
                chatStorageLastError = "";
                updateChatStorageStatus();
                if (navigator.storage?.persist) {
                    navigator.storage.persist().catch(() => false);
                }
            } catch (err) {
                console.warn("IndexedDB transcript storage unavailable; preserving the legacy transcript and recording in memory for this session", err);
                chatLog = legacyChatLog.slice();
                chatSequence = chatLog.length ? Math.max(...chatLog.map((r) => Number(r.seq) || 0)) : 0;
                chatStorageMode = "memory";
                chatStorageLastError = String(err?.message || err);
                updateChatStorageStatus();
            }
            return chatLog;
        })();
        return chatStorageInitPromise;
    }

    let chatLogSaveTimer = null;
    let chatLogSaveInFlight = false;
    async function saveChatLog() {
        if (chatLogSaveTimer) { clearTimeout(chatLogSaveTimer); chatLogSaveTimer = null; }
        if (chatLogSaveInFlight || !pendingChatWrites.length || chatStorageMode === "memory") return;
        const batch = pendingChatWrites.splice(0);
        chatLogSaveInFlight = true;
        try {
            const db = await openChatTranscriptDb();
            await putChatRecords(db, batch);
            chatStorageMode = "indexeddb";
            chatStorageLastError = "";
            updateChatStorageStatus();
        } catch (err) {
            pendingChatWrites = [...batch, ...pendingChatWrites];
            chatStorageMode = "error";
            chatStorageLastError = String(err?.message || err);
            console.warn("Unable to persist chat transcript to IndexedDB; queued records will be retried", err);
            updateChatStorageStatus();
        } finally {
            chatLogSaveInFlight = false;
            if (pendingChatWrites.length && chatStorageMode !== "memory") scheduleChatLogSave();
        }
    }

    function scheduleChatLogSave() {
        if (chatLogSaveTimer) return;
        chatLogSaveTimer = setTimeout(() => { void saveChatLog(); }, chatStorageMode === "error" ? 2000 : 750);
    }
'''
replace_once(old_storage, new_storage, "transcript storage implementation")

old_record_clear_export = '''        chatLog.push(record);
        if (chatLog.length > CHAT_LOG_LIMIT) chatLog.splice(0, chatLog.length - CHAT_LOG_LIMIT);
        maybeLearnSelfNickname(record);
        ingestCuratedRecord(record);
        scheduleChatLogSave();
    }

    function clearChatLog() {
        chatLog = [];
        chatSequence = 0;
        localStorage.removeItem(CHAT_LOG_KEY);
        clearCuratedBurns({ silent: true });
    }

    function csvEscape(value) {
'''
new_record_clear_export = '''        chatLog.push(record);
        pendingChatWrites.push(record);
        updateChatStorageStatus();
        maybeLearnSelfNickname(record);
        ingestCuratedRecord(record);
        scheduleChatLogSave();
    }

    async function clearChatLog() {
        await initializeChatTranscriptStorage();
        if (chatLogSaveTimer) { clearTimeout(chatLogSaveTimer); chatLogSaveTimer = null; }
        pendingChatWrites = [];
        if (chatStorageMode !== "memory") {
            try {
                const db = await openChatTranscriptDb();
                await clearChatRecords(db);
            } catch (err) {
                chatStorageMode = "error";
                chatStorageLastError = String(err?.message || err);
                updateChatStorageStatus();
                console.warn("Unable to clear IndexedDB transcript", err);
                return false;
            }
        }
        chatLog = [];
        chatSequence = 0;
        localStorage.removeItem(CHAT_LOG_KEY);
        clearCuratedBurns({ silent: true });
        updateChatStorageStatus();
        return true;
    }

    function csvEscape(value) {
'''
replace_once(old_record_clear_export, new_record_clear_export, "record and clear path")
replace_once(
    '    function exportChatLog(format = "json") {\n        const stamp = new Date().toISOString().replace(/[:.]/g, "-");',
    '    async function exportChatLog(format = "json") {\n        await initializeChatTranscriptStorage();\n        const stamp = new Date().toISOString().replace(/[:.]/g, "-");',
    "async transcript export",
)

replace_once(
    '''    function rebuildCuratedBurnsFromTranscript(reset = true) {
        if (reset) curatedBurnStore = { schemaVersion: CURATED_BURNS_SCHEMA, lastProcessedSeq: 0, users: {} };
        const touched = new Set();
        const records = chatLog.slice(-5000);''',
    '''    async function rebuildCuratedBurnsFromTranscript(reset = true) {
        await initializeChatTranscriptStorage();
        if (reset) curatedBurnStore = { schemaVersion: CURATED_BURNS_SCHEMA, lastProcessedSeq: 0, users: {} };
        const touched = new Set();
        const records = chatLog.slice();''',
    "full-history curated rebuild",
)
replace_once(
    '        const pending = chatLog.filter((record) => (Number(record.seq) || 0) > lastProcessed).slice(-5000);',
    '        const pending = chatLog.filter((record) => (Number(record.seq) || 0) > lastProcessed);',
    "full-history curated backfill",
)

replace_once(
    '''            <b>Passive chat recorder</b>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:6px">
                <label><input type="checkbox" id="chatRecorderEnabledInput"${settings.chatRecorderEnabled ? " checked" : ""}> Record public chat locally</label>
                <span style="font-size:12px;color:gray">${chatLog.length} saved messages</span>
            </div>
            <div style="height:12px"></div>''',
    '''            <b>Passive chat recorder</b>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:6px">
                <label><input type="checkbox" id="chatRecorderEnabledInput"${settings.chatRecorderEnabled ? " checked" : ""}> Record public chat locally</label>
                <span id="chatStorageStatus" style="font-size:12px;color:gray">${chatStorageSummaryText()}</span>
            </div>
            <div style="font-size:12px;color:gray;margin-top:4px">Transcript history is stored in IndexedDB with no app-level message-count ceiling. Browser storage quota still applies; a write problem is shown here instead of silently trimming old messages.</div>
            <div style="height:12px"></div>''',
    "storage panel status",
)
replace_once(
    '''        applyThemeToPanel(panel);
        updateBackupStatus(panel);
        updateCuratedBurnStatus(panel);''',
    '''        applyThemeToPanel(panel);
        updateBackupStatus(panel);
        updateCuratedBurnStatus(panel);
        updateChatStorageStatus(panel);''',
    "panel storage refresh",
)

replace_once(
    '        buttonRow.appendChild(createAccentButton("Chat JSON", () => exportChatLog("json"), "#673ab7", "🧾"));\n'
    '        buttonRow.appendChild(createAccentButton("Chat CSV", () => exportChatLog("csv"), "#3f51b5", "📊"));\n'
    '        buttonRow.appendChild(createAccentButton("Clear Chat Log", () => { if (confirm("Clear saved local chat transcript?")) { clearChatLog(); alert("✅ Chat transcript cleared."); } }, "#795548", "🧹"));',
    '        buttonRow.appendChild(createAccentButton("Chat JSON", () => { void exportChatLog("json"); }, "#673ab7", "🧾"));\n'
    '        buttonRow.appendChild(createAccentButton("Chat CSV", () => { void exportChatLog("csv"); }, "#3f51b5", "📊"));\n'
    '        buttonRow.appendChild(createAccentButton("Clear Chat Log", async () => { if (!confirm("Clear saved local chat transcript?")) return; const cleared = await clearChatLog(); alert(cleared ? "✅ Chat transcript cleared." : "⚠️ Transcript could not be cleared from browser storage."); }, "#795548", "🧹"));',
    "async chat panel actions",
)
replace_once(
    '''            rebuildCuratedBtn.addEventListener("click", () => {
                settings.curatedBurnsEnabled = !!panel.querySelector("#curatedBurnsEnabledInput")?.checked;''',
    '''            rebuildCuratedBtn.addEventListener("click", async () => {
                settings.curatedBurnsEnabled = !!panel.querySelector("#curatedBurnsEnabledInput")?.checked;''',
    "async curated rebuild handler",
)
replace_once(
    '''                saveSettings();
                rebuildCuratedBurnsFromTranscript(true);
                updateCuratedBurnStatus(panel);''',
    '''                saveSettings();
                await rebuildCuratedBurnsFromTranscript(true);
                updateCuratedBurnStatus(panel);''',
    "await curated rebuild",
)

old_boot = '''    function boot() {
        setupAutoBackup();
        backfillCuratedBurnsFromTranscript();
        initAudio();'''
new_boot = '''    async function boot() {
        setupAutoBackup();
        await initializeChatTranscriptStorage();
        backfillCuratedBurnsFromTranscript();
        initAudio();'''
replace_once(old_boot, new_boot, "async boot")
replace_once(
    '''        installOutgoingComposerFormatting();
        setInterval(installOutgoingComposerFormatting, 800);
        window.addEventListener("beforeunload", saveChatLog, { once: true });
    }

    if (document.readyState === "complete" || document.readyState === "interactive") {
        boot();
    } else {
        window.addEventListener("DOMContentLoaded", boot);
    }''',
    '''        installOutgoingComposerFormatting();
        setInterval(installOutgoingComposerFormatting, 800);
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "hidden") void saveChatLog();
        });
        window.addEventListener("beforeunload", () => {
            void saveChatLog();
            saveCuratedBurnStore();
        }, { once: true });
    }

    if (document.readyState === "complete" || document.readyState === "interactive") {
        void boot();
    } else {
        window.addEventListener("DOMContentLoaded", () => { void boot(); }, { once: true });
    }''',
    "boot lifecycle storage flush",
)

# Guard the intended boundary before writing.
required = [
    '// @version      1.9.7',
    'const CHAT_DB_NAME = "dizygoticRumbleChat";',
    'const CHAT_DB_STORE = "messages";',
    'async function initializeChatTranscriptStorage()',
    'await putChatRecords(db, legacyChatLog)',
    'chatLog = await readAllChatRecords(db)',
    'pendingChatWrites.push(record)',
    'async function exportChatLog(format = "json")',
    'async function rebuildCuratedBurnsFromTranscript(reset = true)',
    'const records = chatLog.slice();',
    'id="chatStorageStatus"',
    'async function boot()',
    'await initializeChatTranscriptStorage();',
]
for needle in required:
    if needle not in source:
        raise SystemExit(f"required v1.9.7 contract missing after patch: {needle}")
for forbidden in [
    'CHAT_LOG_LIMIT',
    'chatLog.splice(0, chatLog.length -',
    'localStorage.setItem(CHAT_LOG_KEY, JSON.stringify(chatLog))',
    'slice(-5000)',
]:
    if forbidden in source:
        raise SystemExit(f"stale transcript ceiling/storage path survived: {forbidden}")

path.write_text(source, encoding="utf-8")
print("Applied guarded Rumble transcript IndexedDB v1.9.7 migration patch")
