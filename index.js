const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.static('public'));

function generateId() {
  return '_' + Math.random().toString(36).substr(2, 9);
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join room
  socket.on('join room', (room) => {
    socket.join(room);
    console.log(`${socket.id} joined room ${room}`);
  });

  // Chat messages
  socket.on('chat message', ({ room, user, text }) => {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msg = { id: generateId(), user, text, timestamp, status: 'sent' };

    io.to(room).emit('chat message', msg); // only users in this room
    socket.emit('message status', { id: msg.id, status: 'delivered' }); // sender sees delivered
  });

  // Read message
  socket.on('read message', ({ room, id }) => {
    io.to(room).emit('message status', { id, status: 'read' });
  });

  socket.on('disconnect', () => console.log('User disconnected:', socket.id));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🟢 Server running on port ${PORT}`));
