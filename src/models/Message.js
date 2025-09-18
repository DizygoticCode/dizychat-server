import mongoose from 'mongoose';

const MessageSchema = new mongoose.Schema({
  room: { type: String, required: true },
  user: { type: String, required: true },
  text: { type: String, required: true },
  timestamp: { type: String, required: true },
  status: { type: String, enum: ['sent', 'delivered', 'read'], default: 'sent' },
  reactions: { type: Map, of: Number, default: {} }
});

export default mongoose.model('Message', MessageSchema);
