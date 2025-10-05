// src/models/message.js
const mongoose = require('mongoose');

// ---------------- Reactions Sub-Schema ----------------
const reactionSchema = new mongoose.Schema({
  user: { type: String, required: true },
  emoji: { type: String, required: true }
}, { _id: false }); // no separate _id for reactions

// ---------------- Main Message Schema ----------------
const messageSchema = new mongoose.Schema({
  room: { type: String, required: true, index: true },
  user: { type: String, required: true, index: true },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now, index: true },
  status: { type: String, enum: ["sent", "delivered", "read"], default: "sent" },
  reactions: { type: [reactionSchema], default: [] },
  pinned: { type: Boolean, default: false },
  starredBy: { type: [String], default: [] }
});

// ---------------- Indexes ----------------
messageSchema.index({ text: "text" });             // Full-text search
messageSchema.index({ room: 1, timestamp: -1 });   // Fast room queries by time
messageSchema.index({ user: 1 });                  // Query messages by user

// ---------------- Export Model ----------------
module.exports = mongoose.model('Message', messageSchema);
