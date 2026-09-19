'use strict';

const mongoose = require('mongoose');

const webPushSubscriptionSchema = new mongoose.Schema({
  canonicalUsername: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true,
  },
  endpoint: {
    type: String,
    required: true,
    trim: true,
    maxlength: 4096,
    unique: true,
  },
  p256dh: {
    type: String,
    required: true,
    trim: true,
    maxlength: 512,
  },
  auth: {
    type: String,
    required: true,
    trim: true,
    maxlength: 256,
  },
  deviceLabel: {
    type: String,
    default: 'Web',
    trim: true,
    maxlength: 120,
  },
  rooms: {
    type: [String],
    default: [],
  },
  suppressionLeaseExpiresAt: {
    type: Date,
    default: null,
    index: true,
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

webPushSubscriptionSchema.index({ canonicalUsername: 1, disabledAt: 1 });
webPushSubscriptionSchema.index({ rooms: 1, disabledAt: 1 });

module.exports = mongoose.models.WebPushSubscription
  || mongoose.model('WebPushSubscription', webPushSubscriptionSchema);
