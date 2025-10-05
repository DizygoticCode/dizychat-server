<<<<<<< HEAD
// ==============================
// DizyChat — Full Chat JS
// ==============================

// ---------------- DOM References ----------------
=======
// ================= Part 1: Setup & Utilities =================

// DOM references
>>>>>>> parent of 9d274fa (chat fix and update)
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
<<<<<<< HEAD
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

  usernamePrompt.style.display = 'none';
  chatContainer.style.display = 'flex';
  roomNameSpan.textContent = currentRoom;

  displayMessage({ user: 'System', text: `Welcome to ${currentRoom}, ${currentUser}!`, time: Date.now() });

  window.history.replaceState({}, '', `${window.location.origin}?room=${encodeURIComponent(currentRoom)}`);

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

  socket.on('typing', typingUsers => {
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

  socket.on('room history', msgs => msgs.forEach(m => displayMessage(m)));
  socket.on('search results', msgs => msgs.forEach(m => displayMessage(m)));
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
  if (msg.reactions?.length) msg.reactions.forEach(r => {
    const span = document.createElement('span');
    span.textContent = r.emoji;
    reactionsDiv.appendChild(span);
  });
  div.appendChild(reactionsDiv);

  // Star button
  if (msg.user !== currentUser) {
    const starBtn = document.createElement('button');
    starBtn.className = 'star-btn';
    starBtn.textContent = (msg.starredBy?.includes(currentUser)) ? '⭐' : '☆';
    starBtn.dataset.tooltip = 'Star this message';
    starBtn.addEventListener('click', () => {
      const action = starBtn.textContent === '⭐' ? 'unstar message' : 'star message';
      socket.emit(action, { room: currentRoom, id, user: currentUser });
    });
    div.appendChild(starBtn);
  }

  // Pin button
  const pinBtn = document.createElement('button');
  pinBtn.className = 'pin-btn';
  pinBtn.textContent = msg.pinned ? '📌' : '📍';
  pinBtn.dataset.tooltip = msg.pinned ? 'Unpin message' : 'Pin message';
  pinBtn.addEventListener('click', () => {
    const action = msg.pinned ? 'unpin message' : 'pin message';
    socket.emit(action, { room: currentRoom, id });
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

function hideTyping() { typingBubble.style.display = 'none'; }

function renderPinned(msgs) {
  if (!pinnedBanner || !pinnedList) return;
  if (!msgs?.length) { pinnedBanner.style.display = 'none'; return; }
  pinnedBanner.style.display = 'block';
  pinnedList.innerHTML = '';
  msgs.forEach(m => {
    const li = document.createElement('li');
    li.textContent = `${m.user || 'Anon'}: ${m.text || ''}`;
    pinnedList.appendChild(li);
  });
}

function renderPinnedMessage() { socket.emit('get pinned', { room: currentRoom }); }

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
=======
let darkMode = false;
let emojiData = {};
const linkPreviewCache = new Map();
let currentPage = 1;
const PAGE_LIMIT = 50;
let isLoadingHistory = false;
let pendingHistoryRequest = false;
let scrollLocked = false;

// ---------------- Modal overlay (re-usable) ----------------
function showModal({ title = 'Input', placeholder = '', defaultValue = '', onConfirm = null }) {
  if (document.getElementById('app-modal')) return;

  const modal = document.createElement('div');
  modal.id = 'app-modal';
  modal.style.position = 'fixed';
  modal.style.inset = '0';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.style.background = 'rgba(0,0,0,0.45)';
  modal.style.zIndex = '9999';

  const box = document.createElement('div');
  box.style.minWidth = '320px';
  box.style.maxWidth = '92vw';
  box.style.background = '#fff';
  box.style.borderRadius = '10px';
  box.style.padding = '16px';
  box.style.boxShadow = '0 8px 30px rgba(0,0,0,0.3)';
  box.innerHTML = `<h3 style="margin:0 0 8px 0">${title}</h3>`;

  const ta = document.createElement('textarea');
  ta.id = 'modal-input';
  ta.placeholder = placeholder;
  ta.value = defaultValue;
  ta.style.width = '100%';
  ta.style.minHeight = '80px';
  ta.style.resize = 'vertical';
  ta.style.fontSize = '14px';
  ta.style.padding = '8px';
  box.appendChild(ta);

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.justifyContent = 'flex-end';
  actions.style.gap = '8px';
  actions.style.marginTop = '12px';

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

  actions.appendChild(cancelBtn);
  actions.appendChild(okBtn);
  box.appendChild(actions);
  modal.appendChild(box);
  document.body.appendChild(modal);
  ta.focus();
}

// ================= Part 2: Favicon, debounce, join/init handlers =================

// Favicon badge (simple)
let unreadCount = 0;
let originalFavicon = document.querySelector("link[rel~='icon']");
if (!originalFavicon) {
  originalFavicon = document.createElement('link');
  originalFavicon.rel = 'icon';
  originalFavicon.href = '/logo.png';
  document.head.appendChild(originalFavicon);
}
const faviconCanvas = document.createElement('canvas');
faviconCanvas.width = 32; 
faviconCanvas.height = 32;
const faviconCtx = faviconCanvas.getContext('2d');

function updateFaviconBadge(count) {
>>>>>>> parent of 9d274fa (chat fix and update)
  const img = new Image();
  img.src = '/logo.png';
  img.onload = () => {
    faviconCtx.clearRect(0, 0, 32, 32);
    faviconCtx.drawImage(img, 0, 0, 32, 32);
    if (count > 0) {
      faviconCtx.fillStyle = '#d32f2f';
      faviconCtx.beginPath();
      faviconCtx.arc(24, 8, 8, 0, Math.PI * 2);
      faviconCtx.fill();
      faviconCtx.fillStyle = '#fff';
      faviconCtx.font = 'bold 10px sans-serif';
      faviconCtx.textAlign = 'center';
      faviconCtx.textBaseline = 'middle';
<<<<<<< HEAD
      faviconCtx.fillText(unreadCount > 99 ? '99+' : String(unreadCount), 24, 8);
=======
      const text = count > 99 ? '99+' : String(count);
      faviconCtx.fillText(text, 24, 8);
>>>>>>> parent of 9d274fa (chat fix and update)
    }
    originalFavicon.href = faviconCanvas.toDataURL('image/png');
  };
}
function incrementFavicon() { unreadCount++; updateFaviconBadge(unreadCount); }
function resetFavicon() { unreadCount = 0; updateFaviconBadge(unreadCount); }
window.addEventListener('focus', resetFavicon);

<<<<<<< HEAD
// ---------------- Typing / Send ----------------
input?.addEventListener('input', () => {
  if (!socket) return;
=======
// Utility: debounce
function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

// ---------------- Join + init handlers ----------------
const urlParams = new URLSearchParams(window.location.search);
const prefillRoom = urlParams.get('room') || '';
if (prefillRoom) roomInput.value = prefillRoom;

// Dark mode auto-detect
if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
  darkMode = true;
  document.body.classList.add('dark');
  toggleThemeBtn.textContent = '☀️';
  if (homeLogo) homeLogo.src = '/logo.png';
}

// Session handling
if (!localStorage.getItem('sessionToken')) {
  usernamePrompt.style.display = 'flex';
} else {
  currentUser = localStorage.getItem('username') || 'Guest';
  currentRoom = prefillRoom || 'General';
  usernamePrompt.style.display = 'none';
  chatContainer.style.display = 'flex';
  roomNameSpan.textContent = currentRoom;
  initChat();
}

// join button
joinBtn.addEventListener('click', () => {
  const username = usernameInput.value.trim();
  const room = roomInput.value.trim();
  const pwd = roomPasswordInput.value.trim();
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

// Scroll-lock toggle (button can show state)
if (scrollLockBtn) {
  scrollLockBtn.style.display = 'inline-block';
  const updateScrollLockUI = () => {
    scrollLockBtn.textContent = scrollLocked ? '🔒 Auto-scroll OFF' : '🔓 Auto-scroll ON';
  };
  updateScrollLockUI();
  scrollLockBtn.addEventListener('click', () => {
    scrollLocked = !scrollLocked;
    updateScrollLockUI();
  });
}

// Search input visibility: hide on landing, show in chat header
if (searchInput) searchInput.style.display = 'inline-block';

// ================= Part 2: Socket.IO + Message Handling =================

function initChat() {
  socket = io({
    query: { room: currentRoom, username: currentUser, password: roomPassword }
  });

  // --- socket events ---
  socket.on('connect', () => {
    console.log('Connected to server');
    loadRecentRooms();
  });

  socket.on('disconnect', () => {
    console.log('Disconnected from server');
  });

  socket.on('chat message', (msg) => {
    displayMessage(msg);
    if (document.hidden) incrementFavicon();
  });

  socket.on('typing', (data) => {
    if (data.room === currentRoom && data.user !== currentUser) {
      showTyping();
    }
  });

  socket.on('stop typing', (data) => {
    if (data.room === currentRoom && data.user !== currentUser) {
      hideTyping();
    }
  });

  socket.on('room users', (users) => {
    console.log('Users in room:', users);
  });

  socket.on('pinned messages', (msgs) => {
    renderPinned(msgs);
  });

  // request initial pinned messages
  socket.emit('get pinned', currentRoom);
}

// Typing indicator
function showTyping() {
  typingBubble.style.display = 'block';
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(hideTyping, 2000);
}
function hideTyping() {
  typingBubble.style.display = 'none';
}

// Message display
function displayMessage(msg, prepend = false) {
  if (!msg) return;
  if (document.querySelector(`.message[data-id='${msg._id || msg.id}']`)) return;

  const div = document.createElement('div');
  div.className = `message ${msg.user === currentUser ? 'self' : 'other'}`;
  div.dataset.id = msg._id || msg.id;

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `${msg.user} • ${new Date(msg.time).toLocaleTimeString()}`;
  div.appendChild(meta);

  const text = document.createElement('div');
  text.className = 'text';
  text.innerHTML = DOMPurify.sanitize(msg.text || '');
  div.appendChild(text);

  if (prepend) {
    messages.prepend(div);
  } else {
    appendMessage(div);
  }

  if (msg.user !== currentUser) {
    socket.emit('read message', { room: currentRoom, id: msg._id || msg.id });
  }
}

// Append message respecting scroll lock
function appendMessage(msgDiv) {
  messages.appendChild(msgDiv);

  const atBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 10;
  if (scrollLocked || atBottom) {
    msgDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }
}

// Listen to scroll for auto-lock toggle
messages.addEventListener('scroll', () => {
  const atBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 10;
  scrollLocked = !atBottom;
});

// Render pinned messages
function renderPinned(msgs) {
  const pinnedBanner = document.getElementById('pinned-messages');
  const pinnedList = document.getElementById('pinned-list');
  if (!msgs || msgs.length === 0) {
    pinnedBanner.style.display = 'none';
    return;
  }
  pinnedBanner.style.display = 'block';
  pinnedList.innerHTML = '';
  msgs.forEach(m => {
    const li = document.createElement('li');
    li.textContent = `${m.user}: ${m.text}`;
    pinnedList.appendChild(li);
  });
}

// ================= Part 3: Form, Emoji Picker, Theme, Search =================

// Send message form
form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!input.value.trim()) return;

  const msg = {
    user: currentUser,
    room: currentRoom,
    text: input.value,
    time: Date.now()
  };

  socket.emit('chat message', msg);
  displayMessage(msg);

  input.value = '';
  stopTyping();
});

// Typing events
input.addEventListener('input', () => {
>>>>>>> parent of 9d274fa (chat fix and update)
  if (input.value.trim()) {
    socket.emit('typing', { room: currentRoom, user: currentUser });
    clearTimeout(typingTimeout);
<<<<<<< HEAD
    typingTimeout = setTimeout(() => socket.emit('stop typing', { user: currentUser, room: currentRoom }), 1500);
  } else socket.emit('stop typing', { user: currentUser, room: currentRoom });
});

form?.addEventListener('submit', e => {
  e.preventDefault();
  if (!input.value.trim()) return;
  const tempId = `temp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const msg = { user: currentUser, room: currentRoom, text: input.value.trim(), time: Date.now(), tempId };
  socket?.emit('chat message', msg);
  displayMessage(msg);
  input.value = '';
});

// ---------------- Emoji Picker ----------------
emojiBtn?.addEventListener('click', () => {
  if (!emojiPicker) return;

  emojiPicker.classList.toggle('show');

  if (emojisLoaded || !emojiPicker.classList.contains('show')) return;

=======
    typingTimeout = setTimeout(stopTyping, 1500);
  } else {
    stopTyping();
  }
});
function stopTyping() {
  socket.emit('stop typing', { room: currentRoom, user: currentUser });
}

// Emoji picker toggle
emojiBtn.addEventListener('click', () => {
  emojiPicker.classList.toggle('show');
  if (emojiPicker.classList.contains('show')) {
    populateEmojiPicker();
  }
});

// Populate emoji picker dynamically
function populateEmojiPicker() {
  if (emojiPicker.innerHTML.trim() !== '') return;
>>>>>>> parent of 9d274fa (chat fix and update)
  fetch('/emoji.json')
    .then(res => res.ok ? res.json() : Promise.reject('Failed to load emoji.json'))
    .then(data => {
      if (!data || typeof data !== 'object') return;
      emojiData = data;
      emojiPicker.innerHTML = '';

      Object.keys(data).forEach(cat => {
        const catDiv = document.createElement('div');
        catDiv.className = 'emoji-category';
        catDiv.dataset.category = cat;

        const catTitle = document.createElement('div');
        catTitle.className = 'emoji-category-title';
        catTitle.textContent = cat;
        catDiv.appendChild(catTitle);

        if (!Array.isArray(data[cat])) return;

        data[cat].forEach(e => {
          const char = e.char || '';
          if (!char) return;

          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = char;
          btn.title = e.name || '';

          btn.addEventListener('click', () => {
            if (!input) return;
            input.value += char;
            input.focus();
          });

          catDiv.appendChild(btn);
        });
<<<<<<< HEAD

        if (catDiv.childNodes.length > 0) emojiPicker.appendChild(catDiv);
      });

      emojisLoaded = true;
    })
    .catch(err => {
      console.warn('Emoji JSON load failed:', err);
      emojiPicker.innerHTML = '<div style="padding:10px;">Failed to load emojis.</div>';
    });
});

// Quick emojis
quickEmojis?.forEach(btn => btn.addEventListener('click', () => {
  if (!input) return;
  input.value += btn.textContent || '';
  input.focus();
}));

// Scroll lock toggle
scrollLockBtn?.addEventListener('click', () => {
  autoScrollEnabled = !autoScrollEnabled;
  scrollLockBtn.textContent = autoScrollEnabled ? '🔓 Auto-scroll ON' : '🔒 Auto-scroll OFF';
});
=======
        emojiPicker.appendChild(catDiv);
      }
    });
}

// Quick emoji buttons
document.querySelectorAll('#quick-emojis button').forEach(btn => {
  btn.addEventListener('click', () => {
    input.value += btn.textContent;
    input.focus();
    btn.classList.add('pop');
    setTimeout(() => btn.classList.remove('pop'), 180);
  });
});

// Theme toggle
toggleThemeBtn.addEventListener('click', () => {
  document.body.classList.toggle('dark');
});

// Search messages
searchBtn.addEventListener('click', () => {
  const term = searchInput.value.toLowerCase();
  document.querySelectorAll('.message .text').forEach(el => {
    const parent = el.closest('.message');
    if (!term || el.textContent.toLowerCase().includes(term)) {
      parent.style.display = '';
    } else {
      parent.style.display = 'none';
    }
  });
});

// Scroll lock button UI
function updateScrollLockUI() {
  if (!scrollLockBtn) return;
  scrollLockBtn.style.display = 'inline-block';
  scrollLockBtn.textContent = scrollLocked ? '🔒 Auto-scroll ON' : '🔓 Auto-scroll OFF';
}
scrollLockBtn.addEventListener('click', () => {
  scrollLocked = !scrollLocked;
  updateScrollLockUI();
});

// ================= Part 4: Helpers, Modal, Storage =================

// ----- Favicon badge -----
const faviconCanvas = document.getElementById('favicon-canvas');
const faviconCtx = faviconCanvas.getContext('2d');
const favicon = document.querySelector("link[rel~='icon']");
let unreadCount = 0;

function resetFavicon() {
  unreadCount = 0;
  drawFavicon();
}
function incrementFavicon() {
  unreadCount++;
  drawFavicon();
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
      faviconCtx.fillText(unreadCount, 24, 8);
    }
    favicon.href = faviconCanvas.toDataURL('image/png');
  };
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) resetFavicon();
});

// ----- Modal controls -----
const modal = document.getElementById('app-modal');
const modalCloseBtn = document.getElementById('modal-close-btn');
if (modalCloseBtn) {
  modalCloseBtn.addEventListener('click', () => {
    modal.style.display = 'none';
  });
}
function openModal(title, contentHtml) {
  const box = document.getElementById('app-modal-box');
  box.querySelector('h3').textContent = title;
  box.querySelector('textarea').value = '';
  if (contentHtml) {
    box.querySelector('textarea').value = contentHtml;
  }
  modal.style.display = 'flex';
}

// ----- Local storage (recent rooms) -----
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
    btn.addEventListener('click', () => {
      roomInput.value = r;
    });
    list.appendChild(btn);
  });
}

>>>>>>> parent of 9d274fa (chat fix and update)
