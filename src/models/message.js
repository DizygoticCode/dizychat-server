// src/models/message.js
const mongoose = require('mongoose');

// ✅ Define reactions as a sub-schema
const reactionSchema = new mongoose.Schema({
  user: { type: String, required: true },
  emoji: { type: String, required: true }
}, { _id: false }); // no separate _id for reactions

// ✅ Main message schema
const messageSchema = new mongoose.Schema({
  room: { type: String, required: true, index: true },  // index for fast room queries
  user: { type: String, required: true, index: true },  // index to query by user
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now, index: true }, // index for sorting/pagination
  status: { type: String, enum: ["sent", "delivered", "read"], default: "sent" },
  reactions: { type: [reactionSchema], default: [] },   // structured reactions
  pinned: { type: Boolean, default: false },            // pin messages
  starredBy: { type: [String], default: [] }            // list of users who starred it
});

// ✅ Indexes
messageSchema.index({ text: "text" });                  // full-text search
messageSchema.index({ room: 1, timestamp: -1 });        // fast room queries sorted by time

// ✅ Virtual field for chat.js compatibility
messageSchema.virtual('time').get(function() {
  return this.timestamp;
});

messageSchema.set('toJSON', { virtuals: true });
messageSchema.set('toObject', { virtuals: true });

// ✅ Export Model
module.exports = mongoose.model('Message', messageSchema);
