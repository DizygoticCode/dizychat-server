const socket = io();
const form = document.getElementById('form');
const input = document.getElementById('input');
const usernameInput = document.getElementById('username');
const messages = document.getElementById('messages');
const typingStatus = document.getElementById('typing-status');
const emojiPicker = document.getElementById('emoji-picker');

let typingTimeout;

// Load emojis from JSON
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

// Typing indicator
input.addEventListener('input', () => {
  socket.emit('typing', usernameInput.value);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => socket.emit('stop typing', usernameInput.value), 1000);
});

// Send message
form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!input.value || !usernameInput.value) return;
  const msg = { user: usernameInput.value, text: input.value };
  socket.emit('chat message', msg);
  input.value = '';
});

// Receive messages
socket.on('chat message', (msg) => {
  const div = document.createElement('div');
  div.classList.add('message');
  div.classList.add(msg.user === usernameInput.value ? 'self' : 'other');
  div.innerHTML = `<strong>${msg.user}</strong>: ${msg.text}<span class="time">${msg.timestamp}</span>`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
});

// Typing notifications
socket.on('typing', (users) => {
  const otherUsers = users.filter(u => u !== usernameInput.value);
  typingStatus.textContent = otherUsers.length ? `${otherUsers.join(', ')} is typing...` : '';
});
