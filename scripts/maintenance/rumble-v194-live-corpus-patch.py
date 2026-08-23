from pathlib import Path

SCRIPT = Path('scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js')
text = SCRIPT.read_text()


def one(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, got {count}')
    text = text.replace(old, new, 1)


def replace_between(start_marker: str, end_marker: str, replacement: str, label: str) -> None:
    global text
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f'{label}: start marker missing')
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f'{label}: end marker missing')
    text = text[:start] + replacement + text[end:]


one('// @version      1.9.3', '// @version      1.9.4', 'version')
one('// v1.9.3 auto-burn is deliberately hands-off; retire any persisted review prompt.', '// v1.9.4 auto-burn is deliberately hands-off; retire any persisted review prompt.', 'version comment')

one(
    '''    const CURATED_STOP_WORDS = new Set([\n        "about","after","again","also","and","are","because","been","before","being","but","can","cant","could","did","does","doing","dont","for","from","get","got","had","has","have","here","how","into","its","just","like","more","not","now","off","one","only","our","out","really","said","say","says","some","than","that","the","their","them","then","there","they","this","those","too","was","were","what","when","where","which","who","why","will","with","would","you","your","youre"\n    ]);\n    const CURATED_SENSITIVE_PATTERN = /\\b(?:address|postcode|phone|email|diagnos(?:ed|is)|cancer|hiv|autis(?:m|tic)|disabled|disability|pregnan(?:t|cy)|religion|muslim|christian|jew(?:ish)?|hindu|sikh|gay|lesbian|bisexual|trans(?:gender)?|race|racial|ethnicity)\\b/i;''',
    '''    const CURATED_STOP_WORDS = new Set([\n        "about","after","again","also","and","are","because","been","before","being","but","can","cant","could","did","does","doing","dont","for","from","get","got","had","has","have","here","how","into","its","just","like","more","not","now","off","one","only","our","out","really","said","say","says","some","than","that","the","their","them","then","there","they","this","those","too","was","were","what","when","where","which","who","why","will","with","would","you","your","youre"\n    ]);\n    const CURATED_WEAK_TOPICS = new Set([\n        "good","great","thing","things","people","right","wrong","maybe","think","know","want","need","yeah","okay","looks","look","make","made","going","come","back","much","time","chat","work","working"\n    ]);\n    const CURATED_SENSITIVE_PATTERN = /\\b(?:address|postcode|phone|email|diagnos(?:ed|is)|cancer|hiv|autis(?:m|tic)|disabled|disability|pregnan(?:t|cy)|religion|muslims?|christians?|jews?|jewish|hindus?|sikhs?|gays?|lesbians?|bisexuals?|trans(?:gender)?|race|racial|ethnicity)\\b/gi;''',
    'curated filters'
)

one(
    '''    function curatedTokens(text) {\n        return [...new Set(curatedWords(text).filter((word) => word.length >= 4 && !CURATED_STOP_WORDS.has(word)))].slice(0, 14);\n    }''',
    '''    function curatedTokens(text) {\n        const useful = curatedWords(text).filter((word) => {\n            const normalized = word.replace(/'/g, "");\n            return word.length >= 4 &&\n                !CURATED_STOP_WORDS.has(word) &&\n                !CURATED_STOP_WORDS.has(normalized) &&\n                !CURATED_WEAK_TOPICS.has(word) &&\n                !CURATED_WEAK_TOPICS.has(normalized);\n        });\n        return [...new Set(useful)].slice(0, 14);\n    }''',
    'curated tokens'
)

one(
    '''        Object.entries(profile.phrases || {})\n            .filter(([, stat]) => statCount(stat) >= 3)''',
    '''        Object.entries(profile.phrases || {})\n            .filter(([phrase, stat]) => statCount(stat) >= 3 && curatedTokens(phrase).length >= 2)''',
    'phrase quality filter'
)
one(
    '''        Object.entries(profile.topics || {})\n            .filter(([, stat]) => statCount(stat) >= 4)''',
    '''        Object.entries(profile.topics || {})\n            .filter(([topic, stat]) => statCount(stat) >= 4 && !CURATED_WEAK_TOPICS.has(topic))''',
    'topic quality filter'
)

one(
    '''        const record = {\n            seq: ++chatSequence,\n            capturedAt: new Date().toISOString(),\n            username,\n            displayName,\n            message: clean,\n            mentions: extractMentions(clean),\n            rawHtml: el._originalMessage || el.querySelector("div.js-chat-message.chat-history--message")?.innerHTML || "",\n            rowClass: el.className || "",\n            url: location.href,\n            title: document.title\n        };\n        chatLog.push(record);''',
    '''        const record = {\n            seq: ++chatSequence,\n            capturedAt: new Date().toISOString(),\n            username,\n            displayName,\n            message: clean,\n            mentions: extractMentions(clean),\n            rawHtml: el._originalMessage || el.querySelector("div.js-chat-message.chat-history--message")?.innerHTML || "",\n            rowClass: el.className || "",\n            url: location.href,\n            title: document.title\n        };\n        const burnMeta = consumePendingBurnEcho(record);\n        if (burnMeta) Object.assign(record, burnMeta);\n        chatLog.push(record);''',
    'recorder burn metadata'
)

one(
    '''            const header = ["seq","capturedAt","username","displayName","message","mentions","rawHtml","rowClass","url","title"];\n            const rows = chatLog.map((r) => [r.seq,r.capturedAt,r.username,r.displayName,r.message,(r.mentions||[]).join(" "),r.rawHtml||"",r.rowClass||"",r.url,r.title].map(csvEscape).join(","));''',
    '''            const header = ["seq","capturedAt","username","displayName","message","mentions","rawHtml","rowClass","url","title","botGenerated","botEngine","botTarget","botFontStyle"];\n            const rows = chatLog.map((r) => [r.seq,r.capturedAt,r.username,r.displayName,r.message,(r.mentions||[]).join(" "),r.rawHtml||"",r.rowClass||"",r.url,r.title,r.botGenerated?"true":"",r.botEngine||"",r.botTarget||"",r.botFontStyle||""].map(csvEscape).join(","));''',
    'csv bot metadata'
)

replace_between(
    '    function simpleMarkovGenerate(lines) {',
    '\n    /***********************\n     * Auto-burn bot helpers',
    r'''    function simpleMarkovGenerate(lines) {
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
''',
    'markov order two'
)

one(
    '''    const builtInBurns = [\n        ({ target }) => `@${target} you just pinged the wrong dojo.`,\n        ({ target }) => `@${target} that's a bold take for someone typing with mittens.`,\n        ({ target }) => `@${target} you rang? I brought receipts and a thesaurus.`,\n        ({ target }) => `@${target} touch grass, clear cache, try again.`,\n        ({ target }) => `@${target} noted. Filing under 'draft tweets'.`\n    ];''',
    '''    const builtInBurns = [\n        ({ target }) => `@${target} you just pinged the wrong dojo.`,\n        ({ target }) => `@${target} that's a bold take for someone typing with mittens.`,\n        ({ target }) => `@${target} you rang? I brought receipts and a thesaurus.`,\n        ({ target }) => `@${target} touch grass, clear cache, try again.`,\n        ({ target }) => `@${target} noted. Filing under 'draft tweets'.`,\n        ({ target }) => `@${target} your confidence has excellent uptime; shame the argument doesn't.`,\n        ({ target }) => `@${target} I've seen stronger logic in a 404 page.`,\n        ({ target }) => `@${target} that comeback needs a rollback and an apology to punctuation.`,\n        ({ target }) => `@${target} your point filed for bankruptcy halfway through the sentence.`,\n        ({ target }) => `@${target} even your typo is trying to distance itself from that take.`\n    ];''',
    'built in expansion'
)

one(
    '''    let burnSendInFlight = false;\n    let pendingOutgoingIdentity = null;''',
    '''    let burnSendInFlight = false;\n    let pendingOutgoingIdentity = null;\n    let pendingBurnEcho = null;\n    let lastTrustedComposerInputAt = 0;\n    let botComposerMutationGuard = false;\n    const BURN_COMPOSER_IDLE_MS = 650;\n    const BURN_COMPOSER_WAIT_MS = 12000;''',
    'burn runtime state'
)

one(
    '''    function rememberPendingOutgoingIdentity(raw, formatted) {\n        const original = normalizeOutgoingEcho(raw);\n        const sent = normalizeOutgoingEcho(formatted);\n        if (!original && !sent) return;\n        pendingOutgoingIdentity = { raw: original, formatted: sent, expiresAt: Date.now() + 20000 };\n    }''',
    '''    function rememberPendingOutgoingIdentity(raw, formatted) {\n        const original = normalizeOutgoingEcho(raw);\n        const sent = normalizeOutgoingEcho(formatted);\n        if (!original && !sent) return;\n        pendingOutgoingIdentity = { raw: original, formatted: sent, expiresAt: Date.now() + 20000 };\n    }\n\n    function rememberPendingBurnEcho(raw, formatted, meta = {}) {\n        if (!meta.engine) return;\n        const selfUsername = sanitizeNickname(settings.myNickname || burnRuntimeStatus.nickname || detectMyNickname()).toLowerCase();\n        pendingBurnEcho = {\n            raw: normalizeOutgoingEcho(raw),\n            formatted: normalizeOutgoingEcho(formatted),\n            engine: String(meta.engine || ""),\n            target: String(meta.target || ""),\n            fontStyle: settings.outgoingFontStyle || "default",\n            selfUsername,\n            expiresAt: Date.now() + 20000\n        };\n    }\n\n    function consumePendingBurnEcho(record) {\n        if (!pendingBurnEcho || !record?.username) return null;\n        if (Date.now() > pendingBurnEcho.expiresAt) {\n            pendingBurnEcho = null;\n            return null;\n        }\n        if (pendingBurnEcho.selfUsername && String(record.username).toLowerCase() !== pendingBurnEcho.selfUsername) return null;\n        const observed = normalizeOutgoingEcho(record.message);\n        if (!observed || (observed !== pendingBurnEcho.raw && observed !== pendingBurnEcho.formatted)) return null;\n        const meta = {\n            botGenerated: true,\n            botEngine: pendingBurnEcho.engine,\n            botTarget: pendingBurnEcho.target,\n            botFontStyle: pendingBurnEcho.fontStyle\n        };\n        pendingBurnEcho = null;\n        return meta;\n    }''',
    'burn echo metadata helpers'
)

one(
    '''    function sleep(ms) {\n        return new Promise((resolve) => setTimeout(resolve, ms));\n    }''',
    '''    function sleep(ms) {\n        return new Promise((resolve) => setTimeout(resolve, ms));\n    }\n\n    async function waitForBurnComposerIdle(initialComposer) {\n        let composer = initialComposer;\n        const deadline = Date.now() + BURN_COMPOSER_WAIT_MS;\n        while (Date.now() < deadline) {\n            if (!composer?.isConnected) composer = findChatComposer();\n            if (composer) {\n                const hasDraft = !!getComposerPlainText(composer).trim();\n                const recentlyTyped = Date.now() - lastTrustedComposerInputAt < BURN_COMPOSER_IDLE_MS;\n                if (!hasDraft && !recentlyTyped) return composer;\n                setBurnRuntimeStatus({ composerFound: true, lastAttempt: "queued: waiting for your draft", lastError: "" });\n            }\n            await sleep(120);\n        }\n        setBurnRuntimeStatus({ lastAttempt: "skipped: composer stayed busy", lastError: "composer-busy" });\n        return null;\n    }\n\n    function cancelBotComposerCollision(composer, expectedText) {\n        if (expectedText == null) return false;\n        const current = getComposerPlainText(composer);\n        if (current === expectedText) return false;\n        if (current.startsWith(expectedText)) {\n            const userTail = current.slice(expectedText.length);\n            botComposerMutationGuard = true;\n            try { setComposerValue(composer, userTail); } finally { botComposerMutationGuard = false; }\n        }\n        setBurnRuntimeStatus({ lastAttempt: "cancelled: you started typing", lastError: "composer-changed" });\n        return true;\n    }''',
    'composer idle helpers'
)

one(
    '''    async function submitComposer(composer) {\n        if (!composer) return false;\n        for (let attempt = 0; attempt < 8; attempt += 1) {\n            await sleep(attempt === 0 ? 80 : 60);\n            const button = findSendButton(composer);\n            if (button && !button.disabled && button.getAttribute("aria-disabled") !== "true") {\n                button.click();\n                return true;\n            }\n        }\n        const form = composer.closest?.("form");\n        if (form && typeof form.requestSubmit === "function") {\n            try {\n                form.requestSubmit();\n                return true;\n            } catch (err) {\n                console.warn("Rumble form requestSubmit failed", err);\n            }\n        }\n        for (const type of ["keydown", "keypress", "keyup"]) {\n            composer.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));\n        }\n        return true;\n    }''',
    '''    async function submitComposer(composer, expectedText = null) {\n        if (!composer) return false;\n        for (let attempt = 0; attempt < 8; attempt += 1) {\n            await sleep(attempt === 0 ? 80 : 60);\n            if (cancelBotComposerCollision(composer, expectedText)) return false;\n            const button = findSendButton(composer);\n            if (button && !button.disabled && button.getAttribute("aria-disabled") !== "true") {\n                button.click();\n                return true;\n            }\n        }\n        if (cancelBotComposerCollision(composer, expectedText)) return false;\n        const form = composer.closest?.("form");\n        if (form && typeof form.requestSubmit === "function") {\n            try {\n                form.requestSubmit();\n                return true;\n            } catch (err) {\n                console.warn("Rumble form requestSubmit failed", err);\n            }\n        }\n        if (cancelBotComposerCollision(composer, expectedText)) return false;\n        for (const type of ["keydown", "keypress", "keyup"]) {\n            composer.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));\n        }\n        return true;\n    }''',
    'collision aware submit'
)

one(
    '''        if (!composer._dizyOutgoingFormattingBound) {\n            composer._dizyOutgoingFormattingBound = true;\n            composer.addEventListener("keydown", (event) => {''',
    '''        if (!composer._dizyOutgoingFormattingBound) {\n            composer._dizyOutgoingFormattingBound = true;\n            composer.addEventListener("input", (event) => {\n                if (event.isTrusted && !botComposerMutationGuard) lastTrustedComposerInputAt = Date.now();\n            }, true);\n            composer.addEventListener("keydown", (event) => {''',
    'track trusted input'
)

replace_between(
    '    async function sendChatMessage(message) {',
    '\n    function generateBurnResponse(ctx) {',
    r'''    async function sendChatMessage(message, meta = {}) {
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
''',
    'draft safe sendChatMessage'
)

one(
    '''            const sent = await sendChatMessage(response);''',
    '''            const sent = await sendChatMessage(response, { engine: lastBurnEngineUsed, target: ctx.target || ctx.from || "" });''',
    'burn send metadata'
)

one(
    '''            <div style="font-size:12px;color:gray;margin-top:4px">The Primary engine runs first. Other enabled engines are fallbacks only when the primary cannot produce a fresh burn; exact recent burns are skipped instead of repeated.</div>''',
    '''            <div style="font-size:12px;color:gray;margin-top:4px">The Primary engine runs first. Other enabled engines are fallbacks only when the primary cannot produce a fresh burn; exact recent burns are skipped instead of repeated. Burn replies wait for an empty idle composer rather than trampling a message you are typing.</div>\n            <div style="font-size:12px;color:gray;margin-top:4px">Successful Burn Bot echoes are labelled with engine, target and font style in new transcript exports so future live tests can be analysed directly.</div>''',
    'burn ui note'
)

SCRIPT.write_text(text)
print('v1.9.4 live-corpus patch applied')
