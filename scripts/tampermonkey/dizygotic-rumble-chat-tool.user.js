// ==UserScript==
// @name         Dizygotic Rumble Chat Tool
// @namespace    http://tampermonkey.net/
// @version      1.11.0
// @description  All-in-one chat tool for Rumble: private dm chat, user blocker + keyword filter + highlights + compact mode + timestamps + notifications + autoscroll lock + collapse long messages + stats + transcript recorder/export + automated curated burn memory + outgoing message styling + auto-burn + export/import + auto-backup. Non-flashing, persistent, draggable settings panel.
// @author       Dizygotic
// @match        https://rumble.com/*
// @require      https://unpkg.com/compromise@14.7.0/builds/compromise.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/rita/2.0.2/rita.min.js
// @grant        GM_download
// ==/UserScript==

(function () {
    "use strict";

    /***********************
     * Storage keys & load *
     ***********************/
    const STORAGE_KEY = "rumbleBlockedUsers";
    const SETTINGS_KEY = "rumbleBlockerSettings";
    const BACKUP_KEY = "rumbleLastBackup";
    const BACKUP_FILENAME = "dizygotic-rumble-chat-tool-settings-backup.json";
    const BTN_POS_KEY = "rumbleBlockerBtnPos";
    const CHAT_LOG_KEY = "rumbleChatTranscriptLogV1";
    const CHAT_DB_NAME = "dizygoticRumbleChat";
    const CHAT_DB_VERSION = 1;
    const CHAT_DB_STORE = "messages";
    const CURATED_BURNS_KEY = "rumbleCuratedBurnsV1";
    const CURATED_BURNS_SCHEMA = 2;
    const CURATED_MAX_USERS = 300;

    let blockedUsers = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    let settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    const legacyChatLog = (() => {
        try {
            const parsed = JSON.parse(localStorage.getItem(CHAT_LOG_KEY) || "[]");
            return Array.isArray(parsed) ? parsed : [];
        } catch (err) {
            console.warn("Unable to parse legacy chat transcript", err);
            return [];
        }
    })();
    let chatLog = [];
    let chatSequence = 0;
    let chatDbPromise = null;
    let chatStorageInitPromise = null;
    let chatStorageMode = "loading";
    let chatStorageLastError = "";
    let pendingChatWrites = [];
    let curatedBurnStore = (() => {
        try {
            const parsed = JSON.parse(localStorage.getItem(CURATED_BURNS_KEY) || "null");
            return parsed && typeof parsed === "object" ? parsed : { schemaVersion: CURATED_BURNS_SCHEMA, lastProcessedSeq: 0, users: {}, seedUsage: {}, recentSeedIds: [], recentSeedFamilies: [] };
        } catch (err) {
            console.warn("Unable to load curated burn memory; starting clean", err);
            return { schemaVersion: CURATED_BURNS_SCHEMA, lastProcessedSeq: 0, users: {}, seedUsage: {}, recentSeedIds: [], recentSeedFamilies: [] };
        }
    })();

    const defaultSettings = {
        previewLength: 50,
        autoBackupMinutes: 0,
        darkMode: false,
        blockedKeywords: [],
        keywordAction: "hide",
        highlightedUsers: [],
        highlightColor: "#ffeb3b",
        compactMode: false,
        showTimestamps: true,
        use24hTime: false,
        autoScrollLock: false,
        hideSystemMessages: false,
        collapseLength: 0,
        notifyOnHighlight: false,
        notifyOnKeyword: false,
        notificationSound: "",
        notificationVolume: 1,
        highlightNotificationSoundEnabled: false,
        myNickname: "",
        chatRecorderEnabled: true,
        outgoingFontStyle: "default",
        chatTextMode: "default",
        chatTextColor: "#ffffff",
        chatMultiPalette: "#ff4d4d,#ffa64d,#ffff4d,#4dff88,#4dd2ff,#8c4dff,#ff4dd2",
        autoBurnEnabled: false,
        autoBurnCooldownSeconds: 45,
        autoBurnReplyDelaySeconds: 5,
        autoBurnEngine: "british",
        curatedBurnsEnabled: true,
        curatedBurnMinMessages: 8,
        curatedBurnRefreshEvery: 3,
        curatedBurnMaxPerUser: 12,
        curatedBurnReviewBeforeUse: false,
        burnEnginesEnabled: {
            curated: true,
            british: true,
            scottish: true,
            irish: true,
            welsh: true,
            canadian: true,
            southern: true,
            australian: true,
            american: true,
            indian_callcentre: true,
            chinese: true,
            japanese: true,
            dizycat: true,
            derp: true,
            incel: true,
            random_personality: true,
            drill: true,
            builtin: true,
            compromise: true,
            rita: true,
            markov: true,
            custom: true
        },
        burnMarkovCorpus: ""
    };

    settings = Object.assign({}, defaultSettings, settings);
    settings.burnEnginesEnabled = Object.assign(
        {},
        defaultSettings.burnEnginesEnabled,
        settings.burnEnginesEnabled || {}
    );
    // v1.9.7 moves transcript persistence to IndexedDB while keeping the v1.9.6 delayed auto-burn behaviour.
    settings.curatedBurnReviewBeforeUse = false;

    function saveBlocklist() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(blockedUsers));
    }

    function saveSettings() {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }

    function openChatTranscriptDb() {
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

    function extractMentions(text) {
        const matches = (text || "").match(/@[A-Za-z0-9_.-]+/g) || [];
        return [...new Set(matches.map((m) => m.slice(1).toLowerCase()))];
    }

    function recordChatMessage(el, username, displayName, message) {
        if (!settings.chatRecorderEnabled || !el || el._chatLogged || !username) return;
        const clean = (message || "").replace(/\s+/g, " ").trim();
        if (!clean) return;
        el._chatLogged = true;
        const record = {
            seq: ++chatSequence,
            capturedAt: new Date().toISOString(),
            username,
            displayName,
            message: clean,
            mentions: extractMentions(clean),
            rawHtml: el._originalMessage || el.querySelector("div.js-chat-message.chat-history--message")?.innerHTML || "",
            rowClass: el.className || "",
            url: location.href,
            title: document.title
        };
        const burnMeta = consumePendingBurnEcho(record);
        if (burnMeta) Object.assign(record, burnMeta);
        chatLog.push(record);
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
        const text = value == null ? "" : String(value);
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }

    async function exportChatLog(format = "json") {
        await initializeChatTranscriptStorage();
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        if (format === "csv") {
            const header = ["seq","capturedAt","username","displayName","message","mentions","rawHtml","rowClass","url","title","botGenerated","botEngine","botTarget","botFontStyle","botStrategy","botContext"];
            const rows = chatLog.map((r) => [r.seq,r.capturedAt,r.username,r.displayName,r.message,(r.mentions||[]).join(" "),r.rawHtml||"",r.rowClass||"",r.url,r.title,r.botGenerated?"true":"",r.botEngine||"",r.botTarget||"",r.botFontStyle||"",r.botStrategy||"",r.botContext||""].map(csvEscape).join(","));
            triggerDownload(`dizygotic-rumble-chat-${stamp}.csv`, [header.join(","), ...rows].join("\n"), { prompt: true, mimeType: "text/csv;charset=utf-8" });
            return;
        }
        triggerDownload(`dizygotic-rumble-chat-${stamp}.json`, JSON.stringify(chatLog, null, 2), { prompt: true, mimeType: "application/json;charset=utf-8" });
    }

    function escapeRegex(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    const burnEngineRecommendations = [
        { key: "curated", label: "Curated history" },
        { key: "british", label: "British DIZY · default" },
        { key: "scottish", label: "Scottish banter" },
        { key: "irish", label: "Irish banter" },
        { key: "welsh", label: "Welsh banter" },
        { key: "canadian", label: "Canadian polite savage" },
        { key: "southern", label: "Southern / Hillbilly USA" },
        { key: "australian", label: "Australian roast" },
        { key: "american", label: "American roast" },
        { key: "indian_callcentre", label: "Indian call-centre · tech support parody" },
        { key: "chinese", label: "Chinese · precision/QC parody" },
        { key: "japanese", label: "Japanese · formal precision parody" },
        { key: "dizycat", label: "DizyCat 🐈" },
        { key: "derp", label: "DERP mode" },
        { key: "incel", label: "INCEL · terminal-basement parody" },
        { key: "random_personality", label: "Random personality · no Drill" },
        { key: "drill", label: "DRILL SARGE · explicit only" },
        { key: "builtin", label: "Built-in quips" },
        { key: "compromise", label: "compromise NLP" },
        { key: "rita", label: "RiTa creative" },
        { key: "markov", label: "Markov corpus" },
        { key: "custom", label: "Custom hook" }
    ];

    const CURATED_STOP_WORDS = new Set([
        "about","after","again","also","and","are","because","been","before","being","but","can","cant","could","did","does","doing","dont","for","from","get","got","had","has","have","here","how","into","its","just","like","more","not","now","off","one","only","our","out","really","said","say","says","some","than","that","the","their","them","then","there","they","this","those","too","was","were","what","when","where","which","who","why","will","with","would","you","your","youre"
    ]);
    const CURATED_WEAK_TOPICS = new Set([
        "good","great","thing","things","people","right","wrong","maybe","think","know","want","need","yeah","okay","looks","look","make","made","going","come","back","much","time","chat","work","working"
    ]);
    const CURATED_SENSITIVE_PATTERN = /\b(?:address|postcode|phone|email|diagnos(?:ed|is)|cancer|hiv|autis(?:m|tic)|disabled|disability|pregnan(?:t|cy)|religion|muslims?|christians?|jews?|jewish|hindus?|sikhs?|gays?|lesbians?|bisexuals?|trans(?:gender)?|race|racial|ethnicity)\b/gi;
    const CURATED_PERSONAL_DATA_PATTERN = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b(?:\d{1,3}\.){3}\d{1,3}\b|(?:\+?\d[\d ()-]{7,}\d))/i;
    const BURN_ACCOUNT_PROTECTION_PATTERN = /\b(?:jews?|jewish|military|army|navy|marines?|air\s+force|kill(?:ed|ing|s)?|death|dead|die(?:d|s)?|murder(?:ed|ing|s)?|shoot(?:ing|s)?|shot)\b/i;
    const BURN_DIRECT_THREAT_PATTERN = /\b(?:(?:i(?:'ll|\s+will|\s+am\s+going\s+to)|we(?:'ll|\s+will)|gonna|going\s+to)\s+(?:fucking\s+)?(?:kill|murder|shoot)\s+(?:you|u|him|her|them|@[a-z0-9_.-]+)|(?:you|u|@[a-z0-9_.-]+)\s+(?:should|need\s+to|deserve\s+to)\s+(?:die|be\s+(?:killed|shot)))\b/i;

    function isBlockedBurnSubject(text) {
        const value = String(text || "").replace(/\s+/g, " ").trim();
        return !!value && (BURN_ACCOUNT_PROTECTION_PATTERN.test(value) || BURN_DIRECT_THREAT_PATTERN.test(value));
    }

    const CURATED_SEED_BLUEPRINTS = Object.freeze({
        weak_comeback: {
            baseScore: 25,
            openers: [
                "that comeback arrived with confidence",
                "that reply came charging in",
                "that response made a dramatic entrance",
                "that comeback used every ounce of momentum",
                "that reply showed up ready for battle"
            ],
            closers: [
                "and forgot to bring a point.",
                "then tripped over its own setup.",
                "but the punchline never made the journey.",
                "and still landed like an empty envelope.",
                "only to lose the argument on arrival.",
                "then quietly became evidence for the other side."
            ]
        },
        bad_argument: {
            baseScore: 24,
            openers: [
                "your argument is doing a lot of travelling",
                "that argument arrived carrying several assumptions",
                "your point took the scenic route through logic",
                "that reasoning started with a brave idea",
                "your argument built itself a grand entrance"
            ],
            closers: [
                "without ever reaching a conclusion.",
                "and misplaced the evidence on the way.",
                "before collapsing under the first follow-up.",
                "then discovered the foundation was decorative.",
                "and somehow argued against itself.",
                "but skipped the part where it becomes convincing."
            ]
        },
        overconfidence: {
            baseScore: 26,
            openers: [
                "the confidence is doing heroic work",
                "you delivered that with championship certainty",
                "that level of confidence deserves better material",
                "your certainty entered the room ten minutes early",
                "the swagger arrived in perfect condition"
            ],
            closers: [
                "while the reasoning is still looking for parking.",
                "but the point never passed inspection.",
                "and the evidence missed the appointment.",
                "while the argument waits outside without a ticket.",
                "but reality declined to sign the paperwork.",
                "and somehow the claim still came up empty."
            ]
        },
        repetition: {
            baseScore: 28,
            openers: [
                "you have brought that line around again",
                "the same point just completed another lap",
                "your repeat button is carrying the performance",
                "that sentence has returned for another shift",
                "you keep sending the same idea back out"
            ],
            closers: [
                "and it still has not collected a reason.",
                "as if mileage eventually becomes evidence.",
                "but repetition has not upgraded the material.",
                "and the sequel fixed none of the original problems.",
                "while the point remains exactly where you left it.",
                "and every replay makes the first version look generous."
            ]
        },
        contradiction: {
            baseScore: 28,
            openers: [
                "your latest version just met your earlier version",
                "the archive has introduced your two stories",
                "your current claim ran directly into the previous one",
                "you have managed to debate your own transcript",
                "the new story just bumped into the old story"
            ],
            closers: [
                "and neither one wants to explain the collision.",
                "so the cross-examination can basically run itself.",
                "and the contradiction did all the heavy lifting.",
                "leaving everyone else with nothing to add.",
                "and somehow both are asking us for trust.",
                "so pick one before they start arguing with each other."
            ]
        },
        moving_goalposts: {
            baseScore: 27,
            openers: [
                "the goalposts have packed another suitcase",
                "your point changed lanes the moment traffic appeared",
                "that argument just relocated its finish line",
                "you moved the target before the question landed",
                "the original claim has quietly left the building"
            ],
            closers: [
                "and the new destination still solves nothing.",
                "but the scoreboard remembers where it started.",
                "while the transcript keeps the original coordinates.",
                "and called the detour a victory.",
                "as though changing the test changes the result.",
                "but everyone can still see the tyre marks."
            ]
        },
        no_evidence: {
            baseScore: 27,
            openers: [
                "that claim arrived completely self-certified",
                "you submitted confidence where evidence was requested",
                "your proof appears to be an enthusiastic tone",
                "that conclusion skipped the supporting material",
                "you brought a very certain claim"
            ],
            closers: [
                "and left every receipt at home.",
                "then expected volume to pass as verification.",
                "without giving the facts a speaking role.",
                "and hoped nobody would inspect the packaging.",
                "but certainty is not a substitute for support.",
                "and somehow the source is still imaginary."
            ]
        },
        too_much_talking: {
            baseScore: 24,
            openers: [
                "that message covered impressive mileage",
                "you used a whole parade of words",
                "the speech kept expanding like it had a zoning permit",
                "that paragraph brought enough luggage for a holiday",
                "you gave the point every possible sentence"
            ],
            closers: [
                "and still never found the destination.",
                "to avoid saying one convincing thing.",
                "while the actual argument stayed remarkably small.",
                "and the conclusion somehow missed the bus.",
                "but quantity never introduced itself to quality.",
                "and buried the useful part beyond recovery."
            ]
        },
        failed_roast: {
            baseScore: 27,
            openers: [
                "you aimed for a roast and produced a status update",
                "that insult entered with theatrical lighting",
                "your punchline had a full runway",
                "you wound up that roast for maximum impact",
                "that shot had all the ceremony of a main event"
            ],
            closers: [
                "then forgot the part where it hurts.",
                "and still needed directions to the target.",
                "before landing safely in the audience.",
                "only to become its own punchline.",
                "and somehow missed from conversational distance.",
                "but the setup deserves compensation."
            ]
        },
        tag_pressure: {
            baseScore: 28,
            openers: [
                "another tag has entered the collection",
                "you rang the bell again with fresh confidence",
                "the notification count is becoming part of the joke",
                "you came back for another round voluntarily",
                "another tag and the subscription remains active"
            ],
            closers: [
                "and still brought the same amount of ammunition.",
                "so apparently the previous lesson needed a replay.",
                "while the comeback budget remains unchanged.",
                "and somehow made persistence the punchline.",
                "as if summoning me improves the material.",
                "and the queue is now roasting itself."
            ]
        },
        self_own: {
            baseScore: 27,
            openers: [
                "you accidentally supplied both sides of the joke",
                "that message did the opposition's work for them",
                "you walked directly into your own setup",
                "the self-own arrived fully assembled",
                "you managed to provide the rebuttal yourself"
            ],
            closers: [
                "so everyone else can take the round off.",
                "and even included complimentary evidence.",
                "before anybody else needed to swing.",
                "which is efficient if nothing else.",
                "and saved the room considerable effort.",
                "then signed your name underneath it."
            ]
        },
        topic_dodge: {
            baseScore: 26,
            openers: [
                "that subject change had visible tyre smoke",
                "you changed topics with impressive emergency speed",
                "the original question just watched you sprint past",
                "your answer took an immediate side exit",
                "the conversation asked one thing"
            ],
            closers: [
                "and you answered a safer question instead.",
                "but the first point is still standing there.",
                "while the transcript quietly keeps the route map.",
                "and the detour did not erase the destination.",
                "but changing rooms does not end the argument.",
                "and somehow you returned with everything except an answer."
            ]
        },
        finisher: {
            baseScore: 31,
            openers: [
                "fuck me, that was a shambles",
                "what a load of absolute shit",
                "you've properly fucked that one",
                "mate, you've talked yourself into a fucking corner",
                "that comeback is fucking bankrupt"
            ],
            closers: [
                "pack it in before the argument asks for annual leave.",
                "even your confidence wants its name taken off it.",
                "the sentence has already disowned the performance.",
                "you've finished your own argument for everyone.",
                "there's nothing left to rescue but your typing finger.",
                "call it there, because the material already has."
            ]
        },
        british_banter: {
            baseScore: 29,
            openers: [
                "sod off, you grotty wanker",
                "you absolute bellend",
                "have a word with yourself, you muppet",
                "steady on, you numpty",
                "pack it in, you pillock",
                "do one, you tosser",
                "listen to yourself, you daft git",
                "you absolute knobhead",
                "that's well bang out",
                "that's bang out of order"
            ],
            closers: [
                "that comeback couldn't organise a piss-up in a brewery.",
                "you've made a proper dog's dinner of that one.",
                "the point's gone walkabout and left you holding the bag.",
                "fookin' hell mate, even the excuse needs an excuse.",
                "sort yourself out before the sentence embarrasses you again."
            ]
        },
        generic_savage: {
            baseScore: 14,
            openers: [
                "that was a spectacular amount of confidence",
                "you made a very dramatic contribution",
                "the entrance promised considerably more",
                "that message arrived wearing its best suit",
                "you put real commitment into that delivery"
            ],
            closers: [
                "for such a tiny payload.",
                "and the point still missed roll call.",
                "before the material let the whole performance down.",
                "but the argument never showed up.",
                "and somehow the silence afterwards has more structure.",
                "only to leave the punchline doing paperwork."
            ]
        }
    });
    const CURATED_SEED_TEMPLATE_COUNT = Object.values(CURATED_SEED_BLUEPRINTS)
        .reduce((sum, spec) => sum + spec.openers.length * spec.closers.length, 0);
    const CURATED_SEED_BLOCKED_PATTERN = /\b(?:address|postcode|phone|email|diagnos(?:ed|is)|cancer|hiv|autis(?:m|tic)|disabled|disability|pregnan(?:t|cy)|religion|muslims?|christians?|jews?|jewish|hindus?|sikhs?|gays?|lesbians?|bisexuals?|trans(?:gender)?|race|racial|ethnicity)\b/i;
    const CURATED_HISTORY_RANKS = Object.freeze({
        repeat: 56,
        contradiction: 49,
        phrase: 44,
        callback: 40,
        topic: 35
    });

    function isSafeCuratedSeedTemplate(text) {
        const value = String(text || "").replace(/\s+/g, " ").trim();
        return value.length >= 18 && value.length <= 220 &&
            !CURATED_SEED_BLOCKED_PATTERN.test(value) &&
            !CURATED_PERSONAL_DATA_PATTERN.test(value);
    }
    let curatedSaveTimer = null;
    let pendingCuratedBurnSelection = null;

    function normalizeCuratedStore(value) {
        const store = value && typeof value === "object" ? value : {};
        if (!store.users || typeof store.users !== "object" || Array.isArray(store.users)) store.users = {};
        if (!store.seedUsage || typeof store.seedUsage !== "object" || Array.isArray(store.seedUsage)) store.seedUsage = {};
        store.recentSeedIds = Array.isArray(store.recentSeedIds) ? store.recentSeedIds.slice(-30) : [];
        store.recentSeedFamilies = Array.isArray(store.recentSeedFamilies) ? store.recentSeedFamilies.slice(-16) : [];
        store.schemaVersion = CURATED_BURNS_SCHEMA;
        store.lastProcessedSeq = Number(store.lastProcessedSeq) || 0;
        return store;
    }

    curatedBurnStore = normalizeCuratedStore(curatedBurnStore);

    function statCount(value) {
        return Number(value?.count) || 0;
    }

    function pruneStatMap(map, limit) {
        return Object.fromEntries(
            Object.entries(map || {})
                .sort((a, b) => statCount(b[1]) - statCount(a[1]))
                .slice(0, limit)
        );
    }

    function pruneCuratedStore() {
        curatedBurnStore = normalizeCuratedStore(curatedBurnStore);
        Object.values(curatedBurnStore.users).forEach((profile) => {
            profile.phrases = pruneStatMap(profile.phrases, 60);
            profile.topics = pruneStatMap(profile.topics, 50);
            profile.repeats = pruneStatMap(profile.repeats, 30);
            profile.recent = Array.isArray(profile.recent) ? profile.recent.slice(-18) : [];
            profile.burns = Array.isArray(profile.burns)
                ? profile.burns.slice(0, Math.max(3, Number(settings.curatedBurnMaxPerUser) || 12))
                : [];
        });
        const users = Object.entries(curatedBurnStore.users);
        if (users.length > CURATED_MAX_USERS) {
            users
                .sort((a, b) => String(b[1]?.updatedAt || "").localeCompare(String(a[1]?.updatedAt || "")))
                .slice(CURATED_MAX_USERS)
                .forEach(([key]) => delete curatedBurnStore.users[key]);
        }
        curatedBurnStore.recentSeedIds = [...new Set(curatedBurnStore.recentSeedIds || [])].slice(-30);
        curatedBurnStore.recentSeedFamilies = (curatedBurnStore.recentSeedFamilies || []).slice(-16);
        const seedUsage = Object.entries(curatedBurnStore.seedUsage || {});
        if (seedUsage.length > 300) {
            seedUsage
                .sort((a, b) => String(b[1]?.lastUsedAt || "").localeCompare(String(a[1]?.lastUsedAt || "")))
                .slice(300)
                .forEach(([id]) => delete curatedBurnStore.seedUsage[id]);
        }
    }

    function saveCuratedBurnStore() {
        if (curatedSaveTimer) {
            clearTimeout(curatedSaveTimer);
            curatedSaveTimer = null;
        }
        pruneCuratedStore();
        try {
            localStorage.setItem(CURATED_BURNS_KEY, JSON.stringify(curatedBurnStore));
        } catch (err) {
            console.warn("Curated burn memory storage full; trimming", err);
            Object.values(curatedBurnStore.users).forEach((profile) => {
                profile.phrases = pruneStatMap(profile.phrases, 30);
                profile.topics = pruneStatMap(profile.topics, 25);
                profile.repeats = pruneStatMap(profile.repeats, 15);
                profile.recent = Array.isArray(profile.recent) ? profile.recent.slice(-8) : [];
                profile.burns = Array.isArray(profile.burns) ? profile.burns.slice(0, 6) : [];
            });
            try {
                localStorage.setItem(CURATED_BURNS_KEY, JSON.stringify(curatedBurnStore));
            } catch (retryErr) {
                console.warn("Unable to persist curated burn memory", retryErr);
            }
        }
        updateCuratedBurnStatus();
    }

    function scheduleCuratedBurnSave() {
        if (curatedSaveTimer) return;
        curatedSaveTimer = setTimeout(saveCuratedBurnStore, 900);
    }

    function curatedBurnSummaryText() {
        const profiles = Object.values(curatedBurnStore?.users || {});
        const burns = profiles.reduce((sum, profile) => sum + (Array.isArray(profile.burns) ? profile.burns.length : 0), 0);
        const ready = profiles.filter((profile) => (profile.messageCount || 0) >= Math.max(3, Number(settings.curatedBurnMinMessages) || 8)).length;
        return `${profiles.length} learned users · ${ready} ready · ${burns} history burns · ${CURATED_SEED_TEMPLATE_COUNT.toLocaleString()} seed combinations`;
    }

    function updateCuratedBurnStatus(root = document) {
        const status = root?.querySelector?.("#curatedBurnStatus");
        if (status) status.textContent = curatedBurnSummaryText();
    }

    function normalizeCuratedText(text) {
        return String(text || "")
            .replace(/https?:\/\/\S+/gi, " ")
            .replace(/www\.\S+/gi, " ")
            .replace(/@[A-Za-z0-9_.-]+/g, " ")
            .replace(CURATED_SENSITIVE_PATTERN, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 220);
    }

    function isCuratableMessage(text) {
        const raw = String(text || "");
        if (CURATED_PERSONAL_DATA_PATTERN.test(raw)) return false;
        if (isBlockedBurnSubject(raw)) return false;
        const value = normalizeCuratedText(raw);
        return value.length >= 8 && value.length <= 220;
    }

    function curatedWords(text) {
        return normalizeCuratedText(text)
            .toLowerCase()
            .replace(/[^a-z0-9_' -]+/g, " ")
            .split(/\s+/)
            .map((word) => word.replace(/^'+|'+$/g, ""))
            .filter(Boolean);
    }

    function curatedTokens(text) {
        const useful = curatedWords(text).filter((word) => {
            const normalized = word.replace(/'/g, "");
            return word.length >= 4 &&
                !CURATED_STOP_WORDS.has(word) &&
                !CURATED_STOP_WORDS.has(normalized) &&
                !CURATED_WEAK_TOPICS.has(word) &&
                !CURATED_WEAK_TOPICS.has(normalized);
        });
        return [...new Set(useful)].slice(0, 14);
    }

    function curatedPhrases(text) {
        const words = curatedWords(text).slice(0, 30);
        const phrases = [];
        for (let size = 2; size <= 4; size += 1) {
            for (let i = 0; i <= words.length - size && phrases.length < 24; i += 1) {
                const slice = words.slice(i, i + size);
                if (!slice.some((word) => word.length >= 4 && !CURATED_STOP_WORDS.has(word))) continue;
                const phrase = slice.join(" ");
                if (phrase.length >= 8 && phrase.length <= 48) phrases.push(phrase);
            }
        }
        return [...new Set(phrases)].slice(0, 24);
    }

    function simpleCuratedHash(value) {
        let hash = 2166136261;
        for (const char of String(value || "")) {
            hash ^= char.charCodeAt(0);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    function incrementCuratedStat(map, key, seq, sample = "") {
        if (!key) return;
        const current = map[key] && typeof map[key] === "object" ? map[key] : { count: 0, seqs: [] };
        current.count = (Number(current.count) || 0) + 1;
        current.seqs = [...new Set([...(current.seqs || []), Number(seq) || 0].filter(Boolean))].slice(-5);
        if (sample && !current.sample) current.sample = sample.slice(0, 100);
        map[key] = current;
    }

    function getCuratedProfile(username, displayName = "") {
        const key = String(username || "").trim().toLowerCase();
        if (!key) return null;
        if (!curatedBurnStore.users[key]) {
            curatedBurnStore.users[key] = {
                username: key,
                displayName: displayName || key,
                messageCount: 0,
                lastSeq: 0,
                updatedAt: new Date().toISOString(),
                phrases: {},
                topics: {},
                repeats: {},
                recent: [],
                burns: []
            };
        }
        const profile = curatedBurnStore.users[key];
        if (displayName) profile.displayName = displayName;
        profile.phrases = profile.phrases || {};
        profile.topics = profile.topics || {};
        profile.repeats = profile.repeats || {};
        profile.recent = Array.isArray(profile.recent) ? profile.recent : [];
        profile.burns = Array.isArray(profile.burns) ? profile.burns : [];
        return profile;
    }

    function overlapCount(a, b) {
        const right = new Set(b || []);
        return [...new Set(a || [])].filter((value) => right.has(value)).length;
    }

    function classifyCuratedContext(ctx, profile) {
        const message = String(ctx?.message || "").replace(/\s+/g, " ").trim();
        const currentText = normalizeCuratedText(message);
        const tokens = curatedTokens(currentText);
        const tagCount = Math.max(1, Number(ctx?.tagCount) || 1);
        const repeatKey = currentText.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
        const repeatStat = repeatKey.length >= 12 ? profile?.repeats?.[simpleCuratedHash(repeatKey)] : null;
        const ranked = new Map([["bad_argument", 14], ["generic_savage", 8]]);
        const bump = (family, score) => ranked.set(family, Math.max(Number(ranked.get(family)) || 0, score));

        if (repeatStat && statCount(repeatStat) >= 2) bump("repetition", 38 + Math.min(8, statCount(repeatStat)));
        if (tagCount >= 2) bump("tag_pressure", 30 + Math.min(10, tagCount * 2));

        let contradiction = null;
        const currentNegated = /\b(?:no|not|never|isnt|isn't|arent|aren't|dont|don't|doesnt|doesn't|didnt|didn't|cant|can't|wont|won't|wouldnt|wouldn't|shouldnt|shouldn't)\b/i.test(currentText);
        for (const old of [...(profile?.recent || [])].reverse()) {
            if (!old?.text || old.text === currentText) continue;
            const overlap = overlapCount(tokens, old.tokens || []);
            if (overlap >= 2 && Boolean(old.negated) !== currentNegated) {
                contradiction = old;
                bump("contradiction", 37 + Math.min(8, overlap));
                break;
            }
        }

        if (/\b(?:not what i meant|different point|not the point|new point|anyway|besides|forget that|instead)\b/i.test(currentText)) {
            bump("moving_goalposts", 34);
            bump("topic_dodge", 31);
        }
        if (/\b(?:proof|source|evidence|trust me|everyone knows|everybody knows|take my word)\b/i.test(currentText)) bump("no_evidence", 33);
        if (/\b(?:obviously|clearly|definitely|certainly|fact|facts|period|guaranteed|no doubt|hundred percent|100%)\b/i.test(currentText)) bump("overconfidence", 31);
        if (currentText.length > 160 || currentText.split(/\s+/).filter(Boolean).length > 28) bump("too_much_talking", 32);
        if (/\b(?:roast|burn|owned|rekt|wrecked|comeback|clown|cope|cry more|sit down|destroyed)\b/i.test(currentText)) bump("failed_roast", 32);
        if (/\b(?:i dont care|i don't care|not mad|im not mad|i'm not mad|doesnt bother me|doesn't bother me|whatever)\b/i.test(currentText) && (tagCount >= 2 || currentText.length > 80)) bump("self_own", 34);
        if (/\b(?:anyway|what about|besides|different topic|change the subject|not the point)\b/i.test(currentText)) bump("topic_dodge", 33);
        if (currentText.split(/\s+/).filter(Boolean).length <= 6 || /^(?:lol|lmao|cope|clown|weak|boring|whatever|nice try)[!. ]*$/i.test(currentText)) bump("weak_comeback", 30);
        if (tagCount >= 3 || /\b(?:try harder|is that it|weak|boring|cope|owned|rekt|destroyed|comeback)\b/i.test(currentText)) bump("finisher", 36);
        bump("british_banter", tagCount >= 2 ? 31 : 27);

        return [...ranked.entries()]
            .map(([family, score]) => ({ family, score, repeatStat, contradiction }))
            .sort((a, b) => b.score - a.score);
    }

    function buildSeededCuratedCandidates(ctx, profile, contextRanking = classifyCuratedContext(ctx, profile)) {
        const seedUsage = curatedBurnStore.seedUsage || (curatedBurnStore.seedUsage = {});
        const recentSeedIds = curatedBurnStore.recentSeedIds || (curatedBurnStore.recentSeedIds = []);
        const recentSeedFamilies = curatedBurnStore.recentSeedFamilies || (curatedBurnStore.recentSeedFamilies = []);
        const contextScores = new Map((contextRanking || []).map((item) => [item.family, Number(item.score) || 0]));
        const wanted = [...new Set([...(contextRanking || []).slice(0, 4).map((item) => item.family), "generic_savage"])];
        const now = Date.now();
        const candidates = [];

        wanted.forEach((family) => {
            const spec = CURATED_SEED_BLUEPRINTS[family];
            if (!spec) return;
            spec.openers.forEach((opener, openerIndex) => {
                spec.closers.forEach((closer, closerIndex) => {
                    const template = `@{target} ${opener} ${closer}`;
                    if (!isSafeCuratedSeedTemplate(template)) return;
                    const id = `seed:${family}:${openerIndex}:${closerIndex}`;
                    const usage = seedUsage[id] || {};
                    const timesUsed = Number(usage.timesUsed) || 0;
                    const lastUsedAt = usage.lastUsedAt || null;
                    const usedAt = lastUsedAt ? Date.parse(lastUsedAt) : 0;
                    const exactRecentPenalty = recentSeedIds.includes(id) ? 32 : 0;
                    const familyRecentCount = recentSeedFamilies.filter((item) => item === family).length;
                    const familyPenalty = Math.min(14, familyRecentCount * 5);
                    const frequencyPenalty = Math.min(18, timesUsed * 3);
                    const timePenalty = usedAt && now - usedAt < 30 * 60 * 1000 ? 8 : 0;
                    const contextBoost = Math.min(12, Math.floor((contextScores.get(family) || 0) / 3));
                    const jitter = parseInt(simpleCuratedHash(`${ctx?.message || ""}:${id}`).slice(-2), 36) % 4;
                    candidates.push({
                        seeded: true,
                        live: false,
                        context: family,
                        rank: spec.baseScore + contextBoost + jitter - exactRecentPenalty - familyPenalty - frequencyPenalty - timePenalty,
                        burn: { id, kind: family, template, timesUsed, lastUsedAt }
                    });
                });
            });
        });
        return candidates.sort((a, b) => b.rank - a.rank).slice(0, 18);
    }

    function buildCuratedCandidates(profile) {
        const candidates = [];
        const existingUsage = new Map((profile.burns || []).map((burn) => [burn.id, burn]));
        const add = (candidate) => {
            if (!candidate?.id || !candidate.template) return;
            const old = existingUsage.get(candidate.id) || {};
            candidates.push({
                ...candidate,
                createdAt: old.createdAt || new Date().toISOString(),
                lastUsedAt: old.lastUsedAt || null,
                timesUsed: Number(old.timesUsed) || 0
            });
        };

        Object.entries(profile.repeats || {})
            .filter(([, stat]) => statCount(stat) >= 2 && stat?.sample)
            .sort((a, b) => statCount(b[1]) - statCount(a[1]))
            .slice(0, 4)
            .forEach(([hash, stat]) => add({
                id: `repeat:${hash}`,
                kind: "repeat",
                score: 12 + statCount(stat),
                sourceSeqs: stat.seqs || [],
                keywords: curatedTokens(stat.sample),
                template: `@{target} you've dropped that exact line ${statCount(stat)} times. Your copy button has more personality than the material.`
            }));

        Object.entries(profile.phrases || {})
            .filter(([phrase, stat]) => statCount(stat) >= 3 && curatedTokens(phrase).length >= 2)
            .sort((a, b) => statCount(b[1]) - statCount(a[1]))
            .slice(0, 5)
            .forEach(([phrase, stat]) => add({
                id: `phrase:${simpleCuratedHash(phrase)}`,
                kind: "phrase",
                score: 9 + statCount(stat),
                sourceSeqs: stat.seqs || [],
                keywords: curatedTokens(phrase),
                template: `@{target} “${phrase}” again? That's not a talking point, it's a screensaver.`
            }));

        Object.entries(profile.topics || {})
            .filter(([topic, stat]) => statCount(stat) >= 4 && !CURATED_WEAK_TOPICS.has(topic))
            .sort((a, b) => statCount(b[1]) - statCount(a[1]))
            .slice(0, 4)
            .forEach(([topic, stat]) => add({
                id: `topic:${topic}`,
                kind: "topic",
                score: 7 + statCount(stat),
                sourceSeqs: stat.seqs || [],
                keywords: [topic],
                template: `@{target} ${topic} again? Your entire personality is one tab stuck on autoplay.`
            }));

        const recent = (profile.recent || []).slice(-18);
        let contradictions = 0;
        for (let i = 0; i < recent.length && contradictions < 3; i += 1) {
            for (let j = i + 1; j < recent.length && contradictions < 3; j += 1) {
                const a = recent[i];
                const b = recent[j];
                const overlap = overlapCount(a.tokens, b.tokens);
                if (overlap < 2 || a.negated === b.negated || a.text === b.text) continue;
                const id = `flip:${Math.min(a.seq, b.seq)}:${Math.max(a.seq, b.seq)}`;
                add({
                    id,
                    kind: "contradiction",
                    score: 15 + overlap,
                    sourceSeqs: [a.seq, b.seq],
                    keywords: [...new Set([...(a.tokens || []), ...(b.tokens || [])])].slice(0, 8),
                    template: `@{target} pick a story and survive it — the archive has “${a.text}” and later “${b.text}”. Your own transcript just cross-examined you.`
                });
                contradictions += 1;
            }
        }

        const distinctive = [...recent]
            .reverse()
            .find((entry) => entry.text && entry.text.length >= 28 && (entry.tokens || []).length >= 3);
        if (distinctive) {
            add({
                id: `callback:${distinctive.seq}`,
                kind: "callback",
                score: 4,
                sourceSeqs: [distinctive.seq],
                keywords: distinctive.tokens || [],
                template: `@{target} “${distinctive.text}” was bad enough the first time. This sequel somehow found a basement.`
            });
        }

        const deduped = [];
        const seen = new Set();
        candidates
            .sort((a, b) => b.score - a.score || a.timesUsed - b.timesUsed)
            .forEach((candidate) => {
                if (seen.has(candidate.id)) return;
                seen.add(candidate.id);
                deduped.push(candidate);
            });
        return deduped.slice(0, Math.max(3, Number(settings.curatedBurnMaxPerUser) || 12));
    }

    function regenerateCuratedBurns(profile) {
        if (!profile) return;
        profile.burns = buildCuratedCandidates(profile);
        profile.updatedAt = new Date().toISOString();
    }

    function ingestCuratedRecord(record, options = {}) {
        if (!record?.username || !record?.message) return;
        const seq = Number(record.seq) || 0;
        curatedBurnStore.lastProcessedSeq = Math.max(Number(curatedBurnStore.lastProcessedSeq) || 0, seq);
        if (!settings.curatedBurnsEnabled && !options.force) {
            if (!options.deferSave) scheduleCuratedBurnSave();
            return;
        }
        if (!isCuratableMessage(record.message)) {
            if (!options.deferSave) scheduleCuratedBurnSave();
            return;
        }
        const profile = getCuratedProfile(record.username, record.displayName);
        if (!profile || (seq && seq <= (Number(profile.lastSeq) || 0))) return;

        const text = normalizeCuratedText(record.message);
        const tokens = curatedTokens(text);
        const negated = /\b(?:no|not|never|isnt|isn't|arent|aren't|dont|don't|doesnt|doesn't|didnt|didn't|cant|can't|wont|won't|wouldnt|wouldn't|shouldnt|shouldn't)\b/i.test(text);
        profile.messageCount = (Number(profile.messageCount) || 0) + 1;
        profile.lastSeq = seq || profile.lastSeq || 0;
        profile.updatedAt = record.capturedAt || new Date().toISOString();
        profile.recent.push({ seq, text: text.slice(0, 90), tokens, negated });
        profile.recent = profile.recent.slice(-18);

        tokens.forEach((token) => incrementCuratedStat(profile.topics, token, seq));
        curatedPhrases(text).forEach((phrase) => incrementCuratedStat(profile.phrases, phrase, seq));
        const normalizedRepeat = text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
        if (normalizedRepeat.length >= 12) {
            incrementCuratedStat(profile.repeats, simpleCuratedHash(normalizedRepeat), seq, text.slice(0, 80));
        }

        profile.phrases = pruneStatMap(profile.phrases, 60);
        profile.topics = pruneStatMap(profile.topics, 50);
        profile.repeats = pruneStatMap(profile.repeats, 30);

        const minMessages = Math.max(3, Number(settings.curatedBurnMinMessages) || 8);
        const refreshEvery = Math.max(1, Number(settings.curatedBurnRefreshEvery) || 3);
        if (!options.deferCurate && profile.messageCount >= minMessages && profile.messageCount % refreshEvery === 0) {
            regenerateCuratedBurns(profile);
        }
        if (!options.deferSave) scheduleCuratedBurnSave();
    }

    async function rebuildCuratedBurnsFromTranscript(reset = true) {
        await initializeChatTranscriptStorage();
        if (reset) curatedBurnStore = { schemaVersion: CURATED_BURNS_SCHEMA, lastProcessedSeq: 0, users: {}, seedUsage: {}, recentSeedIds: [], recentSeedFamilies: [] };
        const touched = new Set();
        const records = chatLog.slice();
        records.forEach((record) => {
            if (!record?.username) return;
            ingestCuratedRecord(record, { force: true, deferSave: true, deferCurate: true });
            touched.add(String(record.username).toLowerCase());
        });
        touched.forEach((username) => {
            const profile = curatedBurnStore.users[username];
            if (profile && profile.messageCount >= Math.max(3, Number(settings.curatedBurnMinMessages) || 8)) regenerateCuratedBurns(profile);
        });
        saveCuratedBurnStore();
        return curatedBurnSummaryText();
    }

    function backfillCuratedBurnsFromTranscript() {
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
    }

    function clearCuratedBurns(options = {}) {
        curatedBurnStore = { schemaVersion: CURATED_BURNS_SCHEMA, lastProcessedSeq: 0, users: {}, seedUsage: {}, recentSeedIds: [], recentSeedFamilies: [] };
        localStorage.removeItem(CURATED_BURNS_KEY);
        if (!options.silent) console.log("🔥 Curated burn memory cleared");
        updateCuratedBurnStatus();
    }

    function curatedHistoryRelevance(burn, currentTokens, currentText) {
        if (!burn) return 0;
        const overlap = overlapCount(currentTokens, burn.keywords || []);
        if (burn.kind === "contradiction") return overlap >= 2 ? 14 + Math.min(8, overlap * 2) : 0;
        if (burn.kind === "repeat") return overlap >= 2 ? 12 + Math.min(8, overlap * 2) : 0;
        if (burn.kind === "phrase") return overlap >= 2 ? 9 + Math.min(6, overlap * 2) : 0;
        if (burn.kind === "callback") return overlap >= 1 ? 7 + Math.min(6, overlap * 2) : 0;
        if (burn.kind === "topic") return overlap >= 1 && String(currentText || "").length >= 6 ? 6 + Math.min(4, overlap) : 0;
        return 0;
    }

    function selectCuratedBurn(ctx) {
        return selectCuratedBurnWithOptions(ctx);
    }

    function selectCuratedBurnWithOptions(ctx, options = {}) {
        if (!settings.curatedBurnsEnabled || (!options.allowEngineDisabled && settings.burnEnginesEnabled?.curated === false)) return null;
        const username = String(ctx.from || "").trim().toLowerCase();
        const profile = curatedBurnStore.users?.[username] || null;
        const minMessages = Math.max(3, Number(settings.curatedBurnMinMessages) || 8);
        const incomingBlocked = isBlockedBurnSubject(ctx.message || "");
        const profileReady = !incomingBlocked && !!profile && (Number(profile.messageCount) || 0) >= minMessages;

        const target = String(ctx.target || profile?.displayName || username || "there")
            .replace(/^@+/, "")
            .replace(/[^A-Za-z0-9_.-]/g, "")
            .slice(0, 40) || "there";
        const currentTokens = curatedTokens(ctx.message || "");
        const currentText = normalizeCuratedText(ctx.message || "");
        const tagCount = Math.max(1, Number(ctx.tagCount) || 1);
        const quote = incomingBlocked ? "" : safeBurnQuote(ctx.message || "");
        const contextRanking = incomingBlocked
            ? [{ family: "british_banter", score: 34 }, { family: "generic_savage", score: 32 }]
            : classifyCuratedContext(ctx, profile);
        const primaryContext = contextRanking[0]?.family || "generic_savage";
        const ranked = profileReady && Array.isArray(profile.burns)
            ? profile.burns.map((burn) => {
                const relevance = curatedHistoryRelevance(burn, currentTokens, currentText);
                return {
                    burn,
                    live: false,
                    seeded: false,
                    relevance,
                    context: primaryContext,
                    rank: (CURATED_HISTORY_RANKS[burn.kind] || 32) + Math.min(10, Number(burn.score) || 0) + relevance + overlapCount(currentTokens, burn.keywords || []) * 4 - (Number(burn.timesUsed) || 0) * 3
                };
            }).filter((entry) => entry.relevance > 0)
            : [];

        const repeatKey = currentText.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
        const repeatStat = !incomingBlocked && repeatKey.length >= 12 ? profile?.repeats?.[simpleCuratedHash(repeatKey)] : null;
        if (repeatStat && statCount(repeatStat) >= 2) {
            ranked.push({
                live: true,
                seeded: false,
                context: "repetition",
                rank: 74 + Math.min(10, statCount(repeatStat)),
                burn: {
                    id: `live-repeat:${simpleCuratedHash(repeatKey)}`,
                    kind: "repeat",
                    timesUsed: 0,
                    template: `@{target} you've posted that exact line ${statCount(repeatStat)} times. Your copy button is carrying the whole act.`
                }
            });
        }

        const liveContradiction = !incomingBlocked ? contextRanking.find((item) => item.family === "contradiction" && item.contradiction) : null;
        if (liveContradiction) {
            ranked.push({
                live: true,
                seeded: false,
                context: "contradiction",
                rank: 68,
                burn: {
                    id: `live-contradiction:${simpleCuratedHash(`${username}:${currentText}`)}`,
                    kind: "contradiction",
                    timesUsed: 0,
                    template: `@{target} your latest version just ran into your earlier one. Pick a lane before the transcript does it for you.`
                }
            });
        }

        if (quote) {
            const template = tagCount >= 5
                ? `@{target} “${quote}” — tag #${tagCount}. You're not fighting back; you're renewing the subscription.`
                : tagCount >= 3
                    ? `@{target} “${quote}” — tag #${tagCount} and you're still bringing your own punchline.`
                    : tagCount >= 2
                        ? `@{target} “${quote}” — back again? You didn't bring a comeback, you brought another target.`
                        : `@{target} “${quote}” — you tagged me just to volunteer as the punchline.`;
            ranked.push({
                live: true,
                seeded: false,
                context: tagCount >= 2 ? "tag_pressure" : primaryContext,
                rank: 42 + Math.min(tagCount, 6),
                burn: {
                    id: `live-quote:${simpleCuratedHash(`${quote}:${tagCount}`)}`,
                    kind: "callback",
                    timesUsed: 0,
                    template
                }
            });
        }

        const seeded = buildSeededCuratedCandidates(ctx, profile, contextRanking);
        ranked.push(...seeded);
        if (!ranked.length) return null;
        ranked.sort((a, b) => b.rank - a.rank || (Number(a.burn.timesUsed) || 0) - (Number(b.burn.timesUsed) || 0));
        const bestRank = ranked[0]?.rank;
        const pool = ranked.filter((entry) => entry.rank >= bestRank - 2).slice(0, 4);
        const selected = pool[Math.floor(Math.random() * pool.length)];
        const chosen = selected?.burn;
        if (!chosen) return null;

        pendingCuratedBurnSelection = {
            kind: selected.seeded ? "seed" : selected.live ? "live" : "history",
            username,
            burnId: chosen.id,
            family: chosen.kind || selected.context || primaryContext,
            strategy: selected.seeded ? `seed:${chosen.kind}` : selected.live ? `live:${chosen.kind}` : `history:${chosen.kind}`,
            context: selected.context || primaryContext
        };
        return String(chosen.template || "").replace(/\{target\}/g, target).slice(0, 240);
    }

    function markCuratedBurnUsed(selection) {
        if (!selection?.burnId) return;
        if (selection.kind === "seed") {
            curatedBurnStore = normalizeCuratedStore(curatedBurnStore);
            const old = curatedBurnStore.seedUsage[selection.burnId] || {};
            const usedAt = new Date().toISOString();
            curatedBurnStore.seedUsage[selection.burnId] = {
                family: selection.family || old.family || "generic_savage",
                timesUsed: (Number(old.timesUsed) || 0) + 1,
                lastUsedAt: usedAt
            };
            curatedBurnStore.recentSeedIds = [
                ...(curatedBurnStore.recentSeedIds || []).filter((id) => id !== selection.burnId),
                selection.burnId
            ].slice(-30);
            curatedBurnStore.recentSeedFamilies = [
                ...(curatedBurnStore.recentSeedFamilies || []),
                selection.family || "generic_savage"
            ].slice(-16);
            scheduleCuratedBurnSave();
            return;
        }
        if (selection.kind === "live" || !selection.username) return;
        const profile = curatedBurnStore.users?.[selection.username];
        const burn = profile?.burns?.find((item) => item.id === selection.burnId);
        if (!burn) return;
        burn.timesUsed = (Number(burn.timesUsed) || 0) + 1;
        burn.lastUsedAt = new Date().toISOString();
        profile.updatedAt = burn.lastUsedAt;
        scheduleCuratedBurnSave();
    }

    /***********************
     * Export / Import / Backup
     ***********************/
    function settingsSnapshot() {
        return { blockedUsers, settings, curatedBurns: curatedBurnStore };
    }

    function getBackupStatusText() {
        const raw = localStorage.getItem(BACKUP_KEY);
        if (!raw) return `Last local backup: none yet · ${BACKUP_FILENAME}`;
        try {
            const backup = JSON.parse(raw);
            const meta = backup?.backupMeta;
            if (!meta?.savedAt) return `Last local backup: legacy backup present · ${BACKUP_FILENAME}`;
            const saved = new Date(meta.savedAt);
            const when = Number.isNaN(saved.getTime()) ? meta.savedAt : saved.toLocaleString();
            return `Last local backup: ${when} · ${meta.filename || BACKUP_FILENAME}`;
        } catch (err) {
            console.warn("Unable to read local backup metadata", err);
            return `Last local backup: unreadable · ${BACKUP_FILENAME}`;
        }
    }

    function updateBackupStatus(root = document) {
        const status = root?.querySelector?.("#lastAutoBackupStatus");
        if (status) status.textContent = getBackupStatusText();
    }

    function saveLocalBackup(reason = "auto") {
        const backup = {
            ...settingsSnapshot(),
            backupMeta: {
                schemaVersion: 1,
                filename: BACKUP_FILENAME,
                savedAt: new Date().toISOString(),
                reason
            }
        };
        localStorage.setItem(BACKUP_KEY, JSON.stringify(backup));
        updateBackupStatus();
        return backup;
    }

    function serializeData() {
        return JSON.stringify(settingsSnapshot(), null, 2);
    }

    function fallbackDownload(filename, blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => {
            try {
                URL.revokeObjectURL(url);
            } catch (cleanupErr) {
                console.warn("Failed to revoke download URL", cleanupErr);
            }
        }, 0);
    }

    function triggerDownload(filename, serialized, options = {}) {
        const silent = Boolean(options.silent);
        const prompt = options.prompt !== false;
        const blob = new Blob([serialized], { type: options.mimeType || "application/json;charset=utf-8" });

        if (typeof GM_download === "function") {
            const url = URL.createObjectURL(blob);
            const cleanup = () => {
                try {
                    URL.revokeObjectURL(url);
                } catch (cleanupErr) {
                    console.warn("Failed to revoke download URL", cleanupErr);
                }
            };
            try {
                GM_download({
                    url,
                    name: filename,
                    saveAs: silent ? false : prompt,
                    onload: cleanup,
                    ontimeout: cleanup,
                    onerror: (err) => {
                        cleanup();
                        if (silent) {
                            console.warn("Silent download failed via GM_download", err);
                        } else {
                            console.warn("GM_download failed, falling back to anchor download", err);
                            fallbackDownload(filename, blob);
                        }
                    }
                });
                return;
            } catch (err) {
                cleanup();
                if (silent) {
                    console.warn("Silent GM_download threw", err);
                } else {
                    console.warn("GM_download threw, falling back to anchor download", err);
                    fallbackDownload(filename, blob);
                }
                return;
            }
        }

        if (silent) {
            console.warn("Silent export requested but GM_download is unavailable; skipping download UI");
            return;
        }

        fallbackDownload(filename, blob);
    }

    function exportData(filename = "dizygotic-rumble-chat-tool-settings.json", options = {}) {
        const serialized = serializeData();
        saveLocalBackup("manual-export");
        triggerDownload(filename, serialized, options);
        return serialized;
    }

    function importData(file, callback) {
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const data = JSON.parse(e.target.result);
                if (data.blockedUsers && data.settings) {
                    blockedUsers = data.blockedUsers;
                    settings = Object.assign({}, defaultSettings, data.settings);
                    settings.burnEnginesEnabled = Object.assign({}, defaultSettings.burnEnginesEnabled, data.settings?.burnEnginesEnabled || {});
                    settings.curatedBurnReviewBeforeUse = false;
                    if (data.curatedBurns && typeof data.curatedBurns === "object") {
                        curatedBurnStore = normalizeCuratedStore(data.curatedBurns);
                        saveCuratedBurnStore();
                    }
                    saveBlocklist();
                    saveSettings();
                    if (audio) {
                        audio.src = settings.notificationSound || "";
                        audio.volume = typeof settings.notificationVolume === "number" ? settings.notificationVolume : 1;
                    }
                    alert("✅ Import successful! Blocklist & settings restored.");
                    refreshBlockedMessages();
                    if (callback) callback(true);
                } else {
                    alert("⚠️ Invalid file format.");
                    if (callback) callback(false);
                }
            } catch (err) {
                console.error(err);
                alert("⚠️ Failed to parse file.");
                if (callback) callback(false);
            }
        };
        reader.readAsText(file);
    }

    let backupIntervalId = null;
    function setupAutoBackup() {
        if (backupIntervalId) clearInterval(backupIntervalId);
        backupIntervalId = null;
        if (settings.autoBackupMinutes > 0) {
            backupIntervalId = setInterval(() => {
                saveLocalBackup("auto");
                console.log(`💾 Auto-backup saved locally as ${BACKUP_FILENAME}`);
            }, settings.autoBackupMinutes * 60 * 1000);
        }
    }

    /***********************
     * Notifications
     ***********************/
    let audio;

    function initAudio() {
        if (audio) return;
        audio = new Audio();
        if (document.body) {
            document.body.appendChild(audio);
        } else {
            window.addEventListener("DOMContentLoaded", () => document.body.appendChild(audio));
        }
        if (settings.notificationSound) {
            audio.src = settings.notificationSound;
        }
        audio.volume = typeof settings.notificationVolume === "number" ? settings.notificationVolume : 1;
    }

    function triggerNotification(title, body) {
        try {
            if (Notification && Notification.permission === "granted") {
                new Notification(title, { body });
            } else if (Notification && Notification.permission !== "denied") {
                Notification.requestPermission().then((p) => {
                    if (p === "granted") new Notification(title, { body });
                });
            }
        } catch (e) {
            /* ignore */
        }
    }

    function maybeNotify(type, username, snippet) {
        initAudio();

        if (type === "highlight") {
            if (settings.notifyOnHighlight) {
                triggerNotification(`Highlight: ${username}`, snippet);
            }

            if (
                settings.highlightNotificationSoundEnabled &&
                settings.notificationSound &&
                audio &&
                audio.src
            ) {
                try {
                    audio.currentTime = 0;
                    audio.play().catch(() => {});
                } catch (err) {
                    console.warn("Highlight sound failed:", err);
                }
            }
        } else if (type === "keyword") {
            if (settings.notifyOnKeyword) {
                triggerNotification(`Keyword matched`, snippet);
            }
        }
    }

    /***********************
     * UI helpers
     ***********************/
    function applyThemeToPanel(panel) {
        panel.style.background = settings.darkMode ? "#131313" : "#fff";
        panel.style.color = settings.darkMode ? "#eaeaea" : "#000";
        panel.querySelectorAll("input, textarea, select").forEach((el) => {
            el.style.background = settings.darkMode ? "#202020" : "#fff";
            el.style.color = settings.darkMode ? "#eaeaea" : "#000";
            el.style.border = `1px solid ${settings.darkMode ? "#333" : "#ccc"}`;
        });
        panel.querySelectorAll("button").forEach((btn) => {
            btn.style.background = settings.darkMode ? "#2f2f2f" : "#f5f5f5";
            btn.style.color = settings.darkMode ? "#fff" : "#000";
        });
    }

    /***********************
     * Settings panel
     ***********************/
    function showSettingsPanel() {
        const existing = document.querySelector("#rumbleBlockerSettingsPanel");
        if (existing) return;

        const panel = document.createElement("div");
        panel.id = "rumbleBlockerSettingsPanel";
        panel.style.position = "fixed";
        panel.style.top = "50%";
        panel.style.left = "50%";
        panel.style.transform = "translate(-50%,-50%) scale(0.98)";
        panel.style.zIndex = 100000;
        panel.style.width = "520px";
        panel.style.maxHeight = "80vh";
        panel.style.overflowY = "auto";
        panel.style.padding = "18px";
        panel.style.boxShadow = "0 8px 40px rgba(0,0,0,0.5)";
        panel.style.borderRadius = "10px";
        panel.style.border = "1px solid rgba(0,0,0,0.12)";
        panel.style.transition = "all 0.18s ease";

        panel.innerHTML = `
            <h3 style="margin:0 0 8px 0">⚙️ Dizygotic Rumble Chat Tool Settings </h3>

            <div style="font-size:13px;line-height:1.4">
            <b>Blocked Users</b><br>
            <textarea id="blockedUsersInput" style="width:100%;height:60px;margin-top:6px">${blockedUsers.join(", ")}</textarea>
            <div style="height:10px"></div>

            <b>Keyword Blocking</b>
            <div style="font-size:12px;color:gray;margin-bottom:6px">Comma-separated keywords. Messages containing them will be handled per action.</div>
            <textarea id="blockedKeywordsInput" style="width:100%;height:50px">${settings.blockedKeywords.join(", ")}</textarea>
            <div style="display:flex;gap:10px;align-items:center;margin-top:6px">
                <label><input type="radio" name="keywordAction" value="hide" id="keywordActionHide"> Hide message</label>
                <label><input type="radio" name="keywordAction" value="mask" id="keywordActionMask"> Mask words</label>
            </div>
            <div style="height:12px"></div>

            <b>Highlighted Users</b>
            <div style="font-size:12px;color:gray;margin-bottom:6px">Comma-separated usernames to highlight.</div>
            <textarea id="highlightedUsersInput" style="width:100%;height:50px">${settings.highlightedUsers.join(", ")}</textarea>
            <div style="display:flex;gap:10px;align-items:center;margin-top:6px">
                <label>Highlight color: <input type="color" id="highlightColorInput" value="${settings.highlightColor}"></label>
                <label style="margin-left:auto"><input type="checkbox" id="notifyOnHighlightInput"${settings.notifyOnHighlight ? " checked" : ""}> Notify on highlight</label>
                <label><input type="checkbox" id="highlightSoundInput"${settings.highlightNotificationSoundEnabled ? " checked" : ""}> Enable sound on highlight</label>
            </div>
            <div style="height:12px"></div>
            <b>Display & Behavior</b>
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:6px">
                <label><input type="checkbox" id="compactModeInput"${settings.compactMode ? " checked" : ""}> Compact mode</label>
                <label><input type="checkbox" id="showTimestampsInput"${settings.showTimestamps ? " checked" : ""}> Show timestamps</label>
                <label><input type="checkbox" id="use24hTimeInput"${settings.use24hTime ? " checked" : ""}> 24h time</label>
                <label><input type="checkbox" id="autoScrollLockInput"${settings.autoScrollLock ? " checked" : ""}> Lock autoscroll</label>
                <label><input type="checkbox" id="hideSystemMessagesInput"${settings.hideSystemMessages ? " checked" : ""}> Hide system messages</label>
            </div>
            <div style="height:12px"></div>

            <b>Outgoing message style</b>
            <div style="font-size:12px;color:gray;margin-top:3px">These controls format messages you send. They no longer repaint everybody's chat on your screen.</div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px">
                <label>Font</label>
                <select id="outgoingFontStyleInput">
                    <option value="default"${settings.outgoingFontStyle === "default" ? " selected" : ""}>Rumble default</option>
                    <option value="bold"${settings.outgoingFontStyle === "bold" ? " selected" : ""}>𝐁𝐨𝐥𝐝 Unicode</option>
                    <option value="sans"${settings.outgoingFontStyle === "sans" ? " selected" : ""}>𝖲𝖺𝗇𝗌 Unicode</option>
                    <option value="sansBold"${settings.outgoingFontStyle === "sansBold" ? " selected" : ""}>𝗦𝗮𝗻𝘀 𝗕𝗼𝗹𝗱 Unicode</option>
                    <option value="mono"${settings.outgoingFontStyle === "mono" ? " selected" : ""}>𝙼𝚘𝚗𝚘 Unicode</option>
                    <option value="fullwidth"${settings.outgoingFontStyle === "fullwidth" ? " selected" : ""}>Ｆｕｌｌｗｉｄｔｈ</option>
                    <option value="circled"${settings.outgoingFontStyle === "circled" ? " selected" : ""}>Ⓒⓘⓡⓒⓛⓔⓓ</option>
                </select>
                <label>Colour mode</label>
                <select id="chatTextModeInput">
                    <option value="default"${settings.chatTextMode === "default" ? " selected" : ""}>Rumble default</option>
                    <option value="single"${settings.chatTextMode === "single" ? " selected" : ""}>Single colour</option>
                    <option value="rainbow"${settings.chatTextMode === "rainbow" ? " selected" : ""}>Rainbow - each character</option>
                    <option value="multi"${settings.chatTextMode === "multi" ? " selected" : ""}>Multi-colour - each character</option>
                </select>
                <label>Colour</label>
                <input type="color" id="chatTextColorInput" value="${settings.chatTextColor || "#ffffff"}">
            </div>
            <div style="margin-top:6px">
                <label style="font-size:12px">Multi-colour palette (comma-separated CSS colours)</label>
                <input id="chatMultiPaletteInput" value="${String(settings.chatMultiPalette || "").replace(/"/g, "&quot;")}" style="width:100%;margin-top:3px">
            </div>
            <div style="font-size:12px;color:gray;margin-top:3px">Unicode font styles are carried in the outgoing text itself and are visible to other viewers. Mentions, URLs and :emote: tokens stay plain so Rumble can parse them. Colour modes are applied to Rumble's rich/contenteditable composer when that composer exposes formatting; a plain textarea cannot carry CSS colour. Burn Bot uses this same outgoing formatter.</div>
            <div style="height:12px"></div>

            <b>Passive chat recorder</b>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:6px">
                <label><input type="checkbox" id="chatRecorderEnabledInput"${settings.chatRecorderEnabled ? " checked" : ""}> Record public chat locally</label>
                <span id="chatStorageStatus" style="font-size:12px;color:gray">${chatStorageSummaryText()}</span>
            </div>
            <div style="font-size:12px;color:gray;margin-top:4px">Transcript history is stored in IndexedDB with no app-level message-count ceiling. Browser storage quota still applies; a write problem is shown here instead of silently trimming old messages.</div>
            <div style="height:12px"></div>

            <b>Curated burn memory</b>
            <div style="font-size:12px;color:gray;margin-top:3px">Curated v2 learns reusable callbacks from the locally recorded public chat and adds ${CURATED_SEED_TEMPLATE_COUNT.toLocaleString()} seed combinations for new or low-history users. Live repeats, contradictions and relevant history rank ahead of context-matched seeds; recent seed IDs and families are penalised to keep replies varied. Messages that look sensitive or contain personal contact/network data are ignored.</div>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:7px">
                <label><input type="checkbox" id="curatedBurnsEnabledInput"${settings.curatedBurnsEnabled ? " checked" : ""}> Learn automatically</label>
                <label>Min messages</label>
                <input type="number" id="curatedBurnMinMessagesInput" min="3" max="100" value="${settings.curatedBurnMinMessages}" style="width:64px">
                <label>Refresh every</label>
                <input type="number" id="curatedBurnRefreshEveryInput" min="1" max="50" value="${settings.curatedBurnRefreshEvery}" style="width:58px">
                <label>Max/user</label>
                <input type="number" id="curatedBurnMaxPerUserInput" min="3" max="40" value="${settings.curatedBurnMaxPerUser}" style="width:58px">
            </div>
            <div id="curatedBurnStatus" style="font-size:12px;color:gray;margin-top:5px">${curatedBurnSummaryText()}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
                <button type="button" id="rebuildCuratedBurnsBtn">Rebuild from transcript</button>
                <button type="button" id="clearCuratedBurnsBtn">Clear curated bank</button>
            </div>
            <div style="height:12px"></div>

            <b>Auto-burn bot</b>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px">
                <label>My Rumble username</label>
                <input id="myNicknameInput" value="${String(settings.myNickname || "").replace(/"/g, "&quot;")}" placeholder="auto-detected after you send" style="width:170px">
                <span id="autoBurnRuntimeStatus" style="font-size:12px;color:gray">${burnRuntimeStatusText()}</span>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px">
                <label><input type="checkbox" id="autoBurnToggle"${settings.autoBurnEnabled ? " checked" : ""}> Reply when someone tags me</label>
                <label>Cooldown</label>
                <input type="number" id="autoBurnCooldownInput" min="5" value="${settings.autoBurnCooldownSeconds}" style="width:70px">
                <label>Reply delay (sec)</label>
                <input type="number" id="autoBurnReplyDelayInput" min="0" max="120" step="1" value="${settings.autoBurnReplyDelaySeconds}" style="width:70px">
                <label>Primary engine</label>
                <select id="autoBurnEngineSelect">${burnEngineRecommendations.map((r) => `<option value="${r.key}"${settings.autoBurnEngine === r.key ? " selected" : ""}>${r.label}</option>`).join("")}</select>
            </div>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:7px;font-size:12px">
                ${burnEngineRecommendations.map((r) => `<label><input type="checkbox" data-burn-engine-toggle="${r.key}"${settings.burnEnginesEnabled?.[r.key] !== false ? " checked" : ""}> ${r.label}</label>`).join("")}
            </div>
            <div style="font-size:12px;color:gray;margin-top:4px">Reply delay controls how long Burn Bot waits after generating a reply before it sends (5 seconds by default); Cooldown remains the minimum gap after a successful send. The Primary engine runs first. Personality engines share the Curated/history brain, then restyle the safe result; Random personality never includes DRILL SARGE. Curated favours live quote-backs, exact-repeat evidence and repeated-tag escalation; savage built-ins are the first fallback. Weak or malformed generated mashups are discarded instead of sent. Burn replies still wait for an empty idle composer rather than trampling a message you are typing.</div>
            <div style="font-size:12px;color:gray;margin-top:4px">Successful Burn Bot echoes are labelled with engine, target, font style, strategy and context in transcript exports so future live tests can be analysed directly.</div>
            <div style="font-size:12px;color:gray;margin-top:4px">Compromise and RiTa are loaded by Tampermonkey via @require. Markov uses a local word-chain generator so a CDN package change cannot kill the whole userscript.</div>
            <textarea id="burnMarkovCorpusInput" placeholder="Optional Markov corpus — one burn/example per line" style="width:100%;height:58px;margin-top:6px">${settings.burnMarkovCorpus || ""}</textarea>
            <div style="height:12px"></div>

            <b>Collapse long messages</b>
            <div style="font-size:12px;color:gray;margin-bottom:6px">Collapse messages longer than X characters (0 = off).</div>
            <input type="number" id="collapseLengthInput" value="${settings.collapseLength}" style="width:100px">

            <div style="height:12px"></div>

            <div style="display:flex;flex-direction:column;gap:6px">
                <div style="display:flex;flex-direction:column;align-items:flex-start;gap:4px">
                    <b>Sound Settings</b>
                    <label>Sound: <input type="file" id="notificationSoundInput" accept="audio/*"></label>
                    <div style="display:flex;align-items:center;gap:10px;margin-top:4px;width:100%">
                        <label for="notificationVolumeInput" style="font-size:12px;color:gray">Volume</label>
                        <input type="range" id="notificationVolumeInput" min="0" max="100" value="${Math.round((settings.notificationVolume ?? 1) * 100)}" style="flex:1">
                        <span id="notificationVolumeValue" style="min-width:32px;text-align:right;font-size:12px;color:gray">${Math.round((settings.notificationVolume ?? 1) * 100)}%</span>
                    </div>
                </div>
                <b>Keyword Notifications</b>
                <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
                    <label><input type="checkbox" id="notifyOnKeywordInput"${settings.notifyOnKeyword ? " checked" : ""}> Notify on keyword match</label>
                </div>
            </div>

            <div style="height:14px"></div>

            <b>Backup & Sync</b>
            <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
                <label>Auto-backup minutes (0 = off)</label>
                <input type="number" id="autoBackupInput" value="${settings.autoBackupMinutes}" style="width:80px;margin-left:auto">
            </div>
            <div id="lastAutoBackupStatus" style="font-size:12px;color:gray;margin-top:5px"></div>
            <div style="font-size:12px;color:gray;margin-top:3px">Automatic backups silently overwrite one local browser backup slot. Only manual Export opens a file download.</div>

            <div style="height:14px"></div>

            <b>Other</b>
            <div style="margin-top:6px;font-size:13px">
              <label><input type="checkbox" id="darkModeInput"${settings.darkMode ? " checked" : ""}> Dark mode</label>
            </div>

            <div style="height:14px"></div>

            <div id="statsSummary" style="font-size:13px;color:gray;margin-bottom:8px"></div>
            </div>
        `;

        applyThemeToPanel(panel);
        updateBackupStatus(panel);
        updateCuratedBurnStatus(panel);
        updateChatStorageStatus(panel);

        panel.querySelector("#keywordActionHide").checked = settings.keywordAction === "hide";
        panel.querySelector("#keywordActionMask").checked = settings.keywordAction === "mask";

        function createAccentButton(text, onClick, bgColor, icon = "") {
            const btn = document.createElement("button");
            btn.innerHTML = icon ? `${icon} ${text}` : text;
            btn.style.margin = "4px";
            btn.style.padding = "8px 14px";
            btn.style.border = "none";
            btn.style.borderRadius = "6px";
            btn.style.cursor = "pointer";
            btn.style.fontSize = "13px";
            btn.style.fontWeight = "600";
            btn.style.transition = "all 0.18s ease";
            btn.style.boxShadow = "0 2px 6px rgba(0,0,0,0.15)";
            btn.style.background = bgColor || (settings.darkMode ? "#444" : "#f5f5f5");
            btn.style.color = "#fff";
            btn.addEventListener("click", onClick);
            btn.addEventListener("mouseover", () => (btn.style.transform = "scale(1.03)"));
            btn.addEventListener("mouseout", () => (btn.style.transform = ""));
            return btn;
        }

        function savePanelSettings() {
            blockedUsers = panel
                .querySelector("#blockedUsersInput")
                .value.split(",")
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean);
            settings.blockedKeywords = panel
                .querySelector("#blockedKeywordsInput")
                .value.split(",")
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean);
            settings.keywordAction = panel.querySelector("#keywordActionMask").checked ? "mask" : "hide";
            settings.highlightedUsers = panel
                .querySelector("#highlightedUsersInput")
                .value.split(",")
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean);
            settings.highlightColor = panel.querySelector("#highlightColorInput").value || settings.highlightColor;
            settings.compactMode = !!panel.querySelector("#compactModeInput").checked;
            settings.showTimestamps = !!panel.querySelector("#showTimestampsInput").checked;
            settings.use24hTime = !!panel.querySelector("#use24hTimeInput").checked;
            settings.autoScrollLock = !!panel.querySelector("#autoScrollLockInput").checked;
            settings.hideSystemMessages = !!panel.querySelector("#hideSystemMessagesInput").checked;
            settings.collapseLength = parseInt(panel.querySelector("#collapseLengthInput").value, 10) || 0;
            settings.notifyOnKeyword = !!panel.querySelector("#notifyOnKeywordInput").checked;
            settings.notifyOnHighlight = !!panel.querySelector("#notifyOnHighlightInput").checked;
            settings.highlightNotificationSoundEnabled = !!panel.querySelector("#highlightSoundInput").checked;
            settings.chatRecorderEnabled = !!panel.querySelector("#chatRecorderEnabledInput")?.checked;
            settings.myNickname = sanitizeNickname(panel.querySelector("#myNicknameInput")?.value || settings.myNickname) || "";
            settings.outgoingFontStyle = panel.querySelector("#outgoingFontStyleInput")?.value || "default";
            settings.chatTextMode = panel.querySelector("#chatTextModeInput")?.value || "default";
            settings.chatTextColor = panel.querySelector("#chatTextColorInput")?.value || "#ffffff";
            settings.chatMultiPalette = panel.querySelector("#chatMultiPaletteInput")?.value?.trim() || defaultSettings.chatMultiPalette;
            settings.curatedBurnsEnabled = !!panel.querySelector("#curatedBurnsEnabledInput")?.checked;
            settings.curatedBurnMinMessages = Math.max(3, Math.min(100, parseInt(panel.querySelector("#curatedBurnMinMessagesInput")?.value, 10) || 8));
            settings.curatedBurnRefreshEvery = Math.max(1, Math.min(50, parseInt(panel.querySelector("#curatedBurnRefreshEveryInput")?.value, 10) || 3));
            settings.curatedBurnMaxPerUser = Math.max(3, Math.min(40, parseInt(panel.querySelector("#curatedBurnMaxPerUserInput")?.value, 10) || 12));
            settings.autoBurnEnabled = !!panel.querySelector("#autoBurnToggle")?.checked;
            settings.autoBurnCooldownSeconds = Math.max(5, parseInt(panel.querySelector("#autoBurnCooldownInput")?.value, 10) || 45);
            const replyDelaySeconds = parseInt(panel.querySelector("#autoBurnReplyDelayInput")?.value, 10);
            settings.autoBurnReplyDelaySeconds = Number.isFinite(replyDelaySeconds)
                ? Math.max(0, Math.min(120, replyDelaySeconds))
                : 5;
            settings.autoBurnEngine = panel.querySelector("#autoBurnEngineSelect")?.value || "builtin";
            settings.burnEnginesEnabled = Object.assign({}, defaultSettings.burnEnginesEnabled);
            panel.querySelectorAll("[data-burn-engine-toggle]").forEach((input) => {
                settings.burnEnginesEnabled[input.dataset.burnEngineToggle] = !!input.checked;
            });
            settings.burnMarkovCorpus = panel.querySelector("#burnMarkovCorpusInput")?.value || "";
            const volumeSlider = panel.querySelector("#notificationVolumeInput");
            const parsedVolume = volumeSlider ? parseInt(volumeSlider.value, 10) : NaN;
            const normalizedVolume = Number.isFinite(parsedVolume)
                ? Math.min(100, Math.max(0, parsedVolume)) / 100
                : typeof settings.notificationVolume === "number"
                ? settings.notificationVolume
                : 1;
            settings.notificationVolume = normalizedVolume;
            settings.autoBackupMinutes = parseInt(panel.querySelector("#autoBackupInput").value, 10) || 0;
            settings.darkMode = !!panel.querySelector("#darkModeInput").checked;

            saveBlocklist();
            saveSettings();
            setupAutoBackup();
            if (audio) {
                audio.volume = settings.notificationVolume;
            }

            const soundFileInput = panel.querySelector("#notificationSoundInput");
            if (soundFileInput && soundFileInput.files && soundFileInput.files[0]) {
                const f = soundFileInput.files[0];
                const reader = new FileReader();
                reader.onload = function (ev) {
                    settings.notificationSound = ev.target.result;
                    initAudio();
                    audio.src = settings.notificationSound;
                    audio.volume = settings.notificationVolume;
                    saveSettings();
                    alert("✅ Settings saved (and sound saved).");
                    refreshBlockedMessages();
                };
                reader.readAsDataURL(f);
            } else {
                alert("✅ Settings saved.");
                refreshBlockedMessages();
            }

            panel.style.opacity = "0";
            setTimeout(() => panel.remove(), 180);
        }

        function clearAllSettings() {
            if (!confirm("Clear blocklist & reset settings to defaults?")) return;
            blockedUsers = [];
            settings = Object.assign({}, defaultSettings);
            settings.burnEnginesEnabled = Object.assign({}, defaultSettings.burnEnginesEnabled);
            clearCuratedBurns({ silent: true });
            if (audio) audio.src = "";
            saveBlocklist();
            saveSettings();
            setupAutoBackup();
            refreshBlockedMessages();
            panel.style.opacity = "0";
            setTimeout(() => panel.remove(), 180);
        }

        const buttonRow = document.createElement("div");
        buttonRow.style.display = "flex";
        buttonRow.style.gap = "6px";
        buttonRow.style.justifyContent = "flex-end";
        buttonRow.style.flexWrap = "wrap";

        buttonRow.appendChild(createAccentButton("Save", () => savePanelSettings(), "#4caf50", "💾"));
        buttonRow.appendChild(createAccentButton("Clear All", () => clearAllSettings(), "#f44336", "🗑️"));
        buttonRow.appendChild(createAccentButton("Export", () => exportData(), "#2196f3", "📤"));
        buttonRow.appendChild(createAccentButton("Chat JSON", () => { void exportChatLog("json"); }, "#673ab7", "🧾"));
        buttonRow.appendChild(createAccentButton("Chat CSV", () => { void exportChatLog("csv"); }, "#3f51b5", "📊"));
        buttonRow.appendChild(createAccentButton("Clear Chat Log", async () => { if (!confirm("Clear saved local chat transcript?")) return; const cleared = await clearChatLog(); alert(cleared ? "✅ Chat transcript cleared." : "⚠️ Transcript could not be cleared from browser storage."); }, "#795548", "🧹"));
        buttonRow.appendChild(
            createAccentButton(
                "Import",
                () => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = ".json";
                    input.onchange = (e) => {
                        const file = e.target.files[0];
                        if (file) importData(file, () => panel.remove());
                    };
                    input.click();
                },
                "#ff9800",
                "📥"
            )
        );
        buttonRow.appendChild(
            createAccentButton(
                "Close",
                () => {
                    panel.style.opacity = "0";
                    setTimeout(() => panel.remove(), 180);
                },
                "#9e9e9e",
                "❌"
            )
        );

        panel.appendChild(buttonRow);

        const volumeSliderEl = panel.querySelector("#notificationVolumeInput");
        const volumeValueEl = panel.querySelector("#notificationVolumeValue");
        if (volumeSliderEl && volumeValueEl) {
            const syncVolumeDisplay = () => {
                const sliderValue = Math.min(100, Math.max(0, parseInt(volumeSliderEl.value, 10) || 0));
                volumeSliderEl.value = sliderValue;
                volumeValueEl.textContent = `${sliderValue}%`;
                if (audio) {
                    audio.volume = sliderValue / 100;
                }
            };
            volumeSliderEl.addEventListener("input", syncVolumeDisplay);
            syncVolumeDisplay();
        }

        const rebuildCuratedBtn = panel.querySelector("#rebuildCuratedBurnsBtn");
        if (rebuildCuratedBtn) {
            rebuildCuratedBtn.addEventListener("click", async () => {
                settings.curatedBurnsEnabled = !!panel.querySelector("#curatedBurnsEnabledInput")?.checked;
                settings.curatedBurnMinMessages = Math.max(3, Math.min(100, parseInt(panel.querySelector("#curatedBurnMinMessagesInput")?.value, 10) || 8));
                settings.curatedBurnRefreshEvery = Math.max(1, Math.min(50, parseInt(panel.querySelector("#curatedBurnRefreshEveryInput")?.value, 10) || 3));
                settings.curatedBurnMaxPerUser = Math.max(3, Math.min(40, parseInt(panel.querySelector("#curatedBurnMaxPerUserInput")?.value, 10) || 12));
                saveSettings();
                await rebuildCuratedBurnsFromTranscript(true);
                updateCuratedBurnStatus(panel);
            });
        }
        const clearCuratedBtn = panel.querySelector("#clearCuratedBurnsBtn");
        if (clearCuratedBtn) {
            clearCuratedBtn.addEventListener("click", () => {
                if (!confirm("Clear all locally learned curated burns? The transcript itself will be kept.")) return;
                clearCuratedBurns();
                updateCuratedBurnStatus(panel);
            });
        }

        const stats = panel.querySelector("#statsSummary");
        stats.innerText = `Blocked users: ${blockedUsers.length} · Keywords: ${settings.blockedKeywords.length} · Highlighted: ${settings.highlightedUsers.length} · Logged chat: ${chatLog.length}`;

        document.body.appendChild(panel);
        setTimeout(() => {
            panel.style.opacity = "1";
            panel.style.transform = "translate(-50%,-50%) scale(1)";
        }, 10);
    }

    /***********************
     * Floating settings button
     ***********************/
    function addFloatingSettingsButton() {
        if (document.querySelector("#floatingBlockerSettingsBtn")) return;

        const savedPos = JSON.parse(localStorage.getItem(BTN_POS_KEY) || "{}");
        const btn = document.createElement("button");
        btn.id = "floatingBlockerSettingsBtn";
        btn.textContent = "⚙️ Chat Settings";
        btn.style.position = "fixed";
        btn.style.top = savedPos.top || "10px";
        btn.style.left = savedPos.left || "10px";
        btn.style.zIndex = 100000;
        btn.style.background = settings.darkMode ? "#444" : "#ffe680";
        btn.style.color = settings.darkMode ? "#fff" : "#000";
        btn.style.fontWeight = "600";
        btn.style.cursor = "move";
        btn.style.padding = "8px 14px";
        btn.style.border = "none";
        btn.style.borderRadius = "8px";
        btn.style.boxShadow = "0 6px 18px rgba(0,0,0,0.2)";
        btn.style.transition = "all 0.12s ease";

        document.body.appendChild(btn);

        let isDragging = false;
        let offsetX = 0;
        let offsetY = 0;
        let hasMoved = false;

        btn.addEventListener("mousedown", (e) => {
            isDragging = true;
            offsetX = e.clientX - btn.getBoundingClientRect().left;
            offsetY = e.clientY - btn.getBoundingClientRect().top;
            hasMoved = false;
            btn.style.transition = "none";
            e.preventDefault();
        });

        document.addEventListener("mousemove", (e) => {
            if (!isDragging) return;
            hasMoved = true;
            btn.style.left = `${e.clientX - offsetX}px`;
            btn.style.top = `${e.clientY - offsetY}px`;
        });

        document.addEventListener("mouseup", () => {
            if (!isDragging) return;
            isDragging = false;
            localStorage.setItem(
                BTN_POS_KEY,
                JSON.stringify({ top: btn.style.top, left: btn.style.left })
            );
            setTimeout(() => (btn.style.transition = "all 0.12s ease"), 10);
        });

        btn.addEventListener("click", () => {
            if (!hasMoved) showSettingsPanel();
        });
    }

    function ensureFloatingSettingsButton() {
        addFloatingSettingsButton();
        setInterval(() => {
            if (!document.getElementById("floatingBlockerSettingsBtn")) {
                console.warn("⚠️ Floating settings button missing — restoring...");
                addFloatingSettingsButton();
            }
        }, 5000);
    }

    /***********************
     * Helpers
     ***********************/
    function formatTime(date) {
        if (settings.use24hTime) {
            const hh = String(date.getHours()).padStart(2, "0");
            const mm = String(date.getMinutes()).padStart(2, "0");
            return `${hh}:${mm}`;
        }
        let hh = date.getHours();
        const mm = String(date.getMinutes()).padStart(2, "0");
        const ampm = hh >= 12 ? "PM" : "AM";
        hh = hh % 12 || 12;
        return `${hh}:${mm} ${ampm}`;
    }

    function applyHighlightColor(baseColor, alpha = 0.25) {
        if (baseColor.startsWith("#")) {
            let hex = baseColor.slice(1);
            if (hex.length === 3) hex = hex.split("").map((h) => h + h).join("");
            const bigint = parseInt(hex, 16);
            const r = (bigint >> 16) & 255;
            const g = (bigint >> 8) & 255;
            const b = bigint & 255;
            return {
                rgba: `rgba(${r}, ${g}, ${b}, ${alpha})`,
                rgb: [r, g, b],
                border: `rgba(${r}, ${g}, ${b}, 0.6)`,
                glow: `0 0 10px rgba(${r}, ${g}, ${b}, 0.7)`
            };
        }
        return {
            rgba: baseColor,
            rgb: [255, 255, 255],
            border: baseColor,
            glow: `0 0 10px ${baseColor}`
        };
    }

    function getContrastTextColor([r, g, b]) {
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance > 0.6 ? "#000000" : "#ffffff";
    }

    function parseColourPalette(value) {
        const colours = String(value || "")
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean);
        return colours.length ? colours : ["#ff4d4d", "#ffa64d", "#ffff4d", "#4dff88", "#4dd2ff", "#8c4dff", "#ff4dd2"];
    }

    const OUTGOING_FONT_RANGES = {
        bold: { upper: 0x1D400, lower: 0x1D41A, digit: 0x1D7CE },
        sans: { upper: 0x1D5A0, lower: 0x1D5BA, digit: 0x1D7E2 },
        sansBold: { upper: 0x1D5D4, lower: 0x1D5EE, digit: 0x1D7EC },
        mono: { upper: 0x1D670, lower: 0x1D68A, digit: 0x1D7F6 }
    };

    function mapOutgoingCharacter(char, style) {
        const code = char.codePointAt(0);
        if (style === "fullwidth") {
            if (char === " ") return "\u3000";
            return code >= 0x21 && code <= 0x7E ? String.fromCodePoint(code + 0xFEE0) : char;
        }
        if (style === "circled") {
            if (code >= 65 && code <= 90) return String.fromCodePoint(0x24B6 + code - 65);
            if (code >= 97 && code <= 122) return String.fromCodePoint(0x24D0 + code - 97);
            if (code === 48) return "⓪";
            if (code >= 49 && code <= 57) return String.fromCodePoint(0x2460 + code - 49);
            return char;
        }
        const range = OUTGOING_FONT_RANGES[style];
        if (!range) return char;
        if (code >= 65 && code <= 90) return String.fromCodePoint(range.upper + code - 65);
        if (code >= 97 && code <= 122) return String.fromCodePoint(range.lower + code - 97);
        if (code >= 48 && code <= 57) return String.fromCodePoint(range.digit + code - 48);
        return char;
    }

    const OUTGOING_PROTECTED_TOKEN_RE = /(https?:\/\/\S+|www\.\S+|@[A-Za-z0-9_.-]+|:[A-Za-z0-9_+-]+:)/gi;

    function formatOutgoingText(text) {
        const style = settings.outgoingFontStyle || "default";
        const raw = String(text || "");
        if (style === "default") return raw;
        return raw
            .split(OUTGOING_PROTECTED_TOKEN_RE)
            .map((part, index) => index % 2 ? part : [...part].map((char) => mapOutgoingCharacter(char, style)).join(""))
            .join("");
    }

    function simpleMarkovGenerate(lines) {
        const corpus = (Array.isArray(lines) ? lines : [])
            .map((line) => String(line || "").replace(/\s+/g, " ").trim())
            .filter(Boolean);
        if (!corpus.length) return null;

        const transitions = new Map();
        const starts = [];
        corpus.forEach((line) => {
            const words = line.split(" ").filter(Boolean);
            if (words.length < 2) return;
            starts.push(words.slice(0, 2));
            for (let i = 0; i < words.length - 2; i += 1) {
                const key = `${words[i].toLowerCase()}\u0001${words[i + 1].toLowerCase()}`;
                if (!transitions.has(key)) transitions.set(key, []);
                transitions.get(key).push(words[i + 2]);
            }
        });
        if (!starts.length) return corpus[Math.floor(Math.random() * corpus.length)] || null;

        const start = starts[Math.floor(Math.random() * starts.length)];
        const out = [...start];
        while (out.length < 18) {
            const key = `${String(out[out.length - 2]).toLowerCase()}\u0001${String(out[out.length - 1]).toLowerCase()}`;
            const next = transitions.get(key);
            if (!next || !next.length) break;
            const word = next[Math.floor(Math.random() * next.length)];
            out.push(word);
            if (/[.!?]$/.test(word) && out.length >= 5) break;
        }
        const result = out.join(" ").trim();
        if (out.length < 5 || !/[.!?]$/.test(result)) {
            return corpus[Math.floor(Math.random() * corpus.length)] || result || null;
        }
        return result;
    }

    /***********************
     * Auto-burn bot helpers
     ***********************/
    const builtInBurns = [
        ({ target }) => `@${target} you tagged me for that? I've seen stronger openings from a doorstop.`,
        ({ target }) => `@${target} all that confidence just to trip over the first sentence.`,
        ({ target }) => `@${target} you came in swinging and somehow hit your own argument.`,
        ({ target }) => `@${target} that sounded better in your head. It should have stayed there.`,
        ({ target }) => `@${target} big entrance, tiny payload.`,
        ({ target }) => `@${target} you keep confusing volume with impact.`,
        ({ target }) => `@${target} that comeback arrived pre-defeated.`,
        ({ target }) => `@${target} you brought confidence to a competence fight.`,
        ({ target }) => `@${target} you're not cooking; you're setting off the smoke alarm.`,
        ({ target }) => `@${target} if that was the punchline, the setup deserves compensation.`,
        ({ target }) => `@${target} you tagged me and then submitted that? Self-sabotage with notifications on.`,
        ({ target }) => `@${target} every word showed up; the point never did.`,
        ({ target }) => `@${target} your ego wrote a cheque that sentence couldn't cash.`,
        ({ target }) => `@${target} you didn't miss the point; you drove past it with the windows down.`,
        ({ target }) => `@${target} that take has the structural integrity of wet cardboard.`,
        ({ target }) => `@${target} your comeback has all the menace of a low-battery warning.`,
        ({ target }) => `@${target} you arrived loud enough to hide how empty that was.`,
        ({ target }) => `@${target} the confidence is doing unpaid overtime for the material.`,
        ({ target }) => `@${target} that wasn't a mic drop; you just lost grip of the conversation.`,
        ({ target }) => `@${target} you keep serving leftovers and acting surprised nobody asked for seconds.`
    ];
    const britishBuiltInBurns = [
        ({ target }) => `@${target} sod off, you grotty wanker; that comeback couldn't organise a piss-up in a brewery.`,
        ({ target }) => `@${target} you absolute bellend, you've made a proper dog's dinner of that argument.`,
        ({ target }) => `@${target} have a word with yourself, you muppet; the point's gone walkabout.`,
        ({ target }) => `@${target} steady on, you numpty. All that noise and the argument still forgot its trousers.`,
        ({ target }) => `@${target} pack it in, you pillock; even your confidence looks embarrassed.`,
        ({ target }) => `@${target} do one, you tosser. That was well bang out and still somehow boring.`,
        ({ target }) => `@${target} listen to yourself, you daft git; the sentence has grassed you up.`,
        ({ target }) => `@${target} you absolute knobhead, that point couldn't find its arse with both hands.`,
        ({ target }) => `@${target} fookin' hell mate, you've turned a simple comeback into unpaid admin.`,
        ({ target }) => `@${target} that's bang out of order — mostly because you made logic watch it happen.`,
        ({ target }) => `@${target} sort yourself out, mate; you're arguing like the pub's closing and you've lost your coat.`,
        ({ target }) => `@${target} absolute state of that reply. Give your keyboard a day off.`
    ];

    const BURN_PERSONALITY_KEYS = Object.freeze([
        "british",
        "scottish",
        "irish",
        "welsh",
        "canadian",
        "southern",
        "australian",
        "american",
        "indian_callcentre",
        "chinese",
        "japanese",
        "dizycat",
        "derp",
        "incel"
    ]);

    const burnPersonalityBanks = {
        british: [
            ({ target, core }) => `@${target} ${core} You absolute bellend.`,
            ({ target, core }) => `@${target} ${core} Have a word with yourself, you muppet.`,
            ({ target, core }) => `@${target} ${core} Sod off, you grotty wanker; that was well bang out.`,
            ({ target, core }) => `@${target} ${core} Proper dog's dinner of a comeback, mate.`
        ],
        scottish: [
            ({ target, core }) => `@${target} ${core} That's pure mince, mate.`,
            ({ target, core }) => `@${target} ${core} Away and gie us peace; the point's missed the last bus.`,
            ({ target, core }) => `@${target} ${core} Absolute state of that; even the confidence wants its coat.`,
            ({ target, core }) => `@${target} ${core} Aye, tremendous noise. Shame the argument never clocked in.`
        ],
        irish: [
            ({ target, core }) => `@${target} ${core} Ah here, you've made a right bags of that one.`,
            ({ target, core }) => `@${target} ${core} That's fierce confidence for a sentence still looking for its point.`,
            ({ target, core }) => `@${target} ${core} Would you listen to yourself; the comeback has wandered off entirely.`,
            ({ target, core }) => `@${target} ${core} Grand performance, tiny argument.`
        ],
        welsh: [
            ({ target, core }) => `@${target} ${core} Tidy effort, shame the argument took the scenic route and never arrived.`,
            ({ target, core }) => `@${target} ${core} Lovely rhythm, absolutely no point in the chorus.`,
            ({ target, core }) => `@${target} ${core} That's a lot of confidence echoing round an empty argument.`,
            ({ target, core }) => `@${target} ${core} Fair play, you've polished the sentence and misplaced the meaning.`
        ],
        canadian: [
            ({ target, core }) => `@${target} ${core} Sorry, bud, even politeness can't rescue that one.`,
            ({ target, core }) => `@${target} ${core} That's colder than a February car seat and half as useful.`,
            ({ target, core }) => `@${target} ${core} Respectfully, bud, the argument has fallen through the ice.`,
            ({ target, core }) => `@${target} ${core} Sorry to interrupt, but your point still hasn't shown up.`
        ],
        southern: [
            ({ target, core }) => `@${target} ${core} Son, that argument's got fewer legs than a lawn chair in a tornado.`,
            ({ target, core }) => `@${target} ${core} I've seen smarter decisions made behind a bait shop at 2am.`,
            ({ target, core }) => `@${target} ${core} Bless your heart, you brought confidence to a facts fight.`,
            ({ target, core }) => `@${target} ${core} That comeback's held together with duct tape, moonshine and poor judgement.`,
            ({ target, core }) => `@${target} ${core} That comeback needs a tow truck and a prayer.`
        ],
        australian: [
            ({ target, core }) => `@${target} ${core} Mate, that take's absolutely cooked.`,
            ({ target, core }) => `@${target} ${core} You've come charging in like a ute on wet clay and found no grip at all.`,
            ({ target, core }) => `@${target} ${core} Fair dinkum, that's a heroic amount of confidence for bugger-all point.`,
            ({ target, core }) => `@${target} ${core} Mate, even the barbie's got a better argument than that.`
        ],
        american: [
            ({ target, core }) => `@${target} ${core} Buddy, that's premium confidence on a clearance-rack argument.`,
            ({ target, core }) => `@${target} ${core} You brought stadium-volume confidence to a parking-lot point.`,
            ({ target, core }) => `@${target} ${core} That's a supersized comeback with a value-menu payload.`,
            ({ target, core }) => `@${target} ${core} Big pitch, zero product. The sales team is furious.`
        ],
        indian_callcentre: [
            ({ target, core }) => `@${target} Hello sir, ${core} Kindly restart your argument and try again.`,
            ({ target, core }) => `@${target} Ticket #404: point not found. ${core} Please remain on the line while we escalate your confidence.`,
            ({ target, core }) => `@${target} Thank you for calling. ${core} Have you tried turning your argument off and on again?`,
            ({ target, core }) => `@${target} Verification failed: ${core} Your confidence is valid but the point cannot be authenticated.`
        ],
        chinese: [
            ({ target, core }) => `@${target} Quality control has reviewed this: ${core} Specification requires at least one point.`,
            ({ target, core }) => `@${target} ${core} That argument left the factory with three screws missing and no inspection sticker.`,
            ({ target, core }) => `@${target} Incoming inspection result: ${core} Confidence passed; logic returned to supplier.`,
            ({ target, core }) => `@${target} ${core} Precision was requested and your argument wandered off the assembly line.`
        ],
        japanese: [
            ({ target, core }) => `@${target} Formal notice: ${core} Precision was requested; a rough draft arrived wearing a necktie.`,
            ({ target, core }) => `@${target} The manual had one instruction: make a point. ${core} You still opened the wrong page.`,
            ({ target, core }) => `@${target} Meeting summary: ${core} Presentation immaculate; argument absent.`,
            ({ target, core }) => `@${target} ${core} Very precise confidence, remarkably approximate reasoning.`
        ],
        dizycat: [
            ({ target, core }) => `@${target} DizyCat reviewed this: ${core} *slowly pushes the argument off the table*`,
            ({ target, core }) => `@${target} ${core} DizyCat has placed your comeback in the litter tray for further analysis.`,
            ({ target, core }) => `@${target} DizyCat heard that, blinked once, and chose the cardboard box instead. ${core}`,
            ({ target, core }) => `@${target} ${core} *DizyCat stares at you, then deliberately faces the wall*`
        ],
        derp: [
            ({ target, core }) => `@${target} DERP STATUS: ${core} Confidence.exe is responding; logic.exe is not.`,
            ({ target, core }) => `@${target} ${core} DERP MODE detected: keyboard connected, point unavailable.`,
            ({ target, core }) => `@${target} DERP diagnostic complete: ${core} Please reinstall common sense and reboot.`,
            ({ target, core }) => `@${target} ${core} Task failed successfully. DERP level: professional.`
        ],
        incel: [
            ({ target, core }) => `@${target} ${core} Forty-seven forum tabs open and not one contains a point.`,
            ({ target, core }) => `@${target} ${core} You've min-maxed confidence and left social firmware at version 0.1.`,
            ({ target, core }) => `@${target} ${core} Basement Wi-Fi strong, argument signal extremely weak.`,
            ({ target, core }) => `@${target} ${core} That's three paragraphs of forum confidence compressed into one bad take.`
        ]
    };

    let lastBurnPersonalityUsed = "";

    function personalityCoreText(ctx) {
        const curated = selectCuratedBurnWithOptions(ctx, { allowEngineDisabled: true });
        const body = String(curated || "")
            .replace(/^@[A-Za-z0-9_.-]+\s+/, "")
            .replace(/\s+/g, " ")
            .trim();
        return (body || "that argument arrived with confidence and forgot the point").slice(0, 82);
    }

    function renderPersonalityBurn(engine, ctx) {
        const selectedEngine = engine === "random_personality"
            ? BURN_PERSONALITY_KEYS[Math.floor(Math.random() * BURN_PERSONALITY_KEYS.length)]
            : engine;
        if (!BURN_PERSONALITY_KEYS.includes(selectedEngine)) return null;
        const bank = burnPersonalityBanks[selectedEngine] || [];
        if (!bank.length) return null;
        lastBurnPersonalityUsed = selectedEngine;
        const core = personalityCoreText(ctx);
        const template = bank[Math.floor(Math.random() * bank.length)];
        return template ? template({ ...ctx, core }) : null;
    }

    function drillPrivateName(target) {
        const clean = String(target || "recruit").replace(/^@+/, "").replace(/[^A-Za-z0-9_.-]/g, "");
        if (/^joker747$/i.test(clean)) return "JOKER";
        const withoutDigits = clean.replace(/\d+$/g, "");
        return (withoutDigits || clean || "RECRUIT").slice(0, 18).toUpperCase();
    }

    const drillSargeBurns = [
        ({ target }) => `@${target} PRIVATE ${drillPrivateName(target)}! FRONT AND CENTRE! Was that a comeback or did your sentence report for inspection unfinished?`,
        ({ target }) => `@${target} PRIVATE ${drillPrivateName(target)}! I asked for a point, not a bag of loose words rolling round the parade square!`,
        ({ target }) => `@${target} PRIVATE ${drillPrivateName(target)}! STAND STILL WHILE YOUR ARGUMENT TRIES TO REMEMBER WHY IT TURNED UP!`,
        ({ target }) => `@${target} PRIVATE ${drillPrivateName(target)}! That reply is a disgrace to organised shouting!`,
        ({ target }) => `@${target} PRIVATE ${drillPrivateName(target)}! Your confidence passed inspection and your reasoning went missing!`,
        ({ target }) => `@${target} PRIVATE ${drillPrivateName(target)}! Pick that comeback up, dust it off, and apologise to the English language!`,
        ({ target }) => `@${target} PRIVATE ${drillPrivateName(target)}! I've seen queue barriers hold a straighter line than that argument!`,
        ({ target }) => `@${target} PRIVATE ${drillPrivateName(target)}! You arrived ready for inspection with half a thought and no paperwork!`,
        ({ target }) => `@${target} PRIVATE ${drillPrivateName(target)}! Stop polishing the confidence and fix the bloody sentence!`,
        ({ target }) => `@${target} PRIVATE ${drillPrivateName(target)}! That comeback needs three laps round the car park and a written apology!`
    ];

    let lastBurnTimestamp = 0;
    const RECENT_BURN_LIMIT = 12;
    let recentBurnResponses = [];
    let lastBurnEngineUsed = "none";
    const burnTagPressure = new Map();
    const BURN_PRESSURE_WINDOW_MS = 20 * 60 * 1000;
    const BURN_QUOTE_SENSITIVE_PATTERN = /\b(?:address|postcode|phone|email|diagnos(?:ed|is)|cancer|hiv|autis(?:m|tic)|disabled|disability|pregnan(?:t|cy)|religion|muslims?|christians?|jews?|jewish|hindus?|sikhs?|gays?|lesbians?|bisexuals?|trans(?:gender)?|race|racial|ethnicity)\b/i;

    function safeBurnQuote(text, maxLength = 72) {
        const raw = String(text || "").replace(/\s+/g, " ").trim();
        if (!raw || CURATED_PERSONAL_DATA_PATTERN.test(raw) || BURN_QUOTE_SENSITIVE_PATTERN.test(raw) || isBlockedBurnSubject(raw)) return "";
        const cleaned = normalizeCuratedText(raw)
            .replace(/^[-–—:;,.!? ]+|[-–—:;,.!? ]+$/g, "")
            .trim();
        if (cleaned.length < 6) return "";
        if (cleaned.length <= maxLength) return cleaned;
        const clipped = cleaned.slice(0, maxLength + 1);
        const cut = clipped.lastIndexOf(" ");
        const bounded = cut >= Math.floor(maxLength * 0.6) ? clipped.slice(0, cut) : cleaned.slice(0, maxLength);
        return `${bounded.trim()}…`;
    }

    function noteBurnPressure(username) {
        const key = String(username || "").trim().toLowerCase();
        if (!key) return 1;
        const now = Date.now();
        const previous = burnTagPressure.get(key);
        const count = previous && now - previous.lastAt <= BURN_PRESSURE_WINDOW_MS
            ? Math.min(9, previous.count + 1)
            : 1;
        burnTagPressure.set(key, { count, lastAt: now });
        if (burnTagPressure.size > 200) {
            [...burnTagPressure.entries()]
                .sort((a, b) => a[1].lastAt - b[1].lastAt)
                .slice(0, burnTagPressure.size - 160)
                .forEach(([staleKey]) => burnTagPressure.delete(staleKey));
        }
        return count;
    }

    function cleanGeneratedBurn(text, target) {
        let candidate = String(text || "")
            .replace(/\s+/g, " ")
            .replace(/\s+([,.;!?])/g, "$1")
            .trim();
        if (!candidate) return null;
        if (!/^@[A-Za-z0-9_.-]+\b/.test(candidate)) candidate = `@${target} ${candidate}`;
        if (candidate.length < 18 || candidate.length > 240) return null;
        if (isBlockedBurnSubject(candidate) || BURN_DIRECT_THREAT_PATTERN.test(candidate)) return null;
        const body = candidate.replace(/^@[A-Za-z0-9_.-]+\s+/, "");
        if (body.split(/\s+/).filter(Boolean).length < 4) return null;
        if (/\b(?:and|but|or)\s+(?:and|but|or)\b/i.test(body)) return null;
        const staleTechFiller = [
            "dependencies installed",
            "deterministic test suite",
            "requested a rollback",
            "patch notes land",
            "clear cache touch grass",
            "beta opinion",
            "release build"
        ];
        const lower = body.toLowerCase();
        if (staleTechFiller.some((fragment) => lower.includes(fragment))) return null;
        return candidate;
    }

    function burnResponseKey(text) {
        return String(text || "")
            .replace(/^@[A-Za-z0-9_.-]+\s+/, "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
    }

    function isRecentBurn(text) {
        const key = burnResponseKey(text);
        return !!key && recentBurnResponses.includes(key);
    }

    function rememberRecentBurn(text) {
        const key = burnResponseKey(text);
        if (!key) return;
        recentBurnResponses = recentBurnResponses.filter((item) => item !== key);
        recentBurnResponses.push(key);
        if (recentBurnResponses.length > RECENT_BURN_LIMIT) {
            recentBurnResponses.splice(0, recentBurnResponses.length - RECENT_BURN_LIMIT);
        }
    }

    let burnSendInFlight = false;
    let pendingOutgoingIdentity = null;
    let pendingBurnEcho = null;
    let lastTrustedComposerInputAt = 0;
    let botComposerMutationGuard = false;
    const BURN_COMPOSER_IDLE_MS = 650;
    const BURN_COMPOSER_WAIT_MS = 12000;
    const burnRuntimeStatus = {
        nickname: "",
        composerFound: false,
        lastAttempt: "none yet",
        lastError: ""
    };

    function setBurnRuntimeStatus(patch = {}) {
        Object.assign(burnRuntimeStatus, patch);
        const status = document.querySelector("#autoBurnRuntimeStatus");
        if (status) status.textContent = burnRuntimeStatusText();
    }

    function burnRuntimeStatusText() {
        const nickname = sanitizeNickname(settings.myNickname || burnRuntimeStatus.nickname) || "not detected";
        return `me: ${nickname} · composer: ${burnRuntimeStatus.composerFound ? "ready" : "not found"} · last: ${burnRuntimeStatus.lastAttempt}`;
    }

    function normalizeOutgoingEcho(text) {
        return String(text || "").replace(/\s+/g, " ").trim();
    }

    function rememberPendingOutgoingIdentity(raw, formatted) {
        const original = normalizeOutgoingEcho(raw);
        const sent = normalizeOutgoingEcho(formatted);
        if (!original && !sent) return;
        pendingOutgoingIdentity = { raw: original, formatted: sent, expiresAt: Date.now() + 20000 };
    }

    function rememberPendingBurnEcho(raw, formatted, meta = {}) {
        if (!meta.engine) return;
        const selfUsername = sanitizeNickname(settings.myNickname || burnRuntimeStatus.nickname || detectMyNickname()).toLowerCase();
        pendingBurnEcho = {
            raw: normalizeOutgoingEcho(raw),
            formatted: normalizeOutgoingEcho(formatted),
            engine: String(meta.engine || ""),
            target: String(meta.target || ""),
            strategy: String(meta.strategy || ""),
            context: String(meta.context || ""),
            fontStyle: settings.outgoingFontStyle || "default",
            selfUsername,
            expiresAt: Date.now() + 20000
        };
    }

    function consumePendingBurnEcho(record) {
        if (!pendingBurnEcho || !record?.username) return null;
        if (Date.now() > pendingBurnEcho.expiresAt) {
            pendingBurnEcho = null;
            return null;
        }
        if (pendingBurnEcho.selfUsername && String(record.username).toLowerCase() !== pendingBurnEcho.selfUsername) return null;
        const observed = normalizeOutgoingEcho(record.message);
        if (!observed || (observed !== pendingBurnEcho.raw && observed !== pendingBurnEcho.formatted)) return null;
        const meta = {
            botGenerated: true,
            botEngine: pendingBurnEcho.engine,
            botTarget: pendingBurnEcho.target,
            botFontStyle: pendingBurnEcho.fontStyle,
            botStrategy: pendingBurnEcho.strategy,
            botContext: pendingBurnEcho.context
        };
        pendingBurnEcho = null;
        return meta;
    }

    function maybeLearnSelfNickname(record) {
        if (!pendingOutgoingIdentity || !record?.username) return;
        if (Date.now() > pendingOutgoingIdentity.expiresAt) {
            pendingOutgoingIdentity = null;
            return;
        }
        const observed = normalizeOutgoingEcho(record.message);
        if (!observed || (observed !== pendingOutgoingIdentity.raw && observed !== pendingOutgoingIdentity.formatted)) return;
        const learned = storeNicknameIfValid(record.displayName || record.username);
        if (learned && learned.toLowerCase() !== "guest") {
            setBurnRuntimeStatus({ nickname: learned, lastAttempt: `learned @${learned}` });
            pendingOutgoingIdentity = null;
        }
    }

    function elementIsVisible(element) {
        if (!element || !element.isConnected || element.closest?.("#rumbleBlockerSettingsPanel")) return false;
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function composerMetadata(element) {
        return [
            element.id,
            element.className,
            element.getAttribute?.("name"),
            element.getAttribute?.("placeholder"),
            element.getAttribute?.("aria-label"),
            element.getAttribute?.("data-role"),
            element.getAttribute?.("data-qa"),
            element.getAttribute?.("data-js")
        ].filter(Boolean).join(" ").toLowerCase();
    }

    function scoreChatComposer(element) {
        if (!elementIsVisible(element)) return -1000;
        const meta = composerMetadata(element);
        let score = 0;
        if (/chat/.test(meta)) score += 10;
        if (/message/.test(meta)) score += 8;
        if (/comment/.test(meta)) score += 2;
        if (element.closest?.("section.chat, .chat, .chat-container, [class*='chat-container'], [data-js*='chat']")) score += 10;
        if (element.closest?.("form")) score += 4;
        if (element.tagName === "TEXTAREA") score += 4;
        if (element.isContentEditable || element.getAttribute?.("role") === "textbox") score += 3;
        if (element.tagName === "INPUT") score += 1;
        return score;
    }

    function findChatComposer() {
        const selectors = [
            "section.chat textarea", "section.chat [contenteditable='true']", "section.chat [role='textbox']",
            "textarea.chat-input", "textarea.chat-textarea", "textarea.chat-input__textarea", "textarea[class*='chat' i]",
            "textarea#chat-message-text", "textarea[name='chat']", "textarea[data-role='chat-input']",
            "textarea[data-qa='live-chat-input']", "textarea[placeholder*='chat' i]", "textarea[placeholder*='message' i]",
            "textarea[aria-label*='chat' i]", "textarea[aria-label*='message' i]",
            "input.chat-input", "input[name='chat']", "input[placeholder*='chat' i]",
            "div[contenteditable='true'][data-placeholder*='message' i]",
            "div[contenteditable='true'][aria-label*='message' i]",
            "[contenteditable='true'][role='textbox']", "[role='textbox'][contenteditable='true']"
        ];
        const candidates = new Set();
        selectors.forEach((selector) => document.querySelectorAll(selector).forEach((element) => candidates.add(element)));
        document.querySelectorAll("textarea, input[type='text'], [contenteditable='true'], [role='textbox']")
            .forEach((element) => candidates.add(element));
        const ranked = [...candidates]
            .map((element) => ({ element, score: scoreChatComposer(element) }))
            .filter((entry) => entry.score >= 5)
            .sort((a, b) => b.score - a.score);
        const composer = ranked[0]?.element || null;
        burnRuntimeStatus.composerFound = !!composer;
        return composer;
    }

    function buttonMetadata(button) {
        return [
            button.id,
            button.className,
            button.textContent,
            button.getAttribute?.("aria-label"),
            button.getAttribute?.("title"),
            button.getAttribute?.("data-role"),
            button.getAttribute?.("data-js")
        ].filter(Boolean).join(" ").toLowerCase();
    }

    function scoreSendButton(button, composer) {
        if (!elementIsVisible(button)) return -1000;
        const meta = buttonMetadata(button);
        let score = 0;
        if (/send/.test(meta)) score += 12;
        if (/chat/.test(meta)) score += 4;
        if (button.type === "submit") score += 7;
        const form = composer?.closest?.("form");
        if (form && button.closest?.("form") === form) score += 10;
        if (composer && button.parentElement === composer.parentElement) score += 4;
        return score;
    }

    function findSendButton(composer = findChatComposer()) {
        const selectors = [
            "button[type='submit']", "button.chat-send", "button.send-message",
            "button[aria-label*='send' i]", "button[title*='send' i]", "button.chat__send",
            "button[data-role*='send' i]", "button[data-js*='send' i]", "button[class*='send' i]"
        ];
        const scopes = [
            composer?.closest?.("form"),
            composer?.closest?.("section.chat, .chat, .chat-container, [class*='chat-container']"),
            composer?.parentElement
        ].filter(Boolean);
        const candidates = new Set();
        scopes.forEach((scope) => selectors.forEach((selector) => scope.querySelectorAll(selector).forEach((button) => candidates.add(button))));
        if (!candidates.size) {
            document.querySelectorAll("button[aria-label*='send' i], button[title*='send' i], button[data-role*='send' i], button[data-js*='send' i], button[class*='send' i]")
                .forEach((button) => candidates.add(button));
        }
        return [...candidates]
            .map((button) => ({ button, score: scoreSendButton(button, composer) }))
            .filter((entry) => entry.score >= 5)
            .sort((a, b) => b.score - a.score)[0]?.button || null;
    }

    function dispatchComposerInput(composer, value) {
        try {
            composer.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: value }));
        } catch (_) {}
        try {
            composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
        } catch (_) {
            composer.dispatchEvent(new Event("input", { bubbles: true }));
        }
        composer.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function setComposerValue(composer, value) {
        if (!composer) return;
        composer.focus();
        if ("value" in composer) {
            const proto = composer.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
            if (setter) setter.call(composer, value); else composer.value = value;
        } else if (composer.isContentEditable || composer.getAttribute?.("role") === "textbox") {
            composer.replaceChildren(document.createTextNode(value));
        }
        dispatchComposerInput(composer, value);
    }

    function getComposerPlainText(composer) {
        if (!composer) return "";
        return "value" in composer ? String(composer.value || "") : String(composer.innerText || composer.textContent || "");
    }

    function appendOutgoingColourNodes(target, text, mode) {
        const palette = parseColourPalette(settings.chatMultiPalette);
        const parts = String(text || "").split(OUTGOING_PROTECTED_TOKEN_RE);
        let colourIndex = 0;
        parts.forEach((part, partIndex) => {
            if (!part) return;
            if (partIndex % 2 || mode === "default") {
                target.appendChild(document.createTextNode(part));
                return;
            }
            if (mode === "single") {
                const span = document.createElement("span");
                span.style.color = settings.chatTextColor || "#ffffff";
                span.textContent = part;
                target.appendChild(span);
                return;
            }
            [...part].forEach((char) => {
                if (/\s/.test(char)) {
                    target.appendChild(document.createTextNode(char));
                    return;
                }
                const span = document.createElement("span");
                span.style.color = mode === "rainbow"
                    ? `hsl(${(colourIndex * 41) % 360} 100% 62%)`
                    : palette[colourIndex % palette.length];
                span.textContent = char;
                target.appendChild(span);
                colourIndex += 1;
            });
        });
    }

    function setOutgoingComposerValue(composer, value) {
        if (!composer) return "";
        const formatted = formatOutgoingText(value);
        const colourMode = settings.chatTextMode || "default";
        if (!composer.isContentEditable || colourMode === "default") {
            setComposerValue(composer, formatted);
            return formatted;
        }
        composer.focus();
        composer.replaceChildren();
        appendOutgoingColourNodes(composer, formatted, colourMode);
        dispatchComposerInput(composer, formatted);
        return formatted;
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function waitForBurnComposerIdle(initialComposer) {
        let composer = initialComposer;
        const deadline = Date.now() + BURN_COMPOSER_WAIT_MS;
        while (Date.now() < deadline) {
            if (!composer?.isConnected) composer = findChatComposer();
            if (composer) {
                const hasDraft = !!getComposerPlainText(composer).trim();
                const recentlyTyped = Date.now() - lastTrustedComposerInputAt < BURN_COMPOSER_IDLE_MS;
                if (!hasDraft && !recentlyTyped) return composer;
                setBurnRuntimeStatus({ composerFound: true, lastAttempt: "queued: waiting for your draft", lastError: "" });
            }
            await sleep(120);
        }
        setBurnRuntimeStatus({ lastAttempt: "skipped: composer stayed busy", lastError: "composer-busy" });
        return null;
    }

    function cancelBotComposerCollision(composer, expectedText) {
        if (expectedText == null) return false;
        const current = getComposerPlainText(composer);
        if (current === expectedText) return false;
        if (current.startsWith(expectedText)) {
            const userTail = current.slice(expectedText.length);
            botComposerMutationGuard = true;
            try { setComposerValue(composer, userTail); } finally { botComposerMutationGuard = false; }
        }
        setBurnRuntimeStatus({ lastAttempt: "cancelled: you started typing", lastError: "composer-changed" });
        return true;
    }

    async function submitComposer(composer, expectedText = null) {
        if (!composer) return false;
        for (let attempt = 0; attempt < 8; attempt += 1) {
            await sleep(attempt === 0 ? 80 : 60);
            if (cancelBotComposerCollision(composer, expectedText)) return false;
            const button = findSendButton(composer);
            if (button && !button.disabled && button.getAttribute("aria-disabled") !== "true") {
                button.click();
                return true;
            }
        }
        if (cancelBotComposerCollision(composer, expectedText)) return false;
        const form = composer.closest?.("form");
        if (form && typeof form.requestSubmit === "function") {
            try {
                form.requestSubmit();
                return true;
            } catch (err) {
                console.warn("Rumble form requestSubmit failed", err);
            }
        }
        if (cancelBotComposerCollision(composer, expectedText)) return false;
        for (const type of ["keydown", "keypress", "keyup"]) {
            composer.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
        }
        return true;
    }

    let outgoingSubmitGuard = false;
    function prepareCurrentComposerForSend(composer) {
        const raw = getComposerPlainText(composer);
        if (!raw.trim()) return { raw: "", formatted: "", changed: false };
        const formatted = formatOutgoingText(raw);
        const richColour = !!composer.isContentEditable && (settings.chatTextMode || "default") !== "default";
        const changed = formatted !== raw || richColour;
        if (changed) setOutgoingComposerValue(composer, raw);
        rememberPendingOutgoingIdentity(raw, formatted);
        return { raw, formatted, changed };
    }

    function deferNativeSend(event, composer) {
        if (outgoingSubmitGuard) return false;
        const prepared = prepareCurrentComposerForSend(composer);
        if (!prepared.raw || !prepared.changed) return false;
        event.preventDefault();
        event.stopImmediatePropagation();
        outgoingSubmitGuard = true;
        void submitComposer(composer).finally(() => { outgoingSubmitGuard = false; });
        return true;
    }

    function installOutgoingComposerFormatting() {
        const composer = findChatComposer();
        setBurnRuntimeStatus({ composerFound: !!composer });
        if (!composer) return;
        if (!composer._dizyOutgoingFormattingBound) {
            composer._dizyOutgoingFormattingBound = true;
            composer.addEventListener("input", (event) => {
                if (event.isTrusted && !botComposerMutationGuard) lastTrustedComposerInputAt = Date.now();
            }, true);
            composer.addEventListener("keydown", (event) => {
                if (outgoingSubmitGuard) return;
                if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
                const prepared = prepareCurrentComposerForSend(composer);
                if (!prepared.raw || !prepared.changed) return;
                event.preventDefault();
                event.stopImmediatePropagation();
                outgoingSubmitGuard = true;
                void submitComposer(composer).finally(() => { outgoingSubmitGuard = false; });
            }, true);
            const form = composer.closest("form");
            if (form && !form._dizyOutgoingFormattingBound) {
                form._dizyOutgoingFormattingBound = true;
                form.addEventListener("submit", (event) => {
                    if (outgoingSubmitGuard) return;
                    deferNativeSend(event, composer);
                }, true);
            }
        }
        const sendButton = findSendButton(composer);
        if (sendButton && !sendButton._dizyOutgoingFormattingBound) {
            sendButton._dizyOutgoingFormattingBound = true;
            sendButton.addEventListener("click", (event) => {
                if (outgoingSubmitGuard) return;
                deferNativeSend(event, composer);
            }, true);
        }
    }

    async function sendChatMessage(message, meta = {}) {
        let composer = findChatComposer();
        if (!composer) {
            setBurnRuntimeStatus({ composerFound: false, lastAttempt: "failed: composer not found", lastError: "composer-not-found" });
            return false;
        }

        const isBurn = !!meta.engine;
        if (isBurn && (isBlockedBurnSubject(message) || BURN_DIRECT_THREAT_PATTERN.test(String(message || "")))) {
            setBurnRuntimeStatus({ lastAttempt: "blocked: account-protection firewall", lastError: "blocked-burn-subject" });
            return false;
        }
        if (isBurn) {
            composer = await waitForBurnComposerIdle(composer);
            if (!composer) return false;
            if (getComposerPlainText(composer).trim() || Date.now() - lastTrustedComposerInputAt < BURN_COMPOSER_IDLE_MS) {
                setBurnRuntimeStatus({ lastAttempt: "skipped: composer became busy", lastError: "composer-busy" });
                return false;
            }
        }

        let formatted = "";
        botComposerMutationGuard = isBurn;
        try {
            formatted = setOutgoingComposerValue(composer, message);
        } finally {
            botComposerMutationGuard = false;
        }
        rememberPendingOutgoingIdentity(message, formatted);
        setBurnRuntimeStatus({ composerFound: true, lastAttempt: isBurn ? "burn composer filled" : "composer filled", lastError: "" });
        outgoingSubmitGuard = true;
        try {
            const submitted = await submitComposer(composer, isBurn ? formatted : null);
            if (submitted && isBurn) rememberPendingBurnEcho(message, formatted, meta);
            setBurnRuntimeStatus({ lastAttempt: submitted ? "send dispatched" : (isBurn ? "burn send cancelled" : "failed: no send path"), lastError: submitted ? "" : burnRuntimeStatus.lastError || "send-path-not-found" });
            return submitted;
        } finally {
            outgoingSubmitGuard = false;
        }
    }

    function generateBurnResponse(ctx) {
        pendingCuratedBurnSelection = null;
        lastBurnEngineUsed = "none";
        const normalizedCtx = {
            target: ctx.target || "there",
            from: String(ctx.from || "").trim().toLowerCase(),
            message: (ctx.message || "").replace(/\s+/g, " ").trim().slice(0, 220),
            snippet: (ctx.message || "").replace(/\s+/g, " ").trim().slice(0, 110),
            tagCount: Math.max(1, Number(ctx.tagCount) || 1)
        };
        const enabled = Object.assign({}, defaultSettings.burnEnginesEnabled, settings.burnEnginesEnabled || {});
        const primary = settings.autoBurnEngine || "builtin";
        const normalFallbackOrder = ["curated", "builtin", "compromise", "rita", "custom", "markov"];
        const engineOrder = (primary === "drill" ? ["drill", ...normalFallbackOrder] : [primary, ...normalFallbackOrder])
            .filter((key, index, arr) => arr.indexOf(key) === index && enabled[key] !== false);

        const custom = window.rumbleBlocker?.customBurnGenerator;

        const generateFromEngine = (engine) => {
            if (BURN_PERSONALITY_KEYS.includes(engine) || engine === "random_personality") {
                return renderPersonalityBurn(engine, normalizedCtx);
            }
            if (engine === "drill") {
                const template = drillSargeBurns[Math.floor(Math.random() * drillSargeBurns.length)];
                return template ? template(normalizedCtx) : null;
            }
            if (engine === "curated") return selectCuratedBurn(normalizedCtx);
            if (engine === "custom") {
                if (typeof custom !== "function") return null;
                try { return custom(normalizedCtx) || null; } catch (err) { console.warn("Custom burn generator threw", err); return null; }
            }
            if (engine === "compromise") {
                const nlpLib = typeof nlp !== "undefined" ? nlp : window.nlp;
                if (!nlpLib) return null;
                try {
                    const doc = nlpLib(normalizedCtx.message);
                    const noun = String(doc.nouns().toSingular().out("array")[0] || "")
                        .replace(/\s+/g, " ")
                        .trim()
                        .slice(0, 48);
                    const quote = safeBurnQuote(normalizedCtx.message);
                    const variants = [
                        quote ? `@${normalizedCtx.target} “${quote}” — that wasn't a comeback, that was evidence.` : null,
                        noun ? `@${normalizedCtx.target} you somehow made ${noun} less convincing by typing about it.` : null,
                        `@${normalizedCtx.target} enormous confidence there. Shame none of it stuck to the point.`
                    ].filter(Boolean);
                    return variants[Math.floor(Math.random() * variants.length)] || null;
                } catch (err) { console.warn("Compromise burn failed", err); return null; }
            }
            if (engine === "rita") {
                const ritaLib = typeof RiTa !== "undefined" ? RiTa : window.RiTa;
                if (!ritaLib) return null;
                try {
                    const quote = safeBurnQuote(normalizedCtx.message);
                    const variants = [
                        quote ? `@${normalizedCtx.target} “${quote}” — even the sentence is trying to leave you behind.` : null,
                        `@${normalizedCtx.target} premium confidence, bargain-bin material.`,
                        `@${normalizedCtx.target} you brought theatre. The script forgot to bring a point.`
                    ].filter(Boolean);
                    return variants[Math.floor(Math.random() * variants.length)] || null;
                } catch (err) { console.warn("RiTa burn failed", err); return null; }
            }
            if (engine === "markov") {
                const supplied = String(settings.burnMarkovCorpus || "")
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .filter(Boolean);
                const hookCorpus = Array.isArray(window.rumbleBlocker?.burnMarkovSource)
                    ? window.rumbleBlocker.burnMarkovSource.map((line) => String(line || "").trim()).filter(Boolean)
                    : [];
                const corpus = [...supplied, ...hookCorpus];
                if (!corpus.length) return null;
                const phrase = corpus.length >= 8
                    ? simpleMarkovGenerate(corpus)
                    : corpus[Math.floor(Math.random() * corpus.length)];
                return phrase ? `@${normalizedCtx.target} ${phrase}` : null;
            }
            if (engine === "builtin") {
                const pool = Math.random() < 0.72 ? britishBuiltInBurns : builtInBurns;
                const template = pool[Math.floor(Math.random() * pool.length)];
                return template ? template(normalizedCtx) : null;
            }
            return null;
        };

        for (const engine of engineOrder) {
            const attempts = engine === "custom" ? 1 : 6;
            for (let attempt = 0; attempt < attempts; attempt += 1) {
                pendingCuratedBurnSelection = null;
                const result = generateFromEngine(engine);
                if (!result) break;
                const candidate = cleanGeneratedBurn(result, normalizedCtx.target);
                if (!candidate) {
                    pendingCuratedBurnSelection = null;
                    continue;
                }
                if (!isRecentBurn(candidate)) {
                    lastBurnEngineUsed = engine === "random_personality" && lastBurnPersonalityUsed
                        ? `random:${lastBurnPersonalityUsed}`
                        : engine;
                    return candidate;
                }
                pendingCuratedBurnSelection = null;
            }
        }
        pendingCuratedBurnSelection = null;
        return null;
    }

    async function maybeHandleAutoBurn(ctx) {
        if (!settings.autoBurnEnabled || burnSendInFlight) return;
        const tagCount = noteBurnPressure(ctx.from || ctx.target);
        const now = Date.now();
        const cooldownMs = Math.max(5, settings.autoBurnCooldownSeconds || 45) * 1000;
        if (now - lastBurnTimestamp < cooldownMs) return;
        const response = generateBurnResponse({ ...ctx, tagCount });
        const curatedSelection = pendingCuratedBurnSelection;
        if (!response) {
            setBurnRuntimeStatus({ lastAttempt: "no burn generated" });
            pendingCuratedBurnSelection = null;
            return;
        }
        burnSendInFlight = true;
        const configuredReplyDelay = Number(settings.autoBurnReplyDelaySeconds);
        const replyDelaySeconds = Number.isFinite(configuredReplyDelay)
            ? Math.max(0, Math.min(120, configuredReplyDelay))
            : 5;
        const replyDelayMs = replyDelaySeconds * 1000;
        setBurnRuntimeStatus({ lastAttempt: `generated via ${lastBurnEngineUsed} for @${ctx.target || ctx.from} · tag #${tagCount} · replying in ${replyDelaySeconds}s` });
        try {
            if (replyDelayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, replyDelayMs));
            }
            if (!settings.autoBurnEnabled) {
                setBurnRuntimeStatus({ lastAttempt: "cancelled: auto-burn disabled during reply delay" });
                return;
            }
            const sent = await sendChatMessage(response, {
                engine: lastBurnEngineUsed,
                target: ctx.target || ctx.from || "",
                strategy: curatedSelection?.strategy || lastBurnEngineUsed,
                context: curatedSelection?.context || ""
            });
            if (sent) {
                lastBurnTimestamp = Date.now();
                rememberRecentBurn(response);
                if (curatedSelection) markCuratedBurnUsed(curatedSelection);
            }
        } catch (err) {
            console.warn("Auto-burn send failed", err);
            setBurnRuntimeStatus({ lastAttempt: "failed: send exception", lastError: String(err?.message || err) });
        } finally {
            burnSendInFlight = false;
            pendingCuratedBurnSelection = null;
        }
    }

    /***********************
     * Core message refresh
     ***********************/
    function refreshBlockedMessages() {
        const chatContainer =
            document.querySelector(".chat-history") || document.querySelector(".chat-list") || null;

        let userScrolledAway = false;
        if (chatContainer && settings.autoScrollLock) {
            const nearBottom =
                chatContainer.scrollHeight - (chatContainer.scrollTop + chatContainer.clientHeight) < 40;
            userScrolledAway = !nearBottom;
        }

        const selfHandle = sanitizeNickname(detectMyNickname()) || "";
        const selfHandleLower = selfHandle.toLowerCase();

        document
            .querySelectorAll("li.chat-history--row.js-chat-history-item")
            .forEach((el) => {
                const usernameEl = el.querySelector("button.chat-history--username.js-user-tag");
                const msgEl = el.querySelector("div.js-chat-message.chat-history--message");
                if (!msgEl) return;

                if (!el._originalMessage) el._originalMessage = msgEl.innerHTML;
                if (el._revealed === undefined) el._revealed = false;
                if (el._initialized === undefined) el._initialized = false;
                if (el._autoBlocked === undefined) el._autoBlocked = false;
                if (el._collapsed === undefined) el._collapsed = false;
                if (el._collapseExpanded === undefined) el._collapseExpanded = false;

                const username = usernameEl ? usernameEl.innerText.trim().toLowerCase() : null;
                const displayName = usernameEl ? usernameEl.innerText.trim() : "user";

                const isSystem =
                    !usernameEl ||
                    el.classList.contains("system-message") ||
                    /system/i.test(msgEl.innerText);
                if (settings.hideSystemMessages && isSystem) {
                    if (el.style.display !== "none") el.style.display = "none";
                    return;
                }
                if (el.style.display === "none") el.style.display = "";

                const isHighlighted = username && settings.highlightedUsers.includes(username);
                if (isHighlighted) {
                    if (!el._highlightApplied) {
                        const { rgba, rgb, border, glow } = applyHighlightColor(
                            settings.highlightColor,
                            settings.darkMode ? 0.25 : 0.35
                        );
                        const textColor = getContrastTextColor(rgb);

                        el.style.opacity = "0";
                        el.style.background = rgba;
                        el.style.borderRadius = "12px";
                        el.style.border = `1px solid ${border}`;
                        el.style.color = textColor;
                        el.style.transition = "opacity 0.4s ease, box-shadow 0.3s ease, transform 0.2s ease";

                        el.querySelectorAll("*").forEach((child) => {
                            child.style.color = textColor;
                            if (child.tagName === "A") child.style.textDecoration = "underline";
                        });

                        requestAnimationFrame(() => {
                            el.style.opacity = "1";
                        });

                        el.addEventListener("mouseenter", () => {
                            el.style.boxShadow = glow;
                            el.style.transform = "scale(1.02)";
                        });
                        el.addEventListener("mouseleave", () => {
                            el.style.boxShadow = "";
                            el.style.transform = "scale(1)";
                        });

                        el._highlightApplied = true;
                    }
                } else if (el._highlightApplied) {
                    el.style.transition = "opacity 0.4s ease, box-shadow 0.3s ease, transform 0.2s ease";
                    el.style.opacity = "0";
                    el.style.boxShadow = "";
                    el.style.transform = "scale(1)";
                    setTimeout(() => {
                        el.style.background = "";
                        el.style.border = "";
                        el.style.borderRadius = "";
                        el.style.color = "";
                        el.querySelectorAll("*").forEach((child) => {
                            child.style.color = "";
                            if (child.tagName === "A") child.style.textDecoration = "";
                        });
                        el._highlightApplied = false;
                        el.style.opacity = "1";
                    }, 400);
                }

                if (settings.compactMode) {
                    if (!el._compactApplied) {
                        msgEl.style.padding = "2px 6px";
                        msgEl.style.lineHeight = "1.1";
                        msgEl.style.fontSize = "13px";
                        el._compactApplied = true;
                    }
                } else if (el._compactApplied) {
                    msgEl.style.padding = "";
                    msgEl.style.lineHeight = "";
                    msgEl.style.fontSize = "";
                    delete el._compactApplied;
                }

                if (settings.showTimestamps && usernameEl) {
                    if (!el._timestampApplied) {
                        const timeNode = document.createElement("span");
                        timeNode.className = "rumble-blocker-ts";
                        timeNode.style.marginLeft = "8px";
                        timeNode.style.fontSize = "11px";
                        timeNode.style.opacity = "0.6";
                        timeNode.style.verticalAlign = "middle";
                        timeNode.style.userSelect = "none";
                        timeNode.style.pointerEvents = "none";
                        timeNode.setAttribute("aria-hidden", "true");
                        timeNode.textContent = formatTime(new Date());
                        usernameEl.insertAdjacentElement("afterend", timeNode);
                        el._timestampNode = timeNode;
                        el._timestampApplied = true;
                    }
                } else if (el._timestampApplied && el._timestampNode) {
                    el._timestampNode.remove();
                    delete el._timestampApplied;
                    delete el._timestampNode;
                }

                const rawOriginal = el._originalMessage || msgEl.innerHTML || "";
                const plainOriginal = rawOriginal
                    ? rawOriginal.replace(/<\/?[^>]+(>|$)/g, "")
                    : msgEl.innerText || "";
                const lowerText = plainOriginal.toLowerCase();

                recordChatMessage(el, username, displayName, plainOriginal);

                const userIsBlocked = username && blockedUsers.includes(username);
                if (
                    settings.autoBurnEnabled &&
                    !el._autoBurnHandled &&
                    el._recentlyAdded &&
                    username && selfHandleLower &&
                    username !== selfHandleLower &&
                    !userIsBlocked && !isSystem
                ) {
                    const mentionRegex = new RegExp(`\\b@?${escapeRegex(selfHandleLower)}\\b`, "i");
                    if (mentionRegex.test(lowerText)) {
                        el._autoBurnHandled = true;
                        setBurnRuntimeStatus({ nickname: selfHandle, lastAttempt: `tag detected from @${displayName.replace(/^@+/, "")}` });
                        void maybeHandleAutoBurn({ target: displayName.replace(/^@+/, ""), message: plainOriginal, from: username });
                    }
                }

                let keywordMatched = null;
                if (settings.blockedKeywords && settings.blockedKeywords.length > 0) {
                    for (const kw of settings.blockedKeywords) {
                        if (!kw) continue;
                        if (lowerText.includes(kw)) {
                            keywordMatched = kw;
                            break;
                        }
                    }
                }

                const shouldAutoBlock = !!keywordMatched;
                const shouldMask = shouldAutoBlock && settings.keywordAction === "mask" && !userIsBlocked;
                const isBlocked = userIsBlocked || shouldAutoBlock;
                el._autoBlocked = shouldAutoBlock;

                const previewLength = settings.previewLength || 50;
                const snippet = plainOriginal
                    ? plainOriginal.slice(0, previewLength) + (plainOriginal.length > previewLength ? "…" : "")
                    : msgEl.innerText.slice(0, previewLength);
                const blockedPreview = `🚫 Blocked message from ${displayName} (click to reveal)`;

                let maskedHTML = null;
                if (shouldMask) {
                    maskedHTML = el._originalMessage;
                    settings.blockedKeywords.forEach((kw) => {
                        if (!kw) return;
                        const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig");
                        maskedHTML = maskedHTML.replace(re, "•••");
                    });
                }

                if (isBlocked) {
                    el._collapseExpanded = false;
                    if (!el._initialized) {
                        el._initialized = true;
                        if (el._revealed) {
                            if (msgEl.innerHTML !== el._originalMessage) msgEl.innerHTML = el._originalMessage;
                            msgEl.style.opacity = "1";
                            msgEl.style.color = settings.darkMode ? "#eee" : "#555";
                            msgEl.style.cursor = "pointer";
                            msgEl.title = "";
                        } else if (shouldMask) {
                            if (msgEl.innerHTML !== maskedHTML) msgEl.innerHTML = maskedHTML;
                            msgEl.style.opacity = "0.9";
                            msgEl.style.cursor = "pointer";
                            msgEl.title = snippet;
                        } else {
                            if (msgEl.innerText !== blockedPreview) msgEl.innerText = blockedPreview;
                            msgEl.style.opacity = "0.5";
                            msgEl.style.cursor = "pointer";
                            msgEl.title = snippet;
                        }
                    } else if (el._revealed) {
                        if (msgEl.innerHTML !== el._originalMessage) {
                            msgEl.style.transition = "";
                            msgEl.innerHTML = el._originalMessage;
                            msgEl.style.opacity = "1";
                            msgEl.style.color = settings.darkMode ? "#eee" : "#555";
                            msgEl.title = "";
                        }
                    } else if (shouldMask) {
                        if (msgEl.innerHTML !== maskedHTML) {
                            if (!el._recentlyAdded) {
                                msgEl.innerHTML = maskedHTML;
                                msgEl.style.opacity = "0.9";
                            } else {
                                msgEl.style.opacity = "0";
                                setTimeout(() => {
                                    msgEl.innerHTML = maskedHTML;
                                    msgEl.style.opacity = "0.9";
                                }, 50);
                                delete el._recentlyAdded;
                            }
                            msgEl.style.cursor = "pointer";
                            msgEl.title = snippet;
                        }
                    } else if (msgEl.innerText !== blockedPreview) {
                        if (!el._recentlyAdded) {
                            msgEl.innerText = blockedPreview;
                            msgEl.style.opacity = "0.5";
                        } else {
                            msgEl.style.opacity = "0";
                            setTimeout(() => {
                                msgEl.innerText = blockedPreview;
                                msgEl.style.opacity = "0.5";
                            }, 50);
                            delete el._recentlyAdded;
                        }
                        msgEl.style.cursor = "pointer";
                        msgEl.title = snippet;
                    }

                    msgEl.onclick = () => {
                        if (el._collapsed) {
                            el._collapsed = false;
                            msgEl.innerHTML = el._originalMessage;
                            msgEl.style.opacity = "1";
                            msgEl.title = "";
                            return;
                        }

                        el._revealed = !el._revealed;

                        if (el._revealed) {
                            msgEl.style.opacity = "0";
                            setTimeout(() => {
                                msgEl.innerHTML = el._originalMessage;
                                msgEl.style.color = settings.darkMode ? "#eee" : "#555";
                                msgEl.style.opacity = "1";
                                msgEl.title = "";
                            }, 170);
                        } else {
                            msgEl.style.opacity = "0";
                            setTimeout(() => {
                                if (shouldMask) {
                                    msgEl.innerHTML = maskedHTML;
                                    msgEl.style.opacity = "0.9";
                                    msgEl.title = snippet;
                                } else {
                                    msgEl.innerText = blockedPreview;
                                    msgEl.style.opacity = "0.5";
                                    msgEl.title = snippet;
                                }
                            }, 170);
                        }
                    };
                } else {
                    if (msgEl.innerHTML !== el._originalMessage) {
                        msgEl.innerHTML = el._originalMessage;
                    }
                    msgEl.style.opacity = "1";
                    msgEl.style.color = settings.darkMode ? "#e0e0e0" : "#000";
                    msgEl.title = "";

                    const collapseThreshold = settings.collapseLength || 0;
                    const collapseTitle = plainOriginal.slice(0, Math.min(200, plainOriginal.length));
                    const collapseSnippet =
                        collapseThreshold > 0
                            ? plainOriginal.slice(0, collapseThreshold) + "… (click to expand)"
                            : "";
                    const collapseEnabled =
                        collapseThreshold > 0 && plainOriginal.length > collapseThreshold;

                    if (collapseEnabled && !el._collapseExpanded) {
                        if (!el._collapsed || msgEl.innerText !== collapseSnippet) {
                            msgEl.innerText = collapseSnippet;
                            msgEl.style.opacity = "0.6";
                            msgEl.title = collapseTitle;
                            el._collapsed = true;
                        }
                    } else if (!collapseEnabled || el._collapseExpanded) {
                        if (el._collapsed) {
                            el._collapsed = false;
                            msgEl.innerHTML = el._originalMessage;
                            msgEl.style.opacity = "1";
                            msgEl.title = collapseEnabled ? collapseTitle : "";
                        }
                        if (!collapseEnabled) {
                            el._collapseExpanded = false;
                            msgEl.title = "";
                        }
                    }

                    if (collapseEnabled) {
                        msgEl.style.cursor = "pointer";
                        msgEl.onclick = () => {
                            if (el._collapsed) {
                                el._collapsed = false;
                                el._collapseExpanded = true;
                                msgEl.innerHTML = el._originalMessage;
                                msgEl.style.opacity = "1";
                                msgEl.title = "";
                            } else {
                                el._collapseExpanded = false;
                                msgEl.innerText = collapseSnippet;
                                msgEl.style.opacity = "0.6";
                                msgEl.title = collapseTitle;
                                el._collapsed = true;
                            }
                        };
                    } else {
                        msgEl.style.cursor = "";
                        msgEl.onclick = null;
                    }
                }

                if (el._recentlyAdded) {
                    if (isHighlighted) {
                        maybeNotify("highlight", displayName, snippet);
                    }
                    if (shouldAutoBlock) {
                        maybeNotify("keyword", displayName, snippet);
                    }
                    delete el._recentlyAdded;
                }

                if (chatContainer && !settings.autoScrollLock && !userScrolledAway) {
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }
            });
    }

    /***********************
     * Observe chat for new messages
     ***********************/
    function initChatObserver(container) {
        if (!container) return;

        const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes || []) {
                    if (
                        node.nodeType === 1 &&
                        node.matches &&
                        node.matches("li.chat-history--row.js-chat-history-item")
                    ) {
                        node._recentlyAdded = true;
                        setTimeout(() => refreshBlockedMessages(), 20);
                    }
                }
            }
        });

        observer.observe(container, { childList: true, subtree: true });
        refreshBlockedMessages();
    }

    /***********************
     * Context menu helpers
     ***********************/
    function sanitizeNickname(value) {
        if (value == null) return "";
        const normalized = value
            .toString()
            .replace(/[\r\n\t]+/g, " ")
            .replace(/\s{2,}/g, " ")
            .trim();
        if (!normalized) return "";
        if (normalized.length > 40) return "";
        if (!/^@?[A-Za-z0-9_.-]+$/.test(normalized)) return "";
        const stripped = normalized.startsWith("@") ? normalized.slice(1) : normalized;
        return stripped || "";
    }

    function readNicknameFromElement(element) {
        if (!element) return "";
        if (element.closest && element.closest("li.chat-history--row")) {
            return "";
        }
        if (element.tagName && element.tagName.toLowerCase() === "meta") {
            return element.getAttribute("content") || "";
        }
        const attrValue =
            element.dataset?.username ||
            element.dataset?.user ||
            (element.getAttribute ? element.getAttribute("data-username") : "") ||
            (element.getAttribute ? element.getAttribute("data-user") : "");
        if (attrValue) return attrValue;
        return element.textContent || element.innerText || "";
    }

    function storeNicknameIfValid(candidate) {
        const sanitized = sanitizeNickname(candidate);
        if (!sanitized) return "";
        if (sanitized.toLowerCase() === "guest") return sanitized;
        if (settings.myNickname !== sanitized) {
            settings.myNickname = sanitized;
            saveSettings();
        }
        return sanitized;
    }

    function detectMyNickname() {
        const globalCandidates = [
            window?.Rumble?.currentUser?.username,
            window?.Rumble?.user?.username,
            window?.currentUser?.username,
            window?.user?.username
        ];
        for (const candidate of globalCandidates) {
            const resolved = storeNicknameIfValid(candidate);
            if (resolved && resolved.toLowerCase() !== "guest") {
                burnRuntimeStatus.nickname = resolved;
                return resolved;
            }
        }

        const stored = sanitizeNickname(settings.myNickname);
        if (stored && stored.toLowerCase() !== "guest") {
            if (stored !== settings.myNickname) {
                settings.myNickname = stored;
                saveSettings();
            }
            burnRuntimeStatus.nickname = stored;
            return stored;
        }

        const selectors = [
            "[data-self='true'][data-username]",
            "[data-current-user][data-username]",
            ".user-info .username",
            ".header-username",
            ".nav-item--user .username",
            ".header-user-menu [data-username]",
            ".user-menu [data-username]",
            "[data-profile-username]",
            "[data-username][data-user-id]",
            "[data-username]"
        ];
        for (const selector of selectors) {
            const matches = document.querySelectorAll(selector);
            for (const element of matches) {
                const resolved = storeNicknameIfValid(readNicknameFromElement(element));
                if (resolved && resolved.toLowerCase() !== "guest") {
                    burnRuntimeStatus.nickname = resolved;
                    return resolved;
                }
            }
        }
        return "";
    }

    function openDirectMessage(targetDisplayName) {
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

        const landingBaseURL = "https://dizychat-server.onrender.com/";
        const params = new URLSearchParams();
        params.set("usernamePlaceholder", "Put your username here");
        params.set("roomPlaceholder", "Put your room name here");
        if (target && target !== resolvedNickname) {
            params.set("invite", target);
        }
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

    function attachContextMenuToUser(usernameEl) {
        if (!usernameEl || usernameEl.dataset.blockListener) return;
        usernameEl.dataset.blockListener = "true";

        usernameEl.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            const datasetUsername =
                (usernameEl.dataset?.username || usernameEl.getAttribute("data-username") || "")
                    .toString()
                    .replace(/\s+/g, " ")
                    .trim();
            const datasetDisplayName =
                (usernameEl.dataset?.displayName || usernameEl.getAttribute("data-display-name") || "")
                    .toString()
                    .replace(/\s+/g, " ")
                    .trim();
            const fallbackText = (usernameEl.innerText || usernameEl.textContent || "")
                .toString()
                .replace(/\s+/g, " ")
                .trim();
            const displayName = datasetDisplayName || datasetUsername || fallbackText;
            const username = (datasetUsername || displayName).toLowerCase();

            const isBlocked = blockedUsers.includes(username);
            const isHighlighted = settings.highlightedUsers.includes(username);

            const oldMenu = document.getElementById("customUserContextMenu");
            if (oldMenu) oldMenu.remove();

            const menu = document.createElement("div");
            menu.id = "customUserContextMenu";
            menu.style.position = "absolute";
            menu.style.top = `${e.pageY}px`;
            menu.style.left = `${e.pageX}px`;
            menu.style.background = "#222";
            menu.style.border = "1px solid #555";
            menu.style.padding = "5px";
            menu.style.zIndex = 9999;

            function addMenuItem(label, onClick) {
                const item = document.createElement("div");
                item.innerText = label;
                item.style.padding = "4px 8px";
                item.style.cursor = "pointer";
                item.style.color = "#fff";
                item.addEventListener("mouseover", () => (item.style.background = "#444"));
                item.addEventListener("mouseout", () => (item.style.background = ""));
                item.addEventListener("click", () => {
                    onClick();
                    menu.remove();
                });
                menu.appendChild(item);
            }

            addMenuItem(
                isBlocked ? `✅ Unblock ${displayName}` : `🚫 Block ${displayName}`,
                () => {
                    if (blockedUsers.includes(username)) {
                        blockedUsers = blockedUsers.filter((u) => u !== username);
                        saveBlocklist();
                        refreshBlockedMessages();
                        alert("User unblocked.");
                    } else {
                        blockedUsers.push(username);
                        saveBlocklist();
                        refreshBlockedMessages();
                        alert("User blocked.");
                    }
                }
            );

            addMenuItem(
                isHighlighted ? `⭐ Unhighlight ${displayName}` : `⭐ Highlight ${displayName}`,
                () => {
                    if (settings.highlightedUsers.includes(username)) {
                        settings.highlightedUsers = settings.highlightedUsers.filter((u) => u !== username);
                        saveSettings();
                        refreshBlockedMessages();
                    } else {
                        settings.highlightedUsers.push(username);
                        saveSettings();
                        refreshBlockedMessages();
                    }
                }
            );

            addMenuItem(`💬 Direct Message ${displayName}`, () => {
                openDirectMessage(displayName);
            });

            document.body.appendChild(menu);

            const closeMenu = () => {
                menu.remove();
                document.removeEventListener("click", closeMenu);
            };
            setTimeout(() => document.addEventListener("click", closeMenu), 0);
        });
    }

    /***********************
     * Wire up everything
     ***********************/
    async function boot() {
        setupAutoBackup();
        await initializeChatTranscriptStorage();
        backfillCuratedBurnsFromTranscript();
        initAudio();

        const chatBootInterval = setInterval(() => {
            const chatContainer =
                document.querySelector(".chat-history") || document.querySelector(".chat-list");
            if (chatContainer) {
                clearInterval(chatBootInterval);
                initChatObserver(chatContainer);
                document
                    .querySelectorAll("button.chat-history--username.js-user-tag")
                    .forEach(attachContextMenuToUser);

                const userObserver = new MutationObserver((muts) => {
                    muts.forEach((m) => {
                        m.addedNodes.forEach((n) => {
                            if (n.nodeType === 1) {
                                if (n.matches && n.matches("button.chat-history--username.js-user-tag")) {
                                    attachContextMenuToUser(n);
                                }
                                n.querySelectorAll &&
                                    n.querySelectorAll("button.chat-history--username.js-user-tag").forEach(
                                        attachContextMenuToUser
                                    );
                            }
                        });
                    });
                });

                userObserver.observe(chatContainer, { childList: true, subtree: true });
            }
        }, 800);

        ensureFloatingSettingsButton();
        installOutgoingComposerFormatting();
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
    }

    // Expose API
    window.rumbleBlocker = window.rumbleBlocker || {};
    window.rumbleBlocker.refresh = refreshBlockedMessages;
    window.rumbleBlocker.export = exportData;
    window.rumbleBlocker.import = importData;
    window.rumbleBlocker.getSettings = () => settings;
    window.rumbleBlocker.getBlocked = () => blockedUsers;
    window.rumbleBlocker.exportChat = exportChatLog;
    window.rumbleBlocker.clearChat = clearChatLog;
    window.rumbleBlocker.getChatLog = () => chatLog.slice();
    window.rumbleBlocker.getCuratedBurns = () => JSON.parse(JSON.stringify(curatedBurnStore));
    window.rumbleBlocker.rebuildCuratedBurns = () => rebuildCuratedBurnsFromTranscript(true);
    window.rumbleBlocker.clearCuratedBurns = () => clearCuratedBurns();
    window.rumbleBlocker.formatOutgoing = (text) => formatOutgoingText(text);
    window.rumbleBlocker.getBurnRuntimeStatus = () => ({ ...burnRuntimeStatus, nickname: detectMyNickname(), composerFound: !!findChatComposer() });
    window.rumbleBlocker.sendChatMessage = (message) => sendChatMessage(String(message || ""));
    window.rumbleBlocker.getBurnEngines = () => ({
        curated: true,
        builtin: true,
        compromise: typeof nlp !== "undefined" || !!window.nlp,
        rita: typeof RiTa !== "undefined" || !!window.RiTa,
        markov: true,
        custom: typeof window.rumbleBlocker?.customBurnGenerator === "function"
    });
    window.rumbleBlocker.customBurnGenerator = window.rumbleBlocker.customBurnGenerator || null;
})();
