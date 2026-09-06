'use strict';

const mongoose = require('mongoose');

const pushRoomSubscriptionSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    match: /^[a-f0-9]{24}$/i,
    index: true,
  },
  deviceId: {
    type: String,
    required: true,
    trim: true,
    maxlength: 128,
  },
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
}, {
  timestamps: true,
});

pushRoomSubscriptionSchema.index(
  { sessionId: 1, deviceId: 1, room: 1 },
  { unique: true },
);

module.exports = mongoose.models.PushRoomSubscription
  || mongoose.model('PushRoomSubscription', pushRoomSubscriptionSchema);
