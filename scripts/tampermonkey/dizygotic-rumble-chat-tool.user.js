// ==UserScript==
// @name         Dizygotic Rumble Chat Tool
// @namespace    http://tampermonkey.net/
// @version      1.9.4
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
    const CHAT_LOG_LIMIT = 20000;
    const CURATED_BURNS_KEY = "rumbleCuratedBurnsV1";
    const CURATED_BURNS_SCHEMA = 1;
    const CURATED_MAX_USERS = 120;

    let blockedUsers = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    let settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    let chatLog = JSON.parse(localStorage.getItem(CHAT_LOG_KEY) || "[]");
    if (!Array.isArray(chatLog)) chatLog = [];
    let chatSequence = chatLog.length ? Math.max(...chatLog.map((r) => Number(r.seq) || 0)) : 0;
    let curatedBurnStore = (() => {
        try {
            const parsed = JSON.parse(localStorage.getItem(CURATED_BURNS_KEY) || "null");
            return parsed && typeof parsed === "object" ? parsed : { schemaVersion: CURATED_BURNS_SCHEMA, lastProcessedSeq: 0, users: {} };
        } catch (err) {
            console.warn("Unable to load curated burn memory; starting clean", err);
            return { schemaVersion: CURATED_BURNS_SCHEMA, lastProcessedSeq: 0, users: {} };
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
        autoBurnEngine: "builtin",
        curatedBurnsEnabled: true,
        curatedBurnMinMessages: 8,
        curatedBurnRefreshEvery: 3,
        curatedBurnMaxPerUser: 12,
        curatedBurnReviewBeforeUse: false,
        burnEnginesEnabled: {
            curated: true,
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
    // v1.9.4 auto-burn is deliberately hands-off; retire any persisted review prompt.
    settings.curatedBurnReviewBeforeUse = false;

    function saveBlocklist() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(blockedUsers));
    }

    function saveSettings() {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }

    let chatLogSaveTimer = null;
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
        const text = value == null ? "" : String(value);
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }

    function exportChatLog(format = "json") {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        if (format === "csv") {
            const header = ["seq","capturedAt","username","displayName","message","mentions","rawHtml","rowClass","url","title","botGenerated","botEngine","botTarget","botFontStyle"];
            const rows = chatLog.map((r) => [r.seq,r.capturedAt,r.username,r.displayName,r.message,(r.mentions||[]).join(" "),r.rawHtml||"",r.rowClass||"",r.url,r.title,r.botGenerated?"true":"",r.botEngine||"",r.botTarget||"",r.botFontStyle||""].map(csvEscape).join(","));
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
    let curatedSaveTimer = null;
    let pendingCuratedBurnSelection = null;

    function normalizeCuratedStore(value) {
        const store = value && typeof value === "object" ? value : {};
        if (!store.users || typeof store.users !== "object" || Array.isArray(store.users)) store.users = {};
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
        return `${profiles.length} learned users · ${ready} ready · ${burns} curated burns`;
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
                template: `@{target} same paste again — the archive has clocked this template ${statCount(stat)} times. Even copy-paste wants royalties.`
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
                template: `@{target} “${phrase}” again? Your chat history has put that line into syndication.`
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
                template: `@{target} ${topic} again? At this point your chat history is a one-topic podcast.`
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
                    template: `@{target} pick a lane — the archive has “${a.text}” and later “${b.text}”. Your own transcript filed an objection.`
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
                template: `@{target} after “${distinctive.text}” entered the archive, this sequel is doing brave things with continuity.`
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

    function rebuildCuratedBurnsFromTranscript(reset = true) {
        if (reset) curatedBurnStore = { schemaVersion: CURATED_BURNS_SCHEMA, lastProcessedSeq: 0, users: {} };
        const touched = new Set();
        const records = chatLog.slice(-5000);
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
        const pending = chatLog.filter((record) => (Number(record.seq) || 0) > lastProcessed).slice(-5000);
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
        curatedBurnStore = { schemaVersion: CURATED_BURNS_SCHEMA, lastProcessedSeq: 0, users: {} };
        localStorage.removeItem(CURATED_BURNS_KEY);
        if (!options.silent) console.log("🔥 Curated burn memory cleared");
        updateCuratedBurnStatus();
    }

    function selectCuratedBurn(ctx) {
        if (!settings.curatedBurnsEnabled || settings.burnEnginesEnabled?.curated === false) return null;
        const username = String(ctx.from || "").trim().toLowerCase();
        const profile = curatedBurnStore.users?.[username];
        const minMessages = Math.max(3, Number(settings.curatedBurnMinMessages) || 8);
        if (!profile || (Number(profile.messageCount) || 0) < minMessages || !Array.isArray(profile.burns) || !profile.burns.length) return null;

        const currentTokens = curatedTokens(ctx.message || "");
        const ranked = profile.burns
            .map((burn) => ({
                burn,
                rank: (Number(burn.score) || 0) + overlapCount(currentTokens, burn.keywords || []) * 4 - (Number(burn.timesUsed) || 0) * 3
            }))
            .sort((a, b) => b.rank - a.rank || (Number(a.burn.timesUsed) || 0) - (Number(b.burn.timesUsed) || 0));
        const bestRank = ranked[0]?.rank;
        const pool = ranked.filter((entry) => entry.rank >= bestRank - 2).slice(0, 3);
        const chosen = pool[Math.floor(Math.random() * pool.length)]?.burn;
        if (!chosen) return null;

        const target = String(ctx.target || profile.displayName || username)
            .replace(/^@+/, "")
            .replace(/[^A-Za-z0-9_.-]/g, "")
            .slice(0, 40) || "there";
        pendingCuratedBurnSelection = { username, burnId: chosen.id };
        return String(chosen.template || "").replace(/\{target\}/g, target).slice(0, 280);
    }

    function markCuratedBurnUsed(selection) {
        if (!selection?.username || !selection?.burnId) return;
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
                <span style="font-size:12px;color:gray">${chatLog.length} saved messages</span>
            </div>
            <div style="height:12px"></div>

            <b>Curated burn memory</b>
            <div style="font-size:12px;color:gray;margin-top:3px">Automatically learns reusable callbacks from the locally recorded public chat. It stores bounded phrase/topic/repetition evidence and source message sequence IDs; messages that look sensitive or contain personal contact/network data are ignored.</div>
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
                <label>Primary engine</label>
                <select id="autoBurnEngineSelect">${burnEngineRecommendations.map((r) => `<option value="${r.key}"${settings.autoBurnEngine === r.key ? " selected" : ""}>${r.label}</option>`).join("")}</select>
            </div>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:7px;font-size:12px">
                ${burnEngineRecommendations.map((r) => `<label><input type="checkbox" data-burn-engine-toggle="${r.key}"${settings.burnEnginesEnabled?.[r.key] !== false ? " checked" : ""}> ${r.label}</label>`).join("")}
            </div>
            <div style="font-size:12px;color:gray;margin-top:4px">The Primary engine runs first. Other enabled engines are fallbacks only when the primary cannot produce a fresh burn; exact recent burns are skipped instead of repeated. Burn replies wait for an empty idle composer rather than trampling a message you are typing.</div>
            <div style="font-size:12px;color:gray;margin-top:4px">Successful Burn Bot echoes are labelled with engine, target and font style in new transcript exports so future live tests can be analysed directly.</div>
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
        buttonRow.appendChild(createAccentButton("Chat JSON", () => exportChatLog("json"), "#673ab7", "🧾"));
        buttonRow.appendChild(createAccentButton("Chat CSV", () => exportChatLog("csv"), "#3f51b5", "📊"));
        buttonRow.appendChild(createAccentButton("Clear Chat Log", () => { if (confirm("Clear saved local chat transcript?")) { clearChatLog(); alert("✅ Chat transcript cleared."); } }, "#795548", "🧹"));
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
            rebuildCuratedBtn.addEventListener("click", () => {
                settings.curatedBurnsEnabled = !!panel.querySelector("#curatedBurnsEnabledInput")?.checked;
                settings.curatedBurnMinMessages = Math.max(3, Math.min(100, parseInt(panel.querySelector("#curatedBurnMinMessagesInput")?.value, 10) || 8));
                settings.curatedBurnRefreshEvery = Math.max(1, Math.min(50, parseInt(panel.querySelector("#curatedBurnRefreshEveryInput")?.value, 10) || 3));
                settings.curatedBurnMaxPerUser = Math.max(3, Math.min(40, parseInt(panel.querySelector("#curatedBurnMaxPerUserInput")?.value, 10) || 12));
                saveSettings();
                rebuildCuratedBurnsFromTranscript(true);
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
        ({ target }) => `@${target} you just pinged the wrong dojo.`,
        ({ target }) => `@${target} that's a bold take for someone typing with mittens.`,
        ({ target }) => `@${target} you rang? I brought receipts and a thesaurus.`,
        ({ target }) => `@${target} touch grass, clear cache, try again.`,
        ({ target }) => `@${target} noted. Filing under 'draft tweets'.`,
        ({ target }) => `@${target} your confidence has excellent uptime; shame the argument doesn't.`,
        ({ target }) => `@${target} I've seen stronger logic in a 404 page.`,
        ({ target }) => `@${target} that comeback needs a rollback and an apology to punctuation.`,
        ({ target }) => `@${target} your point filed for bankruptcy halfway through the sentence.`,
        ({ target }) => `@${target} even your typo is trying to distance itself from that take.`
    ];
    let lastBurnTimestamp = 0;
    const RECENT_BURN_LIMIT = 12;
    let recentBurnResponses = [];
    let lastBurnEngineUsed = "none";

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
            botFontStyle: pendingBurnEcho.fontStyle
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
                colourIndex += 1;
                target.appendChild(span);
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
            snippet: (ctx.message || "").replace(/\s+/g, " ").trim().slice(0, 110)
        };
        const enabled = Object.assign({}, defaultSettings.burnEnginesEnabled, settings.burnEnginesEnabled || {});
        const primary = settings.autoBurnEngine || "builtin";
        const engineOrder = [primary, "curated", "custom", "compromise", "rita", "markov", "builtin"]
            .filter((key, index, arr) => arr.indexOf(key) === index && enabled[key] !== false);

        const custom = window.rumbleBlocker?.customBurnGenerator;

        const generateFromEngine = (engine) => {
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
                    const verb = doc.verbs().toInfinitive().out("array")[0] || "ping";
                    const noun = doc.nouns().out("array")[0] || "take";
                    const variants = [
                        `@${normalizedCtx.target} bold ${verb} on that ${noun}. Wanna run that again?`,
                        `@${normalizedCtx.target} that ${noun} just failed review. Maybe ${verb} it after the patch notes land.`,
                        `@${normalizedCtx.target} impressive ${noun}. Shame the ${verb} part arrived without dependencies.`,
                        `@${normalizedCtx.target} the logs saw that ${noun} and immediately requested a rollback.`
                    ];
                    return variants[Math.floor(Math.random() * variants.length)];
                } catch (err) { console.warn("Compromise burn failed", err); return null; }
            }
            if (engine === "rita") {
                const ritaLib = typeof RiTa !== "undefined" ? RiTa : window.RiTa;
                if (!ritaLib) return null;
                try {
                    const lead = ritaLib.randomWord({ numSyllables: 1 });
                    const noun = ritaLib.randomWord({ pos: "nn" });
                    return `@${normalizedCtx.target} ${lead} ${noun} energy detected. Recompile your take.`;
                } catch (err) { console.warn("RiTa burn failed", err); return null; }
            }
            if (engine === "markov") {
                const supplied = String(settings.burnMarkovCorpus || "")
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .filter(Boolean);
                const hookCorpus = Array.isArray(window.rumbleBlocker?.burnMarkovSource)
                    ? window.rumbleBlocker.burnMarkovSource
                    : [];
                const fallbackCorpus = [
                    "that take needs a patch note before production.",
                    "you rang and brought a beta opinion to a release build.",
                    "clear cache touch grass and try that sentence again.",
                    "bold claim but the logs are not on your side.",
                    "that argument arrived without dependencies installed.",
                    "your hot take just failed the deterministic test suite."
                ];
                const phrase = simpleMarkovGenerate([...supplied, ...hookCorpus, ...fallbackCorpus]);
                return phrase ? `@${normalizedCtx.target} ${phrase}` : null;
            }
            if (engine === "builtin") {
                const template = builtInBurns[Math.floor(Math.random() * builtInBurns.length)];
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
                const candidate = String(result).trim();
                if (!candidate) break;
                if (!isRecentBurn(candidate)) {
                    lastBurnEngineUsed = engine;
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
        const now = Date.now();
        const cooldownMs = Math.max(5, settings.autoBurnCooldownSeconds || 45) * 1000;
        if (now - lastBurnTimestamp < cooldownMs) return;
        const response = generateBurnResponse(ctx);
        const curatedSelection = pendingCuratedBurnSelection;
        if (!response) {
            setBurnRuntimeStatus({ lastAttempt: "no burn generated" });
            pendingCuratedBurnSelection = null;
            return;
        }
        burnSendInFlight = true;
        setBurnRuntimeStatus({ lastAttempt: `generated via ${lastBurnEngineUsed} for @${ctx.target || ctx.from}` });
        try {
            const sent = await sendChatMessage(response, { engine: lastBurnEngineUsed, target: ctx.target || ctx.from || "" });
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
    function boot() {
        setupAutoBackup();
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
        window.addEventListener("beforeunload", saveChatLog, { once: true });
    }

    if (document.readyState === "complete" || document.readyState === "interactive") {
        boot();
    } else {
        window.addEventListener("DOMContentLoaded", boot);
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
