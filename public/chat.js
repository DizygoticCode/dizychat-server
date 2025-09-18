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

let allEmojis = [];
let selectedEmojiIndex = -1;

// ---------------- Emoji Picker ----------------
fetch('emoji.json')
  .then(res => res.json())
  .then(data => {
    allEmojis = data.filter(e => e.char);
    renderEmojis(allEmojis);
  })
  .catch(err => console.error('Failed to load emoji.json', err));

function renderEmojis(emojis) {
  emojiPicker.innerHTML = '<input type="text" id="emoji-search" placeholder="Search emojis..." />';
  const searchInput = document.getElementById('emoji-search');

  emojis.forEach((e, idx) => {
    const span = document.createElement('span');
    span.textContent = e.char;
    span.classList.add('emoji');
    span.setAttribute('tabindex', 0);
    span.dataset.index = idx;
    span.addEventListener('click', () => insertAtCursor(input, e.char));
    emojiPicker.appendChild(span);
  });

  selectedEmojiIndex = -1;

  searchInput.addEventListener('input', () => {
    const query = searchInput.value.toLowerCase();
    const filtered = allEmojis.filter(e => (e.name || '').toLowerCase().includes(query));
    renderEmojis(filtered);
  });

  searchInput.addEventListener('keydown', (e) => {
    const emojiSpans = Array.from(emojiPicker.querySelectorAll('span.emoji'));
    if (!emojiSpans.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedEmojiIndex = (selectedEmojiIndex + 1) % emojiSpans.length;
      focusEmoji(selectedEmojiIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedEmojiIndex = (selectedEmojiIndex - 1 + emojiSpans.length) % emojiSpans.length;
      focusEmoji(selectedEmojiIndex);
    } else if (e.key === 'Enter' && selectedEmojiIndex >= 0) {
      e.preventDefault();
      insertAtCursor(input, emojiSpans[selectedEmojiIndex].textContent);
    }
  });
}

function focusEmoji(index) {
  const emojiSpans = Array.from(emojiPicker.querySelectorAll('span.emoji'));
  if (index >= 0 && index < emojiSpans.length) {
    emojiSpans[index].focus();
    emojiSpans[index].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

emojiBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (emojiPicker.style.display === 'none') {
    const rect = input.getBoundingClientRect();
    emojiPicker.style.bottom = `${window.innerHeight - rect.top + 10}px`;
    emojiPicker.style.left = `${rect.left}px`;
    emojiPicker.style.display = 'flex';
  } else {
    emojiPicker.style.display = 'none';
  }
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
  if (!username || !room) return alert('Enter username and room');

  usernamePrompt.style.display = 'none';
  chatContainer.style.display = 'flex';
  input.focus();

  socket = io();
  socket.emit('join room', room);

  // Typing detection
  input.addEventListener('input', () => {
    socket.emit('typing', username, room);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit('stop typing', username, room), 1000);
  });

  // Send message
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!input.value) return;
    socket.emit('chat message', { room, user: username, text: input.value });
    input.value = '';
    input.focus();
  });

  // Receive messages
  socket.on('chat message', msg => displayMessage(msg));

  // Typing bubble
  socket.on('typing', users => {
    const others = users.filter(u => u !== username);
    typingBubble.style.display = others.length ? 'block' : 'none';
    typingBubble.textContent = others.length ? `${others.join(', ')} is typing...` : '';
  });

  // Message status updates
  socket.on('message status', ({ id, status }) => {
    const msgDiv = document.querySelector(`.message[data-id='${id}'] .status`);
    if (msgDiv) msgDiv.textContent = statusIcon(status);
  });
});

// ---------------- Display Messages ----------------
function displayMessage(msg) {
  const div = document.createElement('div');
  div.classList.add('message', msg.user === username ? 'self' : 'other');
  div.dataset.id = msg.id;

  // Meta info: timestamp + username
  const meta = document.createElement('div');
  meta.classList.add('meta');
  meta.textContent = `[${msg.timestamp}] ${msg.user}`;
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
  reactBtn.addEventListener('click', () => addReaction(msg.id, '😊'));
  div.appendChild(reactBtn);

  // Reactions container
  const reactionsDiv = document.createElement('div');
  reactionsDiv.classList.add('reactions');
  div.appendChild(reactionsDiv);

  messages.appendChild(div);

  // Scroll to latest message
  div.scrollIntoView({ behavior: 'smooth', block: 'end' });

  // Mark as read if not self
  if (msg.user !== username) socket.emit('read message', { room, id: msg.id });
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
  navigator.clipboard.writeText(window.location.href);
  alert('Chat link copied!');
});
