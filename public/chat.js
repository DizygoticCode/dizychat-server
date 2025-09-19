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
const shareInput = document.getElementById('share-link-input');
const shareBtn = document.getElementById('share-link-btn');
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

emojiBtn.addEventListener('click', e => {
  e.stopPropagation();
  emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'flex' : 'none';
});

document.addEventListener('click', e => {
  if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
    emojiPicker.style.display = 'none';
  }
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
  socket.on('room history', history => history.forEach(msg => displayMessage(msg)));
  socket.on('typing', users => {
    const others = users.filter(u => u !== username);
    typingBubble.style.display = others.length ? 'block' : 'none';
    typingBubble.textContent = others.length ? `${others.join(', ')} is typing...` : '';
  });
  socket.on('message status', ({id,status}) => {
    const msgDiv = document.querySelector(`.message[data-id='${id}'] .status`);
    if(msgDiv) msgDiv.textContent = statusIcon(status);
  });
});

// ---------------- Display Messages ----------------
function displayMessage(msg) {
  const div = document.createElement('div');
  div.classList.add('message', msg.user===username?'self':'other');
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

  if(msg.user !== username) socket.emit('read message', {room,id: msg._id||msg.id});
}

// ---------------- Status Icon ----------------
function statusIcon(status) {
  switch(status) {
    case 'sent': return '✓';
    case 'delivered': return '✓✓';
    case 'read': return '✓✓✔';
    default: return '';
  }
}

// ---------------- Share Chat Link ----------------
shareBtn.addEventListener('click', () => {
  const fullURL = `${window.location.origin}/room/${encodeURIComponent(room)}?nickname=${encodeURIComponent(username)}`;
  shareInput.value = fullURL;
  try {
    navigator.clipboard.writeText(fullURL).then(() => alert("Room link copied!"));
  } catch {
    alert(`Room link: ${fullURL}`);
  }
});
