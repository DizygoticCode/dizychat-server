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

let username = '';
let room = '';
let socket;
let typingTimeout;
let darkMode = false;

// ---------------- Emoji Picker ----------------
fetch('emoji.json')
  .then(res => res.json())
  .then(data => {
    data.forEach(e => {
      const span = document.createElement('span');
      span.textContent = e.char;
      span.classList.add('emoji');
      span.addEventListener('click', () => insertAtCursor(input, e.char));
      emojiPicker.appendChild(span);
    });
  });

emojiBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const rect = emojiBtn.getBoundingClientRect();
  emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'flex' : 'none';
  emojiPicker.style.top = rect.top - emojiPicker.offsetHeight - 5 + 'px';
  emojiPicker.style.left = rect.left + 'px';
});

document.addEventListener('click', () => {
  emojiPicker.style.display = 'none';
});

function insertAtCursor(input, text) {
  const start = input.selectionStart;
  const end = input.selectionEnd;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  input.selectionStart = input.selectionEnd = start + text.length;
  input.focus();
}

// ---------------- Theme Toggle ----------------
toggleThemeBtn.addEventListener('click', () => {
  darkMode = !darkMode;
  document.body.classList.toggle('dark', darkMode);
  toggleThemeBtn.textContent = darkMode ? '☀️' : '🌙';
});

// ---------------- Join Chat ----------------
joinBtn.addEventListener('click', () => {
  username = usernameInput.value.trim();
  room = roomInput.value.trim();
  if (!username) username = prompt("Enter your username:", "Guest") || "Guest";
  if (!room) room = prompt("Enter room name:", "general") || "general";

  usernamePrompt.style.display = 'none';
  chatContainer.style.display = 'flex';
  document.getElementById('room-name').textContent = room;
  input.focus();

  socket = io();
  socket.emit('join room', room);

  socket.emit('get history', room);

  input.addEventListener('input', () => {
    socket.emit('typing', username);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit('stop typing', username), 1000);
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!input.value) return;
    const msgData = { room, user: username, text: input.value, timestamp: new Date() };
    socket.emit('chat message', msgData);
    input.value = '';
    input.focus();
  });

  socket.on('chat message', msg => displayMessage(msg));

  socket.on('room history', messagesHistory => {
    messagesHistory.forEach(msg => displayMessage(msg));
  });

  socket.on('typing', users => {
    const others = users.filter(u => u !== username);
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
  div.classList.add('message', msg.user === username ? 'self' : 'other');
  div.dataset.id = msg._id || msg.id;

  const meta = document.createElement('div');
  meta.classList.add('meta');
  const time = new Date(msg.timestamp).toLocaleTimeString();
  meta.textContent = `[${time}] ${msg.user}`;
  div.appendChild(meta);

  div.appendChild(document.createTextNode(` ${msg.text}`));

  const statusSpan = document.createElement('span');
  statusSpan.classList.add('status');
  statusSpan.textContent = statusIcon(msg.status || 'sent');
  div.appendChild(statusSpan);

  const reactBtn = document.createElement('span');
  reactBtn.classList.add('react-btn');
  reactBtn.textContent = '😊';
  reactBtn.addEventListener('click', () => addReaction(msg._id || msg.id, '😊'));
  div.appendChild(reactBtn);

  const reactionsDiv = document.createElement('div');
  reactionsDiv.classList.add('reactions');
  div.appendChild(reactionsDiv);

  messages.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'end' });

  if (msg.user !== username) socket.emit('read message', { room, id: msg._id || msg.id });
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
  switch (status) {
    case 'sent': return '✓';
    case 'delivered': return '✓✓';
    case 'read': return '✓✓✔';
    default: return '';
  }
}

// ---------------- Share Chat Link ----------------
shareBtn.addEventListener('click', () => {
  let nickname = username;
  if (!nickname) nickname = prompt("Enter your username to join this room:", "Guest") || "Guest";
  const fullURL = `${window.location.origin}/room/${encodeURIComponent(room)}?nickname=${encodeURIComponent(nickname)}`;

  try {
    navigator.clipboard.writeText(fullURL).then(() => {
      alert("Room link copied! Share it so others can join the same room.");
    });
  } catch (err) {
    console.warn("Clipboard copy failed, fallback alert:", err);
    alert(`Room link: ${fullURL}`);
  }
});
