import fs from "node:fs";

const path = new URL("./tampermonkey/dizygotic-rumble-chat-tool.user.js", import.meta.url);
let source = fs.readFileSync(path, "utf8");

function replaceOnce(before, after, label) {
  const first = source.indexOf(before);
  const second = first >= 0 ? source.indexOf(before, first + before.length) : -1;
  if (first < 0) throw new Error(`Missing patch seam: ${label}`);
  if (second >= 0) throw new Error(`Ambiguous patch seam: ${label}`);
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceOnce(
  "// @version      1.12.0",
  "// @version      1.12.1",
  "userscript version"
);

replaceOnce(
  '        autoBurnEnabled: false,\n        autoBurnCooldownSeconds: 45,',
  '        burnMasterEnabled: true,\n        autoBurnEnabled: false,\n        autoBurnNameAliases: "Dizy,Dizygotic",\n        autoBurnCooldownSeconds: 45,',
  "burn defaults"
);

replaceOnce(
  `            <b>Auto-burn bot</b>\n            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px">\n                <label>My Rumble username</label>\n                <input id="myNicknameInput" value="\${String(settings.myNickname || "").replace(/\"/g, "&quot;")}" placeholder="auto-detected after you send" style="width:170px">\n                <span id="autoBurnRuntimeStatus" style="font-size:12px;color:gray">\${burnRuntimeStatusText()}</span>\n            </div>\n            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px">\n                <label><input type="checkbox" id="autoBurnToggle"\${settings.autoBurnEnabled ? " checked" : ""}> Reply when someone tags me</label>\n                <label>Cooldown</label>`,
  `            <b>Auto-burn bot</b>\n            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px">\n                <label><input type="checkbox" id="burnMasterToggle"\${settings.burnMasterEnabled ? " checked" : ""}> Burn Bot enabled</label>\n                <label>My Rumble username</label>\n                <input id="myNicknameInput" value="\${String(settings.myNickname || "").replace(/\"/g, "&quot;")}" placeholder="auto-detected after you send" style="width:170px">\n                <span id="autoBurnRuntimeStatus" style="font-size:12px;color:gray">\${burnRuntimeStatusText()}</span>\n            </div>\n            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px">\n                <label><input type="checkbox" id="autoBurnToggle"\${settings.autoBurnEnabled ? " checked" : ""}> Reply when someone tags/names me</label>\n                <label>Name aliases</label>\n                <input type="text" id="autoBurnNameAliasesInput" value="\${String(settings.autoBurnNameAliases || "").replace(/&/g, "&amp;").replace(/\"/g, "&quot;")}" placeholder="Dizy,Dizygotic" title="Comma-separated aliases; matched case-insensitively as whole words" style="width:150px">\n                <label>Cooldown</label>`,
  "burn panel controls"
);

replaceOnce(
  '            <div style="font-size:12px;color:gray;margin-top:4px">Reply delay controls how long Burn Bot waits before each queued reply sends (5 seconds by default). Cooldown 0 disables tag suppression, so every detected tag is queued and answered serially; a positive cooldown keeps the old minimum-gap suppression. The Primary engine runs first. Personality engines share the Curated/history brain, then restyle the safe result; Random personality never includes DRILL SARGE. Curated favours live quote-backs, exact-repeat evidence and repeated-tag escalation; savage built-ins are the first fallback. Weak or malformed generated mashups are discarded instead of sent. Burn replies still wait for an empty idle composer rather than trampling a message you are typing.</div>',
  '            <div style="font-size:12px;color:gray;margin-top:4px">Burn Bot enabled is the master kill switch: OFF clears queued replies and blocks burn generation/sending while transcript recording and Curated learning continue. Reply when someone tags/names me listens for your Rumble username plus comma-separated Name aliases using case-insensitive whole-word matching. Reply delay controls how long Burn Bot waits before each queued reply sends (5 seconds by default). Cooldown 0 disables trigger suppression, so every detected tag/name is queued and answered serially; a positive cooldown keeps the minimum-gap suppression. The Primary engine runs first. Personality engines share the Curated/history brain, then restyle the safe result; Random personality never includes DRILL SARGE. Curated favours live quote-backs, exact-repeat evidence and repeated-tag escalation; savage built-ins are the first fallback. Weak or malformed generated mashups are discarded instead of sent. Burn replies still wait for an empty idle composer rather than trampling a message you are typing.</div>',
  "burn panel help"
);

replaceOnce(
  '            settings.autoBurnEnabled = !!panel.querySelector("#autoBurnToggle")?.checked;\n            const cooldownSeconds = parseInt(panel.querySelector("#autoBurnCooldownInput")?.value, 10);',
  '            settings.burnMasterEnabled = !!panel.querySelector("#burnMasterToggle")?.checked;\n            settings.autoBurnEnabled = !!panel.querySelector("#autoBurnToggle")?.checked;\n            settings.autoBurnNameAliases = panel.querySelector("#autoBurnNameAliasesInput")?.value || "";\n            const cooldownSeconds = parseInt(panel.querySelector("#autoBurnCooldownInput")?.value, 10);',
  "burn panel save"
);

replaceOnce(
  '        const rebuildCuratedBtn = panel.querySelector("#rebuildCuratedBurnsBtn");',
  `        const burnMasterToggle = panel.querySelector("#burnMasterToggle");\n        if (burnMasterToggle) {\n            burnMasterToggle.addEventListener("change", () => {\n                setBurnMasterEnabled(!!burnMasterToggle.checked, { persist: true });\n            });\n        }\n\n        const rebuildCuratedBtn = panel.querySelector("#rebuildCuratedBurnsBtn");`,
  "master toggle event"
);

replaceOnce(
  `    function burnRuntimeStatusText() {\n        const nickname = sanitizeNickname(settings.myNickname || burnRuntimeStatus.nickname) || "not detected";\n        return \`me: \${nickname} · composer: \${burnRuntimeStatus.composerFound ? "ready" : "not found"} · last: \${burnRuntimeStatus.lastAttempt}\`;\n    }`,
  `    function burnRuntimeStatusText() {\n        const nickname = sanitizeNickname(settings.myNickname || burnRuntimeStatus.nickname) || "not detected";\n        const master = settings.burnMasterEnabled ? "on" : "off";\n        return \`burn: \${master} · me: \${nickname} · composer: \${burnRuntimeStatus.composerFound ? "ready" : "not found"} · last: \${burnRuntimeStatus.lastAttempt}\`;\n    }\n\n    function setBurnMasterEnabled(enabled, options = {}) {\n        settings.burnMasterEnabled = !!enabled;\n        if (!settings.burnMasterEnabled) {\n            burnTagQueue.length = 0;\n            pendingCuratedBurnSelection = null;\n            setBurnRuntimeStatus({ lastAttempt: "Burn Bot disabled · queue cleared" });\n        } else {\n            setBurnRuntimeStatus({ lastAttempt: "Burn Bot enabled" });\n        }\n        if (options.persist !== false) saveSettings();\n    }`,
  "master state helper"
);

replaceOnce(
  '    function generateBurnResponse(ctx) {\n        pendingCuratedBurnSelection = null;',
  '    function generateBurnResponse(ctx) {\n        if (!settings.burnMasterEnabled) return null;\n        pendingCuratedBurnSelection = null;',
  "generation master guard"
);

replaceOnce(
  `    async function maybeHandleAutoBurn(ctx) {\n        if (!settings.autoBurnEnabled) return;\n        burnTagQueue.push({ ...ctx });\n        setBurnRuntimeStatus({ lastAttempt: \`queued: \${burnTagQueue.length} tag\${burnTagQueue.length === 1 ? "" : "s"} waiting\` });\n        if (!burnQueueDrainPromise) {\n            burnQueueDrainPromise = drainBurnTagQueue().finally(() => {\n                burnQueueDrainPromise = null;\n                if (settings.autoBurnEnabled) setBurnRuntimeStatus({ lastAttempt: "queue clear" });\n            });\n        }\n        return burnQueueDrainPromise;\n    }`,
  `    async function maybeHandleAutoBurn(ctx) {\n        if (!settings.burnMasterEnabled || !settings.autoBurnEnabled) return;\n        burnTagQueue.push({ ...ctx });\n        setBurnRuntimeStatus({ lastAttempt: \`queued: \${burnTagQueue.length} trigger\${burnTagQueue.length === 1 ? "" : "s"} waiting\` });\n        if (!burnQueueDrainPromise) {\n            burnQueueDrainPromise = drainBurnTagQueue().finally(() => {\n                burnQueueDrainPromise = null;\n                if (settings.burnMasterEnabled && settings.autoBurnEnabled) setBurnRuntimeStatus({ lastAttempt: "queue clear" });\n            });\n        }\n        return burnQueueDrainPromise;\n    }`,
  "queue entry master guard"
);

replaceOnce(
  `        while (burnTagQueue.length) {\n            if (!settings.autoBurnEnabled) {\n                burnTagQueue.length = 0;\n                return;\n            }`,
  `        while (burnTagQueue.length) {\n            if (!settings.burnMasterEnabled || !settings.autoBurnEnabled) {\n                burnTagQueue.length = 0;\n                return;\n            }`,
  "queue drain master guard"
);

replaceOnce(
  `    async function processQueuedAutoBurn(ctx) {\n        const tagCount = noteBurnPressure(ctx.from || ctx.target);`,
  `    async function processQueuedAutoBurn(ctx) {\n        if (!settings.burnMasterEnabled || !settings.autoBurnEnabled) {\n            burnTagQueue.length = 0;\n            return;\n        }\n        const tagCount = noteBurnPressure(ctx.from || ctx.target);`,
  "queued burn start guard"
);

replaceOnce(
  `            if (!settings.autoBurnEnabled) {\n                burnTagQueue.length = 0;\n                setBurnRuntimeStatus({ lastAttempt: "cancelled: auto-burn disabled during reply delay" });\n                return;\n            }`,
  `            if (!settings.burnMasterEnabled || !settings.autoBurnEnabled) {\n                burnTagQueue.length = 0;\n                setBurnRuntimeStatus({ lastAttempt: "cancelled: Burn Bot or auto-reply disabled during reply delay" });\n                return;\n            }`,
  "delayed send master guard"
);

replaceOnce(
  `    /***********************\n     * Core message refresh\n     ***********************/\n    function refreshBlockedMessages() {`,
  `    function matchesAutoBurnTrigger(text, selfHandleLower) {\n        const aliases = String(settings.autoBurnNameAliases || "")\n            .split(",")\n            .map((value) => value.trim().replace(/^@+/, "").toLowerCase())\n            .filter(Boolean);\n        const candidates = [...new Set([String(selfHandleLower || "").trim().toLowerCase(), ...aliases].filter(Boolean))];\n        const input = String(text || "");\n        return candidates.some((name) => {\n            const triggerRegex = new RegExp(\`(^|[^A-Za-z0-9_])@?\${escapeRegex(name)}(?=$|[^A-Za-z0-9_])\`, "i");\n            return triggerRegex.test(input);\n        });\n    }\n\n    /***********************\n     * Core message refresh\n     ***********************/\n    function refreshBlockedMessages() {`,
  "alias trigger matcher"
);

replaceOnce(
  `                if (\n                    settings.autoBurnEnabled &&\n                    !el._autoBurnHandled &&\n                    el._recentlyAdded &&\n                    username && selfHandleLower &&\n                    username !== selfHandleLower &&\n                    !userIsBlocked && !isSystem\n                ) {\n                    const mentionRegex = new RegExp(\`\\\\b@?\${escapeRegex(selfHandleLower)}\\\\b\`, "i");\n                    if (mentionRegex.test(lowerText)) {\n                        el._autoBurnHandled = true;\n                        setBurnRuntimeStatus({ nickname: selfHandle, lastAttempt: \`tag detected from @\${displayName.replace(/^@+/, "")}\` });\n                        void maybeHandleAutoBurn({ target: displayName.replace(/^@+/, ""), message: plainOriginal, from: username });\n                    }\n                }`,
  `                if (\n                    settings.burnMasterEnabled &&\n                    settings.autoBurnEnabled &&\n                    !el._autoBurnHandled &&\n                    el._recentlyAdded &&\n                    username && selfHandleLower &&\n                    username !== selfHandleLower &&\n                    !userIsBlocked && !isSystem\n                ) {\n                    if (matchesAutoBurnTrigger(plainOriginal, selfHandleLower)) {\n                        el._autoBurnHandled = true;\n                        setBurnRuntimeStatus({ nickname: selfHandle, lastAttempt: \`tag/name detected from @\${displayName.replace(/^@+/, "")}\` });\n                        void maybeHandleAutoBurn({ target: displayName.replace(/^@+/, ""), message: plainOriginal, from: username });\n                    }\n                }`,
  "refresh alias trigger"
);

fs.writeFileSync(path, source);
console.log("Applied guarded Burn Bot master/alias patch for v1.12.1");
