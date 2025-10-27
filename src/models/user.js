const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 60,
  },
  displayName: {
    type: String,
    trim: true,
    maxlength: 80,
  },
  passwordHash: {
    type: String,
    required: true,
  },
  roles: {
    type: [String],
    default: [],
  },
  lastSeenAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

userSchema.index({ username: 1 }, { unique: true });

module.exports = mongoose.model('User', userSchema);
