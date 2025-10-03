// ================= Part 1: Setup & DOM Elements =================

// ---------------- DOM Elements ----------------
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
const searchInput = document.getElementById('search-input');

// ---------------- App State ----------------
let currentUser = '';
let currentRoom = '';
let roomPassword = '';
let socket;
let typingTimeout;
let darkMode = false;
let emojiData = {};
const linkPreviewCache = new Map();
let currentPage = 1;
const PAGE_LIMIT = 50;
let isLoadingHistory = false;

// ---------------- Favicon Badge ----------------
let unreadCount = 0;
let originalFavicon = document.querySelector("link[rel~='icon']");
if(!originalFavicon){
  originalFavicon = document.createElement('link');
  originalFavicon.rel = 'icon';
  originalFavicon.href = '/logo.png';
  document.head.appendChild(originalFavicon);
}
let faviconCanvas = document.createElement('canvas');
faviconCanvas.width = 32;
faviconCanvas.height = 32;
let faviconCtx = faviconCanvas.getContext('2d');

function updateFaviconBadge(count){
  const img = new Image();
  img.src = '/logo.png';
  img.onload = () => {
    faviconCtx.clearRect(0,0,32,32);
    faviconCtx.drawImage(img,0,0,32,32);
    if(count > 0){
      faviconCtx.fillStyle = 'red';
      faviconCtx.beginPath();
      faviconCtx.arc(24,8,8,0,2*Math.PI);
      faviconCtx.fill();
      faviconCtx.fillStyle = 'white';
      faviconCtx.font = 'bold 10px sans-serif';
      faviconCtx.textAlign = 'center';
      faviconCtx.textBaseline = 'middle';
      faviconCtx.fillText(count > 99 ? '99+' : count, 24, 8);
    }
    originalFavicon.href = faviconCanvas.toDataURL('image/png');
  };
}
function incrementFavicon(){ unreadCount++; updateFaviconBadge(unreadCount); }
function resetFavicon(){ unreadCount = 0; updateFaviconBadge(unreadCount); }
window.addEventListener('focus', () => resetFavicon());

// ---------------- Landing Page Prefill ----------------
const urlParams = new URLSearchParams(window.location.search);
const prefillRoom = urlParams.get("room");
if (prefillRoom) roomInput.value = prefillRoom;

// ---------------- Dark Mode Auto-Detect ----------------
if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
  darkMode = true;
  document.body.classList.add('dark');
  toggleThemeBtn.textContent = "☀️";
  homeLogo.src = "/logo.png";
}

// ---------------- Modal Overlay System ----------------
function showModal(message, withInput=false, callback=null) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const box = document.createElement('div');
  box.className = 'modal-box';

  const msg = document.createElement('p');
  msg.textContent = message;
  box.appendChild(msg);

  let inputField = null;
  if(withInput){
    inputField = document.createElement('input');
    inputField.type = 'text';
    inputField.className = 'modal-input';
    box.appendChild(inputField);
  }

  const btnRow = document.createElement('div');
  btnRow.className = 'modal-buttons';

  const ok = document.createElement('button');
  ok.textContent = "OK";
  ok.className = 'modal-ok';
  ok.addEventListener('click', () => {
    document.body.removeChild(overlay);
    if(callback){
      if(withInput) callback(inputField.value.trim());
      else callback();
    }
  });
  btnRow.appendChild(ok);

  if(withInput){
    const cancel = document.createElement('button');
    cancel.textContent = "Cancel";
    cancel.className = 'modal-cancel';
    cancel.addEventListener('click', () => {
      document.body.removeChild(overlay);
    });
    btnRow.appendChild(cancel);
  }

  box.appendChild(btnRow);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  if(withInput) inputField.focus();
}

// ---------------- Session Check ----------------
if (!localStorage.getItem('sessionToken')) {
  usernamePrompt.style.display = 'flex';
} else {
  currentUser = localStorage.getItem('username') || 'Guest';
  currentRoom = prefillRoom || 'General';
  initChat();
}

// ---------------- Join Chat ----------------
joinBtn.addEventListener("click", () => {
  const username = usernameInput.value.trim();
  const room = roomInput.value.trim();
  const password = roomPasswordInput.value.trim();
  if (!username || !room) return showModal("Please enter both username and room name.");

  currentUser = username;
  currentRoom = room;
  roomPassword = password;

  localStorage.setItem('sessionToken', Date.now());
  localStorage.setItem('username', username);

  usernamePrompt.style.display = "none";
  chatContainer.style.display = "flex";
  roomNameSpan.textContent = room;

  window.history.replaceState({}, "", `${window.location.origin}?room=${encodeURIComponent(room)}`);

  saveRecentRoom(room);
  loadRecentRooms();

  initChat();
});
// ================= Part 2: Socket.IO & Messaging =================

function initChat() {
  socket = io(window.location.origin);
  socket.emit("join room", { room: currentRoom, password: roomPassword });

  // Request first page of history
  currentPage = 1;
  socket.emit("get history", { room: currentRoom, page: currentPage, limit: PAGE_LIMIT });

  // ---------------- Input Events ----------------
  input.addEventListener("input", () => {
    if (!socket) return;
    socket.emit("typing", currentUser);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit("stop typing", currentUser), 1000);
  });

  form.addEventListener("submit", e => {
    e.preventDefault();
    if (!input.value.trim()) return;
    const sanitizedText = DOMPurify.sanitize(input.value.trim());
    const msgData = { room: currentRoom, user: currentUser, text: sanitizedText, timestamp: new Date() };
    socket.emit('chat message', msgData);
    input.value = '';
    input.focus();
  });

  // ---------------- Socket Event Listeners ----------------
  socket.on('chat message', msg => {
    displayMessage(msg);
    if (document.hidden && msg.user !== currentUser) incrementFavicon();
  });

  // FIXED room_history: preserve scrollTop properly when prepending older messages
  socket.on('room history', msgs => {
    if (!Array.isArray(msgs) || !msgs.length) { isLoadingHistory = false; return; }

    // Save current scroll state
    const prevScrollTop = messages.scrollTop;
    const prevScrollHeight = messages.scrollHeight;

    // Insert older messages at top (msgs already oldest->newest? server sends page in correct order)
    // We reverse to ensure older-first insertion if needed
    msgs.reverse().forEach(msg => displayMessage(msg, true));

    // Restore scroll so the viewport stays at the same message
    // NewScrollTop = newScrollHeight - prevScrollHeight + prevScrollTop
    const delta = messages.scrollHeight - prevScrollHeight;
    messages.scrollTop = prevScrollTop + delta;

    isLoadingHistory = false;
  });

  socket.on('search results', msgs => {
    messages.innerHTML = '';
    msgs.forEach(msg => displayMessage(msg));
  });

  socket.on('typing', users => updateTypingIndicator(users));

  socket.on('message status', ({ id, status }) => {
    const statusSpan = document.querySelector(`.message[data-id='${id}'] .status`);
    if (statusSpan) statusSpan.textContent = statusIcon(status);
  });

  socket.on('update reactions', ({ id, reactions }) => updateReactionsUI(id, reactions));

  socket.on('join error', msg => showModal(String(msg)));

  socket.on('delete message', id => {
    const div = document.querySelector(`.message[data-id='${id}']`);
    if (div) div.remove();
  });

  // Use modal for editing messages (get new text via modal)
  socket.on('edit message', ({ id, text }) => {
    const textSpan = document.querySelector(`.message[data-id='${id}'] .msg-text`);
    if (textSpan) textSpan.textContent = ` ${DOMPurify.sanitize(text)}`;
  });

  // ---------------- Infinite Scroll for Older Messages (client guard) ----------------
  // guard flag handles in-flight requests (isLoadingHistory)
  messages.addEventListener('scroll', () => {
    // don't request history if already loading or scrolled down
    if (messages.scrollTop < 50 && !isLoadingHistory) {
      isLoadingHistory = true;
      currentPage++;
      socket.emit("get history", { room: currentRoom, page: currentPage, limit: PAGE_LIMIT });
    }
  });

  // ---------------- File & Image Upload ----------------
  // file input/button are created once in initChat to ensure socket exists
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.multiple = false;
  fileInput.style.display = 'none';
  form.appendChild(fileInput);

  const uploadBtn = document.createElement('button');
  uploadBtn.type = 'button';
  uploadBtn.textContent = '📎';
  uploadBtn.title = 'Attach file';
  uploadBtn.classList.add('attach-btn');
  form.insertBefore(uploadBtn, input);

  uploadBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    if (!fileInput.files.length) return;
    const file = fileInput.files[0];
    await sendFile(file);
    fileInput.value = '';
  });

  // Drag-and-drop support
  chatContainer.addEventListener('dragover', e => e.preventDefault());
  chatContainer.addEventListener('drop', e => {
    e.preventDefault();
    if (!e.dataTransfer.files.length) return;
    sendFile(e.dataTransfer.files[0]);
  });

  // After joining, request pinned messages
  socket.emit('get pinned', { room: currentRoom });
}

// ---------------- Send File Function ----------------
async function sendFile(file) {
  const allowedTypes = ['image/jpeg','image/png','image/gif','application/pdf','text/plain'];
  if (!allowedTypes.includes(file.type)) {
    return showModal('File type not supported.');
  }

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/upload', { method: 'POST', body: formData });
    if (!res.ok) throw new Error('Upload failed');
    const data = await res.json();

    if (!data.url) throw new Error('Upload response malformed');

    const msgData = {
      room: currentRoom,
      user: currentUser,
      text: file.type.startsWith('image/') ? '' : DOMPurify.sanitize(file.name),
      file: data,
      timestamp: new Date()
    };
    socket.emit('chat message', msgData);
  } catch (err) {
    console.error('File upload error:', err);
    showModal('Failed to upload file.');
  }
}

// ---------------- Helper: Status Icon ----------------
function statusIcon(status) {
  switch (status) {
    case 'sent': return '✓';
    case 'delivered': return '✓✓';
    case 'read': return '✓✓✔';
    default: return '';
  }
}

// ---------------- Typing Indicator ----------------
function updateTypingIndicator(users) {
  const others = users.filter(u => u !== currentUser);
  if (others.length) {
    typingBubble.style.display = 'flex';
    typingBubble.innerHTML = `${others.join(', ')} <span class="dots">...</span>`;
  } else typingBubble.style.display = 'none';
}

setInterval(() => {
  const dotsSpan = document.querySelector('#typing-bubble .dots');
  if (dotsSpan) {
    dotsSpan.textContent = dotsSpan.textContent.length < 3 ? dotsSpan.textContent + '.' : '.';
  }
}, 500);

// ================= Part 3: Modal helpers, message controls (modal-based), reactions & pins =================

// ---------------- Modal / Overlay Helpers ----------------
// Creates a single modal overlay in the DOM and returns helpers to show/hide it.
// showModal(message) - shows a simple OK modal (returns Promise resolved when closed).
// showPromptModal(title, initialText) - shows a prompt with input, returns Promise resolved with string or null.

function ensureModal() {
  if (document.getElementById('app-modal')) return;

  const overlay = document.createElement('div');
  overlay.id = 'app-modal';
  overlay.style.position = 'fixed';
  overlay.style.top = 0;
  overlay.style.left = 0;
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.display = 'none';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.zIndex = 9999;
  overlay.style.background = 'rgba(0,0,0,0.5)';

  const box = document.createElement('div');
  box.id = 'app-modal-box';
  box.style.minWidth = '300px';
  box.style.maxWidth = '90%';
  box.style.background = 'var(--card-bg, #fff)';
  box.style.color = 'var(--text, #000)';
  box.style.borderRadius = '8px';
  box.style.padding = '16px';
  box.style.boxShadow = '0 8px 24px rgba(0,0,0,0.3)';
  box.style.display = 'flex';
  box.style.flexDirection = 'column';
  box.style.gap = '12px';

  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

function showModal(message) {
  ensureModal();
  return new Promise((resolve) => {
    const overlay = document.getElementById('app-modal');
    const box = overlay.querySelector('#app-modal-box');
    box.innerHTML = '';

    const p = document.createElement('div');
    p.textContent = message;
    p.style.whiteSpace = 'pre-wrap';
    box.appendChild(p);

    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.justifyContent = 'flex-end';

    const ok = document.createElement('button');
    ok.textContent = 'OK';
    ok.addEventListener('click', () => {
      overlay.style.display = 'none';
      resolve();
    });
    btnRow.appendChild(ok);

    box.appendChild(btnRow);

    overlay.style.display = 'flex';
    // focus first button
    setTimeout(() => ok.focus(), 50);
  });
}

function showPromptModal(title = 'Edit', initial = '') {
  ensureModal();
  return new Promise((resolve) => {
    const overlay = document.getElementById('app-modal');
    const box = overlay.querySelector('#app-modal-box');
    box.innerHTML = '';

    const h = document.createElement('h3');
    h.textContent = title;
    box.appendChild(h);

    const ta = document.createElement('textarea');
    ta.value = initial || '';
    ta.rows = 4;
    ta.style.width = '100%';
    ta.style.resize = 'vertical';
    box.appendChild(ta);

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'flex-end';
    row.style.gap = '8px';

    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      overlay.style.display = 'none';
      resolve(null);
    });

    const save = document.createElement('button');
    save.textContent = 'Save';
    save.addEventListener('click', () => {
      const val = ta.value.trim();
      overlay.style.display = 'none';
      resolve(val);
    });

    row.appendChild(cancel);
    row.appendChild(save);
    box.appendChild(row);

    overlay.style.display = 'flex';
    setTimeout(() => ta.focus(), 50);
  });
}

// ---------------- Updated addMessageControls (uses modal prompt) ----------------
function addMessageControls(msgDiv, msg){
  // If controls already added, skip
  if (msgDiv.querySelector('.msg-menu-wrapper')) return;

  const wrapper = document.createElement('div');
  wrapper.classList.add('msg-menu-wrapper');
  const btn = document.createElement('button');
  btn.classList.add('menu-btn');
  btn.textContent = '⋮';
  wrapper.appendChild(btn);

  const menu = document.createElement('div');
  menu.classList.add('msg-menu');

  // Delete
  const delBtn = document.createElement('button');
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', ()=> {
    // optimistic remove
    msgDiv.remove();
    socket.emit('delete message', { room: currentRoom, id: msg._id||msg.id });
  });
  menu.appendChild(delBtn);

  // Edit (use modal prompt)
  const editBtn = document.createElement('button');
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', async () => {
    const currentText = msg.text || '';
    const newText = await showPromptModal('Edit your message', currentText);
    if (newText === null) return; // cancelled
    if (newText.trim() === currentText.trim()) return;
    const sanitized = DOMPurify.sanitize(newText.trim());
    const textSpan = msgDiv.querySelector('.msg-text');
    if (textSpan) textSpan.textContent = ` ${sanitized}`;
    socket.emit('edit message', { room: currentRoom, id: msg._id||msg.id, text: sanitized });
  });
  menu.appendChild(editBtn);

  // Pin
  const pinBtn = document.createElement('button');
  pinBtn.textContent = msg.pinned ? 'Unpin' : 'Pin';
  pinBtn.addEventListener('click', () => {
    socket.emit(msg.pinned ? 'unpin message' : 'pin message', { room: currentRoom, id: msg._id || msg.id });
  });
  menu.appendChild(pinBtn);

  // Star
  const starBtn = document.createElement('button');
  starBtn.textContent = msg.starredBy && msg.starredBy.includes(currentUser) ? 'Unstar' : 'Star';
  starBtn.addEventListener('click', () => {
    if (msg.starredBy?.includes(currentUser)) {
      socket.emit('unstar message', { room: currentRoom, id: msg._id||msg.id, user: currentUser });
    } else {
      socket.emit('star message', { room: currentRoom, id: msg._id||msg.id, user: currentUser });
    }
  });
  menu.appendChild(starBtn);

  wrapper.appendChild(menu);
  btn.addEventListener('click', ()=> menu.classList.toggle('show'));
  msgDiv.appendChild(wrapper);
}

// ---------------- Reaction updates UI (safe) ----------------
function updateReactionsUI(id, reactions){
  const container = document.querySelector(`.message[data-id='${id}'] .reaction-container`);
  if(!container) return;
  // remove non-reaction children safely (keep react button)
  const reactBtn = container.querySelector('.reaction-toggle');
  container.innerHTML = '';
  if (reactBtn) container.appendChild(reactBtn);

  // insert reactions before reactBtn
  reactions.forEach(r => {
    const span = document.createElement('span');
    span.textContent = r.emoji;
    span.title = r.user;
    container.insertBefore(span, reactBtn);
  });
}

// ---------------- Pinned / Starred socket handlers (ensure UI present) ----------------
socket?.on && socket.on('message pinned', msg => {
  const div = document.querySelector(`.message[data-id='${msg._id}']`);
  if (div) div.classList.add('pinned');
  addPinnedMessage(msg);
});

socket?.on && socket.on('message unpinned', msg => {
  const div = document.querySelector(`.message[data-id='${msg._id}']`);
  if (div) div.classList.remove('pinned');
  removePinnedMessage(msg);
});

socket?.on && socket.on('pinned messages', msgs => {
  msgs.forEach(addPinnedMessage);
});

socket?.on && socket.on('message starred', ({ id, starredBy }) => {
  const div = document.querySelector(`.message[data-id='${id}']`);
  if (!div) return;
  const btn = div.querySelector('.menu-btn');
  if (btn) btn.textContent = `⭐(${starredBy.length})`;
});

socket?.on && socket.on('message unstarred', ({ id, starredBy }) => {
  const div = document.querySelector(`.message[data-id='${id}']`);
  if (!div) return;
  const btn = div.querySelector('.menu-btn');
  if (btn) btn.textContent = starredBy.length ? `⭐(${starredBy.length})` : '⋮';
});

