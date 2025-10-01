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
const messageSchema = new mongoose.Schema({
  room: String,
  user: String,
  text: String,
  timestamp: { type: Date, default: Date.now },
  reactions: [{ user: String, emoji: String }],
  pinned: { type: Boolean, default: false },
  starredBy: [String]  // list of usernames who starred this
});
const messageSchema = new mongoose.Schema({
  user: String,
  text: String,
  room: String,
  timestamp: { type: Date, default: Date.now },
  reactions: [{ user: String, emoji: String }],
  status: { type: String, default: "delivered" },
  pinned: { type: Boolean, default: false }   // ✅ New field
});

messageSchema.index({ text: 'text' }); // keep full-text search

module.exports = mongoose.model('Message', messageSchema);


// ✅ Full-text search index (allows searching in messages)
messageSchema.index({ text: "text" });

// Optional: compound index for frequent queries like "all messages in a room sorted by time"
messageSchema.index({ room: 1, timestamp: -1 });

module.exports = mongoose.model('Message', messageSchema);
