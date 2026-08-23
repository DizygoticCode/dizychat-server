from pathlib import Path

SCRIPT = Path('scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js')
text = SCRIPT.read_text()


def one(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, got {count}')
    text = text.replace(old, new, 1)


def between(start: str, end: str, replacement: str, label: str) -> None:
    global text
    a = text.find(start)
    if a < 0:
        raise SystemExit(f'{label}: start marker missing')
    if text.find(start, a + 1) >= 0:
        raise SystemExit(f'{label}: start marker not unique')
    b = text.find(end, a + len(start))
    if b < 0:
        raise SystemExit(f'{label}: end marker missing')
    text = text[:a] + replacement + text[b:]


one('// @version      1.9.1', '// @version      1.9.2', 'version')

one(
    '        chatLog.push(record);\n        if (chatLog.length > CHAT_LOG_LIMIT) chatLog.splice(0, chatLog.length - CHAT_LOG_LIMIT);\n        ingestCuratedRecord(record);',
    '        chatLog.push(record);\n        if (chatLog.length > CHAT_LOG_LIMIT) chatLog.splice(0, chatLog.length - CHAT_LOG_LIMIT);\n        maybeLearnSelfNickname(record);\n        ingestCuratedRecord(record);',
    'outgoing self echo learning',
)

one(
    '            triggerDownload(`dizygotic-rumble-chat-${stamp}.csv`, [header.join(","), ...rows].join("\\n"), { prompt: true });',
    '            triggerDownload(`dizygotic-rumble-chat-${stamp}.csv`, [header.join(","), ...rows].join("\\n"), { prompt: true, mimeType: "text/csv;charset=utf-8" });',
    'csv export mime',
)
one(
    '        triggerDownload(`dizygotic-rumble-chat-${stamp}.json`, JSON.stringify(chatLog, null, 2), { prompt: true });',
    '        triggerDownload(`dizygotic-rumble-chat-${stamp}.json`, JSON.stringify(chatLog, null, 2), { prompt: true, mimeType: "application/json;charset=utf-8" });',
    'json export mime',
)
one(
    '        const blob = new Blob([serialized], { type: "application/json" });',
    '        const blob = new Blob([serialized], { type: options.mimeType || "application/json;charset=utf-8" });',
    'download mime plumbing',
)

one(
    '    const CURATED_PERSONAL_DATA_PATTERN = /(?:https?:\\/\\/|www\\.|[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}|\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b|(?:\\+?\\d[\\d ()-]{7,}\\d))/i;',
    '    const CURATED_PERSONAL_DATA_PATTERN = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}|\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b|(?:\\+?\\d[\\d ()-]{7,}\\d))/i;',
    'personal data filter',
)

between(
    '    function normalizeCuratedText(text) {',
    '    function curatedWords(text) {',
    '''    function normalizeCuratedText(text) {
        return String(text || "")
            .replace(/https?:\\/\\/\\S+/gi, " ")
            .replace(/www\\.\\S+/gi, " ")
            .replace(/@[A-Za-z0-9_.-]+/g, " ")
            .replace(CURATED_SENSITIVE_PATTERN, " ")
            .replace(/\\s+/g, " ")
            .trim()
            .slice(0, 220);
    }

    function isCuratableMessage(text) {
        const raw = String(text || "");
        if (CURATED_PERSONAL_DATA_PATTERN.test(raw)) return false;
        const value = normalizeCuratedText(raw);
        return value.length >= 8 && value.length <= 220;
    }

''',
    'curated sanitization',
)

one(
    '                template: `@{target} you have already shipped “${stat.sample}” ${statCount(stat)} times. Even copy-paste wants royalties.`',
    '                template: `@{target} same paste again — the archive has clocked this template ${statCount(stat)} times. Even copy-paste wants royalties.`',
    'safe repeat burn template',
)

one(
    '''            <b>Auto-burn bot</b>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px">''',
    '''            <b>Auto-burn bot</b>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px">
                <label>My Rumble username</label>
                <input id="myNicknameInput" value="${String(settings.myNickname || "").replace(/"/g, "&quot;")}" placeholder="auto-detected after you send" style="width:170px">
                <span id="autoBurnRuntimeStatus" style="font-size:12px;color:gray">${burnRuntimeStatusText()}</span>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px">''',
    'auto burn own-handle UI',
)

one(
    '            settings.chatRecorderEnabled = !!panel.querySelector("#chatRecorderEnabledInput")?.checked;\n            settings.outgoingFontStyle = panel.querySelector("#outgoingFontStyleInput")?.value || "default";',
    '            settings.chatRecorderEnabled = !!panel.querySelector("#chatRecorderEnabledInput")?.checked;\n            settings.myNickname = sanitizeNickname(panel.querySelector("#myNicknameInput")?.value || settings.myNickname) || "";\n            settings.outgoingFontStyle = panel.querySelector("#outgoingFontStyleInput")?.value || "default";',
    'persist own handle',
)

composer_runtime = '''    let burnSendInFlight = false;
    let pendingOutgoingIdentity = null;
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
        return String(text || "").replace(/\\s+/g, " ").trim();
    }

    function rememberPendingOutgoingIdentity(raw, formatted) {
        const original = normalizeOutgoingEcho(raw);
        const sent = normalizeOutgoingEcho(formatted);
        if (!original && !sent) return;
        pendingOutgoingIdentity = { raw: original, formatted: sent, expiresAt: Date.now() + 20000 };
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
                if (/\\s/.test(char)) {
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

    async function submitComposer(composer) {
        if (!composer) return false;
        for (let attempt = 0; attempt < 8; attempt += 1) {
            await sleep(attempt === 0 ? 80 : 60);
            const button = findSendButton(composer);
            if (button && !button.disabled && button.getAttribute("aria-disabled") !== "true") {
                button.click();
                return true;
            }
        }
        const form = composer.closest?.("form");
        if (form && typeof form.requestSubmit === "function") {
            try {
                form.requestSubmit();
                return true;
            } catch (err) {
                console.warn("Rumble form requestSubmit failed", err);
            }
        }
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

    async function sendChatMessage(message) {
        const composer = findChatComposer();
        if (!composer) {
            setBurnRuntimeStatus({ composerFound: false, lastAttempt: "failed: composer not found", lastError: "composer-not-found" });
            return false;
        }
        const formatted = setOutgoingComposerValue(composer, message);
        rememberPendingOutgoingIdentity(message, formatted);
        setBurnRuntimeStatus({ composerFound: true, lastAttempt: "composer filled", lastError: "" });
        outgoingSubmitGuard = true;
        try {
            const submitted = await submitComposer(composer);
            setBurnRuntimeStatus({ lastAttempt: submitted ? "send dispatched" : "failed: no send path", lastError: submitted ? "" : "send-path-not-found" });
            return submitted;
        } finally {
            outgoingSubmitGuard = false;
        }
    }

'''

between(
    '    function findChatComposer() {',
    '    function generateBurnResponse(ctx) {',
    composer_runtime,
    'composer and send runtime',
)

auto_burn = '''    async function maybeHandleAutoBurn(ctx) {
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
        if (curatedSelection && settings.curatedBurnReviewBeforeUse) {
            const approved = confirm(`Curated burn for @${ctx.target || ctx.from}:\\n\\n${response}\\n\\nSend it?`);
            if (!approved) {
                pendingCuratedBurnSelection = null;
                setBurnRuntimeStatus({ lastAttempt: "review cancelled" });
                return;
            }
        }
        burnSendInFlight = true;
        setBurnRuntimeStatus({ lastAttempt: `generated for @${ctx.target || ctx.from}` });
        try {
            const sent = await sendChatMessage(response);
            if (sent) {
                lastBurnTimestamp = Date.now();
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

'''

between(
    '    function maybeHandleAutoBurn(ctx) {',
    '    /***********************\n     * Core message refresh',
    auto_burn,
    'auto burn async send',
)

one(
    '''                    if (mentionRegex.test(lowerText)) {
                        maybeHandleAutoBurn({ target: displayName.replace(/^@+/, ""), message: plainOriginal, from: username });
                        el._autoBurnHandled = true;
                    }''',
    '''                    if (mentionRegex.test(lowerText)) {
                        el._autoBurnHandled = true;
                        setBurnRuntimeStatus({ nickname: selfHandle, lastAttempt: `tag detected from @${displayName.replace(/^@+/, "")}` });
                        void maybeHandleAutoBurn({ target: displayName.replace(/^@+/, ""), message: plainOriginal, from: username });
                    }''',
    'tag trigger ordering',
)

nickname_runtime = '''    function detectMyNickname() {
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

'''

between(
    '    function detectMyNickname() {',
    '    function openDirectMessage(targetDisplayName) {',
    nickname_runtime,
    'nickname detection',
)

one(
    '    window.rumbleBlocker.formatOutgoing = (text) => formatOutgoingText(text);',
    '    window.rumbleBlocker.formatOutgoing = (text) => formatOutgoingText(text);\n    window.rumbleBlocker.getBurnRuntimeStatus = () => ({ ...burnRuntimeStatus, nickname: detectMyNickname(), composerFound: !!findChatComposer() });\n    window.rumbleBlocker.sendChatMessage = (message) => sendChatMessage(String(message || ""));',
    'diagnostic api',
)

SCRIPT.write_text(text)

root = Path('README.md')
docs = root.read_text()
if '**Dizygotic Rumble Chat Companion v1.9.1**' not in docs or '**Rumble Chat Companion v1.9.1**' not in docs:
    raise SystemExit('root README version anchors missing')
docs = docs.replace('**Dizygotic Rumble Chat Companion v1.9.1**', '**Dizygotic Rumble Chat Companion v1.9.2**', 1)
docs = docs.replace('**Rumble Chat Companion v1.9.1**', '**Rumble Chat Companion v1.9.2**', 1)
anchor = 'v1.9 adds automatic local curated-burn memory:'
if anchor not in docs:
    raise SystemExit('root README curated anchor missing')
docs = docs.replace(
    anchor,
    'v1.9.2 hardens the live Rumble send path with automatic self-handle learning, an explicit username fallback, composer/send diagnostics, delayed controlled-composer submission, and matching JSON/CSV MIME exports. v1.9 adds automatic local curated-burn memory:',
    1,
)
root.write_text(docs)

ext = Path('browser-extension/README.md')
ext_docs = ext.read_text()
anchor = 'The extension preserves the blocker/highlighter, keyword filters, compact mode, timestamps, notifications, autoscroll lock, long-message handling, DizyChat DM handoff, transcript recorder/export, automatic local curated-burn memory, outgoing Unicode font styles and outgoing single/rainbow/multi-colour rich-composer formatting, portable settings, draggable settings UI, and selectable burn engines.'
if anchor not in ext_docs:
    raise SystemExit('extension README anchor missing')
ext_docs = ext_docs.replace(
    anchor,
    anchor + ' v1.9.2 also hardens runtime composer discovery/submission, automatically learns the signed-in handle from an outgoing chat echo, exposes a manual handle fallback plus runtime diagnostics, and emits JSON/CSV downloads with matching MIME types.',
    1,
)
ext.write_text(ext_docs)
