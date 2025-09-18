const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.static('public'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

function generateId() { return '_' + Math.random().toString(36).substr(2, 9); }

const typingUsers = {}; // room -> Set of usernames

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  let currentRoom = '';

  socket.on('join room', (room) => {
    currentRoom = room;
    socket.join(room);
    console.log(`${socket.id} joined room ${room}`);
    if (!typingUsers[room]) typingUsers[room] = new Set();
  });

  socket.on('chat message', ({ room, user, text }) => {
    const timestamp = formatTime(new Date());
    const msg = { id: generateId(), user, text, timestamp, status: 'sent' };
    io.to(room).emit('chat message', msg);
    socket.emit('message status', { id: msg.id, status: 'delivered' });
  });

  socket.on('read message', ({ room, id }) => {
    io.to(room).emit('message status', { id, status: 'read' });
  });

  socket.on('typing', (user) => {
    if (currentRoom && typingUsers[currentRoom]) {
      typingUsers[currentRoom].add(user);
      io.to(currentRoom).emit('typing', Array.from(typingUsers[currentRoom]));
    }
  });

  socket.on('stop typing', (user) => {
    if (currentRoom && typingUsers[currentRoom]) {
      typingUsers[currentRoom].delete(user);
      io.to(currentRoom).emit('typing', Array.from(typingUsers[currentRoom]));
    }
  });

  socket.on('disconnect', () => console.log('User disconnected:', socket.id));
});

function formatTime(date) {
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2,'0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${ampm}`;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🟢 Server running on port ${PORT}`));
