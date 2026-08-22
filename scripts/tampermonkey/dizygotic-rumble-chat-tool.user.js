// ==UserScript==
// @name         Dizygotic Rumble Chat Tool
// @namespace    http://tampermonkey.net/
// @version      1.8
// @description  All-in-one chat tool for Rumble: private dm chat, user blocker + keyword filter + highlights + compact mode + timestamps + notifications + autoscroll lock + collapse long messages + stats + transcript recorder/export + font controls + auto-burn + export/import + auto-backup. Non-flashing, persistent, draggable settings panel.
// @author       Dizygotic
// @match        https://rumble.com/*
// @require      https://unpkg.com/compromise@14.7.0/builds/compromise.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/rita/2.0.2/rita.min.js
// @grant        GM_download
// ==/UserScript==

(function () {
    "use strict";

    /***********************
     * Storage keys & load *
     ***********************/
    const STORAGE_KEY = "rumbleBlockedUsers";
    const SETTINGS_KEY = "rumbleBlockerSettings";
    const BACKUP_KEY = "rumbleLastBackup";
    const BTN_POS_KEY = "rumbleBlockerBtnPos";
    const CHAT_LOG_KEY = "rumbleChatTranscriptLogV1";
    const CHAT_LOG_LIMIT = 20000;

    let blockedUsers = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    let settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    let chatLog = JSON.parse(localStorage.getItem(CHAT_LOG_KEY) || "[]");
    if (!Array.isArray(chatLog)) chatLog = [];
    let chatSequence = chatLog.length ? Math.max(...chatLog.map((r) => Number(r.seq) || 0)) : 0;

    const defaultSettings = {
        previewLength: 50,
        autoBackupMinutes: 0,
        darkMode: false,
        blockedKeywords: [],
        keywordAction: "hide",
        highlightedUsers: [],
        highlightColor: "#ffeb3b",
        compactMode: false,
        showTimestamps: true,
        use24hTime: false,
        autoScrollLock: false,
        hideSystemMessages: false,
        collapseLength: 0,
        notifyOnHighlight: false,
        notifyOnKeyword: false,
        notificationSound: "",
        notificationVolume: 1,
        highlightNotificationSoundEnabled: false,
        myNickname: "",
        chatRecorderEnabled: true,
        chatFontFamily: "",
        chatFontSize: 0,
        chatTextMode: "default",
        chatTextColor: "#ffffff",
        chatMultiPalette: "#ff4d4d,#ffa64d,#ffff4d,#4dff88,#4dd2ff,#8c4dff,#ff4dd2",
        autoBurnEnabled: false,
        autoBurnCooldownSeconds: 45,
        autoBurnEngine: "builtin",
        burnEnginesEnabled: {
            builtin: true,
            compromise: true,
            rita: true,
            markov: true,
            custom: true
        },
        burnMarkovCorpus: ""
    };

    settings = Object.assign({}, defaultSettings, settings);
    settings.burnEnginesEnabled = Object.assign(
        {},
        defaultSettings.burnEnginesEnabled,
        settings.burnEnginesEnabled || {}
    );

    function saveBlocklist() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(blockedUsers));
    }

    function saveSettings() {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }

    let chatLogSaveTimer = null;
    function saveChatLog() {
        if (chatLogSaveTimer) { clearTimeout(chatLogSaveTimer); chatLogSaveTimer = null; }
        try {
            localStorage.setItem(CHAT_LOG_KEY, JSON.stringify(chatLog));
        } catch (err) {
            console.warn("Chat transcript storage full; trimming oldest records", err);
            chatLog = chatLog.slice(-Math.floor(CHAT_LOG_LIMIT / 2));
            try {
                localStorage.setItem(CHAT_LOG_KEY, JSON.stringify(chatLog));
            } catch (retryErr) {
                console.warn("Unable to persist chat transcript", retryErr);
            }
        }
    }

    function scheduleChatLogSave() {
        if (chatLogSaveTimer) return;
        chatLogSaveTimer = setTimeout(saveChatLog, 750);
    }

    function extractMentions(text) {
        const matches = (text || "").match(/@[A-Za-z0-9_.-]+/g) || [];
        return [...new Set(matches.map((m) => m.slice(1).toLowerCase()))];
    }

    function recordChatMessage(el, username, displayName, message) {
        if (!settings.chatRecorderEnabled || !el || el._chatLogged || !username) return;
        const clean = (message || "").replace(/\s+/g, " ").trim();
        if (!clean) return;
        el._chatLogged = true;
        const record = {
            seq: ++chatSequence,
            capturedAt: new Date().toISOString(),
            username,
            displayName,
            message: clean,
            mentions: extractMentions(clean),
            rawHtml: el._originalMessage || el.querySelector("div.js-chat-message.chat-history--message")?.innerHTML || "",
            rowClass: el.className || "",
            url: location.href,
            title: document.title
        };
        chatLog.push(record);
        if (chatLog.length > CHAT_LOG_LIMIT) chatLog.splice(0, chatLog.length - CHAT_LOG_LIMIT);
        scheduleChatLogSave();
    }

    function clearChatLog() {
        chatLog = [];
        chatSequence = 0;
        localStorage.removeItem(CHAT_LOG_KEY);
    }

    function csvEscape(value) {
        const text = value == null ? "" : String(value);
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }

    function exportChatLog(format = "json") {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        if (format === "csv") {
            const header = ["seq","capturedAt","username","displayName","message","mentions","rawHtml","rowClass","url","title"];
            const rows = chatLog.map((r) => [r.seq,r.capturedAt,r.username,r.displayName,r.message,(r.mentions||[]).join(" "),r.rawHtml||"",r.rowClass||"",r.url,r.title].map(csvEscape).join(","));
            triggerDownload(`dizygotic-rumble-chat-${stamp}.csv`, [header.join(","), ...rows].join("\n"), { prompt: true });
            return;
        }
        triggerDownload(`dizygotic-rumble-chat-${stamp}.json`, JSON.stringify(chatLog, null, 2), { prompt: true });
    }

    function escapeRegex(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    const burnEngineRecommendations = [
        { key: "builtin", label: "Built-in quips" },
        { key: "compromise", label: "compromise NLP" },
        { key: "rita", label: "RiTa creative" },
        { key: "markov", label: "Markov corpus" },
        { key: "custom", label: "Custom hook" }
    ];

    /***********************
     * Export / Import / Backup
     ***********************/
    function serializeData() {
        const data = { blockedUsers, settings };
        const serialized = JSON.stringify(data, null, 2);
        localStorage.setItem(BACKUP_KEY, JSON.stringify(data));
        return serialized;
    }

    function fallbackDownload(filename, blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => {
            try {
                URL.revokeObjectURL(url);
            } catch (cleanupErr) {
                console.warn("Failed to revoke download URL", cleanupErr);
            }
        }, 0);
    }

    function triggerDownload(filename, serialized, options = {}) {
        const silent = Boolean(options.silent);
        const prompt = options.prompt !== false;
        const blob = new Blob([serialized], { type: "application/json" });

        if (typeof GM_download === "function") {
            const url = URL.createObjectURL(blob);
            const cleanup = () => {
                try {
                    URL.revokeObjectURL(url);
                } catch (cleanupErr) {
                    console.warn("Failed to revoke download URL", cleanupErr);
                }
            };
            try {
                GM_download({
                    url,
                    name: filename,
                    saveAs: silent ? false : prompt,
                    onload: cleanup,
                    ontimeout: cleanup,
                    onerror: (err) => {
                        cleanup();
                        if (silent) {
                            console.warn("Silent download failed via GM_download", err);
                        } else {
                            console.warn("GM_download failed, falling back to anchor download", err);
                            fallbackDownload(filename, blob);
                        }
                    }
                });
                return;
            } catch (err) {
                cleanup();
                if (silent) {
                    console.warn("Silent GM_download threw", err);
                } else {
                    console.warn("GM_download threw, falling back to anchor download", err);
                    fallbackDownload(filename, blob);
                }
                return;
            }
        }

        if (silent) {
            console.warn("Silent export requested but GM_download is unavailable; skipping download UI");
            return;
        }

        fallbackDownload(filename, blob);
    }

    function exportData(filename = "dizygotic-rumble-chat-tool-settings.json", options = {}) {
        const serialized = serializeData();
        triggerDownload(filename, serialized, options);
        return serialized;
    }

    function importData(file, callback) {
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const data = JSON.parse(e.target.result);
                if (data.blockedUsers && data.settings) {
                    blockedUsers = data.blockedUsers;
                    settings = Object.assign({}, defaultSettings, data.settings);
                    saveBlocklist();
                    saveSettings();
                    if (audio) {
                        audio.src = settings.notificationSound || "";
                        audio.volume = typeof settings.notificationVolume === "number" ? settings.notificationVolume : 1;
                    }
                    alert("✅ Import successful! Blocklist & settings restored.");
                    refreshBlockedMessages();
                    if (callback) callback(true);
                } else {
                    alert("⚠️ Invalid file format.");
                    if (callback) callback(false);
                }
            } catch (err) {
                console.error(err);
                alert("⚠️ Failed to parse file.");
                if (callback) callback(false);
            }
        };
        reader.readAsText(file);
    }

    let backupIntervalId = null;
    function setupAutoBackup() {
        if (backupIntervalId) clearInterval(backupIntervalId);
        if (settings.autoBackupMinutes > 0) {
            backupIntervalId = setInterval(() => {
                const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                exportData(`dizygotic-rumble-chat-tool-settings-backup-${timestamp}.json`, {
                    silent: true,
                    prompt: false
                });
                console.log("💾 Auto-backup created");
            }, settings.autoBackupMinutes * 60 * 1000);
        }
    }

    /***********************
     * Notifications
     ***********************/
    let audio;

    function initAudio() {
        if (audio) return;
        audio = new Audio();
        if (document.body) {
            document.body.appendChild(audio);
        } else {
            window.addEventListener("DOMContentLoaded", () => document.body.appendChild(audio));
        }
        if (settings.notificationSound) {
            audio.src = settings.notificationSound;
        }
        audio.volume = typeof settings.notificationVolume === "number" ? settings.notificationVolume : 1;
    }

    function triggerNotification(title, body) {
        try {
            if (Notification && Notification.permission === "granted") {
                new Notification(title, { body });
            } else if (Notification && Notification.permission !== "denied") {
                Notification.requestPermission().then((p) => {
                    if (p === "granted") new Notification(title, { body });
                });
            }
        } catch (e) {
            /* ignore */
        }
    }

    function maybeNotify(type, username, snippet) {
        initAudio();

        if (type === "highlight") {
            if (settings.notifyOnHighlight) {
                triggerNotification(`Highlight: ${username}`, snippet);
            }

            if (
                settings.highlightNotificationSoundEnabled &&
                settings.notificationSound &&
                audio &&
                audio.src
            ) {
                try {
                    audio.currentTime = 0;
                    audio.play().catch(() => {});
                } catch (err) {
                    console.warn("Highlight sound failed:", err);
                }
            }
        } else if (type === "keyword") {
            if (settings.notifyOnKeyword) {
                triggerNotification(`Keyword matched`, snippet);
            }
        }
    }

    /***********************
     * UI helpers
     ***********************/
    function applyThemeToPanel(panel) {
        panel.style.background = settings.darkMode ? "#131313" : "#fff";
        panel.style.color = settings.darkMode ? "#eaeaea" : "#000";
        panel.querySelectorAll("input, textarea, select").forEach((el) => {
            el.style.background = settings.darkMode ? "#202020" : "#fff";
            el.style.color = settings.darkMode ? "#eaeaea" : "#000";
            el.style.border = `1px solid ${settings.darkMode ? "#333" : "#ccc"}`;
        });
        panel.querySelectorAll("button").forEach((btn) => {
            btn.style.background = settings.darkMode ? "#2f2f2f" : "#f5f5f5";
            btn.style.color = settings.darkMode ? "#fff" : "#000";
        });
    }

    /***********************
     * Settings panel
     ***********************/
    function showSettingsPanel() {
        const existing = document.querySelector("#rumbleBlockerSettingsPanel");
        if (existing) return;

        const panel = document.createElement("div");
        panel.id = "rumbleBlockerSettingsPanel";
        panel.style.position = "fixed";
        panel.style.top = "50%";
        panel.style.left = "50%";
        panel.style.transform = "translate(-50%,-50%) scale(0.98)";
        panel.style.zIndex = 100000;
        panel.style.width = "520px";
        panel.style.maxHeight = "80vh";
        panel.style.overflowY = "auto";
        panel.style.padding = "18px";
        panel.style.boxShadow = "0 8px 40px rgba(0,0,0,0.5)";
        panel.style.borderRadius = "10px";
        panel.style.border = "1px solid rgba(0,0,0,0.12)";
        panel.style.transition = "all 0.18s ease";

        panel.innerHTML = `
            <h3 style="margin:0 0 8px 0">⚙️ Dizygotic Rumble Chat Tool Settings </h3>

            <div style="font-size:13px;line-height:1.4">
            <b>Blocked Users</b><br>
            <textarea id="blockedUsersInput" style="width:100%;height:60px;margin-top:6px">${blockedUsers.join(", ")}</textarea>
            <div style="height:10px"></div>

            <b>Keyword Blocking</b>
            <div style="font-size:12px;color:gray;margin-bottom:6px">Comma-separated keywords. Messages containing them will be handled per action.</div>
            <textarea id="blockedKeywordsInput" style="width:100%;height:50px">${settings.blockedKeywords.join(", ")}</textarea>
            <div style="display:flex;gap:10px;align-items:center;margin-top:6px">
                <label><input type="radio" name="keywordAction" value="hide" id="keywordActionHide"> Hide message</label>
                <label><input type="radio" name="keywordAction" value="mask" id="keywordActionMask"> Mask words</label>
            </div>
            <div style="height:12px"></div>

            <b>Highlighted Users</b>
            <div style="font-size:12px;color:gray;margin-bottom:6px">Comma-separated usernames to highlight.</div>
            <textarea id="highlightedUsersInput" style="width:100%;height:50px">${settings.highlightedUsers.join(", ")}</textarea>
            <div style="display:flex;gap:10px;align-items:center;margin-top:6px">
                <label>Highlight color: <input type="color" id="highlightColorInput" value="${settings.highlightColor}"></label>
                <label style="margin-left:auto"><input type="checkbox" id="notifyOnHighlightInput"${settings.notifyOnHighlight ? " checked" : ""}> Notify on highlight</label>
                <label><input type="checkbox" id="highlightSoundInput"${settings.highlightNotificationSoundEnabled ? " checked" : ""}> Enable sound on highlight</label>
            </div>
            <div style="height:12px"></div>
            <b>Display & Behavior</b>
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:6px">
                <label><input type="checkbox" id="compactModeInput"${settings.compactMode ? " checked" : ""}> Compact mode</label>
                <label><input type="checkbox" id="showTimestampsInput"${settings.showTimestamps ? " checked" : ""}> Show timestamps</label>
                <label><input type="checkbox" id="use24hTimeInput"${settings.use24hTime ? " checked" : ""}> 24h time</label>
                <label><input type="checkbox" id="autoScrollLockInput"${settings.autoScrollLock ? " checked" : ""}> Lock autoscroll</label>
                <label><input type="checkbox" id="hideSystemMessagesInput"${settings.hideSystemMessages ? " checked" : ""}> Hide system messages</label>
            </div>
            <div style="height:12px"></div>

            <b>Chat font & colour</b>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px">
                <label>Family</label>
                <input id="chatFontFamilyInput" list="dizyFontList" value="${String(settings.chatFontFamily || "").replace(/"/g, "&quot;")}" placeholder="Rumble default / any installed font" style="min-width:240px;flex:1">
                <datalist id="dizyFontList">
                    ${["Arial","Arial Black","Bahnschrift","Calibri","Cambria","Candara","Comic Sans MS","Consolas","Courier New","Franklin Gothic Medium","Garamond","Georgia","Impact","Lucida Console","Microsoft Sans Serif","Palatino Linotype","Segoe UI","Tahoma","Times New Roman","Trebuchet MS","Verdana","monospace","sans-serif","serif"].map((f) => `<option value="${f}"></option>`).join("")}
                </datalist>
                <button type="button" id="loadInstalledFontsBtn">Load installed fonts</button>
                <label>Size px</label>
                <input type="number" id="chatFontSizeInput" min="0" max="72" value="${settings.chatFontSize || 0}" style="width:70px">
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px">
                <label>Text style</label>
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
            <div style="font-size:12px;color:gray;margin-top:3px">0 = Rumble default size. Font accepts any installed family. Character colours are rendered by this userscript. Raw message HTML/classes are recorded so genuine server-side Rumble formatting can be identified if it appears.</div>
            <div style="height:12px"></div>

            <b>Passive chat recorder</b>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:6px">
                <label><input type="checkbox" id="chatRecorderEnabledInput"${settings.chatRecorderEnabled ? " checked" : ""}> Record public chat locally</label>
                <span style="font-size:12px;color:gray">${chatLog.length} saved messages</span>
            </div>
            <div style="height:12px"></div>

            <b>Auto-burn bot</b>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px">
                <label><input type="checkbox" id="autoBurnToggle"${settings.autoBurnEnabled ? " checked" : ""}> Reply when someone tags me</label>
                <label>Cooldown</label>
                <input type="number" id="autoBurnCooldownInput" min="5" value="${settings.autoBurnCooldownSeconds}" style="width:70px">
                <label>Preferred engine</label>
                <select id="autoBurnEngineSelect">${burnEngineRecommendations.map((r) => `<option value="${r.key}"${settings.autoBurnEngine === r.key ? " selected" : ""}>${r.label}</option>`).join("")}</select>
            </div>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:7px;font-size:12px">
                ${burnEngineRecommendations.map((r) => `<label><input type="checkbox" data-burn-engine-toggle="${r.key}"${settings.burnEnginesEnabled?.[r.key] !== false ? " checked" : ""}> ${r.label}</label>`).join("")}
            </div>
            <div style="font-size:12px;color:gray;margin-top:4px">Compromise and RiTa are loaded by Tampermonkey via @require. Markov uses a local word-chain generator so a CDN package change cannot kill the whole userscript.</div>
            <textarea id="burnMarkovCorpusInput" placeholder="Optional Markov corpus — one burn/example per line" style="width:100%;height:58px;margin-top:6px">${settings.burnMarkovCorpus || ""}</textarea>
            <div style="height:12px"></div>

            <b>Collapse long messages</b>
            <div style="font-size:12px;color:gray;margin-bottom:6px">Collapse messages longer than X characters (0 = off).</div>
            <input type="number" id="collapseLengthInput" value="${settings.collapseLength}" style="width:100px">

            <div style="height:12px"></div>

            <div style="display:flex;flex-direction:column;gap:6px">
                <div style="display:flex;flex-direction:column;align-items:flex-start;gap:4px">
                    <b>Sound Settings</b>
                    <label>Sound: <input type="file" id="notificationSoundInput" accept="audio/*"></label>
                    <div style="display:flex;align-items:center;gap:10px;margin-top:4px;width:100%">
                        <label for="notificationVolumeInput" style="font-size:12px;color:gray">Volume</label>
                        <input type="range" id="notificationVolumeInput" min="0" max="100" value="${Math.round((settings.notificationVolume ?? 1) * 100)}" style="flex:1">
                        <span id="notificationVolumeValue" style="min-width:32px;text-align:right;font-size:12px;color:gray">${Math.round((settings.notificationVolume ?? 1) * 100)}%</span>
                    </div>
                </div>
                <b>Keyword Notifications</b>
                <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
                    <label><input type="checkbox" id="notifyOnKeywordInput"${settings.notifyOnKeyword ? " checked" : ""}> Notify on keyword match</label>
                </div>
            </div>

            <div style="height:14px"></div>

            <b>Backup & Sync</b>
            <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
                <label>Auto-backup minutes (0 = off)</label>
                <input type="number" id="autoBackupInput" value="${settings.autoBackupMinutes}" style="width:80px;margin-left:auto">
            </div>

            <div style="height:14px"></div>

            <b>Other</b>
            <div style="margin-top:6px;font-size:13px">
              <label><input type="checkbox" id="darkModeInput"${settings.darkMode ? " checked" : ""}> Dark mode</label>
            </div>

            <div style="height:14px"></div>

            <div id="statsSummary" style="font-size:13px;color:gray;margin-bottom:8px"></div>
            </div>
        `;

        applyThemeToPanel(panel);

        const loadInstalledFontsBtn = panel.querySelector("#loadInstalledFontsBtn");
        if (loadInstalledFontsBtn) {
            loadInstalledFontsBtn.addEventListener("click", async () => {
                if (typeof window.queryLocalFonts !== "function") {
                    alert("This browser does not expose the Local Font Access API. Type any installed font name into the Family box instead.");
                    return;
                }
                try {
                    const fonts = await window.queryLocalFonts();
                    const list = panel.querySelector("#dizyFontList");
                    const families = [...new Set(fonts.map((f) => f.family).filter(Boolean))].sort((a, b) => a.localeCompare(b));
                    if (list) {
                        const existing = new Set([...list.querySelectorAll("option")].map((o) => o.value));
                        families.forEach((family) => {
                            if (existing.has(family)) return;
                            const option = document.createElement("option");
                            option.value = family;
                            list.appendChild(option);
                        });
                    }
                    alert(`Loaded ${families.length} installed font families.`);
                } catch (err) {
                    console.warn("Unable to enumerate local fonts", err);
                    alert("Font permission was denied or unavailable. You can still type a font family manually.");
                }
            });
        }

        panel.querySelector("#keywordActionHide").checked = settings.keywordAction === "hide";
        panel.querySelector("#keywordActionMask").checked = settings.keywordAction === "mask";

        function createAccentButton(text, onClick, bgColor, icon = "") {
            const btn = document.createElement("button");
            btn.innerHTML = icon ? `${icon} ${text}` : text;
            btn.style.margin = "4px";
            btn.style.padding = "8px 14px";
            btn.style.border = "none";
            btn.style.borderRadius = "6px";
            btn.style.cursor = "pointer";
            btn.style.fontSize = "13px";
            btn.style.fontWeight = "600";
            btn.style.transition = "all 0.18s ease";
            btn.style.boxShadow = "0 2px 6px rgba(0,0,0,0.15)";
            btn.style.background = bgColor || (settings.darkMode ? "#444" : "#f5f5f5");
            btn.style.color = "#fff";
            btn.addEventListener("click", onClick);
            btn.addEventListener("mouseover", () => (btn.style.transform = "scale(1.03)"));
            btn.addEventListener("mouseout", () => (btn.style.transform = ""));
            return btn;
        }

        function savePanelSettings() {
            blockedUsers = panel
                .querySelector("#blockedUsersInput")
                .value.split(",")
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean);
            settings.blockedKeywords = panel
                .querySelector("#blockedKeywordsInput")
                .value.split(",")
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean);
            settings.keywordAction = panel.querySelector("#keywordActionMask").checked ? "mask" : "hide";
            settings.highlightedUsers = panel
                .querySelector("#highlightedUsersInput")
                .value.split(",")
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean);
            settings.highlightColor = panel.querySelector("#highlightColorInput").value || settings.highlightColor;
            settings.compactMode = !!panel.querySelector("#compactModeInput").checked;
            settings.showTimestamps = !!panel.querySelector("#showTimestampsInput").checked;
            settings.use24hTime = !!panel.querySelector("#use24hTimeInput").checked;
            settings.autoScrollLock = !!panel.querySelector("#autoScrollLockInput").checked;
            settings.hideSystemMessages = !!panel.querySelector("#hideSystemMessagesInput").checked;
            settings.collapseLength = parseInt(panel.querySelector("#collapseLengthInput").value, 10) || 0;
            settings.notifyOnKeyword = !!panel.querySelector("#notifyOnKeywordInput").checked;
            settings.notifyOnHighlight = !!panel.querySelector("#notifyOnHighlightInput").checked;
            settings.highlightNotificationSoundEnabled = !!panel.querySelector("#highlightSoundInput").checked;
            settings.chatRecorderEnabled = !!panel.querySelector("#chatRecorderEnabledInput")?.checked;
            settings.chatFontFamily = panel.querySelector("#chatFontFamilyInput")?.value?.trim() || "";
            settings.chatFontSize = Math.max(0, Math.min(72, parseInt(panel.querySelector("#chatFontSizeInput")?.value, 10) || 0));
            settings.chatTextMode = panel.querySelector("#chatTextModeInput")?.value || "default";
            settings.chatTextColor = panel.querySelector("#chatTextColorInput")?.value || "#ffffff";
            settings.chatMultiPalette = panel.querySelector("#chatMultiPaletteInput")?.value?.trim() || defaultSettings.chatMultiPalette;
            settings.autoBurnEnabled = !!panel.querySelector("#autoBurnToggle")?.checked;
            settings.autoBurnCooldownSeconds = Math.max(5, parseInt(panel.querySelector("#autoBurnCooldownInput")?.value, 10) || 45);
            settings.autoBurnEngine = panel.querySelector("#autoBurnEngineSelect")?.value || "builtin";
            settings.burnEnginesEnabled = Object.assign({}, defaultSettings.burnEnginesEnabled);
            panel.querySelectorAll("[data-burn-engine-toggle]").forEach((input) => {
                settings.burnEnginesEnabled[input.dataset.burnEngineToggle] = !!input.checked;
            });
            settings.burnMarkovCorpus = panel.querySelector("#burnMarkovCorpusInput")?.value || "";
            const volumeSlider = panel.querySelector("#notificationVolumeInput");
            const parsedVolume = volumeSlider ? parseInt(volumeSlider.value, 10) : NaN;
            const normalizedVolume = Number.isFinite(parsedVolume)
                ? Math.min(100, Math.max(0, parsedVolume)) / 100
                : typeof settings.notificationVolume === "number"
                ? settings.notificationVolume
                : 1;
            settings.notificationVolume = normalizedVolume;
            settings.autoBackupMinutes = parseInt(panel.querySelector("#autoBackupInput").value, 10) || 0;
            settings.darkMode = !!panel.querySelector("#darkModeInput").checked;

            saveBlocklist();
            saveSettings();
            setupAutoBackup();
            if (audio) {
                audio.volume = settings.notificationVolume;
            }

            const soundFileInput = panel.querySelector("#notificationSoundInput");
            if (soundFileInput && soundFileInput.files && soundFileInput.files[0]) {
                const f = soundFileInput.files[0];
                const reader = new FileReader();
                reader.onload = function (ev) {
                    settings.notificationSound = ev.target.result;
                    initAudio();
                    audio.src = settings.notificationSound;
                    audio.volume = settings.notificationVolume;
                    saveSettings();
                    alert("✅ Settings saved (and sound saved).");
                    refreshBlockedMessages();
                };
                reader.readAsDataURL(f);
            } else {
                alert("✅ Settings saved.");
                refreshBlockedMessages();
            }

            panel.style.opacity = "0";
            setTimeout(() => panel.remove(), 180);
        }

        function clearAllSettings() {
            if (!confirm("Clear blocklist & reset settings to defaults?")) return;
            blockedUsers = [];
            settings = Object.assign({}, defaultSettings);
            if (audio) audio.src = "";
            saveBlocklist();
            saveSettings();
            setupAutoBackup();
            refreshBlockedMessages();
            panel.style.opacity = "0";
            setTimeout(() => panel.remove(), 180);
        }

        const buttonRow = document.createElement("div");
        buttonRow.style.display = "flex";
        buttonRow.style.gap = "6px";
        buttonRow.style.justifyContent = "flex-end";
        buttonRow.style.flexWrap = "wrap";

        buttonRow.appendChild(createAccentButton("Save", () => savePanelSettings(), "#4caf50", "💾"));
        buttonRow.appendChild(createAccentButton("Clear All", () => clearAllSettings(), "#f44336", "🗑️"));
        buttonRow.appendChild(createAccentButton("Export", () => exportData(), "#2196f3", "📤"));
        buttonRow.appendChild(createAccentButton("Chat JSON", () => exportChatLog("json"), "#673ab7", "🧾"));
        buttonRow.appendChild(createAccentButton("Chat CSV", () => exportChatLog("csv"), "#3f51b5", "📊"));
        buttonRow.appendChild(createAccentButton("Clear Chat Log", () => { if (confirm("Clear saved local chat transcript?")) { clearChatLog(); alert("✅ Chat transcript cleared."); } }, "#795548", "🧹"));
        buttonRow.appendChild(
            createAccentButton(
                "Import",
                () => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = ".json";
                    input.onchange = (e) => {
                        const file = e.target.files[0];
                        if (file) importData(file, () => panel.remove());
                    };
                    input.click();
                },
                "#ff9800",
                "📥"
            )
        );
        buttonRow.appendChild(
            createAccentButton(
                "Close",
                () => {
                    panel.style.opacity = "0";
                    setTimeout(() => panel.remove(), 180);
                },
                "#9e9e9e",
                "❌"
            )
        );

        panel.appendChild(buttonRow);

        const volumeSliderEl = panel.querySelector("#notificationVolumeInput");
        const volumeValueEl = panel.querySelector("#notificationVolumeValue");
        if (volumeSliderEl && volumeValueEl) {
            const syncVolumeDisplay = () => {
                const sliderValue = Math.min(100, Math.max(0, parseInt(volumeSliderEl.value, 10) || 0));
                volumeSliderEl.value = sliderValue;
                volumeValueEl.textContent = `${sliderValue}%`;
                if (audio) {
                    audio.volume = sliderValue / 100;
                }
            };
            volumeSliderEl.addEventListener("input", syncVolumeDisplay);
            syncVolumeDisplay();
        }

        const stats = panel.querySelector("#statsSummary");
        stats.innerText = `Blocked users: ${blockedUsers.length} · Keywords: ${settings.blockedKeywords.length} · Highlighted: ${settings.highlightedUsers.length} · Logged chat: ${chatLog.length}`;

        document.body.appendChild(panel);
        setTimeout(() => {
            panel.style.opacity = "1";
            panel.style.transform = "translate(-50%,-50%) scale(1)";
        }, 10);
    }

    /***********************
     * Floating settings button
     ***********************/
    function addFloatingSettingsButton() {
        if (document.querySelector("#floatingBlockerSettingsBtn")) return;

        const savedPos = JSON.parse(localStorage.getItem(BTN_POS_KEY) || "{}");
        const btn = document.createElement("button");
        btn.id = "floatingBlockerSettingsBtn";
        btn.textContent = "⚙️ Chat Settings";
        btn.style.position = "fixed";
        btn.style.top = savedPos.top || "10px";
        btn.style.left = savedPos.left || "10px";
        btn.style.zIndex = 100000;
        btn.style.background = settings.darkMode ? "#444" : "#ffe680";
        btn.style.color = settings.darkMode ? "#fff" : "#000";
        btn.style.fontWeight = "600";
        btn.style.cursor = "move";
        btn.style.padding = "8px 14px";
        btn.style.border = "none";
        btn.style.borderRadius = "8px";
        btn.style.boxShadow = "0 6px 18px rgba(0,0,0,0.2)";
        btn.style.transition = "all 0.12s ease";

        document.body.appendChild(btn);

        let isDragging = false;
        let offsetX = 0;
        let offsetY = 0;
        let hasMoved = false;

        btn.addEventListener("mousedown", (e) => {
            isDragging = true;
            offsetX = e.clientX - btn.getBoundingClientRect().left;
            offsetY = e.clientY - btn.getBoundingClientRect().top;
            hasMoved = false;
            btn.style.transition = "none";
            e.preventDefault();
        });

        document.addEventListener("mousemove", (e) => {
            if (!isDragging) return;
            hasMoved = true;
            btn.style.left = `${e.clientX - offsetX}px`;
            btn.style.top = `${e.clientY - offsetY}px`;
        });

        document.addEventListener("mouseup", () => {
            if (!isDragging) return;
            isDragging = false;
            localStorage.setItem(
                BTN_POS_KEY,
                JSON.stringify({ top: btn.style.top, left: btn.style.left })
            );
            setTimeout(() => (btn.style.transition = "all 0.12s ease"), 10);
        });

        btn.addEventListener("click", () => {
            if (!hasMoved) showSettingsPanel();
        });
    }

    function ensureFloatingSettingsButton() {
        addFloatingSettingsButton();
        setInterval(() => {
            if (!document.getElementById("floatingBlockerSettingsBtn")) {
                console.warn("⚠️ Floating settings button missing — restoring...");
                addFloatingSettingsButton();
            }
        }, 5000);
    }

    /***********************
     * Helpers
     ***********************/
    function formatTime(date) {
        if (settings.use24hTime) {
            const hh = String(date.getHours()).padStart(2, "0");
            const mm = String(date.getMinutes()).padStart(2, "0");
            return `${hh}:${mm}`;
        }
        let hh = date.getHours();
        const mm = String(date.getMinutes()).padStart(2, "0");
        const ampm = hh >= 12 ? "PM" : "AM";
        hh = hh % 12 || 12;
        return `${hh}:${mm} ${ampm}`;
    }

    function applyHighlightColor(baseColor, alpha = 0.25) {
        if (baseColor.startsWith("#")) {
            let hex = baseColor.slice(1);
            if (hex.length === 3) hex = hex.split("").map((h) => h + h).join("");
            const bigint = parseInt(hex, 16);
            const r = (bigint >> 16) & 255;
            const g = (bigint >> 8) & 255;
            const b = bigint & 255;
            return {
                rgba: `rgba(${r}, ${g}, ${b}, ${alpha})`,
                rgb: [r, g, b],
                border: `rgba(${r}, ${g}, ${b}, 0.6)`,
                glow: `0 0 10px rgba(${r}, ${g}, ${b}, 0.7)`
            };
        }
        return {
            rgba: baseColor,
            rgb: [255, 255, 255],
            border: baseColor,
            glow: `0 0 10px ${baseColor}`
        };
    }

    function getContrastTextColor([r, g, b]) {
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance > 0.6 ? "#000000" : "#ffffff";
    }

    function parseColourPalette(value) {
        const colours = String(value || "")
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean);
        return colours.length ? colours : ["#ff4d4d", "#ffa64d", "#ffff4d", "#4dff88", "#4dd2ff", "#8c4dff", "#ff4dd2"];
    }

    function colourizeTextNode(node, mode, palette, state) {
        if (!node || !node.nodeValue) return;
        const text = node.nodeValue;
        const frag = document.createDocumentFragment();
        [...text].forEach((char) => {
            if (/\s/.test(char)) {
                frag.appendChild(document.createTextNode(char));
                return;
            }
            const span = document.createElement("span");
            span.className = "dizy-chat-char-colour";
            span.textContent = char;
            span.style.color = mode === "rainbow"
                ? `hsl(${(state.index * 41) % 360} 100% 62%)`
                : palette[state.index % palette.length];
            state.index += 1;
            frag.appendChild(span);
        });
        node.parentNode.replaceChild(frag, node);
    }

    function applyPerCharacterColour(msgEl, mode) {
        if (!msgEl || (mode !== "rainbow" && mode !== "multi")) return;
        const palette = parseColourPalette(settings.chatMultiPalette);
        const walker = document.createTreeWalker(msgEl, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                const parent = node.parentElement;
                if (!parent) return NodeFilter.FILTER_REJECT;
                if (parent.closest(".dizy-chat-char-colour")) return NodeFilter.FILTER_REJECT;
                if (parent.closest("script,style")) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        const state = { index: 0 };
        nodes.forEach((node) => colourizeTextNode(node, mode, palette, state));
    }

    function applyConfiguredChatTextStyle(msgEl, isBlocked, isCollapsed) {
        if (!msgEl || isBlocked || isCollapsed) return;
        const mode = settings.chatTextMode || "default";
        if (mode === "single") {
            msgEl.style.color = settings.chatTextColor || "#ffffff";
        } else if (mode === "rainbow" || mode === "multi") {
            msgEl.style.color = "";
            applyPerCharacterColour(msgEl, mode);
        }
    }

    function simpleMarkovGenerate(lines) {
        const corpus = (Array.isArray(lines) ? lines : [])
            .map((line) => String(line || "").replace(/\s+/g, " ").trim())
            .filter(Boolean);
        if (!corpus.length) return null;
        const transitions = new Map();
        const starts = [];
        corpus.forEach((line) => {
            const words = line.split(" ");
            if (!words.length) return;
            starts.push(words[0]);
            for (let i = 0; i < words.length - 1; i += 1) {
                const key = words[i].toLowerCase();
                if (!transitions.has(key)) transitions.set(key, []);
                transitions.get(key).push(words[i + 1]);
            }
        });
        let word = starts[Math.floor(Math.random() * starts.length)];
        const out = [word];
        while (out.length < 18) {
            const next = transitions.get(String(word).toLowerCase());
            if (!next || !next.length) break;
            word = next[Math.floor(Math.random() * next.length)];
            out.push(word);
            if (/[.!?]$/.test(word) && out.length >= 5) break;
        }
        return out.join(" ");
    }

    /***********************
     * Auto-burn bot helpers
     ***********************/
    const builtInBurns = [
        ({ target }) => `@${target} you just pinged the wrong dojo.`,
        ({ target }) => `@${target} that's a bold take for someone typing with mittens.`,
        ({ target }) => `@${target} you rang? I brought receipts and a thesaurus.`,
        ({ target }) => `@${target} touch grass, clear cache, try again.`,
        ({ target }) => `@${target} noted. Filing under 'draft tweets'.`
    ];
    let lastBurnTimestamp = 0;

    function findChatComposer() {
        const selectors = [
            "textarea.chat-input", "textarea.chat-textarea", "textarea.chat-input__textarea",
            "textarea#chat-message-text", "textarea[name='chat']", "textarea[data-role='chat-input']",
            "textarea[data-qa='live-chat-input']", "input.chat-input", "input[name='chat']",
            "div[contenteditable='true'][data-placeholder*='message' i]",
            "div[contenteditable='true'][aria-label*='message' i]"
        ];
        for (const selector of selectors) { const el = document.querySelector(selector); if (el) return el; }
        return null;
    }

    function findSendButton() {
        const selectors = [
            "button.chat-send", "button.send-message", "button[type='submit'][aria-label*='send' i]",
            "button[aria-label='Send message']", "button[aria-label='Send']", "button.chat__send", "button[data-role='send-button']"
        ];
        for (const selector of selectors) { const btn = document.querySelector(selector); if (btn) return btn; }
        return null;
    }

    function setComposerValue(composer, value) {
        if (!composer) return;
        composer.focus();
        if ("value" in composer) {
            const proto = composer.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
            if (setter) setter.call(composer, value); else composer.value = value;
        } else if (composer.isContentEditable) {
            composer.textContent = value;
        }
        composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
        composer.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function sendChatMessage(message) {
        const composer = findChatComposer();
        if (!composer) return false;
        setComposerValue(composer, message);
        const btn = findSendButton();
        if (btn) { btn.click(); return true; }
        composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
        return true;
    }

    function generateBurnResponse(ctx) {
        const normalizedCtx = {
            target: ctx.target || "there",
            message: (ctx.message || "").replace(/\s+/g, " ").trim().slice(0, 110),
            snippet: (ctx.message || "").replace(/\s+/g, " ").trim().slice(0, 110)
        };
        const enabled = Object.assign({}, defaultSettings.burnEnginesEnabled, settings.burnEnginesEnabled || {});
        const preferred = settings.autoBurnEngine || "builtin";
        const engineOrder = [preferred, "custom", "compromise", "rita", "markov", "builtin"]
            .filter((key, index, arr) => arr.indexOf(key) === index && enabled[key] !== false);

        const custom = window.rumbleBlocker?.customBurnGenerator;
        const tryCustom = () => {
            if (typeof custom !== "function") return null;
            try { return custom(normalizedCtx) || null; } catch (err) { console.warn("Custom burn generator threw", err); return null; }
        };

        for (const engine of engineOrder) {
            if (engine === "custom") {
                const result = tryCustom();
                if (result) return String(result);
            }
            if (engine === "compromise") {
                const nlpLib = typeof nlp !== "undefined" ? nlp : window.nlp;
                if (nlpLib) {
                    try {
                        const doc = nlpLib(normalizedCtx.message);
                        const verb = doc.verbs().toInfinitive().out("array")[0] || "ping";
                        const noun = doc.nouns().out("array")[0] || "take";
                        return `@${normalizedCtx.target} bold ${verb} on that ${noun}. Wanna run that again?`;
                    } catch (err) { console.warn("Compromise burn failed", err); }
                }
            }
            if (engine === "rita") {
                const ritaLib = typeof RiTa !== "undefined" ? RiTa : window.RiTa;
                if (ritaLib) {
                    try {
                        const lead = ritaLib.randomWord({ numSyllables: 1 });
                        const noun = ritaLib.randomWord({ pos: "nn" });
                        return `@${normalizedCtx.target} ${lead} ${noun} energy detected. Recompile your take.`;
                    } catch (err) { console.warn("RiTa burn failed", err); }
                }
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
                if (phrase) return `@${normalizedCtx.target} ${phrase}`;
            }
            if (engine === "builtin") {
                const template = builtInBurns[Math.floor(Math.random() * builtInBurns.length)];
                return template(normalizedCtx);
            }
        }
        return null;
    }

    function maybeHandleAutoBurn(ctx) {
        if (!settings.autoBurnEnabled) return;
        const now = Date.now();
        const cooldownMs = Math.max(5, settings.autoBurnCooldownSeconds || 45) * 1000;
        if (now - lastBurnTimestamp < cooldownMs) return;
        const response = generateBurnResponse(ctx);
        if (response && sendChatMessage(response)) lastBurnTimestamp = now;
    }

    /***********************
     * Core message refresh
     ***********************/
    function refreshBlockedMessages() {
        const chatContainer =
            document.querySelector(".chat-history") || document.querySelector(".chat-list") || null;

        let userScrolledAway = false;
        if (chatContainer && settings.autoScrollLock) {
            const nearBottom =
                chatContainer.scrollHeight - (chatContainer.scrollTop + chatContainer.clientHeight) < 40;
            userScrolledAway = !nearBottom;
        }

        const selfHandle = sanitizeNickname(detectMyNickname()) || "";
        const selfHandleLower = selfHandle.toLowerCase();

        document
            .querySelectorAll("li.chat-history--row.js-chat-history-item")
            .forEach((el) => {
                const usernameEl = el.querySelector("button.chat-history--username.js-user-tag");
                const msgEl = el.querySelector("div.js-chat-message.chat-history--message");
                if (!msgEl) return;

                if (!el._originalMessage) el._originalMessage = msgEl.innerHTML;
                if (el._revealed === undefined) el._revealed = false;
                if (el._initialized === undefined) el._initialized = false;
                if (el._autoBlocked === undefined) el._autoBlocked = false;
                if (el._collapsed === undefined) el._collapsed = false;
                if (el._collapseExpanded === undefined) el._collapseExpanded = false;

                const username = usernameEl ? usernameEl.innerText.trim().toLowerCase() : null;
                const displayName = usernameEl ? usernameEl.innerText.trim() : "user";

                const isSystem =
                    !usernameEl ||
                    el.classList.contains("system-message") ||
                    /system/i.test(msgEl.innerText);
                if (settings.hideSystemMessages && isSystem) {
                    if (el.style.display !== "none") el.style.display = "none";
                    return;
                }
                if (el.style.display === "none") el.style.display = "";

                const isHighlighted = username && settings.highlightedUsers.includes(username);
                if (isHighlighted) {
                    if (!el._highlightApplied) {
                        const { rgba, rgb, border, glow } = applyHighlightColor(
                            settings.highlightColor,
                            settings.darkMode ? 0.25 : 0.35
                        );
                        const textColor = getContrastTextColor(rgb);

                        el.style.opacity = "0";
                        el.style.background = rgba;
                        el.style.borderRadius = "12px";
                        el.style.border = `1px solid ${border}`;
                        el.style.color = textColor;
                        el.style.transition = "opacity 0.4s ease, box-shadow 0.3s ease, transform 0.2s ease";

                        el.querySelectorAll("*").forEach((child) => {
                            child.style.color = textColor;
                            if (child.tagName === "A") child.style.textDecoration = "underline";
                        });

                        requestAnimationFrame(() => {
                            el.style.opacity = "1";
                        });

                        el.addEventListener("mouseenter", () => {
                            el.style.boxShadow = glow;
                            el.style.transform = "scale(1.02)";
                        });
                        el.addEventListener("mouseleave", () => {
                            el.style.boxShadow = "";
                            el.style.transform = "scale(1)";
                        });

                        el._highlightApplied = true;
                    }
                } else if (el._highlightApplied) {
                    el.style.transition = "opacity 0.4s ease, box-shadow 0.3s ease, transform 0.2s ease";
                    el.style.opacity = "0";
                    el.style.boxShadow = "";
                    el.style.transform = "scale(1)";
                    setTimeout(() => {
                        el.style.background = "";
                        el.style.border = "";
                        el.style.borderRadius = "";
                        el.style.color = "";
                        el.querySelectorAll("*").forEach((child) => {
                            child.style.color = "";
                            if (child.tagName === "A") child.style.textDecoration = "";
                        });
                        el._highlightApplied = false;
                        el.style.opacity = "1";
                    }, 400);
                }

                if (settings.compactMode) {
                    if (!el._compactApplied) {
                        msgEl.style.padding = "2px 6px";
                        msgEl.style.lineHeight = "1.1";
                        msgEl.style.fontSize = "13px";
                        el._compactApplied = true;
                    }
                } else if (el._compactApplied) {
                    msgEl.style.padding = "";
                    msgEl.style.lineHeight = "";
                    msgEl.style.fontSize = "";
                    delete el._compactApplied;
                }

                const chosenFont = settings.chatFontFamily || "";
                const chosenSize = Number(settings.chatFontSize) || 0;
                el.style.fontFamily = chosenFont;
                msgEl.style.fontFamily = chosenFont;
                if (usernameEl) usernameEl.style.fontFamily = chosenFont;
                if (chosenSize > 0) {
                    msgEl.style.fontSize = `${chosenSize}px`;
                    if (usernameEl) usernameEl.style.fontSize = `${chosenSize}px`;
                } else if (!settings.compactMode) {
                    msgEl.style.fontSize = "";
                    if (usernameEl) usernameEl.style.fontSize = "";
                }

                if (settings.showTimestamps && usernameEl) {
                    if (!el._timestampApplied) {
                        const timeNode = document.createElement("span");
                        timeNode.className = "rumble-blocker-ts";
                        timeNode.style.marginLeft = "8px";
                        timeNode.style.fontSize = "11px";
                        timeNode.style.opacity = "0.6";
                        timeNode.style.verticalAlign = "middle";
                        timeNode.style.userSelect = "none";
                        timeNode.style.pointerEvents = "none";
                        timeNode.setAttribute("aria-hidden", "true");
                        timeNode.textContent = formatTime(new Date());
                        usernameEl.insertAdjacentElement("afterend", timeNode);
                        el._timestampNode = timeNode;
                        el._timestampApplied = true;
                    }
                } else if (el._timestampApplied && el._timestampNode) {
                    el._timestampNode.remove();
                    delete el._timestampApplied;
                    delete el._timestampNode;
                }

                const rawOriginal = el._originalMessage || msgEl.innerHTML || "";
                const plainOriginal = rawOriginal
                    ? rawOriginal.replace(/<\/?[^>]+(>|$)/g, "")
                    : msgEl.innerText || "";
                const lowerText = plainOriginal.toLowerCase();

                recordChatMessage(el, username, displayName, plainOriginal);

                const userIsBlocked = username && blockedUsers.includes(username);
                if (
                    settings.autoBurnEnabled &&
                    !el._autoBurnHandled &&
                    el._recentlyAdded &&
                    username && selfHandleLower &&
                    username !== selfHandleLower &&
                    !userIsBlocked && !isSystem
                ) {
                    const mentionRegex = new RegExp(`\\b@?${escapeRegex(selfHandleLower)}\\b`, "i");
                    if (mentionRegex.test(lowerText)) {
                        maybeHandleAutoBurn({ target: displayName.replace(/^@+/, ""), message: plainOriginal, from: username });
                        el._autoBurnHandled = true;
                    }
                }

                let keywordMatched = null;
                if (settings.blockedKeywords && settings.blockedKeywords.length > 0) {
                    for (const kw of settings.blockedKeywords) {
                        if (!kw) continue;
                        if (lowerText.includes(kw)) {
                            keywordMatched = kw;
                            break;
                        }
                    }
                }

                const shouldAutoBlock = !!keywordMatched;
                const shouldMask = shouldAutoBlock && settings.keywordAction === "mask" && !userIsBlocked;
                const isBlocked = userIsBlocked || shouldAutoBlock;
                el._autoBlocked = shouldAutoBlock;

                const previewLength = settings.previewLength || 50;
                const snippet = plainOriginal
                    ? plainOriginal.slice(0, previewLength) + (plainOriginal.length > previewLength ? "…" : "")
                    : msgEl.innerText.slice(0, previewLength);
                const blockedPreview = `🚫 Blocked message from ${displayName} (click to reveal)`;

                let maskedHTML = null;
                if (shouldMask) {
                    maskedHTML = el._originalMessage;
                    settings.blockedKeywords.forEach((kw) => {
                        if (!kw) return;
                        const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig");
                        maskedHTML = maskedHTML.replace(re, "•••");
                    });
                }

                if (isBlocked) {
                    el._collapseExpanded = false;
                    if (!el._initialized) {
                        el._initialized = true;
                        if (el._revealed) {
                            if (msgEl.innerHTML !== el._originalMessage) msgEl.innerHTML = el._originalMessage;
                            msgEl.style.opacity = "1";
                            msgEl.style.color = settings.darkMode ? "#eee" : "#555";
                            msgEl.style.cursor = "pointer";
                            msgEl.title = "";
                        } else if (shouldMask) {
                            if (msgEl.innerHTML !== maskedHTML) msgEl.innerHTML = maskedHTML;
                            msgEl.style.opacity = "0.9";
                            msgEl.style.cursor = "pointer";
                            msgEl.title = snippet;
                        } else {
                            if (msgEl.innerText !== blockedPreview) msgEl.innerText = blockedPreview;
                            msgEl.style.opacity = "0.5";
                            msgEl.style.cursor = "pointer";
                            msgEl.title = snippet;
                        }
                    } else if (el._revealed) {
                        if (msgEl.innerHTML !== el._originalMessage) {
                            msgEl.style.transition = "";
                            msgEl.innerHTML = el._originalMessage;
                            msgEl.style.opacity = "1";
                            msgEl.style.color = settings.darkMode ? "#eee" : "#555";
                            msgEl.title = "";
                        }
                    } else if (shouldMask) {
                        if (msgEl.innerHTML !== maskedHTML) {
                            if (!el._recentlyAdded) {
                                msgEl.innerHTML = maskedHTML;
                                msgEl.style.opacity = "0.9";
                            } else {
                                msgEl.style.opacity = "0";
                                setTimeout(() => {
                                    msgEl.innerHTML = maskedHTML;
                                    msgEl.style.opacity = "0.9";
                                }, 50);
                                delete el._recentlyAdded;
                            }
                            msgEl.style.cursor = "pointer";
                            msgEl.title = snippet;
                        }
                    } else if (msgEl.innerText !== blockedPreview) {
                        if (!el._recentlyAdded) {
                            msgEl.innerText = blockedPreview;
                            msgEl.style.opacity = "0.5";
                        } else {
                            msgEl.style.opacity = "0";
                            setTimeout(() => {
                                msgEl.innerText = blockedPreview;
                                msgEl.style.opacity = "0.5";
                            }, 50);
                            delete el._recentlyAdded;
                        }
                        msgEl.style.cursor = "pointer";
                        msgEl.title = snippet;
                    }

                    msgEl.onclick = () => {
                        if (el._collapsed) {
                            el._collapsed = false;
                            msgEl.innerHTML = el._originalMessage;
                            msgEl.style.opacity = "1";
                            msgEl.title = "";
                            return;
                        }

                        el._revealed = !el._revealed;

                        if (el._revealed) {
                            msgEl.style.opacity = "0";
                            setTimeout(() => {
                                msgEl.innerHTML = el._originalMessage;
                                msgEl.style.color = settings.darkMode ? "#eee" : "#555";
                                msgEl.style.opacity = "1";
                                msgEl.title = "";
                            }, 170);
                        } else {
                            msgEl.style.opacity = "0";
                            setTimeout(() => {
                                if (shouldMask) {
                                    msgEl.innerHTML = maskedHTML;
                                    msgEl.style.opacity = "0.9";
                                    msgEl.title = snippet;
                                } else {
                                    msgEl.innerText = blockedPreview;
                                    msgEl.style.opacity = "0.5";
                                    msgEl.title = snippet;
                                }
                            }, 170);
                        }
                    };
                } else {
                    if (msgEl.innerHTML !== el._originalMessage) {
                        msgEl.innerHTML = el._originalMessage;
                    }
                    msgEl.style.opacity = "1";
                    msgEl.style.color = settings.darkMode ? "#e0e0e0" : "#000";
                    msgEl.title = "";

                    const collapseThreshold = settings.collapseLength || 0;
                    const collapseTitle = plainOriginal.slice(0, Math.min(200, plainOriginal.length));
                    const collapseSnippet =
                        collapseThreshold > 0
                            ? plainOriginal.slice(0, collapseThreshold) + "… (click to expand)"
                            : "";
                    const collapseEnabled =
                        collapseThreshold > 0 && plainOriginal.length > collapseThreshold;

                    if (collapseEnabled && !el._collapseExpanded) {
                        if (!el._collapsed || msgEl.innerText !== collapseSnippet) {
                            msgEl.innerText = collapseSnippet;
                            msgEl.style.opacity = "0.6";
                            msgEl.title = collapseTitle;
                            el._collapsed = true;
                        }
                    } else if (!collapseEnabled || el._collapseExpanded) {
                        if (el._collapsed) {
                            el._collapsed = false;
                            msgEl.innerHTML = el._originalMessage;
                            msgEl.style.opacity = "1";
                            msgEl.title = collapseEnabled ? collapseTitle : "";
                        }
                        if (!collapseEnabled) {
                            el._collapseExpanded = false;
                            msgEl.title = "";
                        }
                    }

                    if (collapseEnabled) {
                        msgEl.style.cursor = "pointer";
                        msgEl.onclick = () => {
                            if (el._collapsed) {
                                el._collapsed = false;
                                el._collapseExpanded = true;
                                msgEl.innerHTML = el._originalMessage;
                                msgEl.style.opacity = "1";
                                msgEl.title = "";
                            } else {
                                el._collapseExpanded = false;
                                msgEl.innerText = collapseSnippet;
                                msgEl.style.opacity = "0.6";
                                msgEl.title = collapseTitle;
                                el._collapsed = true;
                            }
                        };
                    } else {
                        msgEl.style.cursor = "";
                        msgEl.onclick = null;
                    }
                }

                applyConfiguredChatTextStyle(msgEl, isBlocked, !!el._collapsed);

                if (el._recentlyAdded) {
                    if (isHighlighted) {
                        maybeNotify("highlight", displayName, snippet);
                    }
                    if (shouldAutoBlock) {
                        maybeNotify("keyword", displayName, snippet);
                    }
                    delete el._recentlyAdded;
                }

                if (chatContainer && !settings.autoScrollLock && !userScrolledAway) {
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }
            });
    }

    /***********************
     * Observe chat for new messages
     ***********************/
    function initChatObserver(container) {
        if (!container) return;

        const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes || []) {
                    if (
                        node.nodeType === 1 &&
                        node.matches &&
                        node.matches("li.chat-history--row.js-chat-history-item")
                    ) {
                        node._recentlyAdded = true;
                        setTimeout(() => refreshBlockedMessages(), 20);
                    }
                }
            }
        });

        observer.observe(container, { childList: true, subtree: true });
        refreshBlockedMessages();
    }

    /***********************
     * Context menu helpers
     ***********************/
    function sanitizeNickname(value) {
        if (value == null) return "";
        const normalized = value
            .toString()
            .replace(/[\r\n\t]+/g, " ")
            .replace(/\s{2,}/g, " ")
            .trim();
        if (!normalized) return "";
        if (normalized.length > 40) return "";
        if (!/^@?[A-Za-z0-9_.-]+$/.test(normalized)) return "";
        const stripped = normalized.startsWith("@") ? normalized.slice(1) : normalized;
        return stripped || "";
    }

    function readNicknameFromElement(element) {
        if (!element) return "";
        if (element.closest && element.closest("li.chat-history--row")) {
            return "";
        }
        if (element.tagName && element.tagName.toLowerCase() === "meta") {
            return element.getAttribute("content") || "";
        }
        const attrValue =
            element.dataset?.username ||
            element.dataset?.user ||
            (element.getAttribute ? element.getAttribute("data-username") : "") ||
            (element.getAttribute ? element.getAttribute("data-user") : "");
        if (attrValue) return attrValue;
        return element.textContent || element.innerText || "";
    }

    function storeNicknameIfValid(candidate) {
        const sanitized = sanitizeNickname(candidate);
        if (!sanitized) return "";
        if (sanitized.toLowerCase() === "guest") return sanitized;
        if (settings.myNickname !== sanitized) {
            settings.myNickname = sanitized;
            saveSettings();
        }
        return sanitized;
    }

    function detectMyNickname() {
        const fromGlobal = storeNicknameIfValid(window?.Rumble?.currentUser?.username);
        if (fromGlobal) return fromGlobal;

        const stored = sanitizeNickname(settings.myNickname);
        if (stored && stored.toLowerCase() !== "guest") {
            if (stored !== settings.myNickname) {
                settings.myNickname = stored;
                saveSettings();
            }
            return stored;
        }

        if (settings.myNickname) {
            settings.myNickname = "";
            saveSettings();
        }

        const selectors = [
            ".user-info .username",
            ".header-username",
            ".nav-item--user .username",
            "[data-profile-username]",
            "[data-username][data-user-id]",
            "[data-username][data-self='true']",
            "[data-username]"
        ];

        for (const selector of selectors) {
            const matches = document.querySelectorAll(selector);
            for (const element of matches) {
                const resolved = storeNicknameIfValid(readNicknameFromElement(element));
                if (resolved) return resolved;
            }
        }

        return "Guest";
    }

    function openDirectMessage(targetDisplayName) {
        const myNickname = detectMyNickname();

        const resolvedNickname = sanitizeNickname(myNickname) || "Guest";
        if (resolvedNickname !== settings.myNickname) {
            settings.myNickname = resolvedNickname === "Guest" ? settings.myNickname : resolvedNickname;
            if (resolvedNickname !== "Guest") saveSettings();
        }

        const providedTarget = (targetDisplayName || "").toString().replace(/\s+/g, " ").trim();
        const target = providedTarget ||
            prompt("Enter the username to DM:", "general")?.toString().replace(/\s+/g, " ").trim() ||
            "general";

        const landingBaseURL = "https://dizychat-server.onrender.com/";
        const params = new URLSearchParams();
        params.set("usernamePlaceholder", "Put your username here");
        params.set("roomPlaceholder", "Put your room name here");
        if (target && target !== resolvedNickname) {
            params.set("invite", target);
        }
        const landingURL = `${landingBaseURL}?${params.toString()}`;

        const dmWindow = window.open(landingURL, "_blank", "noopener,noreferrer");
        if (dmWindow) {
            try {
                dmWindow.opener = null;
            } catch (err) {
                console.warn("Unable to clear opener on DM window", err);
            }
            return;
        }

        const anchor = document.createElement("a");
        anchor.href = landingURL;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.style.display = "none";
        document.body.appendChild(anchor);

        const clickEvent = new MouseEvent("click", {
            view: window,
            bubbles: true,
            cancelable: true
        });

        const clickSucceeded = anchor.dispatchEvent(clickEvent);
        requestAnimationFrame(() => {
            if (anchor.parentNode) {
                anchor.parentNode.removeChild(anchor);
            }
        });

        if (!clickSucceeded) {
            alert("Please allow popups to open DizyChat direct messages in a new tab.");
        }
    }

    function attachContextMenuToUser(usernameEl) {
        if (!usernameEl || usernameEl.dataset.blockListener) return;
        usernameEl.dataset.blockListener = "true";

        usernameEl.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            const datasetUsername =
                (usernameEl.dataset?.username || usernameEl.getAttribute("data-username") || "")
                    .toString()
                    .replace(/\s+/g, " ")
                    .trim();
            const datasetDisplayName =
                (usernameEl.dataset?.displayName || usernameEl.getAttribute("data-display-name") || "")
                    .toString()
                    .replace(/\s+/g, " ")
                    .trim();
            const fallbackText = (usernameEl.innerText || usernameEl.textContent || "")
                .toString()
                .replace(/\s+/g, " ")
                .trim();
            const displayName = datasetDisplayName || datasetUsername || fallbackText;
            const username = (datasetUsername || displayName).toLowerCase();

            const isBlocked = blockedUsers.includes(username);
            const isHighlighted = settings.highlightedUsers.includes(username);

            const oldMenu = document.getElementById("customUserContextMenu");
            if (oldMenu) oldMenu.remove();

            const menu = document.createElement("div");
            menu.id = "customUserContextMenu";
            menu.style.position = "absolute";
            menu.style.top = `${e.pageY}px`;
            menu.style.left = `${e.pageX}px`;
            menu.style.background = "#222";
            menu.style.border = "1px solid #555";
            menu.style.padding = "5px";
            menu.style.zIndex = 9999;

            function addMenuItem(label, onClick) {
                const item = document.createElement("div");
                item.innerText = label;
                item.style.padding = "4px 8px";
                item.style.cursor = "pointer";
                item.style.color = "#fff";
                item.addEventListener("mouseover", () => (item.style.background = "#444"));
                item.addEventListener("mouseout", () => (item.style.background = ""));
                item.addEventListener("click", () => {
                    onClick();
                    menu.remove();
                });
                menu.appendChild(item);
            }

            addMenuItem(
                isBlocked ? `✅ Unblock ${displayName}` : `🚫 Block ${displayName}`,
                () => {
                    if (blockedUsers.includes(username)) {
                        blockedUsers = blockedUsers.filter((u) => u !== username);
                        saveBlocklist();
                        refreshBlockedMessages();
                        alert("User unblocked.");
                    } else {
                        blockedUsers.push(username);
                        saveBlocklist();
                        refreshBlockedMessages();
                        alert("User blocked.");
                    }
                }
            );

            addMenuItem(
                isHighlighted ? `⭐ Unhighlight ${displayName}` : `⭐ Highlight ${displayName}`,
                () => {
                    if (settings.highlightedUsers.includes(username)) {
                        settings.highlightedUsers = settings.highlightedUsers.filter((u) => u !== username);
                        saveSettings();
                        refreshBlockedMessages();
                    } else {
                        settings.highlightedUsers.push(username);
                        saveSettings();
                        refreshBlockedMessages();
                    }
                }
            );

            addMenuItem(`💬 Direct Message ${displayName}`, () => {
                openDirectMessage(displayName);
            });

            document.body.appendChild(menu);

            const closeMenu = () => {
                menu.remove();
                document.removeEventListener("click", closeMenu);
            };
            setTimeout(() => document.addEventListener("click", closeMenu), 0);
        });
    }

    /***********************
     * Wire up everything
     ***********************/
    function boot() {
        setupAutoBackup();
        initAudio();

        const chatBootInterval = setInterval(() => {
            const chatContainer =
                document.querySelector(".chat-history") || document.querySelector(".chat-list");
            if (chatContainer) {
                clearInterval(chatBootInterval);
                initChatObserver(chatContainer);
                document
                    .querySelectorAll("button.chat-history--username.js-user-tag")
                    .forEach(attachContextMenuToUser);

                const userObserver = new MutationObserver((muts) => {
                    muts.forEach((m) => {
                        m.addedNodes.forEach((n) => {
                            if (n.nodeType === 1) {
                                if (n.matches && n.matches("button.chat-history--username.js-user-tag")) {
                                    attachContextMenuToUser(n);
                                }
                                n.querySelectorAll &&
                                    n.querySelectorAll("button.chat-history--username.js-user-tag").forEach(
                                        attachContextMenuToUser
                                    );
                            }
                        });
                    });
                });

                userObserver.observe(chatContainer, { childList: true, subtree: true });
            }
        }, 800);

        ensureFloatingSettingsButton();
        window.addEventListener("beforeunload", saveChatLog, { once: true });
    }

    if (document.readyState === "complete" || document.readyState === "interactive") {
        boot();
    } else {
        window.addEventListener("DOMContentLoaded", boot);
    }

    // Expose API
    window.rumbleBlocker = window.rumbleBlocker || {};
    window.rumbleBlocker.refresh = refreshBlockedMessages;
    window.rumbleBlocker.export = exportData;
    window.rumbleBlocker.import = importData;
    window.rumbleBlocker.getSettings = () => settings;
    window.rumbleBlocker.getBlocked = () => blockedUsers;
    window.rumbleBlocker.exportChat = exportChatLog;
    window.rumbleBlocker.clearChat = clearChatLog;
    window.rumbleBlocker.getChatLog = () => chatLog.slice();
    window.rumbleBlocker.getBurnEngines = () => ({
        builtin: true,
        compromise: typeof nlp !== "undefined" || !!window.nlp,
        rita: typeof RiTa !== "undefined" || !!window.RiTa,
        markov: true,
        custom: typeof window.rumbleBlocker?.customBurnGenerator === "function"
    });
    window.rumbleBlocker.customBurnGenerator = window.rumbleBlocker.customBurnGenerator || null;
})();
