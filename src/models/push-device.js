'use strict';

const mongoose = require('mongoose');

const pushDeviceSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    match: /^[a-f0-9]{24}$/i,
    index: true,
  },
  canonicalUsername: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true,
  },
  deviceId: {
    type: String,
    required: true,
    trim: true,
    maxlength: 128,
  },
  fcmToken: {
    type: String,
    required: true,
  },
  deviceLabel: {
    type: String,
    default: 'Android',
    trim: true,
    maxlength: 120,
  },
  platform: {
    type: String,
    enum: ['android'],
    default: 'android',
  },
  suppressionLeaseExpiresAt: {
    type: Date,
    default: null,
    index: true,
  },
  tokenRegisteredAt: {
    type: Date,
    required: true,
  },
  disabledAt: {
    type: Date,
    default: null,
    index: true,
  },
  disabledReason: {
    type: String,
    default: '',
    maxlength: 120,
  },
}, {
  timestamps: true,
});

pushDeviceSchema.index({ sessionId: 1, deviceId: 1 }, { unique: true });
pushDeviceSchema.index(
  { fcmToken: 1 },
  { unique: true, partialFilterExpression: { disabledAt: null } },
);

module.exports = mongoose.models.PushDevice || mongoose.model('PushDevice', pushDeviceSchema);
