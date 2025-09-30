// src/models/message.js
const mongoose = require('mongoose');

const reactionSchema = new mongoose.Schema({
  user: { type: String, required: true },
  emoji: { type: String, required: true }
}, { _id: false }); // no separate _id for reactions

const messageSchema = new mongoose.Schema({
  room: { type: String, required: true, index: true }, // index for fast room queries
  user: { type: String, required: true, index: true }, // index to query by user
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now, index: true }, // index for sorting/pagination
  status: { type: String, enum: ["sent", "delivered", "read"], default: "sent" },
  reactions: { type: [reactionSchema], default: [] }
});

// ✅ Full-text search index (allows searching in messages)
messageSchema.index({ text: "text" });

// Optional: compound index for frequent queries like "all messages in a room sorted by time"
messageSchema.index({ room: 1, timestamp: -1 });

module.exports = mongoose.model('Message', messageSchema);
