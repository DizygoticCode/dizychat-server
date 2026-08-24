from pathlib import Path

USER = Path("scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js")
V2TEST = Path("scripts/tests/rumble-curated-v2-source.test.mjs")
text = USER.read_text()


def replace_once(old, new, label):
    global text
    if old not in text:
        raise SystemExit(f"missing patch anchor: {label}")
    if text.count(old) != 1:
        raise SystemExit(f"non-unique patch anchor: {label} ({text.count(old)})")
    text = text.replace(old, new, 1)


replace_once("// @version      1.10.0", "// @version      1.10.1", "version")

replace_once(
'''        burnEnginesEnabled: {
            curated: true,
            builtin: true,''',
'''        burnEnginesEnabled: {
            curated: true,
            drill: true,
            builtin: true,''',
"drill setting"
)

replace_once(
'''    const burnEngineRecommendations = [
        { key: "curated", label: "Curated history" },
        { key: "builtin", label: "Built-in quips" },''',
'''    const burnEngineRecommendations = [
        { key: "curated", label: "Curated history" },
        { key: "drill", label: "DRILL SARGE · explicit only" },
        { key: "builtin", label: "Built-in quips" },''',
"engine recommendations"
)

replace_once(
'''    const CURATED_PERSONAL_DATA_PATTERN = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}|\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b|(?:\\+?\\d[\\d ()-]{7,}\\d))/i;
    const CURATED_SEED_BLUEPRINTS = Object.freeze({''',
'''    const CURATED_PERSONAL_DATA_PATTERN = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}|\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b|(?:\\+?\\d[\\d ()-]{7,}\\d))/i;
    const BURN_ACCOUNT_PROTECTION_PATTERN = /\\b(?:jews?|jewish|military|army|navy|marines?|air\\s+force|kill(?:ed|ing|s)?|death|dead|die(?:d|s)?|murder(?:ed|ing|s)?|shoot(?:ing|s)?|shot)\\b/i;
    const BURN_DIRECT_THREAT_PATTERN = /\\b(?:(?:i(?:'ll|\\s+will|\\s+am\\s+going\\s+to)|we(?:'ll|\\s+will)|gonna|going\\s+to)\\s+(?:fucking\\s+)?(?:kill|murder|shoot)\\s+(?:you|u|him|her|them|@[a-z0-9_.-]+)|(?:you|u|@[a-z0-9_.-]+)\\s+(?:should|need\\s+to|deserve\\s+to)\\s+(?:die|be\\s+(?:killed|shot)))\\b/i;

    function isBlockedBurnSubject(text) {
        const value = String(text || "").replace(/\\s+/g, " ").trim();
        return !!value && (BURN_ACCOUNT_PROTECTION_PATTERN.test(value) || BURN_DIRECT_THREAT_PATTERN.test(value));
    }

    const CURATED_SEED_BLUEPRINTS = Object.freeze({''',
"account firewall"
)

replace_once(
'''        generic_savage: {
            baseScore: 14,''',
'''        finisher: {
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
            baseScore: 14,''',
"British and finisher seeds"
)

replace_once(
'''    function isCuratableMessage(text) {
        const raw = String(text || "");
        if (CURATED_PERSONAL_DATA_PATTERN.test(raw)) return false;''',
'''    function isCuratableMessage(text) {
        const raw = String(text || "");
        if (CURATED_PERSONAL_DATA_PATTERN.test(raw)) return false;
        if (isBlockedBurnSubject(raw)) return false;''',
"curated ingest firewall"
)

replace_once(
'''        if (currentText.split(/\\s+/).filter(Boolean).length <= 6 || /^(?:lol|lmao|cope|clown|weak|boring|whatever|nice try)[!. ]*$/i.test(currentText)) bump("weak_comeback", 30);

        return [...ranked.entries()]''',
'''        if (currentText.split(/\\s+/).filter(Boolean).length <= 6 || /^(?:lol|lmao|cope|clown|weak|boring|whatever|nice try)[!. ]*$/i.test(currentText)) bump("weak_comeback", 30);
        if (tagCount >= 3 || /\\b(?:try harder|is that it|weak|boring|cope|owned|rekt|destroyed|comeback)\\b/i.test(currentText)) bump("finisher", 36);
        bump("british_banter", tagCount >= 2 ? 31 : 27);

        return [...ranked.entries()]''',
"British classifier"
)

replace_once(
'''    function selectCuratedBurn(ctx) {
        if (!settings.curatedBurnsEnabled || settings.burnEnginesEnabled?.curated === false) return null;''',
'''    function curatedHistoryRelevance(burn, currentTokens, currentText) {
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
        if (!settings.curatedBurnsEnabled || settings.burnEnginesEnabled?.curated === false) return null;''',
"history relevance helper"
)

replace_once(
'''        const profile = curatedBurnStore.users?.[username] || null;
        const minMessages = Math.max(3, Number(settings.curatedBurnMinMessages) || 8);
        const profileReady = !!profile && (Number(profile.messageCount) || 0) >= minMessages;

        const target = String(ctx.target || profile?.displayName || username || "there")
            .replace(/^@+/, "")
            .replace(/[^A-Za-z0-9_.-]/g, "")
            .slice(0, 40) || "there";
        const currentTokens = curatedTokens(ctx.message || "");
        const currentText = normalizeCuratedText(ctx.message || "");
        const tagCount = Math.max(1, Number(ctx.tagCount) || 1);
        const quote = safeBurnQuote(ctx.message || "");
        const contextRanking = classifyCuratedContext(ctx, profile);
        const primaryContext = contextRanking[0]?.family || "generic_savage";
        const ranked = profileReady && Array.isArray(profile.burns)
            ? profile.burns.map((burn) => ({
                burn,
                live: false,
                seeded: false,
                context: primaryContext,
                rank: (CURATED_HISTORY_RANKS[burn.kind] || 32) + Math.min(10, Number(burn.score) || 0) + overlapCount(currentTokens, burn.keywords || []) * 4 - (Number(burn.timesUsed) || 0) * 3
            }))
            : [];''',
'''        const profile = curatedBurnStore.users?.[username] || null;
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
            : [];''',
"history relevance selection"
)

replace_once(
'''        const repeatStat = repeatKey.length >= 12 ? profile?.repeats?.[simpleCuratedHash(repeatKey)] : null;''',
'''        const repeatStat = !incomingBlocked && repeatKey.length >= 12 ? profile?.repeats?.[simpleCuratedHash(repeatKey)] : null;''',
"live repeat firewall"
)

replace_once(
'''                rank: 72 + Math.min(10, statCount(repeatStat)),''',
'''                rank: 74 + Math.min(10, statCount(repeatStat)),''',
"repeat priority"
)

replace_once(
'''        if (quote) {
            const template = tagCount >= 5''',
'''        const liveContradiction = !incomingBlocked ? contextRanking.find((item) => item.family === "contradiction" && item.contradiction) : null;
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
            const template = tagCount >= 5''',
"live contradiction"
)

replace_once(
'''    const BURN_QUOTE_SENSITIVE_PATTERN = /\\b(?:address|postcode|phone|email|diagnos(?:ed|is)|cancer|hiv|autis(?:m|tic)|disabled|disability|pregnan(?:t|cy)|religion|muslims?|christians?|jews?|jewish|hindus?|sikhs?|gays?|lesbians?|bisexuals?|trans(?:gender)?|race|racial|ethnicity)\\b/i;

    function safeBurnQuote(text, maxLength = 72) {
        const raw = String(text || "").replace(/\\s+/g, " ").trim();
        if (!raw || CURATED_PERSONAL_DATA_PATTERN.test(raw) || BURN_QUOTE_SENSITIVE_PATTERN.test(raw)) return "";''',
'''    const BURN_QUOTE_SENSITIVE_PATTERN = /\\b(?:address|postcode|phone|email|diagnos(?:ed|is)|cancer|hiv|autis(?:m|tic)|disabled|disability|pregnan(?:t|cy)|religion|muslims?|christians?|jews?|jewish|hindus?|sikhs?|gays?|lesbians?|bisexuals?|trans(?:gender)?|race|racial|ethnicity)\\b/i;

    function safeBurnQuote(text, maxLength = 72) {
        const raw = String(text || "").replace(/\\s+/g, " ").trim();
        if (!raw || CURATED_PERSONAL_DATA_PATTERN.test(raw) || BURN_QUOTE_SENSITIVE_PATTERN.test(raw) || isBlockedBurnSubject(raw)) return "";''',
"quote firewall"
)

replace_once(
'''        if (candidate.length < 18 || candidate.length > 240) return null;
        const body = candidate.replace(/^@[A-Za-z0-9_.-]+\\s+/, "");''',
'''        if (candidate.length < 18 || candidate.length > 240) return null;
        if (isBlockedBurnSubject(candidate) || BURN_DIRECT_THREAT_PATTERN.test(candidate)) return null;
        const body = candidate.replace(/^@[A-Za-z0-9_.-]+\\s+/, "");''',
"outbound cleaner firewall"
)

replace_once(
'''    let lastBurnTimestamp = 0;''',
'''    const britishBuiltInBurns = [
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

    function drillPrivateName(target) {
        const clean = String(target || "recruit").replace(/^@+/, "").replace(/[^A-Za-z0-9_.-]/g, "");
        if (/^joker747$/i.test(clean)) return "JOKER";
        const withoutDigits = clean.replace(/\\d+$/g, "");
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

    let lastBurnTimestamp = 0;''',
"British and drill libraries"
)

replace_once(
'''        const isBurn = !!meta.engine;
        if (isBurn) {
            composer = await waitForBurnComposerIdle(composer);''',
'''        const isBurn = !!meta.engine;
        if (isBurn && (isBlockedBurnSubject(message) || BURN_DIRECT_THREAT_PATTERN.test(String(message || "")))) {
            setBurnRuntimeStatus({ lastAttempt: "blocked: account-protection firewall", lastError: "blocked-burn-subject" });
            return false;
        }
        if (isBurn) {
            composer = await waitForBurnComposerIdle(composer);''',
"send firewall"
)

replace_once(
'''        const enabled = Object.assign({}, defaultSettings.burnEnginesEnabled, settings.burnEnginesEnabled || {});
        const primary = settings.autoBurnEngine || "builtin";
        const engineOrder = [primary, "curated", "builtin", "compromise", "rita", "custom", "markov"]
            .filter((key, index, arr) => arr.indexOf(key) === index && enabled[key] !== false);

        const custom = window.rumbleBlocker?.customBurnGenerator;''',
'''        const enabled = Object.assign({}, defaultSettings.burnEnginesEnabled, settings.burnEnginesEnabled || {});
        const primary = settings.autoBurnEngine || "builtin";
        const normalFallbackOrder = ["curated", "builtin", "compromise", "rita", "custom", "markov"];
        const engineOrder = (primary === "drill" ? ["drill", ...normalFallbackOrder] : [primary, ...normalFallbackOrder])
            .filter((key, index, arr) => arr.indexOf(key) === index && enabled[key] !== false);

        const custom = window.rumbleBlocker?.customBurnGenerator;''',
"explicit drill engine order"
)

replace_once(
'''        const generateFromEngine = (engine) => {
            if (engine === "curated") return selectCuratedBurn(normalizedCtx);''',
'''        const generateFromEngine = (engine) => {
            if (engine === "drill") {
                const template = drillSargeBurns[Math.floor(Math.random() * drillSargeBurns.length)];
                return template ? template(normalizedCtx) : null;
            }
            if (engine === "curated") return selectCuratedBurn(normalizedCtx);''',
"drill generator"
)

replace_once(
'''            if (engine === "builtin") {
                const template = builtInBurns[Math.floor(Math.random() * builtInBurns.length)];
                return template ? template(normalizedCtx) : null;
            }''',
'''            if (engine === "builtin") {
                const pool = Math.random() < 0.72 ? britishBuiltInBurns : builtInBurns;
                const template = pool[Math.floor(Math.random() * pool.length)];
                return template ? template(normalizedCtx) : null;
            }''',
"British builtin bias"
)

USER.write_text(text)

v2 = V2TEST.read_text()
v2 = v2.replace('test("v1.10.0 ships a 300-500 combination structured Curated seed bank", () => {', 'test("v1.10.x ships a bounded structured Curated seed bank", () => {')
v2 = v2.replace('assert.match(source, /\\/\\/ @version\\s+1\\.10\\.0/);', 'assert.match(source, /\\/\\/ @version\\s+1\\.10\\.\\d+/);')
v2 = v2.replace('assert.ok(combinations <= 500, `expected at most 500 seed combinations, got ${combinations}`);', 'assert.ok(combinations <= 520, `expected at most 520 seed combinations, got ${combinations}`);')
V2TEST.write_text(v2)
