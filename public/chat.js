// ===== DIZYCHAT FUSION — SUPERNOVA FINAL 💜 =====
// Unified client (fusion.js merged into chat.js)
// (c) Dizygotic & Psybin 2025

console.log("%c🎛️ DizyChat Supernova Fusion Loaded", "color:#b266ff;font-weight:bold;");

const socket = io();
window.socket = socket;

// ------------------- Globals -------------------
let typingTimeout;
let isTyping = false;

window.currentUser = window.currentUser || null;
window.currentRoom = window.currentRoom || null;
window.currentPassword = window.currentPassword || "";

let isViewingChat = false;
let lastRoomName = "";
let lastRoomPassword = "";
let latestPublicRooms = [];

const replyState = {
  targetId: null,
};

// ------------------- DOM -------------------
const form = document.getElementById("form");
const input = document.getElementById("input");
const messages = document.getElementById("messages");
const fileInput = document.getElementById("file-input");
const attachBtn = document.getElementById("file-attach");
const emojiBtn = document.getElementById("emoji-btn");
const pinnedContainer = document.getElementById("pinned-messages");
const searchInput = document.getElementById("message-search");
const searchFilter = document.getElementById("message-search-filter");
const searchResultsBox = document.getElementById("search-results");
const replyPreviewBar = document.getElementById("reply-preview");
const replyPreviewContent = replyPreviewBar?.querySelector?.(".reply-preview-content") || null;
const replyPreviewAuthor = document.getElementById("reply-preview-author");
const replyPreviewText = document.getElementById("reply-preview-text");
const replyPreviewCancel = document.getElementById("reply-preview-cancel");

const usernamePrompt = document.getElementById("username-prompt");
const chatContainer = document.getElementById("chat-container");
const joinBtn = document.getElementById("join-btn");
const usernameInput = document.getElementById("username-input");
const roomInput = document.getElementById("room-input");
const passwordInput = document.getElementById("room-password");
const adminPasswordInput = document.getElementById("admin-password");
const roomName = document.getElementById("room-name");
const themeToggle = document.getElementById("toggle-theme");
const emojiPicker = document.getElementById("emoji-picker");
const leaveBtn = document.getElementById("leave-btn");
const copyJoinLinkBtn = document.getElementById("copy-join-link");
const publicRoomList = document.getElementById("public-room-list");
const themeLogos = Array.from(document.querySelectorAll("img.logo"));
const userSidebar = document.getElementById("user-sidebar");
const userList = document.getElementById("user-list");
const userCount = document.getElementById("user-count");
const userListEmpty = document.getElementById("user-list-empty");
const userContextMenu = document.getElementById("user-context-menu");

const appState = {
  isAdmin: false,
  messages: new Map(),
  pinned: new Map(),
  hidden: new Set(),
  activeMenu: null,
  highlightTimeout: null,
  users: [],
  moderationNotices: new Map(),
  contextMenuTrigger: null,
};

let searchDebounceTimer = null;
let soundCloudApiPromise = null;

const MESSAGE_STATUS_VALUES = new Set(["sent", "delivered", "read"]);
let messageReadObserver = null;

function normalizeMessageStatus(status) {
  if (typeof status !== "string") return "sent";
  const value = status.toLowerCase();
  return MESSAGE_STATUS_VALUES.has(value) ? value : "sent";
}

function getMessageStatusLabel(status) {
  switch (status) {
    case "delivered":
      return "Delivered";
    case "read":
      return "Read";
    case "sent":
    default:
      return "Sent";
  }
}

function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncateText(value, maxLength = 140) {
  if (!value) return "";
  const str = String(value).trim();
  if (!str) return "";
  if (str.length <= maxLength) return str;
  return `${str.slice(0, Math.max(0, maxLength - 1))}…`;
}

function normalizeMessageId(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    if (value instanceof Date) return "";
    if (value._id) return normalizeMessageId(value._id);
    if (typeof value.toString === "function" && value.toString !== Object.prototype.toString) {
      const str = value.toString();
      if (str && str !== "[object Object]") return str;
    }
  }
  try {
    const str = String(value);
    return str === "[object Object]" ? "" : str;
  } catch {
    return "";
  }
}

function normalizeReplySnapshot(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = normalizeMessageId(raw.id || raw._id);
  if (!id) return null;
  return {
    id,
    user: raw.user ? String(raw.user) : "",
    text: raw.text ? String(raw.text) : "",
    fileUrl: raw.fileUrl ? String(raw.fileUrl) : "",
    fileType: raw.fileType ? String(raw.fileType) : "",
    fileName: raw.fileName ? String(raw.fileName) : "",
    deleted: Boolean(raw.deleted),
  };
}

function resetMessageReadObserver() {
  if (messageReadObserver) {
    messageReadObserver.disconnect();
    messageReadObserver = null;
  }
}

function ensureMessageReadObserver() {
  if (messageReadObserver || !messages) return messageReadObserver;
  try {
    messageReadObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.75) return;
          const node = entry.target;
          const id = node?.dataset?.id;
          if (!id || node.dataset.readNotified === "true") return;
          if (!window.currentRoom || !isViewingChat) return;
          node.dataset.readNotified = "true";
          messageReadObserver?.unobserve(node);
          if (socket?.emit) {
            socket.emit("message read", { id, room: window.currentRoom });
          }
        });
      },
      { root: messages, threshold: 0.75 }
    );
  } catch (err) {
    console.warn("[Read Receipts] Unable to create observer", err);
    messageReadObserver = null;
  }
  return messageReadObserver;
}

function trackMessageRead(node, data) {
  if (!node || !data) return;
  if (data.user === window.currentUser) return;
  if (!messages || !isViewingChat) return;
  const status = normalizeMessageStatus(data.status);
  if (status === "read") return;
  if (node.dataset.readTracked === "true") return;
  const observer = ensureMessageReadObserver();
  if (!observer) return;
  node.dataset.readTracked = "true";
  observer.observe(node);
}

function applyMessageStatus(node, data) {
  if (!node) return;
  const statusEl = node.querySelector(".meta-status");
  if (!statusEl) return;
  const status = normalizeMessageStatus(data?.status ?? node.dataset.status);
  node.dataset.status = status;
  statusEl.dataset.status = status;
  const label = getMessageStatusLabel(status);
  statusEl.setAttribute("title", label);
  statusEl.setAttribute("aria-label", label);
  if (node.classList.contains("self")) {
    statusEl.hidden = false;
  } else {
    statusEl.hidden = true;
  }
}

function getDateKey(date) {
  if (!(date instanceof Date)) return "";
  const time = date.getTime();
  return Number.isNaN(time) ? "" : date.toDateString();
}

function formatDayLabel(date) {
  if (!(date instanceof Date)) return "";
  const time = date.getTime();
  if (Number.isNaN(time)) return "";

  const today = new Date();
  const todayKey = today.toDateString();
  if (date.toDateString() === todayKey) {
    return "Today";
  }

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return "Yesterday";
  }

  const options = { weekday: "long", month: "long", day: "numeric" };
  if (date.getFullYear() !== today.getFullYear()) {
    options.year = "numeric";
  }

  return date.toLocaleDateString(undefined, options);
}

function ensureDaySeparator(date) {
  if (!messages) return;
  const key = getDateKey(date);
  if (!key) return;
  if (messages.dataset.lastDateKey === key) return;

  const label = formatDayLabel(date) || key;
  const separator = document.createElement("div");
  separator.className = "day-separator";
  separator.dataset.dateKey = key;
  separator.textContent = label;
  messages.appendChild(separator);
  messages.dataset.lastDateKey = key;
}

// Autofocus username for smoother entry
usernameInput?.focus();

if (copyJoinLinkBtn) copyJoinLinkBtn.disabled = true;

if (publicRoomList && !publicRoomList.childElementCount) {
  const loadingItem = document.createElement("li");
  loadingItem.className = "empty";
  loadingItem.textContent = "Loading rooms…";
  publicRoomList.appendChild(loadingItem);
}

if (userContextMenu) {
  userContextMenu.setAttribute("role", "menu");
  userContextMenu.setAttribute("aria-hidden", "true");
  userContextMenu.addEventListener("click", (event) => event.stopPropagation());
  userContextMenu.addEventListener("keydown", (event) => {
    if (userContextMenu.hasAttribute("hidden")) return;
    const items = Array.from(userContextMenu.querySelectorAll("button"));
    if (!items.length) return;
    const currentIndex = items.indexOf(document.activeElement);
    const cycleFocus = (nextIndex) => {
      const target = items[(nextIndex + items.length) % items.length];
      target?.focus();
    };

    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        cycleFocus(currentIndex >= 0 ? currentIndex + 1 : 0);
        break;
      }
      case "ArrowUp": {
        event.preventDefault();
        cycleFocus(currentIndex >= 0 ? currentIndex - 1 : items.length - 1);
        break;
      }
      case "Home": {
        event.preventDefault();
        items[0]?.focus();
        break;
      }
      case "End": {
        event.preventDefault();
        items[items.length - 1]?.focus();
        break;
      }
      case "Escape": {
        event.preventDefault();
        closeActiveMenu({ restoreFocus: true });
        break;
      }
      default:
        break;
    }
  });
}

const urlParams = new URLSearchParams(window.location.search);
const prefillRoom = urlParams.get("room") || "";
const prefillPassword = urlParams.get("password") || "";

if (prefillRoom) {
  lastRoomName = prefillRoom;
  if (roomInput) roomInput.value = prefillRoom;
}

if (prefillPassword) {
  lastRoomPassword = prefillPassword;
  if (passwordInput) passwordInput.value = prefillPassword;
}

if (prefillRoom || prefillPassword) {
  updateQueryParams(prefillRoom, prefillPassword);
}

// ------------------- State Helpers -------------------
const hiddenStoragePrefix = "dizychat-hidden-";

const hiddenKeyForRoom = (room) => `${hiddenStoragePrefix}${room || ""}`;

function loadHiddenMessagesForRoom(room) {
  appState.hidden.clear();
  if (!room) return;
  try {
    const raw = localStorage.getItem(hiddenKeyForRoom(room));
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      parsed.forEach((id) => {
        if (typeof id === "string" && id) {
          appState.hidden.add(id);
        }
      });
    }
  } catch (err) {
    console.warn("[Hidden] Failed to load hidden messages", err);
  }
}

function persistHiddenMessages(room = window.currentRoom) {
  if (!room) return;
  try {
    const payload = JSON.stringify(Array.from(appState.hidden));
    localStorage.setItem(hiddenKeyForRoom(room), payload);
  } catch (err) {
    console.warn("[Hidden] Failed to persist hidden messages", err);
  }
}

function hideMessageLocally(id) {
  if (!id) return;
  appState.hidden.add(id);
  persistHiddenMessages();
  appState.pinned.delete(id);
  updatePinnedBanner();
  if (normalizeMessageId(replyState.targetId) === id) {
    clearReplyTarget();
  }
  const existing = messages?.querySelector(`.message[data-id="${id}"]`);
  if (existing) {
    if (appState.activeMenu && existing.contains(appState.activeMenu)) {
      closeActiveMenu();
    }
    existing.remove();
  }
}

function storeMessageData(raw) {
  if (!raw) return null;
  const id = raw._id || raw.id;
  if (!id) return null;

  const existing = appState.messages.get(id) || {};
  const merged = { ...existing, ...raw };
  merged._id = id;
  merged.id = id;

  const tsValue = raw.timestamp ?? raw.time ?? existing.timestamp ?? Date.now();
  const tsDate = tsValue instanceof Date ? tsValue : new Date(tsValue);
  merged.timestamp = Number.isNaN(tsDate.getTime()) ? new Date() : tsDate;

  merged.user = raw.user || existing.user || "Anon";
  merged.text = raw.text !== undefined ? raw.text : existing.text || "";
  merged.fileUrl = raw.fileUrl !== undefined ? raw.fileUrl : existing.fileUrl;
  merged.fileType = raw.fileType !== undefined ? raw.fileType : existing.fileType;
  merged.fileName = raw.fileName !== undefined ? raw.fileName : existing.fileName;
  merged.status = normalizeMessageStatus(raw.status ?? existing.status ?? "sent");
  merged.reactions = Array.isArray(raw.reactions)
    ? raw.reactions
    : Array.isArray(existing.reactions)
    ? existing.reactions
    : [];

  if (Array.isArray(raw.starredBy)) {
    merged.starredBy = Array.from(new Set(raw.starredBy));
  } else if (!Array.isArray(merged.starredBy)) {
    merged.starredBy = [];
  }

  merged.pinned = Boolean(raw.pinned ?? merged.pinned);
  merged.pinnedBy = raw.pinnedBy !== undefined ? (raw.pinnedBy || "") : merged.pinnedBy || "";
  merged.deleted = raw.deleted !== undefined ? Boolean(raw.deleted) : Boolean(merged.deleted);
  merged.deletedBy = raw.deletedBy !== undefined ? (raw.deletedBy || "") : merged.deletedBy || "";

  let replySnapshot = null;
  if (raw.replyToSnapshot !== undefined) {
    replySnapshot = normalizeReplySnapshot(raw.replyToSnapshot);
  } else if (existing.replyToSnapshot) {
    replySnapshot = normalizeReplySnapshot(existing.replyToSnapshot);
  }

  let replyId = "";
  if (raw.replyTo === null) {
    replyId = "";
  } else {
    const candidates = [
      raw.replyTo,
      raw.replyId,
      raw.reply_to,
      replySnapshot?.id,
      existing.replyTo,
      existing.replyToSnapshot?.id,
    ];
    for (const candidate of candidates) {
      const normalized = normalizeMessageId(candidate);
      if (normalized) {
        replyId = normalized;
        break;
      }
    }
  }

  merged.replyTo = replyId;
  merged.replyToSnapshot = replyId ? replySnapshot : null;

  if (merged.deleted) {
    merged.text = "";
    merged.fileUrl = "";
    merged.fileType = "";
    merged.fileName = "";
    merged.reactions = [];
    merged.starredBy = [];
    merged.pinned = false;
    merged.pinnedBy = "";
  }

  appState.messages.set(id, merged);
  if (merged.pinned && !merged.deleted) {
    appState.pinned.set(id, merged);
  } else {
    appState.pinned.delete(id);
  }
  return merged;
}

function resolveReplyDetails(replyId, fallbackSnapshot) {
  const normalizedId = normalizeMessageId(replyId || fallbackSnapshot?.id);
  if (!normalizedId) return null;
  const targetData = appState.messages.get(normalizedId);
  const snapshot = targetData
    ? {
        id: normalizedId,
        user: targetData.user || "Anon",
        text: targetData.text || "",
        fileUrl: targetData.fileUrl || "",
        fileType: targetData.fileType || "",
        fileName: targetData.fileName || "",
        deleted: Boolean(targetData.deleted),
      }
    : normalizeReplySnapshot(fallbackSnapshot);

  if (!snapshot) {
    return {
      id: normalizedId,
      user: "Unknown",
      snippet: "Message unavailable",
      deleted: false,
      hasAttachment: false,
      fileName: "",
    };
  }

  const isDeleted = Boolean(targetData?.deleted || snapshot.deleted);
  const base = targetData && !targetData.deleted ? targetData : snapshot;
  let snippet = (base.text || "").trim();
  if (!snippet) {
    snippet = base.fileName || base.fileUrl || "";
  }
  if (!snippet) {
    snippet = isDeleted ? "Message deleted" : "Attachment";
  }

  return {
    id: normalizedId,
    user: snapshot.user || targetData?.user || "Anon",
    snippet: truncateText(snippet, 180),
    deleted: isDeleted,
    hasAttachment: Boolean(base.fileUrl && !isDeleted),
    fileName: base.fileName || "",
  };
}

function applyReplyContext(node, data) {
  if (!node || !data) return;
  const info = resolveReplyDetails(data.replyTo, data.replyToSnapshot);
  let container = node.querySelector(".reply-context");
  if (!info) {
    if (container) container.remove();
    node.classList.remove("has-reply");
    node.removeAttribute("data-reply-id");
    return;
  }

  if (!container) {
    container = document.createElement("div");
    container.className = "reply-context";
    container.setAttribute("role", "button");
    container.setAttribute("tabindex", "0");
    const textEl = node.querySelector(".text");
    if (textEl) {
      node.insertBefore(container, textEl);
    } else {
      node.insertBefore(container, node.firstChild);
    }
  }

  node.dataset.replyId = info.id;
  container.dataset.replyId = info.id;
  container.classList.toggle("deleted", Boolean(info.deleted));
  container.innerHTML = "";

  const author = document.createElement("div");
  author.className = "reply-author";
  author.textContent = info.user || "Anon";
  container.appendChild(author);

  const snippet = document.createElement("div");
  snippet.className = "reply-snippet";
  if (info.hasAttachment) {
    const badge = document.createElement("span");
    badge.className = "reply-attachment-label";
    badge.textContent = info.fileName ? `📎 ${info.fileName}` : "📎 Attachment";
    snippet.appendChild(badge);
  }
  const snippetText = document.createElement("span");
  snippetText.textContent = info.snippet;
  snippet.appendChild(snippetText);
  container.appendChild(snippet);

  container.onclick = (event) => {
    event.stopPropagation();
    focusMessage(info.id);
  };
  container.onkeydown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      focusMessage(info.id);
    }
  };

  node.classList.add("has-reply");
}

function refreshReplyContextsForTarget(targetId) {
  if (!messages) return;
  const normalized = normalizeMessageId(targetId);
  if (!normalized) return;
  messages.querySelectorAll(".message").forEach((node) => {
    const replyNode = node.querySelector(".reply-context");
    if (!replyNode) return;
    if (replyNode.dataset.replyId !== normalized) return;
    const id = node.dataset.id;
    if (!id) return;
    const data = appState.messages.get(id);
    if (!data) return;
    applyReplyContext(node, data);
  });
}

function createReplyBarInfo(targetId) {
  const normalized = normalizeMessageId(targetId);
  if (!normalized) return null;
  const data = appState.messages.get(normalized);
  if (!data) return null;
  let snippet = (data.text || "").trim();
  if (!snippet) {
    snippet = data.fileName || data.fileUrl || "";
  }
  const deleted = Boolean(data.deleted);
  if (!snippet) {
    snippet = deleted ? "Message deleted" : "Attachment";
  }
  return {
    id: normalized,
    user: data.user || "Anon",
    snippet: truncateText(snippet, 180),
    deleted,
  };
}

function updateReplyPreviewBar() {
  if (!replyPreviewBar) return;
  const info = createReplyBarInfo(replyState.targetId);
  if (!info || !replyPreviewAuthor || !replyPreviewText) {
    replyPreviewBar.classList.remove("show");
    replyPreviewBar.setAttribute("hidden", "");
    replyPreviewBar.setAttribute("aria-hidden", "true");
    replyPreviewBar.removeAttribute("data-reply-id");
    return;
  }

  replyPreviewAuthor.textContent = info.user || "Anon";
  replyPreviewText.textContent = info.snippet;
  replyPreviewBar.dataset.replyId = info.id;
  replyPreviewBar.classList.add("show");
  replyPreviewBar.removeAttribute("hidden");
  replyPreviewBar.setAttribute("aria-hidden", "false");
}

function beginReply(target) {
  if (!target) return;
  const data = typeof target === "string" ? appState.messages.get(target) : target;
  if (!data) return;
  const id = normalizeMessageId(data.id || data._id);
  if (!id) return;
  if (data.deleted) {
    showToast("Cannot reply to a deleted message.", "warn");
    return;
  }
  replyState.targetId = id;
  updateReplyPreviewBar();
  input?.focus();
}

function clearReplyTarget() {
  replyState.targetId = null;
  updateReplyPreviewBar();
}

function attachMessageReplyInteractions(node, data) {
  if (!node || !data || data.deleted) return;
  if (node.dataset.replyClickBound === "true") return;
  node.addEventListener("click", (event) => {
    if (event.defaultPrevented) return;
    const target = event.target;
    if (target?.closest?.(
      ".message-actions-toggle, .message-actions-menu, .reply-context, .inline-preview, a, button, audio, video, .embed-wrap"
    )) {
      return;
    }
    const selection = window.getSelection?.();
    if (selection && selection.toString()) return;
    const current = appState.messages.get(data.id);
    if (!current || current.deleted) return;
    beginReply(current);
  });
  node.dataset.replyClickBound = "true";
}

if (replyPreviewCancel) {
  replyPreviewCancel.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    clearReplyTarget();
  });
}

if (replyPreviewContent) {
  replyPreviewContent.setAttribute("role", "button");
  replyPreviewContent.setAttribute("tabindex", "0");
  replyPreviewContent.addEventListener("click", () => {
    const id = normalizeMessageId(replyState.targetId);
    if (id) focusMessage(id);
  });
  replyPreviewContent.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const id = normalizeMessageId(replyState.targetId);
      if (id) focusMessage(id);
    }
  });
}

if (replyPreviewBar) {
  replyPreviewBar.addEventListener("click", (event) => {
    if (event.target === replyPreviewCancel) return;
    if (event.target === replyPreviewBar) {
      const id = normalizeMessageId(replyState.targetId);
      if (id) focusMessage(id);
    }
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && replyState.targetId) {
    clearReplyTarget();
  }
});

function formatDurationLabel(seconds) {
  if (!seconds || seconds <= 0) return "";
  if (seconds < 60) {
    const value = Math.max(1, Math.round(seconds));
    return value === 1 ? "1 second" : `${value} seconds`;
  }
  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60);
    return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  }
  const hours = Math.round(seconds / 3600);
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

function formatRemaining(ms) {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  if (totalSeconds >= 3600) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (minutes) return `${hours}h ${minutes}m`;
    return `${hours}h`;
  }
  if (totalSeconds >= 60) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (seconds) return `${minutes}m ${seconds}s`;
    return `${minutes}m`;
  }
  return `${totalSeconds}s`;
}

function shouldSuppressModerationToast(key, cooldown = 4000) {
  const now = Date.now();
  const last = appState.moderationNotices.get(key) || 0;
  if (now - last < cooldown) return true;
  appState.moderationNotices.set(key, now);
  return false;
}

function renderUserSidebar(users = []) {
  if (!userList) return;
  const array = Array.isArray(users) ? users.filter(Boolean) : [];
  appState.users = array;
  userList.innerHTML = "";
  closeActiveMenu();

  const now = Date.now();
  let total = 0;

  array.forEach((entry) => {
    if (!entry || !entry.username) return;
    const username = entry.username;
    const isSelf = username === window.currentUser;
    const isAdmin = Boolean(entry.isAdmin);
    const mutedUntil = Number(entry.mutedUntil || 0);
    const isMuted = mutedUntil && mutedUntil > now;
    const isBlocked = Boolean(entry.isBlocked);
    const userData = { ...entry, mutedUntil };

    const item = document.createElement("li");
    item.className = "user-entry";
    item.dataset.username = username;
    if (isAdmin) item.classList.add("admin");

    const name = document.createElement("span");
    name.className = "user-name";
    if (isAdmin) {
      const crown = document.createElement("span");
      crown.className = "user-crown";
      crown.textContent = "👑";
      name.appendChild(crown);
    }

    const label = document.createElement("span");
    label.textContent = username;
    name.appendChild(label);

    if (isSelf) {
      const pill = document.createElement("span");
      pill.className = "self-pill";
      pill.textContent = "you";
      name.appendChild(pill);
    }

    item.appendChild(name);

    const statusParts = [];
    if (isMuted) {
      statusParts.push({ text: `Muted • ${formatRemaining(mutedUntil - now)} left`, className: "warn" });
    }
    if (isBlocked) {
      statusParts.push({ text: "Blocked", className: "bad" });
    }

    if (statusParts.length) {
      const status = document.createElement("span");
      const isSevere = statusParts.some((part) => part.className === "bad");
      status.className = `user-status ${isSevere ? "bad" : statusParts[0].className}`;
      status.textContent = statusParts.map((part) => part.text).join(" • ");
      item.appendChild(status);
    }

    const canInteract =
      !isSelf && (appState.isAdmin || (!isAdmin && !isSelf));

    if (canInteract) {
      item.classList.add("actionable");
      item.tabIndex = 0;
      item.setAttribute("role", "button");
      item.setAttribute("aria-haspopup", "menu");
      item.setAttribute("aria-controls", "user-context-menu");
      item.setAttribute("aria-expanded", "false");

      const handleOpen = (event) => {
        event.preventDefault();
        event.stopPropagation();
        openUserContextMenu(item, userData);
      };

      item.addEventListener("click", handleOpen);
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
          handleOpen(event);
        }
      });
    } else if (!isSelf) {
      item.classList.add("disabled");
      item.setAttribute("aria-disabled", "true");
    }

    userList.appendChild(item);
    total += 1;
  });

  if (userCount) {
    userCount.textContent = String(total);
  }

  if (userListEmpty) {
    const showEmpty = !window.currentRoom || total <= 1;
    userListEmpty.style.display = showEmpty ? "block" : "none";
    if (!window.currentRoom) {
      userListEmpty.textContent = "Join a room to see who's online.";
    } else {
      userListEmpty.textContent = "No one else is here yet.";
    }
  }
}

function openUserContextMenu(trigger, user) {
  if (!userContextMenu || !trigger || !user) return;
  if (!window.currentRoom) return;

  closeActiveMenu();

  appState.contextMenuTrigger = trigger;
  trigger.setAttribute("aria-expanded", "true");

  const isSelf = user.username === window.currentUser;
  const isTargetAdmin = Boolean(user.isAdmin);
  const mutedUntil = Number(user.mutedUntil || 0);
  const now = Date.now();
  const isMuted = mutedUntil && mutedUntil > now;
  const isBlocked = Boolean(user.isBlocked);

  const options = [];
  const canMute = !isSelf && (appState.isAdmin || (!isTargetAdmin && !isSelf));

  if (canMute) {
    if (isMuted) {
      options.push({ action: "unmute", label: "Unmute" });
    } else {
      options.push({ action: "mute", label: "Mute for 1 minute", duration: 60 });
      options.push({ action: "mute", label: "Mute for 5 minutes", duration: 300 });
      options.push({ action: "mute", label: "Mute for 1 hour", duration: 3600 });
    }
  }

  if (appState.isAdmin && !isSelf) {
    if (isBlocked) {
      options.push({ action: "unblock", label: "Unblock" });
    } else {
      options.push({ action: "block", label: "Block" });
    }
    options.push({ action: "ban", label: "Ban & remove", dangerous: true });
  }

  if (!options.length) {
    appState.contextMenuTrigger = null;
    trigger.setAttribute("aria-expanded", "false");
    return;
  }

  userContextMenu.innerHTML = "";
  userContextMenu.style.visibility = "hidden";
  userContextMenu.style.minWidth = `${Math.max(trigger.offsetWidth, 180)}px`;
  userContextMenu.removeAttribute("hidden");
  userContextMenu.setAttribute("aria-hidden", "false");

  options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = option.label;
    if (option.dangerous) button.classList.add("danger");
    button.setAttribute("role", "menuitem");
    button.tabIndex = -1;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!window.currentRoom) return;
      const payload = {
        room: window.currentRoom,
        target: user.username,
        action: option.action,
      };
      if (option.duration) payload.duration = option.duration;
      socket.emit("moderate user", payload);
      closeActiveMenu();
    });
    userContextMenu.appendChild(button);
  });

  userContextMenu.classList.add("open");

  requestAnimationFrame(() => {
    const rect = trigger.getBoundingClientRect();
    const menuRect = userContextMenu.getBoundingClientRect();
    const viewportPadding = 12;
    const top = rect.bottom + window.scrollY + 6;
    const maxLeft = window.scrollX + window.innerWidth - menuRect.width - viewportPadding;
    let left = rect.left + window.scrollX;
    if (left > maxLeft) {
      left = Math.max(viewportPadding + window.scrollX, maxLeft);
    }
    userContextMenu.style.top = `${top}px`;
    userContextMenu.style.left = `${left}px`;
    userContextMenu.style.visibility = "visible";
    const firstButton = userContextMenu.querySelector("button");
    firstButton?.focus();
  });

  appState.activeMenu = userContextMenu;
}

function handleModerationNotice({ type, room, until, reason } = {}) {
  if (!type) return;
  if (room && window.currentRoom && room !== window.currentRoom) return;

  const normalizedType = String(type).toLowerCase();
  const key = `${normalizedType}:${reason || "general"}`;
  const now = Date.now();

  if (normalizedType === "muted") {
    const remaining = until ? Math.max(0, Number(until) - now) : 0;
    const message =
      reason === "send"
        ? remaining > 0
          ? `You are muted. ${formatRemaining(remaining)} remaining.`
          : "You are muted and cannot send messages yet."
        : remaining > 0
        ? `You were muted. ${formatRemaining(remaining)} remaining.`
        : "You were muted.";
    const cooldown = reason === "send" ? 4000 : 0;
    if (!shouldSuppressModerationToast(key, cooldown)) {
      showToast(message, "warn");
    }
    return;
  }

  if (normalizedType === "unmuted") {
    if (!shouldSuppressModerationToast(key, 0)) {
      showToast("You are no longer muted.", "success");
    }
    return;
  }

  if (normalizedType === "blocked") {
    const message =
      reason === "send"
        ? "You are blocked from sending messages."
        : "You were blocked by an admin.";
    const cooldown = reason === "send" ? 4000 : 0;
    if (!shouldSuppressModerationToast(key, cooldown)) {
      showToast(message, "error");
    }
    return;
  }

  if (normalizedType === "unblocked") {
    if (!shouldSuppressModerationToast(key, 0)) {
      showToast("You are no longer blocked.", "success");
    }
    return;
  }

  if (normalizedType === "banned") {
    if (!shouldSuppressModerationToast(key, 0)) {
      showToast("You were banned from the room.", "error");
    }
  }
}

function updatePinnedBanner() {
  if (!pinnedContainer) return;
  const pinned = Array.from(appState.pinned.values()).filter((msg) => !msg.deleted);
  if (!pinned.length) {
    pinnedContainer.innerHTML = "";
    pinnedContainer.style.display = "none";
    return;
  }

  pinned.sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return tb - ta;
  });

  pinnedContainer.innerHTML = "";
  pinned.forEach((msg) => {
    const entry = document.createElement("div");
    entry.className = "pinned-entry";
    entry.dataset.id = msg.id;

    const text = document.createElement("div");
    text.className = "pinned-text";
    const preview = msg.text?.trim() || msg.fileName || msg.fileUrl || "Pinned attachment";
    text.textContent = preview.length > 120 ? `${preview.slice(0, 120)}…` : preview;

    const meta = document.createElement("div");
    meta.className = "pinned-meta";
    meta.textContent = `${msg.user || "Anon"} • ${new Date(msg.timestamp || Date.now()).toLocaleTimeString()}`;

    entry.appendChild(text);
    entry.appendChild(meta);
    entry.addEventListener("click", () => focusMessage(msg.id));
    pinnedContainer.appendChild(entry);
  });

  pinnedContainer.style.display = "flex";
}

function focusMessage(id) {
  if (!messages) return;
  const node = messages.querySelector(`.message[data-id="${id}"]`);
  if (!node) return;
  node.scrollIntoView({ behavior: "smooth", block: "center" });
  node.classList.add("search-hit");
  if (appState.highlightTimeout) clearTimeout(appState.highlightTimeout);
  appState.highlightTimeout = setTimeout(() => {
    node.classList.remove("search-hit");
  }, 2500);
}

function updateMessageFlags(node, data) {
  const bar = node?.querySelector?.(".message-flags");
  if (!bar) return;
  bar.innerHTML = "";
  if (!data || data.deleted) return;

  if (data.pinned) {
    const badge = document.createElement("span");
    badge.className = "message-flag pinned";
    badge.textContent = "📌 Pinned";
    if (data.pinnedBy) {
      const by = document.createElement("span");
      by.className = "count";
      by.textContent = `by ${data.pinnedBy}`;
      badge.appendChild(by);
    }
    bar.appendChild(badge);
  }

  if (Array.isArray(data.starredBy) && data.starredBy.length) {
    const badge = document.createElement("span");
    badge.className = "message-flag starred";
    badge.textContent = "⭐";
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = `×${data.starredBy.length}`;
    badge.appendChild(count);
    bar.appendChild(badge);
  }
}

function toggleMenu(menu, toggle) {
  if (!menu) return;
  const isOpen = menu.classList.contains("open");
  closeActiveMenu();
  if (!isOpen) {
    menu.classList.add("open");
    if (toggle) toggle.setAttribute("aria-expanded", "true");
    appState.activeMenu = menu;
  }
}

function closeActiveMenu(options = {}) {
  if (!appState.activeMenu) return;
  const { restoreFocus = false } = options;
  const menu = appState.activeMenu;
  menu.classList.remove("open");

  if (menu === userContextMenu) {
    userContextMenu.setAttribute("hidden", "");
    userContextMenu.setAttribute("aria-hidden", "true");
    userContextMenu.style.visibility = "";
    if (appState.contextMenuTrigger) {
      appState.contextMenuTrigger.setAttribute("aria-expanded", "false");
      if (restoreFocus) {
        appState.contextMenuTrigger.focus();
      }
    }
    appState.contextMenuTrigger = null;
  } else {
    const toggle = menu.previousElementSibling;
    if (toggle?.classList?.contains("message-actions-toggle")) {
      toggle.setAttribute("aria-expanded", "false");
    }
  }

  appState.activeMenu = null;
}

function setupMessageActions(node, data) {
  if (!node || !data) return;
  let toggle = node.querySelector(".message-actions-toggle");
  if (!toggle) {
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "message-actions-toggle";
    toggle.setAttribute("aria-label", "Message actions");
    toggle.textContent = "⋮";
    node.appendChild(toggle);
  }

  let menu = node.querySelector(".message-actions-menu");
  if (!menu) {
    menu = document.createElement("div");
    menu.className = "message-actions-menu";
    node.appendChild(menu);
  }

  const isPinned = Boolean(data.pinned);
  const isStarred = Array.isArray(data.starredBy) && data.starredBy.includes(window.currentUser);
  const isOwn = data.user === window.currentUser;
  const canDeleteEveryone = appState.isAdmin || isOwn;

  menu.innerHTML = "";

  if (!data.deleted) {
    const replyBtn = document.createElement("button");
    replyBtn.type = "button";
    replyBtn.textContent = "Reply";
    replyBtn.addEventListener("click", () => {
      closeActiveMenu();
      beginReply(data);
    });
    menu.appendChild(replyBtn);

    const pinBtn = document.createElement("button");
    pinBtn.type = "button";
    pinBtn.textContent = isPinned ? "Unpin" : "Pin";
    pinBtn.addEventListener("click", () => {
      closeActiveMenu();
      const event = isPinned ? "unpin message" : "pin message";
      socket.emit(event, { room: window.currentRoom, id: data.id });
    });
    menu.appendChild(pinBtn);

    const starBtn = document.createElement("button");
    starBtn.type = "button";
    starBtn.textContent = isStarred ? "Unstar" : "Star";
    starBtn.addEventListener("click", () => {
      closeActiveMenu();
      const event = isStarred ? "unstar message" : "star message";
      socket.emit(event, { room: window.currentRoom, id: data.id, user: window.currentUser });
    });
    menu.appendChild(starBtn);
  }

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  if (canDeleteEveryone) deleteBtn.classList.add("danger");
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", async () => {
    closeActiveMenu();
    if (data.deleted) {
      hideMessageLocally(data.id);
      return;
    }
    const choice = await confirmDeleteOptions({ canDeleteEveryone });
    if (choice === "cancel") return;
    if (choice === "me") {
      hideMessageLocally(data.id);
    } else if (choice === "everyone" && canDeleteEveryone) {
      socket.emit("delete message", { room: window.currentRoom, id: data.id, scope: "all" });
    } else if (choice === "everyone") {
      showToast("Only admins or message owners can delete for everyone.", "warn");
    }
  });
  menu.appendChild(deleteBtn);

  toggle.onclick = (event) => {
    event.stopPropagation();
    toggleMenu(menu, toggle);
  };

  attachMessageReplyInteractions(node, data);
}

function updateMessageNode(id) {
  const data = appState.messages.get(id);
  if (!data || !messages) return;
  const node = messages.querySelector(`.message[data-id="${id}"]`);
  if (!node) return;

  if (data.deleted) {
    node.dataset.deleted = "true";
  } else {
    node.removeAttribute("data-deleted");
  }

  node.dataset.status = normalizeMessageStatus(data.status);
  applyMessageStatus(node, data);

  if (data.deleted && appState.activeMenu && node.contains(appState.activeMenu)) {
    closeActiveMenu();
  }

  const timeEl = node.querySelector(".meta .meta-time");
  if (timeEl && data.timestamp) {
    timeEl.textContent = new Date(data.timestamp).toLocaleTimeString();
  }

  const textEl = node.querySelector(".text");
  if (textEl) {
    if (data.deleted) {
      textEl.classList.add("hidden");
      textEl.textContent = "";
      let deleted = node.querySelector(".deleted-label");
      if (!deleted) {
        deleted = document.createElement("div");
        deleted.className = "deleted-label";
        deleted.textContent = "Message deleted";
        node.appendChild(deleted);
      }
    } else {
      textEl.classList.remove("hidden");
      textEl.style.removeProperty("display");
      textEl.textContent = data.text || "";
      node.classList.remove("has-emoji-gif", "emoji-gif-only");
      const emojiInfo = replaceCustomEmojiLinks(textEl);
      if (emojiInfo?.hasGif) {
        node.classList.add("has-emoji-gif");
        if (emojiInfo.onlyEmoji) {
          node.classList.add("emoji-gif-only");
        } else {
          node.classList.remove("emoji-gif-only");
        }
      }
      linkifyTextContent(textEl);
      const deleted = node.querySelector(".deleted-label");
      if (deleted) deleted.remove();
    }
  }

  if (data.deleted) {
    node.classList.remove("has-inline-preview");
    node.querySelectorAll(".inline-preview, .embed-wrap").forEach((el) => el.remove());
  }

  applyReplyContext(node, data);
  updateMessageFlags(node, data);
  setupMessageActions(node, data);

  if (replyState.targetId && normalizeMessageId(replyState.targetId) === data.id) {
    if (data.deleted) {
      showToast("Reply target was deleted.", "warn");
      clearReplyTarget();
    } else {
      updateReplyPreviewBar();
    }
  }

  refreshReplyContextsForTarget(data.id);
}

function refreshActionMenus() {
  if (!messages) return;
  messages.querySelectorAll(".message").forEach((node) => {
    const id = node.dataset.id;
    if (!id) return;
    const data = appState.messages.get(id);
    if (!data) return;
    setupMessageActions(node, data);
  });
}

function confirmDeleteOptions({ canDeleteEveryone }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "confirm-dialog-backdrop";

    const dialog = document.createElement("div");
    dialog.className = "confirm-dialog";

    const title = document.createElement("h3");
    title.textContent = "Delete message?";
    const body = document.createElement("p");
    body.textContent = canDeleteEveryone
      ? "Choose whether to delete this message for everyone or just for you."
      : "Delete this message for yourself?";

    const actions = document.createElement("div");
    actions.className = "confirm-dialog-actions";

    let onKeyDown;
    const cleanup = (value) => {
      backdrop.remove();
      if (onKeyDown) {
        document.removeEventListener("keydown", onKeyDown);
      }
      resolve(value);
    };

    onKeyDown = (event) => {
      if (event.key === "Escape") {
        cleanup("cancel");
      }
    };
    document.addEventListener("keydown", onKeyDown);

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "neutral";
    cancel.textContent = "Cancel";
    cancel.onclick = () => cleanup("cancel");

    const deleteMe = document.createElement("button");
    deleteMe.type = "button";
    deleteMe.className = "primary";
    deleteMe.textContent = "Delete for me";
    deleteMe.onclick = () => cleanup("me");

    actions.appendChild(cancel);
    actions.appendChild(deleteMe);

    if (canDeleteEveryone) {
      const deleteAll = document.createElement("button");
      deleteAll.type = "button";
      deleteAll.className = "danger";
      deleteAll.textContent = "Delete for everyone";
      deleteAll.onclick = () => cleanup("everyone");
      actions.appendChild(deleteAll);
    }

    dialog.appendChild(title);
    dialog.appendChild(body);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        cleanup("cancel");
      }
    });
  });
}

function hideSearchResults() {
  if (!searchResultsBox) return;
  searchResultsBox.classList.remove("show");
  searchResultsBox.hidden = true;
  searchResultsBox.innerHTML = "";
}

function renderSearchResults(results = []) {
  if (!searchResultsBox) return;
  if (!Array.isArray(results) || !results.length) {
    hideSearchResults();
    return;
  }

  searchResultsBox.innerHTML = "";
  results.forEach((msg) => {
    const data = storeMessageData(msg);
    if (!data) return;
    const item = document.createElement("div");
    item.className = "search-result-item";
    item.dataset.id = data.id;

    const meta = document.createElement("div");
    meta.className = "search-result-meta";
    const name = document.createElement("span");
    name.textContent = data.user || "Anon";
    const time = document.createElement("span");
    time.textContent = new Date(data.timestamp || Date.now()).toLocaleTimeString();
    meta.append(name, time);

    const text = document.createElement("div");
    text.className = "search-result-text";
    const preview = data.deleted
      ? "Message deleted"
      : data.text?.trim() || data.fileName || data.fileUrl || "Attachment";
    text.textContent = preview.length > 140 ? `${preview.slice(0, 140)}…` : preview;

    item.append(meta, text);
    item.addEventListener("click", () => {
      focusMessage(data.id);
      hideSearchResults();
    });

    searchResultsBox.appendChild(item);
  });

  searchResultsBox.hidden = false;
  searchResultsBox.classList.add("show");
}

function triggerSearch() {
  if (!searchInput || !searchFilter || !window.currentRoom) return;
  const query = searchInput.value.trim();
  const filter = searchFilter.value;

  if (!query && filter === "all") {
    hideSearchResults();
    return;
  }

  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    socket.emit("search messages", {
      room: window.currentRoom,
      query,
      filter,
    });
  }, 250);
}

function loadSoundCloudApi() {
  if (soundCloudApiPromise) return soundCloudApiPromise;
  soundCloudApiPromise = new Promise((resolve) => {
    if (window.SC?.Widget) {
      resolve(window.SC);
      return;
    }
    const existing = document.querySelector('script[src="https://w.soundcloud.com/player/api.js"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.SC || null));
      existing.addEventListener("error", () => resolve(null));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://w.soundcloud.com/player/api.js";
    script.async = true;
    script.onload = () => resolve(window.SC || null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return soundCloudApiPromise;
}

async function attachSoundCloudControls(iframe, wrap) {
  if (!iframe || iframe.dataset.soundcloudControls === "1") return;
  const SC = await loadSoundCloudApi();
  if (!SC || !SC.Widget) return;

  try {
    const widget = SC.Widget(iframe);
    const controls = document.createElement("div");
    controls.className = "soundcloud-controls";

    const muteBtn = document.createElement("button");
    muteBtn.type = "button";
    muteBtn.textContent = "Mute";

    const volume = document.createElement("input");
    volume.type = "range";
    volume.min = "0";
    volume.max = "100";
    volume.value = "100";

    let lastVolume = 100;
    let isMuted = false;

    const updateMuteLabel = () => {
      muteBtn.textContent = isMuted ? "Unmute" : "Mute";
    };

    muteBtn.addEventListener("click", () => {
      if (isMuted) {
        const target = lastVolume || 100;
        widget.setVolume(target);
        volume.value = String(target);
        isMuted = false;
        updateMuteLabel();
      } else {
        lastVolume = Number(volume.value) || 100;
        widget.setVolume(0);
        volume.value = "0";
        isMuted = true;
        updateMuteLabel();
      }
    });

    volume.addEventListener("input", () => {
      const value = Number(volume.value) || 0;
      widget.setVolume(value);
      if (value === 0) {
        isMuted = true;
      } else {
        lastVolume = value;
        isMuted = false;
      }
      updateMuteLabel();
    });

    widget.bind(SC.Widget.Events.READY, () => {
      widget.getVolume((value) => {
        if (typeof value === "number") {
          volume.value = String(Math.round(value));
          lastVolume = Number(volume.value) || 100;
          isMuted = Number(volume.value) === 0;
          updateMuteLabel();
        }
      });
    });

    controls.appendChild(muteBtn);
    controls.appendChild(volume);
    wrap.appendChild(controls);
    iframe.dataset.soundcloudControls = "1";
  } catch (err) {
    console.warn("[SoundCloud] Unable to attach controls", err);
  }
}

function linkifyTextContent(container) {
  if (!container) return [];
  const links = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  const replacements = [];

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const value = node.nodeValue;
    if (!value || !/https?:\/\//i.test(value)) continue;
    const parts = value.split(/(https?:\/\/[^\s]+)/gi);
    if (parts.length > 1) {
      replacements.push({ node, parts });
    }
  }

  replacements.forEach(({ node, parts }) => {
    const fragment = document.createDocumentFragment();
    parts.forEach((part) => {
      if (!part) return;
      if (/^https?:\/\//i.test(part)) {
        const anchor = document.createElement("a");
        anchor.href = part;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.textContent = part;
        fragment.appendChild(anchor);
        links.push(part);
      } else {
        fragment.appendChild(document.createTextNode(part));
      }
    });
    node.parentNode?.replaceChild(fragment, node);
  });

  return links;
}

window.addEventListener("resize", () => closeActiveMenu());
document.addEventListener(
  "scroll",
  () => closeActiveMenu(),
  true
);
document.addEventListener("click", () => closeActiveMenu());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    const restoreFocus = appState.activeMenu === userContextMenu;
    closeActiveMenu({ restoreFocus });
    hideSearchResults();
  }
});

if (searchInput) {
  searchInput.addEventListener("input", () => {
    if (!searchInput.value.trim() && (!searchFilter || searchFilter.value === "all")) {
      hideSearchResults();
      return;
    }
    triggerSearch();
  });
}

if (searchFilter) {
  searchFilter.addEventListener("change", () => {
    triggerSearch();
  });
}
// ------------------- Toasts (bottom-left, glowing, auto-hide) -------------------
(() => {
  const container = document.createElement("div");
  container.className = "toast-container";
  // Force bottom-left regardless of existing CSS
  Object.assign(container.style, {
    position: "fixed",
    left: "16px",
    bottom: "76px",
    zIndex: 2000,
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    pointerEvents: "none",
  });
  document.body.appendChild(container);

  window.showToast = (text, type = "info") => {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    Object.assign(toast.style, {
      minWidth: "200px",
      maxWidth: "320px",
      background: "rgba(20,20,20,0.9)",
      color: "#fff",
      padding: "10px 14px",
      borderRadius: "12px",
      fontSize: "0.9em",
      boxShadow:
        type === "success"
          ? "0 0 10px rgba(46, 204, 113, 0.45)"
          : type === "error"
          ? "0 0 10px rgba(231, 76, 60, 0.5)"
          : "0 0 10px rgba(187,134,252,0.45)",
      borderLeft:
        type === "success"
          ? "4px solid #2ecc71"
          : type === "error"
          ? "4px solid #e74c3c"
          : "4px solid #bb86fc",
      opacity: 0,
      transform: "translateX(-12px)",
      transition: "opacity .25s ease, transform .25s ease",
      pointerEvents: "auto",
    });
    toast.textContent = text;
    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = 1;
      toast.style.transform = "translateX(0)";
    });

    const hide = () => {
      toast.style.opacity = 0;
      toast.style.transform = "translateX(-12px)";
      setTimeout(() => toast.remove(), 250);
    };
    const timer = setTimeout(hide, 3000);
    toast.onclick = () => {
      clearTimeout(timer);
      hide();
    };
  };
})();

// ------------------- Media Lightbox -------------------
const MediaLightbox = (() => {
  const overlay = document.createElement("div");
  overlay.id = "media-lightbox";
  overlay.innerHTML = `
    <div class="media-frame">
      <button type="button" class="media-close" aria-label="Close preview">×</button>
      <div class="media-content"></div>
      <div class="media-caption"></div>
    </div>
  `;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-hidden", "true");
  document.body.appendChild(overlay);

  const frame = overlay.querySelector(".media-frame");
  const content = overlay.querySelector(".media-content");
  const captionEl = overlay.querySelector(".media-caption");
  const closeBtn = overlay.querySelector(".media-close");
  frame?.setAttribute("tabindex", "-1");

  const close = () => {
    overlay.classList.remove("show");
    content.innerHTML = "";
    captionEl.textContent = "";
    overlay.setAttribute("aria-hidden", "true");
    frame?.blur();
  };

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });

  closeBtn.addEventListener("click", close);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && overlay.classList.contains("show")) {
      close();
    }
  });

  function open(type, src, caption) {
    if (!src) return;
    content.innerHTML = "";
    let node = null;

    if (type === "image") {
      node = document.createElement("img");
      node.src = src;
      node.alt = caption || "Image preview";
      node.loading = "lazy";
    } else if (type === "video") {
      node = document.createElement("video");
      node.src = src;
      node.controls = true;
      node.playsInline = true;
      node.autoplay = true;
      node.setAttribute("controlsList", "nodownload");
    } else if (type === "audio") {
      node = document.createElement("audio");
      node.src = src;
      node.controls = true;
    }

    if (!node) return;
    node.classList.add("lightbox-media");
    content.appendChild(node);
    captionEl.textContent = caption || "";
    overlay.classList.add("show");
    overlay.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => frame?.focus?.());

    // If video, try to enter fullscreen when user taps full screen button.
    if (type === "video") {
      requestAnimationFrame(() => node.focus?.());
    }
  }

  return { open, close };
})();

// Hook some core socket events to toasts
socket.on("join error", (msg) => showToast(msg || "Join failed.", "error"));
socket.on("toast", (data) => showToast(data?.text || "", data?.type || "info"));
socket.on("connect", () => {
  showToast("Connected", "success");
  renderPublicRooms([], { state: "loading" });
  socket.emit("request rooms");
});
socket.on("disconnect", () => {
  showToast("Disconnected", "error");
  renderPublicRooms([], { state: "error" });
  hideSearchResults();
});
socket.on("room list", (rooms) => {
  renderPublicRooms(Array.isArray(rooms) ? rooms : []);
});

socket.on("room users", ({ room, users } = {}) => {
  if (room && window.currentRoom && room !== window.currentRoom) return;
  renderUserSidebar(Array.isArray(users) ? users : []);
});

socket.on("user moderation", ({ room, target, action, performedBy, duration } = {}) => {
  if (room && window.currentRoom && room !== window.currentRoom) return;
  if (!action || !target) return;
  if (target === window.currentUser) return;

  const actor = performedBy || "Admin";
  const normalizedAction = action.toLowerCase();
  let message = "";
  if (normalizedAction === "mute") {
    const label = formatDurationLabel(Number(duration) || 0);
    message = `${actor} muted ${target}${label ? ` for ${label}` : ""}.`;
  } else if (normalizedAction === "unmute") {
    message = `${actor} unmuted ${target}.`;
  } else if (normalizedAction === "block") {
    message = `${actor} blocked ${target}.`;
  } else if (normalizedAction === "unblock") {
    message = `${actor} unblocked ${target}.`;
  } else if (normalizedAction === "ban") {
    message = `${actor} banned ${target}.`;
  }

  if (message) {
    const tone = normalizedAction === "ban" || normalizedAction === "block" ? "warn" : "info";
    showToast(message, tone);
  }
});

socket.on("moderation notice", (payload = {}) => {
  handleModerationNotice(payload);
});

function updateQueryParams(room, password) {
  try {
    const params = new URLSearchParams();
    if (room) params.set("room", room);
    if (password) params.set("password", password);
    const query = params.toString();
    const newUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
    if (window.location.search !== (query ? `?${query}` : "")) {
      window.history.replaceState({}, "", newUrl);
    }
  } catch (err) {
    console.warn("[URL] Unable to update query params", err);
  }
}

function showLanding({ focusUsername = true } = {}) {
  isViewingChat = false;
  appState.isAdmin = false;
  clearReplyTarget();
  if (copyJoinLinkBtn) copyJoinLinkBtn.disabled = true;
  if (chatContainer) chatContainer.style.display = "none";
  if (usernamePrompt) usernamePrompt.style.display = "flex";
  if (roomName) roomName.textContent = lastRoomName ? `#${lastRoomName}` : "";
  hideSearchResults();
  if (pinnedContainer) {
    pinnedContainer.innerHTML = "";
    pinnedContainer.style.display = "none";
  }
  resetMessageReadObserver();
  if (messages) {
    messages.innerHTML = "";
    delete messages.dataset.lastDateKey;
  }
  renderUserSidebar([]);

  window.currentUser = null;
  window.currentRoom = null;
  window.currentPassword = lastRoomPassword || "";

  if (roomInput) roomInput.value = lastRoomName || "";
  if (passwordInput) passwordInput.value = lastRoomPassword || "";
  if (usernameInput) usernameInput.value = "";
  if (focusUsername) usernameInput?.focus();

  updateQueryParams(lastRoomName, lastRoomPassword);

  if (socket?.connected) {
    socket.emit("request rooms");
  }
}

async function copyTextToClipboard(text) {
  if (!text) return false;
  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn("[Clipboard] Async copy failed", err);
    }
  }

  const temp = document.createElement("textarea");
  temp.value = text;
  temp.setAttribute("readonly", "readonly");
  temp.style.position = "fixed";
  temp.style.opacity = "0";
  document.body.appendChild(temp);
  temp.focus();
  temp.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch (err) {
    console.warn("[Clipboard] Fallback copy failed", err);
  }
  document.body.removeChild(temp);
  return copied;
}

function scrollMessagesToBottom({ behavior = "auto", delay = 0 } = {}) {
  if (!messages) return;

  const performScroll = () => {
    try {
      messages.scrollTo({ top: messages.scrollHeight, behavior });
    } catch {
      messages.scrollTop = messages.scrollHeight;
    }
  };

  if (delay > 0) {
    setTimeout(() => requestAnimationFrame(performScroll), delay);
  } else {
    requestAnimationFrame(() => requestAnimationFrame(performScroll));
  }
}

function observeMediaForScroll(node) {
  if (!node) return;
  const media = node.querySelectorAll?.("img, video") || [];
  media.forEach((el) => {
    const tag = el.tagName?.toLowerCase();
    if (tag === "img" && el.complete) return;
    if (tag === "video" && el.readyState >= 2) return;

    const handleReady = () => {
      scrollMessagesToBottom();
      el.removeEventListener("load", handleReady);
      el.removeEventListener("loadeddata", handleReady);
    };

    el.addEventListener("load", handleReady);
    el.addEventListener("loadeddata", handleReady);
  });
}

// ===== JOIN ROOM (with corrections for transition) =====

function completeRoomJoin(username, room, password) {
  window.currentUser = username;
  window.currentRoom = room;
  window.currentPassword = password;

  lastRoomName = room;
  lastRoomPassword = password;
  isViewingChat = true;
  if (copyJoinLinkBtn) copyJoinLinkBtn.disabled = !room;

  appState.isAdmin = false;
  loadHiddenMessagesForRoom(room);
  appState.messages.clear();
  appState.pinned.clear();
  hideSearchResults();
  resetMessageReadObserver();
  if (messages) {
    messages.innerHTML = "";
    delete messages.dataset.lastDateKey;
  }
  if (pinnedContainer) {
    pinnedContainer.innerHTML = "";
    pinnedContainer.style.display = "none";
  }
  renderUserSidebar([]);

  updateQueryParams(room, password);

  if (roomName) roomName.textContent = room ? `#${room}` : "";
  if (usernamePrompt) usernamePrompt.style.display = "none";
  if (chatContainer) chatContainer.style.display = "flex";

  scrollMessagesToBottom({ behavior: "smooth", delay: 200 });
}

function emitJoinRequest() {
  const username = usernameInput?.value.trim();
  const room = roomInput?.value.trim();
  const password = passwordInput?.value.trim() || "";

  if (!username || !room) {
    showToast("Enter a username and room", "error");
    return;
  }

  if (window.currentRoom && window.currentRoom !== room) {
    socket.emit("leave room", { room: window.currentRoom });
  }

  completeRoomJoin(username, room, password);
  socket.emit("join room", { room, username, password });

  const adminPassword = adminPasswordInput?.value.trim();
  if (adminPassword) {
    socket.emit("admin auth", { room, username, adminPassword });
  }
}

function renderPublicRooms(rooms = [], { state = "ready" } = {}) {
  if (!publicRoomList) return;

  publicRoomList.innerHTML = "";

  if (state === "loading") {
    const loadingItem = document.createElement("li");
    loadingItem.className = "empty";
    loadingItem.textContent = "Loading rooms…";
    publicRoomList.appendChild(loadingItem);
    return;
  }

  if (state === "error") {
    const errorItem = document.createElement("li");
    errorItem.className = "empty";
    errorItem.textContent = "Room list unavailable.";
    publicRoomList.appendChild(errorItem);
    return;
  }

  const data = Array.isArray(rooms) ? rooms.filter(Boolean) : [];
  latestPublicRooms = data;

  if (!data.length) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "empty";
    emptyItem.textContent = "No public rooms are open yet.";
    publicRoomList.appendChild(emptyItem);
    return;
  }

  data.forEach((room) => {
    const roomNameValue = typeof room?.name === "string" ? room.name : "";
    if (!roomNameValue) return;

    const occupants = Number(room?.occupants || 0);
    const requiresPassword = Boolean(room?.requiresPassword);

    const item = document.createElement("li");
    item.className = "public-room-item";
    item.dataset.room = roomNameValue;

    const nameEl = document.createElement("span");
    nameEl.className = "room-name";
    nameEl.textContent = roomNameValue;

    const metaEl = document.createElement("span");
    metaEl.className = "room-meta";
    const peopleLabel = occupants === 1 ? "1 online" : `${occupants} online`;
    metaEl.textContent = requiresPassword ? `${peopleLabel} • 🔒` : peopleLabel;

    item.appendChild(nameEl);
    item.appendChild(metaEl);
    item.tabIndex = 0;

    if (requiresPassword) {
      item.classList.add("locked");
      item.title = "Password required";
      const handleLocked = () => {
        if (roomInput) roomInput.value = roomNameValue;
        showToast("Enter your username and the room password to join.", "info");
        if (!usernameInput?.value.trim()) {
          usernameInput?.focus();
        } else {
          passwordInput?.focus();
        }
      };
      item.addEventListener("click", handleLocked);
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleLocked();
        }
      });
    } else {
      item.classList.add("clickable");
      item.title = "Join this room";
      const attemptJoin = () => {
        if (!usernameInput?.value.trim()) {
          showToast("Enter your username first", "error");
          usernameInput?.focus();
          return;
        }

        if (roomInput) roomInput.value = roomNameValue;
        if (passwordInput) passwordInput.value = "";
        emitJoinRequest();
      };

      item.addEventListener("click", attemptJoin);
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          attemptJoin();
        }
      });
    }

    publicRoomList.appendChild(item);
  });
}

if (joinBtn) {
  joinBtn.addEventListener("click", emitJoinRequest);
}

[usernameInput, roomInput, passwordInput, adminPasswordInput]
  .filter(Boolean)
  .forEach((inputEl) => {
    inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        emitJoinRequest();
      }
    });
  });

if (leaveBtn) {
  leaveBtn.addEventListener("click", () => {
    if (window.currentRoom) {
      lastRoomName = window.currentRoom;
      lastRoomPassword = window.currentPassword || "";
      socket.emit("leave room", { room: window.currentRoom });
    }
    clearReplyTarget();
    showLanding({ focusUsername: true });
    showToast("Left the room", "info");
  });
}

if (copyJoinLinkBtn) {
  copyJoinLinkBtn.addEventListener("click", async () => {
    if (!window.currentRoom) {
      showToast("Join a room first to copy its link", "error");
      return;
    }

    const params = new URLSearchParams();
    params.set("room", window.currentRoom);
    if (window.currentPassword) {
      params.set("password", window.currentPassword);
    }

    const shareQuery = params.toString();
    const shareUrl = `${window.location.origin}${window.location.pathname}${
      shareQuery ? `?${shareQuery}` : ""
    }`;

    const copied = await copyTextToClipboard(shareUrl);
    if (copied) {
      showToast("Join link copied!", "success");
    } else {
      showToast("Unable to copy link", "error");
    }
  });
}

// Listen for successful room join
socket.on("join room success", () => {
  clearReplyTarget();
  isViewingChat = true;
  if (copyJoinLinkBtn) copyJoinLinkBtn.disabled = !window.currentRoom;
  if (chatContainer) chatContainer.style.display = "flex";
  if (usernamePrompt) usernamePrompt.style.display = "none";
  input?.focus();
  scrollMessagesToBottom({ behavior: "smooth", delay: 80 });
});

// Join error handling
socket.on("join room error", (error) => {
  showToast(error || "Unable to join room", "error");
  showLanding({ focusUsername: true });
});

// Handle disconnect and clean up
socket.on("disconnect", () => {
  showLanding({ focusUsername: false });
  hideSearchResults();
});

// If coming in with globals set (deep-link), auto-join
if (window.currentRoom && window.currentUser) {
  completeRoomJoin(
    window.currentUser,
    window.currentRoom,
    window.currentPassword || ""
  );
  socket.emit("join room", {
    room: window.currentRoom,
    username: window.currentUser,
    password: window.currentPassword || "",
  });
}

// ------------------- Theme Toggle -------------------
const storedTheme = (() => {
  try {
    return localStorage.getItem("dizychat-theme");
  } catch {
    return null;
  }
})();

const applyTheme = (mode, { persist = true } = {}) => {
  const chosen = mode === "light" ? "light" : "dark";
  const isDark = chosen !== "light";
  document.body.classList.toggle("dark", isDark);
  document.body.classList.toggle("light", !isDark);
  document.body.setAttribute("data-theme", chosen);

  if (document.documentElement) {
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";
  }

  if (themeToggle) {
    themeToggle.textContent = isDark ? "☀️" : "🌙";
    themeToggle.setAttribute(
      "aria-label",
      isDark ? "Switch to light mode" : "Switch to dark mode"
    );
    themeToggle.setAttribute("aria-pressed", String(isDark));
    themeToggle.title = isDark ? "Switch to light mode" : "Switch to dark mode";
  }

  themeLogos.forEach((img) => {
    const darkSrc = img.dataset.darkSrc || img.getAttribute("data-dark-src") || img.src;
    const lightSrc = img.dataset.lightSrc || img.getAttribute("data-light-src");
    if (lightSrc) {
      img.src = isDark ? darkSrc : lightSrc;
    } else {
      img.src = isDark ? darkSrc : img.src;
    }
  });

  if (persist) {
    try {
      localStorage.setItem("dizychat-theme", chosen);
    } catch {
      /* ignore persistence errors */
    }
  }
};

const initialTheme = storedTheme || (document.body.classList.contains("dark") ? "dark" : "light");
applyTheme(initialTheme, { persist: Boolean(storedTheme) });

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const nextMode = document.body.classList.contains("dark") ? "light" : "dark";
    applyTheme(nextMode);
  });
}

// ------------------- Emoji Picker Toggle -------------------
if (emojiBtn && emojiPicker) {
  const quickEmojiBar = emojiPicker.querySelector("#quick-emojis");
  if (quickEmojiBar) {
    quickEmojiBar.hidden = true;
    quickEmojiBar.setAttribute("aria-hidden", "true");
  }

  const hideEmojiPicker = () => {
    emojiPicker.classList.remove("show");
    emojiPicker.style.display = "none";
    emojiSearch.value = "";
    if (emojiCatalogLoaded) {
      renderEmojiList(emojiEntries);
    }
  };

  const showEmojiPicker = () => {
    emojiPicker.classList.add("show");
    emojiPicker.style.display = "block";
    requestAnimationFrame(() => {
      emojiSearch.focus({ preventScroll: true });
    });
  };

  const emojiSearch = document.createElement("input");
  emojiSearch.type = "search";
  emojiSearch.id = "emoji-search";
  emojiSearch.placeholder = "Search emoji…";
  emojiPicker.appendChild(emojiSearch);

  const emojiCatalog = document.createElement("div");
  emojiCatalog.id = "emoji-catalog";
  emojiPicker.appendChild(emojiCatalog);

  const emojiEntries = [];
  let emojiCatalogLoaded = false;

  const renderEmojiList = (list) => {
    emojiCatalog.innerHTML = "";
    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "emoji-empty";
      empty.textContent = "No emoji found";
      emojiCatalog.appendChild(empty);
      return;
    }

    const grouped = list.reduce((acc, item) => {
      const key = item.category || "Emojis";
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});

    Object.entries(grouped).forEach(([category, items]) => {
      const section = document.createElement("section");
      section.className = "emoji-category";

      const title = document.createElement("h4");
      title.className = "emoji-category-title";
      title.textContent = category;
      section.appendChild(title);

      const grid = document.createElement("div");
      grid.className = "emoji-grid";

      items.forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "emoji-item";
        button.title = item.name || "";

        if (item.char) {
          button.textContent = item.char;
        } else if (item.url) {
          const img = document.createElement("img");
          img.src = item.url;
          img.alt = item.name || "emoji";
          img.loading = "lazy";
          button.appendChild(img);
        }

        button.addEventListener("click", () => {
          if (item.char && input) {
            input.value = `${input.value || ""}${item.char}`;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.focus();
            hideEmojiPicker();
            return;
          }

          if (item.url && window.currentRoom && window.currentUser) {
            socket.emit("chat message", {
              room: window.currentRoom,
              user: window.currentUser,
              text: item.url,
              timestamp: Date.now(),
            });
            showToast(`${item.name || "Emoji"} sent`, "success");
            hideEmojiPicker();
          }
        });

        grid.appendChild(button);
      });

      section.appendChild(grid);
      emojiCatalog.appendChild(section);
    });
  };

  const loadEmojiCatalog = async () => {
    if (emojiCatalogLoaded) return;
    try {
      emojiCatalog.innerHTML = "<div class=\"emoji-empty\">Loading…</div>";
      const response = await fetch("/emojis.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      Object.entries(data || {}).forEach(([category, items]) => {
        if (!Array.isArray(items)) return;
        items.forEach((item) => {
          emojiEntries.push({
            ...item,
            category,
          });
        });
      });
      renderEmojiList(emojiEntries);
      emojiCatalogLoaded = true;
      if (quickEmojiBar) {
        quickEmojiBar.hidden = true;
        quickEmojiBar.setAttribute("aria-hidden", "true");
      }
    } catch (err) {
      console.error("[Emoji Picker] Failed to load", err);
      emojiCatalog.innerHTML = "<div class=\"emoji-empty\">Unable to load emoji.</div>";
      if (quickEmojiBar) {
        quickEmojiBar.hidden = false;
        quickEmojiBar.removeAttribute("aria-hidden");
      }
    }
  };

  emojiSearch.addEventListener("input", (event) => {
    const query = event.target.value.trim().toLowerCase();
    if (!query) {
      renderEmojiList(emojiEntries);
      return;
    }

    const filtered = emojiEntries.filter((item) => {
      const byName = item.name && item.name.toLowerCase().includes(query);
      const byEmoji = item.char && item.char.toLowerCase().includes(query);
      return byName || byEmoji;
    });
    renderEmojiList(filtered);
  });

  emojiBtn.addEventListener("click", (event) => {
    event.preventDefault();
    if (emojiPicker.classList.contains("show")) {
      hideEmojiPicker();
    } else {
      showEmojiPicker();
      loadEmojiCatalog();
    }
  });

  document.addEventListener("click", (event) => {
    if (!emojiPicker.classList.contains("show")) return;
    if (event.target === emojiBtn) return;
    if (emojiPicker.contains(event.target)) return;
    hideEmojiPicker();
  });

  const quickEmojiButtons = emojiPicker.querySelectorAll("#quick-emojis button");
  quickEmojiButtons.forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      const emoji = btn.textContent?.trim();
      if (!emoji) return;
      if (input) {
        input.value = `${input.value || ""}${emoji}`;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
      }
      hideEmojiPicker();
    });
  });
}

// ------------------- Sending Messages -------------------
if (form) {
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = (input?.value || "").trim();
    if (!text) return;
    const replyTo = normalizeMessageId(replyState.targetId) || undefined;
    socket.emit("chat message", {
      room: window.currentRoom,
      user: window.currentUser,
      text,
      timestamp: Date.now(),
      replyTo,
    });
    input.value = "";
    clearReplyTarget();
    socket.emit("stop typing");
  });
}

// ------------------- Typing Indicator -------------------
input?.addEventListener("input", () => {
  if (!isTyping) {
    socket.emit("typing", window.currentUser);
    isTyping = true;
  }
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit("stop typing");
    isTyping = false;
  }, 1500);
});

socket.on("typing", (users) => {
  const bubble = document.getElementById("typing-bubble");
  if (!bubble) return;
  const others = (users || []).filter((u) => u && u !== window.currentUser);
  if (!others.length) {
    bubble.classList.remove("show");
    bubble.classList.add("hide");
    return;
  }
  bubble.textContent =
    others.length === 1 ? `${others[0]} is typing…` : `${others.join(", ")} are typing…`;
  bubble.classList.remove("hide");
  bubble.classList.add("show");
});

// ------------------- Inline Preview Helpers -------------------
function hasInlinePreview(node, url) {
  if (!node || !url) return false;
  return Array.from(node.querySelectorAll(".inline-preview")).some(
    (el) => el.dataset?.src === url || el.dataset?.tenorSource === url
  );
}

function createInlinePreview(link, type, labelText) {
  if (!link || !type) return null;

  const container = document.createElement("div");
  container.className = `inline-preview inline-${type}`;
  container.dataset.src = link;

  const mediaWrap = document.createElement("div");
  mediaWrap.className = "preview-media";
  container.appendChild(mediaWrap);

  if (type === "image") {
    const img = document.createElement("img");
    img.src = link;
    img.alt = labelText || "Embedded image";
    img.loading = "lazy";
    mediaWrap.appendChild(img);
    mediaWrap.addEventListener("click", (event) => {
      if (event.target.closest(".preview-actions")) return;
      MediaLightbox.open("image", link, labelText);
    });
  } else if (type === "video") {
    const video = document.createElement("video");
    video.src = link;
    video.controls = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.preload = "metadata";
    video.setAttribute("controlsList", "nodownload");
    video.addEventListener("dblclick", (event) => {
      event.preventDefault();
      MediaLightbox.open("video", link, labelText);
    });
    mediaWrap.appendChild(video);
  } else if (type === "audio") {
    const audio = document.createElement("audio");
    audio.src = link;
    audio.controls = true;
    audio.preload = "metadata";
    mediaWrap.appendChild(audio);
  } else {
    const label = document.createElement("span");
    label.className = "preview-label";

    const linkText = labelText || type.toUpperCase();
    if (linkText && link && type !== "placeholder") {
      const anchor = document.createElement("a");
      anchor.href = link;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.textContent = linkText;
      anchor.className = "preview-link";
      label.appendChild(anchor);
    } else {
      label.textContent = linkText;
    }

    mediaWrap.appendChild(label);
  }

  return container;
}

function replaceCustomEmojiLinks(textEl) {
  if (!textEl) return null;

  textEl.classList.remove("has-emoji-gif", "emoji-gif-only");

  const original = textEl.textContent || "";
  if (!original.trim()) return null;

  const pattern = /(https?:\/\/[\w.-]+(?::\d+)?\/[\w\-./%]+|\/?emojis\/custom\/[\w\-./%]+|emojis\/custom\/[\w\-./%]+)/gi;
  let match;
  let lastIndex = 0;
  const fragment = document.createDocumentFragment();
  let hasEmoji = false;
  let hasGif = false;
  let onlyEmoji = true;

  const appendTextSegment = (segment) => {
    if (!segment) return;
    fragment.appendChild(document.createTextNode(segment));
    if (segment.trim()) {
      onlyEmoji = false;
    }
  };

  while ((match = pattern.exec(original)) !== null) {
    const [rawLink] = match;
    const start = match.index;

    if (start > lastIndex) {
      appendTextSegment(original.slice(lastIndex, start));
    }

    const normalizedLink = (() => {
      let link = rawLink.trim();
      if (!link) return null;

      if (!/^https?:\/\//i.test(link)) {
        link = link.startsWith("/") ? link : `/${link}`;
      }

      if (!/\/emojis\/custom\//i.test(link)) return null;

      try {
        const url = new URL(link, window.location.origin);
        return url.toString();
      } catch (err) {
        console.warn("[Emoji] Failed to normalise link", link, err);
        return null;
      }
    })();

    if (normalizedLink) {
      const img = document.createElement("img");
      img.src = normalizedLink;
      img.alt = (() => {
        try {
          const url = new URL(normalizedLink);
          const file = url.pathname.split("/").pop() || "emoji";
          return decodeURIComponent(file.replace(/\.[^.]+$/, ""));
        } catch (err) {
          return "emoji";
        }
      })();
      img.title = img.alt || "Emoji";
      img.loading = "lazy";
      img.decoding = "async";
      img.className = "custom-emoji";

      try {
        const url = new URL(normalizedLink, window.location.origin);
        const path = url.pathname.toLowerCase();
        if (path.endsWith(".gif") && (path.includes("/uploads/") || path.includes("/emojis/"))) {
          img.classList.add("custom-emoji-gif");
          hasGif = true;
        }
      } catch {
        /* noop */
      }

      fragment.appendChild(img);
      hasEmoji = true;
    } else {
      appendTextSegment(rawLink);
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < original.length) {
    appendTextSegment(original.slice(lastIndex));
  }

  if (!hasEmoji) return null;

  textEl.textContent = "";
  textEl.appendChild(fragment);

  if (hasGif) {
    textEl.classList.add("has-emoji-gif");
    if (onlyEmoji) {
      textEl.classList.add("emoji-gif-only");
    }
  }

  return { hasEmoji, hasGif, onlyEmoji };
}

function updateTenorBubbleState(node) {
  if (!node) return;
  const isMessage = node.classList && node.classList.contains("message");
  let message = null;
  if (isMessage) {
    message = node;
  } else if (typeof node.closest === "function") {
    message = node.closest(".message");
  }
  if (!message) return;

  const hasAnyPreview = message.querySelector(".inline-preview");
  const hasTenorPreview = message.querySelector(".inline-preview.tenor-inline");

  const textEl = message.querySelector(".text");
  const textVisible =
    textEl &&
    textEl.style.display !== "none" &&
    (textEl.textContent || "").trim().length > 0;

  if (!hasAnyPreview || textVisible) {
    message.classList.remove("media-only");
    message.classList.remove("tenor-only");
    return;
  }

  message.classList.add("media-only");

  if (hasTenorPreview) {
    message.classList.add("tenor-only");
  } else {
    message.classList.remove("tenor-only");
  }
}

function attachPreviewActions(preview, { link, label, type } = {}) {
  if (!preview || !link) return;
  if (preview.dataset.placeholder === "1") return;

  const actions = document.createElement("div");
  actions.className = "preview-actions";

  const allowExpand = type === "image" || type === "video";
  if (allowExpand) {
    const expand = document.createElement("button");
    expand.type = "button";
    expand.className = "preview-open";
    expand.textContent = type === "video" ? "Full screen" : "View";
    expand.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      MediaLightbox.open(type, link, label);
    });
    actions.appendChild(expand);
  }

  const download = document.createElement("a");
  download.href = link;
  download.target = "_blank";
  download.rel = "noopener noreferrer";
  download.className = "preview-download";
  download.setAttribute("download", "");
  download.textContent = label ? `Download` : "Download";
  actions.appendChild(download);

  preview.appendChild(actions);

  if (label) {
    const caption = document.createElement("div");
    caption.className = "preview-caption";
    caption.textContent = label;
    preview.appendChild(caption);
  }
}

const tenorPreviewCache = new Map();

function fetchTenorPreview(link, node) {
  if (!link || !node || hasInlinePreview(node, link)) return;

  if (tenorPreviewCache.has(link)) {
    const cached = tenorPreviewCache.get(link);
    if (!cached) return;
    if (hasInlinePreview(node, cached)) return;
    const cachedPreview = createInlinePreview(cached, /\.(mp4|webm)$/i.test(cached) ? "video" : "image");
    if (cachedPreview) {
      cachedPreview.dataset.tenorSource = link;
      cachedPreview.classList.add("tenor-inline");
      const previewType = cachedPreview.classList.contains("inline-video") ? "video" : "image";
      if (!cachedPreview.querySelector(".preview-actions")) {
        attachPreviewActions(cachedPreview, { link: cached, type: previewType });
      }
      node.appendChild(cachedPreview);
      node.classList.add("has-inline-preview");
      updateTenorBubbleState(node);
      observeMediaForScroll(node);
      scrollMessagesToBottom();
    }
    return;
  }

  const placeholder = createInlinePreview(link, "file", "Loading GIF…");
  if (placeholder) {
    placeholder.dataset.tenorSource = link;
    placeholder.dataset.placeholder = "1";
    placeholder.classList.add("tenor-inline", "tenor-loading");
    node.appendChild(placeholder);
    node.classList.add("has-inline-preview");
    updateTenorBubbleState(node);
  }

  fetch(`/tenor-proxy?url=${encodeURIComponent(link)}`)
    .then((res) => res.json())
    .then(({ gif, tinyGif }) => {
      const direct = gif || tinyGif || "";
      tenorPreviewCache.set(link, direct || null);

      if (!direct) {
        if (placeholder) {
          const label = placeholder.querySelector(".preview-label");
          if (label) label.textContent = "GIF unavailable";
        }
        return;
      }

      const previewType = /\.(mp4|webm)$/i.test(direct) ? "video" : "image";
      const preview = createInlinePreview(direct, previewType);
      if (!preview) return;
      preview.dataset.tenorSource = link;
      preview.classList.add("tenor-inline");
      if (!preview.querySelector(".preview-actions")) {
        attachPreviewActions(preview, { link: direct, type: previewType });
      }

      if (placeholder && placeholder.parentNode === node) {
        node.replaceChild(preview, placeholder);
      } else if (!hasInlinePreview(node, direct)) {
        node.appendChild(preview);
      }
      node.classList.add("has-inline-preview");
      updateTenorBubbleState(node);
      observeMediaForScroll(node);
      scrollMessagesToBottom();
    })
    .catch(() => {
      tenorPreviewCache.set(link, null);
      if (placeholder) {
        const label = placeholder.querySelector(".preview-label");
        if (label) label.textContent = "GIF unavailable";
      }
      updateTenorBubbleState(node);
    });
}

function appendAttachmentFromMessage(node, msg) {
  if (!node || !msg?.fileUrl) return;
  const url = msg.fileUrl;
  const typeHint = (msg.fileType || "").toLowerCase();
  const isTenor = /tenor\.com/i.test(url);

  let previewType = "";
  const imagePattern = /\.(png|jpg|jpeg|gif|webp|bmp|svg)(\?.*)?$/i;
  if (typeHint.startsWith("image/") || imagePattern.test(url)) {
    previewType = "image";
  } else if (typeHint.startsWith("video/") || /\.(mp4|webm|mov)(\?.*)?$/i.test(url)) {
    previewType = "video";
  } else if (typeHint.startsWith("audio/") || /\.(mp3|wav|ogg)(\?.*)?$/i.test(url)) {
    previewType = "audio";
  } else if (typeHint.includes("pdf") || /\.(pdf)(\?.*)?$/i.test(url)) {
    previewType = "pdf";
  } else if (url) {
    previewType = "file";
  }

  if (!previewType || hasInlinePreview(node, url)) return;

  if (previewType === "image" && !imagePattern.test(url)) {
    if (/tenor\.com/i.test(url)) {
      fetchTenorPreview(url, node);
    }
    return;
  }

  const label = isTenor ? "" : (msg.fileName || "").trim();
  const preview = createInlinePreview(url, previewType, label);
  if (!preview) return;
  if (isTenor) {
    preview.classList.add("tenor-inline");
  }

  attachPreviewActions(preview, { link: url, label, type: previewType });
  node.appendChild(preview);
  node.classList.add("has-inline-preview");

  const textEl = node.querySelector(".text");
  if (textEl && textEl.textContent?.trim() === url.trim()) {
    textEl.textContent = "";
    textEl.style.display = "none";
  }

  updateTenorBubbleState(node);
}

// ------------------- History & Messages -------------------
function renderMessage(msg, { skipScroll = false, scrollBehavior = "auto", delay = 0 } = {}) {
  if (!isViewingChat || !messages) return;
  const data = storeMessageData(msg);
  if (!data) return;
  if (appState.hidden.has(data.id)) {
    appState.pinned.delete(data.id);
    updatePinnedBanner();
    return;
  }

  const timestamp = new Date(data.timestamp || Date.now());
  ensureDaySeparator(timestamp);
  const timeLabel = Number.isNaN(timestamp.getTime())
    ? new Date().toLocaleTimeString()
    : timestamp.toLocaleTimeString();

  const isSelf = data.user === window.currentUser;
  const initialStatus = normalizeMessageStatus(data.status);
  const wrap = document.createElement("div");
  wrap.className = `message ${isSelf ? "self" : "other"}`;
  wrap.dataset.id = data.id;
  wrap.dataset.status = initialStatus;
  if (data.deleted) {
    wrap.dataset.deleted = "true";
  }

  const statusMarkup = isSelf ? '<span class="meta-status"></span>' : "";
  wrap.innerHTML = `
    <div class="meta">
      <span class="meta-name">${data.user || "Anon"}</span>
      <div class="meta-right">
        <span class="meta-time">${timeLabel}</span>
        ${statusMarkup}
      </div>
    </div>
    <div class="text"></div>
    <div class="message-flags"></div>
  `;

  const textEl = wrap.querySelector(".text");
  if (textEl) {
    if (data.deleted) {
      textEl.classList.add("hidden");
      const deleted = document.createElement("div");
      deleted.className = "deleted-label";
      deleted.textContent = "Message deleted";
      wrap.appendChild(deleted);
    } else {
      textEl.style.removeProperty("display");
      textEl.textContent = data.text || "";
      const emojiInfo = replaceCustomEmojiLinks(textEl);
      if (emojiInfo?.hasGif) {
        wrap.classList.add("has-emoji-gif");
        if (emojiInfo.onlyEmoji) {
          wrap.classList.add("emoji-gif-only");
        }
      }
      linkifyTextContent(textEl);
    }
  }

  applyReplyContext(wrap, data);

  messages.appendChild(wrap);
  applyMessageStatus(wrap, data);
  setupMessageActions(wrap, data);
  updateMessageFlags(wrap, data);
  trackMessageRead(wrap, data);

  if (!data.deleted) {
    appendAttachmentFromMessage(wrap, data);
    autoEmbed(wrap);
    observeMediaForScroll(wrap);
  }

  if (!skipScroll) {
    scrollMessagesToBottom({ behavior: scrollBehavior, delay });
  }

  updatePinnedBanner();
}

socket.on("load messages", (arr) => {
  if (!isViewingChat || !messages) return;
  clearReplyTarget();
  appState.messages.clear();
  appState.pinned.clear();
  messages.innerHTML = "";
  delete messages.dataset.lastDateKey;
  (arr || []).forEach((entry) => renderMessage(entry, { skipScroll: true }));
  updatePinnedBanner();
  scrollMessagesToBottom({ behavior: "auto", delay: 120 });
  showToast(`✅ Joined room: ${window.currentRoom}`, "success");
});

socket.on("previous messages", (arr) => {
  if (!isViewingChat || !messages) return;
  if (!messages.childElementCount) {
    (arr || []).forEach((entry) => renderMessage(entry, { skipScroll: true }));
    updatePinnedBanner();
    scrollMessagesToBottom({ behavior: "auto", delay: 80 });
  }
});

socket.on("chat message", (msg) => {
  if (!isViewingChat) return;
  renderMessage(msg, { scrollBehavior: "smooth" });
});

socket.on("message status", ({ id, status }) => {
  if (!id) return;
  const data = storeMessageData({ id, status });
  if (data) updateMessageNode(id);
});

socket.on("edit message", ({ id, text }) => {
  if (!id) return;
  const data = storeMessageData({ id, text });
  if (!data) return;
  updateMessageNode(data.id);
  showToast("Message edited", "info");
});

socket.on("delete message", (payload) => {
  const id = typeof payload === "string" ? payload : payload?.id;
  if (!id) return;
  storeMessageData({ id, deleted: true });
  updateMessageNode(id);
  updatePinnedBanner();
  showToast("Message deleted", "info");
});

socket.on("delete message local", ({ id }) => {
  if (!id) return;
  hideMessageLocally(id);
});

socket.on("pinned messages", (arr = []) => {
  appState.pinned.clear();
  (arr || []).forEach((entry) => {
    const data = storeMessageData({ ...entry, pinned: true });
    if (data) updateMessageNode(data.id);
  });
  updatePinnedBanner();
});

socket.on("message pinned", (msg) => {
  const data = storeMessageData({ ...msg, pinned: true });
  if (!data) return;
  updateMessageNode(data.id);
  updatePinnedBanner();
  showToast("Message pinned", "info");
});

socket.on("message unpinned", (msg) => {
  const data = storeMessageData({ ...msg, pinned: false });
  if (!data) return;
  updateMessageNode(data.id);
  updatePinnedBanner();
});

socket.on("message starred", ({ id, starredBy = [] }) => {
  const data = storeMessageData({ id, starredBy });
  if (!data) return;
  updateMessageNode(data.id);
});

socket.on("message unstarred", ({ id, starredBy = [] }) => {
  const data = storeMessageData({ id, starredBy });
  if (!data) return;
  updateMessageNode(data.id);
});

socket.on("search results", ({ room, results } = {}) => {
  if (room && window.currentRoom && room !== window.currentRoom) return;
  renderSearchResults(results || []);
});

socket.on("admin status", ({ isAdmin }) => {
  const previous = appState.isAdmin;
  appState.isAdmin = Boolean(isAdmin);
  refreshActionMenus();
  renderUserSidebar(appState.users);
  if (appState.isAdmin && !previous) {
    showToast("Admin mode enabled", "success");
  } else if (!appState.isAdmin && previous) {
    showToast("Admin mode disabled", "info");
  }
});

// ------------------- File Uploads (paperclip) -------------------
if (attachBtn && fileInput) {
  fileInput.accept = "*/*";
  attachBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    showToast(`Uploading ${file.name}…`, "info");

    // Visual progress overlay (purple)
    const progress = document.createElement("div");
    progress.className = "upload-progress";
    progress.innerHTML = `<div class="bar" style="width:0%"></div><span style="display:none"></span>`;
    document.body.appendChild(progress);
    const bar = progress.querySelector(".bar");

    const formData = new FormData();
    formData.append("file", file);

    try {
      // Simple fetch (Render may not support chunk progress). Simulate bar fill:
      let fake = 0;
      const fakeTimer = setInterval(() => {
        fake = Math.min(fake + 7, 90);
        if (bar) bar.style.width = fake + "%";
        if (fake >= 90) clearInterval(fakeTimer);
      }, 120);

      const response = await fetch("/upload", { method: "POST", body: formData });
      const data = await response.json();

      if (!response.ok || data.error) throw new Error(data.error || "Upload failed");

      if (bar) bar.style.width = "100%";
      setTimeout(() => progress.remove(), 800);

      showToast(`Uploaded: ${file.name}`, "success");

      const replyTo = normalizeMessageId(replyState.targetId) || undefined;
      socket.emit("chat message", {
        room: window.currentRoom,
        user: window.currentUser,
        text: data.url,
        timestamp: Date.now(),
        fileUrl: data.url,
        fileType: data.type || file.type || "",
        fileName: data.name || file.name || "",
        replyTo,
      });

      fileInput.value = "";
      clearReplyTarget();
    } catch (err) {
      console.error("[Upload Error]", err);
      showToast(`Upload failed: ${file.name}`, "error");
      progress.remove();
    }
  });
}

// ------------------- Tenor GIF Picker (beside emoji) -------------------
(() => {
  const TENOR_API_KEY = "LIVDSRZULELA"; // test key (can move to .env later)
  if (!emojiBtn || !form) return;

  const gifBtn = (() => {
    const existing = document.getElementById("gif-btn");
    if (existing) return existing;
    const created = document.createElement("button");
    created.id = "gif-btn";
    created.type = "button";
    created.textContent = "GIF";
    created.style.marginLeft = "6px";
    emojiBtn.insertAdjacentElement("afterend", created);
    return created;
  })();

  const panel = document.createElement("div");
  panel.id = "gif-picker";
  panel.innerHTML = `
    <div class="gif-search"><input id="gif-search-input" placeholder="Search GIFs…"></div>
    <div id="gif-grid" class="gif-grid"></div>`;
  document.body.appendChild(panel);

  function positionPanel() {
    const rect = form.getBoundingClientRect();
    panel.style.position = "fixed";
    panel.style.left = rect.left + 8 + "px";
    panel.style.bottom = window.innerHeight - rect.top + 10 + "px";
    panel.style.display = "block";
  }

  async function loadTenor(endpoint) {
    try {
      const res = await fetch(endpoint);
      const data = await res.json();
      const grid = document.getElementById("gif-grid");
      grid.innerHTML = "";
      (data.results || []).forEach((g) => {
        const thumb =
          g?.media_formats?.tinygif?.url ||
          g?.media_formats?.gif?.url ||
          g?.media?.[0]?.tinygif?.url ||
          g?.media?.[0]?.gif?.url;
        if (!thumb) return;
        const img = document.createElement("img");
        img.src = thumb;
        img.alt = "gif";
        img.className = "gif-thumb";
        img.onclick = () => {
          const directGif =
            g?.media_formats?.gif?.url ||
            g?.media?.[0]?.gif?.url ||
            g?.media_formats?.tinygif?.url ||
            g?.media?.[0]?.tinygif?.url;
          const videoVariant =
            g?.media_formats?.mp4?.url ||
            g?.media_formats?.mediumgif?.url ||
            g?.media?.[0]?.mp4?.url;

          const url = directGif || videoVariant || thumb;
          if (!url) return;

          const isVideo = /\.(mp4|webm)$/i.test(url);
          const gifLabel = (g?.content_description || "GIF").trim() || "GIF";
          const labelWithExt = isVideo ? `${gifLabel}.mp4` : `${gifLabel}.gif`;

          socket.emit("chat message", {
            room: window.currentRoom,
            user: window.currentUser,
            text: url,
            timestamp: Date.now(),
            fileUrl: url,
            fileType: isVideo ? "video/mp4" : "image/gif",
            fileName: labelWithExt,
          });
          showToast("GIF added", "success");
          panel.style.display = "none";
          input?.focus();
        };
        grid.appendChild(img);
      });
    } catch (e) {
      const grid = document.getElementById("gif-grid");
      grid.innerHTML = '<div class="gif-error">GIFs failed to load.</div>';
      console.log("[GIF] Tenor error:", e);
    }
  }

  gifBtn.onclick = () => {
    if (panel.style.display === "block") {
      panel.style.display = "none";
      return;
    }
    positionPanel();
    if (!panel.dataset.loaded) {
      loadTenor(`https://g.tenor.com/v1/trending?key=${TENOR_API_KEY}&limit=24`);
      panel.dataset.loaded = "1";
    }
  };

  const searchInput = panel.querySelector("#gif-search-input");
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const q = searchInput.value.trim();
      if (!q) return;
      loadTenor(
        `https://g.tenor.com/v1/search?q=${encodeURIComponent(q)}&key=${TENOR_API_KEY}&limit=24`
      );
    }
  });

  window.addEventListener("resize", () => {
    if (panel.style.display === "block") positionPanel();
  });
})();

// ------------------- Embeds & Link Cards -------------------
function autoEmbed(node) {
  const textEl = node.querySelector(".text") || node;
  const txt = textEl ? textEl.textContent : "";
  if (!txt) return;

  const links = (txt.match(/https?:\/\/\S+/g) || []).slice(0, 3);
  if (!links.length) return;

  const wrap = document.createElement("div");
  wrap.className = "embed-wrap";

  const linkAnchors = document.createElement("div");
  linkAnchors.className = "embed-links";
  const anchorsByLink = new Map();

  const seenLinks = new Set();
  let wrapAdded = false;
  let anchorsAttached = false;
  const ensureWrap = () => {
    if (!wrapAdded) {
      node.appendChild(wrap);
      node.classList.add("has-inline-preview");
      observeMediaForScroll(node);
      scrollMessagesToBottom();
      wrapAdded = true;
    }
  };

  const attachAnchors = () => {
    if (!anchorsAttached) {
      wrap.insertBefore(linkAnchors, wrap.firstChild);
      anchorsAttached = true;
    }
    ensureWrap();
  };

  const normalizeLinkKey = (url) => {
    try {
      return new URL(url).href;
    } catch {
      return url;
    }
  };

  const detachAnchorsIfEmpty = () => {
    if (anchorsAttached && !linkAnchors.childElementCount) {
      linkAnchors.remove();
      anchorsAttached = false;
    }
  };

  const removeAnchorFor = (url) => {
    const key = normalizeLinkKey(url);
    const anchor = anchorsByLink.get(key);
    if (anchor && anchor.parentNode === linkAnchors) {
      linkAnchors.removeChild(anchor);
      anchorsByLink.delete(key);
      detachAnchorsIfEmpty();
    }
  };

  let hasTenorLink = false;
  const textAnchors = textEl ? Array.from(textEl.querySelectorAll("a")) : [];
  let anchorCount = 0;
  links.forEach((link) => {
    let el = null;

    let hasExistingAnchor = false;
    if (textAnchors.length) {
      try {
        const normalized = new URL(link).href;
        hasExistingAnchor = textAnchors.some((anchor) => {
          try {
            return new URL(anchor.href).href === normalized;
          } catch {
            return (anchor.getAttribute("href") || "") === link;
          }
        });
      } catch {
        hasExistingAnchor = textAnchors.some((anchor) => (anchor.getAttribute("href") || "") === link);
      }
    }

    const skipLinkAnchor = /tenor\.com/i.test(link) || hasExistingAnchor;

    if (!seenLinks.has(link)) {
      seenLinks.add(link);
      if (!skipLinkAnchor) {
        const anchor = document.createElement("a");
        anchor.href = link;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.textContent = link;
        linkAnchors.appendChild(anchor);
        anchorCount += 1;
      }
    }

    if (/tenor\.com/i.test(link)) {
      hasTenorLink = true;
    }

    // YouTube
    let m = link.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/i);
    if (m) {
      el = document.createElement("iframe");
      el.src = `https://www.youtube.com/embed/${m[1]}?rel=0`;
      el.className = "embed-iframe youtube";
      el.loading = "lazy";
      el.setAttribute(
        "allow",
        "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      );
      el.setAttribute("allowfullscreen", "true");
    }

    // Spotify
    if (!el) {
      m = link.match(/https?:\/\/open\.spotify\.com\/(track|album|playlist)\/([\w]+)/i);
      if (m) {
        el = document.createElement("iframe");
        el.src = `https://open.spotify.com/embed/${m[1]}/${m[2]}`;
        el.className = "embed-iframe spotify";
        el.loading = "lazy";
        el.setAttribute("allow", "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture");
      }
    }

    // SoundCloud
    if (!el && /https?:\/\/(?:soundcloud\.com|snd\.sc)\//i.test(link)) {
      el = document.createElement("iframe");
      el.src = "https://w.soundcloud.com/player/?url=" + encodeURIComponent(link);
      el.className = "embed-iframe soundcloud";
      el.loading = "lazy";
      el.setAttribute("allow", "autoplay");
    }

    // Rumble
    if (!el && /https?:\/\/(?:www\.)?rumble\.com\//i.test(link)) {
      let embedUrl = "";
      try {
        const parsed = new URL(link);
        const segments = parsed.pathname.split("/").filter(Boolean);
        let videoId = "";
        if (segments[0] && segments[0].toLowerCase() === "embed" && segments[1]) {
          videoId = segments[1].split(".")[0];
        } else {
          const candidate = segments.find((segment) => /^v[a-z0-9]+/i.test(segment));
          if (candidate) {
            const matchId = candidate.match(/^(v[a-z0-9]+)/i);
            if (matchId) videoId = matchId[1];
          }
        }
        if (videoId) {
          const embedParams = new URLSearchParams();
          const allowedParams = ["pub", "video"];
          for (const param of allowedParams) {
            const value = parsed.searchParams.get(param);
            if (value) {
              embedParams.set(param, value);
            }
          }
          if (!embedParams.has("autoplay")) {
            embedParams.set("autoplay", "0");
          }
          const query = embedParams.toString();
          embedUrl = `https://rumble.com/embed/${videoId}/${query ? `?${query}` : ""}`;
        }
      } catch {
        const fallback = link.match(/https?:\/\/(?:www\.)?rumble\.com\/embed\/([a-z0-9]+)/i);
        if (fallback) {
          const embedParams = new URLSearchParams();
          const pubMatch = link.match(/[?&]pub=([^&]+)/i);
          if (pubMatch) {
            embedParams.set("pub", pubMatch[1]);
          }
          const videoParamMatch = link.match(/[?&]video=([^&]+)/i);
          if (videoParamMatch) {
            embedParams.set("video", videoParamMatch[1]);
          }
          embedParams.set("autoplay", "0");
          const query = embedParams.toString();
          embedUrl = `https://rumble.com/embed/${fallback[1]}/${query ? `?${query}` : ""}`;
        }
      }
      if (embedUrl) {
        el = document.createElement("iframe");
        el.src = embedUrl;
        el.className = "embed-iframe rumble";
        el.loading = "lazy";
        el.setAttribute(
          "allow",
          "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        );
        el.setAttribute("allowfullscreen", "true");
      }
    }

    // Direct media
    if (!el && /\.(png|jpg|jpeg|gif|webp|bmp|svg)(\?.*)?$/i.test(link)) {
      if (!hasInlinePreview(wrap, link)) {
        el = createInlinePreview(link, "image");
      }
    }
    if (!el && /\.(mp4|webm|mov)(\?.*)?$/i.test(link)) {
      if (!hasInlinePreview(wrap, link)) {
        el = createInlinePreview(link, "video");
      }
    }
    if (!el && /\.(mp3|wav|ogg)(\?.*)?$/i.test(link)) {
      if (!hasInlinePreview(wrap, link)) {
        el = createInlinePreview(link, "audio");
      }
    }
    if (!el && /\.(pdf)(\?.*)?$/i.test(link)) {
      if (!hasInlinePreview(wrap, link)) {
        el = createInlinePreview(link, "pdf");
      }
    }
    if (!el && /\.(zip|rar|7z|tar|gz)(\?.*)?$/i.test(link)) {
      if (!hasInlinePreview(wrap, link)) {
        el = createInlinePreview(link, "file");
      }
    }

    if (
      !el &&
      /tenor\.com/i.test(link) &&
      !/media\.tenor\.com/i.test(link)
    ) {
      fetchTenorPreview(link, wrap);
    }

    if (el) {
      removeAnchorFor(link);
      if (el.classList.contains("inline-preview")) {
        const typeClass = Array.from(el.classList).find((cls) => cls.startsWith("inline-") && cls !== "inline-preview");
        const previewType = typeClass ? typeClass.replace("inline-", "") : "";
        attachPreviewActions(el, { link, type: previewType });
      }
      wrap.appendChild(el);
      ensureWrap();
      if (el.tagName === "IFRAME" && el.classList.contains("soundcloud")) {
        attachSoundCloudControls(el, wrap);
      }
    }
  });

  if (!wrapAdded && wrap.childNodes.length > 1) {
    ensureWrap();
  }

  if (!anchorCount) {
    linkAnchors.remove();
  }

  if (hasTenorLink && textEl) {
    const tenorRegex = /https?:\/\/(?:media\.)?tenor\.com\/\S+/i;
    const parts = textEl.textContent.split(/(\s+)/);
    const filtered = parts.filter((segment) => !tenorRegex.test(segment.trim()));
    const cleaned = filtered.join("").trim();
    textEl.textContent = cleaned;
    if (!cleaned) {
      textEl.style.display = "none";
    } else {
      textEl.style.removeProperty("display");
    }
  }

  if (hasTenorLink) {
    updateTenorBubbleState(node);
  }

  // Open Graph cards for remaining links
  (async () => {
    const previewable = links.filter(
      (u) =>
        !/(youtube|youtu\.be|open\.spotify|soundcloud|rumble\.com|tenor\.com|\.mp4|\.webm|\.mov|\.mp3|\.wav|\.ogg|\.png|\.jpg|\.jpeg|\.gif|\.webp|\.pdf|\.zip|\.rar|\.7z|\.tar|\.gz)/i.test(
          u
        )
    );
    if (!previewable.length) return;

    async function fetchPreview(url) {
      try {
        const r = await fetch("/link-preview?url=" + encodeURIComponent(url));
        return await r.json();
      } catch {
        return null;
      }
    }

    const seen = new Set();

    for (const u of previewable) {
      const normalized = u.trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);

      const d = await fetchPreview(normalized);
      if (!d || !(d.title || d.image || d.description)) continue;

      let parsedUrl;
      try {
        parsedUrl = new URL(normalized);
      } catch {
        continue;
      }

      ensureWrap();
      removeAnchorFor(normalized);

      const card = document.createElement("div");
      card.className = "link-card";
      card.dataset.href = normalized;
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");

      let thumbEl = null;
      if (d.image) {
        const img = document.createElement("img");
        img.className = "link-thumb";
        img.src = d.image;
        img.alt = d.title || d.siteName || parsedUrl.hostname;
        img.loading = "lazy";
        thumbEl = img;
      } else if (d.icon) {
        const iconImg = document.createElement("img");
        iconImg.className = "link-thumb";
        iconImg.src = d.icon;
        iconImg.alt = d.siteName || parsedUrl.hostname;
        iconImg.loading = "lazy";
        thumbEl = iconImg;
      }

      if (!thumbEl) {
        const fallback = document.createElement("div");
        fallback.className = "link-thumb link-thumb-fallback";
        const seed = d.siteName || parsedUrl.hostname || "";
        fallback.textContent = seed ? seed.charAt(0).toUpperCase() : "#";
        thumbEl = fallback;
      }

      const info = document.createElement("div");
      info.className = "link-info";

      const domainRow = document.createElement("div");
      domainRow.className = "link-domain";
      if (d.icon && !(thumbEl instanceof HTMLImageElement && thumbEl.src === d.icon)) {
        const siteIcon = document.createElement("img");
        siteIcon.className = "link-icon";
        siteIcon.src = d.icon;
        siteIcon.alt = "";
        domainRow.appendChild(siteIcon);
      }
      const domainText = document.createElement("span");
      domainText.textContent = d.siteName || parsedUrl.hostname;
      domainRow.appendChild(domainText);

      const title = document.createElement("div");
      title.className = "link-title";
      title.textContent = d.title || domainText.textContent || normalized;

      info.appendChild(domainRow);
      info.appendChild(title);

      if (d.description) {
        const desc = document.createElement("div");
        desc.className = "link-desc";
        desc.textContent = d.description;
        info.appendChild(desc);
      }

      card.appendChild(thumbEl);
      card.appendChild(info);
      wrap.appendChild(card);
      node.classList.add("has-inline-preview");
      observeMediaForScroll(node);
      scrollMessagesToBottom();

      const open = () => window.open(normalized, "_blank", "noopener");
      card.addEventListener("click", open);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
          event.preventDefault();
          open();
        }
      });
    }
  })();
}

console.log("%c✅ DizyChat Fusion Ready — join a room to begin", "color:#b266ff;font-weight:bold;");
