const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });
const Message = require('./src/models/Message');
require('dotenv').config();

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('🟢 MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

app.use(cors());
app.use(express.static('public'));

app.get('/', (req, res) => res.sendFile(__dirname + '/public/index.html'));

const typingUsers = {};

io.on('connection', (socket) => {
  console.log('A user connected');

  socket.on('join room', async (room) => {
    socket.join(room);

    if (!typingUsers[room]) typingUsers[room] = [];

    // Send last 50 messages
    const history = await Message.find({ room }).sort({ timestamp: 1 }).limit(50);
    socket.emit('chat history', history);
  });

  socket.on('chat message', async (msg) => {
    msg.timestamp = new Date();
    msg.status = 'sent';

    // Save to MongoDB
    const messageDoc = new Message(msg);
    await messageDoc.save();

    io.to(msg.room).emit('chat message', msg);
  });

  socket.on('typing', (username, room) => {
    if (!typingUsers[room].includes(username)) typingUsers[room].push(username);
    io.to(room).emit('typing', typingUsers[room]);
  });

  socket.on('stop typing', (username, room) => {
    typingUsers[room] = typingUsers[room].filter(u => u !== username);
    io.to(room).emit('typing', typingUsers[room]);
  });

  socket.on('read message', async ({ room, id }) => {
    await Message.findByIdAndUpdate(id, { status: 'read' });
    io.to(room).emit('message status', { id, status: 'read' });
  });

  socket.on('disconnect', () => console.log('A user disconnected'));
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`🟢 Server running on port ${PORT}`));
