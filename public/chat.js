const socket = io();

// DOM Elements
const usernamePrompt = document.getElementById("username-prompt");
const usernameInput = document.getElementById("username-input");
const roomInput = document.getElementById("room-input");
const joinBtn = document.getElementById("join-btn");
const chatContainer = document.getElementById("chat-container");
const messages = document.getElementById("messages");
const form = document.getElementById("form");
const input = document.getElementById("input");
const roomNameSpan = document.getElementById("room-name");
const typingBubble = document.getElementById("typing-bubble");
const emojiBtn = document.getElementById("emoji-btn");
const emojiPicker = document.getElementById("emoji-picker");
const shareBtn = document.getElementById("share-btn");
const toggleTheme = document.getElementById("toggle-theme");

// Globals
let currentUser = "";
let currentRoom = "";
let typingTimeout;

// ---------------- Landing Page Prefill & Auto-Prompt ----------------
const urlParams = new URLSearchParams(window.location.search);
const sharedRoom = urlParams.get("room");
if (sharedRoom) {
  roomInput.value = sharedRoom;
  usernamePrompt.style.display = "flex"; // ensure landing prompt is visible
  chatContainer.style.display = "none"; // hide chat until joined
}


// ---------------- Join Chat ----------------
joinBtn.addEventListener("click", () => {
  const username = usernameInput.value.trim();
  const room = roomInput.value.trim();

  if (!username || !room) {
    alert("Please enter both username and room name.");
    return;
  }

  currentUser = username;
  currentRoom = room;

  usernamePrompt.style.display = "none";
  chatContainer.style.display = "flex";
  roomNameSpan.textContent = room;

  socket.emit("join room", room);
  socket.emit("get history", room);
});

// ---------------- Receive Messages ----------------
socket.on("room history", (history) => {
  messages.innerHTML = "";
  history.forEach(addMessage);
});

socket.on("chat message", (msg) => {
  addMessage(msg);
});

socket.on("message status", ({ id, status }) => {
  const msgEl = document.getElementById(id);
  if (msgEl) {
    const statusEl = msgEl.querySelector(".status");
    if (statusEl) statusEl.textContent = status;
  }
});

// ---------------- Typing Indicators ----------------
input.addEventListener("input", () => {
  socket.emit("typing", currentUser);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit("stop typing");
  }, 1000);
});

socket.on("typing", (users) => {
  typingBubble.textContent = users.length
    ? `${users.join(", ")} typing...`
    : "";
});

// ---------------- Send Message ----------------
form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (input.value) {
    const msgData = {
      room: currentRoom,
      user: currentUser,
      text: input.value,
      timestamp: new Date(),
    };
    socket.emit("chat message", msgData);
    input.value = "";
    socket.emit("stop typing");
  }
});

// ---------------- Add Message ----------------
function addMessage(msg) {
  const div = document.createElement("div");
  div.className = `message ${msg.user === currentUser ? "self" : "other"}`;
  div.id = msg._id || `msg-${Date.now()}`;
  div.innerHTML = `
    <div class="meta"><strong>${msg.user}</strong> • ${new Date(
    msg.timestamp
  ).toLocaleTimeString()}</div>
    <div class="text">${msg.text}</div>
    <div class="status">${msg.status || "sent"}</div>
  `;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

// ---------------- Emoji Picker ----------------
emojiBtn.addEventListener("click", async () => {
  if (emojiPicker.style.display === "flex") {
    emojiPicker.style.display = "none";
    return;
  }

  if (!emojiPicker.hasChildNodes()) {
    try {
      const res = await fetch("emoji.json");
      const emojis = await res.json();
      emojis.forEach((e) => {
        const span = document.createElement("span");
        span.textContent = e.char;
        span.title = e.name;
        span.addEventListener("click", () => {
          input.value += e.char;
          emojiPicker.style.display = "none";
          input.focus();
        });
        emojiPicker.appendChild(span);
      });
    } catch (err) {
      console.error("Failed to load emoji.json", err);
    }
  }

  emojiPicker.style.display = "flex";
});

// ---------------- Share Button ----------------
shareBtn.addEventListener("click", () => {
  if (!currentRoom) {
    alert("You must join a room first!");
    return;
  }

  const fullURL = `${window.location.origin}?room=${encodeURIComponent(
    currentRoom
  )}`;

  try {
    navigator.clipboard.writeText(fullURL).then(() => {
      alert("Room link copied! Share it so others can join.");
    });
  } catch (err) {
    console.warn("Clipboard copy failed:", err);
    alert(`Room link: ${fullURL}`);
  }
});

// ---------------- Dark/Light Theme ----------------
toggleTheme.addEventListener("click", () => {
  document.body.classList.toggle("dark");
  toggleTheme.textContent = document.body.classList.contains("dark")
    ? "☀️"
    : "🌙";
});
