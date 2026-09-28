'use strict';

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    trim: true,
  },
  canonicalUsername: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true,
    lowercase: true,
  },
  passwordHash: {
    type: String,
    default: '',
  },
  recentRooms: {
    type: [{
      name: { type: String, required: true, trim: true, maxlength: 80 },
      joinedAt: { type: Date, default: Date.now },
    }],
    default: [],
  },
  recoveryEmail: {
    type: String,
    default: '',
    trim: true,
    lowercase: true,
  },
  passwordResetTokenHash: {
    type: String,
    default: '',
  },
  passwordResetExpiresAt: {
    type: Date,
    default: null,
  },
  role: {
    type: String,
    enum: ['owner', 'admin', 'user'],
    default: 'user',
    required: true,
  },
  state: {
    type: String,
    enum: ['active', 'disabled', 'unclaimed'],
    default: 'unclaimed',
    required: true,
  },
  credentialSource: {
    type: String,
    enum: ['legacy-plaintext', 'legacy-scrypt', 'managed', 'self-registered', 'unclaimed'],
    default: 'unclaimed',
    required: true,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
