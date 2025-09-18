const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
  },
});

app.use(cors());
app.use(express.static('public')); // Serve static files like emoji.json

let messages = [];

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Send all previous messages to the new user
  socket.emit('previous messages', messages);

  // Handle incoming chat messages
  socket.on('chat message', (msg) => {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const message = { ...msg, timestamp, status: 'sent', id: Date.now() };
    messages.push(message);
    io.emit('chat message', message); // Broadcast to all clients
  });

  // Handle message read status
  socket.on('read message', (id) => {
    const message = messages.find((msg) => msg.id === id);
    if (message) {
      message.status = 'read';
      io.emit('message status', { id, status: 'read' });
    }
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
