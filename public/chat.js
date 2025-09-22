// ---------------- DOM Elements ----------------
const usernamePrompt = document.getElementById('username-prompt'); 
const joinBtn = document.getElementById('join-btn');
const usernameInput = document.getElementById('username-input');
const roomInput = document.getElementById('room-input');
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

let currentUser = '';
let currentRoom = '';
let socket;
let typingTimeout;
let darkMode = false;

// ---------------- Landing Page Prefill ----------------
const urlParams = new URLSearchParams(window.location.search);
const prefillRoom = urlParams.get("room");
if (prefillRoom) {
  roomInput.value = prefillRoom;
}

// ---------------- Join Chat ----------------
joinBtn.addEventListener("click", () => {
  const username = usernameInput.value.trim();
  const room = roomInput.value.trim();

  if (!username || !room) return alert("Please enter both username and room name.");

  currentUser = username;
  currentRoom = room;

  usernamePrompt.style.display = "none";
  chatContainer.style.display = "flex";
  roomNameSpan.textContent = room;

  // ---------------- Socket.IO ----------------
  socket = io();
  socket.emit("join room", room);
  socket.emit("get history", room);

  // Typing indicator
  input.addEventListener("input", () => {
    socket.emit("typing", currentUser);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit("stop typing", currentUser), 1000);
  });

  // Send message
  form.addEventListener("submit", e => {
    e.preventDefault();
    if (!input.value) return;
    const msgData = { room: currentRoom, user: currentUser, text: input.value, timestamp: new Date() };
    socket.emit('chat message', msgData);
    input.value = '';
    input.focus();
  });

  // Receive messages
  socket.on('chat message', msg => displayMessage(msg));

  // Room history
  socket.on('room history', msgs => msgs.forEach(msg => displayMessage(msg)));

  // Typing bubble
  socket.on('typing', users => {
    const others = users.filter(u => u !== currentUser);
    typingBubble.style.display = others.length ? 'block' : 'none';
    typingBubble.textContent = others.length ? `${others.join(', ')} is typing...` : '';
  });

  // Message status
  socket.on('message status', ({ id, status }) => {
    const msgDiv = document.querySelector(`.message[data-id='${id}'] .status`);
    if (msgDiv) msgDiv.textContent = statusIcon(status);
  });
});

// ---------------- Display Messages ----------------
function displayMessage(msg) {
  const div = document.createElement('div');
  div.classList.add('message', msg.user === currentUser ? 'self' : 'other');
  div.dataset.id = msg._id || msg.id;

  const meta = document.createElement('div');
  meta.classList.add('meta');
  meta.textContent = `[${new Date(msg.timestamp).toLocaleTimeString()}] ${msg.user}`;
  div.appendChild(meta);

  div.appendChild(document.createTextNode(` ${msg.text}`));

  const statusSpan = document.createElement('span');
  statusSpan.classList.add('status');
  statusSpan.textContent = statusIcon(msg.status || 'sent');
  div.appendChild(statusSpan);

  messages.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'end' });

  if (msg.user !== currentUser) socket.emit('read message', { room: currentRoom, id: msg._id || msg.id });
}

// ---------------- Emoji Picker ----------------
// Built-in fallback emojis (in case emoji.json fails to load)
const fallbackEmojis = [
  // Faces
  { char: "😀", name: "grinning" },
  { char: "😁", name: "beaming" },
  { char: "😂", name: "joy" },
  { char: "🤣", name: "rofl" },
  { char: "😃", name: "smiley" },
  { char: "😄", name: "smile" },
  { char: "😅", name: "sweat_smile" },
  { char: "😆", name: "laughing" },
  { char: "😊", name: "blush" },
  { char: "😇", name: "innocent" },
  { char: "🙂", name: "slightly_smile" },
  { char: "🙃", name: "upside_down" },
  { char: "😉", name: "wink" },
  { char: "😌", name: "relieved" },
  { char: "😍", name: "heart_eyes" },
  { char: "😘", name: "kissing_heart" },
  { char: "😗", name: "kissing" },
  { char: "😙", name: "kissing_smile" },
  { char: "😚", name: "kissing_closed_eyes" },
  { char: "😎", name: "sunglasses" },
  { char: "🤩", name: "star_struck" },
  { char: "🥳", name: "partying" },
  { char: "😡", name: "angry" },
  { char: "😱", name: "scream" },
  { char: "😭", name: "cry" },
  { char: "😢", name: "sad" },
  { char: "😴", name: "sleeping" },
  { char: "🤯", name: "mind_blown" },

  // Gestures
  { char: "👍", name: "thumbs_up" },
  { char: "👎", name: "thumbs_down" },
  { char: "👏", name: "clap" },
  { char: "🙏", name: "pray" },
  { char: "✌️", name: "victory" },
  { char: "🤞", name: "fingers_crossed" },
  { char: "🤟", name: "love_you" },
  { char: "🤘", name: "rock_on" },
  { char: "👌", name: "ok" },
  { char: "🤙", name: "call_me" },

  // Hearts & Symbols
  { char: "❤️", name: "red_heart" },
  { char: "💛", name: "yellow_heart" },
  { char: "💚", name: "green_heart" },
  { char: "💙", name: "blue_heart" },
  { char: "💜", name: "purple_heart" },
  { char: "🖤", name: "black_heart" },
  { char: "💔", name: "broken_heart" },
  { char: "💯", name: "100" },
  { char: "🔥", name: "fire" },
  { char: "⭐", name: "star" },
  { char: "✨", name: "sparkles" },
  { char: "⚡", name: "zap" },
  { char: "☀️", name: "sun" },
  { char: "🌙", name: "moon" },
  { char: "💤", name: "zzz" },
  { char: "✅", name: "check" },
  { char: "❌", name: "cross" },

  // Food
  { char: "🍕", name: "pizza" },
  { char: "🍔", name: "burger" },
  { char: "🍟", name: "fries" },
  { char: "🌭", name: "hotdog" },
  { char: "🌮", name: "taco" },
  { char: "🌯", name: "burrito" },
  { char: "🥗", name: "salad" },
  { char: "🍎", name: "apple" },
  { char: "🍌", name: "banana" },
  { char: "🍉", name: "watermelon" },
  { char: "🍓", name: "strawberry" },
  { char: "🍺", name: "beer" },
  { char: "☕", name: "coffee" },
  { char: "🍷", name: "wine" },
  { char: "🍣", name: "sushi" },
  { char: "🍩", name: "donut" },

  // Animals
  { char: "🐶", name: "dog" },
  { char: "🐱", name: "cat" },
  { char: "🐭", name: "mouse" },
  { char: "🐹", name: "hamster" },
  { char: "🐰", name: "rabbit" },
  { char: "🦊", name: "fox" },
  { char: "🐻", name: "bear" },
  { char: "🐼", name: "panda" },
  { char: "🐨", name: "koala" },
  { char: "🐯", name: "tiger" },

  // Travel & Objects
  { char: "🚗", name: "car" },
  { char: "✈️", name: "airplane" },
  { char: "🚀", name: "rocket" },
  { char: "🏠", name: "house" },
  { char: "💻", name: "laptop" },
  { char: "📱", name: "phone" },
  { char: "📷", name: "camera" },
  { char: "🎮", name: "video_game" },
  { char: "🎵", name: "music" },
  { char: "⚽", name: "soccer" },
  { char: "🏀", name: "basketball" }
];


// Load emoji.json or fallback if it fails
async function loadEmojis() {
  try {
    const res = await fetch("/emoji.json");
    if (!res.ok) throw new Error("Failed to fetch emoji.json");
    const emojis = await res.json();
    renderEmojiPicker(emojis);
  } catch (err) {
    console.error("Emoji picker failed to load from emoji.json, using fallback:", err);
    renderEmojiPicker(fallbackEmojis);
  }
}

// Render emojis into picker
function renderEmojiPicker(emojis) {
  emojiPicker.innerHTML = "";
  emojis.forEach(e => {
    const span = document.createElement("span");
    span.textContent = e.char;
    span.title = e.name;
    span.classList.add("emoji");
    span.addEventListener("click", () => insertAtCursor(input, e.char));
    emojiPicker.appendChild(span);
  });
}

// Insert emoji at cursor
function insertAtCursor(input, text) {
  const start = input.selectionStart;
  const end = input.selectionEnd;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  input.selectionStart = input.selectionEnd = start + text.length;
  input.focus();
}

// Toggle picker visibility
emojiBtn.addEventListener('click', e => {
  e.stopPropagation();
  emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'flex' : 'none';
});
document.addEventListener('click', () => emojiPicker.style.display = 'none');

// Run it on load
loadEmojis();

// ---------------- Status Icon ----------------
function statusIcon(status) {
  switch(status){
    case 'sent': return '✓';
    case 'delivered': return '✓✓';
    case 'read': return '✓✓✔';
    default: return '';
  }
}

// ---------------- Share Chat Link ----------------
shareBtn.addEventListener("click", () => {
  const nickname = currentUser || prompt("Enter your nickname to share the room:", "Guest") || "Guest";
  const fullURL = `${window.location.origin}?room=${encodeURIComponent(currentRoom)}&nickname=${encodeURIComponent(nickname)}`;
  navigator.clipboard.writeText(fullURL)
    .then(() => alert("Room link copied! Share it to join the same room."))
    .catch(() => alert(`Room link: ${fullURL}`));
});

// ---------------- Dark Mode ----------------
toggleThemeBtn.addEventListener("click", () => {
  darkMode = !darkMode;
  document.body.classList.toggle("dark", darkMode);
  toggleThemeBtn.textContent = darkMode ? "☀️" : "🌙";
});
