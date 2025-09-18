const express = require('express');
const cors = require('cors');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: { origin: "*" }
});

app.use(cors());
app.use(express.static('public')); // serve frontend files

// Test route
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/client.html');
});

const typingUsers = new Set();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Typing notifications
  socket.on('typing', (user) => {
    typingUsers.add(user);
    socket.broadcast.emit('typing', Array.from(typingUsers));
  });

  socket.on('stop typing', (user) => {
    typingUsers.delete(user);
    socket.broadcast.emit('typing', Array.from(typingUsers));
  });

  // Chat messages
  socket.on('chat message', (msg) => {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const message = { ...msg, timestamp, status: 'sent' };
    io.emit('chat message', message); // broadcast to all
  });

  socket.on('disconnect', () => {
    typingUsers.delete(socket.id);
    socket.broadcast.emit('typing', Array.from(typingUsers));
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`🟢 Server running on port ${PORT}`);
});
