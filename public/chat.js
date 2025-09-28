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
let emojiGrids = {};

// ---------------- Landing Page Prefill ----------------
const urlParams = new URLSearchParams(window.location.search);
const prefillRoom = urlParams.get("room");
if (prefillRoom) roomInput.value = prefillRoom;

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
    const msgData = { room: currentRoom, user: currentUser, text: input.value.trim(), timestamp: new Date() };
    socket.emit('chat message', msgData);
    input.value = '';
    input.focus();
  });

  socket.on('chat message', msg => displayMessage(msg));
  socket.on('room history', msgs => msgs.forEach(msg => displayMessage(msg)));
  socket.on('typing', users => {
    const others = users.filter(u => u !== currentUser);
    typingBubble.style.display = others.length ? 'block' : 'none';
    typingBubble.textContent = others.length ? `${others.join(', ')} is typing...` : '';
  });
  socket.on('message status', ({ id, status }) => {
    const msgDiv = document.querySelector(`.message[data-id='${id}'] .status`);
    if (msgDiv) msgDiv.textContent = statusIcon(status);
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

  const textNode = document.createTextNode(` ${msg.text}`);
  div.appendChild(textNode);

  handleLinkPreview(div, msg.text);

  // ---------------- Reactions ----------------
  addReactionUI(div);

  // ---------------- Edit/Delete Menu ----------------
  if(msg.user === currentUser) addMessageControls(div, msg);

  messages.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'end' });

  if (msg.user !== currentUser) {
    socket.emit('read message', { room: currentRoom, id: msg._id || msg.id });
  }
}

// ---------------- Link Preview ----------------
function handleLinkPreview(msgDiv, text) {
  const urlRegex = /(\b(https?:\/\/)?(www\.)?[-a-zA-Z0-9@:%._+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_+.~#?&//=]*))/gi;
  const matches = text.match(urlRegex);
  if (!matches) return;

  const seenUrls = new Set();
  matches.forEach(rawUrl => {
    let url = rawUrl;
    if (!/^https?:\/\//i.test(url)) url = url.startsWith("www.") ? "https://" + url : "https://" + url;
    if (seenUrls.has(url)) return;
    seenUrls.add(url);

    (async () => {
      try {
        const res = await fetch(`/link-preview?url=${encodeURIComponent(url)}`);
        const data = await res.json();
        if (data.title || data.image) {
          msgDiv.childNodes.forEach(node => { if(node.nodeType===3) node.textContent=node.textContent.replace(rawUrl,''); });
          const previewDiv = document.createElement('div');
          previewDiv.classList.add('link-preview');
          if(data.image){ const img = document.createElement('img'); img.src=data.image; img.alt=data.title||url; previewDiv.appendChild(img);}
          const link = document.createElement('a'); link.href=url; link.target='_blank'; link.textContent=data.title||url; previewDiv.appendChild(link);
          msgDiv.appendChild(previewDiv);
        }
      } catch(e){ console.error("Link preview error:", e); }
    })();
  });
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
  "Faces":["😀","😁","😂","🤣","😃"], "Gestures":["👍","👎","👏"], "Hearts":["❤️","💛"], "Food":["🍕","🍔"], "Animals":["🐶","🐱"], "Travel":["🚗","✈️"]
};

async function loadEmojis() {
  try {
    const res = await fetch("/emoji.json");
    emojiData = res.ok ? await res.json() : fallbackEmojis;
  } catch { emojiData = fallbackEmojis; }
  buildEmojiPicker();
}

function buildEmojiPicker() {
  emojiPicker.innerHTML="";
  const tabs=document.createElement("div"); tabs.classList.add("emoji-tabs");
  const content=document.createElement("div"); content.classList.add("emoji-content");
  Object.keys(emojiData).forEach((category,index)=>{
    const tabBtn=document.createElement("button"); tabBtn.textContent=category; tabBtn.classList.add("emoji-tab-btn");
    if(index===0) tabBtn.classList.add("active");
    tabBtn.addEventListener("click",()=>showEmojiCategory(category));
    tabs.appendChild(tabBtn);
    const catDiv=document.createElement("div"); catDiv.classList.add("emoji-category"); catDiv.dataset.category=category;
    if(index!==0) catDiv.style.display="none";
    emojiData[category].forEach(e=>{
      const char=typeof e==="string"?e:e.char;
      const span=document.createElement('span'); span.textContent=char;
      span.addEventListener("click",()=>{ insertAtCursor(input,char); input.focus(); animateQuickEmoji(char); });
      catDiv.appendChild(span);
    });
    content.appendChild(catDiv); emojiGrids[category]=catDiv;
  });
  emojiPicker.appendChild(tabs); emojiPicker.appendChild(content);
}

function showEmojiCategory(cat){
  document.querySelectorAll(".emoji-tab-btn").forEach(b=>b.classList.toggle('active',b.textContent===cat));
  Object.keys(emojiGrids).forEach(c=>emojiGrids[c].style.display=c===cat?"grid":"none");
}

function insertAtCursor(input,text){
  const start=input.selectionStart,end=input.selectionEnd;
  input.value=input.value.slice(0,start)+text+input.value.slice(end);
  input.selectionStart=input.selectionEnd=start+text.length;
}

emojiBtn.addEventListener('click', e => {
  e.stopPropagation();
  emojiPicker.classList.toggle('show');
});

document.addEventListener('click', e => {
  if(!emojiPicker.contains(e.target) && e.target!==emojiBtn) emojiPicker.classList.remove('show');
});

function animateQuickEmoji(char){ quickEmojis.forEach(btn=>{ if(btn.textContent===char){ btn.classList.add('pop'); setTimeout(()=>btn.classList.remove('pop'),200); }}); }
quickEmojis.forEach(btn=>btn.addEventListener('click',()=>{ insertAtCursor(input,btn.textContent); animateQuickEmoji(btn.textContent); }));

loadEmojis();

// ---------------- Recent Rooms ----------------
function loadRecentRooms(){
  const recent=JSON.parse(localStorage.getItem('recentRooms')||'[]');
  roomListDiv.innerHTML='';
  recent.forEach(r=>{
    const btn=document.createElement('button'); btn.textContent=r; btn.className='room-btn';
    btn.addEventListener('click',()=>{ roomInput.value=r; joinBtn.click(); });
    roomListDiv.appendChild(btn);
  });
}

function saveRecentRoom(room){
  let recent=JSON.parse(localStorage.getItem('recentRooms')||'[]');
  recent=[room,...recent.filter(r=>r!==room)].slice(0,10);
  localStorage.setItem('recentRooms',JSON.stringify(recent));
}

// ---------------- Reactions ----------------
function addReactionUI(msgDiv) {
  const container = document.createElement('div');
  container.classList.add('reaction-container');

  const reactBtn = document.createElement('button');
  reactBtn.textContent = '😊';
  reactBtn.classList.add('reaction-btn');
  container.appendChild(reactBtn);

  const emojiMenu = document.createElement('div');
  emojiMenu.classList.add('reaction-menu');

  ['👍','❤️','😂','😮','😢','😡'].forEach(e => {
    const span = document.createElement('span');
    span.textContent = e;
    span.addEventListener('click', () => {
      let existing = container.querySelector('.selected-reactions');
      if (!existing) {
        existing = document.createElement('div');
        existing.className = 'selected-reactions';
        container.appendChild(existing);
      }
      existing.textContent += e;
      emojiMenu.style.display = 'none';
    });
    emojiMenu.appendChild(span);
  });

  container.appendChild(emojiMenu);

  reactBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllMenus();
    emojiMenu.style.display = emojiMenu.style.display === 'block' ? 'none' : 'block';
  });

  msgDiv.appendChild(container);
}

// ---------------- Three-dot Edit/Delete Menu ----------------
function addMessageControls(msgDiv, msg) {
  const wrapper = document.createElement('div');
  wrapper.classList.add('msg-menu-wrapper');

  const menuBtn = document.createElement('button');
  menuBtn.classList.add('menu-btn');
  menuBtn.textContent = '⋯';
  wrapper.appendChild(menuBtn);

  const menu = document.createElement('div');
  menu.classList.add('msg-menu');

  const editBtn = document.createElement('button');
  editBtn.textContent = '✏️ Edit';
  editBtn.addEventListener('click', () => {
    const newText = prompt("Edit message:", msg.text);
    if (newText && newText.trim() !== msg.text) {
      socket.emit('edit message', { id: msg._id || msg.id, text: newText.trim(), room: currentRoom });
      msgDiv.childNodes.forEach(n => { if (n.nodeType === 3) n.textContent = ` ${newText}`; });
      closeAllMenus();
    }
  });

  const delBtn = document.createElement('button');
  delBtn.textContent = '🗑️ Delete';
  delBtn.addEventListener('click', () => {
    if (confirm("Delete this message?")) {
      socket.emit('delete message', { id: msg._id || msg.id, room: currentRoom });
      msgDiv.remove();
      closeAllMenus();
    }
  });

  menu.appendChild(editBtn);
  menu.appendChild(delBtn);
  wrapper.appendChild(menu);

  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllMenus();
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
  });

  msgDiv.appendChild(wrapper);
}

// ---------------- Close all menus ----------------
function closeAllMenus() {
  document.querySelectorAll('.reaction-menu, .msg-menu').forEach(menu => {
    menu.style.display = 'none';
  });
}

// ---------------- Global click to close menus ----------------
document.addEventListener('click', (e) => {
  if (!e.target.closest('.reaction-container') && !e.target.closest('.msg-menu-wrapper')) {
    closeAllMenus();
  }
});
