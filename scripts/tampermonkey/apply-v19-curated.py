from pathlib import Path
import re

USER = Path("scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js")
README = Path("README.md")
EXT_README = Path("browser-extension/README.md")

s = USER.read_text()


def one(old: str, new: str, label: str):
    global s
    count = s.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    s = s.replace(old, new, 1)


one("// @version      1.8.1\n", "// @version      1.9\n", "version")
one(
    "// @description  All-in-one chat tool for Rumble: private dm chat, user blocker + keyword filter + highlights + compact mode + timestamps + notifications + autoscroll lock + collapse long messages + stats + transcript recorder/export + font controls + auto-burn + export/import + auto-backup. Non-flashing, persistent, draggable settings panel.\n",
    "// @description  All-in-one chat tool for Rumble: private dm chat, user blocker + keyword filter + highlights + compact mode + timestamps + notifications + autoscroll lock + collapse long messages + stats + transcript recorder/export + automated curated burn memory + font controls + auto-burn + export/import + auto-backup. Non-flashing, persistent, draggable settings panel.\n",
    "description",
)

one(
    '    const CHAT_LOG_KEY = "rumbleChatTranscriptLogV1";\n    const CHAT_LOG_LIMIT = 20000;\n',
    '    const CHAT_LOG_KEY = "rumbleChatTranscriptLogV1";\n    const CHAT_LOG_LIMIT = 20000;\n    const CURATED_BURNS_KEY = "rumbleCuratedBurnsV1";\n    const CURATED_BURNS_SCHEMA = 1;\n    const CURATED_MAX_USERS = 120;\n',
    "curated storage constants",
)

one(
    '    let chatSequence = chatLog.length ? Math.max(...chatLog.map((r) => Number(r.seq) || 0)) : 0;\n\n    const defaultSettings = {\n',
    '''    let chatSequence = chatLog.length ? Math.max(...chatLog.map((r) => Number(r.seq) || 0)) : 0;
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
''',
    "curated store load",
)

one(
    '''        autoBurnEnabled: false,
        autoBurnCooldownSeconds: 45,
        autoBurnEngine: "builtin",
        burnEnginesEnabled: {
            builtin: true,
            compromise: true,
            rita: true,
            markov: true,
            custom: true
        },
        burnMarkovCorpus: ""
''',
    '''        autoBurnEnabled: false,
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
''',
    "curated defaults",
)

one(
    '''    function recordChatMessage(el, username, displayName, message) {
        if (!settings.chatRecorderEnabled || !el || el._chatLogged || !username) return;
        const clean = (message || "").replace(/\\s+/g, " ").trim();
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
        chatLog.push(record);
        if (chatLog.length > CHAT_LOG_LIMIT) chatLog.splice(0, chatLog.length - CHAT_LOG_LIMIT);
        scheduleChatLogSave();
    }
''',
    '''    function recordChatMessage(el, username, displayName, message) {
        if (!settings.chatRecorderEnabled || !el || el._chatLogged || !username) return;
        const clean = (message || "").replace(/\\s+/g, " ").trim();
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
        chatLog.push(record);
        if (chatLog.length > CHAT_LOG_LIMIT) chatLog.splice(0, chatLog.length - CHAT_LOG_LIMIT);
        ingestCuratedRecord(record);
        scheduleChatLogSave();
    }
''',
    "recorder curated ingestion",
)

one(
    '''    function clearChatLog() {
        chatLog = [];
        chatSequence = 0;
        localStorage.removeItem(CHAT_LOG_KEY);
    }
''',
    '''    function clearChatLog() {
        chatLog = [];
        chatSequence = 0;
        localStorage.removeItem(CHAT_LOG_KEY);
        clearCuratedBurns({ silent: true });
    }
''',
    "clear transcript clears derived memory",
)

one(
    '''    const burnEngineRecommendations = [
        { key: "builtin", label: "Built-in quips" },
        { key: "compromise", label: "compromise NLP" },
        { key: "rita", label: "RiTa creative" },
        { key: "markov", label: "Markov corpus" },
        { key: "custom", label: "Custom hook" }
    ];
''',
    '''    const burnEngineRecommendations = [
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
    const CURATED_SENSITIVE_PATTERN = /\\b(?:address|postcode|phone|email|diagnos(?:ed|is)|cancer|hiv|autis(?:m|tic)|disabled|disability|pregnan(?:t|cy)|religion|muslim|christian|jew(?:ish)?|hindu|sikh|gay|lesbian|bisexual|trans(?:gender)?|race|racial|ethnicity)\\b/i;
    const CURATED_PERSONAL_DATA_PATTERN = /(?:https?:\\/\\/|www\\.|[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}|\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b|(?:\\+?\\d[\\d ()-]{7,}\\d))/i;
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
            .replace(/https?:\\/\\/\\S+/gi, " ")
            .replace(/@[A-Za-z0-9_.-]+/g, " ")
            .replace(/\\s+/g, " ")
            .trim()
            .slice(0, 220);
    }

    function isCuratableMessage(text) {
        const value = normalizeCuratedText(text);
        if (value.length < 8 || value.length > 220) return false;
        if (CURATED_SENSITIVE_PATTERN.test(value) || CURATED_PERSONAL_DATA_PATTERN.test(value)) return false;
        return true;
    }

    function curatedWords(text) {
        return normalizeCuratedText(text)
            .toLowerCase()
            .replace(/[^a-z0-9_' -]+/g, " ")
            .split(/\\s+/)
            .map((word) => word.replace(/^'+|'+$/g, ""))
            .filter(Boolean);
    }

    function curatedTokens(text) {
        return [...new Set(curatedWords(text).filter((word) => word.length >= 4 && !CURATED_STOP_WORDS.has(word)))].slice(0, 14);
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
                template: `@{target} you have already shipped “${stat.sample}” ${statCount(stat)} times. Even copy-paste wants royalties.`
            }));

        Object.entries(profile.phrases || {})
            .filter(([, stat]) => statCount(stat) >= 3)
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
            .filter(([, stat]) => statCount(stat) >= 4)
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
        const negated = /\\b(?:no|not|never|isnt|isn't|arent|aren't|dont|don't|doesnt|doesn't|didnt|didn't|cant|can't|wont|won't|wouldnt|wouldn't|shouldnt|shouldn't)\\b/i.test(text);
        profile.messageCount = (Number(profile.messageCount) || 0) + 1;
        profile.lastSeq = seq || profile.lastSeq || 0;
        profile.updatedAt = record.capturedAt || new Date().toISOString();
        profile.recent.push({ seq, text: text.slice(0, 90), tokens, negated });
        profile.recent = profile.recent.slice(-18);

        tokens.forEach((token) => incrementCuratedStat(profile.topics, token, seq));
        curatedPhrases(text).forEach((phrase) => incrementCuratedStat(profile.phrases, phrase, seq));
        const normalizedRepeat = text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\\s+/g, " ").trim();
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
        return String(chosen.template || "").replace(/\\{target\\}/g, target).slice(0, 280);
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
''',
    "curated engine and memory helpers",
)

one(
    '    function settingsSnapshot() {\n        return { blockedUsers, settings };\n    }\n',
    '    function settingsSnapshot() {\n        return { blockedUsers, settings, curatedBurns: curatedBurnStore };\n    }\n',
    "export curated bank",
)

one(
    '''                    blockedUsers = data.blockedUsers;
                    settings = Object.assign({}, defaultSettings, data.settings);
                    saveBlocklist();
                    saveSettings();
''',
    '''                    blockedUsers = data.blockedUsers;
                    settings = Object.assign({}, defaultSettings, data.settings);
                    settings.burnEnginesEnabled = Object.assign({}, defaultSettings.burnEnginesEnabled, data.settings?.burnEnginesEnabled || {});
                    if (data.curatedBurns && typeof data.curatedBurns === "object") {
                        curatedBurnStore = normalizeCuratedStore(data.curatedBurns);
                        saveCuratedBurnStore();
                    }
                    saveBlocklist();
                    saveSettings();
''',
    "import curated bank",
)

one(
    '''            <b>Auto-burn bot</b>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px">
''',
    '''            <b>Curated burn memory</b>
            <div style="font-size:12px;color:gray;margin-top:3px">Automatically learns reusable callbacks from the locally recorded public chat. It stores bounded phrase/topic/repetition evidence and source message sequence IDs; messages that look sensitive or contain personal contact/network data are ignored.</div>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:7px">
                <label><input type="checkbox" id="curatedBurnsEnabledInput"${settings.curatedBurnsEnabled ? " checked" : ""}> Learn automatically</label>
                <label>Min messages</label>
                <input type="number" id="curatedBurnMinMessagesInput" min="3" max="100" value="${settings.curatedBurnMinMessages}" style="width:64px">
                <label>Refresh every</label>
                <input type="number" id="curatedBurnRefreshEveryInput" min="1" max="50" value="${settings.curatedBurnRefreshEvery}" style="width:58px">
                <label>Max/user</label>
                <input type="number" id="curatedBurnMaxPerUserInput" min="3" max="40" value="${settings.curatedBurnMaxPerUser}" style="width:58px">
                <label><input type="checkbox" id="curatedBurnReviewInput"${settings.curatedBurnReviewBeforeUse ? " checked" : ""}> Review before send</label>
            </div>
            <div id="curatedBurnStatus" style="font-size:12px;color:gray;margin-top:5px">${curatedBurnSummaryText()}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
                <button type="button" id="rebuildCuratedBurnsBtn">Rebuild from transcript</button>
                <button type="button" id="clearCuratedBurnsBtn">Clear curated bank</button>
            </div>
            <div style="height:12px"></div>

            <b>Auto-burn bot</b>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px">
''',
    "curated UI",
)

one(
    '''            settings.autoBurnEnabled = !!panel.querySelector("#autoBurnToggle")?.checked;
            settings.autoBurnCooldownSeconds = Math.max(5, parseInt(panel.querySelector("#autoBurnCooldownInput")?.value, 10) || 45);
            settings.autoBurnEngine = panel.querySelector("#autoBurnEngineSelect")?.value || "builtin";
''',
    '''            settings.curatedBurnsEnabled = !!panel.querySelector("#curatedBurnsEnabledInput")?.checked;
            settings.curatedBurnMinMessages = Math.max(3, Math.min(100, parseInt(panel.querySelector("#curatedBurnMinMessagesInput")?.value, 10) || 8));
            settings.curatedBurnRefreshEvery = Math.max(1, Math.min(50, parseInt(panel.querySelector("#curatedBurnRefreshEveryInput")?.value, 10) || 3));
            settings.curatedBurnMaxPerUser = Math.max(3, Math.min(40, parseInt(panel.querySelector("#curatedBurnMaxPerUserInput")?.value, 10) || 12));
            settings.curatedBurnReviewBeforeUse = !!panel.querySelector("#curatedBurnReviewInput")?.checked;
            settings.autoBurnEnabled = !!panel.querySelector("#autoBurnToggle")?.checked;
            settings.autoBurnCooldownSeconds = Math.max(5, parseInt(panel.querySelector("#autoBurnCooldownInput")?.value, 10) || 45);
            settings.autoBurnEngine = panel.querySelector("#autoBurnEngineSelect")?.value || "builtin";
''',
    "save curated settings",
)

one(
    '''            blockedUsers = [];
            settings = Object.assign({}, defaultSettings);
            if (audio) audio.src = "";
''',
    '''            blockedUsers = [];
            settings = Object.assign({}, defaultSettings);
            settings.burnEnginesEnabled = Object.assign({}, defaultSettings.burnEnginesEnabled);
            clearCuratedBurns({ silent: true });
            if (audio) audio.src = "";
''',
    "clear all curated",
)

one(
    '''        const stats = panel.querySelector("#statsSummary");
        stats.innerText = `Blocked users: ${blockedUsers.length} · Keywords: ${settings.blockedKeywords.length} · Highlighted: ${settings.highlightedUsers.length} · Logged chat: ${chatLog.length}`;

        document.body.appendChild(panel);
''',
    '''        const rebuildCuratedBtn = panel.querySelector("#rebuildCuratedBurnsBtn");
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
''',
    "curated panel buttons",
)

one(
    '        applyThemeToPanel(panel);\n        updateBackupStatus(panel);\n\n        const loadInstalledFontsBtn',
    '        applyThemeToPanel(panel);\n        updateBackupStatus(panel);\n        updateCuratedBurnStatus(panel);\n\n        const loadInstalledFontsBtn',
    "curated status init",
)

one(
    '''        const normalizedCtx = {
            target: ctx.target || "there",
            message: (ctx.message || "").replace(/\\s+/g, " ").trim().slice(0, 110),
            snippet: (ctx.message || "").replace(/\\s+/g, " ").trim().slice(0, 110)
        };
        const enabled = Object.assign({}, defaultSettings.burnEnginesEnabled, settings.burnEnginesEnabled || {});
        const preferred = settings.autoBurnEngine || "builtin";
        const engineOrder = [preferred, "custom", "compromise", "rita", "markov", "builtin"]
            .filter((key, index, arr) => arr.indexOf(key) === index && enabled[key] !== false);
''',
    '''        pendingCuratedBurnSelection = null;
        const normalizedCtx = {
            target: ctx.target || "there",
            from: String(ctx.from || "").trim().toLowerCase(),
            message: (ctx.message || "").replace(/\\s+/g, " ").trim().slice(0, 220),
            snippet: (ctx.message || "").replace(/\\s+/g, " ").trim().slice(0, 110)
        };
        const enabled = Object.assign({}, defaultSettings.burnEnginesEnabled, settings.burnEnginesEnabled || {});
        const preferred = settings.autoBurnEngine || "builtin";
        const engineOrder = ["curated", preferred, "custom", "compromise", "rita", "markov", "builtin"]
            .filter((key, index, arr) => arr.indexOf(key) === index && enabled[key] !== false);
''',
    "curated engine priority",
)

one(
    '''        for (const engine of engineOrder) {
            if (engine === "custom") {
''',
    '''        for (const engine of engineOrder) {
            if (engine === "curated") {
                const result = selectCuratedBurn(normalizedCtx);
                if (result) return result;
            }
            if (engine === "custom") {
''',
    "curated generator branch",
)

one(
    '''    function maybeHandleAutoBurn(ctx) {
        if (!settings.autoBurnEnabled) return;
        const now = Date.now();
        const cooldownMs = Math.max(5, settings.autoBurnCooldownSeconds || 45) * 1000;
        if (now - lastBurnTimestamp < cooldownMs) return;
        const response = generateBurnResponse(ctx);
        if (response && sendChatMessage(response)) lastBurnTimestamp = now;
    }
''',
    '''    function maybeHandleAutoBurn(ctx) {
        if (!settings.autoBurnEnabled) return;
        const now = Date.now();
        const cooldownMs = Math.max(5, settings.autoBurnCooldownSeconds || 45) * 1000;
        if (now - lastBurnTimestamp < cooldownMs) return;
        const response = generateBurnResponse(ctx);
        const curatedSelection = pendingCuratedBurnSelection;
        if (response && curatedSelection && settings.curatedBurnReviewBeforeUse) {
            const approved = confirm(`Curated burn for @${ctx.target || ctx.from}:\\n\\n${response}\\n\\nSend it?`);
            if (!approved) {
                pendingCuratedBurnSelection = null;
                return;
            }
        }
        if (response && sendChatMessage(response)) {
            lastBurnTimestamp = now;
            if (curatedSelection) markCuratedBurnUsed(curatedSelection);
        }
        pendingCuratedBurnSelection = null;
    }
''',
    "curated send accounting",
)

one(
    '''    function boot() {
        setupAutoBackup();
        initAudio();
''',
    '''    function boot() {
        setupAutoBackup();
        backfillCuratedBurnsFromTranscript();
        initAudio();
''',
    "curated boot backfill",
)

one(
    '''    window.rumbleBlocker.getChatLog = () => chatLog.slice();
    window.rumbleBlocker.getBurnEngines = () => ({
        builtin: true,
''',
    '''    window.rumbleBlocker.getChatLog = () => chatLog.slice();
    window.rumbleBlocker.getCuratedBurns = () => JSON.parse(JSON.stringify(curatedBurnStore));
    window.rumbleBlocker.rebuildCuratedBurns = () => rebuildCuratedBurnsFromTranscript(true);
    window.rumbleBlocker.clearCuratedBurns = () => clearCuratedBurns();
    window.rumbleBlocker.getBurnEngines = () => ({
        curated: true,
        builtin: true,
''',
    "curated API",
)

USER.write_text(s)

r = README.read_text()
r = r.replace("**Dizygotic Rumble Chat Companion v1.8.1**", "**Dizygotic Rumble Chat Companion v1.9**")
r = r.replace("**Rumble Chat Companion v1.8.1**", "**Rumble Chat Companion v1.9**")
old_recent = "- **Rumble Chat Companion v1.9** – the companion userscript now adds a bounded passive transcript recorder with JSON/CSV export, configurable installed fonts/font sizes/text colours, per-character rainbow and multi-colour display modes, independently enableable burn engines, backward-compatible settings import/export, and the existing block/highlight/DM toolset. Auto-backup now silently overwrites a single localStorage backup slot with timestamp/filename metadata; only manual Export opens a download."
new_recent = old_recent + " v1.9 adds automatic local curated-burn memory: recorded public chat is distilled into bounded per-user repetition, phrase, topic and contradiction evidence with source sequence IDs; Curated History is tried automatically before generic burn engines when enough history exists, while sensitive/contact/network-looking messages are excluded from curation."
if old_recent not in r:
    raise SystemExit("README recent companion bullet not found")
r = r.replace(old_recent, new_recent, 1)
README.write_text(r)

er = EXT_README.read_text()
er = er.replace(
    "The extension preserves the blocker/highlighter, keyword filters, compact mode, timestamps, notifications, autoscroll lock, long-message handling, DizyChat DM handoff, transcript recorder/export, font and colour controls, rainbow/multi-colour local rendering, portable settings, draggable settings UI, and selectable burn engines.",
    "The extension preserves the blocker/highlighter, keyword filters, compact mode, timestamps, notifications, autoscroll lock, long-message handling, DizyChat DM handoff, transcript recorder/export, automatic local curated-burn memory, font and colour controls, rainbow/multi-colour local rendering, portable settings, draggable settings UI, and selectable burn engines.",
)
er = er.replace("- Compromise `14.7.0`\n- RiTa `2.0.2`", "- Compromise `14.14.4`\n- RiTa `3.2.16`")
EXT_README.write_text(er)

# Static release-contract checks before CI takes over.
final = USER.read_text()
assert "// @version      1.9" in final
assert 'const CURATED_BURNS_KEY = "rumbleCuratedBurnsV1"' in final
assert 'ingestCuratedRecord(record);' in final
assert 'saveLocalBackup("auto")' in final
assert 'const engineOrder = ["curated", preferred' in final
assert 'sourceSeqs:' in final
assert 'window.rumbleBlocker.getCuratedBurns' in final
assert 'settings.curatedBurnReviewBeforeUse' in final
