// ===== DIZYCHAT SUPERNOVA × PSYBIN FUSION =====
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');
const sanitizeHtml = require('sanitize-html');
const Message = require('./src/models/message');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'Dizygotic';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

mongoose.connect(MONGO_URI).then(() => console.log('[Mongo] Connected')).catch(err => console.error('[Mongo] Error:', err));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

function requireAdmin(socket) {
  if (!socket.isAdmin) {
    socket.emit('toast', { type: 'warn', text: '🚫 Admin only command.' });
    return false;
  }
  return true;
}

io.on('connection', socket => {
  console.log('[Socket] Connected', socket.id);
  socket.isAdmin = false;

  socket.on('join room', async ({ room, username }) => {
    if (!room || !username) return;
    socket.join(room);
    socket.currentRoom = room;
    socket.username = username;
    console.log(`[Join] ${username} joined ${room}`);

    const messages = await Message.find({ room }).sort({ timestamp: 1 });
    socket.emit('load messages', messages);

    io.to(room).emit('user joined', username);
  });

  // ----- Admin Auth -----
  socket.on('admin auth', ({ room, username, adminPassword }) => {
    try {
      const _user = username || socket.username;
      if (_user === ADMIN_USERNAME && adminPassword && adminPassword === ADMIN_PASSWORD) {
        socket.isAdmin = true;
        socket.emit('admin status', { isAdmin: true });
        console.log(`[Admin] ${_user} authenticated`);
      } else {
        socket.isAdmin = false;
        socket.emit('admin status', { isAdmin: false });
      }
    } catch (e) { console.log('[Admin auth error]', e); }
  });

  // ----- New message -----
  socket.on('chat message', async msg => {
    const cleanText = sanitizeHtml(msg.text);
    const message = new Message({
      room: msg.room,
      user: msg.user,
      text: cleanText,
      timestamp: new Date()
    });
    await message.save();
    io.to(msg.room).emit('chat message', message);
    console.log(`[Message] ${msg.user}: ${cleanText}`);
  });

  // ----- Typing Indicator -----
  socket.on('typing', data => socket.to(data.room).emit('typing', data));

  // ----- Announcement -----
  socket.on('announce', ({ room, text }) => {
    if (!requireAdmin(socket)) return;
    const clean = sanitizeHtml(text || '', { allowedTags: [], allowedAttributes: {} });
    io.to(room).emit('announcement', { text: clean, at: new Date().toISOString(), by: socket.username || 'Admin' });
    console.log('[Announce]', room, clean);
  });

  // ----- Moderation -----
  socket.on('moderate', ({ room, cmd, target }) => {
    if (!requireAdmin(socket)) return;
    if (!room) return;

    if (cmd === 'ban' && target) {
      if (!global.roomBans) global.roomBans = new Map();
      if (!roomBans.has(room)) roomBans.set(room, new Set());
      roomBans.get(room).add(target);
      io.to(room).emit('toast', { type: 'warn', text: `${target} was banned.` });
      console.log('[Moderate] ban', target, 'in', room);
    }

    if (cmd === 'kick' && target) {
      for (const [id, s] of io.of('/').sockets) {
        if (s.currentRoom === room && s.username === target) {
          s.leave(room);
          io.to(room).emit('toast', { type: 'warn', text: `${target} was kicked.` });
          s.emit('join error', 'You were kicked from the room.');
          console.log('[Moderate] kick', target, 'from', room);
        }
      }
    }
  });

  socket.on('disconnect', () => console.log('[Socket] Disconnected', socket.id));
});

server.listen(PORT, () => console.log(`[Server] Listening on ${PORT}`));
