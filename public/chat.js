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
const toggleThemeBtn = document.getElementById('toggle-theme');
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const homeLogo = document.getElementById('home-logo');

let socket = null;
let currentUser = '';
let currentRoom = '';
let roomPassword = '';
let typingTimeout = null;
let scrollLocked = false;
let darkMode = false;
let emojiData = {};
let emojisLoaded = false;
let unreadCount = 0;

// ---------------- Favicon ----------------
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

function drawFavicon() {
    const img = new Image();
    img.src = '/logo.png';
    img.onload = () => {
        faviconCtx.clearRect(0, 0, 32, 32);
        faviconCtx.drawImage(img, 0, 0, 32, 32);
        if (unreadCount > 0) {
            faviconCtx.fillStyle = 'red';
            faviconCtx.beginPath();
            faviconCtx.arc(24, 8, 7, 0, Math.PI * 2);
            faviconCtx.fill();
            faviconCtx.fillStyle = 'white';
            faviconCtx.font = '10px Arial';
            faviconCtx.textAlign = 'center';
            faviconCtx.textBaseline = 'middle';
            faviconCtx.fillText(unreadCount > 99 ? '99+' : String(unreadCount), 24, 8);
        }
        originalFavicon.href = faviconCanvas.toDataURL('image/png');
    };
}
function incrementFavicon() { unreadCount++; drawFavicon(); }
function resetFavicon() { unreadCount = 0; drawFavicon(); }
window.addEventListener('focus', resetFavicon);

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

    socket.on('stop typing', () => hideTyping());

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

    if (msg.user !== currentUser && socket) incrementFavicon();
}

function appendMessage(div) {
    messages.appendChild(div);
    const atBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 10;
    if (!scrollLocked || atBottom) div.scrollIntoView({ behavior: 'smooth', block: 'end' });
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

// ---------------- Stars / Reactions ----------------
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

// ---------------- Emoji Picker ----------------
emojiBtn?.addEventListener('click', () => {
    if (!emojiPicker) return;
    emojiPicker.classList.toggle('show');
    if (!emojisLoaded && emojiPicker.classList.contains('show')) populateEmojiPicker();
});

function populateEmojiPicker() {
    fetch('/emoji.json')
        .then(res => res.json())
        .then(data => {
            emojiData = data;
            emojiPicker.innerHTML = '';
            Object.keys(data).forEach(cat => {
                const catDiv = document.createElement('div');
                catDiv.className = 'emoji-category';
                const catTitle = document.createElement('div');
                catTitle.className = 'emoji-category-title';
                catTitle.textContent = cat;
                catDiv.appendChild(catTitle);
                data[cat].forEach(e => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.textContent = e.char || '';
                    btn.title = e.name || '';
                    btn.addEventListener('click', () => { input.value += e.char; input.focus(); });
                    catDiv.appendChild(btn);
                });
                emojiPicker.appendChild(catDiv);
            });
            emojisLoaded = true;
        })
        .catch(err => console.warn('Emoji JSON load failed:', err));
}

// Quick emojis
quickEmojis?.forEach(btn => btn.addEventListener('click', () => {
    input.value += btn.textContent || '';
    input.focus();
}));

// ---------------- Scroll Lock ----------------
scrollLockBtn?.addEventListener('click', () => {
    scrollLocked = !scrollLocked;
    scrollLockBtn.textContent = scrollLocked ? '🔒 Auto-scroll ON' : '🔓 Auto-scroll OFF';
});

// ---------------- Theme Toggle ----------------
toggleThemeBtn?.addEventListener('click', () => {
    darkMode = !darkMode;
    document.body.classList.toggle('dark', darkMode);
});

// ---------------- Search ----------------
searchBtn?.addEventListener('click', () => {
    const term = searchInput.value.toLowerCase();
    document.querySelectorAll('.message .text').forEach(el => {
        const parent = el.closest('.message');
        parent.style.display = (!term || el.textContent.toLowerCase().includes(term)) ? '' : 'none';
    });
});

// ---------------- Form Submit ----------------
form?.addEventListener('submit', e => {
    e.preventDefault();
    if (!input.value.trim()) return;
    const tempId = `temp-${Date.now()}`;
    const msg = { user: currentUser, room: currentRoom, text: input.value.trim(), time: Date.now(), tempId };
    socket?.emit('chat message', msg);
    displayMessage(msg);
    input.value = '';
    socket?.emit('stop typing', { room: currentRoom, user: currentUser });
});

// Typing indicator
input?.addEventListener('input', () => {
    if (!socket) return;
    if (input.value.trim()) {
        socket.emit
input?.addEventListener('input', () => {
    if (!socket) return;
    if (input.value.trim()) {
        socket.emit('typing', { room: currentRoom, user: currentUser });
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            socket.emit('stop typing', { room: currentRoom, user: currentUser });
        }, 2000);
    } else {
        socket.emit('stop typing', { room: currentRoom, user: currentUser });
    }
});

// ---------------- Utility ----------------
function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ---------------- Restore State on Reload ----------------
window.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('username');
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (savedUser && room) {
        currentUser = savedUser;
        currentRoom = room;
        usernamePrompt.style.display = 'none';
        chatContainer.style.display = 'flex';
        roomNameSpan.textContent = currentRoom;
        initChat();
    } else {
        usernamePrompt.style.display = 'flex';
        chatContainer.style.display = 'none';
    }
});

// ---------------- Debug Helpers ----------------
window.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 'l') {
        messages.innerHTML = '';
        console.log('Chat log cleared (Ctrl+L)');
    }
});

// ---------------- Home Logo Reload ----------------
homeLogo?.addEventListener('click', () => {
    localStorage.removeItem('username');
    localStorage.removeItem('sessionToken');
    window.location.href = '/';
});
