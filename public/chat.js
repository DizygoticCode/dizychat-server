// ===== DIZYCHAT FUSION — SUPERNOVA FINAL 💜 =====
// Unified client (fusion.js merged into chat.js)
// (c) Dizygotic & Psybin 2025

console.log("%c🎛️ DizyChat Supernova Fusion Loaded", "color:#b266ff;font-weight:bold;");

const resolveSocketConfig = () => {
  if (typeof window === "undefined") {
    return { url: undefined, options: {} };
  }

  const config = window.dizychatConfig && typeof window.dizychatConfig === "object"
    ? window.dizychatConfig
    : {};

  const rawOptions = config.socketOptions && typeof config.socketOptions === "object"
    ? { ...config.socketOptions }
    : {};

  const readString = (value) => (typeof value === "string" ? value.trim() : "");

  let url = readString(config.socketUrl);

  if (!url) {
    const storageKey = readString(config.socketUrlStorageKey);
    if (storageKey && typeof window.localStorage !== "undefined") {
      try {
        url = readString(window.localStorage.getItem(storageKey));
      } catch {
        /* ignore storage errors */
      }
    }
  }

  const origin = typeof window.location === "object" ? readString(window.location?.origin) : "";
  const isNativeLikeOrigin = origin.startsWith("capacitor://") || origin.startsWith("file://");

  if (!url && isNativeLikeOrigin) {
    url = readString(config.defaultNativeSocketUrl);
  }

  if (url && !/^https?:\/\//i.test(url) && !/^wss?:\/\//i.test(url)) {
    console.warn("DizyChat: ignoring invalid socketUrl", url);
    url = "";
  }

  const options = Object.keys(rawOptions).length ? rawOptions : undefined;

  return { url: url || undefined, options };
};

const { url: socketUrl, options: socketOptions } = resolveSocketConfig();

let socket;
if (socketUrl && socketOptions) {
  socket = io(socketUrl, socketOptions);
} else if (socketUrl) {
  socket = io(socketUrl);
} else if (socketOptions) {
  socket = io(socketOptions);
} else {
  socket = io();
}
window.socket = socket;
window.dizyCallTokenProof = window.dizyCallTokenProof || null;
socket.on("call token nonce", (data = {}) => {
  window.dizyCallTokenProof = data;
});

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
const voiceBtn = document.getElementById("voice-btn");
const voiceCallBtn = document.getElementById("voice-call-btn");
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
const quickEmojiPanel = document.getElementById("quick-emoji-panel");

const siteLanding = document.getElementById("site-landing");
const usernamePrompt = document.getElementById("username-prompt");
const chatContainer = document.getElementById("chat-container");
const joinBtn = document.getElementById("join-btn");
const usernameInput = document.getElementById("username-input");
const roomInput = document.getElementById("room-input");
const passwordInput = document.getElementById("room-password");
const adminPasswordInput = document.getElementById("admin-password");
const roomName = document.getElementById("room-name");
const themeToggle = document.getElementById("toggle-theme");
const compactToggle = document.getElementById("toggle-density");
const soundToggleBtn = document.getElementById("toggle-sounds");
const emojiPicker = document.getElementById("emoji-picker");
let emojiPickerController = null;
const leaveBtn = document.getElementById("leave-btn");
const copyJoinLinkBtn = document.getElementById("copy-join-link");
const publicRoomList = document.getElementById("public-room-list");
const themeLogos = Array.from(document.querySelectorAll("img.logo"));
const userSidebar = document.getElementById("user-sidebar");
const userList = document.getElementById("user-list");
const userCount = document.getElementById("user-count");
const userListEmpty = document.getElementById("user-list-empty");
const userSidebarToggle = document.getElementById("user-sidebar-toggle");
const userContextMenu = document.getElementById("user-context-menu");
const toolbar = document.querySelector("#chat-container > header");
const psybinPlayer = document.getElementById("psybin-player");
const psybinAudio = document.getElementById("psybin-audio");
const psybinPlayBtn = document.getElementById("psybin-play");
const psybinMuteBtn = document.getElementById("psybin-mute");
const psybinVolumeInput = document.getElementById("psybin-volume");
const psybinMetadata = document.getElementById("psybin-meta");
const psybinMetadataText = document.getElementById("psybin-meta-text");
const psybinCover = document.getElementById("psybin-cover");
const psybinRemaining = document.getElementById("psybin-meta-remaining");
const scrollToLatestBtn = document.getElementById("scroll-to-latest");
const scrollToLatestLabel = scrollToLatestBtn?.querySelector?.(".scroll-to-latest-label") || null;
const scrollToLatestCount = scrollToLatestBtn?.querySelector?.(".scroll-to-latest-count") || null;
const pageBody = typeof document !== "undefined" ? document.body : null;

function setViewMode(mode) {
  if (!pageBody) return;
  const isChat = mode === "chat";
  pageBody.classList.toggle("view-chat", isChat);
  pageBody.classList.toggle("view-landing", !isChat);
}

if (pageBody) {
  setViewMode(pageBody.classList.contains("view-chat") ? "chat" : "landing");
}

const mobileSidebarQuery =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(max-width: 768px)")
    : null;

const setMobileSidebarExpanded = (expanded) => {
  if (!userSidebar) return;
  userSidebar.classList.toggle("is-expanded", Boolean(expanded));
  if (userSidebarToggle) {
    userSidebarToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  }
};

if (userSidebar && userSidebarToggle) {
  setMobileSidebarExpanded(false);

  userSidebarToggle.addEventListener("click", () => {
    const nextExpanded = !userSidebar.classList.contains("is-expanded");
    setMobileSidebarExpanded(nextExpanded);
  });

  if (mobileSidebarQuery) {
    const syncMobileSidebarState = () => {
      if (!mobileSidebarQuery.matches) {
        setMobileSidebarExpanded(true);
      } else {
        setMobileSidebarExpanded(false);
      }
    };

    syncMobileSidebarState();
    if (typeof mobileSidebarQuery.addEventListener === "function") {
      mobileSidebarQuery.addEventListener("change", syncMobileSidebarState);
    } else if (typeof mobileSidebarQuery.addListener === "function") {
      mobileSidebarQuery.addListener(syncMobileSidebarState);
    }
  }
}

// ------------------- Emoji Usage Tracking -------------------
const EMOJI_USAGE_STORAGE_KEY = "dizychat-emoji-usage";
const DEFAULT_QUICK_EMOJIS = ["😀", "😂", "😍"];
const MAX_TRACKED_EMOJIS = 75;
const emojiSequenceRegex = /(?:\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*|\p{Regional_Indicator}{2})/gu;

const extractEmojiGlyphs = (text) => {
  if (typeof text !== "string" || !text) return [];
  if (typeof text.matchAll === "function") {
    try {
      const matches = text.matchAll(emojiSequenceRegex);
      const glyphs = [];
      for (const match of matches) {
        const value = match?.[0];
        if (value) glyphs.push(value);
      }
      if (glyphs.length) return glyphs;
    } catch {
      /* fall through to basic matcher */
    }
  }
  const fallback = text.match(emojiSequenceRegex);
  return fallback ? Array.from(fallback) : [];
};

const normaliseEmojiKey = (value) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed;
};

const loadEmojiUsageStore = () => {
  try {
    const raw = localStorage.getItem(EMOJI_USAGE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return Object.entries(parsed).reduce((acc, [emoji, entry]) => {
      const key = normaliseEmojiKey(emoji);
      if (!key) return acc;

      const normalised = normaliseUsageEntry(key, entry);
      if (normalised) {
        acc[key] = {
          value: normalised.value,
          kind: normalised.kind,
          name: normalised.name,
          preview: normalised.preview,
          count: normalised.count,
        };
      }
      return acc;
    }, {});
  } catch {
    return {};
  }
};

const normaliseUsageEntry = (key, rawEntry) => {
  const baseKey = normaliseEmojiKey(key);
  if (!baseKey) return null;

  if (rawEntry && typeof rawEntry === "object" && !Array.isArray(rawEntry)) {
    const value = normaliseEmojiKey(
      typeof rawEntry.value === "string" ? rawEntry.value : baseKey
    );
    const count = Number.parseInt(rawEntry.count, 10);
    if (!value || !Number.isFinite(count) || count <= 0) return null;
    const kind = rawEntry.kind === "url" ? "url" : "char";
    const name = typeof rawEntry.name === "string" ? rawEntry.name : "";
    const preview = kind === "url"
      ? typeof rawEntry.preview === "string" && rawEntry.preview
        ? rawEntry.preview
        : value
      : "";
    return { key: baseKey, value, kind, name, preview, count };
  }

  const numericCount = Number.parseInt(rawEntry, 10);
  if (!Number.isFinite(numericCount) || numericCount <= 0) return null;
  return {
    key: baseKey,
    value: baseKey,
    kind: "char",
    name: "",
    preview: "",
    count: numericCount,
  };
};

let emojiUsageStore = loadEmojiUsageStore();

const persistEmojiUsageStore = () => {
  try {
    localStorage.setItem(EMOJI_USAGE_STORAGE_KEY, JSON.stringify(emojiUsageStore));
  } catch {
    /* ignore persistence errors */
  }
};

const getSortedEmojiEntries = () => {
  return Object.entries(emojiUsageStore)
    .map(([key, rawEntry]) => normaliseUsageEntry(key, rawEntry))
    .filter(Boolean)
    .sort((a, b) => {
      const diff = Number(b.count) - Number(a.count);
      if (diff !== 0) return diff;
      return a.value.localeCompare(b.value);
    });
};

const buildQuickEmojiList = (limit = 3) => {
  const sorted = getSortedEmojiEntries();
  const seen = new Set();
  const result = [];

  for (const entry of sorted) {
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);
    result.push(entry);
    if (result.length >= limit) return result;
  }

  for (const emoji of DEFAULT_QUICK_EMOJIS) {
    const key = normaliseEmojiKey(emoji);
    if (!key || seen.has(key)) continue;
    result.push({
      key,
      value: key,
      kind: "char",
      name: "",
      preview: "",
      count: 0,
    });
    seen.add(key);
    if (result.length >= limit) break;
  }

  return result;
};

const renderQuickEmojiPanel = () => {
  if (!quickEmojiPanel) return;
  quickEmojiPanel.innerHTML = "";
  const emojis = buildQuickEmojiList(3);
  const usageEntries = new Map(
    getSortedEmojiEntries().map((entry) => [entry.key, entry])
  );
  const usageSet = new Set(
    emojis.filter((entry) => usageEntries.has(entry.key)).map((entry) => entry.key)
  );

  emojis.forEach((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "quick-emoji-button";
    button.dataset.key = entry.key;
    button.dataset.kind = entry.kind;
    button.dataset.value = entry.value;
    button.dataset.emoji = entry.value;
    if (entry.name) {
      button.dataset.name = entry.name;
    }
    if (entry.preview && entry.kind === "url") {
      button.dataset.preview = entry.preview;
    }

    const usageEntry = usageEntries.get(entry.key);
    const usageCount = usageEntry?.count;
    if (usageCount) {
      button.dataset.usage = String(usageCount);
    }

    const labelBase = entry.kind === "url"
      ? entry.name || "Send emoji"
      : `Insert ${entry.value}`;
    const labelCount = usageCount
      ? ` (used ${usageCount} time${usageCount === 1 ? "" : "s"})`
      : "";
    button.setAttribute("aria-label", `${labelBase}${labelCount}`.trim());
    button.title = usageCount
      ? `${labelBase} · used ${usageCount} time${usageCount === 1 ? "" : "s"}`
      : labelBase;
    button.dataset.source = usageSet.has(entry.key) ? "usage" : "default";

    if (entry.kind === "url") {
      button.classList.add("quick-emoji-button-image");
      const img = document.createElement("img");
      img.src = entry.preview || entry.value;
      img.alt = entry.name || "Emoji";
      img.draggable = false;
      button.appendChild(img);
    } else {
      button.textContent = entry.value;
    }

    quickEmojiPanel.appendChild(button);
  });
};

const trackEmojiUsage = (emojiValue, meta = {}) => {
  const key = normaliseEmojiKey(emojiValue);
  if (!key) return;

  const existing = emojiUsageStore[key];
  const existingCount = Number(
    existing && typeof existing === "object" ? existing.count : existing
  );
  const nextCount = Number.isFinite(existingCount) ? existingCount + 1 : 1;

  const kind = meta.kind === "url" || existing?.kind === "url" ? "url" : "char";
  const name =
    typeof meta.name === "string" && meta.name ? meta.name : existing?.name || "";
  const preview =
    kind === "url"
      ? typeof meta.preview === "string" && meta.preview
        ? meta.preview
        : existing?.preview || key
      : "";

  emojiUsageStore[key] = {
    value: key,
    kind,
    name,
    preview,
    count: nextCount,
  };

  const sorted = getSortedEmojiEntries();
  if (sorted.length > MAX_TRACKED_EMOJIS) {
    emojiUsageStore = sorted.slice(0, MAX_TRACKED_EMOJIS).reduce((acc, entry) => {
      acc[entry.key] = {
        value: entry.value,
        kind: entry.kind,
        name: entry.name,
        preview: entry.preview,
        count: entry.count,
      };
      return acc;
    }, {});
  }

  persistEmojiUsageStore();
  renderQuickEmojiPanel();
};

const trackEmojiUsageFromText = (text) => {
  const glyphs = extractEmojiGlyphs(text);
  if (!glyphs.length) return;
  glyphs.forEach((emoji) => trackEmojiUsage(emoji, { kind: "char" }));
};

const sendPlainTextMessage = (rawText, { replyTo } = {}) => {
  const text = typeof rawText === "string" ? rawText : "";
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (!window.currentRoom || !window.currentUser) return false;

  trackEmojiUsageFromText(trimmed);

  const payload = {
    room: window.currentRoom,
    user: window.currentUser,
    text: trimmed,
    timestamp: Date.now(),
  };

  if (replyTo !== undefined && replyTo !== null && replyTo !== "") {
    payload.replyTo = replyTo;
  }

  socket.emit("chat message", payload);
  return true;
};

const insertEmojiIntoInput = (emojiValue) => {
  if (!input || typeof emojiValue !== "string" || !emojiValue) return;
  const current = input.value || "";
  input.value = `${current}${emojiValue}`;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  try {
    input.focus({ preventScroll: true });
  } catch {
    input.focus();
  }
};

renderQuickEmojiPanel();

quickEmojiPanel?.addEventListener("click", (event) => {
  const target = event.target?.closest?.(".quick-emoji-button");
  if (!target || !quickEmojiPanel.contains(target)) return;
  event.preventDefault();
  event.stopPropagation();

  const kind = target.dataset.kind === "url" ? "url" : "char";
  const value = target.dataset.value || target.dataset.emoji || target.textContent || "";
  if (!value) return;

  if (kind === "url") {
    if (window.currentRoom && window.currentUser) {
      socket.emit("chat message", {
        room: window.currentRoom,
        user: window.currentUser,
        text: value,
        timestamp: Date.now(),
      });
      const name = target.dataset.name || "Emoji";
      window.showToast?.(`${name} sent`, "success");
      trackEmojiUsage(value, {
        kind: "url",
        name: target.dataset.name || "",
        preview: target.dataset.preview || value,
      });
      try {
        input?.focus({ preventScroll: true });
      } catch {
        input?.focus();
      }
    } else {
      window.showToast?.("Join a room to send emoji.", "warn");
    }
    return;
  }

  const replyTo = normalizeMessageId(replyState.targetId) || undefined;
  const sent = sendPlainTextMessage(value, { replyTo });
  if (!sent) {
    window.showToast?.("Join a room to send emoji.", "warn");
    return;
  }
  clearReplyTarget();
  if (isTyping) {
    socket.emit("stop typing");
    isTyping = false;
    clearTimeout(typingTimeout);
  }
  try {
    input?.focus({ preventScroll: true });
  } catch {
    input?.focus();
  }
});

if (scrollToLatestLabel) {
  scrollToLatestLabel.setAttribute("aria-live", "polite");
}
const infowarsModal = document.getElementById("infowars-stream-modal");
const infowarsModalHeader = infowarsModal?.querySelector?.(".stream-modal-header") || null;
const infowarsCollapseBtn = document.getElementById("infowars-stream-collapse");
const infowarsResizeHandle = infowarsModal?.querySelector?.(".stream-resize-handle") || null;
const infowarsStreamFrame = document.getElementById("infowars-stream-frame");
let infowarsStreamObserver = null;

const chromeToolbarState = {
  originalTitle: document.title || "DizyChat",
  originalFaviconHref: null,
  messageStopTimer: null,
  messageCount: 0,
  joinTimeout: null,
  tintedIcons: new Map(),
};

const faviconLink =
  document.querySelector("link[rel~='icon']") ||
  (() => {
    const link = document.createElement("link");
    link.rel = "icon";
    link.href = "/logo.svg";
    document.head.appendChild(link);
    return link;
  })();

const faviconImage = new Image();
faviconImage.src = faviconLink?.getAttribute("href") || "/logo.svg";
const faviconCanvas = document.createElement("canvas");
faviconCanvas.width = 32;
faviconCanvas.height = 32;
const faviconCtx = faviconCanvas.getContext("2d");
let faviconUnreadCount = 0;
let faviconBadgeScale = 1;
let faviconPopBoost = 0;
let faviconTargetScale = 1;
let faviconPulse = 0;
let faviconUnreadAlpha = 0;
let faviconAnimationFrame = null;

function scheduleFaviconDraw() {
  if (!faviconCtx) return;
  if (faviconAnimationFrame !== null) return;
  faviconAnimationFrame = window.requestAnimationFrame(drawFaviconFrame);
}

function ensureFaviconImageSource() {
  if (chromeToolbarState.originalFaviconHref && faviconImage.src !== chromeToolbarState.originalFaviconHref) {
    faviconImage.src = chromeToolbarState.originalFaviconHref;
  }
}

function updateUnreadFaviconCount(count) {
  if (!Number.isFinite(count)) return;
  const next = Math.max(0, Math.floor(count));
  if (next > faviconUnreadCount) {
    faviconPopBoost = Math.min(faviconPopBoost + 0.25, 0.6);
    faviconTargetScale = 1 + faviconPopBoost;
  }
  faviconUnreadCount = next;
  scheduleFaviconDraw();
}

function resetUnreadFavicon() {
  faviconUnreadCount = 0;
  faviconPopBoost = 0;
  faviconBadgeScale = 1;
  faviconTargetScale = 1;
  scheduleFaviconDraw();
}

function drawFaviconFrame() {
  faviconAnimationFrame = null;
  if (!faviconCtx) return;

  ensureFaviconImageSource();
  if (!faviconImage.complete) {
    scheduleFaviconDraw();
    return;
  }

  faviconCtx.clearRect(0, 0, 32, 32);
  faviconCtx.drawImage(faviconImage, 0, 0, 32, 32);

  const joinActive = Boolean(chromeToolbarState.joinTimeout);

  if (faviconUnreadCount > 0) {
    faviconUnreadAlpha += (1 - faviconUnreadAlpha) * 0.15;
    faviconPulse += 0.15;
    const scaleOffset = Math.sin(faviconPulse) * 0.15;
    faviconBadgeScale += (faviconTargetScale - faviconBadgeScale) * 0.2;
    faviconBadgeScale = Math.min(faviconBadgeScale, 1.6);
    faviconPopBoost *= 0.92;

    const x = 26;
    const y = 8;
    const radius = 6;
    const glowRadius = radius * 1.8 + scaleOffset * 6;
    const glow = faviconCtx.createRadialGradient(x, y, radius / 2, x, y, glowRadius);
    glow.addColorStop(0, `rgba(255,68,68,${faviconUnreadAlpha * 0.5})`);
    glow.addColorStop(1, "rgba(255,68,68,0)");
    faviconCtx.fillStyle = glow;
    faviconCtx.beginPath();
    faviconCtx.arc(x, y, glowRadius, 0, Math.PI * 2);
    faviconCtx.fill();

    faviconCtx.save();
    faviconCtx.translate(x, y);
    faviconCtx.scale(faviconBadgeScale, faviconBadgeScale);
    faviconCtx.translate(-x, -y);
    faviconCtx.beginPath();
    faviconCtx.arc(x, y, radius, 0, Math.PI * 2);
    faviconCtx.fillStyle = `rgba(255,68,68,${faviconUnreadAlpha})`;
    faviconCtx.fill();
    faviconCtx.fillStyle = `rgba(255,255,255,${faviconUnreadAlpha})`;
    faviconCtx.font = "bold 10px sans-serif";
    faviconCtx.textAlign = "center";
    faviconCtx.textBaseline = "middle";
    const label = faviconUnreadCount > 9 ? "9+" : faviconUnreadCount.toString();
    faviconCtx.fillText(label, x, y);
    faviconCtx.restore();
  } else {
    faviconUnreadAlpha *= 0.85;
  }

  if (joinActive && faviconUnreadCount === 0) {
    if (faviconUnreadAlpha > 0.01) {
      scheduleFaviconDraw();
    } else {
      faviconUnreadAlpha = 0;
      faviconPulse = 0;
    }
    return;
  }

  if (faviconUnreadCount > 0 || faviconUnreadAlpha > 0.01) {
    const dataUrl = faviconCanvas.toDataURL("image/png");
    if (dataUrl) {
      setFaviconHref(dataUrl);
    }
    scheduleFaviconDraw();
  } else {
    faviconUnreadAlpha = 0;
    faviconPulse = 0;
  }
}

const SOUND_NOTIFICATION_STORAGE_KEY = "dizychat.soundNotifications";
const NOTIFICATION_SOUND_SRC = "/newmessage.wav";
const soundNotificationState = {
  enabled: false,
  audio: null,
};

const appState = {
  isAdmin: false,
  messages: new Map(),
  pinned: new Map(),
  hidden: new Set(),
  activeMenu: null,
  highlightTimeout: null,
  users: [],
  userVisibility: new Map(),
  moderationNotices: new Map(),
  contextMenuTrigger: null,
  toolbarFlashTimer: null,
  history: {
    cursor: null,
    hasMore: false,
    loading: false,
  },
};

let searchDebounceTimer = null;
let soundCloudApiPromise = null;

const SCROLL_LOCK_THRESHOLD_PX = 8;
const MAX_MISSED_MESSAGE_COUNT = 999;
const SCROLL_SENTINEL_VISIBLE_RATIO = 0.8;
const SCROLL_PROGRAMMATIC_GRACE_MS = 400;
const scrollLockState = {
  locked: false,
  missed: 0,
};
let messagesEndSentinel = null;
const scrollSentinelState = {
  observer: null,
  atBottom: true,
  visibleRatio: 1,
  programmaticUnlockUntil: 0,
};

let ensureBottomTimer = null;

let muteCountdownInterval = null;

const PSYBIN_RADIO_ROOM = "Psybin Radio";
const PSYBIN_RADIO_STREAM_URL = "https://www.psyb.in/radio/";
const PSYBIN_RADIO_ROOM_CANONICAL = PSYBIN_RADIO_ROOM.toLowerCase();
const PSYBIN_METADATA_URL = "/api/psybin/now-playing";
const PSYBIN_METADATA_REFRESH_MS = 10000;
const PSYBIN_METADATA_RETRY_MS = 15000;
const PSYBIN_METADATA_IDLE_TEXT = "Live Psybin Radio stream";
const PSYBIN_COVER_FALLBACK = "https://psyb.in/tmp/cover.jpg";
const PSYBIN_ELAPSED_REFRESH_MS = 1000;
const psybinPlayerState = {
  initialised: false,
  lastVolume: 1,
  metadata: null,
  metadataTimer: null,
  metadataAbortController: null,
  metadataRequestInFlight: false,
  isStreamLoading: false,
  elapsedTimer: null,
  trackStartedAt: null,
  trackSignature: "",
  coverBuster: null,
};

const INFOWARS_ROOM_KEYWORDS = ["ajn", "infowars"];
const INFOWARS_MODAL_MIN_WIDTH = 320;
const INFOWARS_MODAL_MIN_HEIGHT = 180;
const INFOWARS_MODAL_MARGIN = 12;
const INFOWARS_VIDEO_ASPECT_RATIO = 16 / 9;
const INFOWARS_EMBED_CONTROL_PADDING = 96;
const INFOWARS_MODAL_DEFAULT_WIDTH = 1920;
const INFOWARS_MODAL_DEFAULT_HEIGHT = 1080;
const INFOWARS_ASPECT_TOLERANCE = 0.03;

const infowarsModalState = {
  visible: false,
  collapsed: false,
  dragging: false,
  resizing: false,
  pointerId: null,
  resizePointerId: null,
  dragOffsetX: 0,
  dragOffsetY: 0,
  dragStartX: 0,
  dragStartY: 0,
  resizeStartWidth: 0,
  resizeStartHeight: 0,
  resizeStartX: 0,
  resizeStartY: 0,
  dragMoved: false,
  ignoreHeaderClick: false,
  width: 640,
  height: 360,
  left: null,
  top: null,
  naturalWidth: null,
  naturalHeight: null,
  hasCustomSize: false,
  embedSrc: "",
  embedAllow: "",
};

const ADMIN_PASSWORD_HINT_USERS = new Set(["psybin", "dizygotic"]);

function normaliseAdminHintValue(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function shouldRevealAdminPassword(usernameValue) {
  if (!adminPasswordInput) return false;
  if (adminPasswordInput.value?.trim()) return true;
  const normalised = normaliseAdminHintValue(usernameValue);
  return ADMIN_PASSWORD_HINT_USERS.has(normalised);
}

function updateAdminPasswordVisibility() {
  if (!adminPasswordInput) return;
  const usernameValue = usernameInput?.value || "";
  const reveal = shouldRevealAdminPassword(usernameValue);
  adminPasswordInput.toggleAttribute("hidden", !reveal);
  adminPasswordInput.setAttribute("aria-hidden", String(!reveal));
}

if (usernameInput && adminPasswordInput) {
  usernameInput.addEventListener("input", updateAdminPasswordVisibility);
  usernameInput.addEventListener("blur", updateAdminPasswordVisibility);
  updateAdminPasswordVisibility();
}

function parsePositiveNumber(value) {
  if (value === null || value === undefined) return null;
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function computeInfowarsModalAutoSize() {
  if (typeof window === "undefined") return null;

  const padding = INFOWARS_EMBED_CONTROL_PADDING;
  const availableWidth = Math.max(
    INFOWARS_MODAL_MIN_WIDTH,
    window.innerWidth - INFOWARS_MODAL_MARGIN * 2
  );
  const availableHeight = Math.max(
    INFOWARS_MODAL_MIN_HEIGHT,
    window.innerHeight - INFOWARS_MODAL_MARGIN * 2
  );

  let naturalWidth = parsePositiveNumber(infowarsModalState.naturalWidth);
  let naturalHeight = parsePositiveNumber(infowarsModalState.naturalHeight);

  if (!Number.isFinite(naturalWidth) && Number.isFinite(naturalHeight)) {
    naturalWidth = naturalHeight * INFOWARS_VIDEO_ASPECT_RATIO;
  } else if (Number.isFinite(naturalWidth) && !Number.isFinite(naturalHeight)) {
    naturalHeight = naturalWidth / INFOWARS_VIDEO_ASPECT_RATIO;
  }

  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)) {
    naturalWidth = INFOWARS_MODAL_DEFAULT_WIDTH;
    naturalHeight = INFOWARS_MODAL_DEFAULT_HEIGHT;
  } else {
    naturalWidth = Math.max(naturalWidth, INFOWARS_MODAL_DEFAULT_WIDTH);
    naturalHeight = Math.max(naturalHeight, INFOWARS_MODAL_DEFAULT_HEIGHT);
  }

  let aspect = naturalWidth / naturalHeight;
  if (!Number.isFinite(aspect) || Math.abs(aspect - INFOWARS_VIDEO_ASPECT_RATIO) > INFOWARS_ASPECT_TOLERANCE) {
    aspect = INFOWARS_VIDEO_ASPECT_RATIO;
    naturalHeight = naturalWidth / aspect;
  }

  let videoWidth = Math.min(naturalWidth, availableWidth);
  let videoHeight = videoWidth / aspect;

  const maxVideoHeight = Math.max(
    INFOWARS_MODAL_MIN_HEIGHT - padding,
    availableHeight - padding,
    1
  );

  if (videoHeight > maxVideoHeight) {
    videoHeight = maxVideoHeight;
    videoWidth = videoHeight * aspect;
  }

  const width = clampNumber(videoWidth, INFOWARS_MODAL_MIN_WIDTH, availableWidth);
  const height = clampNumber(videoHeight + padding, INFOWARS_MODAL_MIN_HEIGHT, availableHeight);

  return { width, height };
}

function updateInfowarsModalNaturalSize(width, height) {
  if (!infowarsModal) return;

  const parsedWidth = parsePositiveNumber(width);
  const parsedHeight = parsePositiveNumber(height);

  if (!Number.isFinite(parsedWidth) || !Number.isFinite(parsedHeight)) {
    return;
  }

  infowarsModalState.naturalWidth = parsedWidth;
  infowarsModalState.naturalHeight = parsedHeight;

  if (infowarsModalState.hasCustomSize) {
    return;
  }

  const autoSize = computeInfowarsModalAutoSize();
  if (!autoSize) {
    return;
  }

  const { width: nextWidth, height: nextHeight } = autoSize;
  const widthChanged = nextWidth !== infowarsModalState.width;
  const heightChanged = nextHeight !== infowarsModalState.height;

  if (!widthChanged && !heightChanged) {
    return;
  }

  infowarsModalState.width = nextWidth;
  infowarsModalState.height = nextHeight;
  applyInfowarsModalLayout({ clampPosition: true });
}

function syncInfowarsStreamEmbedSize() {
  if (!infowarsStreamFrame) return;

  const rumbleContainer = infowarsStreamFrame.querySelector?.(".rumble") || null;
  const iframe =
    rumbleContainer?.querySelector?.("iframe") ||
    infowarsStreamFrame.querySelector?.("iframe") ||
    null;

  if (iframe) {
    const originalWidth = iframe.getAttribute?.("width");
    const originalHeight = iframe.getAttribute?.("height");
    if (originalWidth || originalHeight) {
      updateInfowarsModalNaturalSize(originalWidth, originalHeight);
    }
    rememberInfowarsStreamAttributes(iframe);
  }

  if (rumbleContainer) {
    rumbleContainer.style.width = "100%";
    rumbleContainer.style.height = "100%";
    rumbleContainer.style.maxWidth = "none";
    rumbleContainer.style.maxHeight = "none";
    rumbleContainer.style.padding = "0";
    rumbleContainer.style.position = "relative";
  }

  if (iframe) {
    iframe.removeAttribute?.("width");
    iframe.removeAttribute?.("height");
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.maxWidth = "none";
    iframe.style.maxHeight = "none";
    iframe.style.display = "block";
  }
}

function getInfowarsStreamIframe() {
  if (!infowarsStreamFrame) return null;
  const rumbleContainer = infowarsStreamFrame.querySelector?.(".rumble") || null;
  return (
    rumbleContainer?.querySelector?.("iframe") ||
    infowarsStreamFrame.querySelector?.("iframe") ||
    null
  );
}

function rememberInfowarsStreamAttributes(iframe) {
  if (!iframe) return;
  const src = iframe.dataset?.originalSrc || iframe.getAttribute?.("data-original-src") || iframe.src;
  if (src) {
    infowarsModalState.embedSrc = src;
    try {
      iframe.dataset.originalSrc = src;
    } catch {
      iframe.setAttribute("data-original-src", src);
    }
  }

  const allowAttr = iframe.getAttribute?.("allow");
  if (allowAttr) {
    infowarsModalState.embedAllow = allowAttr;
  }
}

function stopInfowarsStreamPlayback() {
  const iframe = getInfowarsStreamIframe();
  if (!iframe) return;
  rememberInfowarsStreamAttributes(iframe);

  try {
    iframe.dataset.infowarsStopped = "1";
  } catch {
    iframe.setAttribute("data-infowars-stopped", "1");
  }

  try {
    iframe.src = "about:blank";
  } catch {
    try {
      iframe.removeAttribute("src");
    } catch {
      /* ignore */
    }
  }

  if (iframe.removeAttribute) {
    iframe.removeAttribute("allow");
  }
}

function resumeInfowarsStreamPlayback() {
  const iframe = getInfowarsStreamIframe();
  if (!iframe) return;

  const desiredSrc =
    iframe.dataset?.originalSrc ||
    iframe.getAttribute?.("data-original-src") ||
    infowarsModalState.embedSrc ||
    "";

  if (!desiredSrc) return;

  const currentSrcAttr = iframe.getAttribute?.("src") || "";
  const isCurrentlyBlank = !currentSrcAttr || /about:blank/i.test(currentSrcAttr);
  const stopFlag = iframe.dataset?.infowarsStopped || iframe.getAttribute?.("data-infowars-stopped");

  if (!isCurrentlyBlank && !stopFlag) {
    return;
  }

  try {
    iframe.setAttribute("src", desiredSrc);
    if (iframe.dataset) {
      iframe.dataset.infowarsStopped = "0";
    } else {
      iframe.setAttribute("data-infowars-stopped", "0");
    }
  } catch {
    /* ignore */
  }

  if (infowarsModalState.embedAllow) {
    iframe.setAttribute("allow", infowarsModalState.embedAllow);
  }
}

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

function clampNumber(value, min, max) {
  const minValue = Number(min);
  const maxValue = Number(max);
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
    return Number(value) || 0;
  }
  if (maxValue <= minValue) {
    return minValue;
  }
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return minValue;
  }
  if (numericValue < minValue) return minValue;
  if (numericValue > maxValue) return maxValue;
  return numericValue;
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

function normalizeReactions(list) {
  if (!Array.isArray(list)) return [];
  const normalized = [];
  const indexByUser = new Map();

  list.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const user = entry.user !== undefined ? String(entry.user || "").trim() : "";
    let emoji = entry.emoji !== undefined ? String(entry.emoji || "").trim() : "";
    if (emoji.length > 128) {
      emoji = emoji.slice(0, 128);
    }
    if (!user || !emoji) return;

    if (indexByUser.has(user)) {
      normalized[indexByUser.get(user)].emoji = emoji;
    } else {
      indexByUser.set(user, normalized.length);
      normalized.push({ user, emoji });
    }
  });

  return normalized;
}

const TOOLBAR_FLASH_CLASSES = ["toolbar-flash-message", "toolbar-flash-join"];

function getFaviconLink() {
  return faviconLink || null;
}

function rememberOriginalFavicon() {
  if (chromeToolbarState.originalFaviconHref) return;
  const link = getFaviconLink();
  if (!link) return;
  const href = link.getAttribute("href") || link.href || "/logo.svg";
  chromeToolbarState.originalFaviconHref = href;
  if (!link.getAttribute("href")) {
    link.setAttribute("href", href);
  }
  faviconImage.src = href;
}

function setFaviconHref(href) {
  const link = getFaviconLink();
  if (!link || !href) return;
  if (link.href === href || link.getAttribute("href") === href) return;
  link.setAttribute("href", href);
}

function restoreFavicon() {
  if (!chromeToolbarState.originalFaviconHref) return;
  setFaviconHref(chromeToolbarState.originalFaviconHref);
}


function sanitizeChromeBaseTitle(title) {
  let normalized = typeof title === "string" ? title.trim() : "";
  if (!normalized) return "DizyChat";

  normalized = normalized.replace(/^\((?:\d+|\d+\+)\)\s+/g, "");
  normalized = normalized.replace(/^🟢\s+New\s+user\s+joined\s+—\s+/g, "");

  return normalized || "DizyChat";
}

function rememberOriginalTitle() {
  const title = sanitizeChromeBaseTitle(document.title);
  if (title && title !== chromeToolbarState.originalTitle) {
    chromeToolbarState.originalTitle = title;
  } else if (!title && !chromeToolbarState.originalTitle) {
    chromeToolbarState.originalTitle = "DizyChat";
  }
}

function restoreTitle() {
  if (!chromeToolbarState.originalTitle) {
    chromeToolbarState.originalTitle = "DizyChat";
  }
  document.title = chromeToolbarState.originalTitle;
}

function getTintedFavicon(color) {
  if (!color) return null;
  if (chromeToolbarState.tintedIcons.has(color)) {
    return chromeToolbarState.tintedIcons.get(color);
  }
  try {
    const canvas = document.createElement("canvas");
    const size = 64;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    const bubbleWidth = size * 0.56;
    const bubbleHeight = size * 0.38;
    const bubbleX = (size - bubbleWidth) / 2;
    const bubbleY = size * 0.24;
    ctx.fillRect(bubbleX, bubbleY, bubbleWidth, bubbleHeight);

    ctx.beginPath();
    ctx.moveTo(size * 0.42, bubbleY + bubbleHeight);
    ctx.lineTo(size * 0.32, bubbleY + bubbleHeight + size * 0.14);
    ctx.lineTo(size * 0.54, bubbleY + bubbleHeight);
    ctx.closePath();
    ctx.fill();

    const dataUrl = canvas.toDataURL("image/png");
    if (dataUrl) {
      chromeToolbarState.tintedIcons.set(color, dataUrl);
    }
    return dataUrl;
  } catch (err) {
    console.warn("[Toolbar] Unable to create tinted favicon", err);
    return null;
  }
}

function stopMessageToolbarFlash({ restore = false } = {}) {
  const hadTimeout = Boolean(chromeToolbarState.messageStopTimer);
  if (hadTimeout) {
    clearTimeout(chromeToolbarState.messageStopTimer);
    chromeToolbarState.messageStopTimer = null;
  }
  const hadCount = chromeToolbarState.messageCount > 0;
  if (hadCount) {
    chromeToolbarState.messageCount = 0;
  }
  if (restore || hadTimeout || hadCount) {
    resetUnreadFavicon();
    restoreFavicon();
    restoreTitle();
  }
}

function cancelJoinBlink({ force = false } = {}) {
  if (chromeToolbarState.joinTimeout) {
    clearTimeout(chromeToolbarState.joinTimeout);
    chromeToolbarState.joinTimeout = null;
    restoreFavicon();
    restoreTitle();
  } else if (force) {
    restoreFavicon();
    restoreTitle();
  }
}

function resetChromeToolbarAttention() {
  stopMessageToolbarFlash({ restore: true });
  cancelJoinBlink({ force: true });
}

function shouldPersistMessageFlash() {
  if (document.hidden) return true;
  if (typeof document.hasFocus === "function") {
    return !document.hasFocus();
  }
  return false;
}

function startMessageToolbarFlash() {
  rememberOriginalTitle();
  rememberOriginalFavicon();
  const baseTitle = chromeToolbarState.originalTitle || "DizyChat";
  const persist = shouldPersistMessageFlash();

  if (chromeToolbarState.messageStopTimer) {
    clearTimeout(chromeToolbarState.messageStopTimer);
    chromeToolbarState.messageStopTimer = null;
  }

  const next = chromeToolbarState.messageCount + 1;
  const clamped = next > MAX_MISSED_MESSAGE_COUNT ? MAX_MISSED_MESSAGE_COUNT : next;
  chromeToolbarState.messageCount = clamped;

  const label = formatMissedMessageCount(clamped);
  document.title = `(${label}) ${baseTitle}`;
  updateUnreadFaviconCount(clamped);

  if (!persist) {
    chromeToolbarState.messageStopTimer = window.setTimeout(() => {
      stopMessageToolbarFlash({ restore: true });
    }, 2200);
  }
}

function startJoinToolbarBlink() {
  rememberOriginalTitle();
  rememberOriginalFavicon();
  const color = "#2ecc71";
  const tintedIcon = getTintedFavicon(color);
  const baseTitle = chromeToolbarState.originalTitle || "DizyChat";
  const highlightTitle = `🟢 New user joined — ${baseTitle}`;

  cancelJoinBlink();

  if (tintedIcon) {
    setFaviconHref(tintedIcon);
  }
  document.title = highlightTitle;

  chromeToolbarState.joinTimeout = window.setTimeout(() => {
    chromeToolbarState.joinTimeout = null;
    restoreFavicon();
    restoreTitle();
  }, 1400);
}

function triggerChromeToolbarAttention(type) {
  if (!type) return;
  if (type === "message") {
    cancelJoinBlink();
    startMessageToolbarFlash();
  } else if (type === "join") {
    if (chromeToolbarState.messageCount > 0) return;
    startJoinToolbarBlink();
  }
}

window.addEventListener("focus", () => resetChromeToolbarAttention());
window.addEventListener("pointerdown", () => resetChromeToolbarAttention(), { capture: true });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    resetChromeToolbarAttention();
  }
});

function flashToolbar(type) {
  if (!isViewingChat) return;
  if (!toolbar) return;

  const className =
    type === "message"
      ? "toolbar-flash-message"
      : type === "join"
        ? "toolbar-flash-join"
        : "";
  if (!className) return;

  if (appState.toolbarFlashTimer) {
    clearTimeout(appState.toolbarFlashTimer);
    appState.toolbarFlashTimer = null;
  }

  toolbar.classList.remove(...TOOLBAR_FLASH_CLASSES);
  // Force reflow so animation can restart when the class is re-added.
  void toolbar.offsetWidth;
  toolbar.classList.add(className);

  const duration = className === "toolbar-flash-message" ? 1600 : 1200;
  appState.toolbarFlashTimer = window.setTimeout(() => {
    toolbar.classList.remove(className);
    appState.toolbarFlashTimer = null;
  }, duration);

  triggerChromeToolbarAttention(type);
}

function ensureNotificationAudio() {
  if (soundNotificationState.audio) return soundNotificationState.audio;
  try {
    const audio = new Audio(NOTIFICATION_SOUND_SRC);
    audio.preload = "auto";
    soundNotificationState.audio = audio;
  } catch (error) {
    console.warn("[Sound] Unable to initialise notification audio", error);
    soundNotificationState.audio = null;
  }
  return soundNotificationState.audio;
}

function updateSoundToggleButton() {
  if (!soundToggleBtn) return;
  const enabled = Boolean(soundNotificationState.enabled);
  const label = enabled ? "Disable sound notifications" : "Enable sound notifications";

  soundToggleBtn.setAttribute("aria-pressed", String(enabled));
  soundToggleBtn.setAttribute("aria-label", label);
  soundToggleBtn.title = label;

  const icon = soundToggleBtn.querySelector(".icon");
  if (icon) {
    icon.textContent = enabled ? "🔊" : "🔈";
  }

  const srOnly = soundToggleBtn.querySelector(".sr-only");
  if (srOnly) {
    srOnly.textContent = label;
  }
}

function persistSoundPreference(enabled) {
  try {
    localStorage.setItem(
      SOUND_NOTIFICATION_STORAGE_KEY,
      enabled ? "on" : "off"
    );
  } catch {
    /* ignore persistence failures */
  }
}

function playNotificationSound({ force = false } = {}) {
  if (!force && !soundNotificationState.enabled) return;
  const audio = ensureNotificationAudio();
  if (!audio) return;

  try {
    audio.currentTime = 0;
  } catch {
    /* ignore reset errors */
  }

  audio
    .play()
    .catch((err) => {
      if (!force) {
        console.warn("[Sound] Unable to play notification", err);
      }
    });
}

function shouldPlayNotificationSound(msg) {
  if (!msg || typeof msg !== "object") return true;
  const sender = typeof msg.user === "string" ? msg.user.trim() : "";
  if (!sender) return true;
  const currentUser = typeof window.currentUser === "string" ? window.currentUser.trim() : "";
  if (!currentUser) return true;
  return sender.toLowerCase() !== currentUser.toLowerCase();
}

function maybePlayNotificationSound(msg) {
  if (!soundNotificationState.enabled) return;
  if (!shouldPlayNotificationSound(msg)) return;
  playNotificationSound();
}

function initSoundNotifications() {
  try {
    const stored = localStorage.getItem(SOUND_NOTIFICATION_STORAGE_KEY);
    soundNotificationState.enabled = stored === "on";
  } catch {
    soundNotificationState.enabled = false;
  }

  if (!soundToggleBtn) {
    if (soundNotificationState.enabled) {
      ensureNotificationAudio();
    }
    return;
  }

  ensureNotificationAudio();
  updateSoundToggleButton();

  soundToggleBtn.addEventListener("click", () => {
    soundNotificationState.enabled = !soundNotificationState.enabled;
    persistSoundPreference(soundNotificationState.enabled);
    updateSoundToggleButton();

    if (soundNotificationState.enabled) {
      playNotificationSound({ force: true });
    }
  });
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

function getDayStartValue(date) {
  if (!(date instanceof Date)) return Number.NaN;
  const normalized = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const value = normalized.getTime();
  return Number.isNaN(value) ? Number.NaN : value;
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

function ensureDaySeparator(date, { position = "end", anchor = null } = {}) {
  if (!messages) return;
  const key = getDateKey(date);
  if (!key) return;

  const dayValue = getDayStartValue(date);
  const hasDayValue = Number.isFinite(dayValue);

  if (position === "start") {
    const existingFirstKey = messages.dataset.firstDateKey || "";
    if (existingFirstKey === key) {
      if (hasDayValue) {
        const existingValue = Number(messages.dataset.firstDateValue);
        if (!Number.isFinite(existingValue) || dayValue < existingValue) {
          messages.dataset.firstDateValue = String(dayValue);
        }
      }
      return;
    }

    const separator = document.createElement("div");
    separator.className = "day-separator";
    separator.dataset.dateKey = key;
    separator.textContent = formatDayLabel(date) || key;

    if (anchor) {
      messages.insertBefore(separator, anchor);
    } else if (messages.firstChild) {
      messages.insertBefore(separator, messages.firstChild);
    } else {
      messages.appendChild(separator);
    }

    const existingFirstValue = Number(messages.dataset.firstDateValue);
    if (!Number.isFinite(existingFirstValue) || (hasDayValue && dayValue < existingFirstValue)) {
      messages.dataset.firstDateKey = key;
      if (hasDayValue) {
        messages.dataset.firstDateValue = String(dayValue);
      } else {
        delete messages.dataset.firstDateValue;
      }
    } else if (!messages.dataset.firstDateKey) {
      messages.dataset.firstDateKey = key;
      if (hasDayValue) messages.dataset.firstDateValue = String(dayValue);
    }

    if (!messages.dataset.lastDateKey) {
      messages.dataset.lastDateKey = key;
      if (hasDayValue) messages.dataset.lastDateValue = String(dayValue);
    }
    return;
  }

  const existingLastKey = messages.dataset.lastDateKey || "";
  if (existingLastKey === key) {
    if (hasDayValue) {
      const existingValue = Number(messages.dataset.lastDateValue);
      if (!Number.isFinite(existingValue) || dayValue > existingValue) {
        messages.dataset.lastDateValue = String(dayValue);
      }
    }
    return;
  }

  const separator = document.createElement("div");
  separator.className = "day-separator";
  separator.dataset.dateKey = key;
  separator.textContent = formatDayLabel(date) || key;

  const reference = anchor || ensureMessagesEndSentinel();
  if (reference) {
    messages.insertBefore(separator, reference);
  } else {
    messages.appendChild(separator);
  }

  if (hasDayValue) {
    const existingValue = Number(messages.dataset.lastDateValue);
    if (!Number.isFinite(existingValue) || dayValue >= existingValue) {
      messages.dataset.lastDateValue = String(dayValue);
      messages.dataset.lastDateKey = key;
    }

    const existingFirstValue = Number(messages.dataset.firstDateValue);
    if (!messages.dataset.firstDateKey || dayValue <= existingFirstValue) {
      messages.dataset.firstDateValue = String(dayValue);
      messages.dataset.firstDateKey = key;
    }
  } else {
    messages.dataset.lastDateKey = key;
    if (!messages.dataset.firstDateKey) {
      messages.dataset.firstDateKey = key;
    }
  }
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
const prefillUsername = urlParams.get("username") || urlParams.get("user") || "";
const prefillRoom = urlParams.get("room") || "";
const prefillPassword = urlParams.get("password") || "";
const usernamePlaceholder = urlParams.get("usernamePlaceholder") || "";
const roomPlaceholder = urlParams.get("roomPlaceholder") || "";

if (prefillUsername && usernameInput) {
  usernameInput.value = prefillUsername;
  if (typeof updateAdminPasswordVisibility === "function") {
    updateAdminPasswordVisibility();
  }
}

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

if (usernamePlaceholder && usernameInput) {
  usernameInput.placeholder = usernamePlaceholder;
}

if (roomPlaceholder && roomInput) {
  roomInput.placeholder = roomPlaceholder;
}

// ------------------- State Helpers -------------------
const hiddenStoragePrefix = "dizychat-hidden-";
const userVisibilityStoragePrefix = "dizychat-user-visibility-";

const hiddenKeyForRoom = (room) => `${hiddenStoragePrefix}${room || ""}`;
const visibilityKeyForRoom = (room) => `${userVisibilityStoragePrefix}${room || ""}`;

function loadUserVisibilityForRoom(room) {
  appState.userVisibility.clear();
  if (!room) return;
  try {
    const raw = localStorage.getItem(visibilityKeyForRoom(room));
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    Object.entries(parsed).forEach(([username, hidden]) => {
      if (typeof username !== "string" || !username.trim()) return;
      appState.userVisibility.set(username, Boolean(hidden));
    });
  } catch (err) {
    console.warn("[UserVisibility] Failed to load user visibility state", err);
  }
}

function persistUserVisibility(room = window.currentRoom) {
  if (!room) return;
  try {
    const payload = {};
    appState.userVisibility.forEach((hidden, username) => {
      if (hidden) payload[username] = true;
    });
    localStorage.setItem(visibilityKeyForRoom(room), JSON.stringify(payload));
  } catch (err) {
    console.warn("[UserVisibility] Failed to persist user visibility state", err);
  }
}

function shouldShowUserMessages(username) {
  if (!username || username === window.currentUser) return true;
  return !appState.userVisibility.get(username);
}

function applyMessageVisibilityFilter() {
  if (!messages) return;
  messages.querySelectorAll(".message").forEach((node) => {
    const id = node.dataset.id;
    if (!id) return;
    const data = appState.messages.get(id);
    if (!data) return;
    node.style.display = shouldShowUserMessages(data.user) ? "" : "none";
  });
}

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
    ? normalizeReactions(raw.reactions)
    : Array.isArray(existing.reactions)
    ? normalizeReactions(existing.reactions)
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

function updateUserEntryStatus(item, now = Date.now()) {
  if (!item) return false;

  const mutedUntil = Number(item.dataset.mutedUntil || 0);
  const isBlocked = item.dataset.isBlocked === "true";
  const statuses = [];
  let severity = "";

  if (mutedUntil && mutedUntil > now) {
    statuses.push(`Muted • ${formatRemaining(mutedUntil - now)} left`);
    severity = "warn";
  } else if (mutedUntil) {
    delete item.dataset.mutedUntil;
  }

  if (isBlocked) {
    statuses.push("Blocked");
    severity = "bad";
  }

  const statusEl = item.querySelector(".user-status");

  if (!statuses.length) {
    if (statusEl) statusEl.remove();
    return false;
  }

  let element = statusEl;
  if (!element) {
    element = document.createElement("span");
    item.appendChild(element);
  }

  element.className = `user-status${severity ? ` ${severity}` : ""}`;
  element.textContent = statuses.join(" • ");

  return mutedUntil && mutedUntil > now;
}

function updateAllUserEntryStatuses() {
  if (!userList) return false;

  const now = Date.now();
  let hasActiveMute = false;

  const entries = Array.from(userList.querySelectorAll(".user-entry"));
  entries.forEach((entry) => {
    const active = updateUserEntryStatus(entry, now);
    if (active) hasActiveMute = true;
  });

  return hasActiveMute;
}

function ensureMuteCountdownInterval() {
  if (muteCountdownInterval) return;

  muteCountdownInterval = setInterval(() => {
    const hasActive = updateAllUserEntryStatuses();
    if (!hasActive) {
      clearInterval(muteCountdownInterval);
      muteCountdownInterval = null;
    }
  }, 1000);
}

function stopMuteCountdownInterval() {
  if (!muteCountdownInterval) return;
  clearInterval(muteCountdownInterval);
  muteCountdownInterval = null;
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

  const previousUsers = Array.isArray(appState.users) ? appState.users : [];
  const previousNames = new Set(
    previousUsers.map((entry) => entry?.username).filter(Boolean),
  );
  const hadUsersBefore = previousUsers.length > 0;

  const array = Array.isArray(users) ? users.filter(Boolean) : [];
  const newJoiners = hadUsersBefore
    ? array.filter((entry) => {
        const name = entry?.username;
        if (!name || name === window.currentUser) return false;
        return !previousNames.has(name);
      })
    : [];

  appState.users = array;
  userList.innerHTML = "";
  closeActiveMenu();

  const now = Date.now();
  let total = 0;

  if (newJoiners.length && isViewingChat) {
    flashToolbar("join");
  }

  let hasActiveMuteCountdowns = false;

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
    if (!isSelf) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "user-filter-toggle";
      const hidden = Boolean(appState.userVisibility.get(username));
      toggle.classList.toggle("hidden", hidden);
      toggle.textContent = hidden ? "Hidden" : "Visible";
      toggle.setAttribute("aria-pressed", String(hidden));
      toggle.setAttribute("aria-label", `${hidden ? "Show" : "Hide"} ${username} messages`);
      toggle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const nextHidden = !Boolean(appState.userVisibility.get(username));
        appState.userVisibility.set(username, nextHidden);
        persistUserVisibility();
        renderUserSidebar(appState.users);
        applyMessageVisibilityFilter();
      });
      item.appendChild(toggle);
    }

    if (isMuted) {
      item.dataset.mutedUntil = String(mutedUntil);
    }

    if (isBlocked) {
      item.dataset.isBlocked = "true";
    }

    if (isMuted || isBlocked) {
      const active = updateUserEntryStatus(item, now);
      if (active) hasActiveMuteCountdowns = true;
    }

    const canInteract = appState.isAdmin && !isSelf && !isAdmin;

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

  if (!hasActiveMuteCountdowns) {
    const active = updateAllUserEntryStatuses();
    if (active) hasActiveMuteCountdowns = true;
  }

  if (hasActiveMuteCountdowns) {
    ensureMuteCountdownInterval();
  } else {
    stopMuteCountdownInterval();
  }

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
  const canMute = appState.isAdmin && !isSelf && !isTargetAdmin;

  if (canMute) {
    if (isMuted) {
      options.push({ action: "unmute", label: "Unmute" });
    } else {
      options.push({ action: "mute", label: "Mute for 1 minute", duration: 60 });
      options.push({ action: "mute", label: "Mute for 5 minutes", duration: 300 });
      options.push({ action: "mute", label: "Mute for 1 hour", duration: 3600 });
    }
  }

  if (appState.isAdmin && !isSelf && !isTargetAdmin) {
    if (isBlocked) {
      options.push({ action: "unblock", label: "Unblock" });
    } else {
      options.push({ action: "block", label: "Block" });
    }
    options.push({ action: "ban", label: "Ban & remove", dangerous: true });
    options.push({ action: "call:mute-user", label: "Mute in call", socketEvent: "call:mute-user" });
    options.push({ action: "call:kick-user", label: "Remove from call", socketEvent: "call:kick-user" });
    options.push({ action: "call:disable-video-user", label: "Disable camera", socketEvent: "call:disable-video-user" });
    options.push({ action: "call:enable-video-user", label: "Allow camera", socketEvent: "call:enable-video-user" });
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
      if (option.socketEvent) {
        socket.emit(option.socketEvent, { room: window.currentRoom, target: user.username });
      } else {
        socket.emit("moderate user", payload);
      }
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
    positionMessageActionsMenu(menu);
    const messageNode = menu.closest(".message");
    if (messageNode) {
      messageNode.classList.add("menu-open");
    }
    if (toggle) toggle.setAttribute("aria-expanded", "true");
    appState.activeMenu = menu;
  }
}

function positionMessageActionsMenu(menu) {
  if (!menu || menu === userContextMenu) return;
  menu.style.top = "";
  menu.style.bottom = "";

  const viewportPadding = 8;
  const preferredTop = 28;
  const rect = menu.getBoundingClientRect();
  const overflowBottom = rect.bottom - (window.innerHeight - viewportPadding);
  if (overflowBottom <= 0) return;

  const adjustedTop = Math.max(viewportPadding, preferredTop - overflowBottom);
  menu.style.top = `${adjustedTop}px`;
}

function closeActiveMenu(options = {}) {
  if (!appState.activeMenu) return;
  const { restoreFocus = false } = options;
  const menu = appState.activeMenu;
  menu.classList.remove("open");
  const messageNode = menu.closest(".message");
  if (messageNode) {
    messageNode.classList.remove("menu-open");
  }

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

function renderMessageReactions(node, data) {
  if (!node) return;
  const list = Array.isArray(data?.reactions) ? data.reactions : [];
  let container = node.querySelector(".reactions");

  if (!list.length || data?.deleted) {
    if (container) container.remove();
    return;
  }

  if (!container) {
    container = document.createElement("div");
    container.className = "reactions";
    node.appendChild(container);
  }

  container.innerHTML = "";

  const groups = new Map();
  list.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const emoji = entry.emoji !== undefined ? String(entry.emoji || "").trim() : "";
    const user = entry.user !== undefined ? String(entry.user || "").trim() : "";
    if (!emoji || !user) return;

    if (!groups.has(emoji)) {
      groups.set(emoji, { emoji, users: new Set(), order: [] });
    }
    const group = groups.get(emoji);
    if (!group.users.has(user)) {
      group.users.add(user);
      group.order.push(user);
    }
  });

  const currentUser = window.currentUser || "";
  const room = window.currentRoom || "";

  groups.forEach((group) => {
    const count = group.order.length;
    if (!count) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "reaction-chip";
    button.dataset.emoji = group.emoji;

    const isImage = /^(https?:)?\/\//i.test(group.emoji) || group.emoji.startsWith("/");
    if (isImage) {
      const img = document.createElement("img");
      img.src = group.emoji;
      img.alt = "Reaction";
      img.loading = "lazy";
      button.appendChild(img);
    } else {
      const emojiEl = document.createElement("span");
      emojiEl.className = "reaction-emoji";
      emojiEl.textContent = group.emoji;
      button.appendChild(emojiEl);
    }

    if (count > 1) {
      const countEl = document.createElement("span");
      countEl.className = "reaction-count";
      countEl.textContent = `×${count}`;
      button.appendChild(countEl);
    }

    const orderedUsers = group.order;
    const isOwn = orderedUsers.includes(currentUser);
    button.setAttribute("aria-pressed", String(isOwn));
    if (isOwn) {
      button.classList.add("own");
    }

    if (orderedUsers.length) {
      let label = `${group.emoji} by ${orderedUsers.join(", ")}`;
      if (isOwn) {
        label += " (click to remove)";
      }
      button.title = label;
      button.setAttribute("aria-label", label);
      if (isOwn && room && currentUser) {
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          socket.emit("react message", {
            room,
            id: data.id,
            reaction: "",
            username: currentUser,
          });
        });
      }
    } else {
      button.title = group.emoji;
      button.setAttribute("aria-label", group.emoji);
    }

    container.appendChild(button);
  });
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

    const reactionBtn = document.createElement("button");
    reactionBtn.type = "button";
    reactionBtn.textContent = "React";
    reactionBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeActiveMenu();
      if (!window.currentUser || !window.currentRoom) {
        showToast("Join the chat to react to messages.", "warn");
        return;
      }
      const handleSelect = (value) => {
        const emoji = typeof value === "string" ? value.trim() : "";
        if (!emoji) return;
        socket.emit("react message", {
          room: window.currentRoom,
          id: data.id,
          reaction: emoji,
          username: window.currentUser,
        });
      };
      if (emojiPickerController?.show) {
        const anchorTarget = toggle || node;
        emojiPickerController.show({
          mode: "reaction",
          anchor: anchorTarget,
          onSelect: handleSelect,
        });
      } else {
        handleSelect(prompt("Pick an emoji"));
      }
    });
    menu.appendChild(reactionBtn);

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
    updateInlineMediaClasses(node);
  }

  applyReplyContext(node, data);
  updateMessageFlags(node, data);
  setupMessageActions(node, data);
  renderMessageReactions(node, data);

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
    parts.forEach((part, index) => {
      if (!part) return;
      if (/^https?:\/\//i.test(part)) {
        const trimmedLink = part.trim();
        if (!trimmedLink) return;

        links.push(trimmedLink);

        if (/^https?:\/\/(?:www\.)?(?:media\.)?tenor\.com\//i.test(trimmedLink)) {
          const prevNode = fragment.lastChild;
          const nextPart = parts[index + 1] || "";
          const needsLeadingSpace =
            prevNode &&
            prevNode.nodeType === Node.TEXT_NODE &&
            prevNode.textContent &&
            !/\s$/.test(prevNode.textContent);
          const needsTrailingSpace = nextPart && typeof nextPart === "string" && !/^\s/.test(nextPart);
          if (needsLeadingSpace || needsTrailingSpace) {
            const spaces = `${needsLeadingSpace ? " " : ""}${needsTrailingSpace ? " " : ""}`;
            if (spaces) {
              fragment.appendChild(document.createTextNode(spaces));
            }
          }
          return;
        }

        const anchor = document.createElement("a");
        anchor.href = trimmedLink;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.textContent = trimmedLink;
        fragment.appendChild(anchor);
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

  // If we were previously in a room, automatically rejoin it after reconnecting.
  if (window.currentRoom && window.currentUser) {
    socket.emit("join room", {
      room: window.currentRoom,
      username: window.currentUser,
      password: window.currentPassword || "",
    });
  }
});
socket.on("disconnect", () => {
  showToast("Disconnected — attempting to reconnect…", "warn");
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
  resetChromeToolbarAttention();
  appState.isAdmin = false;
  clearReplyTarget();
  cancelEnsureMessagesAtBottom();
  setViewMode("landing");
  if (copyJoinLinkBtn) copyJoinLinkBtn.disabled = true;
  if (chatContainer) chatContainer.style.display = "none";
  if (siteLanding) {
    siteLanding.style.display = "block";
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      /* ignore */
    }
  }
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
    ensureMessagesEndSentinel();
    initScrollSentinelObserver();
  }
  renderUserSidebar([]);

  window.currentUser = null;
  window.currentRoom = null;
  window.currentPassword = lastRoomPassword || "";

  setPsybinPlayerRoom(null);
  setInfowarsStreamRoom(null);

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

function getMessagesDistanceFromBottom() {
  if (!messages) return 0;
  return Math.max(0, messages.scrollHeight - messages.scrollTop - messages.clientHeight);
}

function beginProgrammaticScrollWindow() {
  scrollSentinelState.programmaticUnlockUntil = Date.now() + SCROLL_PROGRAMMATIC_GRACE_MS;
}

function isProgrammaticScrollActive() {
  return Date.now() < scrollSentinelState.programmaticUnlockUntil;
}

function ensureMessagesEndSentinel() {
  if (!messages) return null;

  if (!messagesEndSentinel) {
    messagesEndSentinel = document.createElement("div");
    messagesEndSentinel.id = "messages-end-sentinel";
    messagesEndSentinel.className = "messages-end-sentinel";
    messagesEndSentinel.setAttribute("aria-hidden", "true");
  }

  if (messagesEndSentinel.parentNode !== messages) {
    messages.appendChild(messagesEndSentinel);
  } else if (messages.lastElementChild !== messagesEndSentinel) {
    messages.appendChild(messagesEndSentinel);
  }

  if (scrollSentinelState.observer) {
    try {
      scrollSentinelState.observer.observe(messagesEndSentinel);
    } catch {
      /* ignore */
    }
  }

  return messagesEndSentinel;
}

function handleScrollSentinelEntries(entries) {
  if (!Array.isArray(entries) || !entries.length) return;
  const entry = entries[entries.length - 1];
  if (!entry) return;

  const ratio = Number.isFinite(entry.intersectionRatio) ? entry.intersectionRatio : 0;
  const isIntersecting = entry.isIntersecting || ratio > 0;
  const distanceFromBottom = getMessagesDistanceFromBottom();
  const nearBottom = distanceFromBottom <= SCROLL_LOCK_THRESHOLD_PX;
  const ratioAtBottom = isIntersecting && ratio >= SCROLL_SENTINEL_VISIBLE_RATIO;
  const effectivelyAtBottom = ratioAtBottom || nearBottom;

  scrollSentinelState.visibleRatio = ratio;
  scrollSentinelState.atBottom = effectivelyAtBottom;

  if (effectivelyAtBottom) {
    scrollSentinelState.programmaticUnlockUntil = 0;
    if (scrollLockState.locked) {
      setScrollLockState(false);
    } else {
      updateScrollLockIndicator();
    }
    resetMissedMessages();
  } else if (!isProgrammaticScrollActive() && !nearBottom) {
    if (!scrollLockState.locked) {
      setScrollLockState(true);
    }
    cancelEnsureMessagesAtBottom();
  }
}

function initScrollSentinelObserver() {
  if (!messages) return;

  const sentinel = ensureMessagesEndSentinel();
  if (!sentinel) return;

  if (typeof IntersectionObserver !== "function") {
    scrollSentinelState.observer?.disconnect?.();
    scrollSentinelState.observer = null;
    scrollSentinelState.atBottom = getMessagesDistanceFromBottom() <= 1;
    scrollSentinelState.visibleRatio = scrollSentinelState.atBottom ? 1 : 0;
    updateScrollLockIndicator();
    return;
  }

  if (scrollSentinelState.observer) {
    scrollSentinelState.observer.disconnect();
  }

  const thresholds = [0, 0.1, 0.25, 0.5, SCROLL_SENTINEL_VISIBLE_RATIO, 1];
  const observer = new IntersectionObserver(handleScrollSentinelEntries, {
    root: messages,
    threshold: thresholds,
  });

  observer.observe(sentinel);
  scrollSentinelState.observer = observer;
}

function isMessagesAtBottom() {
  if (messagesEndSentinel && scrollSentinelState.observer) {
    return scrollSentinelState.atBottom;
  }
  if (!messages) return true;
  return getMessagesDistanceFromBottom() <= 1;
}

function isMessagesNearBottom(distance = SCROLL_LOCK_THRESHOLD_PX) {
  if (!messages) return true;

  if (messagesEndSentinel && scrollSentinelState.observer) {
    if (scrollSentinelState.atBottom) return true;
    if (scrollSentinelState.visibleRatio > 0) return true;
  }

  const tolerance = Math.max(1, distance);
  return getMessagesDistanceFromBottom() <= tolerance;
}

function formatMissedMessageCount(count) {
  if (count >= 100) return "99+";
  return String(count);
}

function updateScrollLockIndicator() {
  if (!scrollToLatestBtn) return;

  const isAtBottom = isMessagesAtBottom();

  if (!scrollLockState.locked || isAtBottom) {
    scrollToLatestBtn.hidden = true;
    scrollToLatestBtn.setAttribute("aria-hidden", "true");
    scrollToLatestBtn.classList.remove("has-new");
    if (scrollToLatestLabel) scrollToLatestLabel.textContent = "Jump to present";
    if (scrollToLatestCount) {
      scrollToLatestCount.textContent = "";
      scrollToLatestCount.setAttribute("aria-hidden", "true");
    }
    return;
  }

  scrollToLatestBtn.hidden = false;
  scrollToLatestBtn.setAttribute("aria-hidden", "false");

  const hasNew = scrollLockState.missed > 0;
  scrollToLatestBtn.classList.toggle("has-new", hasNew);

  if (hasNew) {
    const missedMessages = scrollLockState.missed;
    const countLabel = formatMissedMessageCount(missedMessages);
    const messageLabel = missedMessages === 1 ? "New message" : "New messages";
    if (scrollToLatestLabel) {
      scrollToLatestLabel.textContent = messageLabel;
    }
    if (scrollToLatestCount) {
      scrollToLatestCount.textContent = countLabel;
      scrollToLatestCount.setAttribute("aria-hidden", "false");
    }
    const announcement = `${countLabel} ${messageLabel.toLowerCase()}. Jump to latest.`;
    scrollToLatestBtn.setAttribute("aria-label", announcement);
    scrollToLatestBtn.setAttribute("title", announcement);
  } else {
    if (scrollToLatestLabel) scrollToLatestLabel.textContent = "Jump to present";
    if (scrollToLatestCount) {
      scrollToLatestCount.textContent = "";
      scrollToLatestCount.setAttribute("aria-hidden", "true");
    }
    scrollToLatestBtn.setAttribute("aria-label", "Jump to latest messages");
    scrollToLatestBtn.removeAttribute("title");
  }
}

function setScrollLockState(locked) {
  scrollLockState.locked = Boolean(locked);
  if (messages) {
    if (scrollLockState.locked) {
      messages.dataset.scrollLock = "1";
    } else {
      delete messages.dataset.scrollLock;
    }
  }
  updateScrollLockIndicator();
}

function resetMissedMessages() {
  if (scrollLockState.missed !== 0) {
    scrollLockState.missed = 0;
  }
  updateScrollLockIndicator();
}

function cancelEnsureMessagesAtBottom() {
  if (ensureBottomTimer) {
    clearTimeout(ensureBottomTimer);
    ensureBottomTimer = null;
  }
}

function ensureMessagesAtBottom({ attempts = 5, interval = 140 } = {}) {
  if (!messages) return;

  const totalAttempts = Math.max(1, attempts);
  let remaining = totalAttempts;

  cancelEnsureMessagesAtBottom();

  const attemptScroll = () => {
    ensureBottomTimer = null;
    if (!messages) return;

    if (scrollLockState.locked && !isMessagesAtBottom()) {
      return;
    }

    scrollMessagesToBottom({ behavior: "auto", delay: 0, force: true });
    remaining -= 1;
    if (remaining <= 0) {
      return;
    }

    ensureBottomTimer = setTimeout(() => {
      ensureBottomTimer = null;
      if (!messages) return;
      if (scrollLockState.locked && !isMessagesAtBottom()) {
        return;
      }
      if (!isMessagesAtBottom()) {
        attemptScroll();
      }
    }, Math.max(16, interval));
  };

  attemptScroll();
}

function incrementMissedMessages() {
  const next = scrollLockState.missed + 1;
  scrollLockState.missed = next > MAX_MISSED_MESSAGE_COUNT ? MAX_MISSED_MESSAGE_COUNT : next;
  updateScrollLockIndicator();
}

function scrollMessagesToBottom({ behavior = "auto", delay = 0, force = false } = {}) {
  if (!messages) return;

  ensureMessagesEndSentinel();

  const performScroll = () => {
    if (!force && scrollLockState.locked) return;

    beginProgrammaticScrollWindow();

    try {
      messages.scrollTo({ top: messages.scrollHeight, behavior });
    } catch {
      messages.scrollTop = messages.scrollHeight;
    }

    scrollSentinelState.atBottom = true;
    scrollSentinelState.visibleRatio = 1;
    setScrollLockState(false);
    resetMissedMessages();
  };

  if (delay > 0) {
    setTimeout(() => requestAnimationFrame(performScroll), delay);
  } else {
    requestAnimationFrame(() => requestAnimationFrame(performScroll));
  }
}

function updatePsybinPlayerControls() {
  if (!psybinAudio) return;
  const isPlaying = !psybinAudio.paused && !psybinAudio.ended;
  const isPlayerVisible = Boolean(psybinPlayer && !psybinPlayer.hidden);
  if (psybinPlayBtn) {
    psybinPlayBtn.textContent = isPlaying ? "⏸" : "▶";
    psybinPlayBtn.setAttribute(
      "aria-label",
      isPlaying ? "Pause Psybin Radio" : "Play Psybin Radio"
    );
    psybinPlayBtn.toggleAttribute("disabled", !isPlayerVisible);
  }

  if (psybinMuteBtn) {
    const isMuted = psybinAudio.muted || psybinAudio.volume === 0;
    psybinMuteBtn.textContent = isMuted ? "🔇" : "🔊";
    psybinMuteBtn.setAttribute(
      "aria-label",
      isMuted ? "Unmute Psybin Radio" : "Mute Psybin Radio"
    );
    psybinMuteBtn.toggleAttribute("disabled", !isPlayerVisible);
  }

  if (psybinVolumeInput) {
    const volumeValue = psybinAudio.muted ? 0 : psybinAudio.volume;
    psybinVolumeInput.value = String(Number.isFinite(volumeValue) ? volumeValue : 1);
    psybinVolumeInput.toggleAttribute("disabled", !isPlayerVisible);
  }
}

function normalisePsybinMetadata(payload) {
  if (!payload || typeof payload !== "object") {
    return {
      title: "",
      artist: "",
      text: "",
      fetchedAt: Date.now(),
      coverUrl: PSYBIN_COVER_FALLBACK,
      remainingMs: null,
    };
  }

  const normaliseString = (value) => (typeof value === "string" ? value.trim() : "");
  const normaliseNumber = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : Date.now();
  };
  const normaliseDuration = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
  };

  const coverUrl = normaliseString(payload.coverUrl) || PSYBIN_COVER_FALLBACK;
  const remainingMs = normaliseDuration(payload.remainingMs);

  const title = normaliseString(payload.title);
  const artist = normaliseString(payload.artist);
  const text = normaliseString(payload.text);
  const fetchedAt = normaliseNumber(payload.fetchedAt);

  return { title, artist, text, fetchedAt, coverUrl, remainingMs };
}

function getPsybinTrackSignature(metadata) {
  if (!metadata) return "";
  const safeString = (value) => (typeof value === "string" ? value.trim().toLowerCase() : "");
  const artist = safeString(metadata.artist);
  const title = safeString(metadata.title);
  const text = safeString(metadata.text);
  const parts = [];
  if (artist) parts.push(artist);
  if (title) parts.push(title);
  if (!parts.length && text) parts.push(text);
  return parts.join(" — ");
}

function didPsybinTrackChange(previousMetadata, nextMetadata) {
  return getPsybinTrackSignature(previousMetadata) !== getPsybinTrackSignature(nextMetadata);
}

function getPsybinCoverUrl(metadata) {
  const rawUrl = typeof metadata?.coverUrl === "string" ? metadata.coverUrl.trim() : "";
  if (!rawUrl) return "";
  const cacheBuster = psybinPlayerState.coverBuster;
  if (!cacheBuster) return rawUrl;
  const separator = rawUrl.includes("?") ? "&" : "?";
  return `${rawUrl}${separator}t=${cacheBuster}`;
}

function handlePsybinTrackChange() {
  psybinPlayerState.coverBuster = Date.now();
  psybinPlayerState.trackStartedAt = Date.now();
  clearPsybinElapsedTicker();
}

function formatElapsedMs(elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return "";
  const totalSeconds = Math.max(0, Math.round(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")} elapsed`;
}

function getPsybinElapsedMs() {
  const startedAt = psybinPlayerState.trackStartedAt;
  if (!Number.isFinite(startedAt)) return null;
  const elapsed = Date.now() - Number(startedAt);
  return elapsed >= 0 ? elapsed : 0;
}

function clearPsybinElapsedTicker() {
  if (psybinPlayerState.elapsedTimer) {
    clearInterval(psybinPlayerState.elapsedTimer);
    psybinPlayerState.elapsedTimer = null;
  }
}

function updatePsybinElapsedTimeDisplay() {
  if (!psybinRemaining) return;
  const elapsed = getPsybinElapsedMs();
  const label = formatElapsedMs(elapsed);
  psybinRemaining.textContent = label;
  psybinRemaining.hidden = !label;
}

function ensurePsybinElapsedTicker() {
  clearPsybinElapsedTicker();
  if (!psybinPlayer || psybinPlayer.hidden) {
    updatePsybinElapsedTimeDisplay();
    return;
  }

  updatePsybinElapsedTimeDisplay();
  psybinPlayerState.elapsedTimer = setInterval(() => {
    updatePsybinElapsedTimeDisplay();
  }, PSYBIN_ELAPSED_REFRESH_MS);
}

function updatePsybinCoverDisplay(metadata) {
  if (!psybinCover) return;
  const coverUrl = getPsybinCoverUrl(metadata);
  if (coverUrl) {
    if (psybinCover.src !== coverUrl) {
      psybinCover.src = coverUrl;
    }
    psybinCover.hidden = false;
  } else {
    psybinCover.hidden = true;
    psybinCover.removeAttribute("src");
  }
}

function updatePsybinMetadataDisplay() {
  if (!psybinMetadataText || !psybinMetadata) return;

  const { metadata, isStreamLoading } = psybinPlayerState;

  let displayText = PSYBIN_METADATA_IDLE_TEXT;
  let state = "idle";

  if (!psybinPlayerState.trackStartedAt && metadata) {
    const fetchedAt = Number(metadata.fetchedAt);
    if (Number.isFinite(fetchedAt)) {
      psybinPlayerState.trackStartedAt = fetchedAt;
    }
  }

  if (isStreamLoading) {
    displayText = "Connecting to Psybin Radio…";
    state = "loading";
  } else if (metadata) {
    const title = typeof metadata.title === "string" ? metadata.title.trim() : "";
    const artist = typeof metadata.artist === "string" ? metadata.artist.trim() : "";
    const text = typeof metadata.text === "string" ? metadata.text.trim() : "";

    if (text) {
      displayText = text;
      state = "ready";
    } else if (title || artist) {
      const parts = [];
      if (artist) parts.push(artist);
      if (title) parts.push(title);
      displayText = parts.length ? parts.join(" — ") : PSYBIN_METADATA_IDLE_TEXT;
      state = parts.length ? "ready" : "idle";
    }
  }

  if (psybinMetadataText.textContent !== displayText) {
    psybinMetadataText.textContent = displayText;
  }

  psybinMetadata.dataset.state = state;
  updatePsybinCoverDisplay(metadata);
  ensurePsybinElapsedTicker();
}

function setPsybinStreamLoading(loading) {
  const next = Boolean(loading);
  if (psybinPlayerState.isStreamLoading === next) return;
  psybinPlayerState.isStreamLoading = next;
  updatePsybinMetadataDisplay();
}

function clearPsybinMetadataTimer() {
  if (psybinPlayerState.metadataTimer) {
    clearTimeout(psybinPlayerState.metadataTimer);
    psybinPlayerState.metadataTimer = null;
  }
}

function schedulePsybinMetadataRefresh(delayMs) {
  clearPsybinMetadataTimer();
  if (!psybinPlayer || psybinPlayer.hidden) return;

  const delay = Math.max(0, Number(delayMs) || 0);
  psybinPlayerState.metadataTimer = setTimeout(() => {
    psybinPlayerState.metadataTimer = null;
    fetchPsybinMetadata();
  }, delay);
}

async function fetchPsybinMetadata() {
  if (!psybinPlayer || psybinPlayer.hidden) return;
  if (psybinPlayerState.metadataRequestInFlight) return;
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;

  psybinPlayerState.metadataRequestInFlight = true;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  if (controller) {
    psybinPlayerState.metadataAbortController = controller;
  }

  let nextDelay = PSYBIN_METADATA_RETRY_MS;

  try {
    const response = await window.fetch(PSYBIN_METADATA_URL, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: controller?.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response
      .json()
      .catch(() => ({ title: "", artist: "", text: "" }));

    const nextMetadata = normalisePsybinMetadata(payload);
    const trackChanged = didPsybinTrackChange(psybinPlayerState.metadata, nextMetadata);
    psybinPlayerState.metadata = trackChanged
      ? { ...nextMetadata, fetchedAt: Date.now() }
      : nextMetadata;
    psybinPlayerState.trackSignature = getPsybinTrackSignature(psybinPlayerState.metadata);
    if (trackChanged) {
      handlePsybinTrackChange();
    }
    nextDelay = PSYBIN_METADATA_REFRESH_MS;
  } catch (err) {
    if (err?.name !== "AbortError") {
      console.warn("[Psybin] Metadata fetch failed", err);
    }
  } finally {
    if (psybinPlayerState.metadataAbortController === controller) {
      psybinPlayerState.metadataAbortController = null;
    }
    psybinPlayerState.metadataRequestInFlight = false;
    updatePsybinMetadataDisplay();
    schedulePsybinMetadataRefresh(nextDelay);
  }
}

function ensurePsybinMetadataPolling({ immediate = false } = {}) {
  if (!psybinPlayer || psybinPlayer.hidden) return;
  if (immediate) {
    if (psybinPlayerState.metadataRequestInFlight) return;
    clearPsybinMetadataTimer();
    fetchPsybinMetadata();
    return;
  }

  schedulePsybinMetadataRefresh(PSYBIN_METADATA_REFRESH_MS);
}

function stopPsybinMetadataUpdates({ resetMetadata = false } = {}) {
  clearPsybinMetadataTimer();
  const controller = psybinPlayerState.metadataAbortController;
  if (controller) {
    try {
      controller.abort();
    } catch (_err) {
      /* ignore */
    }
    psybinPlayerState.metadataAbortController = null;
  }
  psybinPlayerState.metadataRequestInFlight = false;
  if (resetMetadata) {
    psybinPlayerState.metadata = null;
    psybinPlayerState.trackSignature = "";
    psybinPlayerState.coverBuster = null;
    psybinPlayerState.trackStartedAt = null;
  }
  clearPsybinElapsedTicker();
  updatePsybinMetadataDisplay();
}

function initPsybinPlayer() {
  if (psybinPlayerState.initialised || !psybinAudio || !psybinPlayer) return;
  psybinPlayerState.initialised = true;
  updatePsybinMetadataDisplay();

  if (psybinPlayBtn) {
    psybinPlayBtn.addEventListener("click", async () => {
      if (psybinPlayer.hidden) return;
      if (psybinAudio.paused) {
        if (!psybinAudio.src) {
          psybinAudio.src = PSYBIN_RADIO_STREAM_URL;
        }
        setPsybinStreamLoading(true);
        ensurePsybinMetadataPolling({ immediate: true });
        try {
          await psybinAudio.play();
        } catch (err) {
          console.warn("[Psybin] Unable to start playback", err);
          setPsybinStreamLoading(false);
        }
      } else {
        psybinAudio.pause();
        setPsybinStreamLoading(false);
      }
      updatePsybinPlayerControls();
    });
  }

  if (psybinMuteBtn) {
    psybinMuteBtn.addEventListener("click", () => {
      if (psybinPlayer.hidden) return;
      const isMuted = psybinAudio.muted || psybinAudio.volume === 0;
      if (isMuted) {
        psybinAudio.muted = false;
        const restoreVolume = psybinPlayerState.lastVolume > 0 ? psybinPlayerState.lastVolume : 1;
        psybinAudio.volume = restoreVolume;
      } else {
        psybinPlayerState.lastVolume = psybinAudio.volume || psybinPlayerState.lastVolume || 1;
        psybinAudio.muted = true;
      }
      updatePsybinPlayerControls();
    });
  }

  if (psybinVolumeInput) {
    psybinVolumeInput.addEventListener("input", (event) => {
      if (psybinPlayer.hidden) return;
      const value = Number(event.target?.value);
      if (!Number.isFinite(value)) return;
      psybinAudio.volume = Math.min(Math.max(value, 0), 1);
      if (psybinAudio.volume === 0) {
        psybinAudio.muted = true;
      } else {
        psybinAudio.muted = false;
        psybinPlayerState.lastVolume = psybinAudio.volume;
      }
      updatePsybinPlayerControls();
    });
  }

  psybinAudio.addEventListener("play", updatePsybinPlayerControls);
  psybinAudio.addEventListener("pause", updatePsybinPlayerControls);
  psybinAudio.addEventListener("volumechange", () => {
    if (!psybinAudio.muted && psybinAudio.volume > 0) {
      psybinPlayerState.lastVolume = psybinAudio.volume;
    }
    updatePsybinPlayerControls();
  });

  psybinAudio.addEventListener("play", () => {
    setPsybinStreamLoading(false);
    ensurePsybinMetadataPolling({ immediate: true });
  });
  psybinAudio.addEventListener("playing", () => {
    setPsybinStreamLoading(false);
  });
  psybinAudio.addEventListener("loadstart", () => {
    if (!psybinAudio.paused) {
      setPsybinStreamLoading(true);
    }
  });
  psybinAudio.addEventListener("waiting", () => {
    if (!psybinAudio.paused) {
      setPsybinStreamLoading(true);
    }
  });
  psybinAudio.addEventListener("stalled", () => {
    if (!psybinAudio.paused) {
      setPsybinStreamLoading(true);
    }
  });
  psybinAudio.addEventListener("pause", () => {
    setPsybinStreamLoading(false);
  });
  psybinAudio.addEventListener("error", () => {
    setPsybinStreamLoading(false);
  });
}

function setPsybinPlayerRoom(roomName) {
  if (!psybinPlayer || !psybinAudio) return;
  initPsybinPlayer();
  const canonical = typeof roomName === "string" ? roomName.trim().toLowerCase() : "";
  const isPsybinRoom = canonical === PSYBIN_RADIO_ROOM_CANONICAL;
  psybinPlayer.hidden = !isPsybinRoom;
  psybinPlayer.setAttribute("aria-hidden", String(!isPsybinRoom));

  if (isPsybinRoom) {
    if (!psybinAudio.src) {
      psybinAudio.src = PSYBIN_RADIO_STREAM_URL;
    }
    const restoreVolume = psybinPlayerState.lastVolume > 0 ? psybinPlayerState.lastVolume : 1;
    try {
      psybinAudio.volume = restoreVolume;
    } catch {
      /* ignore */
    }
    psybinAudio.muted = false;
    psybinPlayBtn?.removeAttribute("disabled");
    psybinMuteBtn?.removeAttribute("disabled");
    psybinVolumeInput?.removeAttribute("disabled");
    const isBuffering = !psybinAudio.paused && psybinAudio.readyState < 2;
    setPsybinStreamLoading(isBuffering);
    ensurePsybinMetadataPolling({ immediate: true });
    updatePsybinMetadataDisplay();
    updatePsybinPlayerControls();
  } else {
    if (!psybinAudio.paused) {
      psybinAudio.pause();
    }
    psybinAudio.muted = true;
    psybinAudio.removeAttribute("src");
    try {
      psybinAudio.load();
    } catch {
      /* ignore */
    }
    psybinPlayBtn?.setAttribute("disabled", "true");
    psybinMuteBtn?.setAttribute("disabled", "true");
    psybinVolumeInput?.setAttribute("disabled", "true");
    if (psybinVolumeInput) {
      psybinVolumeInput.value = "1";
    }
    setPsybinStreamLoading(false);
    stopPsybinMetadataUpdates({ resetMetadata: true });
    updatePsybinPlayerControls();
  }
}

function isInfowarsRoom(roomName) {
  if (!roomName) return false;
  try {
    const normalized = String(roomName).toLowerCase();
    return INFOWARS_ROOM_KEYWORDS.some((keyword) => normalized.includes(keyword));
  } catch {
    return false;
  }
}

function getInfowarsToolbarBottom() {
  if (!toolbar) return INFOWARS_MODAL_MARGIN;
  try {
    const rect = toolbar.getBoundingClientRect();
    if (!rect) return INFOWARS_MODAL_MARGIN;
    const offset = rect.bottom + INFOWARS_MODAL_MARGIN;
    return Number.isFinite(offset) ? offset : INFOWARS_MODAL_MARGIN;
  } catch {
    return INFOWARS_MODAL_MARGIN;
  }
}

function getInfowarsActiveHeight() {
  if (infowarsModalState.collapsed) {
    const headerHeight = infowarsModalHeader?.getBoundingClientRect?.()?.height;
    if (Number.isFinite(headerHeight) && headerHeight > 0) {
      return headerHeight;
    }
    return 52;
  }
  return infowarsModalState.height;
}

function applyInfowarsModalLayout({ clampPosition = true } = {}) {
  if (!infowarsModal || !infowarsModalState.visible) return;

  if (!infowarsModalState.hasCustomSize && !infowarsModalState.collapsed) {
    const autoSize = computeInfowarsModalAutoSize();
    if (autoSize) {
      infowarsModalState.width = autoSize.width;
      infowarsModalState.height = autoSize.height;
    }
  }

  const maxWidth = Math.max(
    INFOWARS_MODAL_MIN_WIDTH,
    window.innerWidth - INFOWARS_MODAL_MARGIN * 2
  );
  const maxHeight = Math.max(
    INFOWARS_MODAL_MIN_HEIGHT,
    window.innerHeight - INFOWARS_MODAL_MARGIN * 2
  );

  const width = clampNumber(infowarsModalState.width, INFOWARS_MODAL_MIN_WIDTH, maxWidth);
  const height = clampNumber(infowarsModalState.height, INFOWARS_MODAL_MIN_HEIGHT, maxHeight);

  infowarsModalState.width = width;
  infowarsModalState.height = height;

  let left = Number.isFinite(infowarsModalState.left)
    ? infowarsModalState.left
    : null;
  let top = Number.isFinite(infowarsModalState.top)
    ? infowarsModalState.top
    : null;

  const activeHeight = getInfowarsActiveHeight();
  const minLeft = INFOWARS_MODAL_MARGIN;
  const maxLeft = Math.max(minLeft, window.innerWidth - width - INFOWARS_MODAL_MARGIN);
  const minTop = Math.max(INFOWARS_MODAL_MARGIN, getInfowarsToolbarBottom());
  const maxTop = Math.max(minTop, window.innerHeight - activeHeight - INFOWARS_MODAL_MARGIN);

  if (left === null) {
    left = clampNumber(INFOWARS_MODAL_MARGIN * 1.5, minLeft, maxLeft);
  }
  if (top === null) {
    top = clampNumber(minTop, minTop, maxTop);
  }

  if (clampPosition) {
    left = clampNumber(left, minLeft, maxLeft);
    top = clampNumber(top, minTop, maxTop);
  }

  infowarsModalState.left = left;
  infowarsModalState.top = top;

  infowarsModal.style.width = `${width}px`;
  infowarsModal.style.height = `${height}px`;
  infowarsModal.style.left = `${left}px`;
  infowarsModal.style.top = `${top}px`;
  infowarsModal.classList.toggle("collapsed", Boolean(infowarsModalState.collapsed));
  infowarsModal.classList.toggle("dragging", Boolean(infowarsModalState.dragging));
  infowarsModal.classList.toggle("resizing", Boolean(infowarsModalState.resizing));

  syncInfowarsStreamEmbedSize();
}

function updateInfowarsCollapseButton() {
  if (!infowarsCollapseBtn) return;
  const collapsed = Boolean(infowarsModalState.collapsed);
  infowarsCollapseBtn.textContent = collapsed ? "▴" : "▾";
  infowarsCollapseBtn.setAttribute(
    "aria-label",
    collapsed ? "Expand stream" : "Minimize stream"
  );
  infowarsCollapseBtn.title = collapsed ? "Expand stream" : "Minimize stream";
}

function toggleInfowarsCollapse(force) {
  if (!infowarsModalState.visible) return;
  const nextState = typeof force === "boolean" ? force : !infowarsModalState.collapsed;
  if (nextState === infowarsModalState.collapsed) return;
  infowarsModalState.collapsed = nextState;
  updateInfowarsCollapseButton();
  applyInfowarsModalLayout();
  syncInfowarsStreamEmbedSize();
}

function resetInfowarsPointerState() {
  infowarsModalState.dragging = false;
  infowarsModalState.resizing = false;
  infowarsModalState.pointerId = null;
  infowarsModalState.resizePointerId = null;
  infowarsModalState.dragMoved = false;
  infowarsModalState.ignoreHeaderClick = false;
  infowarsModalState.dragStartX = 0;
  infowarsModalState.dragStartY = 0;
  infowarsModal?.classList?.remove?.("dragging");
  infowarsModal?.classList?.remove?.("resizing");
}

function setInfowarsStreamRoom(roomName) {
  if (!infowarsModal) return;

  const shouldShow = isInfowarsRoom(roomName);
  infowarsModalState.visible = shouldShow;

  if (!shouldShow) {
    stopInfowarsStreamPlayback();
    infowarsModal.hidden = true;
    infowarsModal.setAttribute("aria-hidden", "true");
    infowarsModal.classList.remove("collapsed", "dragging", "resizing");
    if (infowarsModalState.collapsed) {
      infowarsModalState.collapsed = false;
      updateInfowarsCollapseButton();
    }
    if (infowarsModalState.pointerId !== null) {
      infowarsModalHeader?.releasePointerCapture?.(infowarsModalState.pointerId);
    }
    if (infowarsModalState.resizePointerId !== null) {
      infowarsResizeHandle?.releasePointerCapture?.(infowarsModalState.resizePointerId);
    }
    resetInfowarsPointerState();
    return;
  }

  if (!Number.isFinite(infowarsModalState.left) || !Number.isFinite(infowarsModalState.top)) {
    infowarsModalState.left = INFOWARS_MODAL_MARGIN * 1.5;
    infowarsModalState.top = Math.max(getInfowarsToolbarBottom(), INFOWARS_MODAL_MARGIN);
  }

  applyInfowarsModalLayout({ clampPosition: true });
  updateInfowarsCollapseButton();
  infowarsModal.hidden = false;
  infowarsModal.setAttribute("aria-hidden", "false");
  syncInfowarsStreamEmbedSize();
  resumeInfowarsStreamPlayback();
}

function handleInfowarsPointerMove(event) {
  if (!infowarsModalState.visible || !infowarsModal) return;

  if (infowarsModalState.dragging && event.pointerId === infowarsModalState.pointerId) {
    if (!infowarsModalState.dragMoved) {
      const dx = Math.abs(event.clientX - infowarsModalState.dragStartX);
      const dy = Math.abs(event.clientY - infowarsModalState.dragStartY);
      if (dx > 2 || dy > 2) {
        infowarsModalState.dragMoved = true;
      }
    }

    const width = infowarsModalState.width;
    const activeHeight = getInfowarsActiveHeight();
    const minLeft = INFOWARS_MODAL_MARGIN;
    const maxLeft = Math.max(minLeft, window.innerWidth - width - INFOWARS_MODAL_MARGIN);
    const minTop = Math.max(INFOWARS_MODAL_MARGIN, getInfowarsToolbarBottom());
    const maxTop = Math.max(minTop, window.innerHeight - activeHeight - INFOWARS_MODAL_MARGIN);

    const prevLeft = infowarsModalState.left;
    const prevTop = infowarsModalState.top;

    const nextLeft = clampNumber(
      event.clientX - infowarsModalState.dragOffsetX,
      minLeft,
      maxLeft
    );
    const nextTop = clampNumber(
      event.clientY - infowarsModalState.dragOffsetY,
      minTop,
      maxTop
    );

    if (
      !infowarsModalState.dragMoved &&
      Number.isFinite(prevLeft) &&
      Number.isFinite(prevTop) &&
      (Math.abs(nextLeft - prevLeft) > 0 || Math.abs(nextTop - prevTop) > 0)
    ) {
      infowarsModalState.dragMoved = true;
    }

    infowarsModalState.left = nextLeft;
    infowarsModalState.top = nextTop;
    infowarsModal.style.left = `${nextLeft}px`;
    infowarsModal.style.top = `${nextTop}px`;
  } else if (infowarsModalState.resizing && event.pointerId === infowarsModalState.resizePointerId) {
    const maxWidth = Math.max(
      INFOWARS_MODAL_MIN_WIDTH,
      window.innerWidth - infowarsModalState.left - INFOWARS_MODAL_MARGIN
    );
    const maxHeight = Math.max(
      INFOWARS_MODAL_MIN_HEIGHT,
      window.innerHeight - infowarsModalState.top - INFOWARS_MODAL_MARGIN
    );

    const width = clampNumber(
      infowarsModalState.resizeStartWidth + (event.clientX - infowarsModalState.resizeStartX),
      INFOWARS_MODAL_MIN_WIDTH,
      maxWidth
    );
    const height = clampNumber(
      infowarsModalState.resizeStartHeight + (event.clientY - infowarsModalState.resizeStartY),
      INFOWARS_MODAL_MIN_HEIGHT,
      maxHeight
    );

    infowarsModalState.width = width;
    infowarsModalState.height = height;
    infowarsModalState.hasCustomSize = true;

    infowarsModal.style.width = `${width}px`;
    if (!infowarsModalState.collapsed) {
      infowarsModal.style.height = `${height}px`;
    }

    syncInfowarsStreamEmbedSize();
  }
}

function handleInfowarsPointerUp(event) {
  if (!infowarsModal) return;

  if (infowarsModalState.dragging && event.pointerId === infowarsModalState.pointerId) {
    infowarsModalHeader?.releasePointerCapture?.(event.pointerId);
    infowarsModalState.dragging = false;
    infowarsModalState.pointerId = null;
    infowarsModalState.ignoreHeaderClick = infowarsModalState.dragMoved;
    infowarsModalState.dragMoved = false;
    infowarsModal.classList.remove("dragging");
    applyInfowarsModalLayout();
  }

  if (infowarsModalState.resizing && event.pointerId === infowarsModalState.resizePointerId) {
    infowarsResizeHandle?.releasePointerCapture?.(event.pointerId);
    infowarsModalState.resizing = false;
    infowarsModalState.resizePointerId = null;
    infowarsModal.classList.remove("resizing");
    applyInfowarsModalLayout();
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

if (messages) {
  ensureMessagesEndSentinel();
  initScrollSentinelObserver();

  messages.addEventListener(
    "scroll",
    () => {
      if (isProgrammaticScrollActive()) return;

      if (messages.scrollTop <= 48) {
        requestOlderMessages();
      }

      if (messagesEndSentinel && scrollSentinelState.observer) {
        if (isMessagesAtBottom()) {
          setScrollLockState(false);
          resetMissedMessages();
        } else {
          setScrollLockState(true);
          cancelEnsureMessagesAtBottom();
        }
        return;
      }

      const locked = !isMessagesNearBottom();
      setScrollLockState(locked);
      if (locked) {
        cancelEnsureMessagesAtBottom();
      } else {
        resetMissedMessages();
      }
    },
    { passive: true }
  );
}

if (infowarsModalHeader && infowarsModal) {
  infowarsModalHeader.addEventListener("pointerdown", (event) => {
    if (!infowarsModalState.visible) return;
    const isTouch = event.pointerType === "touch";
    if (!isTouch && event.button !== 0) return;
    const rect = infowarsModal.getBoundingClientRect();
    infowarsModalState.dragging = true;
    infowarsModalState.pointerId = event.pointerId;
    infowarsModalState.dragOffsetX = event.clientX - rect.left;
    infowarsModalState.dragOffsetY = event.clientY - rect.top;
    infowarsModalState.dragStartX = event.clientX;
    infowarsModalState.dragStartY = event.clientY;
    infowarsModalState.dragMoved = false;
    infowarsModalState.ignoreHeaderClick = false;
    infowarsModal.classList.add("dragging");
    infowarsModalHeader.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  infowarsModalHeader.addEventListener("click", (event) => {
    if (!infowarsModalState.visible) return;
    if (event.detail && event.detail > 1) return;
    if (infowarsModalState.ignoreHeaderClick) {
      infowarsModalState.ignoreHeaderClick = false;
      return;
    }
    toggleInfowarsCollapse();
  });
}

if (infowarsCollapseBtn) {
  infowarsCollapseBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleInfowarsCollapse();
  });
}

if (infowarsStreamFrame && typeof MutationObserver === "function") {
  infowarsStreamObserver = new MutationObserver(() => {
    syncInfowarsStreamEmbedSize();
  });

  infowarsStreamObserver.observe(infowarsStreamFrame, {
    childList: true,
    subtree: true,
  });

  syncInfowarsStreamEmbedSize();
}

if (infowarsResizeHandle && infowarsModal) {
  infowarsResizeHandle.addEventListener("pointerdown", (event) => {
    if (!infowarsModalState.visible) return;
    const isTouch = event.pointerType === "touch";
    if (!isTouch && event.button !== 0) return;
    const rect = infowarsModal.getBoundingClientRect();
    infowarsModalState.resizing = true;
    infowarsModalState.resizePointerId = event.pointerId;
    infowarsModalState.resizeStartWidth = rect.width;
    infowarsModalState.resizeStartHeight = rect.height;
    infowarsModalState.resizeStartX = event.clientX;
    infowarsModalState.resizeStartY = event.clientY;
    infowarsModal.classList.add("resizing");
    infowarsResizeHandle.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
}

if (typeof document !== "undefined") {
  document.addEventListener("pointermove", handleInfowarsPointerMove, { passive: true });
  document.addEventListener("pointerup", handleInfowarsPointerUp, { passive: true });
  document.addEventListener("pointercancel", handleInfowarsPointerUp, { passive: true });
}

if (typeof window !== "undefined") {
  window.addEventListener("resize", () => {
    if (infowarsModalState.visible) {
      applyInfowarsModalLayout();
    }
  });

  window.addEventListener("beforeunload", () => {
    stopInfowarsStreamPlayback();
    if (psybinAudio) {
      try {
        psybinAudio.pause();
        psybinAudio.removeAttribute("src");
        psybinAudio.load?.();
      } catch {
        /* ignore */
      }
    }
  });
}

if (scrollToLatestBtn) {
  scrollToLatestBtn.addEventListener("click", () => {
    resetMissedMessages();
    scrollMessagesToBottom({ behavior: "smooth", force: true });
  });

  updateScrollLockIndicator();
}

// ===== JOIN ROOM (with corrections for transition) =====

function completeRoomJoin(username, room, password) {
  window.currentUser = username;
  window.currentRoom = room;
  window.currentPassword = password;

  lastRoomName = room;
  lastRoomPassword = password;
  isViewingChat = true;
  setViewMode("chat");
  if (copyJoinLinkBtn) copyJoinLinkBtn.disabled = !room;

  setPsybinPlayerRoom(room);
  setInfowarsStreamRoom(room);

  appState.isAdmin = false;
  loadHiddenMessagesForRoom(room);
  loadUserVisibilityForRoom(room);
  appState.messages.clear();
  appState.pinned.clear();
  hideSearchResults();
  resetMessageReadObserver();
  if (messages) {
    messages.innerHTML = "";
    delete messages.dataset.lastDateKey;
    ensureMessagesEndSentinel();
    initScrollSentinelObserver();
  }
  setScrollLockState(false);
  resetMissedMessages();
  if (pinnedContainer) {
    pinnedContainer.innerHTML = "";
    pinnedContainer.style.display = "none";
  }
  renderUserSidebar([]);

  updateQueryParams(room, password);

  if (roomName) roomName.textContent = room ? `#${room}` : "";
  if (siteLanding) siteLanding.style.display = "none";
  if (usernamePrompt) usernamePrompt.style.display = "none";

  if (infowarsModalState.visible) {
    applyInfowarsModalLayout();
  }

  scrollMessagesToBottom({ behavior: "smooth", delay: 200, force: true });
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

  const data = Array.isArray(rooms)
    ? rooms.filter((room) => room && !room.requiresPassword)
    : [];
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
    const item = document.createElement("li");
    item.className = "public-room-item";
    item.dataset.room = roomNameValue;

    const nameEl = document.createElement("span");
    nameEl.className = "room-name";
    nameEl.textContent = roomNameValue;

    const metaEl = document.createElement("span");
    metaEl.className = "room-meta";
    const peopleLabel = occupants === 1 ? "1 online" : `${occupants} online`;
    metaEl.textContent = peopleLabel;

    item.appendChild(nameEl);
    item.appendChild(metaEl);
    item.tabIndex = 0;

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

// ------------------- Sound Notifications -------------------
initSoundNotifications();

// Listen for successful room join
socket.on("join room success", () => {
  clearReplyTarget();
  isViewingChat = true;
  if (copyJoinLinkBtn) copyJoinLinkBtn.disabled = !window.currentRoom;
  if (chatContainer) chatContainer.style.display = "flex";
  if (siteLanding) siteLanding.style.display = "none";
  if (usernamePrompt) usernamePrompt.style.display = "none";
  input?.focus();
  scrollMessagesToBottom({ behavior: "smooth", delay: 80, force: true });
});

// Join error handling
socket.on("join room error", (error) => {
  showToast(error || "Unable to join room", "error");
  showLanding({ focusUsername: true });
});

// Handle disconnect and clean up
socket.on("disconnect", () => {
  // Keep the current chat context while Socket.IO handles reconnection.
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

// ------------------- Layout Density Toggle -------------------
const COMPACT_MODE_STORAGE_KEY = "dizychat-compact-mode";

const readStoredCompactPreference = () => {
  try {
    const raw = localStorage.getItem(COMPACT_MODE_STORAGE_KEY);
    if (raw === null) return null;
    if (raw === "1" || raw === "true") return true;
    if (raw === "0" || raw === "false") return false;
  } catch {
    return null;
  }
  return null;
};

const getDefaultCompactPreference = () => {
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    try {
      return window.matchMedia("(max-width: 1400px)").matches;
    } catch {
      return false;
    }
  }
  return false;
};

const updateCompactToggleUi = (enabled) => {
  if (!compactToggle) return;
  const isEnabled = Boolean(enabled);
  const icon = compactToggle.querySelector?.(".icon");
  const srOnly = compactToggle.querySelector?.(".sr-only");
  const label = isEnabled ? "Switch to comfy layout" : "Switch to compact layout";

  compactToggle.setAttribute("aria-pressed", String(isEnabled));
  compactToggle.setAttribute("aria-label", label);
  compactToggle.title = label;
  if (srOnly) srOnly.textContent = label;
  if (icon) icon.textContent = isEnabled ? "🛋️" : "🗜️";
  compactToggle.classList.toggle("is-active", isEnabled);
};

const applyCompactMode = (enabled, { persist = true } = {}) => {
  const isEnabled = Boolean(enabled);
  document.body.classList.toggle("compact-mode", isEnabled);
  updateCompactToggleUi(isEnabled);
  if (persist) {
    try {
      localStorage.setItem(COMPACT_MODE_STORAGE_KEY, isEnabled ? "1" : "0");
    } catch {
      /* ignore persistence errors */
    }
  }
};

const storedCompactPreference = readStoredCompactPreference();
const initialCompactMode = storedCompactPreference ?? getDefaultCompactPreference();
applyCompactMode(initialCompactMode, { persist: storedCompactPreference !== null });

if (compactToggle) {
  compactToggle.addEventListener("click", () => {
    const next = !document.body.classList.contains("compact-mode");
    applyCompactMode(next);
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
if (emojiPicker) {
  emojiPickerController = (() => {
    const quickEmojiBar = emojiPicker.querySelector("#quick-emojis");
    if (quickEmojiBar) {
      quickEmojiBar.hidden = true;
      quickEmojiBar.setAttribute("aria-hidden", "true");
    }

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
            button.classList.add("emoji-item-image");
            const img = document.createElement("img");
            img.src = item.url;
            img.alt = item.name || "emoji";
            img.loading = "lazy";
            button.appendChild(img);
          }

          button.addEventListener("click", () => handleItemSelection(item));

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

    const state = {
      mode: "input",
      anchor: null,
      onSelect: null,
    };

    const resetPosition = () => {
      emojiPicker.style.removeProperty("top");
      emojiPicker.style.removeProperty("left");
      emojiPicker.style.removeProperty("bottom");
      emojiPicker.style.removeProperty("right");
    };

    const positionToAnchor = (anchor) => {
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const width = emojiPicker.offsetWidth || 320;
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const scrollX = window.pageXOffset || document.documentElement.scrollLeft || 0;
      const scrollY = window.pageYOffset || document.documentElement.scrollTop || 0;

      let left = rect.left + scrollX;
      if (left + width > viewportWidth - 16) {
        left = Math.max(16, viewportWidth - width - 16);
      }
      if (left < 16) left = 16;

      const top = rect.bottom + scrollY + 8;

      emojiPicker.style.left = `${left}px`;
      emojiPicker.style.top = `${top}px`;
      emojiPicker.style.removeProperty("bottom");
      emojiPicker.style.removeProperty("right");
    };

    const hide = () => {
      emojiPicker.classList.remove("show");
      emojiPicker.style.display = "none";
      emojiSearch.value = "";
      if (emojiCatalogLoaded) {
        renderEmojiList(emojiEntries);
      }
      resetPosition();
      state.mode = "input";
      state.anchor = null;
      state.onSelect = null;
    };

    const show = ({ mode = "input", anchor = null, onSelect = null } = {}) => {
      state.mode = mode;
      state.anchor = anchor || null;
      state.onSelect = typeof onSelect === "function" ? onSelect : null;
      if (!anchor) {
        resetPosition();
      }
      emojiPicker.classList.add("show");
      emojiPicker.style.display = "block";
      if (anchor) {
        positionToAnchor(anchor);
        requestAnimationFrame(() => positionToAnchor(anchor));
      }
      requestAnimationFrame(() => {
        emojiSearch.focus({ preventScroll: true });
      });
      loadEmojiCatalog();
    };

    const handleValueSelection = (value, meta = {}) => {
      const emojiValue = typeof value === "string" ? value : "";
      if (!emojiValue) return;

      const usageMeta = {
        kind: meta.kind === "url" ? "url" : "char",
        name: meta.item?.name || meta.name || "",
      };
      if (usageMeta.kind === "url") {
        usageMeta.preview = meta.item?.url || meta.preview || emojiValue;
      }
      trackEmojiUsage(emojiValue, usageMeta);

      if (state.mode === "reaction" && typeof state.onSelect === "function") {
        state.onSelect(emojiValue, meta);
        hide();
        return;
      }

      if (meta.kind === "url") {
        if (window.currentRoom && window.currentUser) {
          socket.emit("chat message", {
            room: window.currentRoom,
            user: window.currentUser,
            text: emojiValue,
            timestamp: Date.now(),
          });
          showToast(`${meta.item?.name || "Emoji"} sent`, "success");
        } else {
          showToast("Join a room to send emoji.", "warn");
        }
        hide();
        return;
      }

      insertEmojiIntoInput(emojiValue);
      hide();
    };

    const handleItemSelection = (item) => {
      if (!item) return;
      if (item.char) {
        handleValueSelection(item.char, { kind: "char", item });
        return;
      }
      if (item.url) {
        handleValueSelection(item.url, { kind: "url", item });
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

    if (emojiBtn) {
      emojiBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (emojiPicker.classList.contains("show") && state.mode === "input") {
          hide();
        } else {
          show({ mode: "input" });
        }
      });
    }

    document.addEventListener("click", (event) => {
      if (!emojiPicker.classList.contains("show")) return;
      if (emojiPicker.contains(event.target)) return;
      if (emojiBtn && (event.target === emojiBtn || emojiBtn.contains(event.target))) return;
      hide();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && emojiPicker.classList.contains("show")) {
        hide();
      }
    });

    const quickEmojiButtons = emojiPicker.querySelectorAll("#quick-emojis button");
    quickEmojiButtons.forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const emoji = btn.textContent?.trim();
        if (!emoji) return;
        handleValueSelection(emoji, { kind: "char", source: "quick" });
      });
    });

    return {
      show,
      hide,
      isVisible: () => emojiPicker.classList.contains("show"),
    };
  })();
}

// ------------------- Sending Messages -------------------
if (form) {
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const rawText = input?.value || "";
    const replyTo = normalizeMessageId(replyState.targetId) || undefined;
    const sent = sendPlainTextMessage(rawText, { replyTo });
    if (!sent) return;
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

input?.addEventListener("blur", () => {
  if (!isTyping) return;
  socket.emit("stop typing");
  isTyping = false;
  clearTimeout(typingTimeout);
});

socket.on("typing", (users) => {
  const bubble = document.getElementById("typing-bubble");
  if (!bubble) return;
  const uniqueOthers = Array.from(
    new Set((users || []).filter((u) => u && u !== window.currentUser))
  );
  if (!uniqueOthers.length) {
    bubble.textContent = "";
    bubble.setAttribute("aria-hidden", "true");
    bubble.classList.remove("show");
    bubble.classList.add("hide");
    return;
  }

  const formatTypingUsers = (list) => {
    if (list.length === 1) {
      return `${list[0]} is typing…`;
    }
    if (list.length === 2) {
      return `${list[0]} and ${list[1]} are typing…`;
    }
    if (list.length === 3) {
      return `${list[0]}, ${list[1]}, and ${list[2]} are typing…`;
    }
    return `${list[0]}, ${list[1]}, and ${list.length - 2} others are typing…`;
  };

  bubble.textContent = formatTypingUsers(uniqueOthers);
  bubble.setAttribute("aria-hidden", "false");
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
    if (linkText) {
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

function updateInlineMediaClasses(node) {
  if (!node) return;
  const message =
    node.classList?.contains?.("message")
      ? node
      : typeof node.closest === "function"
      ? node.closest(".message")
      : null;
  if (!message) return;

  const hasAudio = Boolean(
    message.querySelector(".inline-preview.inline-audio")
  );
  const hasVideo = Boolean(
    message.querySelector(".inline-preview.inline-video")
  );

  if (hasAudio || hasVideo) {
    message.classList.add("has-inline-media");
  } else {
    message.classList.remove("has-inline-media");
  }

  if (hasAudio) {
    message.classList.add("has-inline-audio");
  } else {
    message.classList.remove("has-inline-audio");
  }

  if (hasVideo) {
    message.classList.add("has-inline-video");
  } else {
    message.classList.remove("has-inline-video");
  }
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

  updateInlineMediaClasses(message);

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
  } else if (type !== "audio") {
    const view = document.createElement("a");
    view.href = link;
    view.target = "_blank";
    view.rel = "noopener noreferrer";
    view.className = "preview-view";
    view.textContent = "View";
    actions.appendChild(view);
  }

  const download = document.createElement("a");
  download.href = link;
  download.target = "_blank";
  download.rel = "noopener noreferrer";
  download.className = "preview-download";
  download.setAttribute("download", "");
  download.textContent = "Download";
  actions.appendChild(download);

  preview.appendChild(actions);
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


function isLikelyVoiceWebmUrl(url = "", name = "") {
  const target = `${String(url || "")} ${String(name || "")}`.trim();
  return /\.webm(?:[\s?].*)?$/i.test(target) && /(?:^|[\/_-])voice(?:[\/_-]|%20|$)/i.test(target);
}

function appendAttachmentFromMessage(node, msg) {
  if (!node || !msg?.fileUrl) return;
  const url = msg.fileUrl;
  const typeHint = (msg.fileType || "").toLowerCase();
  const fileNameHint = msg.fileName || "";
  const isTenor = /tenor\.com/i.test(url);
  if (
    isTenor &&
    typeof msg.text === "string" &&
    /tenor\.com/i.test(msg.text)
  ) {
    return;
  }

  let previewType = "";
  const imagePattern = /\.(png|jpg|jpeg|gif|webp|bmp|svg)(\?.*)?$/i;
  if (typeHint.startsWith("image/") || imagePattern.test(url)) {
    previewType = "image";
  } else if (typeHint.startsWith("audio/") || /\.(mp3|wav|ogg|opus)(\?.*)?$/i.test(url) || isLikelyVoiceWebmUrl(url, fileNameHint)) {
    previewType = "audio";
  } else if (typeHint.startsWith("video/") || /\.(mp4|webm|mov)(\?.*)?$/i.test(url)) {
    previewType = "video";
  } else if (typeHint.includes("pdf") || /\.(pdf)(\?.*)?$/i.test(url)) {
    previewType = "pdf";
  } else if (url) {
    previewType = "file";
  }

  if (!previewType || hasInlinePreview(node, url)) return;

  if (isTenor && node.querySelector(".inline-preview.tenor-inline")) {
    return;
  }

  if (previewType === "image" && !imagePattern.test(url)) {
    if (/tenor\.com/i.test(url)) {
      fetchTenorPreview(url, node);
    }
    return;
  }

  const label = (() => {
    if (isTenor) return "";
    if (msg.fileName && msg.fileName.trim()) return msg.fileName.trim();
    try {
      const urlObj = new URL(url, window.location.origin);
      const fileName = urlObj.pathname.split("/").pop() || "";
      if (fileName) {
        return decodeURIComponent(fileName);
      }
    } catch {
      /* noop */
    }
    return "";
  })();
  const preview = createInlinePreview(url, previewType, label);
  if (!preview) return;
  if (isTenor) {
    preview.classList.add("tenor-inline");
  }

  attachPreviewActions(preview, { link: url, label, type: previewType });
  node.appendChild(preview);
  node.classList.add("has-inline-preview");
  updateInlineMediaClasses(node);

  const textEl = node.querySelector(".text");
  if (textEl && textEl.textContent?.trim() === url.trim()) {
    textEl.textContent = "";
    textEl.style.display = "none";
  }

  updateTenorBubbleState(node);
}

// ------------------- History & Messages -------------------
function findFirstMessageNode() {
  if (!messages) return null;
  let node = messages.firstElementChild;
  while (node) {
    if (node.classList?.contains?.("message")) return node;
    node = node.nextElementSibling;
  }
  return messagesEndSentinel || null;
}

function renderMessage(
  msg,
  {
    skipScroll = false,
    scrollBehavior = "auto",
    delay = 0,
    respectScrollLock = false,
    position = "end",
    anchor = null,
  } = {}
) {
  if (!isViewingChat || !messages) return;
  const data = storeMessageData(msg);
  if (!data) return;
  if (!shouldShowUserMessages(data.user)) return;
  if (appState.hidden.has(data.id)) {
    appState.pinned.delete(data.id);
    updatePinnedBanner();
    return;
  }

  const wasNearBottom = isMessagesNearBottom();
  const isPrepend = position === "start";

  const timestamp = new Date(data.timestamp || Date.now());
  const sentinel = ensureMessagesEndSentinel();
  const referenceNode = isPrepend
    ? anchor || findFirstMessageNode()
    : sentinel;
  const separatorAnchor = isPrepend
    ? referenceNode || messages.firstChild || null
    : referenceNode;

  ensureDaySeparator(timestamp, {
    position: isPrepend ? "start" : "end",
    anchor: separatorAnchor,
  });
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
  let messageLinks = [];
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
      messageLinks = linkifyTextContent(textEl) || [];
    }
  }

  applyReplyContext(wrap, data);

  if (isPrepend) {
    if (referenceNode) {
      messages.insertBefore(wrap, referenceNode);
    } else {
      messages.appendChild(wrap);
    }
  } else if (sentinel) {
    messages.insertBefore(wrap, sentinel);
  } else {
    messages.appendChild(wrap);
  }
  applyMessageStatus(wrap, data);
  setupMessageActions(wrap, data);
  updateMessageFlags(wrap, data);
  trackMessageRead(wrap, data);

  if (!data.deleted) {
    appendAttachmentFromMessage(wrap, data);
    autoEmbed(wrap, messageLinks);
    observeMediaForScroll(wrap);
  }

  renderMessageReactions(wrap, data);

  if (!skipScroll) {
    if (respectScrollLock) {
      if (wasNearBottom) {
        scrollMessagesToBottom({ behavior: scrollBehavior, delay, force: true });
      } else {
        incrementMissedMessages();
        setScrollLockState(true);
      }
    } else {
      scrollMessagesToBottom({ behavior: scrollBehavior, delay, force: true });
    }
  }

  updatePinnedBanner();
}

function requestOlderMessages() {
  if (!socket || typeof socket.emit !== "function") return;
  if (!window.currentRoom) return;
  const historyState = appState.history;
  if (!historyState) return;
  if (!historyState.hasMore || historyState.loading) return;
  if (!historyState.cursor) return;

  historyState.loading = true;
  socket.emit("request older messages", {
    room: window.currentRoom,
    cursor: historyState.cursor,
  });
}

socket.on("load messages", (payload) => {
  if (!isViewingChat || !messages) return;
  const entries = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.messages)
    ? payload.messages
    : [];
  const cursor = !Array.isArray(payload) && payload?.cursor ? String(payload.cursor) : null;
  const hasMore = !Array.isArray(payload) && Boolean(cursor && payload?.hasMore);

  clearReplyTarget();
  appState.messages.clear();
  appState.pinned.clear();
  if (appState.history) {
    appState.history.cursor = cursor;
    appState.history.hasMore = hasMore;
    appState.history.loading = false;
  }
  messages.innerHTML = "";
  delete messages.dataset.lastDateKey;
  delete messages.dataset.firstDateKey;
  delete messages.dataset.lastDateValue;
  delete messages.dataset.firstDateValue;
  ensureMessagesEndSentinel();
  initScrollSentinelObserver();
  setScrollLockState(false);
  resetMissedMessages();
  entries.forEach((entry) => renderMessage(entry, { skipScroll: true }));
  updatePinnedBanner();
  ensureMessagesAtBottom();
  showToast(`✅ Joined room: ${window.currentRoom}`, "success");
});

socket.on("previous messages", (payload) => {
  if (!isViewingChat || !messages) return;
  const entries = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.messages)
    ? payload.messages
    : [];
  const childCount = messages.childElementCount;
  const sentinelPresent =
    messagesEndSentinel && messagesEndSentinel.parentNode === messages;
  const hasVisibleChildren = sentinelPresent ? childCount > 1 : childCount > 0;
  if (!hasVisibleChildren) {
    entries.forEach((entry) => renderMessage(entry, { skipScroll: true }));
    updatePinnedBanner();
    ensureMessagesAtBottom({ attempts: 3 });
  }
});

socket.on("older messages", (payload = {}) => {
  if (!isViewingChat || !messages) return;

  const entries = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.messages)
    ? payload.messages
    : [];

  const cursor = !Array.isArray(payload) && payload?.cursor ? String(payload.cursor) : null;
  const hasMore = !Array.isArray(payload) && Boolean(cursor && payload?.hasMore);

  if (appState.history) {
    if (cursor || cursor === null) {
      appState.history.cursor = cursor;
    }
    appState.history.hasMore = hasMore;
    appState.history.loading = false;
  }

  if (!entries.length) return;

  const anchor = findFirstMessageNode();
  const previousHeight = messages.scrollHeight;
  const previousScrollTop = messages.scrollTop;

  entries.forEach((entry) => {
    renderMessage(entry, {
      skipScroll: true,
      position: "start",
      anchor,
    });
  });

  const heightDiff = messages.scrollHeight - previousHeight;
  if (heightDiff > 0) {
    messages.scrollTop = previousScrollTop + heightDiff;
  }

  updatePinnedBanner();
});

socket.on("chat message", (msg) => {
  if (!isViewingChat) return;
  renderMessage(msg, { scrollBehavior: "smooth", respectScrollLock: true });
  maybePlayNotificationSound(msg);
  flashToolbar("message");
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

socket.on("update reactions", ({ id, reactions = [] } = {}) => {
  if (!id) return;
  const data = storeMessageData({ id, reactions });
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

// ------------------- File Upload Helpers -------------------
const createUploadOverlay = () => {
  const progress = document.createElement("div");
  progress.className = "upload-progress";
  progress.innerHTML = `<div class="bar" style="width:0%"></div><span style="display:none"></span>`;
  document.body.appendChild(progress);
  const bar = progress.querySelector(".bar");
  return { progress, bar };
};

const uploadFileAndSend = async (fileOrBlob, options = {}) => {
  if (!fileOrBlob) return false;

  const { fileName: overrideName, displayName, mimeType } = options;
  const intrinsicName =
    typeof fileOrBlob?.name === "string" && fileOrBlob.name
      ? fileOrBlob.name
      : "";
  const uploadName = overrideName || intrinsicName || "attachment";
  const label = displayName || uploadName;

  showToast(`Uploading ${label}…`, "info");

  const { progress, bar } = createUploadOverlay();
  let fake = 0;
  const formData = new FormData();

  const appendName = overrideName || !intrinsicName;
  if (appendName) {
    formData.append("file", fileOrBlob, uploadName);
  } else {
    formData.append("file", fileOrBlob);
  }

  const fakeTimer = setInterval(() => {
    fake = Math.min(fake + 7, 90);
    if (bar) bar.style.width = fake + "%";
    if (fake >= 90) clearInterval(fakeTimer);
  }, 120);

  try {
    const response = await fetch("/upload", { method: "POST", body: formData });
    const data = await response.json();

    if (!response.ok || data.error) {
      throw new Error(data.error || "Upload failed");
    }

    if (bar) bar.style.width = "100%";
    setTimeout(() => progress.remove(), 800);

    showToast(`Uploaded: ${label}`, "success");

    const replyTo = normalizeMessageId(replyState.targetId) || undefined;
    socket.emit("chat message", {
      room: window.currentRoom,
      user: window.currentUser,
      text: data.url,
      timestamp: Date.now(),
      fileUrl: data.url,
      fileType: data.type || mimeType || fileOrBlob.type || "",
      fileName: data.name || uploadName || "",
      replyTo,
    });

    clearReplyTarget();
    return true;
  } catch (err) {
    console.error("[Upload Error]", err);
    showToast(`Upload failed: ${label}`, "error");
    progress.remove();
    throw err;
  } finally {
    clearInterval(fakeTimer);
  }
};

// ------------------- File Uploads (paperclip + drag/drop) -------------------
if (attachBtn && fileInput) {
  fileInput.accept = "*/*";
  attachBtn.addEventListener("click", () => fileInput.click());

  const uploadDroppedFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;

    for (const file of files) {
      try {
        await uploadFileAndSend(file);
      } catch {
        /* handled in uploadFileAndSend */
      }
    }
  };

  fileInput.addEventListener("change", async (e) => {
    const files = e.target.files;
    if (!files?.length) return;

    await uploadDroppedFiles(files);
    fileInput.value = "";
  });

  const dropZone = form;
  if (dropZone) {
    let dragDepth = 0;

    const setDragState = (active) => {
      dropZone.classList.toggle("drag-over", Boolean(active));
    };

    ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
      dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    });

    dropZone.addEventListener("dragenter", (event) => {
      if (!event.dataTransfer?.types?.includes("Files")) return;
      dragDepth += 1;
      setDragState(true);
    });

    dropZone.addEventListener("dragleave", (event) => {
      if (!event.dataTransfer?.types?.includes("Files")) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setDragState(false);
    });

    dropZone.addEventListener("drop", async (event) => {
      dragDepth = 0;
      setDragState(false);
      await uploadDroppedFiles(event.dataTransfer?.files);
    });
  }
}

// ------------------- Voice Messages (push-to-talk) -------------------
if (voiceBtn) {
  const supportsMediaRecording =
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    navigator?.mediaDevices?.getUserMedia;

  if (!supportsMediaRecording) {
    voiceBtn.remove();
  } else {
    voiceBtn.hidden = false;
    voiceBtn.removeAttribute("aria-hidden");
    voiceBtn.setAttribute("aria-pressed", "false");

    const defaultLabel = voiceBtn.innerHTML;
    const defaultTitle =
      voiceBtn.getAttribute("title") || "Click to record a voice message";

    const pickMimeType = () => {
      const candidates = [
        "audio/webm;codecs=opus",
        "audio/ogg;codecs=opus",
        "audio/webm",
        "audio/ogg",
      ];
      if (typeof window.MediaRecorder?.isTypeSupported === "function") {
        for (const type of candidates) {
          if (window.MediaRecorder.isTypeSupported(type)) return type;
        }
      }
      return undefined;
    };

    const guessExtension = (type) => {
      if (!type) return "webm";
      if (type.includes("ogg")) return "ogg";
      if (type.includes("mp3")) return "mp3";
      if (type.includes("wav")) return "wav";
      if (type.includes("m4a")) return "m4a";
      return "webm";
    };

    const setRecordingUI = (active) => {
      voiceBtn.classList.toggle("recording", Boolean(active));
      voiceBtn.innerHTML = active ? "⏺️" : defaultLabel;
      voiceBtn.setAttribute("aria-pressed", active ? "true" : "false");
      voiceBtn.setAttribute(
        "title",
        active
          ? "Recording voice message… use Finish or Cancel in the recorder"
          : defaultTitle
      );
    };

    const chatContent = document.getElementById("chat-content");
    const voiceRecordingUI = (() => {
      const container = document.createElement("div");
      container.className = "voice-recording-modal";
      container.hidden = true;

      const status = document.createElement("div");
      status.className = "voice-recording-status";
      status.textContent = "Recording voice message…";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      const defaultStatusText = status.textContent;

      const meterWrapper = document.createElement("div");
      meterWrapper.className = "voice-meter";
      meterWrapper.setAttribute("aria-hidden", "true");
      const meterFill = document.createElement("div");
      meterFill.className = "voice-meter-fill";
      meterWrapper.appendChild(meterFill);

      const timer = document.createElement("div");
      timer.className = "voice-recording-timer";
      timer.textContent = "00:00";

      const controls = document.createElement("div");
      controls.className = "voice-recording-controls";
      const finishBtn = document.createElement("button");
      finishBtn.type = "button";
      finishBtn.className = "voice-recording-finish";
      finishBtn.textContent = "Finish";
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "voice-recording-cancel";
      cancelBtn.textContent = "Cancel";
      controls.appendChild(finishBtn);
      controls.appendChild(cancelBtn);

      container.appendChild(status);
      container.appendChild(meterWrapper);
      container.appendChild(timer);
      container.appendChild(controls);

      if (chatContent?.appendChild) {
        chatContent.appendChild(container);
      }

      const formatTimer = (ms) => {
        if (!Number.isFinite(ms) || ms < 0) return "00:00";
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
      };

      return {
        container,
        finishBtn,
        cancelBtn,
        show() {
          finishBtn.disabled = false;
          cancelBtn.disabled = false;
          container.classList.remove("finishing");
          status.textContent = defaultStatusText;
          container.hidden = false;
          container.classList.add("visible");
        },
        hide() {
          container.hidden = true;
          container.classList.remove("visible");
        },
        setLevel(level) {
          const clamped = Math.max(0, Math.min(1, level));
          meterFill.style.setProperty("--level", clamped.toFixed(3));
        },
        setTime(ms) {
          timer.textContent = formatTimer(ms);
        },
        setDisabled(disabled) {
          finishBtn.disabled = Boolean(disabled);
          cancelBtn.disabled = Boolean(disabled);
          container.classList.toggle("finishing", Boolean(disabled));
        },
        setStatus(text) {
          if (typeof text === "string" && text.trim()) {
            status.textContent = text;
          } else {
            status.textContent = defaultStatusText;
          }
        },
        reset() {
          finishBtn.disabled = false;
          cancelBtn.disabled = false;
          container.classList.remove("finishing");
          status.textContent = defaultStatusText;
          this.setLevel(0);
          this.setTime(0);
          this.hide();
        },
      };
    })();

    let recorder = null;
    let startPromise = null;
    let pendingStop = null;
    let recordedChunks = [];
    let stopTimer = null;
    let stopping = false;
    let audioContext = null;
    let audioSource = null;
    let levelAnalyser = null;
    let levelData = null;
    let levelRAF = null;
    let recordingStartTime = null;
    let meterLevel = 0;

    const MAX_RECORDING_DURATION_MS = 60000;
    const recorderOptions = (() => {
      const type = pickMimeType();
      return type ? { mimeType: type } : undefined;
    })();

    const cleanupStream = (stream) => {
      if (!stream) return;
      stream.getTracks?.().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
    };

    const stopLevelMonitoring = () => {
      if (levelRAF) {
        cancelAnimationFrame(levelRAF);
        levelRAF = null;
      }
      levelAnalyser = null;
      levelData = null;
      if (audioSource) {
        try {
          audioSource.disconnect();
        } catch {}
        audioSource = null;
      }
      if (audioContext) {
        try {
          audioContext.close();
        } catch {}
        audioContext = null;
      }
      recordingStartTime = null;
      meterLevel = 0;
    };

    const beginLevelMonitoring = async (stream) => {
      const AudioContextCtor =
        window.AudioContext || window.webkitAudioContext || null;
      stopLevelMonitoring();
      recordingStartTime = Date.now();
      meterLevel = 0;
      voiceRecordingUI.setTime(0);
      voiceRecordingUI.setLevel(0);

      if (!AudioContextCtor || !stream) {
        if (levelRAF) {
          cancelAnimationFrame(levelRAF);
          levelRAF = null;
        }
        const updateTimer = () => {
          if (recordingStartTime == null) return;
          const elapsed = Date.now() - recordingStartTime;
          voiceRecordingUI.setTime(elapsed);
          const pulse = 0.2 + 0.1 * Math.sin(elapsed / 200);
          meterLevel = Math.max(0.05, Math.min(1, pulse));
          voiceRecordingUI.setLevel(meterLevel);
          levelRAF = requestAnimationFrame(updateTimer);
        };
        updateTimer();
        return;
      }

      try {
        audioContext = new AudioContextCtor();
        if (typeof audioContext.resume === "function") {
          await audioContext.resume();
        }
        audioSource = audioContext.createMediaStreamSource(stream);
        levelAnalyser = audioContext.createAnalyser();
        levelAnalyser.fftSize = 512;
        levelData = new Uint8Array(levelAnalyser.fftSize);
        audioSource.connect(levelAnalyser);
      } catch (err) {
        console.error("[Voice] Failed to initialise level meter", err);
        stopLevelMonitoring();
        recordingStartTime = Date.now();
        meterLevel = 0;
        const fallbackUpdate = () => {
          if (recordingStartTime == null) return;
          const elapsed = Date.now() - recordingStartTime;
          voiceRecordingUI.setTime(elapsed);
          const pulse = 0.2 + 0.1 * Math.sin(elapsed / 200);
          meterLevel = Math.max(0.05, Math.min(1, pulse));
          voiceRecordingUI.setLevel(meterLevel);
          levelRAF = requestAnimationFrame(fallbackUpdate);
        };
        fallbackUpdate();
        return;
      }

      const update = () => {
        if (!levelAnalyser || !levelData) return;
        try {
          levelAnalyser.getByteTimeDomainData(levelData);
          let sumSquares = 0;
          for (let i = 0; i < levelData.length; i += 1) {
            const value = (levelData[i] - 128) / 128;
            sumSquares += value * value;
          }
          const rms = Math.sqrt(sumSquares / levelData.length);
          const targetLevel = Math.min(1, rms * 1.8);
          meterLevel = meterLevel * 0.6 + targetLevel * 0.4;
          voiceRecordingUI.setLevel(meterLevel);
        } catch (err) {
          console.error("[Voice] Level meter update failed", err);
          const originalStart = recordingStartTime;
          stopLevelMonitoring();
          recordingStartTime = originalStart ?? Date.now();
          meterLevel = 0;
          const fallbackUpdate = () => {
            if (recordingStartTime == null) return;
            const elapsed = Date.now() - recordingStartTime;
            voiceRecordingUI.setTime(elapsed);
            const pulse = 0.2 + 0.1 * Math.sin(elapsed / 200);
            meterLevel = Math.max(0.05, Math.min(1, pulse));
            voiceRecordingUI.setLevel(meterLevel);
            levelRAF = requestAnimationFrame(fallbackUpdate);
          };
          fallbackUpdate();
          return;
        }

        if (recordingStartTime != null) {
          voiceRecordingUI.setTime(Date.now() - recordingStartTime);
        }

        levelRAF = requestAnimationFrame(update);
      };

      update();
    };

    const updateRecorderStatus = (shouldSend, reason) => {
      if (!shouldSend) {
        if (reason === "cancel") {
          voiceRecordingUI.setStatus("Canceling recording…");
        } else {
          voiceRecordingUI.setStatus("Stopping recording…");
        }
        return;
      }

      if (reason === "timeout") {
        voiceRecordingUI.setStatus("Time limit reached—sending…");
      } else if (reason === "complete") {
        voiceRecordingUI.setStatus("Finishing recording…");
      } else {
        voiceRecordingUI.setStatus("Sending voice message…");
      }
    };

    const resetRecordingState = () => {
      if (stopTimer) {
        clearTimeout(stopTimer);
        stopTimer = null;
      }
      stopping = false;
      recordedChunks = [];
      recorder = null;
      startPromise = null;
      pendingStop = null;
      stopLevelMonitoring();
      voiceRecordingUI.reset();
      setRecordingUI(false);
    };

    const finalizeRecording = async (shouldSend, reason = "complete") => {
      if ((!recorder && !startPromise) || stopping) {
        if (!recorder && startPromise) {
          pendingStop = { shouldSend, reason };
        }
        return;
      }

      stopping = true;
      if (stopTimer) {
        clearTimeout(stopTimer);
        stopTimer = null;
      }

      voiceRecordingUI.setDisabled(true);
      updateRecorderStatus(shouldSend, reason);

      const currentRecorder = recorder;
      const stopPromise = new Promise((resolve) => {
        if (!currentRecorder) {
          resolve();
          return;
        }
        currentRecorder.addEventListener("stop", resolve, { once: true });
      });

      try {
        if (currentRecorder && currentRecorder.state !== "inactive") {
          currentRecorder.stop();
        }
      } catch (err) {
        console.error("[Voice] Failed to stop recorder", err);
      }

      await stopPromise;

      const mimeType =
        recordedChunks?.[0]?.type || currentRecorder?.mimeType || "audio/webm";
      const blob =
        recordedChunks && recordedChunks.length
          ? new Blob(recordedChunks, { type: mimeType })
          : null;

      cleanupStream(currentRecorder?.stream);
      resetRecordingState();

      if (!shouldSend) {
        if (reason === "cancel") {
          showToast("Recording canceled", "info");
        }
        return;
      }

      if (!blob || !blob.size) {
        showToast("Recording was empty", "warn");
        return;
      }

      const extension = guessExtension(mimeType);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `voice-${timestamp}.${extension}`;

      try {
        await uploadFileAndSend(blob, {
          fileName: filename,
          displayName: filename,
          mimeType,
        });
      } catch {
        /* errors handled in uploadFileAndSend */
      }
    };

    const startRecording = async () => {
      if (recorder || startPromise) return startPromise;

      if (!window.currentRoom || !window.currentUser) {
        showToast("Join the chat to send voice messages.", "warn");
        return null;
      }

      startPromise = (async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });

          recordedChunks = [];
          recorder = new MediaRecorder(stream, recorderOptions);

          recorder.addEventListener("dataavailable", (event) => {
            if (event?.data && event.data.size) {
              recordedChunks.push(event.data);
            }
          });

          recorder.addEventListener("error", (event) => {
            console.error("[Voice] Recorder error", event?.error || event);
            showToast("Recording failed. Please try again.", "error");
            finalizeRecording(false, "cancel");
          });

          voiceRecordingUI.show();
          beginLevelMonitoring(stream);
          recorder.start();
          setRecordingUI(true);

          stopTimer = setTimeout(() => {
            finalizeRecording(true, "timeout");
          }, MAX_RECORDING_DURATION_MS);
        } catch (err) {
          console.error("[Voice] Microphone error", err);
          if (err?.name === "NotAllowedError" || err?.name === "SecurityError") {
            showToast("Microphone access was blocked.", "error");
          } else if (err?.name === "NotFoundError") {
            showToast("No microphone detected.", "error");
          } else {
            showToast("Could not access the microphone.", "error");
          }
          setRecordingUI(false);
          stopLevelMonitoring();
          voiceRecordingUI.reset();
          recorder = null;
        } finally {
          const queued = pendingStop;
          startPromise = null;
          if (queued) {
            pendingStop = null;
            finalizeRecording(queued.shouldSend, queued.reason);
          }
        }
      })();

      return startPromise;
    };

    const queueStop = (shouldSend, reason) => {
      if (!recorder && !startPromise) {
        return;
      }

      voiceRecordingUI.setDisabled(true);
      updateRecorderStatus(shouldSend, reason);

      if (recorder) {
        finalizeRecording(shouldSend, reason);
      } else if (startPromise) {
        pendingStop = { shouldSend, reason };
      }
    };

    voiceBtn.addEventListener("click", (event) => {
      event.preventDefault();
      if (recorder || startPromise) {
        queueStop(true, "complete");
      } else {
        startRecording();
      }
    });

    voiceRecordingUI.finishBtn.addEventListener("click", (event) => {
      event.preventDefault();
      queueStop(true, "complete");
    });

    voiceRecordingUI.cancelBtn.addEventListener("click", (event) => {
      event.preventDefault();
      queueStop(false, "cancel");
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && (recorder || startPromise)) {
        event.preventDefault();
        queueStop(false, "cancel");
      }
    });
  }
}

// ------------------- Live Voice Calls (Sprint B) -------------------
(() => {
  if (!voiceCallBtn) return;

  const clampVolume = (value) => {
    const numeric = Number.parseFloat(value);
    if (!Number.isFinite(numeric)) return 1;
    return Math.min(1, Math.max(0, numeric));
  };

  const callState = {
    sdkLoaded: false,
    room: null,
    localTrack: null,
    localLevel: 0,
    localMeter: null,
    muted: false,
    masterVolume: 1,
    participants: new Map(),
    remoteAudioElements: new Map(),
  };

  const panel = document.createElement("div");
  panel.className = "voice-call-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="voice-call-header" data-role="drag-handle">
      <div>
        <div class="voice-call-title">Voice Call</div>
        <div class="voice-call-status" data-role="status">Not connected.</div>
      </div>
      <span class="voice-call-drag-hint" aria-hidden="true">↕</span>
    </div>
    <div class="voice-call-controls">
      <button type="button" data-role="join">Join</button>
      <button type="button" data-role="mute">Mute</button>
      <button type="button" data-role="leave">Leave</button>
    </div>
    <label class="voice-call-master-volume">
      <span>Call volume</span>
      <input type="range" min="0" max="100" value="100" data-role="master-volume" aria-label="Call output volume">
    </label>
    <div class="voice-call-peers" data-role="peers" aria-live="polite"></div>
  `;
  document.body.appendChild(panel);

  const remoteAudioContainer = document.createElement("div");
  remoteAudioContainer.className = "voice-call-remote-audio";
  remoteAudioContainer.setAttribute("aria-hidden", "true");
  document.body.appendChild(remoteAudioContainer);

  const statusEl = panel.querySelector('[data-role="status"]');
  const dragHandle = panel.querySelector('[data-role="drag-handle"]');
  const joinControl = panel.querySelector('[data-role="join"]');
  const muteControl = panel.querySelector('[data-role="mute"]');
  const leaveControl = panel.querySelector('[data-role="leave"]');
  const masterVolumeControl = panel.querySelector('[data-role="master-volume"]');
  const peersEl = panel.querySelector('[data-role="peers"]');

  const participantKey = (participant) => participant?.sid || participant?.identity || "";
  const getDisplayName = (participant) => participant?.identity || "Participant";

  const setStatus = (text) => { if (statusEl) statusEl.textContent = text; };

  const getLocalEntry = () => ({
    sid: "local",
    name: window.currentUser ? `${window.currentUser} (you)` : "You",
    level: callState.localLevel,
    muted: callState.muted,
    volume: 1,
    local: true,
  });

  const syncRemoteAudioVolume = (sid) => {
    const entry = callState.remoteAudioElements.get(sid);
    if (!entry?.element) return;
    const participant = callState.participants.get(sid);
    const participantVolume = clampVolume(participant?.volume ?? entry.volume ?? 1);
    const participantMuted = Boolean(participant?.muted ?? entry.muted);
    entry.volume = participantVolume;
    entry.muted = participantMuted;
    entry.element.volume = participantMuted ? 0 : clampVolume(participantVolume * callState.masterVolume);
    entry.element.muted = participantMuted || callState.masterVolume <= 0;
  };

  const syncAllRemoteAudioVolumes = () => {
    Array.from(callState.remoteAudioElements.keys()).forEach(syncRemoteAudioVolume);
  };

  const updatePeerMeters = () => {
    if (!peersEl) return;
    const localMeter = peersEl.querySelector('[data-meter="local"]');
    const localValue = peersEl.querySelector('[data-meter-value="local"]');
    if (localMeter) localMeter.style.width = `${Math.round(callState.localLevel * 100)}%`;
    if (localValue) localValue.textContent = callState.muted ? "muted" : `${Math.round(callState.localLevel * 100)}%`;
    const meters = Array.from(peersEl.querySelectorAll("[data-meter]"));
    const values = Array.from(peersEl.querySelectorAll("[data-meter-value]"));
    callState.participants.forEach((entry, sid) => {
      const meter = meters.find((el) => el.dataset.meter === String(sid));
      const value = values.find((el) => el.dataset.meterValue === String(sid));
      if (meter) meter.style.width = `${Math.round((entry.level || 0) * 100)}%`;
      if (value) value.textContent = entry.muted ? "muted" : `${Math.round((entry.level || 0) * 100)}%`;
    });
  };

  const createPeerRow = (entry) => {
    const row = document.createElement("div");
    row.className = `voice-peer-row${entry.local ? " voice-peer-row-local" : ""}`;
    row.dataset.sid = entry.sid;

    const header = document.createElement("div");
    header.className = "voice-peer-header";

    const name = document.createElement("span");
    name.className = "voice-peer-name";
    name.textContent = entry.name;

    const level = document.createElement("span");
    level.className = "voice-peer-level";
    level.dataset.meterValue = entry.sid;
    level.textContent = entry.muted ? "muted" : `${Math.round((entry.level || 0) * 100)}%`;

    header.append(name, level);

    const meter = document.createElement("div");
    meter.className = "voice-peer-meter";
    meter.setAttribute("aria-hidden", "true");
    const meterFill = document.createElement("div");
    meterFill.className = "voice-peer-meter-fill";
    meterFill.dataset.meter = entry.sid;
    meterFill.style.width = `${Math.round((entry.level || 0) * 100)}%`;
    meter.appendChild(meterFill);

    const controls = document.createElement("div");
    controls.className = "voice-peer-controls";

    const muteButton = document.createElement("button");
    muteButton.type = "button";
    muteButton.className = "voice-peer-mute";
    muteButton.dataset.action = entry.local ? "toggle-local-mute" : "toggle-peer-mute";
    muteButton.dataset.sid = entry.sid;
    muteButton.textContent = entry.muted ? "Unmute" : "Mute";
    muteButton.setAttribute("aria-label", `${entry.muted ? "Unmute" : "Mute"} ${entry.name}`);

    controls.appendChild(muteButton);

    if (!entry.local) {
      const volumeLabel = document.createElement("label");
      volumeLabel.className = "voice-peer-volume";
      volumeLabel.textContent = "Vol";
      const volumeInput = document.createElement("input");
      volumeInput.type = "range";
      volumeInput.min = "0";
      volumeInput.max = "100";
      volumeInput.value = String(Math.round(clampVolume(entry.volume ?? 1) * 100));
      volumeInput.dataset.action = "peer-volume";
      volumeInput.dataset.sid = entry.sid;
      volumeInput.setAttribute("aria-label", `Volume for ${entry.name}`);
      volumeLabel.appendChild(volumeInput);
      controls.appendChild(volumeLabel);
    }

    row.append(header, meter, controls);
    return row;
  };

  const renderPeers = () => {
    if (!peersEl) return;
    const entries = [];
    if (callState.room || callState.localTrack) entries.push(getLocalEntry());
    entries.push(...Array.from(callState.participants.values()).sort((a, b) => a.name.localeCompare(b.name)));
    peersEl.innerHTML = "";
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "voice-peer-empty";
      empty.textContent = "Join the call to see participants, volume controls, and meters.";
      peersEl.appendChild(empty);
      return;
    }
    entries.forEach((entry) => peersEl.appendChild(createPeerRow(entry)));
  };

  const setCallUiState = ({ inCall = false, muted = false } = {}) => {
    voiceCallBtn.classList.toggle("call-active", inCall);
    voiceCallBtn.classList.toggle("call-muted", inCall && muted);
    voiceCallBtn.textContent = inCall ? (muted ? "🔇" : "📞") : "📞";
    muteControl.disabled = !inCall;
    leaveControl.disabled = !inCall;
    joinControl.disabled = inCall;
    muteControl.textContent = muted ? "Unmute" : "Mute";
  };

  const startPanelDrag = (event) => {
    if (!dragHandle || (event.button !== undefined && event.button !== 0)) return;
    const interactive = event.target.closest("button, input, label, a, select, textarea");
    if (interactive) return;
    event.preventDefault();
    const rect = panel.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    panel.classList.add("dragging");
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";

    if (event.pointerId !== undefined) {
      dragHandle.setPointerCapture?.(event.pointerId);
    }

    const onMove = (moveEvent) => {
      const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
      const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
      const nextLeft = Math.min(Math.max(8, moveEvent.clientX - offsetX), maxLeft);
      const nextTop = Math.min(Math.max(8, moveEvent.clientY - offsetY), maxTop);
      panel.style.left = `${nextLeft}px`;
      panel.style.top = `${nextTop}px`;
    };
    const onUp = () => {
      panel.classList.remove("dragging");
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  };

  const getLiveKitClient = () => window.LivekitClient || window.LiveKitClient || null;

  const normalizeCallError = (error, fallback = "Unable to join voice call.") => {
    const message = error?.message || String(error || "");
    if (!message) return fallback;
    if (/permission|notallowed|denied/i.test(message)) {
      return "Microphone permission was denied. Allow microphone access in your browser, then try joining again.";
    }
    if (/device|notfound|notreadable/i.test(message)) {
      return "No usable microphone was found. Check your microphone device and browser permissions.";
    }
    if (/websocket|signal|connect|timeout|network|region/i.test(message)) {
      return `${message} Check that LIVEKIT_URL is the WebSocket URL from the same LiveKit Cloud project as the API key/secret.`;
    }
    return message || fallback;
  };

  const explainCallSetupError = (payload, fallback = "Voice call setup is incomplete.") => {
    const status = payload?.status || payload;
    if (status?.livekitUrlPresent && status?.livekitUrlValid === false) {
      return "LIVEKIT_URL is not a valid LiveKit WebSocket URL. Use the LiveKit Cloud URL for the same project as your API key/secret.";
    }
    if (Array.isArray(status?.missingRequiredEnv) && status.missingRequiredEnv.length) {
      return `Voice provider is not configured. Missing server environment variables: ${status.missingRequiredEnv.join(", ")}.`;
    }
    if (status?.configured === false) {
      return status?.reason || "Voice provider is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET on the server.";
    }
    return payload?.error || status?.reason || fallback;
  };

  const ensureCallServiceReady = async () => {
    let res;
    try {
      res = await fetch("/api/calls/status", { cache: "no-store" });
    } catch (error) {
      throw new Error(`Voice call status check failed: ${error?.message || error}`);
    }
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(explainCallSetupError(payload, `Voice call status check failed (${res.status}).`));
    }
    if (!payload || typeof payload !== "object" || !("enabled" in payload) || !("configured" in payload)) {
      throw new Error("Voice call status endpoint returned an unexpected response. Redeploy the latest server build.");
    }
    if (!payload.enabled || !payload.configured) {
      throw new Error(explainCallSetupError(payload));
    }
    return payload;
  };

  const ensureSdk = async () => {
    if (getLiveKitClient()) {
      callState.sdkLoaded = true;
      return true;
    }

    const sdkSources = [
      "https://cdn.jsdelivr.net/npm/livekit-client/dist/livekit-client.umd.min.js",
      "https://unpkg.com/livekit-client/dist/livekit-client.umd.min.js",
    ];

    for (const src of sdkSources) {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      document.head.appendChild(script);
      const loaded = await new Promise((resolve) => {
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
      });
      if (loaded && getLiveKitClient()) {
        callState.sdkLoaded = true;
        return true;
      }
      script.remove();
    }

    throw new Error("LiveKit browser SDK could not be loaded from the configured CDNs.");
  };

  const updateParticipant = (participant, values = {}) => {
    const sid = participantKey(participant) || values.sid;
    if (!sid || participant?.isLocal) return null;
    const existing = callState.participants.get(sid) || {};
    const next = {
      sid,
      name: values.name || existing.name || getDisplayName(participant),
      level: values.level ?? existing.level ?? Number(participant?.audioLevel || 0),
      muted: values.muted ?? existing.muted ?? false,
      volume: clampVolume(values.volume ?? existing.volume ?? 1),
      local: false,
    };
    callState.participants.set(sid, next);
    return next;
  };

  const attachRemoteAudioTrack = (track, participant) => {
    if (!track?.attach || !remoteAudioContainer) return;
    const key = participantKey(participant) || track.sid || String(Date.now());
    detachRemoteAudioTrack(track, participant);
    const participantEntry = updateParticipant(participant, { sid: key });
    const element = track.attach();
    element.autoplay = true;
    element.playsInline = true;
    element.dataset.participant = participant?.identity || key;
    callState.remoteAudioElements.set(key, {
      track,
      element,
      muted: Boolean(participantEntry?.muted),
      volume: clampVolume(participantEntry?.volume ?? 1),
    });
    remoteAudioContainer.appendChild(element);
    syncRemoteAudioVolume(key);
    renderPeers();
  };

  const detachRemoteAudioTrack = (track, participant) => {
    const key = participantKey(participant) || track?.sid;
    const entries = key
      ? [[key, callState.remoteAudioElements.get(key)]].filter(([, entry]) => entry)
      : Array.from(callState.remoteAudioElements.entries()).filter(([, entry]) => !track || entry.track === track);
    entries.forEach(([entryKey, entry]) => {
      if (entry?.track?.detach) {
        entry.track.detach(entry.element);
      }
      entry?.element?.remove();
      callState.remoteAudioElements.delete(entryKey);
    });
  };

  const clearRemoteAudioTracks = () => {
    Array.from(callState.remoteAudioElements.entries()).forEach(([key, entry]) => {
      if (entry?.track?.detach) {
        entry.track.detach(entry.element);
      }
      entry?.element?.remove();
      callState.remoteAudioElements.delete(key);
    });
  };

  const stopLocalMeter = () => {
    const meter = callState.localMeter;
    if (!meter) return;
    if (meter.frame) cancelAnimationFrame(meter.frame);
    try { meter.source?.disconnect(); } catch (_err) {}
    try { meter.analyser?.disconnect(); } catch (_err) {}
    if (meter.context?.state !== "closed") {
      meter.context?.close().catch(() => {});
    }
    callState.localMeter = null;
    callState.localLevel = 0;
  };

  const startLocalMeter = (track) => {
    stopLocalMeter();
    const mediaTrack = track?.mediaStreamTrack;
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!mediaTrack || !AudioContextCtor) return;
    try {
      const context = new AudioContextCtor();
      context.resume?.().catch(() => {});
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      const source = context.createMediaStreamSource(new MediaStream([mediaTrack]));
      source.connect(analyser);
      const samples = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        samples.forEach((sample) => {
          const centered = (sample - 128) / 128;
          sum += centered * centered;
        });
        const rms = Math.sqrt(sum / samples.length);
        callState.localLevel = callState.muted ? 0 : Math.min(1, rms * 5);
        updatePeerMeters();
        callState.localMeter.frame = requestAnimationFrame(tick);
      };
      callState.localMeter = { context, analyser, source, frame: requestAnimationFrame(tick) };
    } catch (error) {
      console.warn("[VoiceCall] local meter unavailable", error);
    }
  };

  const fetchToken = async () => {
    const res = await fetch("/api/calls/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: window.currentRoom, username: window.currentUser }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(explainCallSetupError(data, `Token request failed (${res.status})`));
    return data;
  };

  const toggleLocalMute = async () => {
    if (!callState.localTrack) return;
    callState.muted = !callState.muted;
    if (callState.muted) {
      await callState.localTrack.mute();
      callState.localLevel = 0;
    } else {
      await callState.localTrack.unmute();
    }
    setCallUiState({ inCall: true, muted: callState.muted });
    renderPeers();
    updatePeerMeters();
  };

  const leaveCall = async (silent = false) => {
    try {
      stopLocalMeter();
      if (callState.localTrack) callState.localTrack.stop();
      if (callState.room) await callState.room.disconnect();
      callState.localTrack = null;
      callState.room = null;
      callState.muted = false;
      callState.participants.clear();
      callState.localLevel = 0;
      clearRemoteAudioTracks();
      renderPeers();
      setCallUiState({ inCall: false, muted: false });
      setStatus("Not connected.");
      if (!silent) socket.emit("call:leave", { room: window.currentRoom });
    } catch (error) {
      console.error("[VoiceCall] leave error", error);
    }
  };

  const joinCall = async () => {
    if (!window.currentRoom || !window.currentUser) {
      showToast("Join a chat room first.", "warn");
      return;
    }
    setStatus("Checking voice provider…");
    await ensureCallServiceReady();
    setStatus("Loading voice engine…");
    await ensureSdk();
    setStatus("Requesting call token…");
    const tokenPayload = await fetchToken();
    if (!tokenPayload?.token || !tokenPayload?.url) throw new Error("Missing LiveKit token or URL from server.");
    const LK = getLiveKitClient();
    const room = new LK.Room({ adaptiveStream: true, dynacast: true });
    callState.room = room;
    room.on(LK.RoomEvent.Disconnected, () => {
      leaveCall(true);
    });
    room.on(LK.RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      if (track?.kind === LK.Track?.Kind?.Audio) {
        attachRemoteAudioTrack(track, participant);
      }
    });
    room.on(LK.RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
      if (track?.kind === LK.Track?.Kind?.Audio) {
        detachRemoteAudioTrack(track, participant);
      }
    });
    room.on(LK.RoomEvent.ParticipantConnected, (participant) => {
      updateParticipant(participant);
      renderPeers();
    });
    room.on(LK.RoomEvent.ParticipantDisconnected, (participant) => {
      detachRemoteAudioTrack(null, participant);
      const sid = participantKey(participant);
      if (sid) {
        callState.participants.delete(sid);
        renderPeers();
      }
    });
    setStatus("Connecting to LiveKit…");
    await room.connect(tokenPayload.url, tokenPayload.token, { autoSubscribe: true });
    room.remoteParticipants?.forEach((participant) => updateParticipant(participant));
    renderPeers();
    if (typeof room.startAudio === "function") {
      await room.startAudio().catch((error) => {
        console.warn("[VoiceCall] remote audio start warning", error);
      });
    }
    setStatus("Requesting microphone…");
    const track = await LK.createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
    setStatus("Publishing microphone…");
    await room.localParticipant.publishTrack(track, {
      source: LK.Track?.Source?.Microphone,
    });
    callState.localTrack = track;
    callState.muted = false;
    startLocalMeter(track);
    setCallUiState({ inCall: true, muted: false });
    renderPeers();
    setStatus(`Connected to ${window.currentRoom}`);
    socket.emit("call:join", { room: window.currentRoom });
    room.on(LK.RoomEvent.ActiveSpeakersChanged, (speakers = []) => {
      const seen = new Set();
      speakers.forEach((participant) => {
        const level = Number(participant?.audioLevel || 0);
        if (participant?.isLocal) {
          callState.localLevel = callState.muted ? 0 : level;
          return;
        }
        const sid = participantKey(participant);
        if (!sid) return;
        seen.add(sid);
        updateParticipant(participant, { level });
      });
      Array.from(callState.participants.keys()).forEach((sid) => {
        if (!seen.has(sid)) {
          const existing = callState.participants.get(sid);
          if (existing) existing.level = 0;
        }
      });
      updatePeerMeters();
    });
  };

  voiceCallBtn.hidden = false;
  voiceCallBtn.removeAttribute("aria-hidden");
  setCallUiState({ inCall: false, muted: false });
  renderPeers();

  dragHandle?.addEventListener("pointerdown", startPanelDrag);
  window.addEventListener("resize", () => {
    const rect = panel.getBoundingClientRect();
    if (rect.right > window.innerWidth || rect.bottom > window.innerHeight) {
      panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8))}px`;
      panel.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - rect.height - 8))}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    }
  });

  voiceCallBtn.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
  });
  joinControl.addEventListener("click", async () => {
    try {
      await joinCall();
      showToast("Voice call connected", "success");
    } catch (error) {
      console.error("[VoiceCall] join failed", error);
      await leaveCall(true);
      const message = normalizeCallError(error);
      showToast(message, "error");
      setStatus(message);
      setCallUiState({ inCall: false, muted: false });
    }
  });
  muteControl.addEventListener("click", toggleLocalMute);
  leaveControl.addEventListener("click", async () => {
    await leaveCall();
    showToast("Left voice call", "info");
  });
  masterVolumeControl?.addEventListener("input", () => {
    callState.masterVolume = clampVolume(Number(masterVolumeControl.value) / 100);
    syncAllRemoteAudioVolumes();
  });
  peersEl?.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const { action, sid } = button.dataset;
    if (action === "toggle-local-mute") {
      await toggleLocalMute();
      return;
    }
    if (action === "toggle-peer-mute" && sid) {
      const entry = callState.participants.get(sid);
      if (!entry) return;
      entry.muted = !entry.muted;
      syncRemoteAudioVolume(sid);
      renderPeers();
    }
  });
  peersEl?.addEventListener("input", (event) => {
    const input = event.target.closest('input[data-action="peer-volume"]');
    if (!input) return;
    const { sid } = input.dataset;
    const entry = callState.participants.get(sid);
    if (!entry) return;
    entry.volume = clampVolume(Number(input.value) / 100);
    syncRemoteAudioVolume(sid);
  });

  socket.on("call:user-muted", ({ room, target } = {}) => {
    if (!room || room !== window.currentRoom) return;
    if (!target || target !== window.currentUser) return;
    if (callState.localTrack) {
      callState.muted = true;
      callState.localLevel = 0;
      callState.localTrack.mute().catch(() => {});
      setCallUiState({ inCall: true, muted: true });
      renderPeers();
      showToast("You were muted by an admin.", "warn");
    }
  });

  socket.on("call:user-kicked", ({ room, target } = {}) => {
    if (!room || room !== window.currentRoom) return;
    if (!target || target !== window.currentUser) return;
    leaveCall(true).finally(() => {
      showToast("You were removed from the voice call.", "warn");
      setStatus("Removed by admin.");
    });
  });

  const autoLeaveIfActive = () => {
    if (!callState.room) return;
    leaveCall(true).catch(() => {});
  };
  if (leaveBtn) {
    leaveBtn.addEventListener("click", autoLeaveIfActive);
  }
  if (joinBtn) {
    joinBtn.addEventListener("click", () => {
      const nextRoom = roomInput?.value.trim();
      if (nextRoom && nextRoom !== window.currentRoom) {
        autoLeaveIfActive();
      }
    });
  }
  window.addEventListener("beforeunload", autoLeaveIfActive);
})();

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
      created.style.marginLeft = "5px";
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
    const soundboardPanel = document.getElementById("soundboard-picker");
    if (soundboardPanel) {
      soundboardPanel.style.display = "none";
    }
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

// ------------------- Local Soundboard Picker -------------------
(() => {
  if (!form) return;

  const existing = document.getElementById("soundboard-btn");
  const soundboardBtn = existing || document.createElement("button");
  if (!existing) {
    soundboardBtn.id = "soundboard-btn";
    soundboardBtn.type = "button";
    soundboardBtn.title = "Soundboard audio clips";
    soundboardBtn.setAttribute("aria-label", "Soundboard audio clips");
    soundboardBtn.innerHTML =
      '<span class="soundboard-icon" aria-hidden="true">🔊</span>';

    const gifBtn = document.getElementById("gif-btn");
    if (gifBtn?.insertAdjacentElement) {
      gifBtn.insertAdjacentElement("afterend", soundboardBtn);
    } else if (emojiBtn?.insertAdjacentElement) {
      emojiBtn.insertAdjacentElement("afterend", soundboardBtn);
    } else if (attachBtn?.insertAdjacentElement) {
      attachBtn.insertAdjacentElement("afterend", soundboardBtn);
    } else {
      form.appendChild(soundboardBtn);
    }
  }

  if (!soundboardBtn) return;

  const panel = document.createElement("div");
  panel.id = "soundboard-picker";
  panel.innerHTML = `
    <div class="soundboard-search">
      <input id="soundboard-search-input" type="search" placeholder="Search audio clips…" autocomplete="off" />
    </div>
    <div id="soundboard-results" class="soundboard-results"></div>
  `;
  document.body.appendChild(panel);

  const resultsEl = panel.querySelector("#soundboard-results");
  const searchInput = panel.querySelector("#soundboard-search-input");

  const closePanel = () => {
    panel.style.display = "none";
  };

  const positionPanel = () => {
    const rect = form.getBoundingClientRect();
    panel.style.position = "fixed";
    panel.style.left = rect.left + 8 + "px";
    panel.style.bottom = window.innerHeight - rect.top + 10 + "px";
    panel.style.display = "block";
  };

  const guessExtension = (url) => {
    if (typeof url !== "string" || !url) return "mp3";
    const clean = url.split("?")[0] || "";
    const match = clean.match(/\.([a-z0-9]+)$/i);
    const ext = match ? match[1].toLowerCase() : "";
    if (["mp3", "wav", "ogg", "oga", "m4a", "aac"].includes(ext)) {
      return ext;
    }
    return "mp3";
  };

  const guessMime = (ext) => {
    switch (ext) {
      case "wav":
        return "audio/wav";
      case "ogg":
      case "oga":
        return "audio/ogg";
      case "m4a":
      case "aac":
        return "audio/mp4";
      default:
        return "audio/mpeg";
    }
  };

  const sanitiseFilename = (value, fallback = "soundboard-audio") => {
    if (typeof value !== "string") return `${fallback}`;
    const stripped = value.replace(/[\\/:*?"<>|]/g, "").trim();
    return stripped || `${fallback}`;
  };

  const formatDuration = (seconds) => {
    const numeric = Number(seconds);
    if (!Number.isFinite(numeric) || numeric <= 0) return "";
    const totalSeconds = Math.round(numeric);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
  };

  const renderStatus = (message, tone = "info") => {
    if (!resultsEl) return;
    resultsEl.innerHTML = "";
    const status = document.createElement("div");
    status.className = `soundboard-status soundboard-status--${tone}`;
    status.textContent = message;
    resultsEl.appendChild(status);
  };

  let lastQuery = "";
  let isLoading = false;

  const loadClips = async (query = "") => {
    if (!resultsEl || isLoading) return;
    isLoading = true;
    renderStatus("Loading audio clips…", "loading");

    const endpoint = query
      ? `/soundboard-clips?q=${encodeURIComponent(query)}`
      : "/soundboard-clips";

    try {
      const response = await fetch(endpoint);
      if (!response.ok) {
        throw new Error(`Soundboard request failed: ${response.status}`);
      }

      const data = await response.json();
      const hits = Array.isArray(data?.hits) ? data.hits : [];
      lastQuery = query;

      if (!hits.length) {
        renderStatus(
          query ? "No clips matched your search." : "No soundboard clips available yet.",
          "info",
        );
        isLoading = false;
        return;
      }

      resultsEl.innerHTML = "";

      hits.forEach((hit) => {
        if (!hit || typeof hit !== "object") return;
        const audioUrl = typeof hit.audioUrl === "string" ? hit.audioUrl : "";
        if (!audioUrl) return;
        const clipTitle = (hit.title || hit.tags || "Audio Clip").trim();
        const duration = formatDuration(hit.duration);

        const button = document.createElement("button");
        button.type = "button";
        button.className = "soundboard-item";

        const icon = document.createElement("span");
        icon.className = "soundboard-item-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = "▶";

        const content = document.createElement("div");
        content.className = "soundboard-item-content";

        const titleEl = document.createElement("div");
        titleEl.className = "soundboard-item-title";
        titleEl.textContent = clipTitle || "Soundboard Clip";

        const metaEl = document.createElement("div");
        metaEl.className = "soundboard-item-meta";
        const tags = (hit.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean);
        const boardLabel = typeof hit.boardTitle === "string" && hit.boardTitle.trim()
          ? hit.boardTitle.trim()
          : "";
        const tagSnippetParts = [
          boardLabel,
          tags.length ? tags.slice(0, 2).join(" • ") : "",
        ].filter(Boolean);
        metaEl.textContent = [duration, ...tagSnippetParts].filter(Boolean).join(" • ");

        content.appendChild(titleEl);
        content.appendChild(metaEl);

        button.appendChild(icon);
        button.appendChild(content);

        button.addEventListener("click", () => {
          if (!window.currentRoom || !window.currentUser) {
            showToast("Join a room to share audio clips.", "warn");
            return;
          }

          const ext = guessExtension(audioUrl);
          const mime = guessMime(ext);
          const safeName = sanitiseFilename(clipTitle || "Soundboard Clip");
          const fileName = `${safeName}.${ext}`;

          socket.emit("chat message", {
            room: window.currentRoom,
            user: window.currentUser,
            text: clipTitle || "",
            timestamp: Date.now(),
            fileUrl: audioUrl,
            fileType: mime,
            fileName,
          });
          showToast("Audio clip added", "success");
          closePanel();
          input?.focus();
        });

        resultsEl.appendChild(button);
      });
    } catch (err) {
      console.error("[Soundboard] Clip load error:", err);
      renderStatus("Could not load audio clips.", "error");
    } finally {
      isLoading = false;
    }
  };

  soundboardBtn.addEventListener("click", () => {
    if (panel.style.display === "block") {
      closePanel();
      return;
    }
    const gifPanel = document.getElementById("gif-picker");
    if (gifPanel) {
      gifPanel.style.display = "none";
    }
    positionPanel();
    if (!panel.dataset.loaded) {
      loadClips();
      panel.dataset.loaded = "1";
    } else if (!lastQuery) {
      loadClips("");
    }
    searchInput?.focus();
  });

  searchInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const query = searchInput.value.trim();
      loadClips(query);
    } else if (event.key === "Escape") {
      closePanel();
      soundboardBtn.focus();
    }
  });

  searchInput?.addEventListener("search", () => {
    const query = searchInput.value.trim();
    if (!query && lastQuery) {
      loadClips("");
    }
  });

  window.addEventListener("resize", () => {
    if (panel.style.display === "block") positionPanel();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && panel.style.display === "block") {
      closePanel();
      soundboardBtn.focus();
    }
  });
})();

// ------------------- Embeds & Link Cards -------------------
function autoEmbed(node, providedLinks = null) {
  const textEl = node.querySelector(".text") || node;
  const txt = textEl ? textEl.textContent : "";

  const sourceLinks = Array.isArray(providedLinks) && providedLinks.length
    ? providedLinks
    : (txt.match(/https?:\/\/\S+/g) || []);
  const links = sourceLinks.slice(0, 3);
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
    if (!el && isLikelyVoiceWebmUrl(link)) {
      if (!hasInlinePreview(wrap, link)) {
        el = createInlinePreview(link, "audio");
      }
    }
    if (!el && /\.(mp4|webm|mov)(\?.*)?$/i.test(link)) {
      if (!hasInlinePreview(wrap, link)) {
        el = createInlinePreview(link, "video");
      }
    }
    if (!el && /\.(mp3|wav|ogg|opus)(\?.*)?$/i.test(link)) {
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
      const messageEl = node.classList?.contains?.("message")
        ? node
        : node.closest?.(".message") || node;
      const alreadyHasTenor = messageEl?.querySelector?.(
        ".inline-preview.tenor-inline"
      );
      if (!alreadyHasTenor) {
        fetchTenorPreview(link, wrap);
      }
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
      updateInlineMediaClasses(node);
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
    const tenorRegexGlobal = /https?:\/\/(?:media\.)?tenor\.com\/\S+/gi;

    const anchors = textEl.querySelectorAll("a");
    anchors.forEach((anchor) => {
      const href = anchor.getAttribute("href") || "";
      const anchorText = anchor.textContent || "";
      if (tenorRegex.test(href) || tenorRegex.test(anchorText.trim())) {
        anchor.remove();
      }
    });

    const childNodes = Array.from(textEl.childNodes);
    childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const original = node.textContent || "";
        const replaced = original.replace(tenorRegexGlobal, " ");
        if (replaced !== original) {
          const normalized = replaced.replace(/\s{2,}/g, " ").trim();
          if (normalized) {
            node.textContent = normalized;
          } else if (node.parentNode) {
            node.parentNode.removeChild(node);
          }
        }
      }
    });

    textEl.normalize();

    const hasTextContent = (textEl.textContent || "").trim().length > 0;
    const hasNonBrChild = Array.from(textEl.children).some((child) => child.tagName !== "BR");

    if (!hasTextContent && !hasNonBrChild) {
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
        !/(youtube|youtu\.be|open\.spotify|soundcloud|rumble\.com|tenor\.com|\.mp4|\.webm|\.mov|\.mp3|\.wav|\.ogg|\.opus|\.png|\.jpg|\.jpeg|\.gif|\.webp|\.pdf|\.zip|\.rar|\.7z|\.tar|\.gz)/i.test(
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
