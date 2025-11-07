// ==UserScript==
// @name         Dizygotic Rumble Chat Tool
// @namespace    http://tampermonkey.net/
// @version      1.6
// @description  All-in-one chat tool for Rumble: private dm chat, user blocker + keyword filter + highlights + compact mode + timestamps + notifications + autoscroll lock + collapse long messages + stats + export/import + auto-backup. Non-flashing, persistent, draggable settings panel.
// @author       Dizygotic
// @match        https://rumble.com/*
// @grant        none
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

    let blockedUsers = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    let settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");

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
        highlightNotificationSoundEnabled: false,
        myNickname: ""
    };

    settings = Object.assign({}, defaultSettings, settings);

    function saveBlocklist() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(blockedUsers));
    }

    function saveSettings() {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }

    /***********************
     * Export / Import / Backup
     ***********************/
    function exportData(filename = "rumble-blocklist.json") {
        const data = { blockedUsers, settings };
        localStorage.setItem(BACKUP_KEY, JSON.stringify(data));
        const blob = new Blob([JSON.stringify(data, null, 2)], {
            type: "application/json"
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
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
                exportData(`rumble-blocklist-backup-${timestamp}.json`);
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
        if (type === "highlight" && settings.notifyOnHighlight) {
            triggerNotification(`Highlight: ${username}`, snippet);
            if (settings.notificationSound && audio) audio.play().catch(() => {});
        } else if (type === "keyword" && settings.notifyOnKeyword) {
            triggerNotification(`Keyword matched`, snippet);
            if (settings.notificationSound && audio) audio.play().catch(() => {});
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

            <b>Collapse long messages</b>
            <div style="font-size:12px;color:gray;margin-bottom:6px">Collapse messages longer than X characters (0 = off).</div>
            <input type="number" id="collapseLengthInput" value="${settings.collapseLength}" style="width:100px">

            <div style="height:12px"></div>

            <b>Keyword Notifications</b>
            <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
                <label><input type="checkbox" id="notifyOnKeywordInput"${settings.notifyOnKeyword ? " checked" : ""}> Notify on keyword match</label>
                <label style="margin-left:auto">Sound: <input type="file" id="notificationSoundInput" accept="audio/*"></label>
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
            settings.autoBackupMinutes = parseInt(panel.querySelector("#autoBackupInput").value, 10) || 0;
            settings.darkMode = !!panel.querySelector("#darkModeInput").checked;

            saveBlocklist();
            saveSettings();
            setupAutoBackup();

            const soundFileInput = panel.querySelector("#notificationSoundInput");
            if (soundFileInput && soundFileInput.files && soundFileInput.files[0]) {
                const f = soundFileInput.files[0];
                const reader = new FileReader();
                reader.onload = function (ev) {
                    settings.notificationSound = ev.target.result;
                    initAudio();
                    audio.src = settings.notificationSound;
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

        const stats = panel.querySelector("#statsSummary");
        stats.innerText = `Blocked users: ${blockedUsers.length} · Keywords: ${settings.blockedKeywords.length} · Highlighted: ${settings.highlightedUsers.length}`;

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

                const userIsBlocked = username && blockedUsers.includes(username);
                const shouldAutoBlock = !!keywordMatched;
                el._autoBlocked = shouldAutoBlock;

                if (!userIsBlocked && !shouldAutoBlock) {
                    if (msgEl.innerHTML !== el._originalMessage) {
                        msgEl.innerHTML = el._originalMessage;
                    }
                    msgEl.style.opacity = "1";
                    msgEl.style.color = settings.darkMode ? "#e0e0e0" : "#000";
                    msgEl.style.cursor = "default";
                    msgEl.title = "";
                    return;
                }

                const previewLength = settings.previewLength || 50;
                const snippet = plainOriginal
                    ? plainOriginal.slice(0, previewLength) + (plainOriginal.length > previewLength ? "…" : "")
                    : msgEl.innerText.slice(0, previewLength);
                const blockedPreview = `🚫 Blocked message from ${displayName} (click to reveal)`;

                let maskedHTML = null;
                if (shouldAutoBlock && settings.keywordAction === "mask") {
                    maskedHTML = el._originalMessage;
                    settings.blockedKeywords.forEach((kw) => {
                        if (!kw) return;
                        const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig");
                        maskedHTML = maskedHTML.replace(re, "•••");
                    });
                }

                if (!el._initialized) {
                    el._initialized = true;
                    if (el._revealed) {
                        if (msgEl.innerHTML !== el._originalMessage) msgEl.innerHTML = el._originalMessage;
                        msgEl.style.opacity = "1";
                        msgEl.style.color = settings.darkMode ? "#eee" : "#555";
                        msgEl.style.cursor = "pointer";
                        msgEl.title = "";
                    } else if (settings.keywordAction === "mask" && shouldAutoBlock) {
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
                } else if (settings.keywordAction === "mask" && shouldAutoBlock) {
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

                if (!el._revealed && settings.collapseLength > 0) {
                    if (plainOriginal.length > settings.collapseLength) {
                        if (!el._collapsed) {
                            const snippetShort =
                                plainOriginal.slice(0, settings.collapseLength) + "… (click to expand)";
                            msgEl.innerText = snippetShort;
                            msgEl.title = plainOriginal.slice(0, Math.min(200, plainOriginal.length));
                            msgEl.style.opacity = "0.6";
                            el._collapsed = true;
                        }
                    } else if (el._collapsed) {
                        el._collapsed = false;
                        msgEl.title = snippet;
                    }
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
                            if (settings.keywordAction === "mask" && shouldAutoBlock) {
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

                if (el._recentlyAdded) {
                    if (isHighlighted) {
                        maybeNotify("highlight", displayName, snippet);
                        if (audio && settings.highlightNotificationSoundEnabled && audio.src) {
                            audio.currentTime = 0;
                            audio.play().catch((err) => console.warn("Highlight sound failed:", err));
                        }
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
    function detectMyNickname() {
        if (settings.myNickname) return settings.myNickname;
        const candidate =
            document.querySelector(".user-info .username") ||
            document.querySelector(".header-username") ||
            document.querySelector("[data-username]");
        if (candidate) {
            settings.myNickname = candidate.innerText.trim();
            saveSettings();
            return settings.myNickname;
        }
        return "Guest";
    }

    function openDirectMessage(targetDisplayName) {
        const detectedNickname =
            window?.Rumble?.currentUser?.username || settings.myNickname || detectMyNickname() || "Guest";
        const myNickname = (detectedNickname || "")
            .toString()
            .replace(/\s+/g, " ")
            .trim() || "Guest";

        if (settings.myNickname !== myNickname) {
            settings.myNickname = myNickname;
            saveSettings();
        }

        const providedTarget = (targetDisplayName || "").toString().replace(/\s+/g, " ").trim();
        const target = providedTarget ||
            prompt("Enter the username to DM:", "general")?.toString().replace(/\s+/g, " ").trim() ||
            "general";

        const possessiveSuffix = /s$/i.test(target) ? "'" : "'s";
        const defaultRoomName = `${target}${possessiveSuffix} Room`;

        const landingBaseURL = "https://dizychat-server.onrender.com/";
        const params = new URLSearchParams();
        params.set("username", myNickname);
        params.set("room", defaultRoomName);
        const landingURL = `${landingBaseURL}?${params.toString()}`;

        const dmWindow = window.open(landingURL, "_blank", "noopener,noreferrer");
        if (!dmWindow) {
            window.location.href = landingURL;
        }
    }

    function attachContextMenuToUser(usernameEl) {
        if (!usernameEl || usernameEl.dataset.blockListener) return;
        usernameEl.dataset.blockListener = "true";

        usernameEl.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            const username = usernameEl.innerText.trim().toLowerCase();
            const displayName = usernameEl.innerText.trim();

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

            if (blockedUsers.includes(username)) {
                addMenuItem(`✅ Unblock ${displayName}`, () => {
                    blockedUsers = blockedUsers.filter((u) => u !== username);
                    saveBlocklist();
                    refreshBlockedMessages();
                    alert("User unblocked.");
                });
            } else {
                addMenuItem(`🚫 Block ${displayName}`, () => {
                    blockedUsers.push(username);
                    saveBlocklist();
                    refreshBlockedMessages();
                    alert("User blocked.");
                });
            }

            addMenuItem(`⭐ Highlight ${displayName}`, () => {
                if (!settings.highlightedUsers.includes(username)) {
                    settings.highlightedUsers.push(username);
                    saveSettings();
                    refreshBlockedMessages();
                }
            });

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
})();
