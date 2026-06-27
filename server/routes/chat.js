const express = require('express');
const mongoose = require('mongoose');

const auth = require('../middleware/auth');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const Product = require('../models/Product');

const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

let upload;
try {
  const multer = require('multer');
  upload = multer({ storage: multer.memoryStorage() });
} catch (e) {
  // multer not installed in this environment — provide a no-op fallback so server can start.
  upload = { single: () => (req, res, next) => next() };
}

const MESSAGE_UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'messages');
if (!fs.existsSync(MESSAGE_UPLOAD_DIR)) {
  fs.mkdirSync(MESSAGE_UPLOAD_DIR, { recursive: true });
}

function sortObjectIds(ids) {
  return ids.map((id) => String(id)).sort();
}

function normalizeText(text) {
  return String(text || '').trim().replace(/\s+/g, ' ');
}

function escapeRegex(input) {
  return String(input || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ensureParticipantStates(conversation) {
  if (!conversation) return;
  if (Array.isArray(conversation.participantStates) && conversation.participantStates.length > 0) {
    return;
  }

  conversation.participantStates = (conversation.participants || []).map((id) => ({
    user: id && typeof id === 'object' && id._id ? id._id : id,
    lastReadAt: new Date(),
    unreadCount: 0,
  }));
}

async function getExistingConversation(participantIdsSorted, productId) {
  const query = {
    participants: { $all: participantIdsSorted },
    $expr: { $eq: [{ $size: '$participants' }, participantIdsSorted.length] },
  };

  if (productId) {
    query.product = productId;
  } else {
    query.product = null;
  }

  return Conversation.findOne(query);
}

// POST /api/chat/conversations/ensure
router.post('/conversations/ensure', auth, async (req, res) => {
  try {
    const buyerId = String(req.user._id);
    const rawSellerId = req.body?.sellerId;
    const sellerIdFromBody = typeof rawSellerId === 'string'
      ? rawSellerId
      : (rawSellerId && typeof rawSellerId === 'object' && rawSellerId._id ? String(rawSellerId._id) : '');
    const sellerName = String(req.body?.sellerName || '').trim();
    const productId = req.body?.productId ? String(req.body.productId) : '';
    const productTitle = String(req.body?.productTitle || '').trim();
    let product = null;

    if (productId && mongoose.Types.ObjectId.isValid(productId)) {
      product = await Product.findById(productId).select('_id title seller sellerName');
      if (!product) {
        return res.status(404).json({ message: 'Product not found' });
      }
    }

    let sellerUser = null;

    if (sellerIdFromBody && mongoose.Types.ObjectId.isValid(sellerIdFromBody)) {
      sellerUser = await User.findById(sellerIdFromBody).select('_id name avatarUrl');
    }

    if (!sellerUser && sellerName) {
      const exactNameRegex = new RegExp(`^${escapeRegex(sellerName)}$`, 'i');
      sellerUser = await User.findOne({ name: { $regex: exactNameRegex } }).select('_id name avatarUrl');
    }

    // Most reliable fallback: derive seller from the product itself.
    if (!sellerUser && product?.seller) {
      sellerUser = await User.findById(product.seller).select('_id name avatarUrl');
    }

    if (!sellerUser && product?.sellerName) {
      const productSellerRegex = new RegExp(`^${escapeRegex(String(product.sellerName))}$`, 'i');
      sellerUser = await User.findOne({ name: { $regex: productSellerRegex } }).select('_id name avatarUrl');
    }

    if (!sellerUser) {
      return res.status(404).json({ message: 'Seller not found for this product' });
    }

    const sellerId = String(sellerUser._id);
    if (sellerId === buyerId) {
      return res.status(400).json({ message: 'Cannot create conversation with yourself' });
    }

    const participantIdsSorted = sortObjectIds([buyerId, sellerId]);
    let conversation = await getExistingConversation(participantIdsSorted, product ? product._id : null);

    if (!conversation) {
      conversation = await Conversation.create({
        participants: participantIdsSorted,
        participantStates: participantIdsSorted.map((id) => ({
          user: id,
          lastReadAt: new Date(),
          unreadCount: 0,
        })),
        product: product ? product._id : null,
        productTitle: product ? String(product.title || '') : productTitle,
        lastMessage: '',
        lastMessageAt: new Date(),
      });
    } else {
      ensureParticipantStates(conversation);
      await conversation.save();
    }

    const otherUser = {
      id: String(sellerUser._id),
      name: sellerUser.name,
      avatarUrl: sellerUser.avatarUrl || '',
    };

    res.json({
      conversation: {
        id: String(conversation._id),
        otherUser,
        product: product
          ? {
              id: String(product._id),
              title: product.title,
            }
          : null,
        lastMessage: conversation.lastMessage || '',
        lastMessageAt: conversation.lastMessageAt || conversation.updatedAt,
        unreadCount: 0,
        updatedAt: conversation.updatedAt,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Server error' });
  }
});

// GET /api/chat/conversations
router.get('/conversations', auth, async (req, res) => {
  try {
    const me = String(req.user._id);

    const conversations = await Conversation.find({ participants: me })
      .sort({ updatedAt: -1 })
      .populate('participants', 'name avatarUrl')
      .populate('product', 'title seller')
      .lean();

    const formatted = conversations.map((conversation) => {
      ensureParticipantStates(conversation);
      const state = (conversation.participantStates || []).find((entry) => String(entry.user) === me);
      
      // Hide conversation if it has been cleared/deleted by the user and there are no new messages since then
      if (state && state.clearedAt && conversation.lastMessageAt && new Date(conversation.lastMessageAt) <= new Date(state.clearedAt)) {
        return null;
      }

      const other = (conversation.participants || []).find((user) => String(user._id) !== me);
      const isSellerSide = Boolean(conversation.product?.seller && String(conversation.product.seller) === me);

      return {
        id: String(conversation._id),
        otherUser: other
          ? {
              id: String(other._id),
              name: other.name,
              avatarUrl: other.avatarUrl || '',
            }
          : {
              id: '',
              name: 'Unknown user',
              avatarUrl: '',
            },
        product: conversation.product
          ? {
              id: String(conversation.product._id),
              title: conversation.product.title,
            }
          : (conversation.productTitle
              ? {
                  id: '',
                  title: conversation.productTitle,
                }
              : null),
        lastMessage: conversation.lastMessage || '',
        lastMessageAt: conversation.lastMessageAt || conversation.updatedAt,
        unreadCount: Number(state?.unreadCount || 0),
        role: isSellerSide ? 'seller_inbox' : 'buyer_orders',
        updatedAt: conversation.updatedAt,
      };
    });

    res.json({ conversations: formatted.filter(Boolean) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Server error' });
  }
});

// GET /api/chat/conversations/:id/messages
router.get('/conversations/:id/messages', auth, async (req, res) => {
  try {
    const me = String(req.user._id);
    const conversationId = String(req.params.id || '');

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ message: 'Invalid conversation id' });
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    const isParticipant = (conversation.participants || []).some((id) => String(id) === me);
    if (!isParticipant) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    ensureParticipantStates(conversation);

    // Mark all other users' messages in this conversation as read by me
    await Message.updateMany(
      { conversation: conversationId, sender: { $ne: me }, readBy: { $ne: me } },
      { $addToSet: { readBy: me } }
    );

    const query = {
      conversation: conversationId,
      deletedBy: { $ne: me }
    };

    const myState = (conversation.participantStates || []).find((entry) => String(entry.user) === me);
    if (myState && myState.clearedAt) {
      query.createdAt = { $gt: myState.clearedAt };
    }

    const messages = await Message.find(query)
      .sort({ createdAt: 1 })
      .select('_id sender text createdAt replyTo reactions readBy')
      .populate({
        path: 'replyTo',
        select: 'text sender createdAt',
        populate: { path: 'sender', select: 'name' }
      })
      .lean();

    const formatted = messages.map((message) => {
      const text = message.text || '';
      const isImage = /\/uploads\/messages\/.*\.(jpg|jpeg|png|webp)$/i.test(String(text));
      const isVideo = /\/uploads\/messages\/.*\.(mp4|mov|m4v|webm|avi)$/i.test(String(text));

      let replyToData = null;
      if (message.replyTo) {
        const replyText = message.replyTo.text || '';
        const replyIsImage = /\/uploads\/messages\/.*\.(jpg|jpeg|png|webp)$/i.test(String(replyText));
        const replyIsVideo = /\/uploads\/messages\/.*\.(mp4|mov|m4v|webm|avi)$/i.test(String(replyText));
        replyToData = {
          id: String(message.replyTo._id),
          text: replyText,
          senderName: message.replyTo.sender?.name || 'Someone',
          isImage: replyIsImage,
          isVideo: replyIsVideo
        };
      }

      return {
        id: String(message._id),
        text: text,
        senderId: String(message.sender),
        isMine: String(message.sender) === me,
        isImage: Boolean(isImage),
        isVideo: Boolean(isVideo),
        createdAt: message.createdAt,
        replyTo: replyToData,
        reactions: (message.reactions || []).map(r => ({
          userId: String(r.userId),
          emoji: r.emoji
        })),
        readBy: (message.readBy || []).map(id => String(id)),
      };
    });

    const myState = (conversation.participantStates || []).find((entry) => String(entry.user) === me);
    if (myState) {
      myState.unreadCount = 0;
      myState.lastReadAt = new Date();
      await conversation.save();
    }

    // Emit messages-read over Socket.IO if available
    const io = req.app.get('io');
    if (io) {
      io.to(`conv:${conversationId}`).emit('messages-read', { userId: me, conversationId });
    }

    res.json({ messages: formatted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Server error' });
  }
});

// POST /api/chat/conversations/:id/messages
// Accepts either JSON { text } or { dataUri } OR a multipart/form-data with field `image`.
router.post('/conversations/:id/messages', auth, upload.single('image'), async (req, res) => {
  try {
    const me = String(req.user._id);
    const conversationId = String(req.params.id || '');

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ message: 'Invalid conversation id' });
    }

    let text = normalizeText(req.body?.text || '');

    // If a multipart file was uploaded (field 'image'), prefer that.
    if (req.file && req.file.buffer && typeof req.file.mimetype === 'string') {
      try {
        let isImg = req.file.mimetype.startsWith('image/');
        let isVid = req.file.mimetype.startsWith('video/');

        // Fallback check based on filename extension if mimetype is generic/octet-stream
        if (!isImg && !isVid && req.file.originalname) {
          const ext = path.extname(req.file.originalname).toLowerCase();
          const imgExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
          const vidExts = ['.mp4', '.mov', '.m4v', '.webm', '.avi'];
          if (imgExts.includes(ext)) isImg = true;
          if (vidExts.includes(ext)) isVid = true;
        }

        if (isImg) {
          const buffer = req.file.buffer;
          const fileName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.jpg`;
          const outPath = path.join(MESSAGE_UPLOAD_DIR, fileName);
          await sharp(buffer).jpeg({ quality: 80, mozjpeg: true }).toFile(outPath);
          text = `${req.protocol}://${req.get('host')}/uploads/messages/${fileName}`;
        } else if (isVid) {
          const buffer = req.file.buffer;
          const ext = req.file.originalname ? path.extname(req.file.originalname) : '.mp4';
          const fileName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext || '.mp4'}`;
          const outPath = path.join(MESSAGE_UPLOAD_DIR, fileName);
          fs.writeFileSync(outPath, buffer);
          text = `${req.protocol}://${req.get('host')}/uploads/messages/${fileName}`;
        } else {
          return res.status(400).json({ message: 'Unsupported file type. Only images and videos are supported.' });
        }
      } catch (err) {
        console.error('Chat file write failed', err);
        return res.status(500).json({ message: 'Failed to process media file' });
      }
    } else {
      const b64 = req.body?.base64 || req.body?.fileBase64 || req.body?.file || null;
      const dataUri = req.body?.dataUri;
      if (!text && !dataUri && !b64) {
        return res.status(400).json({ message: 'Message text or image is required' });
      }

      // If base64 payload is provided, process it
      if (b64 && typeof b64 === 'string') {
        const mime = req.body.mimeType || req.body.mimetype || 'application/octet-stream';
        let isImg = mime.startsWith('image/');
        let isVid = mime.startsWith('video/');
        const providedName = String(req.body.filename || req.body.name || `upload-${Date.now()}`);
        const ext = path.extname(providedName).toLowerCase() || (isImg ? '.jpg' : '.mp4');

        if (!isImg && !isVid) {
          const imgExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
          const vidExts = ['.mp4', '.mov', '.m4v', '.webm', '.avi'];
          if (imgExts.includes(ext)) isImg = true;
          if (vidExts.includes(ext)) isVid = true;
        }

        if (isImg || isVid) {
          try {
            const buffer = Buffer.from(b64, 'base64');
            const fileName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
            const outPath = path.join(MESSAGE_UPLOAD_DIR, fileName);
            if (isImg) {
              await sharp(buffer).jpeg({ quality: 80, mozjpeg: true }).toFile(outPath);
            } else {
              fs.writeFileSync(outPath, buffer);
            }
            text = `${req.protocol}://${req.get('host')}/uploads/messages/${fileName}`;
          } catch (err) {
            console.error('Chat base64 write failed', err);
            return res.status(500).json({ message: 'Failed to process fallback media file' });
          }
        } else {
          return res.status(400).json({ message: 'Unsupported file type. Only images and videos are supported.' });
        }
      } else if (dataUri && typeof dataUri === 'string' && dataUri.startsWith('data:')) {
        const isVideo = dataUri.startsWith('data:video/');
        if (isVideo) {
          const m = dataUri.match(/^data:(video\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
          if (!m) return res.status(400).json({ message: 'Invalid video data' });
          const base64 = m[2];
          const buffer = Buffer.from(base64, 'base64');
          const ext = m[1].split('/')[1] || 'mp4';
          const fileName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
          const outPath = path.join(MESSAGE_UPLOAD_DIR, fileName);
          try {
            fs.writeFileSync(outPath, buffer);
            text = `${req.protocol}://${req.get('host')}/uploads/messages/${fileName}`;
          } catch (vidErr) {
            console.error('Chat video write failed', vidErr);
            return res.status(500).json({ message: 'Failed to process video' });
          }
        } else {
          const m = dataUri.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
          if (!m) return res.status(400).json({ message: 'Invalid image data' });
          const base64 = m[2];
          const buffer = Buffer.from(base64, 'base64');
          const fileName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.jpg`;
          const outPath = path.join(MESSAGE_UPLOAD_DIR, fileName);
          try {
            await sharp(buffer).jpeg({ quality: 80, mozjpeg: true }).toFile(outPath);
            text = `${req.protocol}://${req.get('host')}/uploads/messages/${fileName}`;
          } catch (imgErr) {
            console.error('Chat image write failed', imgErr);
            return res.status(500).json({ message: 'Failed to process image' });
          }
        }
      }
    }

    let replyTo = req.body?.replyTo;
    if (replyTo && mongoose.Types.ObjectId.isValid(replyTo)) {
      const repliedMsg = await Message.findById(replyTo);
      if (repliedMsg) {
        replyTo = repliedMsg._id;
      } else {
        replyTo = undefined;
      }
    } else {
      replyTo = undefined;
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    const isParticipant = (conversation.participants || []).some((id) => String(id) === me);
    if (!isParticipant) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    ensureParticipantStates(conversation);

    const message = await Message.create({
      conversation: conversation._id,
      sender: me,
      text,
      replyTo,
    });

    conversation.lastMessage = text;
    conversation.lastMessageAt = new Date();
    conversation.updatedAt = new Date();

    for (const state of conversation.participantStates || []) {
      if (String(state.user) === me) {
        state.unreadCount = 0;
        state.lastReadAt = new Date();
      } else {
        state.unreadCount = Number(state.unreadCount || 0) + 1;
      }
    }

    await conversation.save();

    // Trigger push notification to the recipient
    const recipientId = conversation.participants.find((p) => String(p) !== me);
    if (recipientId) {
      const { sendPushNotification } = require('../services/notifications');
      const senderUser = await User.findById(me).select('name');
      const senderName = senderUser?.name || 'Someone';
      const isImg = /\/uploads\/messages\/.*\.(jpg|jpeg|png|webp)$/i.test(String(text));
      const isVid = /\/uploads\/messages\/.*\.(mp4|mov|m4v|webm|avi)$/i.test(String(text));
      const bodyText = isImg ? '📷 Sent a photo' : (isVid ? '🎥 Sent a video' : text);

      sendPushNotification(
        recipientId,
        `New message from ${senderName}`,
        bodyText,
        {
          type: 'chat_message',
          conversationId: conversation._id.toString(),
          senderId: me,
        }
      ).catch((err) => console.error('Error sending chat push notification:', err));
    }

    const isImage = /\/uploads\/messages\/.*\.(jpg|jpeg|png|webp)$/i.test(String(message.text));
    const isVideo = /\/uploads\/messages\/.*\.(mp4|mov|m4v|webm|avi)$/i.test(String(message.text));

    let replyToData = null;
    if (replyTo) {
      const populatedReply = await Message.findById(replyTo).populate('sender', 'name').lean();
      if (populatedReply) {
        const replyText = populatedReply.text || '';
        const replyIsImage = /\/uploads\/messages\/.*\.(jpg|jpeg|png|webp)$/i.test(String(replyText));
        const replyIsVideo = /\/uploads\/messages\/.*\.(mp4|mov|m4v|webm|avi)$/i.test(String(replyText));
        replyToData = {
          id: String(populatedReply._id),
          text: replyText,
          senderName: populatedReply.sender?.name || 'Someone',
          isImage: replyIsImage,
          isVideo: replyIsVideo
        };
      }
    }

    const responseObj = {
      id: String(message._id),
      text: message.text,
      senderId: String(message.sender),
      isMine: false, // will be overridden by client
      isImage: Boolean(isImage),
      isVideo: Boolean(isVideo),
      createdAt: message.createdAt,
      replyTo: replyToData,
      reactions: [],
      readBy: [me],
    };

    const io = req.app.get('io');
    if (io) {
      io.to(`conv:${conversationId}`).emit('new-message', responseObj);
    }

    res.status(201).json({
      message: {
        ...responseObj,
        isMine: true,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Server error' });
  }
});

// POST /api/chat/conversations/:id/messages/:messageId/reactions
router.post('/conversations/:id/messages/:messageId/reactions', auth, async (req, res) => {
  try {
    const me = String(req.user._id);
    const { messageId } = req.params;
    const { emoji } = req.body;

    if (!emoji) {
      return res.status(400).json({ message: 'Emoji is required' });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    // Remove existing reaction by same user if any
    message.reactions = (message.reactions || []).filter(r => String(r.userId) !== me);
    // Add new reaction
    message.reactions.push({ userId: me, emoji });
    await message.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`conv:${message.conversation}`).emit('message-reaction', {
        messageId: String(message._id),
        reactions: message.reactions.map(r => ({ userId: String(r.userId), emoji: r.emoji }))
      });
    }

    res.json({ message: 'Reaction added', reactions: message.reactions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Server error' });
  }
});

// DELETE /api/chat/conversations/:id/messages/:messageId/reactions
router.delete('/conversations/:id/messages/:messageId/reactions', auth, async (req, res) => {
  try {
    const me = String(req.user._id);
    const { messageId } = req.params;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    // Remove reaction by same user
    message.reactions = (message.reactions || []).filter(r => String(r.userId) !== me);
    await message.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`conv:${message.conversation}`).emit('message-reaction', {
        messageId: String(message._id),
        reactions: message.reactions.map(r => ({ userId: String(r.userId), emoji: r.emoji }))
      });
    }

    res.json({ message: 'Reaction removed', reactions: message.reactions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Server error' });
  }
});

// POST /api/chat/conversations/:id/messages/:messageId/pin
router.post('/conversations/:id/messages/:messageId/pin', auth, async (req, res) => {
  try {
    const { id: conversationId, messageId } = req.params;

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    conversation.pinnedMessageId = message._id;
    await conversation.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`conv:${conversationId}`).emit('message-pinned', {
        conversationId,
        pinnedMessage: {
          id: String(message._id),
          text: message.text,
          senderId: String(message.sender),
          createdAt: message.createdAt
        }
      });
    }

    res.json({ message: 'Message pinned successfully', pinnedMessageId: message._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Server error' });
  }
});

// DELETE /api/chat/conversations/:id/pin
router.delete('/conversations/:id/pin', auth, async (req, res) => {
  try {
    const { id: conversationId } = req.params;

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    conversation.pinnedMessageId = null;
    await conversation.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`conv:${conversationId}`).emit('message-unpinned', { conversationId });
    }

    res.json({ message: 'Message unpinned successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Server error' });
  }
});

// GET /api/chat/conversations/:id/pinned
router.get('/conversations/:id/pinned', auth, async (req, res) => {
  try {
    const { id: conversationId } = req.params;

    const conversation = await Conversation.findById(conversationId).populate('pinnedMessageId');
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    if (!conversation.pinnedMessageId) {
      return res.json({ pinnedMessage: null });
    }

    const msg = conversation.pinnedMessageId;
    res.json({
      pinnedMessage: {
        id: String(msg._id),
        text: msg.text,
        senderId: String(msg.sender),
        createdAt: msg.createdAt
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Server error' });
  }
});

// Handler for deleting a single message
async function deleteMessageHandler(req, res) {
  try {
    const me = String(req.user._id);
    const { id: conversationId, messageId } = req.params;
    const mode = String(req.query.mode || req.body.mode || 'me').trim().toLowerCase();

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    if (mode === 'everyone') {
      if (String(message.sender) !== me) {
        return res.status(403).json({ message: 'Unauthorized to delete this message for everyone' });
      }

      await Message.deleteOne({ _id: messageId });

      // Update conversation lastMessage if needed
      const conversation = await Conversation.findById(conversationId);
      if (conversation) {
        const lastMsg = await Message.findOne({ conversation: conversationId }).sort({ createdAt: -1 });
        conversation.lastMessage = lastMsg ? lastMsg.text : '';
        conversation.lastMessageAt = lastMsg ? lastMsg.createdAt : conversation.createdAt;
        
        if (conversation.pinnedMessageId && String(conversation.pinnedMessageId) === messageId) {
          conversation.pinnedMessageId = null;
        }
        await conversation.save();
      }

      const io = req.app.get('io');
      if (io) {
        io.to(`conv:${conversationId}`).emit('message-deleted', { conversationId, messageId });
      }
    } else {
      // mode === 'me'
      // Add user to the deletedBy array for this message
      await Message.updateOne({ _id: messageId }, { $addToSet: { deletedBy: me } });
    }

    res.json({ message: 'Message deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Server error' });
  }
}

// Handler for deleting/clearing an entire conversation
async function deleteConversationHandler(req, res) {
  try {
    const me = String(req.user._id);
    const { id: conversationId } = req.params;

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    const isParticipant = (conversation.participants || []).some((id) => String(id) === me);
    if (!isParticipant) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    // Instead of deleting from DB which deletes it for both users:
    // 1. Add current user to `deletedBy` for all existing messages in this conversation
    await Message.updateMany({ conversation: conversationId }, { $addToSet: { deletedBy: me } });

    // 2. Set clearedAt to current date/time for the participant
    ensureParticipantStates(conversation);
    const myState = (conversation.participantStates || []).find((state) => String(state.user) === me);
    if (myState) {
      myState.clearedAt = new Date();
      myState.unreadCount = 0;
      await conversation.save();
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`conv:${conversationId}`).emit('conversation-deleted', { conversationId, userId: me });
    }

    res.json({ message: 'Conversation deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message || 'Server error' });
  }
}

// DELETE /api/chat/conversations/:id/messages/:messageId
router.delete('/conversations/:id/messages/:messageId', auth, deleteMessageHandler);

// POST /api/chat/conversations/:id/messages/:messageId/delete (compatibility fallback)
router.post('/conversations/:id/messages/:messageId/delete', auth, deleteMessageHandler);

// DELETE /api/chat/conversations/:id
router.delete('/conversations/:id', auth, deleteConversationHandler);

// POST /api/chat/conversations/:id/delete (compatibility fallback)
router.post('/conversations/:id/delete', auth, deleteConversationHandler);

module.exports = router;
