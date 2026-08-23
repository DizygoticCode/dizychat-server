from pathlib import Path

path = Path("scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js")
text = path.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    text = text.replace(old, new, 1)


replace_once("// @version      1.9.5", "// @version      1.9.6", "version")
replace_once(
    "// v1.9.5 keeps auto-burn hands-off and hardens live burn quality; retire any persisted review prompt.",
    "// v1.9.6 adds a configurable pre-send reply delay while keeping auto-burn hands-off; retire any persisted review prompt.",
    "version comment",
)

replace_once(
    '        autoBurnEnabled: false,\n        autoBurnCooldownSeconds: 45,\n        autoBurnEngine: "builtin",',
    '        autoBurnEnabled: false,\n        autoBurnCooldownSeconds: 45,\n        autoBurnReplyDelaySeconds: 5,\n        autoBurnEngine: "builtin",',
    "default reply delay",
)

replace_once(
'''                <label>Cooldown</label>
                <input type="number" id="autoBurnCooldownInput" min="5" value="${settings.autoBurnCooldownSeconds}" style="width:70px">
                <label>Primary engine</label>''',
'''                <label>Cooldown</label>
                <input type="number" id="autoBurnCooldownInput" min="5" value="${settings.autoBurnCooldownSeconds}" style="width:70px">
                <label>Reply delay (sec)</label>
                <input type="number" id="autoBurnReplyDelayInput" min="0" max="120" step="1" value="${settings.autoBurnReplyDelaySeconds}" style="width:70px">
                <label>Primary engine</label>''',
    "panel delay control",
)

replace_once(
    '            <div style="font-size:12px;color:gray;margin-top:4px">The Primary engine runs first. Curated now favours live quote-backs, exact-repeat evidence and repeated-tag escalation; savage built-ins are the first fallback. Weak or malformed generated mashups are discarded instead of sent. Burn replies still wait for an empty idle composer rather than trampling a message you are typing.</div>',
    '            <div style="font-size:12px;color:gray;margin-top:4px">Reply delay controls how long Burn Bot waits after generating a reply before it sends (5 seconds by default); Cooldown remains the minimum gap after a successful send. The Primary engine runs first. Curated favours live quote-backs, exact-repeat evidence and repeated-tag escalation; savage built-ins are the first fallback. Weak or malformed generated mashups are discarded instead of sent. Burn replies still wait for an empty idle composer rather than trampling a message you are typing.</div>',
    "panel help text",
)

replace_once(
'''            settings.autoBurnEnabled = !!panel.querySelector("#autoBurnToggle")?.checked;
            settings.autoBurnCooldownSeconds = Math.max(5, parseInt(panel.querySelector("#autoBurnCooldownInput")?.value, 10) || 45);
            settings.autoBurnEngine = panel.querySelector("#autoBurnEngineSelect")?.value || "builtin";''',
'''            settings.autoBurnEnabled = !!panel.querySelector("#autoBurnToggle")?.checked;
            settings.autoBurnCooldownSeconds = Math.max(5, parseInt(panel.querySelector("#autoBurnCooldownInput")?.value, 10) || 45);
            const replyDelaySeconds = parseInt(panel.querySelector("#autoBurnReplyDelayInput")?.value, 10);
            settings.autoBurnReplyDelaySeconds = Number.isFinite(replyDelaySeconds)
                ? Math.max(0, Math.min(120, replyDelaySeconds))
                : 5;
            settings.autoBurnEngine = panel.querySelector("#autoBurnEngineSelect")?.value || "builtin";''',
    "persist reply delay",
)

old_function = '''    async function maybeHandleAutoBurn(ctx) {
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
        setBurnRuntimeStatus({ lastAttempt: `generated via ${lastBurnEngineUsed} for @${ctx.target || ctx.from} · tag #${tagCount}` });
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
    }'''

new_function = '''    async function maybeHandleAutoBurn(ctx) {
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
    }'''
replace_once(old_function, new_function, "auto-burn delayed send")

required = [
    "// @version      1.9.6",
    "autoBurnReplyDelaySeconds: 5",
    'id="autoBurnReplyDelayInput" min="0" max="120"',
    "await new Promise((resolve) => setTimeout(resolve, replyDelayMs));",
    "cancelled: auto-burn disabled during reply delay",
]
for needle in required:
    if needle not in text:
        raise SystemExit(f"missing required v1.9.6 content: {needle}")

path.write_text(text, encoding="utf-8")
