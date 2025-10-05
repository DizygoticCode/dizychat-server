// ==============================
// DizyChat — Full Chat JS
// ==============================

// ---------------- DOM References ----------------
const usernamePrompt = document.getElementById('username-prompt');
const joinBtn = document.getElementById('join-btn');
const usernameInput = document.getElementById('username-input');
const roomInput = document.getElementById('room-input');
const roomPasswordInput = document.getElementById('room-password');
const chatContainer = document.getElementById('chat-container');
const roomNameSpan = document.getElementById('room-name');
const messages = document.getElementById('messages');
const form = document.getElementById('form');
const input = document.getElementById('input');
const emojiBtn = document.getElementById('emoji-btn');
const emojiPicker = document.getElementById('emoji-picker');
const quickEmojis = document.querySelectorAll('#quick-emojis button');
const scrollLockBtn = document.getElementById('scrollLockBtn');
const typingBubble = document.getElementById('typing-bubble');
const pinnedBanner = document.getElementById('pinned-messages');
const pinnedList = document.getElementById('pinned-list');

let socket = null;
let currentUser = '';
let currentRoom = '';
let roomPassword = '';
let typingTimeout = null;
let autoScrollEnabled = true;
let emojiData = {};
let emojisLoaded = false;
let unreadCount = 0;

// ---------------- Landing Page Join ----------------
joinBtn?.addEventListener('click', () => {
  const username = usernameInput.value.trim();
  const room = roomInput.value.trim();
  const pwd = roomPasswordInput.value.trim();
  if (!username || !room) return alert('Enter both username and room name.');

  currentUser = username;
  currentRoom = room;
  roomPassword = pwd;

  localStorage.setItem('sessionToken', Date.now());
  localStorage.setItem('username', currentUser);

  // Show chat, hide landing
  usernamePrompt.style.display = 'none';
  chatContainer.style.display = 'flex';
  roomNameSpan.textContent = currentRoom;

  // Add a welcome system message
  displayMessage({ user: 'System', text: `Welcome to ${currentRoom}, ${currentUser}!`, time: Date.now() });

  // Update URL
  window.history.replaceState({}, '', `${window.location.origin}?room=${encodeURIComponent(currentRoom)}`);

  // Initialize chat after container is visible
  setTimeout(initChat, 50);
});

// ---------------- Initialize Socket ----------------
function initChat() {
  socket = io();

  socket.on('connect', () => {
    socket.emit('join room', { room: currentRoom, password: roomPassword });
    socket.emit('get pinned', { room: currentRoom });
  });

  socket.on('disconnect', () => console.log('Disconnected'));

  socket.on('chat message', displayMessage);

  socket.on('typing', (typingUsers) => {
    if (!Array.isArray(typingUsers)) return;
    const others = typingUsers.filter(u => u && u !== currentUser);
    others.length ? showTyping(others) : hideTyping();
  });

  socket.on('pinned messages', renderPinned);
  socket.on('message pinned', renderPinnedMessage);
  socket.on('message unpinned', renderPinnedMessage);

  socket.on('message starred', ({ id, starredBy }) => updateStar(id, starredBy));
  socket.on('message unstarred', ({ id, starredBy }) => updateStar(id, starredBy));

  socket.on('update reactions', ({ id, reactions }) => updateReactions(id, reactions));
}

// ---------------- Message Display ----------------
function displayMessage(msg, prepend = false) {
  if (!msg) return;
  const id = msg._id || msg.id || msg.tempId || '';
  if (id && document.querySelector(`.message[data-id='${id}']`)) return;

  const div = document.createElement('div');
  div.className = `message ${msg.user === currentUser ? 'self' : 'other'}`;
  if (id) div.dataset.id = id;

  const meta = document.createElement('div');
  meta.className = 'meta';
  const t = msg.time ? new Date(msg.time) : new Date();
  meta.textContent = `${msg.user || 'Anon'} • ${t.toLocaleTimeString()}`;
  div.appendChild(meta);

  const text = document.createElement('div');
  text.className = 'text';
  text.textContent = msg.text || '';
  div.appendChild(text);

  // Reactions
  const reactionsDiv = document.createElement('div');
  reactionsDiv.className = 'reactions';
  if (msg.reactions && msg.reactions.length) {
    msg.reactions.forEach(r => {
      const span = document.createElement('span');
      span.textContent = r.emoji;
      reactionsDiv.appendChild(span);
    });
  }
  div.appendChild(reactionsDiv);

  // Star button
  if (msg.user !== currentUser) {
    const starBtn = document.createElement('button');
    starBtn.className = 'star-btn';
    starBtn.textContent = (msg.starredBy && msg.starredBy.includes(currentUser)) ? '⭐' : '☆';
    starBtn.dataset.tooltip = 'Star this message';
    starBtn.addEventListener('click', () => {
      if (starBtn.textContent === '⭐') socket.emit('unstar message', { room: currentRoom, id, user: currentUser });
      else socket.emit('star message', { room: currentRoom, id, user: currentUser });
    });
    div.appendChild(starBtn);
  }

  // Pin button
  const pinBtn = document.createElement('button');
  pinBtn.className = 'pin-btn';
  pinBtn.textContent = msg.pinned ? '📌' : '📍';
  pinBtn.dataset.tooltip = msg.pinned ? 'Unpin message' : 'Pin message';
  pinBtn.addEventListener('click', () => {
    if (msg.pinned) socket.emit('unpin message', { room: currentRoom, id });
    else socket.emit('pin message', { room: currentRoom, id });
  });
  div.appendChild(pinBtn);

  prepend ? messages.prepend(div) : appendMessage(div);

  if (msg.user !== currentUser && socket) {
    socket.emit('read message', { room: currentRoom, id });
    incrementFavicon();
  }
}

// ---------------- Helpers ----------------
function appendMessage(div) {
  messages.appendChild(div);
  const atBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 10;
  if (autoScrollEnabled || atBottom) div.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function showTyping(users) {
  typingBubble.style.display = 'block';
  typingBubble.textContent = `${users.join(', ')} typing...`;
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(hideTyping, 2000);
}

function hideTyping() {
  typingBubble.style.display = 'none';
}

function renderPinned(msgs) {
  if (!pinnedBanner || !pinnedList) return;
  if (!msgs || !msgs.length) {
    pinnedBanner.style.display = 'none';
    return;
  }
  pinnedBanner.style.display = 'block';
  pinnedList.innerHTML = '';
  msgs.forEach(m => {
    const li = document.createElement('li');
    li.textContent = `${m.user || 'Anon'}: ${m.text || ''}`;
    pinnedList.appendChild(li);
  });
}

function renderPinnedMessage() {
  socket.emit('get pinned', { room: currentRoom });
}

function updateStar(id, starredBy) {
  const msgEl = document.querySelector(`.message[data-id='${id}']`);
  if (!msgEl) return;
  const starBtn = msgEl.querySelector('.star-btn');
  if (starBtn) starBtn.textContent = starredBy.includes(currentUser) ? '⭐' : '☆';
}

function updateReactions(id, reactions) {
  const msgEl = document.querySelector(`.message[data-id='${id}']`);
  if (!msgEl) return;
  const reactionsDiv = msgEl.querySelector('.reactions');
  reactionsDiv.innerHTML = '';
  reactions.forEach(r => {
    const span = document.createElement('span');
    span.textContent = r.emoji;
    reactionsDiv.appendChild(span);
  });
}

// ---------------- Favicon for unread ----------------
const faviconCanvas = document.createElement('canvas');
faviconCanvas.width = 32;
faviconCanvas.height = 32;
const faviconCtx = faviconCanvas.getContext('2d');
let originalFavicon = document.querySelector("link[rel~='icon']") || (() => {
  const l = document.createElement('link'); l.rel='icon'; l.href='/logo.png'; document.head.appendChild(l); return l;
})();

function drawFavicon() {
  const img = new Image();
  img.src = '/logo.png';
  img.onload = () => {
    faviconCtx.clearRect(0,0,32,32);
    faviconCtx.drawImage(img,0,0,32,32);
    if (unreadCount > 0) {
      faviconCtx.fillStyle='red';
      faviconCtx.beginPath();
      faviconCtx.arc(24,8,7,0,2*Math.PI);
      faviconCtx.fill();
      faviconCtx.fillStyle='white';
      faviconCtx.font='10px Arial';
      faviconCtx.textAlign='center';
      faviconCtx.textBaseline='middle';
      faviconCtx.fillText(unreadCount>99?'99+':String(unreadCount),24,8);
    }
    originalFavicon.href=faviconCanvas.toDataURL('image/png');
  };
}
function incrementFavicon(){ unreadCount++; drawFavicon(); }
function resetFavicon(){ unreadCount=0; drawFavicon(); }
window.addEventListener('focus', resetFavicon);

// ---------------- Typing Event ----------------
input?.addEventListener('input', () => {
  if (!socket) return;
  if (input.value.trim()) {
    socket.emit('typing', { user: currentUser, room: currentRoom });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit('stop typing', { user: currentUser, room: currentRoom }), 1500);
  } else socket.emit('stop typing', { user: currentUser, room: currentRoom });
});

// ---------------- Send Message ----------------
form?.addEventListener('submit', e => {
  e.preventDefault();
  if (!input.value.trim()) return;

  const tempId = `temp-${Date.now()}-${Math.floor(Math.random()*1e6)}`;
  const msg = { user: currentUser, room: currentRoom, text: input.value.trim(), time: Date.now(), tempId };
  socket?.emit('chat message', msg);
  displayMessage(msg);
  input.value = '';
});

// ---------------- Emoji Picker ----------------
emojiBtn?.addEventListener('click', () => {
  if (!emojiPicker) return;
  emojiPicker.classList.toggle('show');
  if (emojiPicker.classList.contains('show') && !emojisLoaded) {
    fetch('/emoji.json')
      .then(res => res.json())
      .then(data => {
        emojiData = data;
        emojiPicker.innerHTML = '';
        Object.keys(data).forEach(cat => {
          const catDiv = document.createElement('div');
          catDiv
          catDiv.className = 'emoji-category';
          data[cat].forEach(e => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = e;
            btn.addEventListener('click', () => { input.value += e; input.focus(); });
            catDiv.appendChild(btn);
          });
          emojiPicker.appendChild(catDiv);
        });
        emojisLoaded = true;
      });
  }
});

// Quick emojis
quickEmojis.forEach(btn => btn.addEventListener('click', () => {
  input.value += btn.textContent;
  input.focus();
}));

// Scroll lock toggle
scrollLockBtn?.addEventListener('click', () => {
  autoScrollEnabled = !autoScrollEnabled;
  scrollLockBtn.textContent = autoScrollEnabled ? '🔓 Auto-scroll ON' : '🔒 Auto-scroll OFF';
});
