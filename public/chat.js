// ==============================
// DizyChat — Full Chat JS (Merged & Fixed Scroll Lock + Pinned)
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
let darkMode = false;
let emojiData = {};
let emojisLoaded = false;
let unreadCount = 0;

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

let badgeScale = 1;
let popBoost = 0;
let targetScale = 1;
let pulse = 0;
let unreadAlpha = 0;

const POP_DECAY = 0.08;
const MAX_BADGE_SCALE = 1.6;
const POP_INCREMENT = 0.25;

function incrementFavicon() {
  unreadCount++;
  popBoost += POP_INCREMENT;
  if (popBoost > MAX_BADGE_SCALE - 1) popBoost = MAX_BADGE_SCALE - 1;
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
  const img = new Image();
  img.src = '/logo.png';
  img.onload = () => {
    ctx.clearRect(0, 0, 32, 32);
    ctx.drawImage(img, 0, 0, 32, 32);

    if (unreadCount > 0) {
      unreadAlpha += (1 - unreadAlpha) * 0.15;
      pulse += 0.15;
      const scaleOffset = Math.sin(pulse) * 0.15;

      badgeScale += (targetScale - badgeScale) * 0.2;
      badgeScale = Math.min(badgeScale, MAX_BADGE_SCALE);
      badgeScale = 1 + scaleOffset + (badgeScale - 1);
      popBoost *= (1 - POP_DECAY);

      const x = 26, y = 8, radius = 6;
      const glowRadius = radius * 1.8 + scaleOffset * 6;
      const glow = ctx.createRadialGradient(x, y, radius / 2, x, y, glowRadius);
      const opacity = unreadAlpha * 0.5;
      glow.addColorStop(0, `rgba(255,68,68,${opacity})`);
      glow.addColorStop(1, "rgba(255,68,68,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.translate(x, y);
      ctx.scale(badgeScale, badgeScale);
      ctx.translate(-x, -y);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
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
  };
}

(function loop() {
  drawFavicon();
  requestAnimationFrame(loop);
})();

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

  socket.on('stop typing', hideTyping);

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

  // Meta info
  const meta = document.createElement('div');
  meta.className = 'meta';
  const t = msg.time ? new Date(msg.time) : new Date();
  meta.textContent = `${msg.user || 'Anon'} • ${t.toLocaleTimeString()}`;
  div.appendChild(meta);

  // Message text
  const text = document.createElement('div');
  text.className = 'text';
  text.textContent = msg.text || '';
  div.appendChild(text);

  // Reactions
  const reactionsDiv = document.createElement('div');
  reactionsDiv.className = 'reactions';
  if (msg.reactions?.length) {
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

  if (msg.user !== currentUser && socket) incrementFavicon();
}

// ---------------- Pinned Messages Setup ----------------
if (pinnedBanner && !pinnedBanner.querySelector('ul')) {
    const ul = document.createElement('ul');
    pinnedBanner.appendChild(ul);
}
const pinnedList = pinnedBanner?.querySelector('ul');

// ---------------- Safe Append Message ----------------
function appendMessage(div) {
  if (!messages) return;
  messages.appendChild(div);
  if (!isScrollLocked) div.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

// ---------------- Typing ----------------
function showTyping(users) {
  typingBubble.style.display = 'block';
  typingBubble.textContent = `${users.join(', ')} typing...`;
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(hideTyping, 2000);
}

function hideTyping() { typingBubble.style.display = 'none'; }

// ---------------- Pinned ----------------
function renderPinned(msgs) {
  if (!pinnedBanner) return;
  pinnedBanner.innerHTML = '';
  if (msgs?.length) {
    pinnedBanner.style.display = 'block';
    msgs.forEach(m => {
      const div = document.createElement('div');
      div.className = 'message pinned';
      div.textContent = `${m.user || 'Anon'}: ${m.text || ''}`;
      pinnedBanner.appendChild(div);
    });
  } else {
    pinnedBanner.style.display = 'none';
  }
}

function renderPinnedMessage() {
  if (socket && currentRoom) socket.emit('get pinned', { room: currentRoom });
}

// ---------------- Emoji Picker ----------------
emojiBtn?.addEventListener('click', () => {
  emojiPicker.style.display = emojiPicker.style.display === 'block' ? 'none' : 'block';
});

quickEmojis?.forEach(btn => btn.addEventListener('click', e => {
  input.value += e.target.textContent;
  emojiPicker.style.display = 'none';
  input.focus();
}));

// ---------------- Input Form ----------------
form?.addEventListener('submit', e => {
  e.preventDefault();
  const msg = input.value.trim();
  if (!msg || !socket) return;
  socket.emit('chat message', { room: currentRoom, user: currentUser, text: msg });
  input.value = '';
});

// ---------------- Scroll Lock ----------------
messages?.addEventListener('scroll', () => {
  if (!messages) return;
  const atBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 10;
  isScrollLocked = !atBottom;
});

// ---------------- Header Buttons ----------------
toggleThemeBtn?.addEventListener('click', () => {
  darkMode = !darkMode;
  document.body.classList.toggle('dark', darkMode);
});

leaveBtn?.addEventListener('click', () => location.reload());
