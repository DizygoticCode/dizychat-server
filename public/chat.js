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
const roomNameDisplay = document.getElementById('room-name');

let username = '';
let room = '';
let socket;
let typingTimeout;
let darkMode = false;

// ---------------- Emoji Picker ----------------
fetch('/emoji.json')
  .then(res => res.json())
  .then(data => {
    data.forEach(e => {
      const span = document.createElement('span');
      span.textContent = e.char;
      span.classList.add('emoji');
      span.addEventListener('click', () => insertAtCursor(input, e.char));
      emojiPicker.appendChild(span);
    });
  })
  .catch(err => console.error("Failed to load emoji.json:", err));

emojiBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'flex' : 'none';
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

// ---------------- Auto-Join from URL ----------------
window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const urlUsername = params.get('username');
  const urlRoom = params.get('room');

  if (urlRoom) {
    roomInput.value = urlRoom;
  }
  if (urlUsername) {
    usernameInput.value = urlUsername;
  }

  // If both provided, skip prompt and join
  if (urlUsername && urlRoom) {
    joinChat(urlUsername, urlRoom);
  }
});

// ---------------- Join Chat ----------------
joinBtn.addEventListener('click', () => {
  const enteredUser = usernameInput.value.trim();
  const enteredRoom = roomInput.value.trim();

  if (!enteredUser || !enteredRoom) return alert('Enter username and room');
  joinChat(enteredUser, enteredRoom);
});

function joinChat(user, roomName) {
  username = user;
  room = roomName;

  usernamePrompt.style.display = 'none';
  chatContainer.style.display = 'flex';
  roomNameDisplay.textContent = room;
  input.focus();

  socket = io();
  socket.emit('join room', room);

  // Request room history
  socket.emit('get history', room);

  // Typing
  input.addEventListener('input', () => {
    socket.emit('typing', username);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit('stop typing', username), 1000);
  });

  // Send message
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!input.value) return;
    const msgData = { room, user: username, text: input.value, timestamp: new Date() };
    socket.emit('chat message', msgData);
    input.value = '';
    input.focus();
  });

  // Receive messages
  socket.on('chat message', msg => displayMessage(msg));

  // Room history
  socket.on('room history', messagesHistory => {
    messagesHistory.forEach(msg => displayMessage(msg));
  });

  // Typing bubble
  socket.on('typing', users => {
    const others = users.filter(u => u !== username);
    typingBubble.style.display = others.length ? 'block' : 'none';
    typingBubble.textContent = others.length ? `${others.join(', ')} is typing...` : '';
  });

  // Message status
  socket.on('message status', ({ id, status }) => {
    const msgDiv = document.querySelector(`.message[data-id='${id}'] .status`);
    if (msgDiv) msgDiv.textContent = statusIcon(status);
  });
}

// ---------------- Display Messages ----------------
function displayMessage(msg) {
  const div = document.createElement('div');
  div.classList.add('message', msg.user === username ? 'self' : 'other');
  div.dataset.id = msg._id || msg.id;

  // Meta (timestamp + username)
  const meta = document.createElement('div');
  meta.classList.add('meta');
  const time = new Date(msg.timestamp).toLocaleTimeString();
  meta.textContent = `[${time}] ${msg.user}`;
  div.appendChild(meta);

  // Message text
  div.appendChild(document.createTextNode(` ${msg.text}`));

  // Status ticks
  const statusSpan = document.createElement('span');
  statusSpan.classList.add('status');
  statusSpan.textContent = statusIcon(msg.status || 'sent');
  div.appendChild(statusSpan);

  // Reaction button
  const reactBtn = document.createElement('span');
  reactBtn.classList.add('react-btn');
  reactBtn.textContent = '😊';
  reactBtn.addEventListener('click', () => addReaction(msg._id || msg.id, '😊'));
  div.appendChild(reactBtn);

  // Reactions container
  const reactionsDiv = document.createElement('div');
  reactionsDiv.classList.add('reactions');
  div.appendChild(reactionsDiv);

  messages.appendChild(div);

  // Smooth scroll to the latest message
  div.scrollIntoView({ behavior: 'smooth', block: 'end' });

  // Mark as read if not self
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
  const chatURL = window.location.href;

  navigator.clipboard.writeText(chatURL)
    .then(() => {
      alert('Chat link copied! Share it to invite others to this room.');
    })
    .catch(() => {
      alert(`Copy failed. Here’s the link:\n${chatURL}`);
    });
});
