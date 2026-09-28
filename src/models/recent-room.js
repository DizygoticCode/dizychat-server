'use strict';

const mongoose = require('mongoose');

const recentRoomSchema = new mongoose.Schema({
  userId: { type: String, required: true, trim: true, maxlength: 128, index: true },
  room: { type: String, required: true, trim: true, maxlength: 80 },
  lastJoinedAt: { type: Date, required: true, default: Date.now },
}, { timestamps: false });

recentRoomSchema.index({ userId: 1, room: 1 }, { unique: true });
recentRoomSchema.index({ userId: 1, lastJoinedAt: -1 });

module.exports = mongoose.models.RecentRoom || mongoose.model('RecentRoom', recentRoomSchema);
