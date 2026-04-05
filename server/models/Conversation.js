const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
    participantStates: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        lastReadAt: { type: Date, default: Date.now },
        unreadCount: { type: Number, default: 0, min: 0 },
      },
    ],
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    productTitle: { type: String, default: '' },
    lastMessage: { type: String, default: '' },
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

conversationSchema.index({ participants: 1, updatedAt: -1 });
conversationSchema.index({ product: 1, updatedAt: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);
