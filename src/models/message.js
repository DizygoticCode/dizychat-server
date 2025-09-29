// src/models/message.js
const mongoose = require('mongoose');

const reactionSchema = new mongoose.Schema({
  user: { type: String, required: true },
  emoji: { type: String, required: true }
}, { _id: false }); // no separate _id for reactions

const messageSchema = new mongoose.Schema({
  room: { type: String, required: true },
  user: { type: String, required: true },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  status: { type: String, enum: ["sent", "delivered", "read"], default: "sent" },
  reactions: { type: [reactionSchema], default: [] } // store reactions
});

module.exports = mongoose.model('Message', messageSchema);
