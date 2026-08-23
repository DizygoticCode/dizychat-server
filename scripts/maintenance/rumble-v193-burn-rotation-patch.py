from pathlib import Path

SCRIPT = Path('scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js')
text = SCRIPT.read_text()


def one(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, got {count}')
    text = text.replace(old, new, 1)


one('// @version      1.9.2', '// @version      1.9.3', 'version')

one(
    '''    settings.burnEnginesEnabled = Object.assign(
        {},
        defaultSettings.burnEnginesEnabled,
        settings.burnEnginesEnabled || {}
    );''',
    '''    settings.burnEnginesEnabled = Object.assign(
        {},
        defaultSettings.burnEnginesEnabled,
        settings.burnEnginesEnabled || {}
    );
    // v1.9.3 auto-burn is deliberately hands-off; retire any persisted review prompt.
    settings.curatedBurnReviewBeforeUse = false;''',
    'disable persisted review prompt'
)

one(
    '''                    settings.burnEnginesEnabled = Object.assign({}, defaultSettings.burnEnginesEnabled, data.settings?.burnEnginesEnabled || {});
                    if (data.curatedBurns && typeof data.curatedBurns === "object") {''',
    '''                    settings.burnEnginesEnabled = Object.assign({}, defaultSettings.burnEnginesEnabled, data.settings?.burnEnginesEnabled || {});
                    settings.curatedBurnReviewBeforeUse = false;
                    if (data.curatedBurns && typeof data.curatedBurns === "object") {''',
    'disable imported review prompt'
)

one(
    '''                <label><input type="checkbox" id="curatedBurnReviewInput"${settings.curatedBurnReviewBeforeUse ? " checked" : ""}> Review before send</label>
''',
    '',
    'remove review UI'
)

one(
    '''            settings.curatedBurnReviewBeforeUse = !!panel.querySelector("#curatedBurnReviewInput")?.checked;
''',
    '',
    'remove review save'
)

one('<label>Preferred engine</label>', '<label>Primary engine</label>', 'rename primary engine')
one(
    '''            <div style="font-size:12px;color:gray;margin-top:4px">Compromise and RiTa are loaded by Tampermonkey via @require. Markov uses a local word-chain generator so a CDN package change cannot kill the whole userscript.</div>''',
    '''            <div style="font-size:12px;color:gray;margin-top:4px">The Primary engine runs first. Other enabled engines are fallbacks only when the primary cannot produce a fresh burn; exact recent burns are skipped instead of repeated.</div>
            <div style="font-size:12px;color:gray;margin-top:4px">Compromise and RiTa are loaded by Tampermonkey via @require. Markov uses a local word-chain generator so a CDN package change cannot kill the whole userscript.</div>''',
    'explain engine priority'
)

one(
    '''    let lastBurnTimestamp = 0;

    let burnSendInFlight = false;''',
    '''    let lastBurnTimestamp = 0;
    const RECENT_BURN_LIMIT = 12;
    let recentBurnResponses = [];
    let lastBurnEngineUsed = "none";

    function burnResponseKey(text) {
        return String(text || "")
            .replace(/^@[A-Za-z0-9_.-]+\\s+/, "")
            .replace(/\\s+/g, " ")
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

    let burnSendInFlight = false;''',
    'recent burn memory'
)

start = text.index('    function generateBurnResponse(ctx) {')
end = text.index('\n    async function maybeHandleAutoBurn(ctx) {', start)
replacement = r'''    function generateBurnResponse(ctx) {
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
'''
text = text[:start] + replacement + text[end:]

one(
    '''        if (curatedSelection && settings.curatedBurnReviewBeforeUse) {
            const approved = confirm(`Curated burn for @${ctx.target || ctx.from}:\\n\\n${response}\\n\\nSend it?`);
            if (!approved) {
                pendingCuratedBurnSelection = null;
                setBurnRuntimeStatus({ lastAttempt: "review cancelled" });
                return;
            }
        }
''',
    '',
    'remove auto-burn review prompt'
)

one(
    '''        setBurnRuntimeStatus({ lastAttempt: `generated for @${ctx.target || ctx.from}` });''',
    '''        setBurnRuntimeStatus({ lastAttempt: `generated via ${lastBurnEngineUsed} for @${ctx.target || ctx.from}` });''',
    'show actual engine'
)

one(
    '''                lastBurnTimestamp = Date.now();
                if (curatedSelection) markCuratedBurnUsed(curatedSelection);''',
    '''                lastBurnTimestamp = Date.now();
                rememberRecentBurn(response);
                if (curatedSelection) markCuratedBurnUsed(curatedSelection);''',
    'remember successful burn'
)

SCRIPT.write_text(text)

readme = Path('README.md')
r = readme.read_text()
r = r.replace('**Dizygotic Rumble Chat Companion v1.9.2**', '**Dizygotic Rumble Chat Companion v1.9.3**', 1)
r = r.replace('**Rumble Chat Companion v1.9.2**', '**Rumble Chat Companion v1.9.3**', 1)
needle = 'v1.9.2 hardens the live Rumble send path with automatic self-handle learning, an explicit username fallback, composer/send diagnostics, delayed controlled-composer submission, and matching JSON/CSV MIME exports.'
if needle not in r:
    raise SystemExit('README v1.9.2 note not found')
r = r.replace(needle, needle + ' v1.9.3 removes the curated review popup from automatic replies, makes the selected Primary engine run first, reports the engine actually used, and skips a bounded set of recently sent burn lines before falling back.', 1)
readme.write_text(r)

ext = Path('browser-extension/README.md')
e = ext.read_text()
needle = 'v1.9.2 also hardens runtime composer discovery/submission, automatically learns the signed-in handle from an outgoing chat echo, exposes a manual handle fallback plus runtime diagnostics, and emits JSON/CSV downloads with matching MIME types.'
if needle not in e:
    raise SystemExit('extension README v1.9.2 note not found')
e = e.replace(needle, needle + ' v1.9.3 makes the selected burn engine genuinely primary, removes automatic confirmation prompts, and suppresses exact recently-used burn lines before fallback.', 1)
ext.write_text(e)
