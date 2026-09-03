'use strict';

const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true,
    maxlength: 80,
  },
  passwordHash: {
    type: String,
    default: '',
  },
}, {
  timestamps: true,
});

module.exports = mongoose.models.Room || mongoose.model('Room', roomSchema);
