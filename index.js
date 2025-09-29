// ---------------- Socket.IO ----------------
let typingUsers = {};
let rooms = {}; // Store room passwords if needed: rooms[roomName] = password

// ---------------- Rate Limiting ----------------
const RATE_LIMIT_WINDOW = 2000; // 2 seconds
const MAX_MESSAGES_PER_WINDOW = 3;
const MAX_TYPING_EVENTS_PER_WINDOW = 5;

const messageTimestamps = new Map(); // socket.id => [timestamps]
const typingTimestamps = new Map();  // socket.id => [timestamps]

function canSendMessage(socketId) {
  const now = Date.now();
  if (!messageTimestamps.has(socketId)) messageTimestamps.set(socketId, []);
  const timestamps = messageTimestamps.get(socketId);
  while (timestamps.length && now - timestamps[0] > RATE_LIMIT_WINDOW) timestamps.shift();
  if (timestamps.length >= MAX_MESSAGES_PER_WINDOW) return false;
  timestamps.push(now);
  return true;
}

function canSendTyping(socketId) {
  const now = Date.now();
  if (!typingTimestamps.has(socketId)) typingTimestamps.set(socketId, []);
  const timestamps = typingTimestamps.get(socketId);
  while (timestamps.length && now - timestamps[0] > RATE_LIMIT_WINDOW) timestamps.shift();
  if (timestamps.length >= MAX_TYPING_EVENTS_PER_WINDOW) return false;
  timestamps.push(now);
  return true;
}

io.on('connection', socket => {
  console.log("A user connected");

  // ---------------- Join Room ----------------
  socket.on('join room', ({ room, password }) => {
    if (rooms[room] && rooms[room] !== password) {
      socket.emit('join error', 'Incorrect room password');
      return;
    }
    socket.join(room);
    console.log(`User joined room: ${room}`);
  });

  // ---------------- Get Room History ----------------
  socket.on('get history', async room => {
    try {
      const history = await Message.find({ room }).sort({ timestamp: 1 }).limit(50);
      socket.emit('room history', history);
    } catch (err) { console.error("Error fetching history:", err); }
  });

  // ---------------- Chat Message ----------------
  socket.on('chat message', async msgData => {
    if (!canSendMessage(socket.id)) return; // rate limit
    try {
      if (msgData.text.length > 1000) msgData.text = msgData.text.substring(0, 1000);

      const newMsg = new Message({
        ...msgData,
        timestamp: msgData.timestamp ? new Date(msgData.timestamp) : new Date(),
        reactions: msgData.reactions || []
      });
      await newMsg.save();

      io.to(msgData.room).emit('chat message', newMsg);
      io.to(msgData.room).emit('message status', { id: newMsg._id, status: 'delivered' });
    } catch (err) { console.error("Error saving message:", err); }
  });

  // ---------------- Edit Message ----------------
  socket.on('edit message', async ({ room, id, text }) => {
    try {
      const sanitized = text.length > 1000 ? text.substring(0, 1000) : text;
      const msg = await Message.findByIdAndUpdate(id, { text: sanitized }, { new: true });
      if (msg) io.to(room).emit('edit message', { id, text: msg.text });
    } catch (err) { console.error("Error editing message:", err); }
  });

  // ---------------- Read Message ----------------
  socket.on('read message', async ({ room, id }) => {
    try {
      await Message.findByIdAndUpdate(id, { status: 'read' });
      io.to(room).emit('message status', { id, status: 'read' });
    } catch (err) { console.error("Error marking as read:", err); }
  });

  // ---------------- Delete Message ----------------
  socket.on('delete message', async ({ room, id }) => {
    try {
      await Message.findByIdAndDelete(id);
      io.to(room).emit('delete message', id);
    } catch (err) { console.error("Error deleting message:", err); }
  });

  // ---------------- Add / Update Reaction ----------------
  socket.on('react message', async ({ room, id, reaction, username }) => {
    try {
      const msg = await Message.findById(id);
      if (!msg) return;

      const existingIndex = msg.reactions.findIndex(r => r.user === username);
      if (existingIndex >= 0) {
        msg.reactions[existingIndex].emoji = reaction;
      } else {
        msg.reactions.push({ user: username, emoji: reaction });
      }
      await msg.save();
      io.to(room).emit('update reactions', { id, reactions: msg.reactions });
    } catch (err) { console.error("Error updating reaction:", err); }
  });

  // ---------------- Typing ----------------
  socket.on('typing', username => {
    if (!canSendTyping(socket.id)) return; // rate limit
    typingUsers[socket.id] = username;
    io.emit('typing', Object.values(typingUsers));
  });

  socket.on('stop typing', () => {
    delete typingUsers[socket.id];
    io.emit('typing', Object.values(typingUsers));
  });

  // ---------------- Disconnect ----------------
  socket.on('disconnect', () => {
    console.log("User disconnected");
    delete typingUsers[socket.id];
  });
});
