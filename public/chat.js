// ---------------- DOM Elements ----------------
const usernamePrompt = document.getElementById('username-prompt'); 
const joinBtn = document.getElementById('join-btn');
const usernameInput = document.getElementById('username-input');
const roomInput = document.getElementById('room-input');
const chatContainer = document.getElementById('chat-container');
const form = document.getElementById('form');
const input = document.getElementById('input');
const messages = document.getElementById('messages');
const typingBubble = document.getElementById('typing-bubble');
const emojiPicker = document.getElementById('emoji-picker');
const emojiBtn = document.getElementById('emoji-btn');
const shareBtn = document.getElementById('share-btn');
const toggleThemeBtn = document.getElementById('toggle-theme');
const roomNameSpan = document.getElementById('room-name');
const homeLogo = document.getElementById('home-logo');

let currentUser = '';
let currentRoom = '';
let socket;
let typingTimeout;
let darkMode = false;
let emojiData = {};

// ---------------- Landing Page Prefill ----------------
const urlParams = new URLSearchParams(window.location.search);
const prefillRoom = urlParams.get("room");
if (prefillRoom) roomInput.value = prefillRoom;

// ---------------- Join Chat ----------------
joinBtn.addEventListener("click", () => {
  const username = usernameInput.value.trim();
  const room = roomInput.value.trim();
  if (!username || !room) return alert("Please enter both username and room name.");

  currentUser = username;
  currentRoom = room;

  usernamePrompt.style.display = "none";
  chatContainer.style.display = "flex";
  roomNameSpan.textContent = room;

  const newURL = `${window.location.origin}?room=${encodeURIComponent(room)}`;
  window.history.replaceState({}, "", newURL);

  // ---------------- Socket.IO ----------------
  socket = io();
  socket.emit("join room", room);
  socket.emit("get history", room);

  input.addEventListener("input", () => {
    socket.emit("typing", currentUser);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit("stop typing", currentUser), 1000);
  });

  form.addEventListener("submit", e => {
    e.preventDefault();
    if (!input.value) return;
    const msgData = { room: currentRoom, user: currentUser, text: input.value, timestamp: new Date() };
    socket.emit('chat message', msgData);
    input.value = '';
    input.focus();
  });

  socket.on('chat message', msg => displayMessage(msg));
  socket.on('room history', msgs => msgs.forEach(msg => displayMessage(msg)));
  socket.on('typing', users => {
    const others = users.filter(u => u !== currentUser);
    typingBubble.style.display = others.length ? 'block' : 'none';
    typingBubble.textContent = others.length ? `${others.join(', ')} is typing...` : '';
  });
  socket.on('message status', ({ id, status }) => {
    const msgDiv = document.querySelector(`.message[data-id='${id}'] .status`);
    if (msgDiv) msgDiv.textContent = statusIcon(status);
  });
});

// ---------------- Display Messages ----------------
function displayMessage(msg) {
  const div = document.createElement('div');
  div.classList.add('message', msg.user === currentUser ? 'self' : 'other');
  div.dataset.id = msg._id || msg.id;

  const meta = document.createElement('div');
  meta.classList.add('meta');
  meta.textContent = `[${new Date(msg.timestamp).toLocaleTimeString()}] ${msg.user}`;
  div.appendChild(meta);

  div.appendChild(document.createTextNode(` ${msg.text}`));

  const statusSpan = document.createElement('span');
  statusSpan.classList.add('status');
  statusSpan.textContent = statusIcon(msg.status || 'sent');
  div.appendChild(statusSpan);

  messages.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'end' });

  if (msg.user !== currentUser) socket.emit('read message', { room: currentRoom, id: msg._id || msg.id });
}

// ---------------- Status Icon ----------------
function statusIcon(status) {
  switch(status){
    case 'sent': return '✓';
    case 'delivered': return '✓✓';
    case 'read': return '✓✓✔';
    default: return '';
  }
}

// ---------------- Share Chat Link ----------------
shareBtn.addEventListener("click", () => {
  const nickname = currentUser || prompt("Enter your nickname:", "Guest") || "Guest";
  const fullURL = `${window.location.origin}?room=${encodeURIComponent(currentRoom)}&nickname=${encodeURIComponent(nickname)}`;
  navigator.clipboard.writeText(fullURL)
    .then(() => alert("Room link copied!"))
    .catch(() => alert(`Room link: ${fullURL}`));
});

// ---------------- Dark Mode ----------------
toggleThemeBtn.addEventListener("click", () => {
  darkMode = !darkMode;
  document.body.classList.toggle("dark", darkMode);
  toggleThemeBtn.textContent = darkMode ? "☀️" : "🌙";
  // Switch logo in header
  homeLogo.src = darkMode ? "logo.png" : "logodark.png";
});

// ---------------- Home Logo Button ----------------
homeLogo.addEventListener("click", () => {
  chatContainer.style.display = "none";
  usernamePrompt.style.display = "flex";
  roomNameSpan.textContent = "Room";
  window.history.replaceState({}, "", window.location.origin);
});

// ---------------- Emoji Picker ----------------
fetch("emoji.json")
  .then(res => res.json())
  .then(data => {
    emojiData = data;
    buildEmojiPicker(data);
  })
  .catch(err => console.error("Emoji picker failed:", err));

function buildEmojiPicker(data) {
  emojiPicker.innerHTML = "";

  // Tabs
  const tabs = document.createElement("div");
  tabs.classList.add("emoji-tabs");

  // Content wrapper
  const content = document.createElement("div");
  content.classList.add("emoji-content");

  Object.keys(data).forEach((category, index) => {
    // Tab button
    const tabBtn = document.createElement("button");
    tabBtn.textContent = category;
    tabBtn.classList.add("emoji-tab-btn");
    if (index === 0) tabBtn.classList.add("active");

    tabBtn.addEventListener("click", () => {
      document.querySelectorAll(".emoji-tab-btn").forEach(b => b.classList.remove("active"));
      tabBtn.classList.add("active");

      // Show only selected category
      document.querySelectorAll(".emoji-category").forEach(c => c.style.display = "none");
      content.querySelector(`[data-category="${category}"]`).style.display = "grid";
    });

    tabs.appendChild(tabBtn);

    // Emoji grid
    const categoryDiv = document.createElement("div");
    categoryDiv.classList.add("emoji-category");
    categoryDiv.dataset.category = category;
    if (index !== 0) categoryDiv.style.display = "none";

    data[category].forEach(e => {
      const span = document.createElement("span");
      span.textContent = e.char;
      span.title = e.name;
      span.addEventListener("click", () => {
        insertAtCursor(input, e.char);
        emojiPicker.classList.remove("show"); // auto-close
      });
      categoryDiv.appendChild(span);
    });

    content.appendChild(categoryDiv);
  });

  emojiPicker.appendChild(tabs);
  emojiPicker.appendChild(content);
}

// Insert emoji at cursor
function insertAtCursor(input, text) {
  const start = input.selectionStart;
  const end = input.selectionEnd;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  input.selectionStart = input.selectionEnd = start + text.length;
  input.focus();
}

// Toggle picker
emojiBtn.addEventListener('click', e => {
  e.stopPropagation();
  emojiPicker.classList.toggle('show');
  if (window.innerWidth <= 600 && emojiPicker.classList.contains('show')) {
    setTimeout(() => messages.scrollTop = messages.scrollHeight, 50);
  }
});

document.addEventListener('click', e => {
  if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
    emojiPicker.classList.remove('show');
  }
});
