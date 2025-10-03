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
      const text = count > 99 ? '99+' : String(count);
      faviconCtx.fillText(text, 24, 8);
    }
    originalFavicon.href = faviconCanvas.toDataURL('image/png');
  };
}
function incrementFavicon() { unreadCount++; updateFaviconBadge(unreadCount); }
function resetFavicon() { unreadCount = 0; updateFaviconBadge(unreadCount); }
window.addEventListener('focus', resetFavicon);

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

// ================= Part 3: Socket.IO init & message handling =================

function initChat() {
  if (socket) socket.close?.();
  socket = io(window.location.origin);

  socket.emit('join room', { room: currentRoom, password: roomPassword });

  // Get first page of history
  currentPage = 1;
  fetchHistoryPage(currentPage, true);

  // INPUT typing
  input.addEventListener('input', () => {
    socket.emit('typing', currentUser);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit('stop typing', currentUser), 1000);
  });

  // Submit message
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!input.value.trim()) return;
    const sanitizedText = DOMPurify.sanitize(input.value.trim());
    const msgData = { room: currentRoom, user: currentUser, text: sanitizedText, timestamp: new Date() };
    socket.emit('chat message', msgData);
    input.value = '';
    input.focus();
  });

  // socket events
  socket.on('chat message', msg => {
    displayMessage(msg);
    if (document.hidden && msg.user !== currentUser) incrementFavicon();
  });

  socket.on('room history', msgs => {
    if (!Array.isArray(msgs) || !msgs.length) {
      isLoadingHistory = false;
      pendingHistoryRequest = false;
      return;
    }
    const prevScrollHeight = messages.scrollHeight;
    msgs.reverse().forEach(m => displayMessage(m, true));
    const newScrollHeight = messages.scrollHeight;
    messages.scrollTop = newScrollHeight - prevScrollHeight;
    isLoadingHistory = false;
    pendingHistoryRequest = false;
  });

  socket.on('search results', msgs => {
    messages.innerHTML = '';
    msgs.forEach(m => displayMessage(m));
  });

  socket.on('typing', users => updateTypingIndicator(users));
  socket.on('message status', ({ id, status }) => {
    const s = document.querySelector(`.message[data-id='${id}'] .status`);
    if (s) s.textContent = statusIcon(status);
  });
  socket.on('update reactions', ({ id, reactions }) => updateReactionsUI(id, reactions));
  socket.on('edit message', ({ id, text }) => {
    const ts = document.querySelector(`.message[data-id='${id}'] .msg-text`);
    if (ts) ts.textContent = ` ${DOMPurify.sanitize(text)}`;
  });
  socket.on('delete message', id => {
    const el = document.querySelector(`.message[data-id='${id}']`);
    if (el) el.remove();
  });
  socket.on('message pinned', msg => {
    const el = document.querySelector(`.message[data-id='${msg._id}']`);
    if (el) el.classList.add('pinned');
    addPinnedMessage(msg);
  });
  socket.on('message unpinned', msg => {
    const el = document.querySelector(`.message[data-id='${msg._id}']`);
    if (el) el.classList.remove('pinned');
    removePinnedMessage(msg);
  });
  socket.on('pinned messages', msgs => msgs.forEach(addPinnedMessage));
  socket.on('message starred', ({ id, starredBy }) => {
    const el = document.querySelector(`.message[data-id='${id}']`);
    if (el) {
      const menuBtn = el.querySelector('.menu-btn');
      if (menuBtn) menuBtn.textContent = `⭐(${starredBy.length})`;
    }
  });
  socket.on('message unstarred', ({ id, starredBy }) => {
    const el = document.querySelector(`.message[data-id='${id}']`);
    if (el) {
      const menuBtn = el.querySelector('.menu-btn');
      if (menuBtn) menuBtn.textContent = starredBy.length ? `⭐(${starredBy.length})` : '⋮';
    }
  });

  // request pinned messages
  socket.emit('get pinned', { room: currentRoom });

  // infinite scroll (older messages)
  messages.removeEventListener('scroll', onMessagesScroll);
  messages.addEventListener('scroll', onMessagesScroll);

  // search debounce
  if (searchInput) {
    searchInput.addEventListener('input', debounce(e => {
      const q = e.target.value.trim();
      if (!q || q.length < 2) {
        messages.innerHTML = '';
        currentPage = 1;
        fetchHistoryPage(currentPage, true);
        return;
      }
      socket.emit('search messages', { room: currentRoom, query: q });
    }, 300));
  }
}

// Helper: fetch history page via socket
function fetchHistoryPage(page = 1, replace = false) {
  if (!socket || pendingHistoryRequest) return;
  pendingHistoryRequest = true;
  socket.emit('get history', { room: currentRoom, page, limit: PAGE_LIMIT });
}

// scroll handler
function onMessagesScroll() {
  if (messages.scrollTop < 80 && !isLoadingHistory && !pendingHistoryRequest) {
    isLoadingHistory = true;
    currentPage++;
    fetchHistoryPage(currentPage, false);
  }
}

// ================= Part 4: Rendering messages & UI =================

// Status icon helper
function statusIcon(status) {
  switch (status) {
    case 'sent': return '✓';
    case 'delivered': return '✓✓';
    case 'read': return '✓✓✔';
    default: return '';
  }
}

// Display a message
function displayMessage(msg, prepend = false) {
  if (!msg) return;
  if (document.querySelector(`.message[data-id='${msg._id || msg.id}']`)) return;

  const div = document.createElement('div');
  div.className = `message ${msg.user === currentUser ? 'self' : 'other'}`;
  div.dataset.id = msg._id || msg.id;

  // Meta
  const meta = document.createElement('div');
  meta.className = 'meta';
  try { 
    meta.textContent = `[${new Date(msg.timestamp).toLocaleTimeString()}] ${msg.user}`; 
  } catch(e) { 
    meta.textContent = msg.user; 
  }
  div.appendChild(meta);

  // Text
  if (msg.text) {
    const textSpan = document.createElement('span');
    textSpan.className = 'msg-text';
    textSpan.textContent = ` ${DOMPurify.sanitize(msg.text)}`;
    div.appendChild(textSpan);
  }

  // File attachments
  if (msg.file) {
    const fileDiv = document.createElement('div');
    fileDiv.className = 'file-preview';
    if (msg.file.type?.startsWith('image/')) {
      const img = document.createElement('img');
      img.className = 'inline-image';
      img.src = msg.file.url || msg.file.path || msg.file;
      img.alt = msg.file.name || 'image';
      fileDiv.appendChild(img);
    } else {
      const a = document.createElement('a');
      a.href = msg.file.url || msg.file.path;
      a.target = '_blank';
      a.textContent = msg.file.name || 'download';
      fileDiv.appendChild(a);
    }
    div.appendChild(fileDiv);
  }

  // Status placeholder
  const statusSpan = document.createElement('span');
  statusSpan.className = 'status';
  div.appendChild(statusSpan);

  // Reactions
  addReactionUI(div, msg);

  // Controls if self message
  if (msg.user === currentUser) addMessageControls(div, msg);

  // Link preview
  if (msg.text) handleLinkPreview(div, msg.text);

  // Pinned visual
  if (msg.pinned) div.classList.add('pinned');

  // Insert
  if (prepend) messages.prepend(div);
  else {
    messages.appendChild(div);
    if (!scrollLocked) {
      const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
      if (nearBottom) div.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }

  // Mark as read
  if (msg.user !== currentUser) socket.emit('read message', { room: currentRoom, id: msg._id || msg.id });
}

// ================= Reactions UI =================
function addReactionUI(msgDiv, msg) {
  const container = document.createElement('div');
  container.className = 'reaction-container';

  if (Array.isArray(msg.reactions)) {
    msg.reactions.forEach(r => {
      const span = document.createElement('span');
      span.textContent = r.emoji;
      span.title = r.user;
      container.appendChild(span);
    });
  }

  const reactBtn = document.createElement('button');
  reactBtn.className = 'reaction-toggle';
  reactBtn.textContent = '➕';
  reactBtn.addEventListener('click', ev => {
    ev.stopPropagation();
    const picker = document.createElement('div');
    picker.className = 'reaction-picker overlay';
    const pool = Object.values(emojiData).flat();
    pool.slice(0,30).forEach(item => {
      const ch = item.char || item;
      const b = document.createElement('button');
      b.className = 'reaction-btn';
      b.textContent = ch;
      b.addEventListener('click', () => {
        socket.emit('react message', { room: currentRoom, id: msg._id || msg.id, reaction: ch, username: currentUser });
        picker.remove();
      });
      picker.appendChild(b);
    });
    document.addEventListener('click', function __closePicker(e) {
      if (!picker.contains(e.target)) { picker.remove(); document.removeEventListener('click', __closePicker); }
    });
    container.appendChild(picker);
  });
  container.appendChild(reactBtn);
  msgDiv.appendChild(container);
}

function updateReactionsUI(id, reactions) {
  const container = document.querySelector(`.message[data-id='${id}'] .reaction-container`);
  if (!container) return;
  const toggle = container.querySelector('.reaction-toggle');
  container.innerHTML = '';
  if (Array.isArray(reactions)) {
    reactions.forEach(r => {
      const span = document.createElement('span');
      span.textContent = r.emoji;
      span.title = r.user;
      container.appendChild(span);
    });
  }
  if (toggle) container.appendChild(toggle);
}

// ================= Message controls (edit/delete/pin/star) =================
function addMessageControls(msgDiv, msg) {
  const wrapper = document.createElement('div');
  wrapper.className = 'msg-menu-wrapper';

  const btn = document.createElement('button');
  btn.className = 'menu-btn';
  btn.textContent = '⋮';

  const menu = document.createElement('div');
  menu.className = 'msg-menu';

  // Delete
  const del = document.createElement('button');
  del.textContent = 'Delete';
  del.addEventListener('click', () => {
    if (confirm('Delete this message?')) {
      socket.emit('delete message', { room: currentRoom, id: msg._id || msg.id });
      const el = document.querySelector(`.message[data-id='${msg._id || msg.id}']`);
      if (el) el.remove();
    }
  });
  menu.appendChild(del);

  // Edit
  const edit = document.createElement('button');
  edit.textContent = 'Edit';
  edit.addEventListener('click', () => {
    showModal({
      title: 'Edit message',
      placeholder: 'Edit your message…',
      defaultValue: msg.text || '',
      onConfirm: val => {
        const sanitized = DOMPurify.sanitize(val);
        socket.emit('edit message', { room: currentRoom, id: msg._id || msg.id, text: sanitized });
        const el = document.querySelector(`.message[data-id='${msg._id || msg.id}'] .msg-text`);
        if (el) el.textContent = ` ${sanitized}`;
      }
    });
  });
  menu.appendChild(edit);

  // Pin/unpin
  const pin = document.createElement('button');
  pin.textContent = msg.pinned ? 'Unpin' : 'Pin';
  pin.addEventListener('click', () => {
    socket.emit(msg.pinned ? 'unpin message' : 'pin message', { room: currentRoom, id: msg._id || msg.id });
  });
  menu.appendChild(pin);

  // Star/unstar
  const star = document.createElement('button');
  star.textContent = '⭐';
  star.addEventListener('click', () => {
    const starred = msg.starredBy?.includes(currentUser);
    socket.emit(starred ? 'unstar message' : 'star message', { room: currentRoom, id: msg._id || msg.id, user: currentUser });
  });
  menu.appendChild(star);

  wrapper.appendChild(btn);
  wrapper.appendChild(menu);
  btn.addEventListener('click', e => { e.stopPropagation(); menu.classList.toggle('show'); });

  document.addEventListener('click', e => { if (!wrapper.contains(e.target)) menu.classList.remove('show'); });

  const starredCount = document.createElement('span');
  starredCount.className = 'star-count';
  starredCount.textContent = msg.starredBy?.length ? ` (${msg.starredBy.length})` : '';
  wrapper.appendChild(starredCount);

  msgDiv.appendChild(wrapper);
}

// ================= Part 5 – Link Previews & Typing Indicator Link preview =================

// ================= Link preview =================

async function handleLinkPreview(msgDiv, text) {
  if (!text) return;
  const urlRegex = /(\b(https?:\/\/)?(www\.)?[-a-zA-Z0-9@:%._+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_+.~#?&//=]*))/gi;
  const matches = text.match(urlRegex);
  if (!matches) return;
  const seen = new Set();
  for (const raw of matches) {
    let url = raw;
    if (!/^https?:\/\//i.test(url)) url = url.startsWith('www.') ? 'https://' + url : 'https://' + url;
    if (seen.has(url)) continue;
    seen.add(url);

    if (linkPreviewCache.has(url)) { 
      renderPreview(msgDiv, url, linkPreviewCache.get(url), raw); 
      continue; 
    }

    try {
      const res = await fetch(`/link-preview?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      linkPreviewCache.set(url, data);
      renderPreview(msgDiv, url, data, raw);
    } catch(err) { 
      console.warn('preview fetch failed', err); 
    }
  }
}

function renderPreview(msgDiv, url, data, rawUrl) {
  if (!data || (!data.title && !data.image)) return;
  const textSpan = msgDiv.querySelector('.msg-text');
  if (textSpan) textSpan.textContent = textSpan.textContent.replace(rawUrl, '').trim();
  const preview = document.createElement('div');
  preview.className = 'link-preview';
  if (data.image) {
    const img = document.createElement('img');
    img.src = data.image;
    img.alt = data.title || url;
    preview.appendChild(img);
  }
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.textContent = data.title || url;
  preview.appendChild(a);
  msgDiv.appendChild(preview);
}

// ================= Typing indicator =================
function updateTypingIndicator(users) {
  const others = (users || []).filter(u => u !== currentUser);
  if (others.length) {
    typingBubble.style.display = 'flex';
    typingBubble.innerHTML = `${others.join(', ')} <span class="dots">...</span>`;
  } else typingBubble.style.display = 'none';
}

// Animate dots in typing indicator
setInterval(() => {
  const dots = document.querySelector('#typing-bubble .dots');
  if (dots) dots.textContent = dots.textContent.length < 3 ? dots.textContent + '.' : '.';
}, 500);

// ================= Part 6: File uploads =================
const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.style.display = 'none';
form.appendChild(fileInput);

const attachBtn = document.createElement('button');
attachBtn.type = 'button';
attachBtn.textContent = '📎';
attachBtn.title = 'Attach file';
form.insertBefore(attachBtn, input);

attachBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  if (!fileInput.files.length) return;
  await sendFile(fileInput.files[0]);
  fileInput.value = '';
});

chatContainer.addEventListener('dragover', e => e.preventDefault());
chatContainer.addEventListener('drop', e => {
  e.preventDefault();
  if (!e.dataTransfer.files.length) return;
  sendFile(e.dataTransfer.files[0]);
});

async function sendFile(file) {
  const allowed = ['image/jpeg','image/png','image/gif','application/pdf','text/plain'];
  if (!allowed.includes(file.type)) { alert('Unsupported file type.'); return; }

  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await fetch('/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (!data.url) throw new Error('upload failed');

    const msg = {
      room: currentRoom,
      user: currentUser,
      text: file.type.startsWith('image/') ? '' : DOMPurify.sanitize(file.name),
      file: { url: data.url, name: data.name, type: data.type, size: data.size },
      timestamp: new Date()
    };
    socket.emit('chat message', msg);
  } catch (err) {
    console.error('upload error', err);
    alert('Upload failed');
  }
}

// ================= Emoji picker =================
const fallbackEmojis = {
  "Faces": ["😀","😁","😂","🤣","😃","😅","😊","😇"],
  "Gestures": ["👍","👎","👏","🙌","🤝"],
  "Hearts": ["❤️","💛","💚","💙","💜"]
};

async function loadEmojis() {
  try {
    const res = await fetch('/emoji.json');
    emojiData = await res.json();
  } catch (err) { 
    emojiData = fallbackEmojis; 
  }
  renderEmojiPicker();
}

function renderEmojiPicker() {
  emojiPicker.innerHTML = '';
  Object.entries(emojiData).forEach(([cat, arr]) => {
    const catWrap = document.createElement('div');
    catWrap.className = 'emoji-category';
    arr.forEach(item => {
      const ch = item.char || item;
      const span = document.createElement('span');
      span.textContent = ch;
      span.title = item.name || '';
      span.addEventListener('click', () => { input.value += ch; input.focus(); });
      catWrap.appendChild(span);
    });
    emojiPicker.appendChild(catWrap);
  });
}

emojiBtn.addEventListener('click', () => emojiPicker.classList.toggle('show'));
loadEmojis();

// ================= Quick emojis =================
quickEmojis.forEach(b => {
  b.addEventListener('click', () => {
    input.value += b.textContent;
    input.focus();
    b.classList.add('pop');
    setTimeout(() => b.classList.remove('pop'), 180);
  });
});

// ================= Recent Rooms =================
function saveRecentRoom(room) {
  try {
    const arr = JSON.parse(localStorage.getItem('recentRooms') || '[]');
    if (!arr.includes(room)) arr.unshift(room);
    while (arr.length > 6) arr.pop();
    localStorage.setItem('recentRooms', JSON.stringify(arr));
  } catch (e) { }
}

function loadRecentRooms() {
  try {
    roomListDiv.innerHTML = '';
    const arr = JSON.parse(localStorage.getItem('recentRooms') || '[]');
    arr.forEach(r => {
      const btn = document.createElement('button');
      btn.className = 'room-btn';
      btn.textContent = r;
      btn.addEventListener('click', () => { roomInput.value = r; joinBtn.click(); });
      roomListDiv.appendChild(btn);
    });
  } catch (e) {}
}

loadRecentRooms();

// ================= Part 7: Pinned banner =================
function addPinnedMessage(msg) {
  const banner = document.getElementById('pinned-messages');
  const list = document.getElementById('pinned-list');
  if (!banner || !list) return;
  banner.style.display = 'block';
  if (document.querySelector(`#pinned-list li[data-id="${msg._id}"]`)) return;

  const li = document.createElement('li');
  li.dataset.id = msg._id;
  li.textContent = `${msg.user}: ${String(msg.text || '').slice(0,60)}${(msg.text||'').length>60?'…':''}`;
  li.addEventListener('click', () => {
    const origin = document.querySelector(`.message[data-id="${msg._id}"]`);
    if (origin) { 
      origin.scrollIntoView({behavior:'smooth',block:'center'}); 
      origin.classList.add('highlight'); 
      setTimeout(()=>origin.classList.remove('highlight'),1500); 
    }
  });
  list.appendChild(li);
}

function removePinnedMessage(msg) {
  const el = document.querySelector(`#pinned-list li[data-id="${msg._id}"]`);
  if (el) el.remove();
  const list = document.getElementById('pinned-list');
  if (list && !list.children.length) {
    const b = document.getElementById('pinned-messages');
    if (b) b.style.display = 'none';
  }
}

// ================= Home logo click =================
if (homeLogo) {
  homeLogo.addEventListener('click', () => {
    chatContainer.style.display = 'none';
    usernamePrompt.style.display = 'flex';
    roomNameSpan.textContent = 'Room';
    messages.innerHTML = '';
    window.history.replaceState({}, '', window.location.origin);
  });
}

// ================= Cleanup on unload =================
window.addEventListener('beforeunload', () => {
  try { socket?.disconnect?.(); } catch(e) {}
});
