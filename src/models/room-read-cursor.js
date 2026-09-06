'use strict';

const mongoose = require('mongoose');

const roomReadCursorSchema = new mongoose.Schema({
  canonicalUsername: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true,
  },
  room: {
    type: String,
    required: true,
    trim: true,
    maxlength: 80,
    index: true,
  },
  messageId: {
    type: String,
    required: true,
    match: /^[a-f0-9]{24}$/i,
  },
  messageTimestamp: {
    type: Date,
    required: true,
  },
}, {
  timestamps: true,
});

roomReadCursorSchema.index({ canonicalUsername: 1, room: 1 }, { unique: true });

module.exports = mongoose.models.RoomReadCursor
  || mongoose.model('RoomReadCursor', roomReadCursorSchema);
