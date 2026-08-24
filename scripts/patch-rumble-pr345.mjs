import fs from "node:fs";

const path = new URL("./tampermonkey/dizygotic-rumble-chat-tool.user.js", import.meta.url);
let source = fs.readFileSync(path, "utf8");

function replaceOnce(oldText, newText, label) {
  const first = source.indexOf(oldText);
  if (first < 0) throw new Error(`missing patch seam: ${label}`);
  if (source.indexOf(oldText, first + oldText.length) >= 0) throw new Error(`ambiguous patch seam: ${label}`);
  source = source.slice(0, first) + newText + source.slice(first + oldText.length);
}

function replaceAllExact(oldText, newText, expected, label) {
  const count = source.split(oldText).length - 1;
  if (count !== expected) throw new Error(`patch seam ${label}: expected ${expected}, found ${count}`);
  source = source.split(oldText).join(newText);
}

function replaceBetween(startNeedle, endNeedle, replacement, label) {
  const start = source.indexOf(startNeedle);
  if (start < 0) throw new Error(`missing start seam: ${label}`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  if (end < 0) throw new Error(`missing end seam: ${label}`);
  source = source.slice(0, start) + replacement + source.slice(end);
}

replaceOnce("// @version      1.11.1", "// @version      1.12.0", "userscript version");
replaceOnce("    const CURATED_MAX_USERS = 300;\n", "", "hard curated user cap");
replaceOnce(
  "        curatedBurnMaxPerUser: 12,\n        curatedBurnReviewBeforeUse: false,",
  "        curatedBurnMaxPerUser: 60,\n        curatedBurnMaxUsers: 0,\n        curatedBurnReviewBeforeUse: false,",
  "curated defaults"
);
replaceOnce(
  "    let curatedSaveTimer = null;\n    let pendingCuratedBurnSelection = null;",
  "    let curatedSaveTimer = null;\n    let curatedRebuildPromise = null;\n    let curatedRebuildProgress = null;\n    let pendingCuratedBurnSelection = null;",
  "curated rebuild state"
);
replaceAllExact(
  "Number(settings.curatedBurnMaxPerUser) || 12",
  "Number(settings.curatedBurnMaxPerUser) || 60",
  2,
  "curated per-user fallbacks"
);

replaceOnce(
`        const users = Object.entries(curatedBurnStore.users);
        if (users.length > CURATED_MAX_USERS) {
            users
                .sort((a, b) => String(b[1]?.updatedAt || "").localeCompare(String(a[1]?.updatedAt || "")))
                .slice(CURATED_MAX_USERS)
                .forEach(([key]) => delete curatedBurnStore.users[key]);
        }`,
`        const users = Object.entries(curatedBurnStore.users);
        const maxUsers = Math.max(0, Number(settings.curatedBurnMaxUsers) || 0);
        if (maxUsers > 0 && users.length > maxUsers) {
            users
                .sort((a, b) => String(b[1]?.updatedAt || "").localeCompare(String(a[1]?.updatedAt || "")))
                .slice(maxUsers)
                .forEach(([key]) => delete curatedBurnStore.users[key]);
        }`,
  "configurable curated user pruning"
);

replaceOnce(
`    function curatedBurnSummaryText() {
        const profiles = Object.values(curatedBurnStore?.users || {});`,
`    function curatedBurnSummaryText() {
        if (curatedRebuildProgress) {
            const processed = Math.max(0, Number(curatedRebuildProgress.processed) || 0);
            const total = Math.max(0, Number(curatedRebuildProgress.total) || 0);
            return \`Rebuilding curated memory… \${processed.toLocaleString()} / \${total.toLocaleString()} messages · please wait\`;
        }
        const profiles = Object.values(curatedBurnStore?.users || {});`,
  "curated progress summary"
);

replaceBetween(
  "    async function rebuildCuratedBurnsFromTranscript(reset = true) {",
  "    function backfillCuratedBurnsFromTranscript() {",
`    async function rebuildCuratedBurnsFromTranscript(reset = true) {
        if (curatedRebuildPromise) return curatedRebuildPromise;
        curatedRebuildPromise = (async () => {
            await initializeChatTranscriptStorage();
            if (reset) curatedBurnStore = { schemaVersion: CURATED_BURNS_SCHEMA, lastProcessedSeq: 0, users: {}, seedUsage: {}, recentSeedIds: [], recentSeedFamilies: [] };
            const touched = new Set();
            const records = chatLog.slice();
            curatedRebuildProgress = { processed: 0, total: records.length };
            updateCuratedBurnStatus();
            const yieldEvery = 250;
            for (let index = 0; index < records.length; index += 1) {
                const record = records[index];
                if (record?.username) {
                    ingestCuratedRecord(record, { force: true, deferSave: true, deferCurate: true });
                    touched.add(String(record.username).toLowerCase());
                }
                curatedRebuildProgress.processed = index + 1;
                if ((index + 1) % yieldEvery === 0) {
                    updateCuratedBurnStatus();
                    await new Promise((resolve) => setTimeout(resolve, 0));
                }
            }
            updateCuratedBurnStatus();
            let finalized = 0;
            for (const username of touched) {
                const profile = curatedBurnStore.users[username];
                if (profile && profile.messageCount >= Math.max(3, Number(settings.curatedBurnMinMessages) || 8)) regenerateCuratedBurns(profile);
                finalized += 1;
                if (finalized % 50 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
            }
            saveCuratedBurnStore();
            return curatedBurnSummaryText();
        })();
        try {
            return await curatedRebuildPromise;
        } finally {
            curatedRebuildPromise = null;
            curatedRebuildProgress = null;
            updateCuratedBurnStatus();
        }
    }

`,
  "single-flight curated rebuild"
);

replaceOnce(
`                <label>Max/user</label>
                <input type="number" id="curatedBurnMaxPerUserInput" min="3" max="40" value="\${settings.curatedBurnMaxPerUser}" style="width:58px">`,
`                <label>Max/user</label>
                <input type="number" id="curatedBurnMaxPerUserInput" min="3" value="\${settings.curatedBurnMaxPerUser}" style="width:68px">
                <label>Max users</label>
                <input type="number" id="curatedBurnMaxUsersInput" min="0" value="\${settings.curatedBurnMaxUsers}" title="0 = unlimited" style="width:76px">`,
  "curated panel limits"
);
replaceOnce(
`            <div id="curatedBurnStatus" style="font-size:12px;color:gray;margin-top:5px">\${curatedBurnSummaryText()}</div>`,
`            <div style="font-size:11px;color:gray;margin-top:4px">Max users: 0 = unlimited. Rebuild rescans the saved transcript using the current limits.</div>
            <div id="curatedBurnStatus" style="font-size:12px;color:gray;margin-top:5px">\${curatedBurnSummaryText()}</div>`,
  "curated panel limit hint"
);

replaceOnce(
`            settings.curatedBurnMaxPerUser = Math.max(3, Math.min(40, parseInt(panel.querySelector("#curatedBurnMaxPerUserInput")?.value, 10) || 12));
            settings.autoBurnEnabled = !!panel.querySelector("#autoBurnToggle")?.checked;
            settings.autoBurnCooldownSeconds = Math.max(5, parseInt(panel.querySelector("#autoBurnCooldownInput")?.value, 10) || 45);`,
`            const maxPerUserValue = parseInt(panel.querySelector("#curatedBurnMaxPerUserInput")?.value, 10);
            settings.curatedBurnMaxPerUser = Number.isFinite(maxPerUserValue) ? Math.max(3, maxPerUserValue) : 60;
            const maxUsersValue = parseInt(panel.querySelector("#curatedBurnMaxUsersInput")?.value, 10);
            settings.curatedBurnMaxUsers = Number.isFinite(maxUsersValue) ? Math.max(0, maxUsersValue) : 0;
            settings.autoBurnEnabled = !!panel.querySelector("#autoBurnToggle")?.checked;
            const cooldownSeconds = parseInt(panel.querySelector("#autoBurnCooldownInput")?.value, 10);
            settings.autoBurnCooldownSeconds = Math.max(0, Number.isFinite(cooldownSeconds) ? cooldownSeconds : 45);`,
  "panel limit and cooldown parsing"
);
replaceOnce(
  `<input type="number" id="autoBurnCooldownInput" min="5" value="\${settings.autoBurnCooldownSeconds}" style="width:70px">`,
  `<input type="number" id="autoBurnCooldownInput" min="0" value="\${settings.autoBurnCooldownSeconds}" style="width:70px">`,
  "zero cooldown panel"
);
replaceOnce(
`            <div style="font-size:12px;color:gray;margin-top:4px">Reply delay controls how long Burn Bot waits after generating a reply before it sends (5 seconds by default); Cooldown remains the minimum gap after a successful send. The Primary engine runs first. Personality engines share the Curated/history brain, then restyle the safe result; Random personality never includes DRILL SARGE. Curated favours live quote-backs, exact-repeat evidence and repeated-tag escalation; savage built-ins are the first fallback. Weak or malformed generated mashups are discarded instead of sent. Burn replies still wait for an empty idle composer rather than trampling a message you are typing.</div>`,
`            <div style="font-size:12px;color:gray;margin-top:4px">Reply delay controls how long Burn Bot waits before each queued reply sends (5 seconds by default). Cooldown 0 disables tag suppression, so every detected tag is queued and answered serially; a positive cooldown keeps the old minimum-gap suppression. The Primary engine runs first. Personality engines share the Curated/history brain, then restyle the safe result; Random personality never includes DRILL SARGE. Curated favours live quote-backs, exact-repeat evidence and repeated-tag escalation; savage built-ins are the first fallback. Weak or malformed generated mashups are discarded instead of sent. Burn replies still wait for an empty idle composer rather than trampling a message you are typing.</div>`,
  "queue help text"
);

replaceBetween(
  `        const rebuildCuratedBtn = panel.querySelector("#rebuildCuratedBurnsBtn");`,
  `        const clearCuratedBtn = panel.querySelector("#clearCuratedBurnsBtn");`,
`        const rebuildCuratedBtn = panel.querySelector("#rebuildCuratedBurnsBtn");
        if (rebuildCuratedBtn) {
            rebuildCuratedBtn.addEventListener("click", async () => {
                if (rebuildCuratedBtn.disabled) return;
                settings.curatedBurnsEnabled = !!panel.querySelector("#curatedBurnsEnabledInput")?.checked;
                settings.curatedBurnMinMessages = Math.max(3, Math.min(100, parseInt(panel.querySelector("#curatedBurnMinMessagesInput")?.value, 10) || 8));
                settings.curatedBurnRefreshEvery = Math.max(1, Math.min(50, parseInt(panel.querySelector("#curatedBurnRefreshEveryInput")?.value, 10) || 3));
                const maxPerUserValue = parseInt(panel.querySelector("#curatedBurnMaxPerUserInput")?.value, 10);
                settings.curatedBurnMaxPerUser = Number.isFinite(maxPerUserValue) ? Math.max(3, maxPerUserValue) : 60;
                const maxUsersValue = parseInt(panel.querySelector("#curatedBurnMaxUsersInput")?.value, 10);
                settings.curatedBurnMaxUsers = Number.isFinite(maxUsersValue) ? Math.max(0, maxUsersValue) : 0;
                saveSettings();
                const originalLabel = rebuildCuratedBtn.textContent;
                rebuildCuratedBtn.disabled = true;
                rebuildCuratedBtn.textContent = "Rebuilding… please wait";
                updateCuratedBurnStatus(panel);
                try {
                    await rebuildCuratedBurnsFromTranscript(true);
                } finally {
                    rebuildCuratedBtn.disabled = false;
                    rebuildCuratedBtn.textContent = originalLabel;
                    updateCuratedBurnStatus(panel);
                }
            });
        }
`,
  "rebuild button single-flight UX"
);

replaceOnce(
`    let burnSendInFlight = false;
    let pendingOutgoingIdentity = null;`,
`    let burnSendInFlight = false;
    const burnTagQueue = [];
    let burnQueueDrainPromise = null;
    let pendingOutgoingIdentity = null;`,
  "auto-burn queue state"
);

replaceBetween(
  "    async function maybeHandleAutoBurn(ctx) {",
  "    /***********************\n     * Core message refresh",
`    async function maybeHandleAutoBurn(ctx) {
        if (!settings.autoBurnEnabled) return;
        burnTagQueue.push({ ...ctx });
        setBurnRuntimeStatus({ lastAttempt: \`queued: \${burnTagQueue.length} tag\${burnTagQueue.length === 1 ? "" : "s"} waiting\` });
        if (!burnQueueDrainPromise) {
            burnQueueDrainPromise = drainBurnTagQueue().finally(() => {
                burnQueueDrainPromise = null;
                if (settings.autoBurnEnabled) setBurnRuntimeStatus({ lastAttempt: "queue clear" });
            });
        }
        return burnQueueDrainPromise;
    }

    async function drainBurnTagQueue() {
        while (burnTagQueue.length) {
            if (!settings.autoBurnEnabled) {
                burnTagQueue.length = 0;
                return;
            }
            const next = burnTagQueue.shift();
            await processQueuedAutoBurn(next);
        }
    }

    async function processQueuedAutoBurn(ctx) {
        const tagCount = noteBurnPressure(ctx.from || ctx.target);
        const configuredCooldown = Number(settings.autoBurnCooldownSeconds);
        const cooldownSeconds = Number.isFinite(configuredCooldown)
            ? Math.max(0, configuredCooldown)
            : 45;
        const cooldownMs = cooldownSeconds * 1000;
        const now = Date.now();
        if (cooldownMs > 0 && now - lastBurnTimestamp < cooldownMs) {
            setBurnRuntimeStatus({ lastAttempt: \`skipped by \${cooldownSeconds}s cooldown · queued: \${burnTagQueue.length}\` });
            return;
        }
        const response = generateBurnResponse({ ...ctx, tagCount });
        const curatedSelection = pendingCuratedBurnSelection;
        if (!response) {
            setBurnRuntimeStatus({ lastAttempt: \`no burn generated · queued: \${burnTagQueue.length}\` });
            pendingCuratedBurnSelection = null;
            return;
        }
        burnSendInFlight = true;
        const configuredReplyDelay = Number(settings.autoBurnReplyDelaySeconds);
        const replyDelaySeconds = Number.isFinite(configuredReplyDelay)
            ? Math.max(0, Math.min(120, configuredReplyDelay))
            : 5;
        const replyDelayMs = replyDelaySeconds * 1000;
        setBurnRuntimeStatus({ lastAttempt: \`generated via \${lastBurnEngineUsed} for @\${ctx.target || ctx.from} · tag #\${tagCount} · replying in \${replyDelaySeconds}s · queued: \${burnTagQueue.length}\` });
        try {
            if (replyDelayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, replyDelayMs));
            }
            if (!settings.autoBurnEnabled) {
                burnTagQueue.length = 0;
                setBurnRuntimeStatus({ lastAttempt: "cancelled: auto-burn disabled during reply delay" });
                return;
            }
            const sent = await sendChatMessage(response, {
                engine: lastBurnEngineUsed,
                target: ctx.target || ctx.from || "",
                strategy: curatedSelection?.strategy || lastBurnEngineUsed,
                context: curatedSelection?.context || ""
            });
            if (sent) {
                lastBurnTimestamp = Date.now();
                rememberRecentBurn(response);
                if (curatedSelection) markCuratedBurnUsed(curatedSelection);
                setBurnRuntimeStatus({ lastAttempt: \`send dispatched · queued: \${burnTagQueue.length}\` });
            }
        } catch (err) {
            console.warn("Auto-burn send failed", err);
            setBurnRuntimeStatus({ lastAttempt: \`failed: send exception · queued: \${burnTagQueue.length}\`, lastError: String(err?.message || err) });
        } finally {
            burnSendInFlight = false;
            pendingCuratedBurnSelection = null;
        }
    }

`,
  "queued auto-burn processing"
);

fs.writeFileSync(path, source);
console.log("PR345 userscript patch applied");
