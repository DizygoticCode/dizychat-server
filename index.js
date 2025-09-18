const express = require('express');
const cors = require('cors');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: { origin: "*" } // allow connections from any front-end
});

app.use(cors());

// Test route
app.get('/', (req, res) => {
  res.send('🟢 Dizygotic Chat Server is running!');
});

// Handle socket connections
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('chat message', (msg) => {
    console.log('Message received:', msg);
    io.emit('chat message', msg); // broadcast to all clients
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Use Render PORT env var
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`🟢 Server running on port ${PORT}`);
});
