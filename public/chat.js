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

  // Update URL
  const newURL = `${window.location.origin}?room=${encodeURIComponent(room)}`;
  window.history.replaceState({}, "", newURL);

  // ---------------- Socket.IO ----------------
  socket = io();
  socket.emit("join room", room);
  socket.emit("get history", room);

  // Typing indicator
  input.addEventListener("input", () => {
    socket.emit("typing", currentUser);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit("stop typing", currentUser), 1000);
  });

  // Send message
  form.addEventListener("submit", e => {
    e.preventDefault();
    if (!input.value) return;
    const msgData = { room: currentRoom, user: currentUser, text: input.value, timestamp: new Date() };
    socket.emit('chat message', msgData);
    input.value = '';
    input.focus();
  });

  // Receive messages
  socket.on('chat message', msg => displayMessage(msg));

  // Room history
  socket.on('room history', msgs => msgs.forEach(msg => displayMessage(msg)));

  // Typing bubble
  socket.on('typing', users => {
    const others = users.filter(u => u !== currentUser);
    typingBubble.style.display = others.length ? 'block' : 'none';
    typingBubble.textContent = others.length ? `${others.join(', ')} is typing...` : '';
  });

  // Message status
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
});

// ---------------- Home Logo Button ----------------
homeLogo.addEventListener("click", () => {
  chatContainer.style.display = "none";
  usernamePrompt.style.display = "flex";
  roomNameSpan.textContent = "Room";
  window.history.replaceState({}, "", window.location.origin);
});

// ---------------- Emoji Picker ----------------
let currentEmojiCategory = "Faces";
const fallbackEmojis = { /* same fallbackEmojis object you already have */ };

// Load emoji.json or fallback
async function loadEmojis() {
  try {
    const res = await fetch("/emoji.json");
    if (!res.ok) throw new Error("Failed to fetch emoji.json");
    const emojis = await res.json();
    categorizeEmojis(emojis);
  } catch (err) {
    console.error("Emoji picker failed, using fallback:", err);
    renderEmojiTabs(fallbackEmojis);
  }
}

// Categorize emojis
function categorizeEmojis(emojis) {
  const categories = { "Faces": [], "Food": [], "Animals": [], "Gestures": [], "Hearts": [] };
  emojis.forEach(e => {
    if (["😀","😂","😍","😭","😎"].includes(e.char)) categories.Faces.push(e);
    else if (["🍕","🍔","🍟","🍣","☕"].includes(e.char)) categories.Food.push(e);
    else if (["🐶","🐱","🐭","🐰","🦊"].includes(e.char)) categories.Animals.push(e);
    else if (["👍","👎","👏","🙏"].includes(e.char)) categories.Gestures.push(e);
    else if (["❤️","💛","💚","💙"].includes(e.char)) categories.Hearts.push(e);
  });
  renderEmojiTabs(categories);
}

// Render emoji tabs
function renderEmojiTabs(categories) {
  emojiPicker.innerHTML = "";
  const tabsDiv = document.createElement("div");
  tabsDiv.classList.add("emoji-tabs");
  Object.keys(categories).forEach(cat => {
    const btn = document.createElement("button");
    btn.textContent = cat;
    btn.classList.add("emoji-tab-btn");
    if (cat === currentEmojiCategory) btn.classList.add("active");
    btn.addEventListener("click", () => switchEmojiCategory(cat, categories));
    tabsDiv.appendChild(btn);
  });
  emojiPicker.appendChild(tabsDiv);
  renderEmojiCategory(categories[currentEmojiCategory]);
}

// Switch category
function switchEmojiCategory(cat, categories) {
  currentEmojiCategory = cat;
  document.querySelectorAll(".emoji-tab-btn").forEach(b => {
    b.classList.toggle('active', b.textContent === cat);
  });
  renderEmojiCategory(categories[cat]);
}

// Render emoji grid
function renderEmojiCategory(emojis) {
  let grid = emojiPicker.querySelector(".emoji-category");
  if (!grid) {
    grid = document.createElement("div");
    grid.classList.add("emoji-category");
    emojiPicker.appendChild(grid);
  }
  grid.innerHTML = "";
  emojis.forEach(e => {
    const span = document.createElement("span");
    span.textContent = e.char;
    span.title = e.name;
    span.addEventListener("click", () => insertAtCursor(input, e.char));
    grid.appendChild(span);
  });
}

// Insert emoji at cursor
function insertAtCursor(input, text) {
  const start = input.selectionStart;
  const end = input.selectionEnd;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  input.selectionStart = input.selectionEnd = start + text.length;
  input.focus();
}

// Toggle emoji picker
emojiBtn.addEventListener('click', e => {
  e.stopPropagation();
  emojiPicker.classList.toggle('show');
});

// Close picker on outside click
document.addEventListener('click', e => {
  if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
    emojiPicker.classList.remove('show');
  }
});

// ---------------- Mobile Emoji Picker Scroll ----------------
function scrollChatToBottom() {
  messages.scrollTop = messages.scrollHeight;
}

// Enhance emoji button for mobile
emojiBtn.addEventListener('click', e => {
  e.stopPropagation();
  emojiPicker.classList.toggle('show');

  // On mobile, scroll chat to bottom when picker opens
  if (window.innerWidth <= 600 && emojiPicker.classList.contains('show')) {
    setTimeout(scrollChatToBottom, 50); // slight delay to ensure picker is visible
  }
});


// Initialize
loadEmojis();
