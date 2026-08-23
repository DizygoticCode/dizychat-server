from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js"
README = ROOT / "README.md"
EXT_README = ROOT / "browser-extension/README.md"

s = SCRIPT.read_text(encoding="utf-8")
if "// @version      1.9\n" not in s:
    raise SystemExit("expected canonical v1.9 source")
if "outgoingFontStyle" in s:
    raise SystemExit("outgoing formatter already present")

s = s.replace("// @version      1.9\n", "// @version      1.9.1\n", 1)
s = s.replace(
    "automated curated burn memory + font controls + auto-burn",
    "automated curated burn memory + outgoing message styling + auto-burn",
    1,
)

s = s.replace(
    '''        chatRecorderEnabled: true,\n        chatFontFamily: "",\n        chatFontSize: 0,\n        chatTextMode: "default",''',
    '''        chatRecorderEnabled: true,\n        outgoingFontStyle: "default",\n        chatTextMode: "default",''',
    1,
)

old_ui_re = re.compile(
    r'''            <b>Chat font & colour</b>.*?            <div style="height:12px"></div>\n\n            <b>Passive chat recorder</b>''',
    re.S,
)
new_ui = '''            <b>Outgoing message style</b>
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

            <b>Passive chat recorder</b>'''
s, count = old_ui_re.subn(new_ui, s, count=1)
if count != 1:
    raise SystemExit(f"chat appearance UI replacement count={count}")

# Remove the obsolete Local Font Access handler entirely.
font_loader_re = re.compile(
    r'''        const loadInstalledFontsBtn = panel\.querySelector\("#loadInstalledFontsBtn"\);.*?        panel\.querySelector\("#keywordActionHide"\)\.checked = settings\.keywordAction === "hide";''',
    re.S,
)
s, count = font_loader_re.subn(
    '        panel.querySelector("#keywordActionHide").checked = settings.keywordAction === "hide";',
    s,
    count=1,
)
if count != 1:
    raise SystemExit(f"font loader removal count={count}")

s = s.replace(
    '''            settings.chatRecorderEnabled = !!panel.querySelector("#chatRecorderEnabledInput")?.checked;\n            settings.chatFontFamily = panel.querySelector("#chatFontFamilyInput")?.value?.trim() || "";\n            settings.chatFontSize = Math.max(0, Math.min(72, parseInt(panel.querySelector("#chatFontSizeInput")?.value, 10) || 0));\n            settings.chatTextMode = panel.querySelector("#chatTextModeInput")?.value || "default";''',
    '''            settings.chatRecorderEnabled = !!panel.querySelector("#chatRecorderEnabledInput")?.checked;\n            settings.outgoingFontStyle = panel.querySelector("#outgoingFontStyleInput")?.value || "default";\n            settings.chatTextMode = panel.querySelector("#chatTextModeInput")?.value || "default";''',
    1,
)

# Replace incoming-message colourization helpers with outgoing plain-text font transforms.
helper_re = re.compile(
    r'''    function parseColourPalette\(value\) \{.*?    function simpleMarkovGenerate\(lines\) \{''',
    re.S,
)
new_helpers = r'''    function parseColourPalette(value) {
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

    function simpleMarkovGenerate(lines) {'''
s, count = helper_re.subn(new_helpers, s, count=1)
if count != 1:
    raise SystemExit(f"outgoing helper replacement count={count}")

# Insert rich-composer colouring and manual-send interception immediately after setComposerValue.
set_value_marker = '''    function sendChatMessage(message) {\n        const composer = findChatComposer();\n        if (!composer) return false;\n        setComposerValue(composer, message);'''
if set_value_marker not in s:
    raise SystemExit("sendChatMessage marker not found")

outgoing_pipeline = r'''    function getComposerPlainText(composer) {
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
        composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: formatted }));
        composer.dispatchEvent(new Event("change", { bubbles: true }));
        return formatted;
    }

    function prepareCurrentComposerForSend(composer) {
        const raw = getComposerPlainText(composer);
        if (!raw.trim()) return;
        setOutgoingComposerValue(composer, raw);
    }

    function installOutgoingComposerFormatting() {
        const composer = findChatComposer();
        if (!composer) return;
        if (!composer._dizyOutgoingFormattingBound) {
            composer._dizyOutgoingFormattingBound = true;
            composer.addEventListener("keydown", (event) => {
                if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
                prepareCurrentComposerForSend(composer);
            }, true);
            const form = composer.closest("form");
            if (form && !form._dizyOutgoingFormattingBound) {
                form._dizyOutgoingFormattingBound = true;
                form.addEventListener("submit", () => prepareCurrentComposerForSend(composer), true);
            }
        }
        const sendButton = findSendButton();
        if (sendButton && !sendButton._dizyOutgoingFormattingBound) {
            sendButton._dizyOutgoingFormattingBound = true;
            sendButton.addEventListener("pointerdown", () => prepareCurrentComposerForSend(composer), true);
            sendButton.addEventListener("mousedown", () => prepareCurrentComposerForSend(composer), true);
        }
    }

    function sendChatMessage(message) {
        const composer = findChatComposer();
        if (!composer) return false;
        setOutgoingComposerValue(composer, message);'''
s = s.replace(set_value_marker, outgoing_pipeline, 1)

# Remove the local incoming-message font repaint block.
local_font_re = re.compile(
    r'''                const chosenFont = settings\.chatFontFamily \|\| "";.*?\n\n                if \(settings\.showTimestamps && usernameEl\) \{''',
    re.S,
)
s, count = local_font_re.subn(
    '                if (settings.showTimestamps && usernameEl) {',
    s,
    count=1,
)
if count != 1:
    raise SystemExit(f"local font repaint removal count={count}")

s = s.replace('                applyConfiguredChatTextStyle(msgEl, isBlocked, !!el._collapsed);\n\n', '', 1)

# Keep the manual send hook alive even when Rumble replaces its composer DOM.
s = s.replace(
    '''        ensureFloatingSettingsButton();\n        window.addEventListener("beforeunload", saveChatLog, { once: true });''',
    '''        ensureFloatingSettingsButton();\n        installOutgoingComposerFormatting();\n        setInterval(installOutgoingComposerFormatting, 800);\n        window.addEventListener("beforeunload", saveChatLog, { once: true });''',
    1,
)

s = s.replace(
    '''    window.rumbleBlocker.clearCuratedBurns = () => clearCuratedBurns();\n    window.rumbleBlocker.getBurnEngines = () => ({''',
    '''    window.rumbleBlocker.clearCuratedBurns = () => clearCuratedBurns();\n    window.rumbleBlocker.formatOutgoing = (text) => formatOutgoingText(text);\n    window.rumbleBlocker.getBurnEngines = () => ({''',
    1,
)

# Contract checks before writing.
required = [
    "// @version      1.9.1",
    'outgoingFontStyle: "default"',
    "function formatOutgoingText(text)",
    "function setOutgoingComposerValue(composer, value)",
    "function installOutgoingComposerFormatting()",
    "setOutgoingComposerValue(composer, message);",
    "window.rumbleBlocker.formatOutgoing",
]
for marker in required:
    if marker not in s:
        raise SystemExit(f"missing marker: {marker}")
for forbidden in ["applyConfiguredChatTextStyle", "queryLocalFonts", "el.style.fontFamily = chosenFont", "chatFontFamilyInput", "chatFontSizeInput"]:
    if forbidden in s:
        raise SystemExit(f"obsolete incoming-style marker survived: {forbidden}")

SCRIPT.write_text(s, encoding="utf-8")

readme = README.read_text(encoding="utf-8")
readme = readme.replace("Dizygotic Rumble Chat Companion v1.9", "Dizygotic Rumble Chat Companion v1.9.1")
readme = readme.replace("**Rumble Chat Companion v1.9**", "**Rumble Chat Companion v1.9.1**")
readme = readme.replace(
    "configurable installed fonts/font sizes/text colours, per-character rainbow and multi-colour display modes",
    "outgoing Unicode font styles plus outgoing single/rainbow/multi-colour rich-composer modes; incoming public chat is no longer repainted by these controls",
)
README.write_text(readme, encoding="utf-8")

ext = EXT_README.read_text(encoding="utf-8")
ext = ext.replace(
    "font and colour controls, rainbow/multi-colour local rendering",
    "outgoing Unicode font styles and outgoing single/rainbow/multi-colour rich-composer formatting",
)
ext = ext.replace(
    "Transcript export is user-triggered; DizyChat is opened only when the user explicitly chooses the DM handoff.",
    "Transcript export is user-triggered; DizyChat is opened only when the user explicitly chooses the DM handoff. Outgoing Unicode font transforms are plain-text compatible; colour spans are used only when Rumble exposes a contenteditable/rich composer, because a plain textarea cannot transport CSS colour.",
)
EXT_README.write_text(ext, encoding="utf-8")

print(f"patched {SCRIPT.relative_to(ROOT)} -> v1.9.1")
