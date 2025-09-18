import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Message from './src/models/Message.js';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;

// ---------------- MongoDB ----------------
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('🟢 Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// ---------------- Middleware ----------------
app.use(express.json());
app.use(express.static('public'));

// ---------------- Socket.IO ----------------
io.on('connection', (socket) => {
  console.log('A user connected');

  socket.on('join room', (room) => {
    socket.join(room);
    console.log(`User joined room: ${room}`);
  });

  // Handle chat messages
  socket.on('chat message', async (msg) => {
    try {
      const message = new Message({
        room: msg.room,
        user: msg.user,
        text: msg.text,
        timestamp: new Date(), // <-- Server sets the proper timestamp
        status: 'sent'
      });

      await message.save();

      io.to(msg.room).emit('chat message', {
        id: message._id,
        room: msg.room,
        user: message.user,
        text: message.text,
        timestamp: message.timestamp,
        status: message.status
      });
    } catch (err) {
      console.error('Error saving message:', err);
    }
  });

  // Handle typing events
  socket.on('typing', (username) => {
    // Emit to all other users in the room
    socket.broadcast.emit('typing', [username]);
  });

  socket.on('stop typing', (username) => {
    socket.broadcast.emit('typing', []);
  });

  socket.on('read message', async ({ room, id }) => {
    try {
      const msg = await Message.findById(id);
      if (msg) {
        msg.status = 'read';
        await msg.save();
        io.to(room).emit('message status', { id: msg._id, status: 'read' });
      }
    } catch (err) {
      console.error('Error updating message status:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected');
  });
});

// ---------------- Start Server ----------------
server.listen(PORT, () => {
  console.log(`🟢 Server running on port ${PORT}`);
});
