const mongoose = require('mongoose');

const muteSchema = new mongoose.Schema({
  user: { type: String, required: true },
  expiresAt: { type: Date, default: null },
}, { _id: false });

const roomConfigSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    maxlength: 80,
  },
  password: {
    type: String,
    default: '',
  },
  bans: {
    type: [String],
    default: [],
  },
  blocks: {
    type: [String],
    default: [],
  },
  mutes: {
    type: [muteSchema],
    default: [],
  },
  metadata: {
    topic: { type: String, default: '' },
  },
}, {
  timestamps: true,
});

roomConfigSchema.index({ name: 1 }, { unique: true });

module.exports = mongoose.model('RoomConfig', roomConfigSchema);
