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

let currentUser = '';
let currentRoom = '';
let roomPassword = '';
let socket;
let typingTimeout;
let darkMode = false;
let emojiData = {};
const linkPreviewCache = new Map();

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
  if (!username || !room) return alert("Please enter both username and room name.");

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

// ---------------- Initialize Chat ----------------
function initChat() {
  socket = io(window.location.origin);
  socket.emit("join room", { room: currentRoom, password: roomPassword });
  socket.emit("get history", currentRoom);

  input.addEventListener("input", () => {
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
  socket.on('chat message', msg => displayMessage(msg));
  socket.on('room history', msgs => msgs.forEach(msg => displayMessage(msg)));
  socket.on('typing', users => updateTypingIndicator(users));
  socket.on('message status', ({ id, status }) => {
    const statusSpan = document.querySelector(`.message[data-id='${id}'] .status`);
    if (statusSpan) statusSpan.textContent = statusIcon(status);
  });
  socket.on('update reactions', ({ id, reactions }) => updateReactionsUI(id, reactions));
  socket.on('join error', msg => alert(msg));
  socket.on('delete message', id => {
    const div = document.querySelector(`.message[data-id='${id}']`);
    if(div) div.remove();
  });
  socket.on('edit message', ({ id, text }) => {
    const textSpan = document.querySelector(`.message[data-id='${id}'] .msg-text`);
    if(textSpan) textSpan.textContent = ` ${text}`;
  });
}

// ---------------- Display Messages ----------------
function displayMessage(msg) {
  const div = document.createElement('div');
  div.classList.add('message', msg.user === currentUser ? 'self' : 'other');
  div.dataset.id = msg._id || msg.id;

  const meta = document.createElement('div');
  meta.classList.add('meta');
  meta.textContent = `[${new Date(msg.timestamp).toLocaleTimeString()}] ${msg.user}`;
  div.appendChild(meta);

  const textSpan = document.createElement('span');
  textSpan.classList.add('msg-text');
  textSpan.textContent = ` ${DOMPurify.sanitize(msg.text)}`;
  div.appendChild(textSpan);

  const statusSpan = document.createElement('span');
  statusSpan.classList.add('status');
  div.appendChild(statusSpan);

  handleLinkPreview(div, msg.text);
  addReactionUI(div, msg);
  if(msg.user === currentUser) addMessageControls(div, msg);

  messages.appendChild(div);

  const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 50;
  if (nearBottom) div.scrollIntoView({ behavior: 'smooth', block: 'end' });

  if (msg.user !== currentUser) {
    socket.emit('read message', { room: currentRoom, id: msg._id || msg.id });
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
  if(dotsSpan){
    dotsSpan.textContent = dotsSpan.textContent.length < 3 ? dotsSpan.textContent + '.' : '.';
  }
}, 500);

// ---------------- Link Preview ----------------
async function handleLinkPreview(msgDiv, text) {
  const urlRegex = /(\b(https?:\/\/)?(www\.)?[-a-zA-Z0-9@:%._+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_+.~#?&//=]*))/gi;
  const matches = text.match(urlRegex);
  if (!matches) return;

  const seenUrls = new Set();
  matches.forEach(rawUrl => {
    let url = rawUrl;
    if (!/^https?:\/\//i.test(url)) url = url.startsWith("www.") ? "https://" + url : "https://" + url;
    if (seenUrls.has(url)) return;
    seenUrls.add(url);

    if(linkPreviewCache.has(url)){
      renderPreview(msgDiv, url, linkPreviewCache.get(url), rawUrl);
      return;
    }

    (async () => {
      try {
        const res = await fetch(`/link-preview?url=${encodeURIComponent(url)}`);
        const data = await res.json();
        linkPreviewCache.set(url, data);
        renderPreview(msgDiv, url, data, rawUrl);
      } catch(e){ console.error("Link preview error:", e); }
    })();
  });
}

function renderPreview(msgDiv, url, data, rawUrl){
  if (data.title || data.image) {
    const textSpan = msgDiv.querySelector('.msg-text');
    if (textSpan) textSpan.textContent = textSpan.textContent.replace(rawUrl,'');
    const previewDiv = document.createElement('div');
    previewDiv.classList.add('link-preview');
    if(data.image){ const img = document.createElement('img'); img.src=data.image; img.alt=data.title||url; previewDiv.appendChild(img);}
    const link = document.createElement('a'); link.href=url; link.target='_blank'; link.textContent=data.title||url; previewDiv.appendChild(link);
    msgDiv.appendChild(previewDiv);
  }
}

// ---------------- Status Icon ----------------
function statusIcon(status){
  switch(status){
    case 'sent': return '✓';
    case 'delivered': return '✓✓';
    case 'read': return '✓✓✔';
    default: return '';
  }
}

// ---------------- Share ----------------
shareBtn.addEventListener("click", () => {
  const nickname = currentUser || "Guest";
  const fullURL = `${window.location.origin}?room=${encodeURIComponent(currentRoom)}&nickname=${encodeURIComponent(nickname)}`;
  navigator.clipboard.writeText(fullURL).then(() => alert("Room link copied!")).catch(()=>alert(`Room link: ${fullURL}`));
});

// ---------------- Dark Mode ----------------
toggleThemeBtn.addEventListener("click", () => {
  darkMode = !darkMode;
  document.body.classList.toggle("dark", darkMode);
  toggleThemeBtn.textContent = darkMode ? "☀️" : "🌙";
  homeLogo.src = darkMode ? "/logo.png" : "/logo-light.png";
});

// ---------------- Home Logo ----------------
homeLogo.addEventListener("click", () => {
  chatContainer.style.display = "none";
  usernamePrompt.style.display = "flex";
  roomNameSpan.textContent = "Room";
  messages.innerHTML = "";
  window.history.replaceState({}, "", window.location.origin);
});

// ---------------- Emoji Picker ----------------
const fallbackEmojis = {
  "Faces":["😀","😁","😂","🤣","😃"],
  "Gestures":["👍","👎","👏"],
  "Hearts & Symbols":["❤️","💛","💚"]
};

async function loadEmojis() {
  try {
    const res = await fetch('/emoji.json');
    emojiData = await res.json();
  } catch(e) {
    console.warn("Emoji JSON load failed, using fallback.");
    emojiData = fallbackEmojis;
  }
  renderEmojiPicker();
}

function renderEmojiPicker(){
  emojiPicker.innerHTML = '';
  Object.entries(emojiData).forEach(([category, arr]) => {
    const catDiv = document.createElement('div');
    catDiv.classList.add('emoji-category');
    arr.forEach(item=>{
      const char = item.char || item;
      const span = document.createElement('span');
      span.textContent = char;
      span.title = item.name || '';
      span.addEventListener('click', ()=>{ input.value += char; input.focus(); });
      catDiv.appendChild(span);
    });
    emojiPicker.appendChild(catDiv);
  });
}

emojiBtn.addEventListener('click', ()=> emojiPicker.classList.toggle('show'));
loadEmojis();

// ---------------- Quick Emojis ----------------
quickEmojis.forEach(btn=>{
  btn.addEventListener('click', ()=> {
    input.value += btn.textContent;
    input.focus();
    btn.classList.add('pop');
    setTimeout(()=>btn.classList.remove('pop'), 200);
  });
});

// ---------------- Recent Rooms ----------------
function saveRecentRoom(room){
  let recent = JSON.parse(localStorage.getItem('recentRooms') || "[]");
  if(!recent.includes(room)) recent.unshift(room);
  if(recent.length>5) recent.pop();
  localStorage.setItem('recentRooms', JSON.stringify(recent));
}

function loadRecentRooms(){
  roomListDiv.innerHTML='';
  let recent = JSON.parse(localStorage.getItem('recentRooms') || "[]");
  recent.forEach(r=>{
    const btn = document.createElement('button');
    btn.textContent = r;
    btn.classList.add('room-btn');
    btn.addEventListener('click', ()=> { roomInput.value = r; joinBtn.click(); });
    roomListDiv.appendChild(btn);
  });
}

loadRecentRooms();

// ---------------- Reactions & Message Menu ----------------
function addReactionUI(msgDiv, msg){
  const container = document.createElement('div');
  container.classList.add('reaction-container');

  if(msg.reactions){
    msg.reactions.forEach(r=>{
      const span = document.createElement('span');
      span.textContent = r.emoji;
      span.title = r.user;
      container.appendChild(span);
    });
  }

  const reactBtn = document.createElement('button');
  reactBtn.textContent = "➕";
  reactBtn.classList.add('reaction-toggle');
  reactBtn.addEventListener('click', ()=>{
    const picker = document.createElement('div');
    picker.classList.add('reaction-picker');
    Object.values(emojiData).flat().forEach(item=>{
      const char = item.char || item;
      const btn = document.createElement('button');
      btn.textContent = char;
      btn.classList.add('reaction-btn');
      btn.addEventListener('click', ()=>{
        socket.emit('react message', { room: currentRoom, id: msg._id || msg.id, reaction: char, username: currentUser });
        picker.remove();
      });
      picker.appendChild(btn);
    });
    container.appendChild(picker);
  });
  container.appendChild(reactBtn);

  msgDiv.appendChild(container);
}

function updateReactionsUI(id, reactions){
  const div = document.querySelector(`.message[data-id='${id}'] .reaction-container`);
  if(!div) return;
  div.querySelectorAll('span').forEach(s=>s.remove());
  reactions.forEach(r=>{
    const span = document.createElement('span');
    span.textContent = r.emoji;
    span.title = r.user;
    div.insertBefore(span, div.querySelector('.reaction-toggle'));
  });
}

function addMessageControls(msgDiv, msg){
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
  delBtn.addEventListener('click', ()=>{ msgDiv.remove(); socket.emit('delete message', { room: currentRoom, id: msg._id||msg.id }); });
  menu.appendChild(delBtn);

  // Edit
  const editBtn = document.createElement('button');
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', ()=>{
    const newText = prompt("Edit your message:", msg.text);
    if(newText && newText.trim() !== msg.text){
      const sanitized = DOMPurify.sanitize(newText.trim());
      const textSpan = msgDiv.querySelector('.msg-text');
      if (textSpan) textSpan.textContent = ` ${sanitized}`;
      socket.emit('edit message', { room: currentRoom, id: msg._id||msg.id, text: sanitized });
    }
  });
  menu.appendChild(editBtn);

  wrapper.appendChild(menu);
  btn.addEventListener('click', ()=> menu.classList.toggle('show'));
  msgDiv.appendChild(wrapper);
}
