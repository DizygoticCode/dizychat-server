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

let currentUser = '';
let currentRoom = '';
let socket;
let typingTimeout;
let darkMode = false;

// ---------------- Prefill Room from URL ----------------
const urlParams = new URLSearchParams(window.location.search);
const prefillRoom = urlParams.get("room");
if (prefillRoom) {
  roomInput.value = prefillRoom;
}

// ---------------- Join Chat ----------------
joinBtn.addEventListener("click", () => {
  const username = usernameInput.value.trim() || prompt("Enter your username:", "Guest");
  const room = roomInput.value.trim() || prompt("Enter a room name:", "general");

  if (!username || !room) return alert("Please enter both username and room name.");

  currentUser = username;
  currentRoom = room;

  usernamePrompt.style.display = "none";
  chatContainer.style.display = "flex";
  roomNameSpan.textContent = currentRoom;

  // ---------------- Socket.IO ----------------
  socket = io();
  socket.emit("join room", currentRoom);
  socket.emit("get history", currentRoom);

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

  const reactBtn = document.createElement('span');
  reactBtn.classList.add('react-btn');
  reactBtn.textContent = '😊';
  reactBtn.addEventListener("click", () => addReaction(msg._id || msg.id, '😊'));
  div.appendChild(reactBtn);

  const reactionsDiv = document.createElement('div');
  reactionsDiv.classList.add('reactions');
  div.appendChild(reactionsDiv);

  messages.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'end' });

  if (msg.user !== currentUser) socket.emit('read message', { room: currentRoom, id: msg._id || msg.id });
}

// ---------------- Emoji Picker ----------------
fetch('/emoji.json')
  .then(res => res.json())
  .then(data => {
    data.forEach(e => {
      const span = document.createElement('span');
      span.textContent = e.char;
      span.classList.add('emoji');
      span.addEventListener("click", () => insertAtCursor(input, e.char));
      emojiPicker.appendChild(span);
    });
  })
  .catch(err => console.error("Emoji fetch error:", err));


emojiBtn.addEventListener('click', e => {
  e.stopPropagation();
  emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'flex' : 'none';
});

document.addEventListener('click', () => emojiPicker.style.display = 'none');

function insertAtCursor(input, text) {
  const start = input.selectionStart;
  const end = input.selectionEnd;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  input.selectionStart = input.selectionEnd = start + text.length;
  input.focus();
}

// ---------------- Emoji Reactions ----------------
function addReaction(msgId, emoji) {
  const msgDiv = document.querySelector(`.message[data-id='${msgId}'] .reactions`);
  if (!msgDiv) return;

  const existing = Array.from(msgDiv.children).find(span => span.textContent.startsWith(emoji));
  if (existing) {
    existing.dataset.count = parseInt(existing.dataset.count || '1') + 1;
    existing.textContent = `${emoji} ${existing.dataset.count}`;
  } else {
    const span = document.createElement('span');
    span.textContent = emoji;
    span.dataset.count = 1;
    msgDiv.appendChild(span);
  }
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
  const nickname = currentUser || prompt("Enter your nickname to share the room:", "Guest");
  const fullURL = `${window.location.origin}?room=${encodeURIComponent(currentRoom)}&nickname=${encodeURIComponent(nickname)}`;
  navigator.clipboard.writeText(fullURL)
    .then(() => alert("Room link copied! Share it to join the same room."))
    .catch(() => alert(`Room link: ${fullURL}`));
});

// ---------------- Dark Mode ----------------
toggleThemeBtn.addEventListener("click", () => {
  darkMode = !darkMode;
  document.body.classList.toggle("dark", darkMode);
  toggleThemeBtn.textContent = darkMode ? "☀️" : "🌙";
});
