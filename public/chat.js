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
let typingTimeout;
let socket;

joinBtn.addEventListener('click', () => {
  username = usernameInput.value.trim();
  if (!username) return alert('Please enter a username');
  
  usernamePrompt.style.display = 'none';
  chatContainer.style.display = 'flex';

  // Connect Socket.IO after username chosen
  socket = io();

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

  // Typing indicator
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
  socket.on('chat message', msg => {
    const div = document.createElement('div');
    div.classList.add('message', msg.user === username ? 'self' : 'other');
    div.innerHTML = `<strong>${msg.user}</strong>: ${msg.text} <span class="time">${msg.timestamp || ''}</span>`;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  });

  // Typing notifications
  socket.on('typing', users => {
    const others = users.filter(u => u !== username);
    typingStatus.textContent = others.length ? `${others.join(', ')} is typing...` : '';
  });
});

// Share link
shareBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(window.location.href);
  alert('Chat link copied!');
});
