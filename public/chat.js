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

// ------------------- DOM -------------------
const form = document.getElementById("form");
const input = document.getElementById("input");
const messages = document.getElementById("messages");
const fileInput = document.getElementById("file-input");
const attachBtn = document.getElementById("file-attach");
const emojiBtn = document.getElementById("emoji-btn");

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

// Autofocus username for smoother entry
usernameInput?.focus();

if (copyJoinLinkBtn) copyJoinLinkBtn.disabled = true;

if (publicRoomList && !publicRoomList.childElementCount) {
  const loadingItem = document.createElement("li");
  loadingItem.className = "empty";
  loadingItem.textContent = "Loading rooms…";
  publicRoomList.appendChild(loadingItem);
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
});
socket.on("room list", (rooms) => {
  renderPublicRooms(Array.isArray(rooms) ? rooms : []);
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
  if (copyJoinLinkBtn) copyJoinLinkBtn.disabled = true;
  if (chatContainer) chatContainer.style.display = "none";
  if (usernamePrompt) usernamePrompt.style.display = "flex";
  if (roomName) roomName.textContent = lastRoomName ? `#${lastRoomName}` : "";

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
    } catch (err) {
      console.error("[Emoji Picker] Failed to load", err);
      emojiCatalog.innerHTML = "<div class=\"emoji-empty\">Unable to load emoji.</div>";
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
    socket.emit("chat message", {
      room: window.currentRoom,
      user: window.currentUser,
      text,
      timestamp: Date.now(),
    });
    input.value = "";
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
  const wrap = document.createElement("div");
  // Use your existing bubble structure if present in CSS
  const isSelf = msg.user === window.currentUser;
  wrap.className = `message ${isSelf ? "self" : "other"}`;
  wrap.innerHTML = `
    <div class="meta">${msg.user || "Anon"} • ${new Date(msg.timestamp || Date.now()).toLocaleTimeString()}</div>
    <div class="text"></div>
  `;
  const textEl = wrap.querySelector(".text");
  if (textEl) {
    textEl.textContent = msg.text || "";
    const emojiInfo = replaceCustomEmojiLinks(textEl);
    if (emojiInfo?.hasGif) {
      wrap.classList.add("has-emoji-gif");
      if (emojiInfo.onlyEmoji) {
        wrap.classList.add("emoji-gif-only");
      }
    }
  }
  messages.appendChild(wrap);
  appendAttachmentFromMessage(wrap, msg);
  autoEmbed(wrap);
  observeMediaForScroll(wrap);
  if (!skipScroll) {
    scrollMessagesToBottom({ behavior: scrollBehavior, delay });
  }
}

socket.on("load messages", (arr) => {
  if (!isViewingChat || !messages) return;
  messages.innerHTML = "";
  (arr || []).forEach((entry) => renderMessage(entry, { skipScroll: true }));
  scrollMessagesToBottom({ behavior: "auto", delay: 120 });
  showToast(`✅ Joined room: ${window.currentRoom}`, "success");
});

socket.on("previous messages", (arr) => {
  if (!isViewingChat || !messages) return;
  // legacy event, render the same way but don't double-toast
  if (!messages.childElementCount) {
    (arr || []).forEach((entry) => renderMessage(entry, { skipScroll: true }));
    scrollMessagesToBottom({ behavior: "auto", delay: 80 });
  }
});

socket.on("chat message", (msg) => {
  if (!isViewingChat) return;
  renderMessage(msg, { scrollBehavior: "smooth" });
});

socket.on("edit message", ({ id, text }) => {
  // (Optional) If you render IDs, you can locate and update here.
  showToast("Message edited", "info");
});

socket.on("delete message", (id) => {
  // (Optional) If you render IDs, you can locate & remove here.
  showToast("Message deleted", "info");
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

      socket.emit("chat message", {
        room: window.currentRoom,
        user: window.currentUser,
        text: data.url,
        timestamp: Date.now(),
        fileUrl: data.url,
        fileType: data.type || file.type || "",
        fileName: data.name || file.name || "",
      });

      fileInput.value = "";
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

  let hasTenorLink = false;
  links.forEach((link) => {
    let el = null;

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
      let match = link.match(/https?:\/\/(?:www\.)?rumble\.com\/embed\/([a-z0-9]+)/i);
      if (match) {
        embedUrl = `https://rumble.com/embed/${match[1]}/?pub=4&autoplay=0`;
      } else {
        match = link.match(/https?:\/\/(?:www\.)?rumble\.com\/(v[\w]+)/i);
        if (match) embedUrl = `https://rumble.com/embed/${match[1]}/?pub=4&autoplay=0`;
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

    if (el) wrap.appendChild(el);
  });

  if (wrap.childNodes.length) {
    node.appendChild(wrap);
    node.classList.add("has-inline-preview");
    observeMediaForScroll(node);
    scrollMessagesToBottom();
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

      if (!wrap.isConnected) {
        node.appendChild(wrap);
      }

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
