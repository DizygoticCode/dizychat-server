import fs from "node:fs";

const userscriptPath = new URL("../tampermonkey/dizygotic-rumble-chat-tool.user.js", import.meta.url);
const versionTestPath = new URL("../tests/rumble-userscript-version-source.test.mjs", import.meta.url);

let source = fs.readFileSync(userscriptPath, "utf8");
let versionTest = fs.readFileSync(versionTestPath, "utf8");

if (
  /^\/\/ @version\s+1\.12\.3$/m.test(source) &&
  source.includes("function clampBurnMessageForRumble(message, target, maxLength = RUMBLE_CHAT_MESSAGE_LIMIT)") &&
  source.includes('function shouldUseBurnQuote(ctx, source = "curated")')
) {
  console.log("Burn output boundaries already patched.");
  process.exit(0);
}

function mustReplaceOnce(text, oldValue, newValue, label) {
  const first = text.indexOf(oldValue);
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (text.indexOf(oldValue, first + oldValue.length) >= 0) {
    throw new Error(`Patch anchor is not unique: ${label}`);
  }
  return text.slice(0, first) + newValue + text.slice(first + oldValue.length);
}

function mustReplaceFirst(text, oldValue, newValue, label) {
  const first = text.indexOf(oldValue);
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`);
  return text.slice(0, first) + newValue + text.slice(first + oldValue.length);
}

source = mustReplaceOnce(
  source,
  "// @version      1.12.2",
  "// @version      1.12.3",
  "userscript version"
);

source = mustReplaceOnce(
  source,
  '    function safeBurnQuote(text, maxLength = 72) {',
  '    const RUMBLE_CHAT_MESSAGE_LIMIT = 200;\n    const BURN_QUOTE_BUCKETS = 5;\n\n    function safeBurnQuote(text, maxLength = 72) {',
  "burn output constants"
);

source = mustReplaceOnce(
  source,
  '    function noteBurnPressure(username) {',
  `    function shouldUseBurnQuote(ctx, source = "curated") {
        const message = String(ctx?.message || "").replace(/\\s+/g, " ").trim().toLowerCase();
        const from = String(ctx?.from || ctx?.target || "").trim().toLowerCase();
        const tagCount = Math.max(1, Number(ctx?.tagCount) || 1);
        if (!message) return false;
        const bucket = parseInt(simpleCuratedHash(\`${'${source}:${from}:${tagCount}:${message}'}\`).slice(-2), 36);
        return Number.isFinite(bucket) && bucket % BURN_QUOTE_BUCKETS === 0;
    }

    function noteBurnPressure(username) {`,
  "quote gate helper"
);

source = mustReplaceOnce(
  source,
  `    function drillPrivateName(target) {
        const clean = String(target || "recruit").replace(/^@+/, "").replace(/[^A-Za-z0-9_.-]/g, "");
        if (/^joker747$/i.test(clean)) return "JOKER";
        const withoutDigits = clean.replace(/\\d+$/g, "");
        return (withoutDigits || clean || "RECRUIT").slice(0, 18).toUpperCase();
    }`,
  `    function drillPrivateName(target) {
        const clean = String(target || "recruit").replace(/^@+/, "").replace(/[^A-Za-z0-9_.-]/g, "");
        if (/^joker747$/i.test(clean)) return "JOKER";
        return (clean || "RECRUIT").toUpperCase();
    }`,
  "DRILL username preservation"
);

source = mustReplaceOnce(
  source,
  `    function cleanGeneratedBurn(text, target) {
        let candidate = String(text || "")
            .replace(/\\s+/g, " ")
            .replace(/\\s+([,.;!?])/g, "$1")
            .trim();
        if (!candidate) return null;
        if (!/^@[A-Za-z0-9_.-]+\\b/.test(candidate)) candidate = \`@${'${target}'} ${'${candidate}'}\`;
        if (candidate.length < 18 || candidate.length > 240) return null;
        if (isBlockedBurnSubject(candidate) || BURN_DIRECT_THREAT_PATTERN.test(candidate)) return null;
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
    }`,
  `    function cleanGeneratedBurn(text, target) {
        let candidate = String(text || "")
            .replace(/\\s+/g, " ")
            .replace(/\\s+([,.;!?])/g, "$1")
            .trim();
        if (!candidate) return null;
        if (!/^@[A-Za-z0-9_.-]+\\b/.test(candidate)) candidate = \`@${'${target}'} ${'${candidate}'}\`;
        if (candidate.length < 18) return null;
        if (isBlockedBurnSubject(candidate) || BURN_DIRECT_THREAT_PATTERN.test(candidate)) return null;
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
        return clampBurnMessageForRumble(candidate, target);
    }

    function clampBurnMessageForRumble(message, target, maxLength = RUMBLE_CHAT_MESSAGE_LIMIT) {
        const raw = String(message || "").replace(/\\s+/g, " ").trim();
        const leadingTarget = raw.match(/^@([A-Za-z0-9_.-]+)\\b/)?.[1] || "";
        const safeTarget = String(target || leadingTarget || "there")
            .replace(/^@+/, "")
            .replace(/[^A-Za-z0-9_.-]/g, "") || "there";
        const mention = \`@${'${safeTarget}'}\`;
        const body = raw.replace(/^@[A-Za-z0-9_.-]+\\b\\s*/, "").trim();
        const prefix = \`${'${mention}'} \`;
        const full = \`${'${prefix}'}${'${body}'}\`.trim();
        if (Array.from(full).length <= maxLength) return full;

        const availableBodyChars = Math.max(1, maxLength - Array.from(prefix).length - 1);
        const clipped = Array.from(body).slice(0, availableBodyChars).join("");
        const cut = clipped.lastIndexOf(" ");
        const bounded = (cut >= Math.floor(clipped.length * 0.6) ? clipped.slice(0, cut) : clipped).trim();
        return \`${'${prefix}'}${'${bounded}'}…\`.trim();
    }`,
  "generated burn clamp"
);

source = mustReplaceOnce(
  source,
  '        const quote = incomingBlocked ? "" : safeBurnQuote(ctx.message || "");',
  '        const quote = incomingBlocked || !shouldUseBurnQuote(ctx, "curated")\n            ? ""\n            : safeBurnQuote(ctx.message || "");',
  "Curated quote gate"
);

source = mustReplaceOnce(
  source,
  '        return String(chosen.template || "").replace(/\\{target\\}/g, target).slice(0, 240);',
  '        return String(chosen.template || "").replace(/\\{target\\}/g, target);',
  "Curated 240-character slice"
);

source = mustReplaceFirst(
  source,
  '                    const quote = safeBurnQuote(normalizedCtx.message);',
  '                    const quote = shouldUseBurnQuote(normalizedCtx, "compromise")\n                        ? safeBurnQuote(normalizedCtx.message)\n                        : "";',
  "Compromise quote gate"
);
source = mustReplaceFirst(
  source,
  '                    const quote = safeBurnQuote(normalizedCtx.message);',
  '                    const quote = shouldUseBurnQuote(normalizedCtx, "rita")\n                        ? safeBurnQuote(normalizedCtx.message)\n                        : "";',
  "RiTa quote gate"
);

source = mustReplaceOnce(
  source,
  `        const isBurn = !!meta.engine;
        if (isBurn && (isBlockedBurnSubject(message) || BURN_DIRECT_THREAT_PATTERN.test(String(message || "")))) {
            setBurnRuntimeStatus({ lastAttempt: "blocked: account-protection firewall", lastError: "blocked-burn-subject" });
            return false;
        }`,
  `        const isBurn = !!meta.engine;
        if (isBurn && (isBlockedBurnSubject(message) || BURN_DIRECT_THREAT_PATTERN.test(String(message || "")))) {
            setBurnRuntimeStatus({ lastAttempt: "blocked: account-protection firewall", lastError: "blocked-burn-subject" });
            return false;
        }
        const outboundMessage = isBurn
            ? clampBurnMessageForRumble(message, meta.target || "")
            : message;`,
  "final Burn Bot outbound clamp"
);

source = mustReplaceOnce(
  source,
  '            formatted = setOutgoingComposerValue(composer, message);',
  '            formatted = setOutgoingComposerValue(composer, outboundMessage);',
  "composer uses bounded Burn Bot output"
);
source = mustReplaceOnce(
  source,
  '        rememberPendingOutgoingIdentity(message, formatted);',
  '        rememberPendingOutgoingIdentity(outboundMessage, formatted);',
  "outgoing identity tracks bounded output"
);
source = mustReplaceOnce(
  source,
  '            if (submitted && isBurn) rememberPendingBurnEcho(message, formatted, meta);',
  '            if (submitted && isBurn) rememberPendingBurnEcho(outboundMessage, formatted, meta);',
  "Burn Bot echo tracks bounded output"
);

versionTest = mustReplaceOnce(
  versionTest,
  'test("Tampermonkey metadata advertises v1.12.2 with scalable Curated memory and selected-user Burn Bot controls", () => {',
  'test("Tampermonkey metadata advertises v1.12.3 with bounded, lower-quote Burn Bot output", () => {',
  "version test title"
);
versionTest = mustReplaceOnce(
  versionTest,
  'assert.match(source, /^\\/\\/ @version\\s+1\\.12\\.2$/m);',
  'assert.match(source, /^\\/\\/ @version\\s+1\\.12\\.3$/m);',
  "version test assertion"
);

fs.writeFileSync(userscriptPath, source);
fs.writeFileSync(versionTestPath, versionTest);
console.log("Applied Burn Bot quote/name/length boundary patch.");
