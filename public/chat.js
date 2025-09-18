const usernamePrompt = document.getElementById('username-prompt');
const joinBtn = document.getElementById('join-btn');
const usernameInput = document.getElementById('username-input');
const chatContainer = document.getElementById('chat-container');
const form = document.getElementById('form');
const input = document.getElementById('input');
const messages = document.getElementById('messages');
const typingStatus = document.getElementById('typing-status');
const emojiPicker = document.getElementById('emoji-picker');
const shareBtn = document.getElementById('share-btn');

let username = '';
let socket;
let typingTimeout;

// Load emojis
fetch('emoji.json')
  .then(res => res.json())
  .then(data => {
    data.forEach(e => {
      const span = document.createElement('span');
      span.textContent = e.char;
      span.classList.add('emoji');
      span.addEventListener('click', () => input.value += e.char);
      emojiPicker.appendChild(span);
    });
  });

// Join chat
joinBtn.addEventListener('click', () => {
  username = usernameInput.value.trim();
  if (!username) return alert('Please enter a username');

  usernamePrompt.style.display = 'none';
  chatContainer.style.display = 'flex';

  socket = io();

  // Typing
  input.addEventListener('input', () => {
    socket.emit('typing', username);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit('stop typing', username), 1000);
  });

  // Send message
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!input.value) return;
    const msg = { user: username, text: input.value };
    socket.emit('chat message', msg);
    input.value = '';
  });

  // Receive messages
  socket.on('chat message', msg => displayMessage(msg));

  // Previous messages
  socket.on('previous messages', msgs => msgs.forEach(displayMessage));

  // Typing notifications
  socket.on('typing', users => {
    const others = users.filter(u => u !== username);
    typingStatus.textContent = others.length ? `${others.join(', ')} is typing...` : '';
  });

  // Status updates
  socket.on('message status', ({ id, status }) => {
    const msgDiv = document.querySelector(`.message[data-id='${id}'] .status`);
    if (msgDiv) msgDiv.textContent = statusIcon(status);
  });
});

// Display message
function displayMessage(msg) {
  const div = document.createElement('div');
  div.classList.add('message', msg.user === username ? 'self' : 'other');
  div.dataset.id = msg.id;

  const meta = document.createElement('div');
  meta.classList.add('meta');
  meta.textContent = `[${msg.timestamp}] ${msg.user}`;
  div.appendChild(meta);

  const textNode = document.createTextNode(`: ${msg.text}`);
  div.appendChild(textNode);

  const statusSpan = document.createElement('span');
  statusSpan.classList.add('status');
  statusSpan.textContent = statusIcon(msg.status || 'sent');
  div.appendChild(statusSpan);

  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;

  if (msg.user !== username) socket.emit('read message', msg.id);
}

// Status icon mapping
function statusIcon(status) {
  switch (status) {
    case 'sent': return '✓';
    case 'delivered': return '✓✓';
    case 'read': return '✓✓✔';
    default: return '';
  }
}

// Share link
shareBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(window.location.href);
  alert('Chat link copied!');
});
