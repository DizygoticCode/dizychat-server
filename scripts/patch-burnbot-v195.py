from pathlib import Path

path = Path("scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js")
text = path.read_text(encoding="utf-8")

def replace_once(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    text = text.replace(old, new, 1)

replace_once("// @version      1.9.4", "// @version      1.9.5", "version")
replace_once(
    "// v1.9.4 auto-burn is deliberately hands-off; retire any persisted review prompt.",
    "// v1.9.5 keeps auto-burn hands-off and hardens live burn quality; retire any persisted review prompt.",
    "version comment",
)

replace_once(
"""    const builtInBurns = [
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
    ];""",
"""    const builtInBurns = [
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
    ];""",
    "built-in burns",
)

replace_once(
"""    let recentBurnResponses = [];
    let lastBurnEngineUsed = "none";""",
"""    let recentBurnResponses = [];
    let lastBurnEngineUsed = "none";
    const burnTagPressure = new Map();
    const BURN_PRESSURE_WINDOW_MS = 20 * 60 * 1000;
    const BURN_QUOTE_SENSITIVE_PATTERN = /\\b(?:address|postcode|phone|email|diagnos(?:ed|is)|cancer|hiv|autis(?:m|tic)|disabled|disability|pregnan(?:t|cy)|religion|muslims?|christians?|jews?|jewish|hindus?|sikhs?|gays?|lesbians?|bisexuals?|trans(?:gender)?|race|racial|ethnicity)\\b/i;

    function safeBurnQuote(text, maxLength = 72) {
        const raw = String(text || "").replace(/\\s+/g, " ").trim();
        if (!raw || CURATED_PERSONAL_DATA_PATTERN.test(raw) || BURN_QUOTE_SENSITIVE_PATTERN.test(raw)) return "";
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
            .replace(/\\s+/g, " ")
            .replace(/\\s+([,.;!?])/g, "$1")
            .trim();
        if (!candidate) return null;
        if (!/^@[A-Za-z0-9_.-]+\\b/.test(candidate)) candidate = `@${target} ${candidate}`;
        if (candidate.length < 18 || candidate.length > 240) return null;
        const body = candidate.replace(/^@[A-Za-z0-9_.-]+\\s+/, "");
        if (body.split(/\\s+/).filter(Boolean).length < 4) return null;
        if (/\\b(?:and|but|or)\\s+(?:and|but|or)\\b/i.test(body)) return null;
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
    }""",
    "burn quality helpers",
)

replace_once(
    "template: `@{target} same paste again — the archive has clocked this template ${statCount(stat)} times. Even copy-paste wants royalties.`",
    "template: `@{target} you've dropped that exact line ${statCount(stat)} times. Your copy button has more personality than the material.`",
    "repeat template",
)
replace_once(
    "template: `@{target} “${phrase}” again? Your chat history has put that line into syndication.`",
    "template: `@{target} “${phrase}” again? That's not a talking point, it's a screensaver.`",
    "phrase template",
)
replace_once(
    "template: `@{target} ${topic} again? At this point your chat history is a one-topic podcast.`",
    "template: `@{target} ${topic} again? Your entire personality is one tab stuck on autoplay.`",
    "topic template",
)
replace_once(
    "template: `@{target} pick a lane — the archive has “${a.text}” and later “${b.text}”. Your own transcript filed an objection.`",
    "template: `@{target} pick a story and survive it — the archive has “${a.text}” and later “${b.text}”. Your own transcript just cross-examined you.`",
    "contradiction template",
)
replace_once(
    "template: `@{target} after “${distinctive.text}” entered the archive, this sequel is doing brave things with continuity.`",
    "template: `@{target} “${distinctive.text}” was bad enough the first time. This sequel somehow found a basement.`",
    "callback template",
)

old_select = """    function selectCuratedBurn(ctx) {
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
    }"""
new_select = """    function selectCuratedBurn(ctx) {
        if (!settings.curatedBurnsEnabled || settings.burnEnginesEnabled?.curated === false) return null;
        const username = String(ctx.from || "").trim().toLowerCase();
        const profile = curatedBurnStore.users?.[username];
        const minMessages = Math.max(3, Number(settings.curatedBurnMinMessages) || 8);
        if (!profile || (Number(profile.messageCount) || 0) < minMessages) return null;

        const target = String(ctx.target || profile.displayName || username)
            .replace(/^@+/, "")
            .replace(/[^A-Za-z0-9_.-]/g, "")
            .slice(0, 40) || "there";
        const currentTokens = curatedTokens(ctx.message || "");
        const currentText = normalizeCuratedText(ctx.message || "");
        const tagCount = Math.max(1, Number(ctx.tagCount) || 1);
        const quote = safeBurnQuote(ctx.message || "");
        const ranked = Array.isArray(profile.burns)
            ? profile.burns.map((burn) => ({
                burn,
                live: false,
                rank: (Number(burn.score) || 0) + overlapCount(currentTokens, burn.keywords || []) * 4 - (Number(burn.timesUsed) || 0) * 3
            }))
            : [];

        const repeatKey = currentText.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\\s+/g, " ").trim();
        const repeatStat = repeatKey.length >= 12 ? profile.repeats?.[simpleCuratedHash(repeatKey)] : null;
        if (repeatStat && statCount(repeatStat) >= 2) {
            ranked.push({
                live: true,
                rank: 30 + statCount(repeatStat),
                burn: {
                    id: `live-repeat:${simpleCuratedHash(repeatKey)}`,
                    timesUsed: 0,
                    template: `@{target} you've posted that exact line ${statCount(repeatStat)} times. Your copy button is carrying the whole act.`
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
                rank: 19 + Math.min(tagCount, 6) * 2,
                burn: {
                    id: `live-quote:${simpleCuratedHash(`${quote}:${tagCount}`)}`,
                    timesUsed: 0,
                    template
                }
            });
        }

        if (!ranked.length) return null;
        ranked.sort((a, b) => b.rank - a.rank || (Number(a.burn.timesUsed) || 0) - (Number(b.burn.timesUsed) || 0));
        const bestRank = ranked[0]?.rank;
        const pool = ranked.filter((entry) => entry.rank >= bestRank - 2).slice(0, 3);
        const selected = pool[Math.floor(Math.random() * pool.length)];
        const chosen = selected?.burn;
        if (!chosen) return null;

        pendingCuratedBurnSelection = selected.live ? null : { username, burnId: chosen.id };
        return String(chosen.template || "").replace(/\\{target\\}/g, target).slice(0, 240);
    }"""
replace_once(old_select, new_select, "selectCuratedBurn")

replace_once(
"""        const normalizedCtx = {
            target: ctx.target || "there",
            from: String(ctx.from || "").trim().toLowerCase(),
            message: (ctx.message || "").replace(/\\s+/g, " ").trim().slice(0, 220),
            snippet: (ctx.message || "").replace(/\\s+/g, " ").trim().slice(0, 110)
        };""",
"""        const normalizedCtx = {
            target: ctx.target || "there",
            from: String(ctx.from || "").trim().toLowerCase(),
            message: (ctx.message || "").replace(/\\s+/g, " ").trim().slice(0, 220),
            snippet: (ctx.message || "").replace(/\\s+/g, " ").trim().slice(0, 110),
            tagCount: Math.max(1, Number(ctx.tagCount) || 1)
        };""",
    "normalized burn context",
)

replace_once(
"""        const engineOrder = [primary, "curated", "custom", "compromise", "rita", "markov", "builtin"]
            .filter((key, index, arr) => arr.indexOf(key) === index && enabled[key] !== false);""",
"""        const engineOrder = [primary, "curated", "builtin", "compromise", "rita", "custom", "markov"]
            .filter((key, index, arr) => arr.indexOf(key) === index && enabled[key] !== false);""",
    "engine order",
)

old_compromise = """            if (engine === "compromise") {
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
            }"""
new_compromise = """            if (engine === "compromise") {
                const nlpLib = typeof nlp !== "undefined" ? nlp : window.nlp;
                if (!nlpLib) return null;
                try {
                    const doc = nlpLib(normalizedCtx.message);
                    const noun = String(doc.nouns().toSingular().out("array")[0] || "")
                        .replace(/\\s+/g, " ")
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
            }"""
replace_once(old_compromise, new_compromise, "compromise engine")

old_rita = """            if (engine === "rita") {
                const ritaLib = typeof RiTa !== "undefined" ? RiTa : window.RiTa;
                if (!ritaLib) return null;
                try {
                    const lead = ritaLib.randomWord({ numSyllables: 1 });
                    const noun = ritaLib.randomWord({ pos: "nn" });
                    return `@${normalizedCtx.target} ${lead} ${noun} energy detected. Recompile your take.`;
                } catch (err) { console.warn("RiTa burn failed", err); return null; }
            }"""
new_rita = """            if (engine === "rita") {
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
            }"""
replace_once(old_rita, new_rita, "rita engine")

old_markov = """            if (engine === "markov") {
                const supplied = String(settings.burnMarkovCorpus || "")
                    .split(/\\r?\\n/)
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
            }"""
new_markov = """            if (engine === "markov") {
                const supplied = String(settings.burnMarkovCorpus || "")
                    .split(/\\r?\\n/)
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
            }"""
replace_once(old_markov, new_markov, "markov engine")

replace_once(
"""                const candidate = String(result).trim();
                if (!candidate) break;
                if (!isRecentBurn(candidate)) {
                    lastBurnEngineUsed = engine;
                    return candidate;
                }""",
"""                const candidate = cleanGeneratedBurn(result, normalizedCtx.target);
                if (!candidate) {
                    pendingCuratedBurnSelection = null;
                    continue;
                }
                if (!isRecentBurn(candidate)) {
                    lastBurnEngineUsed = engine;
                    return candidate;
                }""",
    "candidate quality gate",
)

replace_once(
"""    async function maybeHandleAutoBurn(ctx) {
        if (!settings.autoBurnEnabled || burnSendInFlight) return;
        const now = Date.now();
        const cooldownMs = Math.max(5, settings.autoBurnCooldownSeconds || 45) * 1000;
        if (now - lastBurnTimestamp < cooldownMs) return;
        const response = generateBurnResponse(ctx);
        const curatedSelection = pendingCuratedBurnSelection;""",
"""    async function maybeHandleAutoBurn(ctx) {
        if (!settings.autoBurnEnabled || burnSendInFlight) return;
        const tagCount = noteBurnPressure(ctx.from || ctx.target);
        const now = Date.now();
        const cooldownMs = Math.max(5, settings.autoBurnCooldownSeconds || 45) * 1000;
        if (now - lastBurnTimestamp < cooldownMs) return;
        const response = generateBurnResponse({ ...ctx, tagCount });
        const curatedSelection = pendingCuratedBurnSelection;""",
    "tag escalation",
)

replace_once(
"""        setBurnRuntimeStatus({ lastAttempt: `generated via ${lastBurnEngineUsed} for @${ctx.target || ctx.from}` });""",
"""        setBurnRuntimeStatus({ lastAttempt: `generated via ${lastBurnEngineUsed} for @${ctx.target || ctx.from} · tag #${tagCount}` });""",
    "runtime tag status",
)

replace_once(
"""            <div style="font-size:12px;color:gray;margin-top:4px">The Primary engine runs first. Other enabled engines are fallbacks only when the primary cannot produce a fresh burn; exact recent burns are skipped instead of repeated. Burn replies wait for an empty idle composer rather than trampling a message you are typing.</div>""",
"""            <div style="font-size:12px;color:gray;margin-top:4px">The Primary engine runs first. Curated now favours live quote-backs, exact-repeat evidence and repeated-tag escalation; savage built-ins are the first fallback. Weak or malformed generated mashups are discarded instead of sent. Burn replies still wait for an empty idle composer rather than trampling a message you are typing.</div>""",
    "settings copy",
)

path.write_text(text, encoding="utf-8")

required = [
    "// @version      1.9.5",
    "const burnTagPressure = new Map();",
    "function safeBurnQuote(",
    "function cleanGeneratedBurn(",
    "tag #${tagCount}",
    '"curated", "builtin", "compromise"',
    "you tagged me just to volunteer as the punchline",
]
for needle in required:
    if needle not in text:
        raise SystemExit(f"post-patch assertion failed: {needle}")
for forbidden in [
    "fallbackCorpus",
    "your hot take just failed the deterministic test suite",
    "arrived without dependencies",
    "requested a rollback",
]:
    if forbidden in text:
        raise SystemExit(f"stale burn filler survived: {forbidden}")
print("Patched", path, "to v1.9.5")
