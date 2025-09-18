const socket = io();

const messagesContainer = document.getElementById('messages');
const input = document.getElementById('input');
const usernameInput = document.getElementById('username');
const emojiPicker = document.getElementById('emoji-picker');

let username = 'User' + Math.floor(Math.random() * 1000);

usernameInput.addEventListener('input', (e) => {
  username = e.target.value || 'User' + Math.floor(Math.random() * 1000);
});

input.addEventListener('input', () => {
  socket.emit('typing', username);
});

socket.on('chat message', (msg) => {
  displayMessage(msg);
});

socket.on('previous messages', (msgs) => {
  msgs.forEach(displayMessage);
});

socket.on('message status', ({ id, status }) => {
  const messageElement = document.querySelector(`.message[data-id='${id}']`);
  if (messageElement) {
    messageElement.querySelector('.status').textContent = status;
  }
});

function displayMessage(msg) {
  const div = document.createElement('div');
  div.classList.add('message');
  div.classList.add(msg.user === username ? 'self' : 'other');
  div.dataset.id = msg.id;

  div.innerHTML = `
    <strong>${msg.user}</strong>: ${msg.text}
    <span class="time">${msg.timestamp}</span>
    <span class="status">${statusIcon(msg.status)}</span>
  `;

  messagesContainer.appendChild(div);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function statusIcon(status) {
  switch (status) {
    case 'sent':
      return '✓';
    case 'delivered':
      return '✓✓';
    case 'read':
      return '✓✓✔';
    default:
      return '';
  }
}

function sendMessage() {
  const text = input.value.trim();
  if (text) {
    const message = { user: username, text };
    socket.emit('chat message', message);
    input.value = '';
  }
}

function sendTypingStatus() {
  socket.emit('typing', username);
}

function handleEmojiClick(emoji) {
  input.value += emoji;
  input.focus();
}

socket.on('typing', (user) => {
  console.log(`${user} is typing...`);
});
