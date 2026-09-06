from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "tampermonkey" / "dizygotic-rumble-chat-tool.user.js"
INDEXEDDB_TEST = ROOT / "scripts" / "tests" / "rumble-chat-indexeddb-source.test.mjs"
VERSION_TEST = ROOT / "scripts" / "tests" / "rumble-userscript-version-source.test.mjs"


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def regex_once(text, pattern, replacement, label, flags=re.S):
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one regex match, found {count}")
    return updated


source = SCRIPT.read_text(encoding="utf-8")
source = replace_once(source, "// @version      1.12.5", "// @version      1.12.6", "version bump")
source = replace_once(
    source,
    '    const CHAT_DB_STORE = "messages";\n',
    '    const CHAT_DB_STORE = "messages";\n    const CHAT_TRANSCRIPT_READ_BATCH_SIZE = 250;\n',
    "batch size constant",
)
source = replace_once(
    source,
    '    let chatDbPromise = null;\n    let chatStorageInitPromise = null;\n    let chatStorageMode = "loading";\n',
    '    let chatDbPromise = null;\n    let chatStorageReadyPromise = null;\n    let chatStorageInitPromise = null;\n    let chatTranscriptHydrated = false;\n    let chatStorageHydrating = false;\n    let chatStorageHydrationCount = 0;\n    let chatStorageMode = "loading";\n',
    "lazy storage state",
)

new_read_all = r'''    async function readAllChatRecords(db) {
        const records = [];
        let lastKey = null;
        let done = false;

        while (!done) {
            const transaction = db.transaction(CHAT_DB_STORE, "readonly");
            const completed = waitForChatTransaction(transaction);
            const store = transaction.objectStore(CHAT_DB_STORE);
            const range = lastKey == null ? undefined : IDBKeyRange.lowerBound(lastKey, true);
            const request = store.openCursor(range);
            const result = await new Promise((resolve, reject) => {
                const batch = [];
                let batchLastKey = lastKey;
                request.onsuccess = () => {
                    const cursor = request.result;
                    if (!cursor) {
                        resolve({ batch, lastKey: batchLastKey, done: true });
                        return;
                    }
                    batch.push(cursor.value);
                    batchLastKey = cursor.key;
                    if (batch.length >= CHAT_TRANSCRIPT_READ_BATCH_SIZE) {
                        resolve({ batch, lastKey: batchLastKey, done: false });
                        return;
                    }
                    cursor.continue();
                };
                request.onerror = () => reject(request.error || new Error("Unable to read transcript IndexedDB"));
            });
            await completed;
            records.push(...result.batch);
            lastKey = result.lastKey;
            done = result.done;
            chatStorageHydrationCount = records.length;
            updateChatStorageStatus();
            if (!done) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        }

        return records.sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0));
    }
'''
source = regex_once(
    source,
    r'    async function readAllChatRecords\(db\) \{.*?\n    \}\n\n(?=    async function clearChatRecords)',
    new_read_all,
    "chunked transcript reader",
)

source = replace_once(
    source,
    '    function chatStorageSummaryText() {\n        const mode = chatStorageMode === "indexeddb"\n',
    '    function chatStorageSummaryText() {\n        if (chatStorageHydrating) {\n            return `${chatStorageHydrationCount.toLocaleString()} loaded messages · loading IndexedDB history…`;\n        }\n        const mode = chatStorageMode === "indexeddb"\n',
    "hydration status",
)

new_storage_init = r'''    async function readLatestChatSequence(db) {
        const transaction = db.transaction(CHAT_DB_STORE, "readonly");
        const completed = waitForChatTransaction(transaction);
        const request = transaction.objectStore(CHAT_DB_STORE).openCursor(null, "prev");
        const latestSequence = await new Promise((resolve, reject) => {
            request.onsuccess = () => {
                const cursor = request.result;
                resolve(Number(cursor?.value?.seq ?? cursor?.key) || 0);
            };
            request.onerror = () => reject(request.error || new Error("Unable to read latest transcript sequence"));
        });
        await completed;
        return latestSequence;
    }

    async function prepareChatTranscriptStorage() {
        if (chatStorageReadyPromise) return chatStorageReadyPromise;
        chatStorageReadyPromise = (async () => {
            try {
                const db = await openChatTranscriptDb();
                if (legacyChatLog.length) await putChatRecords(db, legacyChatLog);
                const legacySequence = legacyChatLog.reduce(
                    (max, record) => Math.max(max, Number(record.seq) || 0),
                    0
                );
                chatSequence = Math.max(chatSequence, legacySequence, await readLatestChatSequence(db));
                localStorage.removeItem(CHAT_LOG_KEY);
                chatStorageMode = "indexeddb";
                chatStorageLastError = "";
                updateChatStorageStatus();
                if (navigator.storage?.persist) {
                    navigator.storage.persist().catch(() => false);
                }
                return db;
            } catch (err) {
                console.warn("IndexedDB transcript storage unavailable; preserving the legacy transcript and recording in memory for this session", err);
                chatLog = legacyChatLog.slice();
                chatSequence = chatLog.reduce(
                    (max, record) => Math.max(max, Number(record.seq) || 0),
                    0
                );
                chatTranscriptHydrated = true;
                chatStorageMode = "memory";
                chatStorageLastError = String(err?.message || err);
                updateChatStorageStatus();
                return null;
            }
        })();
        return chatStorageReadyPromise;
    }

    async function initializeChatTranscriptStorage() {
        if (chatTranscriptHydrated) return chatLog;
        if (chatStorageInitPromise) return chatStorageInitPromise;
        chatStorageInitPromise = (async () => {
            const db = await prepareChatTranscriptStorage();
            if (!db || chatStorageMode === "memory") return chatLog;

            const sessionRecords = chatLog.slice();
            chatStorageHydrating = true;
            chatStorageHydrationCount = 0;
            updateChatStorageStatus();
            try {
                const storedRecords = await readAllChatRecords(db);
                const bySequence = new Map();
                [...storedRecords, ...sessionRecords].forEach((record) => {
                    const seq = Number(record?.seq) || 0;
                    if (seq > 0) bySequence.set(seq, record);
                });
                chatLog = [...bySequence.values()].sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0));
                chatSequence = chatLog.reduce(
                    (max, record) => Math.max(max, Number(record.seq) || 0),
                    chatSequence
                );
                chatTranscriptHydrated = true;
                chatStorageMode = "indexeddb";
                chatStorageLastError = "";
                backfillCuratedBurnsFromTranscript();
                return chatLog;
            } catch (err) {
                chatStorageMode = "error";
                chatStorageLastError = String(err?.message || err);
                chatStorageInitPromise = null;
                console.warn("Unable to hydrate the IndexedDB transcript; use the load/rebuild control to retry", err);
                throw err;
            } finally {
                chatStorageHydrating = false;
                updateChatStorageStatus();
            }
        })();
        return chatStorageInitPromise;
    }

'''
source = regex_once(
    source,
    r'    async function initializeChatTranscriptStorage\(\) \{.*?\n    \}\n\n(?=    let chatLogSaveTimer = null;)',
    new_storage_init,
    "split storage readiness and hydration",
)

source = replace_once(
    source,
    '    function showSettingsPanel() {\n        const existing = document.querySelector("#rumbleBlockerSettingsPanel");\n        if (existing) return;\n\n',
    '    function showSettingsPanel() {\n        const existing = document.querySelector("#rumbleBlockerSettingsPanel");\n        if (existing) return;\n\n        void initializeChatTranscriptStorage().catch((err) => {\n            console.warn("IndexedDB transcript background load failed; use Load / Rebuild IndexedDB transcript to retry", err);\n        });\n\n',
    "panel lazy hydration",
)
source = replace_once(
    source,
    '<button type="button" id="rebuildCuratedBurnsBtn">Rebuild from transcript</button>',
    '<button type="button" id="rebuildCuratedBurnsBtn">Load / Rebuild IndexedDB transcript</button>',
    "rebuild button label",
)

new_dm = r'''    function openDirectMessage(targetDisplayName) {
        const myNickname = detectMyNickname();

        const resolvedNickname = sanitizeNickname(myNickname) || "Guest";
        if (resolvedNickname !== settings.myNickname) {
            settings.myNickname = resolvedNickname === "Guest" ? settings.myNickname : resolvedNickname;
            if (resolvedNickname !== "Guest") saveSettings();
        }

        const providedTarget = (targetDisplayName || "").toString().replace(/\s+/g, " ").trim();
        const target = providedTarget ||
            prompt("Enter the username to DM:", "general")?.toString().replace(/\s+/g, " ").trim() ||
            "general";
        const dmParticipants = [resolvedNickname, target]
            .map((name) => sanitizeNickname(name).toLowerCase())
            .filter(Boolean)
            .sort();
        const roomName = target && target !== resolvedNickname ? `dizychat-dm-${dmParticipants.join("-")}` : "general";

        const landingBaseURL = "https://dizychat.com/login.html";
        const params = new URLSearchParams();
        params.set("username", resolvedNickname);
        params.set("room", roomName);
        const landingURL = `${landingBaseURL}?${params.toString()}`;

        const dmWindow = window.open(landingURL, "_blank", "noopener,noreferrer");
        if (dmWindow) {
            try {
                dmWindow.opener = null;
            } catch (err) {
                console.warn("Unable to clear opener on DM window", err);
            }
            return;
        }

        const anchor = document.createElement("a");
        anchor.href = landingURL;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.style.display = "none";
        document.body.appendChild(anchor);

        const clickEvent = new MouseEvent("click", {
            view: window,
            bubbles: true,
            cancelable: true
        });

        const clickSucceeded = anchor.dispatchEvent(clickEvent);
        requestAnimationFrame(() => {
            if (anchor.parentNode) {
                anchor.parentNode.removeChild(anchor);
            }
        });

        if (!clickSucceeded) {
            alert("Please allow popups to open DizyChat direct messages in a new tab.");
        }
    }

'''
source = regex_once(
    source,
    r'    function openDirectMessage\(targetDisplayName\) \{.*?\n    \}\n\n(?=    function attachContextMenuToUser)',
    new_dm,
    "current DizyChat handoff",
)

source = replace_once(
    source,
    '    async function boot() {\n        setupAutoBackup();\n        await initializeChatTranscriptStorage();\n        backfillCuratedBurnsFromTranscript();\n        initAudio();\n',
    '    async function boot() {\n        setupAutoBackup();\n        await prepareChatTranscriptStorage();\n        initAudio();\n',
    "lightweight boot storage readiness",
)
SCRIPT.write_text(source, encoding="utf-8")

indexed = INDEXEDDB_TEST.read_text(encoding="utf-8")
indexed = regex_once(
    indexed,
    r'test\("legacy localStorage transcript migrates before the old key is removed", \(\) => \{.*?\n\}\);',
    '''test("legacy localStorage transcript migrates during lightweight storage readiness before the old key is removed", () => {
  const prepare = between("async function prepareChatTranscriptStorage()", "async function initializeChatTranscriptStorage()");
  const hydrate = between("async function initializeChatTranscriptStorage()", "let chatLogSaveTimer = null;");
  assert.match(prepare, /legacyChatLog/);
  assert.match(prepare, /await putChatRecords\(db, legacyChatLog\)/);
  assert.match(prepare, /await readLatestChatSequence\(db\)/);
  assert.match(prepare, /localStorage\.removeItem\(CHAT_LOG_KEY\)/);
  assert.doesNotMatch(prepare, /readAllChatRecords\(db\)/);
  assert.match(hydrate, /await readAllChatRecords\(db\)/);
  assert.ok(prepare.indexOf("await putChatRecords(db, legacyChatLog)") < prepare.indexOf("localStorage.removeItem(CHAT_LOG_KEY)"));
});''',
    "indexeddb migration contract",
)
indexed = regex_once(
    indexed,
    r'test\("boot waits for transcript storage and the panel reports IndexedDB status", \(\) => \{.*?\n\}\);',
    '''test("boot prepares IndexedDB sequence state without hydrating history and panel opens hydration", () => {
  assert.match(source, /id="chatStorageStatus"/);
  assert.match(source, /chatStorageSummaryText\(\)/);
  const boot = between("async function boot()", "if (document.readyState");
  const panel = between("function showSettingsPanel()", "function ensureFloatingSettingsButton()");
  assert.match(boot, /await prepareChatTranscriptStorage\(\);/);
  assert.doesNotMatch(boot, /initializeChatTranscriptStorage\(\)/);
  assert.match(panel, /initializeChatTranscriptStorage\(\)/);
  assert.match(source, /navigator\.storage\?\.persist/);
});''',
    "indexeddb lazy boot contract",
)
INDEXEDDB_TEST.write_text(indexed, encoding="utf-8")

version = VERSION_TEST.read_text(encoding="utf-8")
version = version.replace("v1.12.5", "v1.12.6").replace("1\\.12\\.5", "1\\.12\\.6")
VERSION_TEST.write_text(version, encoding="utf-8")

print("Rumble userscript lazy IndexedDB + DizyChat patch applied")
