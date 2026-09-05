'use strict';

const mongoose = require('mongoose');

const mobileSessionSchema = new mongoose.Schema({
  tokenHash: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true,
  },
  canonicalUsername: {
    type: String,
    required: true,
    index: true,
    trim: true,
    lowercase: true,
  },
  userId: {
    type: String,
    default: '',
  },
  deviceLabel: {
    type: String,
    default: 'Android',
    maxlength: 120,
  },
  revokedAt: {
    type: Date,
    default: null,
    index: true,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.models.MobileSession || mongoose.model('MobileSession', mobileSessionSchema);
