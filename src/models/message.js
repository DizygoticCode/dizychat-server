// src/models/message.js
const mongoose = require('mongoose');

// ✅ Define reactions as a sub-schema
const reactionSchema = new mongoose.Schema({
  user: { type: String, required: true },
  emoji: { type: String, required: true }
}, { _id: false }); // no separate _id for reactions

// ✅ Snapshot schema for replies (stored alongside message for quick lookup)
const replySnapshotSchema = new mongoose.Schema({
  id: { type: String },
  user: { type: String },
  text: { type: String },
  fileUrl: { type: String },
  fileType: { type: String },
  fileName: { type: String },
  deleted: { type: Boolean, default: false }
}, { _id: false });

// ✅ Main message schema
const messageSchema = new mongoose.Schema({
  room: { type: String, required: true, index: true },  // index for fast room queries
  user: { type: String, required: true, index: true },  // index to query by user
  text: { type: String, default: '' },
  timestamp: { type: Date, default: Date.now, index: true }, // index for sorting/pagination
  fileUrl: { type: String },
  fileType: { type: String },
  fileName: { type: String },
  status: { type: String, enum: ["sent", "delivered", "read"], default: "sent" },
  reactions: { type: [reactionSchema], default: [] },   // structured reactions
  pinned: { type: Boolean, default: false },            // pin messages
  pinnedBy: { type: String, default: "" },             // user who pinned the message
  starredBy: { type: [String], default: [] },           // list of users who starred it
  deleted: { type: Boolean, default: false },           // soft delete flag
  deletedAt: { type: Date },
  deletedBy: { type: String, default: "" },
  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
  replyToSnapshot: { type: replySnapshotSchema, default: null }
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
