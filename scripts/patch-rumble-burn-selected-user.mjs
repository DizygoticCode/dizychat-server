import fs from "node:fs";

const sourcePath = "scripts/tampermonkey/dizygotic-rumble-chat-tool.user.js";
const versionTestPath = "scripts/tests/rumble-userscript-version-source.test.mjs";
const masterTestPath = "scripts/tests/rumble-burn-master-alias-source.test.mjs";
const delayTestPath = "scripts/tests/rumble-burn-reply-delay-source.test.mjs";

function replaceOnce(text, oldText, newText, label) {
  const first = text.indexOf(oldText);
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (text.indexOf(oldText, first + oldText.length) >= 0) throw new Error(`Ambiguous patch anchor: ${label}`);
  return text.slice(0, first) + newText + text.slice(first + oldText.length);
}

let source = fs.readFileSync(sourcePath, "utf8");
if (source.includes("autoBurnSelectedUsersEnabled: false") && source.includes('id="autoBurnSelectedUsersToggle"')) {
  console.log("Userscript already patched.");
} else {
  source = replaceOnce(source, "// @version      1.12.1", "// @version      1.12.2", "version");

  source = replaceOnce(
    source,
    '        autoBurnEnabled: false,\n        autoBurnNameAliases: "Dizy,Dizygotic",',
    '        autoBurnEnabled: false,\n        autoBurnNameAliases: "Dizy,Dizygotic",\n        autoBurnSelectedUsersEnabled: false,\n        autoBurnSelectedUsers: "",',
    "selected-user defaults"
  );

  source = replaceOnce(
    source,
    '            const header = ["seq","capturedAt","username","displayName","message","mentions","rawHtml","rowClass","url","title","botGenerated","botEngine","botTarget","botFontStyle","botStrategy","botContext"];\n            const rows = chatLog.map((r) => [r.seq,r.capturedAt,r.username,r.displayName,r.message,(r.mentions||[]).join(" "),r.rawHtml||"",r.rowClass||"",r.url,r.title,r.botGenerated?"true":"",r.botEngine||"",r.botTarget||"",r.botFontStyle||"",r.botStrategy||"",r.botContext||""].map(csvEscape).join(","));',
    '            const header = ["seq","capturedAt","username","displayName","message","mentions","rawHtml","rowClass","url","title","botGenerated","botEngine","botTarget","botFontStyle","botStrategy","botContext","botTrigger"];\n            const rows = chatLog.map((r) => [r.seq,r.capturedAt,r.username,r.displayName,r.message,(r.mentions||[]).join(" "),r.rawHtml||"",r.rowClass||"",r.url,r.title,r.botGenerated?"true":"",r.botEngine||"",r.botTarget||"",r.botFontStyle||"",r.botStrategy||"",r.botContext||"",r.botTrigger||""].map(csvEscape).join(","));',
    "CSV bot trigger metadata"
  );

  source = replaceOnce(
    source,
    '            strategy: String(meta.strategy || ""),\n            context: String(meta.context || ""),\n            fontStyle: settings.outgoingFontStyle || "default",',
    '            strategy: String(meta.strategy || ""),\n            context: String(meta.context || ""),\n            trigger: String(meta.trigger || ""),\n            fontStyle: settings.outgoingFontStyle || "default",',
    "pending burn trigger"
  );

  source = replaceOnce(
    source,
    '            botStrategy: pendingBurnEcho.strategy,\n            botContext: pendingBurnEcho.context\n        };',
    '            botStrategy: pendingBurnEcho.strategy,\n            botContext: pendingBurnEcho.context,\n            botTrigger: pendingBurnEcho.trigger || ""\n        };',
    "consumed burn trigger"
  );

  const helperBlock = [
    '',
    '    function automaticBurnTriggersEnabled() {',
    '        return !!settings.autoBurnEnabled || !!settings.autoBurnSelectedUsersEnabled;',
    '    }',
    '',
    '    function automaticBurnTriggerEnabled(trigger) {',
    '        if (trigger === "selected-user") return !!settings.autoBurnSelectedUsersEnabled;',
    '        if (trigger === "name/tag") return !!settings.autoBurnEnabled;',
    '        return automaticBurnTriggersEnabled();',
    '    }',
    '',
    '    function matchesSelectedAutoBurnUser(username) {',
    '        const normalized = String(username || "").trim().replace(/^@+/, "").toLowerCase();',
    '        if (!normalized) return false;',
    '        const selectedUsers = String(settings.autoBurnSelectedUsers || "")',
    '            .split(",")',
    '            .map((value) => value.trim().replace(/^@+/, "").toLowerCase())',
    '            .filter(Boolean);',
    '        return selectedUsers.includes(normalized);',
    '    }',
    ''
  ].join("\n");
  source = replaceOnce(source, "\n    function refreshBlockedMessages()", `${helperBlock}\n    function refreshBlockedMessages()`, "selected-user helpers");

  source = replaceOnce(
    source,
    '    async function maybeHandleAutoBurn(ctx) {\n        if (!settings.burnMasterEnabled || !settings.autoBurnEnabled) return;',
    '    async function maybeHandleAutoBurn(ctx) {\n        if (!settings.burnMasterEnabled || !automaticBurnTriggersEnabled()) return;\n        if (!automaticBurnTriggerEnabled(ctx.trigger)) return;',
    "queue entry guard"
  );

  source = replaceOnce(
    source,
    '                if (settings.burnMasterEnabled && settings.autoBurnEnabled) setBurnRuntimeStatus({ lastAttempt: "queue clear" });',
    '                if (settings.burnMasterEnabled && automaticBurnTriggersEnabled()) setBurnRuntimeStatus({ lastAttempt: "queue clear" });',
    "queue clear status guard"
  );

  source = replaceOnce(
    source,
    '        while (burnTagQueue.length) {\n            if (!settings.burnMasterEnabled || !settings.autoBurnEnabled) {\n                burnTagQueue.length = 0;\n                return;\n            }\n            const next = burnTagQueue.shift();\n            await processQueuedAutoBurn(next);\n        }',
    '        while (burnTagQueue.length) {\n            if (!settings.burnMasterEnabled || !automaticBurnTriggersEnabled()) {\n                burnTagQueue.length = 0;\n                return;\n            }\n            const next = burnTagQueue.shift();\n            if (!automaticBurnTriggerEnabled(next?.trigger)) continue;\n            await processQueuedAutoBurn(next);\n        }',
    "queue drain guard"
  );

  source = replaceOnce(
    source,
    '    async function processQueuedAutoBurn(ctx) {\n        if (!settings.burnMasterEnabled || !settings.autoBurnEnabled) {\n            burnTagQueue.length = 0;\n            return;\n        }',
    '    async function processQueuedAutoBurn(ctx) {\n        if (!settings.burnMasterEnabled || !automaticBurnTriggersEnabled()) {\n            burnTagQueue.length = 0;\n            return;\n        }\n        if (!automaticBurnTriggerEnabled(ctx.trigger)) return;',
    "queue process guard"
  );

  source = replaceOnce(
    source,
    '            if (!settings.burnMasterEnabled || !settings.autoBurnEnabled) {\n                burnTagQueue.length = 0;\n                setBurnRuntimeStatus({ lastAttempt: "cancelled: Burn Bot or auto-reply disabled during reply delay" });\n                return;\n            }',
    '            if (!settings.burnMasterEnabled || !automaticBurnTriggersEnabled()) {\n                burnTagQueue.length = 0;\n                setBurnRuntimeStatus({ lastAttempt: "cancelled: Burn Bot or all automatic replies disabled during reply delay" });\n                return;\n            }\n            if (!automaticBurnTriggerEnabled(ctx.trigger)) {\n                setBurnRuntimeStatus({ lastAttempt: `cancelled: ${ctx.trigger || "automatic"} trigger disabled during reply delay` });\n                return;\n            }',
    "delayed reply guard"
  );

  source = replaceOnce(
    source,
    '                strategy: curatedSelection?.strategy || lastBurnEngineUsed,\n                context: curatedSelection?.context || ""\n            });',
    '                strategy: curatedSelection?.strategy || lastBurnEngineUsed,\n                context: curatedSelection?.context || "",\n                trigger: ctx.trigger || ""\n            });',
    "send trigger metadata"
  );

  source = replaceOnce(
    source,
    '                <select id="autoBurnEngineSelect">${burnEngineRecommendations.map((r) => `<option value="${r.key}"${settings.autoBurnEngine === r.key ? " selected" : ""}>${r.label}</option>`).join("")}</select>\n            </div>\n            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:7px;font-size:12px">',
    '                <select id="autoBurnEngineSelect">${burnEngineRecommendations.map((r) => `<option value="${r.key}"${settings.autoBurnEngine === r.key ? " selected" : ""}>${r.label}</option>`).join("")}</select>\n            </div>\n            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px">\n                <label><input type="checkbox" id="autoBurnSelectedUsersToggle"${settings.autoBurnSelectedUsersEnabled ? " checked" : ""}> Reply to selected users</label>\n                <label>Users</label>\n                <input type="text" id="autoBurnSelectedUsersInput" value="${String(settings.autoBurnSelectedUsers || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" placeholder="user1,user2" title="Comma-separated exact Rumble usernames; matched case-insensitively" style="width:220px">\n            </div>\n            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:7px;font-size:12px">',
    "selected-user panel controls"
  );

  source = replaceOnce(
    source,
    '            settings.autoBurnEnabled = !!panel.querySelector("#autoBurnToggle")?.checked;\n            settings.autoBurnNameAliases = panel.querySelector("#autoBurnNameAliasesInput")?.value || "";',
    '            settings.autoBurnEnabled = !!panel.querySelector("#autoBurnToggle")?.checked;\n            settings.autoBurnNameAliases = panel.querySelector("#autoBurnNameAliasesInput")?.value || "";\n            settings.autoBurnSelectedUsersEnabled = !!panel.querySelector("#autoBurnSelectedUsersToggle")?.checked;\n            settings.autoBurnSelectedUsers = panel.querySelector("#autoBurnSelectedUsersInput")?.value || "";',
    "selected-user saved settings"
  );

  source = replaceOnce(
    source,
    'Reply when someone tags/names me listens for your Rumble username plus comma-separated Name aliases using case-insensitive whole-word matching. Reply delay controls',
    'Reply when someone tags/names me listens for your Rumble username plus comma-separated Name aliases using case-insensitive whole-word matching. Reply to selected users independently matches comma-separated exact Rumble usernames, case-insensitively, and sends them through the same guarded FIFO queue. Reply delay controls',
    "selected-user help text"
  );

  const oldRefresh = [
    '                if (',
    '                    settings.burnMasterEnabled &&',
    '                    settings.autoBurnEnabled &&',
    '                    !el._autoBurnHandled &&',
    '                    el._recentlyAdded &&',
    '                    username && selfHandleLower &&',
    '                    username !== selfHandleLower &&',
    '                    !userIsBlocked && !isSystem',
    '                ) {',
    '                    if (matchesAutoBurnTrigger(plainOriginal, selfHandleLower)) {',
    '                        el._autoBurnHandled = true;',
    '                        setBurnRuntimeStatus({ nickname: selfHandle, lastAttempt: `tag/name detected from @${displayName.replace(/^@+/, "")}` });',
    '                        void maybeHandleAutoBurn({ target: displayName.replace(/^@+/, ""), message: plainOriginal, from: username });',
    '                    }',
    '                }'
  ].join("\n");
  const newRefresh = [
    '                if (',
    '                    settings.burnMasterEnabled &&',
    '                    automaticBurnTriggersEnabled() &&',
    '                    !el._autoBurnHandled &&',
    '                    el._recentlyAdded &&',
    '                    username && selfHandleLower &&',
    '                    username !== selfHandleLower &&',
    '                    !userIsBlocked && !isSystem',
    '                ) {',
    '                    const nameTriggerMatched =',
    '                        settings.autoBurnEnabled &&',
    '                        matchesAutoBurnTrigger(plainOriginal, selfHandleLower);',
    '                    const selectedUserTriggerMatched =',
    '                        settings.autoBurnSelectedUsersEnabled &&',
    '                        matchesSelectedAutoBurnUser(username);',
    '                    if (nameTriggerMatched || selectedUserTriggerMatched) {',
    '                        el._autoBurnHandled = true;',
    '                        const triggerLabel = nameTriggerMatched ? "name/tag" : "selected-user";',
    '                        setBurnRuntimeStatus({ nickname: selfHandle, lastAttempt: `${triggerLabel} detected from @${displayName.replace(/^@+/, "")}` });',
    '                        void maybeHandleAutoBurn({',
    '                            target: displayName.replace(/^@+/, ""),',
    '                            message: plainOriginal,',
    '                            from: username,',
    '                            trigger: nameTriggerMatched ? "name/tag" : "selected-user"',
    '                        });',
    '                    }',
    '                }'
  ].join("\n");
  source = replaceOnce(source, oldRefresh, newRefresh, "refresh selected-user trigger");

  fs.writeFileSync(sourcePath, source);
  console.log("Patched userscript for selected-user automatic replies.");
}

let versionTest = fs.readFileSync(versionTestPath, "utf8");
versionTest = versionTest.replace(
  'test("Tampermonkey metadata advertises v1.12.1 with scalable Curated memory and Burn Bot controls", () => {\n  assert.match(source, /^\\/\\/ @version\\s+1\\.12\\.1$/m);',
  'test("Tampermonkey metadata advertises v1.12.2 with scalable Curated memory and selected-user Burn Bot controls", () => {\n  assert.match(source, /^\\/\\/ @version\\s+1\\.12\\.2$/m);'
);
if (!versionTest.includes("1\\.12\\.2")) throw new Error("Version test patch failed");
fs.writeFileSync(versionTestPath, versionTest);

let masterTest = fs.readFileSync(masterTestPath, "utf8");
masterTest = masterTest.replace(
  /if \\!settings\\\.burnMasterEnabled \\|\\| \\!settings\\\.autoBurnEnabled\\\) return;/g,
  "if \\(!settings\\.burnMasterEnabled \\|\\| !automaticBurnTriggersEnabled\\(\\)\\) return;"
);
masterTest = masterTest.replace(
  /if \\!settings\\\.burnMasterEnabled \\|\\| \\!settings\\\.autoBurnEnabled\\\)/g,
  "if \\(!settings\\.burnMasterEnabled \\|\\| !automaticBurnTriggersEnabled\\(\\)\\)"
);
fs.writeFileSync(masterTestPath, masterTest);

let delayTest = fs.readFileSync(delayTestPath, "utf8");
delayTest = delayTest.replace(
  'assert.match(block, /if \\(!settings\\.burnMasterEnabled \\|\\| !settings\\.autoBurnEnabled\\)/);',
  'assert.match(block, /if \\(!settings\\.burnMasterEnabled \\|\\| !automaticBurnTriggersEnabled\\(\\)\\)/);'
);
fs.writeFileSync(delayTestPath, delayTest);
