// ---------------- Globals ----------------
const socket = io();
let currentUser = null;
let currentRoom = null;
const messages = document.getElementById('messages');
const form = document.getElementById('form');
const input = document.getElementById('input');
const typingBubble = document.getElementById('typing-bubble');
const roomList = document.getElementById('room-list');
const emojiPicker = document.getElementById('emoji-picker');
const quickEmojis = document.getElementById('quick-emojis');
const themeToggle = document.getElementById('toggle-theme');

// ---------------- Landing Page Logic ----------------
document.getElementById('join-btn').addEventListener('click', () => {
  const username = document.getElementById('username-input').value.trim();
  const room = document.getElementById('room-input').value.trim();
  const password = document.getElementById('room-password').value;

  if (!username || !room) return alert('Enter username and room name');

  currentUser = username;
  currentRoom = room;

  // Save room in localStorage
  let recent = JSON.parse(localStorage.getItem('recentRooms') || '[]');
  if (!recent.includes(room)) {
    recent.unshift(room);
    if (recent.length > 5) recent.pop();
    localStorage.setItem('recentRooms', JSON.stringify(recent));
  }

  socket.emit('join room', { user: username, room, password });
  document.getElementById('username-prompt').style.display = 'none';
  document.getElementById('chat-container').style.display = 'flex';
  document.getElementById('room-name').textContent = room;
  renderRecentRooms();
});

// ---------------- Recent Rooms ----------------
function renderRecentRooms() {
  const recent = JSON.parse(localStorage.getItem('recentRooms') || '[]');
  roomList.innerHTML = '';
  recent.forEach(r => {
    const btn = document.createElement('button');
    btn.className = 'room-btn';
    btn.textContent = r;
    btn.addEventListener('click', () => {
      document.getElementById('room-input').value = r;
    });
    roomList.appendChild(btn);
  });
}
renderRecentRooms();

// ---------------- Form Submission ----------------
form.addEventListener('submit', e => {
  e.preventDefault();
  if (input.value.trim()) {
    socket.emit('chat message', { room: currentRoom, user: currentUser, text: input.value });
    input.value = '';
    socket.emit('stop typing', { room: currentRoom });
  }
});

// ---------------- Typing Indicator ----------------
let typingTimeout;
input.addEventListener('input', () => {
  socket.emit('typing', { room: currentRoom, user: currentUser });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit('stop typing', { room: currentRoom });
  }, 2000);
});

socket.on('typing', user => {
  if (user !== currentUser) {
    typingBubble.style.display = 'block';
    typingBubble.textContent = `${user} is typing...`;
  }
});
socket.on('stop typing', () => {
  typingBubble.style.display = 'none';
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

  const textNode = document.createTextNode(` ${msg.text}`);
  div.appendChild(textNode);

  handleLinkPreview(div, msg.text);
  addReactionUI(div);

  // Edit/Delete Menu
  if (msg.user === currentUser) addMessageControls(div, msg);

  messages.appendChild(div);

  // Auto-scroll only if near bottom
  if (messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80) {
    div.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  if (msg.user !== currentUser) {
    socket.emit('read message', { room: currentRoom, id: msg._id || msg.id });
  }
}

socket.on('chat message', displayMessage);

// ---------------- Reactions ----------------
function addReactionUI(messageDiv) {
  const container = document.createElement('div');
  container.classList.add('reaction-container');

  const btn = document.createElement('button');
  btn.classList.add('reaction-btn');
  btn.textContent = '➕';
  container.appendChild(btn);

  const menu = document.createElement('div');
  menu.classList.add('reaction-menu');
  ['👍', '❤️', '😂', '🔥', '😮'].forEach(emoji => {
    const span = document.createElement('span');
    span.textContent = emoji;
    span.addEventListener('click', () => {
      const selected = document.createElement('span');
      selected.textContent = emoji;
      messageDiv.appendChild(selected);
      menu.style.display = 'none';
    });
    menu.appendChild(span);
  });
  container.appendChild(menu);

  btn.addEventListener('click', () => {
    menu.style.display = menu.style.display === 'flex' ? 'none' : 'flex';
  });

  messageDiv.appendChild(container);
}

// ---------------- Edit/Delete ----------------
function addMessageControls(messageDiv, msg) {
  const wrapper = document.createElement('div');
  wrapper.classList.add('msg-menu-wrapper');

  const menuBtn = document.createElement('button');
  menuBtn.classList.add('menu-btn');
  menuBtn.textContent = '⋮';

  const menu = document.createElement('div');
  menu.classList.add('msg-menu');

  const editBtn = document.createElement('button');
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', () => {
    const newText = prompt('Edit message:', msg.text);
    if (newText !== null) {
      socket.emit('edit message', { room: currentRoom, id: msg._id || msg.id, text: newText });
    }
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', () => {
    if (confirm('Delete this message?')) {
      socket.emit('delete message', { room: currentRoom, id: msg._id || msg.id });
    }
  });

  menu.appendChild(editBtn);
  menu.appendChild(deleteBtn);
  wrapper.appendChild(menuBtn);
  wrapper.appendChild(menu);

  menuBtn.addEventListener('click', () => {
    menu.style.display = menu.style.display === 'flex' ? 'none' : 'flex';
  });

  messageDiv.appendChild(wrapper);
}

// ---------------- Link Previews ----------------
async function handleLinkPreview(messageDiv, text) {
  const urlRegex = /(https?:\/\/[^\s]+)/;
  const match = text.match(urlRegex);
  if (match) {
    const url = match[0];
    const preview = document.createElement('div');
    preview.classList.add('link-preview');
    preview.textContent = 'Loading preview...';
    messageDiv.appendChild(preview);

    try {
      const res = await fetch(`/preview?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      preview.innerHTML = `
        <strong>${data.title || 'Link'}</strong><br>
        <a href="${url}" target="_blank">${url}</a>
        ${data.image ? `<img src="${data.image}" alt="Preview">` : ''}
      `;
    } catch {
      preview.textContent = 'Preview unavailable';
    }
  }
}

// ---------------- Dark Mode ----------------
themeToggle.addEventListener('click', () => {
  document.body.classList.toggle('dark');
  themeToggle.textContent = document.body.classList.contains('dark') ? '☀️' : '🌙';
});
