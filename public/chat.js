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

function incrementFavicon(){
  unreadCount++;
  updateFaviconBadge(unreadCount);
}

function resetFavicon(){
  unreadCount = 0;
  updateFaviconBadge(unreadCount);
}

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

  // Request first page of history
  currentPage = 1;
  socket.emit("get history", { room: currentRoom, page: currentPage, limit: PAGE_LIMIT });

  // ---------------- Input Events ----------------
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
  socket.on('chat message', msg => {
    displayMessage(msg);
    if(document.hidden && msg.user !== currentUser) incrementFavicon();
  });
  socket.on('room history', msgs => {
    const scrollBefore = messages.scrollHeight;
    msgs.reverse().forEach(msg => displayMessage(msg, true));
    if(currentPage>1) messages.scrollTop = messages.scrollHeight - scrollBefore;
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
  socket.on('join error', msg => alert(msg));
  socket.on('delete message', id => {
    const div = document.querySelector(`.message[data-id='${id}']`);
    if(div) div.remove();
  });
  socket.on('edit message', ({ id, text }) => {
    const textSpan = document.querySelector(`.message[data-id='${id}'] .msg-text`);
    if(textSpan) textSpan.textContent = ` ${text}`;
  });

  // ---------------- Infinite Scroll for Older Messages ----------------
  messages.addEventListener('scroll', () => {
    if (messages.scrollTop < 50 && !isLoadingHistory) {
      isLoadingHistory = true;
      currentPage++;
      socket.emit("get history", { room: currentRoom, page: currentPage, limit: PAGE_LIMIT });
    }
  });

  // ---------------- Search ----------------
  searchInput?.addEventListener('input', e => {
    const query = e.target.value.trim();
    if(query.length < 2) return;
    socket.emit('search messages', { room: currentRoom, query });
  });
}

// ---------------- Display Messages ----------------
function displayMessage(msg, prepend=false) {
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

  if(prepend) messages.prepend(div);
  else messages.appendChild(div);

  const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 50;
  if (nearBottom && !prepend) div.scrollIntoView({ behavior: 'smooth', block: 'end' });

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
// ---------------- Search / Filter ----------------
const searchWrapper = document.createElement('div');
searchWrapper.classList.add('search-wrapper');
searchInput.parentNode.insertBefore(searchWrapper, searchInput);
searchWrapper.appendChild(searchInput);

// Add clear button
const clearBtn = document.createElement('button');
clearBtn.textContent = '✖';
clearBtn.title = 'Clear search';
clearBtn.classList.add('clear-search-btn');
searchWrapper.appendChild(clearBtn);

clearBtn.addEventListener('click', () => {
  searchInput.value = '';
  clearBtn.style.display = 'none';
  // Reset chat to normal
  socket.emit("get history", { room: currentRoom, page: 1, limit: PAGE_LIMIT });
});

let searchTimeout;
searchInput?.addEventListener('input', e => {
  const query = e.target.value.trim();
  clearTimeout(searchTimeout);

  clearBtn.style.display = query ? 'inline-block' : 'none';

  searchTimeout = setTimeout(() => {
    if (!query || query.length < 2) {
      // Reset chat if input is empty
      socket.emit("get history", { room: currentRoom, page: 1, limit: PAGE_LIMIT });
      return;
    }

    // Send search request to server
    socket.emit('search messages', { room: currentRoom, query });
  }, 300); // 300ms debounce
});

// ---------------- Display Search Results ----------------
socket.on('search results', msgs => {
  messages.innerHTML = '';

  if (!msgs.length) {
    const noResults = document.createElement('div');
    noResults.classList.add('no-results');
    noResults.textContent = "No messages found.";
    messages.appendChild(noResults);
    return;
  }

  msgs.forEach(msg => {
    displayMessage(msg);
    // Optional: highlight matching text
    const textSpan = document.querySelector(`.message[data-id='${msg._id || msg.id}'] .msg-text`);
    if (textSpan && searchInput.value.trim()) {
      const regex = new RegExp(`(${searchInput.value.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      textSpan.innerHTML = textSpan.textContent.replace(regex, `<mark>$1</mark>`);
    }
	// ---------------- File & Image Uploads ----------------
const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.multiple = false; // change to true if multiple files
fileInput.style.display = 'none';
form.appendChild(fileInput);

// Add a button to trigger file picker
const uploadBtn = document.createElement('button');
uploadBtn.type = 'button';
uploadBtn.textContent = '📎';
uploadBtn.title = 'Attach file';
form.insertBefore(uploadBtn, input);

uploadBtn.addEventListener('click', () => fileInput.click());

// Handle file selection
fileInput.addEventListener('change', async (e) => {
  if (!fileInput.files.length) return;

  const file = fileInput.files[0];
  await sendFile(file);
  fileInput.value = ''; // reset input
});

// Drag-and-drop support
chatContainer.addEventListener('dragover', e => e.preventDefault());
chatContainer.addEventListener('drop', e => {
  e.preventDefault();
  if (!e.dataTransfer.files.length) return;
  sendFile(e.dataTransfer.files[0]);
});

// ---------------- Send File Function ----------------
async function sendFile(file) {
  const allowedTypes = ['image/jpeg','image/png','image/gif','application/pdf','text/plain'];
  if (!allowedTypes.includes(file.type)) {
    alert('File type not supported.');
    return;
  }

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/upload', { method: 'POST', body: formData });
    const data = await res.json(); // should return { url: '/uploads/xyz.png', name: 'file.png', type: 'image/png' }

    if (!data.url) throw new Error('Upload failed.');

    const msgData = {
      room: currentRoom,
      user: currentUser,
      text: file.type.startsWith('image/') ? '' : DOMPurify.sanitize(file.name),
      file: data, // attach file metadata
      timestamp: new Date()
    };

    socket.emit('chat message', msgData);
  } catch (err) {
    console.error('File upload error:', err);
    alert('Failed to upload file.');
  }
}

// ---------------- Display File Messages ----------------
function displayFileMessage(msg, prepend=false) {
  const div = document.createElement('div');
  div.classList.add('message', msg.user === currentUser ? 'self' : 'other');
  div.dataset.id = msg._id || msg.id;

  const meta = document.createElement('div');
  meta.classList.add('meta');
  meta.textContent = `[${new Date(msg.timestamp).toLocaleTimeString()}] ${msg.user}`;
  div.appendChild(meta);

  // Text content
  if (msg.text) {
    const textSpan = document.createElement('span');
    textSpan.classList.add('msg-text');
    textSpan.textContent = ` ${DOMPurify.sanitize(msg.text)}`;
    div.appendChild(textSpan);
  }

  // File preview
  if (msg.file) {
    const fileDiv = document.createElement('div');
    fileDiv.classList.add('file-preview');

    if (msg.file.type.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = msg.file.url;
      img.alt = msg.file.name;
      img.classList.add('inline-image');
      fileDiv.appendChild(img);
    } else {
      const link = document.createElement('a');
      link.href = msg.file.url;
      link.target = '_blank';
      link.textContent = msg.file.name;
      fileDiv.appendChild(link);
    }

    div.appendChild(fileDiv);
  }
  // Pin
const pinBtn = document.createElement('button');
pinBtn.textContent = msg.pinned ? 'Unpin' : 'Pin';
pinBtn.addEventListener('click', () => {
  socket.emit(msg.pinned ? 'unpin message' : 'pin message', { room: currentRoom, id: msg._id || msg.id });
});
menu.appendChild(pinBtn);

// Star
const starBtn = document.createElement('button');
starBtn.textContent = '⭐';
starBtn.addEventListener('click', () => {
  if (msg.starredBy?.includes(currentUser)) {
    socket.emit('unstar message', { room: currentRoom, id: msg._id || msg.id, user: currentUser });
  } else {
    socket.emit('star message', { room: currentRoom, id: msg._id || msg.id, user: currentUser });
  }
});
menu.appendChild(starBtn);

socket.on('message pinned', msg => {
  const div = document.querySelector(`.message[data-id='${msg._id}']`);
  if (div) div.classList.add('pinned');
});

socket.on('message unpinned', msg => {
  const div = document.querySelector(`.message[data-id='${msg._id}']`);
  if (div) div.classList.remove('pinned');
});

socket.on('message starred', ({ id, starredBy }) => {
  const div = document.querySelector(`.message[data-id='${id}']`);
  if (div) div.querySelector('.menu-btn').textContent = `⭐(${starredBy.length})`;
});

socket.on('message unstarred', ({ id, starredBy }) => {
  const div = document.querySelector(`.message[data-id='${id}']`);
  if (div) div.querySelector('.menu-btn').textContent = starredBy.length ? `⭐(${starredBy.length})` : '⋮';
});
function addPinnedMessage(msg) {
  const banner = document.getElementById('pinned-messages');
  const list = document.getElementById('pinned-list');
  banner.style.display = 'block';

  // Avoid duplicates
  if (document.querySelector(`#pinned-list li[data-id="${msg._id}"]`)) return;

  const li = document.createElement('li');
  li.dataset.id = msg._id;
  li.textContent = `${msg.user}: ${msg.text.slice(0, 50)}${msg.text.length > 50 ? "..." : ""}`;

  // Scroll to original message when clicked
  li.addEventListener('click', () => {
    const original = document.querySelector(`.message[data-id="${msg._id}"]`);
    if (original) {
      original.scrollIntoView({ behavior: "smooth", block: "center" });
      original.classList.add('highlight');
      setTimeout(() => original.classList.remove('highlight'), 1500);
    }
  });

  list.appendChild(li);
}

function removePinnedMessage(msg) {
  const li = document.querySelector(`#pinned-list li[data-id="${msg._id}"]`);
  if (li) li.remove();

  // Hide banner if no pinned left
  const list = document.getElementById('pinned-list');
  if (!list.children.length) {
    document.getElementById('pinned-messages').style.display = 'none';
  }
}
socket.on('message pinned', msg => {
  const div = document.querySelector(`.message[data-id='${msg._id}']`);
  if (div) div.classList.add('pinned');
  addPinnedMessage(msg);
});

socket.on('message unpinned', msg => {
  const div = document.querySelector(`.message[data-id='${msg._id}']`);
  if (div) div.classList.remove('pinned');
  removePinnedMessage(msg);
});
socket.on('pinned messages', msgs => {
  msgs.forEach(addPinnedMessage);
});

const pinBtn = document.createElement('button');
pinBtn.textContent = "📌";
pinBtn.classList.add("pin-btn");

pinBtn.addEventListener('click', () => {
  if (msg.pinned) {
    socket.emit('unpin message', { room, id: msg._id });
  } else {
    socket.emit('pin message', { room, id: msg._id });
  }
});

div.appendChild(pinBtn);

  // Status & reactions
  const statusSpan = document.createElement('span');
  statusSpan.classList.add('status');
  div.appendChild(statusSpan);
  addReactionUI(div, msg);
  if(msg.user === currentUser) addMessageControls(div, msg);

  if(prepend) messages.prepend(div);
  else messages.appendChild(div);

  const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 50;
  if (nearBottom && !prepend) div.scrollIntoView({ behavior: 'smooth', block: 'end' });

  if (msg.user !== currentUser) {
    socket.emit('read message', { room: currentRoom, id: msg._id || msg.id });
  }
  // After joining room
socket.emit('get pinned', { room });

}
  });
});

