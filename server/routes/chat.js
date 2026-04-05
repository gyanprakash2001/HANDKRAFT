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
    user: id,
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
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/chat/conversations
router.get('/conversations', auth, async (req, res) => {
  try {
    const me = String(req.user._id);

    const conversations = await Conversation.find({ participants: me })
      .sort({ updatedAt: -1 })
      .populate('participants', 'name avatarUrl')
      .populate('product', 'title seller');

    const formatted = conversations.map((conversation) => {
      ensureParticipantStates(conversation);
      const other = (conversation.participants || []).find((user) => String(user._id) !== me);
      const state = (conversation.participantStates || []).find((entry) => String(entry.user) === me);
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

    res.json({ conversations: formatted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
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

    const messages = await Message.find({ conversation: conversationId })
      .sort({ createdAt: 1 })
      .select('_id sender text createdAt');

    const formatted = messages.map((message) => {
      const text = message.text || '';
      const isImage = /\/uploads\/messages\/.*\.(jpg|jpeg|png|webp)$/i.test(String(text));
      return {
        id: String(message._id),
        text: text,
        senderId: String(message.sender),
        isMine: String(message.sender) === me,
        isImage: Boolean(isImage),
        createdAt: message.createdAt,
      };
    });

    const myState = (conversation.participantStates || []).find((entry) => String(entry.user) === me);
    if (myState) {
      myState.unreadCount = 0;
      myState.lastReadAt = new Date();
      await conversation.save();
    }

    res.json({ messages: formatted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
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
    if (req.file && req.file.buffer && typeof req.file.mimetype === 'string' && req.file.mimetype.startsWith('image/')) {
      try {
        const buffer = req.file.buffer;
        const fileName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.jpg`;
        const outPath = path.join(MESSAGE_UPLOAD_DIR, fileName);
        await sharp(buffer).jpeg({ quality: 80, mozjpeg: true }).toFile(outPath);
        text = `${req.protocol}://${req.get('host')}/uploads/messages/${fileName}`;
      } catch (imgErr) {
        console.error('Chat image write failed', imgErr);
        return res.status(500).json({ message: 'Failed to process image' });
      }
    } else {
      const dataUri = req.body?.dataUri;
      if (!text && !dataUri) {
        return res.status(400).json({ message: 'Message text or image is required' });
      }

      // If dataUri present, persist image and set text to its public URL
      if (dataUri && typeof dataUri === 'string' && dataUri.startsWith('data:')) {
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

    const isImage = /\/uploads\/messages\/.*\.(jpg|jpeg|png|webp)$/i.test(String(message.text));

    res.status(201).json({
      message: {
        id: String(message._id),
        text: message.text,
        senderId: String(message.sender),
        isMine: true,
        isImage: Boolean(isImage),
        createdAt: message.createdAt,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
