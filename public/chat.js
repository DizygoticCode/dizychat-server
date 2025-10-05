// public/chat.js — synced & enhanced version

// ================= Part 1: Setup & Utilities =================

// DOM references
const usernamePrompt = document.getElementById('username-prompt');
const joinBtn = document.getElementById('join-btn');
const usernameInput = document.getElementById('username-input');
const roomInput = document.getElementById('room-input');
const roomPasswordInput = document.getElementById('room-password');
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
const quickEmojis = document.querySelectorAll('#quick-emojis button');
const roomListDiv = document.getElementById('room-list');
const searchInput = document.getElementById('searchInput');
const scrollLockBtn = document.getElementById('scrollLockBtn');

// App state
let currentUser = '';
let currentRoom = '';
let roomPassword = '';
let socket = null;
let typingTimeout = null;
let darkMode = false;
let emojiData = {};
const linkPreviewCache = new Map();
let currentPage = 1;
const PAGE_LIMIT = 50;
let isLoadingHistory = false;
let pendingHistoryRequest = false;
let autoScrollEnabled = true;

// Utility to safely escape HTML
function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ---------------- Modal overlay (reusable) ----------------
function showModal({ title = 'Input', placeholder = '', defaultValue = '', onConfirm = null }) {
  if (document.getElementById('app-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'app-modal';
  Object.assign(modal.style, {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.45)',
    zIndex: 9999
  });

  const box = document.createElement('div');
  Object.assign(box.style, {
    minWidth: '320px',
    maxWidth: '92vw',
    background: '#fff',
    borderRadius: '10px',
    padding: '16px',
    boxShadow: '0 8px 30px rgba(0,0,0,0.3)'
  });
  box.innerHTML = `<h3 style="margin:0 0 8px 0">${title}</h3>`;

  const ta = document.createElement('textarea');
  Object.assign(ta.style, {
    width: '100%',
    minHeight: '80px',
    resize: 'vertical',
    fontSize: '14px',
    padding: '8px'
  });
  ta.id = 'modal-input';
  ta.placeholder = placeholder;
  ta.value = defaultValue;
  box.appendChild(ta);

  const actions = document.createElement('div');
  Object.assign(actions.style, {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    marginTop: '12px'
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => modal.remove());

  const okBtn = document.createElement('button');
  okBtn.textContent = 'OK';
  okBtn.style.fontWeight = '600';
  okBtn.addEventListener('click', () => {
    const v = ta.value.trim();
    if (onConfirm) onConfirm(v);
    modal.remove();
  });

  actions.append(cancelBtn, okBtn);
  box.append(actions);
  modal.appendChild(box);
  document.body.appendChild(modal);
  ta.focus();
}

// ================= Part 2: Favicon, debounce, join/init handlers =================

// Favicon badge
let unreadCount = 0;
const faviconCanvas = document.createElement('canvas');
faviconCanvas.width = 32;
faviconCanvas.height = 32;
const faviconCtx = faviconCanvas.getContext('2d');
let originalFavicon = document.querySelector("link[rel~='icon']");
if (!originalFavicon) {
  originalFavicon = document.createElement('link');
  originalFavicon.rel = 'icon';
  originalFavicon.href = '/logo.png';
  document.head.appendChild(originalFavicon);
}
function drawFavicon() {
  const img = new Image();
  img.src = '/logo.png';
  img.onload = () => {
    faviconCtx.clearRect(0, 0, 32, 32);
    faviconCtx.drawImage(img, 0, 0, 32, 32);
    if (unreadCount > 0) {
      faviconCtx.fillStyle = 'red';
      faviconCtx.beginPath();
      faviconCtx.arc(24, 8, 7, 0, 2 * Math.PI);
      faviconCtx.fill();
      faviconCtx.fillStyle = 'white';
      faviconCtx.font = '10px Arial';
      faviconCtx.textAlign = 'center';
      faviconCtx.textBaseline = 'middle';
      const text = unreadCount > 99 ? '99+' : String(unreadCount);
      faviconCtx.fillText(text, 24, 8);
    }
    originalFavicon.href = faviconCanvas.toDataURL('image/png');
  };
}
function incrementFavicon() { unreadCount++; drawFavicon(); }
function resetFavicon() { unreadCount = 0; drawFavicon(); }
window.addEventListener('focus', resetFavicon);

function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

// Pre-fill room
const urlParams = new URLSearchParams(window.location.search);
const prefillRoom = urlParams.get('room') || '';
if (prefillRoom && roomInput) roomInput.value = prefillRoom;

// Dark mode auto-detect
if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
  darkMode = true;
  document.body.classList.add('dark');
  toggleThemeBtn && (toggleThemeBtn.textContent = '☀️');
  homeLogo && (homeLogo.src = '/logo.png');
}

// Session handling
if (!localStorage.getItem('sessionToken')) {
  usernamePrompt && (usernamePrompt.style.display = 'flex');
} else {
  currentUser = localStorage.getItem('username') || 'Guest';
  currentRoom = prefillRoom || 'General';
  usernamePrompt && (usernamePrompt.style.display = 'none');
  chatContainer && (chatContainer.style.display = 'flex');
  roomNameSpan && (roomNameSpan.textContent = currentRoom);
  initChat();
}

// Join button
joinBtn?.addEventListener('click', () => {
  const username = usernameInput?.value.trim();
  const room = roomInput?.value.trim();
  const pwd = roomPasswordInput?.value.trim();
  if (!username || !room) return alert('Please enter both username and room name.');

  currentUser = username;
  currentRoom = room;
  roomPassword = pwd;
  localStorage.setItem('sessionToken', Date.now());
  localStorage.setItem('username', username);
  usernamePrompt.style.display = 'none';
  chatContainer.style.display = 'flex';
  roomNameSpan.textContent = room;
  window.history.replaceState({}, '', `${window.location.origin}?room=${encodeURIComponent(room)}`);
  saveRecentRoom(room);
  loadRecentRooms();
  initChat();
});

// Scroll-lock toggle
if (scrollLockBtn) {
  const updateScrollLockUI = () => {
    scrollLockBtn.textContent = autoScrollEnabled ? '🔓 Auto-scroll ON' : '🔒 Auto-scroll OFF';
  };
  updateScrollLockUI();
  scrollLockBtn.addEventListener('click', () => {
    autoScrollEnabled = !autoScrollEnabled;
    updateScrollLockUI();
  });
}

// ================= Part 3: Socket.IO + Message Handling =================

function initChat() {
  socket = io();

  socket.on('connect', () => {
    console.log('Connected');
    socket.emit('join room', { room: currentRoom, password: roomPassword });
    loadRecentRooms();
    socket.emit('get pinned', { room: currentRoom });
  });

  socket.on('disconnect', () => console.log('Disconnected from server'));

  socket.on('chat message', displayMessage);

  socket.on('typing', (typingUsers) => {
    if (!Array.isArray(typingUsers)) return;
    const others = typingUsers.filter(u => u && u !== currentUser);
    others.length > 0 ? showTyping(others) : hideTyping();
  });

  socket.on('pinned messages', renderPinned);

  // Star / unstar
  socket.on('message starred', ({ id, starredBy }) => {
    const msgEl = document.querySelector(`.message[data-id='${id}']`);
    if (!msgEl) return;
    const starBtn = msgEl.querySelector('.star-btn');
    if (starBtn) starBtn.textContent = starredBy.includes(currentUser) ? '⭐' : '☆';
  });

  socket.on('message unstarred', ({ id, starredBy }) => {
    const msgEl = document.querySelector(`.message[data-id='${id}']`);
    if (!msgEl) return;
    const starBtn = msgEl.querySelector('.star-btn');
    if (starBtn) starBtn.textContent = starredBy.includes(currentUser) ? '⭐' : '☆';
  });

  // Pin / unpin
  socket.on('message pinned', (msg) => renderPinnedMessage(msg));
  socket.on('message unpinned', (msg) => renderPinnedMessage(msg));

  // Reactions
  socket.on('update reactions', ({ id, reactions }) => {
    const msgEl = document.querySelector(`.message[data-id='${id}']`);
    if (!msgEl) return;
    const reactionsDiv = msgEl.querySelector('.reactions');
    if (!reactionsDiv) return;
    reactionsDiv.innerHTML = '';
    reactions.forEach(r => {
      const span = document.createElement('span');
      span.textContent = r.emoji;
      reactionsDiv.appendChild(span);
    });
  });
}

// Typing indicator
function showTyping(users) {
  typingBubble.style.display = 'block';
  typingBubble.textContent = `${users.join(', ')} typing...`;
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(hideTyping, 2000);
}
function hideTyping() { typingBubble.style.display = 'none'; }

// ================= Part 4: Message Rendering =================

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
  meta.textContent = `${msg.user || 'Anonymous'} • ${t.toLocaleTimeString()}`;
  div.appendChild(meta);

  const text = document.createElement('div');
  text.className = 'text';
  text.textContent = msg.text || '';
  div.appendChild(text);

  // Reactions container
  const reactionsDiv = document.createElement('div');
  reactionsDiv.className = 'reactions';
  if (msg.reactions && msg.reactions.length > 0) {
    msg.reactions.forEach(r => {
      const span = document.createElement('span');
      span.textContent = r.emoji;
      reactionsDiv.appendChild(span);
    });
  }
  div.appendChild(reactionsDiv);

  // Star button
  const starBtn = document.createElement('button');
  starBtn.className = 'star-btn';
  starBtn.textContent = (msg.starredBy && msg.starredBy.includes(currentUser)) ? '⭐' : '☆';
  starBtn.addEventListener('click', () => {
    if (starBtn.textContent === '⭐') {
      socket.emit('unstar message', { room: currentRoom, id, user: currentUser });
    } else {
      socket.emit('star message', { room: currentRoom, id, user: currentUser });
    }
  });
  div.appendChild(starBtn);

  // Pin button (for self)
  if (msg.user === currentUser) {
    const pinBtn = document.createElement('button');
    pinBtn.className = 'pin-btn';
    pinBtn.textContent = msg.pinned ? '📌' : '📍';
    pinBtn.addEventListener('click', () => {
      if (msg.pinned) socket.emit('unpin message', { room: currentRoom, id });
      else socket.emit('pin message', { room: currentRoom, id });
    });
    div.appendChild(pinBtn);
  }

  prepend ? messages.prepend(div) : appendMessage(div);

  if (msg.user !== currentUser && socket) {
    socket.emit('read message', { room: currentRoom, id });
    if (document.hidden) incrementFavicon();
  }
}

function appendMessage(div) {
  messages.appendChild(div);
  const atBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 10;
  if (autoScrollEnabled || atBottom) div.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

messages?.addEventListener('scroll', () => {
  const atBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 10;
  autoScrollEnabled = atBottom;
});

// ================= Part 5: Pinned Messages =================

function renderPinned(msgs) {
  const banner = document.getElementById('pinned-messages');
  const list = document.getElementById('pinned-list');
  if (!banner || !list) return;
  if (!msgs || msgs.length === 0) {
    banner.style.display = 'none';
    return;
  }
  banner.style.display = 'block';
  list.innerHTML = '';
  msgs.forEach(m => {
    const li = document.createElement('li');
    li.textContent = `${m.user || 'Anon'}: ${m.text || ''}`;
    list.appendChild(li);
  });
}

function renderPinnedMessage(msg) {
  // refresh pinned messages list
  socket.emit('get pinned', { room: currentRoom });
}

// ================= Part 6: Form, Emoji, Typing =================

form?.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!input.value.trim()) return;

  const tempId = `temp-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const msg = { user: currentUser, room: currentRoom, text: input.value.trim(), time: Date.now(), tempId };
  socket?.emit('chat message', msg);
  displayMessage(msg);
  input.value = '';
  stopTyping();
});

// Typing events
input?.addEventListener('input', () => {
  if (!socket) return;
  if (input.value.trim()) {
    socket.emit('typing', { user: currentUser, room: currentRoom });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(stopTyping, 1500);
  } else stopTyping();
});
function stopTyping() { socket?.emit('stop typing', { user: currentUser, room: currentRoom }); }

// Emoji picker toggle
emojiBtn?.addEventListener('click', () => {
  if (!emojiPicker) return;
  emojiPicker.classList.toggle('show');
  if (emojiPicker.classList.contains('show')) populateEmojiPicker();
});

// Populate emoji picker
function populateEmojiPicker() {
  if (!emojiPicker || emojiPicker.innerHTML.trim() !== '') return;
  fetch('/emoji.json')
    .then(res => res.json())
    .then(data => {
      emojiPicker.innerHTML = '';
      for (const category in data) {
        const catDiv = document.createElement('div');
        catDiv.className = 'emoji-category';
        data[category].forEach(emoji => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = emoji;
          btn.addEventListener('click', () => {
            input.value += emoji;
            input.focus();
          });
          catDiv.appendChild(btn);
        });
        emojiPicker.appendChild(catDiv);
      }
    })
    .catch(err => console.error('Failed to load emoji.json', err));
}

// Quick emojis
quickEmojis.forEach(btn => {
  btn.addEventListener('click', () => {
    input.value += btn.textContent;
    input.focus();
    btn.classList.add('pop');
    setTimeout(() => btn.classList.remove('pop'), 180);
  });
});

// Theme toggle
toggleThemeBtn?.addEventListener('click', () => document.body.classList.toggle('dark'));

// Search messages
searchInput?.addEventListener('input', debounce(() => {
  const term = searchInput.value.trim().toLowerCase();
  document.querySelectorAll('.message .text').forEach(el => {
    const parent = el.closest('.message');
    if (!parent) return;
    parent.style.display = !term || el.textContent.toLowerCase().includes(term) ? '' : 'none';
  });
}, 150));

// ================= Part 7: Helpers, Modal, Storage =================

document.addEventListener('visibilitychange', () => { if (!document.hidden) resetFavicon(); });

function saveRecentRoom(room) {
  let recent = JSON.parse(localStorage.getItem('recentRooms') || '[]');
  if (!recent.includes(room)) {
    recent.push(room);
    if (recent.length > 5) recent.shift();
    localStorage.setItem('recentRooms', JSON.stringify(recent));
  }
}
function loadRecentRooms() {
  let recent = JSON.parse(localStorage.getItem('recentRooms') || '[]');
  const list = document.getElementById('room-list');
  if (!list) return;
  list.innerHTML = '';
  recent.forEach(r => {
    const btn = document.createElement('button');
    btn.textContent = r;
    btn.addEventListener('click', () => { roomInput.value = r; });
    list.appendChild(btn);
  });
}

drawFavicon();
window._dizy = { displayMessage, initChat, socket: () => socket };
