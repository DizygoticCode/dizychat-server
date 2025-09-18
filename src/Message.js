const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  room: { type: String, required: true },
  user: { type: String, required: true },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  status: { type: String, default: 'sent' }
});

module.exports = mongoose.model('Message', messageSchema);
