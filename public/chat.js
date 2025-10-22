// ==============================
// DizyChat — Production-Ready Chat JS
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
const typingBubble = document.getElementById('typing-bubble');
const pinnedBanner = document.getElementById('pinned-messages');
const toggleThemeBtn = document.getElementById('toggle-theme');
const leaveBtn = document.getElementById('leave-btn');

let socket = null;
let currentUser = '';
let currentRoom = '';
let roomPassword = '';
let typingTimeout = null;
let isScrollLocked = false;
let darkMode = localStorage.getItem('darkMode') === 'true';
let emojiData = [];
let emojisLoaded = false;
let unreadCount = 0;
let faviconImage = new Image();

// ---------------- Apply Dark Mode ----------------
document.body.classList.toggle('dark', darkMode);

// ---------------- Favicon Logic ----------------
const faviconLink = document.querySelector("link[rel~='icon']") || (() => {
  const link = document.createElement('link');
  link.rel = 'icon';
  link.href = '/logo.png';
  document.head.appendChild(link);
  return link;
})();
const faviconCanvas = document.createElement('canvas');
faviconCanvas.width = 32;
faviconCanvas.height = 32;
const ctx = faviconCanvas.getContext('2d');
let badgeScale = 1, popBoost = 0, targetScale = 1, pulse = 0, unreadAlpha = 0;

faviconImage.src = '/logo.png';

function incrementFavicon() {
  unreadCount++;
  popBoost = Math.min(popBoost + 0.25, 0.6);
  targetScale = 1 + popBoost;
}

function resetFavicon() {
  unreadCount = 0;
  popBoost = 0;
  badgeScale = 1;
  targetScale = 1;
}

window.addEventListener('focus', resetFavicon);

function drawFavicon() {
  if (!faviconImage.complete) return requestAnimationFrame(drawFavicon);
  ctx.clearRect(0, 0, 32, 32);
  ctx.drawImage(faviconImage, 0, 0, 32, 32);

  if (unreadCount > 0) {
    unreadAlpha += (1 - unreadAlpha) * 0.15;
    pulse += 0.15;
    const scaleOffset = Math.sin(pulse) * 0.15;
    badgeScale += (targetScale - badgeScale) * 0.2;
    badgeScale = Math.min(badgeScale, 1.6);
    popBoost *= 0.92;

    const x = 26, y = 8, radius = 6;
    const glowRadius = radius * 1.8 + scaleOffset * 6;
    const glow = ctx.createRadialGradient(x, y, radius / 2, x, y, glowRadius);
    glow.addColorStop(0, `rgba(255,68,68,${unreadAlpha*0.5})`);
    glow.addColorStop(1, "rgba(255,68,68,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, glowRadius, 0, Math.PI*2);
    ctx.fill();

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(badgeScale, badgeScale);
    ctx.translate(-x, -y);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI*2);
    ctx.fillStyle = `rgba(255,68,68,${unreadAlpha})`;
    ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${unreadAlpha})`;
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(unreadCount > 9 ? "9+" : unreadCount.toString(), x, y);
    ctx.restore();
  } else {
    unreadAlpha *= 0.85;
  }

  faviconLink.href = faviconCanvas.toDataURL("image/png");
  requestAnimationFrame(drawFavicon);
}
requestAnimationFrame(drawFavicon);

// ---------------- Landing Page Join ----------------
joinBtn?.addEventListener('click', () => {
  const username = usernameInput.value.trim();
  const room = roomInput.value.trim();
  const pwd = roomPasswordInput.value.trim();
  if (!username || !room) {
    usernameInput.focus();
    return showInlineWarning('Enter both username and room name.');
  }

  currentUser = username;
  currentRoom = room;
  roomPassword = pwd;

  localStorage.setItem('sessionToken', Date.now());
  localStorage.setItem('username', currentUser);

  usernamePrompt.style.display = 'none';
  chatContainer.style.display = 'flex';
  roomNameSpan.textContent = currentRoom;

  displayMessage({ user: 'System', text: `Welcome to ${currentRoom}, ${currentUser}!`, time: Date.now() });

  const url = new URL(window.location.href);
  url.searchParams.set('room', currentRoom);
  if (roomPassword) url.searchParams.set('password', roomPassword);
  window.history.replaceState({}, '', url);

  addShareLink();
  setTimeout(initChat, 50);
  input?.focus();
});

function showInlineWarning(msg) {
  let warning = document.getElementById('inline-warning');
  if (!warning) {
    warning = document.createElement('div');
    warning.id = 'inline-warning';
    warning.style.color = 'orange';
    warning.style.marginTop = '4px';
    usernamePrompt.appendChild(warning);
  }
  warning.textContent = msg;
}

// ---------------- Share Link ----------------
function addShareLink() {
  if (document.querySelector('#share-btn')) return;
  const shareBtn = document.createElement('button');
  shareBtn.id = 'share-btn';
  shareBtn.textContent = 'Copy Link';
  shareBtn.style.marginLeft = '8px';
  shareBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(window.location.href);
    showInlineWarning('Link copied to clipboard!');
  });
  document.querySelector('header .header-right')?.appendChild(shareBtn);
}

// ---------------- Initialize Socket ----------------
function initChat() {
  socket = io();

  socket.on('connect', () => {
    socket.emit('join room', { room: currentRoom, password: roomPassword });
    socket.emit('get pinned', { room: currentRoom });
  });

  socket.on('disconnect', () => console.log('Disconnected'));

  socket.on('chat message', displayMessage);
  socket.on('typing', users => {
    const others = (users || []).filter(u => u && u !== currentUser);
    others.length ? showTyping(others) : hideTyping();
  });
  socket.on('stop typing', hideTyping);
  socket.on('pinned messages', renderPinned);
  socket.on('message pinned', renderPinnedMessage);
  socket.on('message unpinned', renderPinnedMessage);
  socket.on('message starred', ({ id, starredBy }) => updateStar(id, starredBy));
  socket.on('message unstarred', ({ id, starredBy }) => updateStar(id, starredBy));
  socket.on('update reactions', ({ id, reactions }) => updateReactions(id, reactions));
}

// ---------------- Display Message ----------------
function displayMessage(msg, prepend = false) {
  if (!msg) return;
  const id = msg._id || msg.id || msg.tempId || '';
  if (id && document.querySelector(`.message[data-id='${id}']`)) return;

  const div = document.createElement('div');
  div.className = `message ${msg.user === currentUser ? 'self' : 'other'}`;
  if (id) div.dataset.id = id;

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `${msg.user || 'Anon'} • ${new Date(msg.time || Date.now()).toLocaleTimeString()}`;
  div.appendChild(meta);

  const text = document.createElement('div');
  text.className = 'text';
  text.textContent = msg.text || '';
  div.appendChild(text);

  if (msg.linkPreview) {
    const lp = document.createElement('div');
    lp.className = 'link-preview';
    if (msg.linkPreview.image) {
      const img = document.createElement('img');
      img.src = msg.linkPreview.image;
      lp.appendChild(img);
    }
    const info = document.createElement('div');
    info.innerHTML = `<strong>${msg.linkPreview.title || ''}</strong><br>${msg.linkPreview.desc || ''}`;
    lp.appendChild(info);
    div.appendChild(lp);
  }

  // Reactions
  const reactionsDiv = document.createElement('div');
  reactionsDiv.className = 'reactions';
  (msg.reactions || []).forEach(r => {
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
    starBtn.addEventListener('click', () => {
      socket.emit(starBtn.textContent === '⭐' ? 'unstar message' : 'star message', { room: currentRoom, id, user: currentUser });
    });
    div.appendChild(starBtn);
  }

  // Pin button
  const pinBtn = document.createElement('button');
  pinBtn.className = 'pin-btn';
  pinBtn.textContent = msg.pinned ? '📌' : '📍';
  pinBtn.addEventListener('click', () => {
    socket.emit(msg.pinned ? 'unpin message' : 'pin message', { room: currentRoom, id });
  });
  div.appendChild(pinBtn);

  prepend ? messages.prepend(div) : appendMessage(div);
  if (msg.user !== currentUser) incrementFavicon();
}

// ---------------- Pinned Messages ----------------
if (pinnedBanner && !pinnedBanner.querySelector('ul')) {
  pinnedBanner.appendChild(document.createElement('ul'));
}

function renderPinned(msgs) {
  if (!pinnedBanner) return;
  const prevScroll = pinnedBanner.scrollTop;
  pinnedBanner.innerHTML = '';
  if (msgs?.length) {
    pinnedBanner.style.display = 'block';
    msgs.forEach(m => {
      const div = document.createElement('div');
      div.className = 'message pinned';
      div.textContent = `${m.user || 'Anon'}: ${m.text || ''}`;
      pinnedBanner.appendChild(div);
    });
    pinnedBanner.scrollTop = prevScroll;
  } else {
    pinnedBanner.style.display = 'none';
  }
}

function renderPinnedMessage() {
  if (socket && currentRoom) socket.emit('get pinned', { room: currentRoom });
}

// ---------------- Helpers ----------------
function appendMessage(div) {
  messages?.appendChild(div);
  if (!isScrollLocked) div.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function updateStar(id, starredBy) {
  const msgDiv = document.querySelector(`.message[data-id='${id}']`);
  if (!msgDiv) return;
  const starBtn = msgDiv.querySelector('.star-btn');
  if (!starBtn) return;
  starBtn.textContent = starredBy?.includes(currentUser) ? '⭐' : '☆';
}

function updateReactions(id, reactions) {
  const msgDiv = document.querySelector(`.message[data-id='${id}']`);
  if (!msgDiv) return;
  const reactionsDiv = msgDiv.querySelector('.reactions');
  if (!reactionsDiv) return;
  reactionsDiv.innerHTML = '';
  (reactions || []).forEach(r => {
    const span = document.createElement('span');
    span.textContent = r.emoji;
    reactionsDiv.appendChild(span);
  });
}

// ---------------- Typing Indicator (debounced) ----------------
let typingDebounce;
function showTyping(users) {
  if (!typingBubble) return;
  typingBubble.style.display = 'block';
  typingBubble.textContent = `${users.join(', ')} typing...`;
  clearTimeout(typingDebounce);
  typingDebounce = setTimeout(hideTyping, 1500);
}

function hideTyping() {
  if (!typingBubble) return;
  typingBubble.style.display = 'none';
}

// ---------------- Input Form ----------------
form?.addEventListener('submit', e => {
  e.preventDefault();
  if (!input?.value.trim() || !socket) return;
  socket.emit('chat message', { room: currentRoom, user: currentUser, text: input.value.trim(), time: Date.now() });
  input.value = '';
});

// ---------------- Emoji Picker ----------------
emojiBtn?.addEventListener('click', () => {
  if (!emojiPicker) return;
  emojiPicker.style.display = emojiPicker.style.display === 'block' ? 'none' : 'block';
  if (!emojisLoaded) loadEmojis();
});

function setupQuickEmojis() {
  document.querySelectorAll('#quick-emojis button').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!input) return;
      input.value += btn.textContent;
      input.focus();
    });
  });
}

function loadEmojis() {
  fetch('/emoji.json')
    .then(res => res.json())
    .then(data => {
      emojiData = data;
      const container = document.getElementById('emoji-picker');
      if (!container) return;
      const quickDiv = document.createElement('div');
      quickDiv.id = 'quick-emojis';
      Object.values(emojiData).forEach(e => {
        const btn = document.createElement('button');
        btn.textContent = e;
        quickDiv.appendChild(btn);
      });
      container.appendChild(quickDiv);
      emojisLoaded = true;
      setupQuickEmojis();
    })
    .catch(err => console.error('Error loading emojis:', err));
}

setupQuickEmojis();

// ---------------- Scroll Lock ----------------
messages?.addEventListener('scroll', () => {
  if (!messages) return;
  const atBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 10;
  isScrollLocked = !atBottom;
});

// ---------------- Dark Theme Toggle ----------------
toggleThemeBtn?.addEventListener('click', () => {
  darkMode = !darkMode;
  document.body.classList.toggle('dark', darkMode);
  localStorage.setItem('darkMode', darkMode);
});

// ---------------- Leave Button ----------------
leaveBtn?.addEventListener('click', () => {
  if (socket) socket.disconnect();
  location.reload();
});


// Admin / commands via Enter key (non-invasive)
if (typeof input !== 'undefined' && input) {
  input.addEventListener('keydown', (e) => {
    try {
      if (e.key === 'Enter' && !e.shiftKey) {
        const raw = (input.value || '').trim();
        if (raw.startsWith('/')) {
          e.preventDefault();
          const parts = raw.slice(1).split(/\s+/);
          const cmd = parts[0]; const rest = parts.slice(1).join(' ');
          if (['ban','kick'].includes(cmd) && rest) {
            socket.emit('moderate', { room: currentRoom, cmd, target: rest });
            input.value='';
            return;
          }
          if (cmd === 'announce' && rest) {
            socket.emit('announce', { room: currentRoom, text: rest });
            input.value='';
            return;
          }
        }
      }
    } catch(_) {}
  });
}

// Announcement render
socket.on('announcement', ({ text, at, by }) => {
  const messages = document.getElementById('messages');
  if (!messages) return;
  const wrap = document.createElement('div');
  wrap.className = 'announcement';
  wrap.innerHTML = `<strong>📢 Announcement</strong> from <span class="admin-name">${by}</span><br>${text}`;
  messages.appendChild(wrap);
  wrap.scrollIntoView({ behavior: 'smooth', block: 'end' });
});
