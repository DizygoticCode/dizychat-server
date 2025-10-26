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
const usernameInput = document.getElementById("username");
const roomInput = document.getElementById("room");
const passwordInput = document.getElementById("room-password");

// Autofocus username for smoother entry
usernameInput?.focus();

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

// Hook some core socket events to toasts
socket.on("join error", (msg) => showToast(msg || "Join failed.", "error"));
socket.on("toast", (data) => showToast(data?.text || "", data?.type || "info"));
socket.on("connect", () => showToast("Connected", "success"));
socket.on("disconnect", () => showToast("Disconnected", "error"));

// ===== JOIN ROOM (with corrections for transition) =====

// Join room (with feedback to landing page)
if (window.currentRoom && window.currentUser) {
  console.log('[Join] emitting join room', window.currentRoom, window.currentUser);
  socket.emit('join room', { room: window.currentRoom, username: window.currentUser });
}

// Listen for successful room join
socket.on('join room success', () => {
  // Hide landing page
  document.getElementById('username-prompt').style.display = 'none';
  // Show chat container
  document.getElementById('chat-container').style.display = 'flex';
});

// Join error handling
socket.on('join room error', (error) => {
  alert(`Error: ${error}`);
});

// Handle disconnect and clean up
socket.on('disconnect', () => {
  document.getElementById('chat-container').style.display = 'none';
  document.getElementById('username-prompt').style.display = 'block';
});

    // UI transition
    usernamePrompt?.classList.add("hidden");
    chatContainer?.classList.remove("hidden");
    // Tiny delay to let layout settle before scrolling
    setTimeout(() => {
      messages?.scrollTo({ top: messages.scrollHeight, behavior: "smooth" });
    }, 250);
  });
}

// If coming in with globals set (deep-link), auto-join
if (window.currentRoom && window.currentUser) {
  console.log("[Join] Auto-join", window.currentRoom, window.currentUser);
  socket.emit("join room", {
    room: window.currentRoom,
    username: window.currentUser,
    password: window.currentPassword || "",
  });
  usernamePrompt?.classList.add("hidden");
  chatContainer?.classList.remove("hidden");
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

// ------------------- History & Messages -------------------
function renderMessage(msg) {
  const wrap = document.createElement("div");
  // Use your existing bubble structure if present in CSS
  const isSelf = msg.user === window.currentUser;
  wrap.className = `message ${isSelf ? "self" : "other"}`;
  wrap.innerHTML = `
    <div class="meta">${msg.user || "Anon"} • ${new Date(msg.timestamp || Date.now()).toLocaleTimeString()}</div>
    <div class="text">${msg.text || ""}</div>
  `;
  messages.appendChild(wrap);
  autoEmbed(wrap);
  messages.scrollTop = messages.scrollHeight;
}

socket.on("load messages", (arr) => {
  messages.innerHTML = "";
  (arr || []).forEach(renderMessage);
  showToast(`✅ Joined room: ${window.currentRoom}`, "success");
});

socket.on("previous messages", (arr) => {
  // legacy event, render the same way but don't double-toast
  if (!messages.childElementCount) {
    (arr || []).forEach(renderMessage);
  }
});

socket.on("chat message", (msg) => {
  renderMessage(msg);
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

  const gifBtn = document.createElement("button");
  gifBtn.id = "gif-btn";
  gifBtn.type = "button";
  gifBtn.textContent = "GIF";
  gifBtn.style.marginLeft = "6px";
  emojiBtn.insertAdjacentElement("afterend", gifBtn);

  const panel = document.createElement("div");
  panel.id = "gif-picker";
  panel.innerHTML = `
    <div class="gif-search"><input id="gif-search-input" placeholder="Search GIFs…"></div>
    <div id="gif-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;"></div>`;
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
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.objectFit = "cover";
        img.style.borderRadius = "8px";
        img.style.cursor = "pointer";
        img.onclick = () => {
          const url =
            g?.media_formats?.gif?.url ||
            g?.media_formats?.mediumgif?.url ||
            g?.media_formats?.tinygif?.url ||
            thumb;
          socket.emit("chat message", {
            room: window.currentRoom,
            user: window.currentUser,
            text: url,
            timestamp: Date.now(),
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

  links.forEach((link) => {
    let el = null;

    // YouTube
    let m = link.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/i);
    if (m) {
      el = document.createElement("iframe");
      el.src = `https://www.youtube.com/embed/${m[1]}`;
      el.className = "embed-iframe";
      el.setAttribute("allowfullscreen", "true");
    }

    // Spotify
    if (!el) {
      m = link.match(/https?:\/\/open\.spotify\.com\/(track|album|playlist)\/([\w]+)/i);
      if (m) {
        el = document.createElement("iframe");
        el.src = `https://open.spotify.com/embed/${m[1]}/${m[2]}`;
        el.className = "embed-iframe";
      }
    }

    // SoundCloud
    if (!el && /https?:\/\/(?:soundcloud\.com|snd\.sc)\//i.test(link)) {
      el = document.createElement("iframe");
      el.src = "https://w.soundcloud.com/player/?url=" + encodeURIComponent(link);
      el.className = "embed-iframe";
    }

    // Direct media
    if (!el && /\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i.test(link)) {
      el = document.createElement("img");
      el.src = link;
      el.className = "embed-image";
    }
    if (!el && /\.(mp4|webm|mov)(\?.*)?$/i.test(link)) {
      el = document.createElement("video");
      el.src = link;
      el.controls = true;
      el.className = "embed-media";
    }
    if (!el && /\.(mp3|wav|ogg)(\?.*)?$/i.test(link)) {
      el = document.createElement("audio");
      el.src = link;
      el.controls = true;
      el.className = "embed-audio";
    }

    if (el) wrap.appendChild(el);
  });

  if (wrap.childNodes.length) node.appendChild(wrap);

  // Collapsible OG cards for non-media links
  (async () => {
    const normal = links.filter(
      (u) =>
        !/(youtube|youtu\.be|open\.spotify|soundcloud|\.mp4|\.webm|\.mov|\.mp3|\.wav|\.ogg|\.png|\.jpg|\.jpeg|\.gif|\.webp|\.pdf)/i.test(
          u
        )
    );
    if (!normal.length) return;

    async function fetchPreview(url) {
      try {
        const r = await fetch("/link-preview?url=" + encodeURIComponent(url));
        return await r.json();
      } catch {
        return null;
      }
    }

    for (const u of normal) {
      const d = await fetchPreview(u);
      if (!d || (!d.title && !d.image)) continue;

      const card = document.createElement("div");
      card.className = "link-card";

      const header = document.createElement("div");
      header.className = "link-header";
      header.innerHTML = `<span class="toggle">▶️</span><span class="domain">${new URL(u).hostname}</span>`;

      const body = document.createElement("div");
      body.className = "link-body";
      body.innerHTML =
        (d.image ? `<img src="${d.image}" alt="">` : "") +
        `<div class="title">${d.title || u}</div>`;

      const toggle = header.querySelector(".toggle");
      card.appendChild(header);
      card.appendChild(body);

      header.onclick = () => {
        const open = card.classList.toggle("open");
        toggle.textContent = open ? "🔽" : "▶️";
      };
      body.onclick = () => window.open(u, "_blank");

      node.appendChild(card);
    }
  })();
}

console.log("%c✅ DizyChat Fusion Ready — join a room to begin", "color:#b266ff;font-weight:bold;");
