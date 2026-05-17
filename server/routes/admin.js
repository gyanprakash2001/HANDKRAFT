const express = require('express');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = express.Router();
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Payout = require('../models/Payout');
const Review = require('../models/Review');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const AuditLog = require('../models/AuditLog');
const CsrSummary = require('../models/CsrSummary');
const CsrActivity = require('../models/CsrActivity');
const WebhookAudit = require('../models/WebhookAudit');
const PaymentReconciliation = require('../models/PaymentReconciliation');
const ShipmentEvent = require('../models/ShipmentEvent');
const SellerAction = require('../models/SellerAction');
const InventoryTransaction = require('../models/InventoryTransaction');
const OrderAuditLog = require('../models/OrderAuditLog');
const { env } = require('../config/env');
const {
  processDuePayouts,
  claimAdminReadyPayouts,
} = require('../services/payouts');

const ORDER_STATUS_VALUES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
const PAYMENT_STATUS_VALUES = ['pending', 'completed', 'failed', 'refunded'];
const ITEM_STATUS_VALUES = ['new', 'processing', 'packed', 'shipped', 'delivered', 'cancelled'];
const PAYOUT_STATUS_VALUES = ['awaiting_delivery', 'on_hold', 'ready_for_payout', 'paid', 'failed', 'reversed', 'cancelled'];
const KYC_STATUS_VALUES = ['pending', 'verified', 'rejected'];
const ADMIN_ROLE_VALUES = ['support', 'ops', 'finance', 'superadmin'];

function toPositiveInt(value, fallback, max = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), max);
}

function toObjectId(value) {
  const raw = String(value || '').trim();
  if (!raw || !mongoose.Types.ObjectId.isValid(raw)) {
    return null;
  }

  return new mongoose.Types.ObjectId(raw);
}

function toBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return fallback;
}

function safeText(value, maxLength = 500) {
  return String(value || '').trim().slice(0, maxLength);
}

function escapeRegex(input) {
  return String(input || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const CSR_SUMMARY_KEY = 'global';
const CSR_CONTRIBUTION_PER_ORDER = 1;
const CSR_MILESTONE_AMOUNT = 20000;
const CSR_UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'csr');
const DATA_URI_MEDIA_REGEX = /^data:(image\/[a-zA-Z0-9+.-]+|video\/[a-zA-Z0-9+.-]+)(?:;[^,]*)?;base64,(.+)$/i;

function getPublicBaseUrl(req) {
  const explicitBaseUrl = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (explicitBaseUrl) {
    return explicitBaseUrl;
  }

  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'http';
  const host = forwardedHost || req.get('host');
  return `${protocol}://${host}`.replace(/\/+$/, '');
}

async function getOrCreateCsrSummary() {
  const existing = await CsrSummary.findOne({ key: CSR_SUMMARY_KEY });
  if (existing) return existing;

  return CsrSummary.create({
    key: CSR_SUMMARY_KEY,
    contributionPerOrder: CSR_CONTRIBUTION_PER_ORDER,
    milestoneAmount: CSR_MILESTONE_AMOUNT,
    totalPaidOrdersCounted: 0,
    totalContributionAmount: 0,
    completedMilestones: 0,
  });
}

function mapCsrSummary(summaryDoc) {
  const contributionPerOrder = Math.max(0, Number(summaryDoc?.contributionPerOrder || CSR_CONTRIBUTION_PER_ORDER));
  const milestoneAmount = Math.max(1, Number(summaryDoc?.milestoneAmount || CSR_MILESTONE_AMOUNT));
  const totalContributionAmount = Math.max(0, Number(summaryDoc?.totalContributionAmount || 0));
  const totalPaidOrdersCounted = Math.max(0, Number(summaryDoc?.totalPaidOrdersCounted || 0));
  const completedMilestones = Math.max(0, Number(summaryDoc?.completedMilestones || Math.floor(totalContributionAmount / milestoneAmount)));
  const currentMilestoneProgressAmount = totalContributionAmount % milestoneAmount;
  const remainingAmountToNextMilestone = Math.max(0, milestoneAmount - currentMilestoneProgressAmount);
  const progressPercent = Number(((currentMilestoneProgressAmount / milestoneAmount) * 100).toFixed(2));

  return {
    contributionPerOrder,
    milestoneAmount,
    totalPaidOrdersCounted,
    totalContributionAmount,
    completedMilestones,
    currentMilestoneProgressAmount,
    remainingAmountToNextMilestone,
    nextMilestoneNumber: completedMilestones + 1,
    progressPercent,
    lastContributionAt: summaryDoc?.lastContributionAt || null,
    updatedAt: summaryDoc?.updatedAt || null,
  };
}

function mapCsrActivity(activityDoc) {
  return {
    id: String(activityDoc?._id || ''),
    title: String(activityDoc?.title || ''),
    description: String(activityDoc?.description || ''),
    milestoneNumber: Number(activityDoc?.milestoneNumber || 0),
    milestoneAmount: Number(activityDoc?.milestoneAmount || CSR_MILESTONE_AMOUNT),
    targetAmount: Number(activityDoc?.targetAmount || CSR_MILESTONE_AMOUNT),
    fundedAmount: Number(activityDoc?.fundedAmount || 0),
    ordersCounted: Number(activityDoc?.ordersCounted || 0),
    activityDate: activityDoc?.activityDate || null,
    location: String(activityDoc?.location || ''),
    media: Array.isArray(activityDoc?.media)
      ? activityDoc.media.map((entry) => ({
          type: entry?.type === 'video' ? 'video' : 'image',
          url: String(entry?.url || ''),
          thumbnailUrl: String(entry?.thumbnailUrl || ''),
          caption: String(entry?.caption || ''),
        }))
      : [],
    status: String(activityDoc?.status || 'draft'),
    publishedAt: activityDoc?.publishedAt || null,
    createdAt: activityDoc?.createdAt || null,
    updatedAt: activityDoc?.updatedAt || null,
  };
}

async function persistCsrMedia(req, mediaEntry = {}) {
  const rawType = String(mediaEntry?.type || '').trim().toLowerCase();
  const mediaType = rawType === 'video' ? 'video' : 'image';
  const providedUrl = String(mediaEntry?.url || '').trim();
  const caption = safeText(mediaEntry?.caption || '', 200);

  if (providedUrl && /^https?:\/\//i.test(providedUrl)) {
    return {
      type: mediaType,
      url: providedUrl,
      thumbnailUrl: String(mediaEntry?.thumbnailUrl || '').trim(),
      caption,
    };
  }

  if (!providedUrl) {
    return null;
  }

  const match = providedUrl.match(DATA_URI_MEDIA_REGEX);
  if (!match) {
    return null;
  }

  const mime = String(match[1] || '').toLowerCase();
  const payload = String(match[2] || '');
  const inferredType = mime.startsWith('video/') ? 'video' : 'image';
  const effectiveType = mediaType || inferredType;

  let buffer = null;
  try {
    buffer = Buffer.from(payload, 'base64');
  } catch {
    buffer = null;
  }
  if (!buffer || !buffer.length) {
    return null;
  }

  await fs.promises.mkdir(CSR_UPLOAD_DIR, { recursive: true });
  const subtype = mime.split('/')[1]?.split('+')[0] || (effectiveType === 'video' ? 'mp4' : 'jpg');
  const ext = subtype === 'jpeg' ? 'jpg' : subtype;
  const baseName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const fileName = `${baseName}.${ext}`;
  const filePath = path.join(CSR_UPLOAD_DIR, fileName);
  await fs.promises.writeFile(filePath, buffer);

  const publicUrl = `${getPublicBaseUrl(req)}/uploads/csr/${fileName}`;
  return {
    type: effectiveType,
    url: publicUrl,
    thumbnailUrl: effectiveType === 'image' ? publicUrl : '',
    caption,
  };
}

function cleanUserDoc(user = {}) {
  const plain = typeof user?.toObject === 'function' ? user.toObject() : { ...user };
  if (!plain || typeof plain !== 'object') {
    return {};
  }
  delete plain.password;
  return plain;
}

function buildOrderStatusFromItems(items = []) {
  const statuses = (items || []).map((entry) => String(entry?.fulfillmentStatus || 'new').toLowerCase());

  if (statuses.length === 0) {
    return 'pending';
  }

  if (statuses.every((status) => status === 'cancelled')) {
    return 'cancelled';
  }

  const activeStatuses = statuses.filter((status) => status !== 'cancelled');

  if (activeStatuses.length === 0) {
    return 'cancelled';
  }

  if (activeStatuses.every((status) => status === 'delivered')) {
    return 'delivered';
  }

  if (activeStatuses.some((status) => status === 'shipped' || status === 'delivered')) {
    return 'shipped';
  }

  if (activeStatuses.some((status) => status === 'processing' || status === 'packed')) {
    return 'confirmed';
  }

  return 'pending';
}

async function writeAuditLog(req, payload) {
  try {
    await AuditLog.create({
      admin: req.user?._id,
      action: payload.action,
      targetType: payload.targetType,
      targetId: String(payload.targetId || ''),
      note: safeText(payload.note || '', 1000),
      before: payload.before ?? null,
      after: payload.after ?? null,
      meta: payload.meta ?? null,
      ip: String(req.ip || req.headers['x-forwarded-for'] || ''),
      userAgent: String(req.headers['user-agent'] || ''),
    });
  } catch (err) {
    console.error('[ADMIN][AUDIT] Failed to write audit log:', err?.message || err);
  }
}

function parsePagination(req, defaults = {}) {
  const limit = toPositiveInt(req.query.limit, defaults.limit || 20, defaults.maxLimit || 100);
  const page = toPositiveInt(req.query.page, defaults.page || 1, 1000000);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

function parseDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function mapPayoutForAdmin(payout) {
  const seller = payout?.seller && typeof payout.seller === 'object' ? payout.seller : null;
  const order = payout?.order && typeof payout.order === 'object' ? payout.order : null;
  return {
    id: String(payout?._id || ''),
    status: String(payout?.status || ''),
    sellerShipmentRef: String(payout?.sellerShipmentRef || ''),
    currency: String(payout?.currency || 'INR').toUpperCase(),
    deliveredAt: payout?.deliveredAt || null,
    holdStartedAt: payout?.holdStartedAt || null,
    holdUntil: payout?.holdUntil || null,
    seller: {
      id: String(seller?._id || payout?.seller || ''),
      name: String(seller?.name || ''),
      email: String(seller?.email || ''),
      kycStatus: String(seller?.sellerPayoutProfile?.kycStatus || 'pending'),
    },
    order: {
      id: String(order?._id || payout?.order || ''),
      totalAmount: Number(order?.totalAmount || 0),
      paymentStatus: String(order?.paymentStatus || ''),
      status: String(order?.status || ''),
      createdAt: order?.createdAt || null,
    },
    split: {
      grossAmount: Number(payout?.split?.grossAmount || 0),
      shippingShare: Number(payout?.split?.shippingShare || 0),
      shippingDeduction: Number(payout?.split?.shippingDeduction || 0),
      platformFeeAmount: Number(payout?.split?.platformFeeAmount || 0),
      deductionsTotal: Number(payout?.split?.deductionsTotal || 0),
      reserveAmount: Number(payout?.split?.reserveAmount || 0),
      netPayoutAmount: Number(payout?.split?.netPayoutAmount || 0),
    },
    payout: {
      referenceId: String(payout?.payout?.referenceId || ''),
      initiatedAt: payout?.payout?.initiatedAt || null,
      paidAt: payout?.payout?.paidAt || null,
      failureReason: String(payout?.payout?.failureReason || ''),
    },
    timeline: Array.isArray(payout?.timeline)
      ? payout.timeline.map((entry) => ({
          status: String(entry?.status || ''),
          note: String(entry?.note || ''),
          source: String(entry?.source || ''),
          at: entry?.at || null,
        }))
      : [],
    createdAt: payout?.createdAt || null,
    updatedAt: payout?.updatedAt || null,
  };
}

// GET /api/admin/overview
router.get('/overview', auth, admin, async (req, res) => {
  try {
    const [
      totalUsers,
      activeUsers,
      suspendedUsers,
      adminUsers,
      totalProducts,
      activeProducts,
      totalOrders,
      totalReviews,
      activeReviews,
      totalConversations,
      totalMessages,
      payoutStatusAgg,
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({
        $or: [
          { accountStatus: 'active' },
          { accountStatus: { $exists: false } },
        ],
      }),
      User.countDocuments({ accountStatus: 'suspended' }),
      User.countDocuments({ isAdmin: true }),
      Product.countDocuments({}),
      Product.countDocuments({ isActive: true }),
      Order.countDocuments({}),
      Review.countDocuments({}),
      Review.countDocuments({ isActive: true }),
      Conversation.countDocuments({}),
      Message.countDocuments({}),
      Payout.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    const payoutByStatus = {};
    for (const row of payoutStatusAgg || []) {
      payoutByStatus[String(row?._id || '')] = Number(row?.count || 0);
    }

    return res.json({
      generatedAt: new Date().toISOString(),
      users: {
        total: totalUsers,
        active: activeUsers,
        suspended: suspendedUsers,
        admins: adminUsers,
      },
      products: {
        total: totalProducts,
        active: activeProducts,
        inactive: Math.max(0, totalProducts - activeProducts),
      },
      orders: {
        total: totalOrders,
      },
      reviews: {
        total: totalReviews,
        active: activeReviews,
        hidden: Math.max(0, totalReviews - activeReviews),
      },
      chats: {
        conversations: totalConversations,
        messages: totalMessages,
      },
      payouts: payoutByStatus,
      system: {
        nodeEnv: String(process.env.NODE_ENV || ''),
        mongoReadyState: mongoose.connection.readyState,
        uptimeSeconds: Math.round(process.uptime()),
        integrations: {
          razorpayEnabled: Boolean(env.razorpay?.enabled),
          nimbuspostEnabled: Boolean(env.nimbuspost?.enabled),
          nimbuspostMode: String(env.nimbuspost?.mode || 'auto'),
        },
      },
    });
  } catch (err) {
    console.error('[ADMIN][OVERVIEW] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to load admin overview' });
  }
});

// GET /api/admin/system/health
router.get('/system/health', auth, admin, async (req, res) => {
  return res.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    server: {
      nodeEnv: String(process.env.NODE_ENV || ''),
      uptimeSeconds: Math.round(process.uptime()),
      mongoReadyState: mongoose.connection.readyState,
    },
    integrations: {
      razorpayEnabled: Boolean(env.razorpay?.enabled),
      nimbuspostEnabled: Boolean(env.nimbuspost?.enabled),
      nimbuspostMode: String(env.nimbuspost?.mode || 'auto'),
    },
  });
});

// GET /api/admin/users
router.get('/users', auth, admin, async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req, { limit: 20, maxLimit: 100 });
    const search = safeText(req.query.search || '', 120);
    const status = safeText(req.query.status || '', 40);
    const role = safeText(req.query.role || '', 40);
    const kycStatus = safeText(req.query.kycStatus || '', 40);

    const query = {};
    if (search) {
      const pattern = new RegExp(escapeRegex(search), 'i');
      query.$or = [
        { name: pattern },
        { email: pattern },
        { phoneNumber: pattern },
      ];
    }

    if (status === 'active') {
      query.$and = [
        {
          $or: [
            { accountStatus: 'active' },
            { accountStatus: { $exists: false } },
          ],
        },
      ];
    }

    if (status === 'suspended') {
      query.accountStatus = 'suspended';
    }

    if (role === 'admin') {
      query.isAdmin = true;
    } else if (role === 'user') {
      query.isAdmin = false;
    }

    if (KYC_STATUS_VALUES.includes(kycStatus)) {
      query['sellerPayoutProfile.kycStatus'] = kycStatus;
    }

    const [users, total] = await Promise.all([
      User.find(query)
        .select('-password')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(query),
    ]);

    return res.json({
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error('[ADMIN][USERS] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to fetch users' });
  }
});

// GET /api/admin/users/:id
router.get('/users/:id', auth, admin, async (req, res) => {
  try {
    const userId = toObjectId(req.params.id);
    if (!userId) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const user = await User.findById(userId).select('-password').lean();
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const [listedProducts, buyerOrders, sellerOrderRows] = await Promise.all([
      Product.countDocuments({ seller: userId }),
      Order.countDocuments({ user: userId }),
      Order.aggregate([
        { $unwind: '$items' },
        { $match: { 'items.seller': userId } },
        { $group: { _id: '$_id' } },
        { $count: 'count' },
      ]),
    ]);

    const sellerOrders = Number(sellerOrderRows?.[0]?.count || 0);

    return res.json({
      user,
      stats: {
        listedProducts,
        buyerOrders,
        sellerOrders,
      },
    });
  } catch (err) {
    console.error('[ADMIN][USER_DETAIL] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to fetch user details' });
  }
});

// PATCH /api/admin/users/:id
router.patch('/users/:id', auth, admin, async (req, res) => {
  try {
    const userId = toObjectId(req.params.id);
    if (!userId) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const before = cleanUserDoc(user);
    const actorRole = String(req.adminRole || 'superadmin');
    const canManageAdminAccess = actorRole === 'superadmin';

    if (typeof req.body?.name === 'string') {
      user.name = safeText(req.body.name, 160);
    }
    if (typeof req.body?.phoneNumber === 'string') {
      user.phoneNumber = safeText(req.body.phoneNumber, 40);
    }
    if (typeof req.body?.emailVerified === 'boolean') {
      user.emailVerified = req.body.emailVerified;
    }

    if (typeof req.body?.isAdmin === 'boolean' && req.body.isAdmin !== Boolean(user.isAdmin)) {
      if (!canManageAdminAccess) {
        return res.status(403).json({ message: 'Only superadmin can change admin access.' });
      }
      const selfEdit = String(req.user?._id || '') === String(user._id || '');
      if (selfEdit && req.body.isAdmin === false) {
        return res.status(400).json({ message: 'You cannot remove your own admin access.' });
      }
      user.isAdmin = req.body.isAdmin;
      if (req.body.isAdmin === false) {
        user.adminRole = 'support';
      }
    }

    if (typeof req.body?.adminRole === 'string') {
      const nextAdminRole = safeText(req.body.adminRole, 30).toLowerCase();
      if (!ADMIN_ROLE_VALUES.includes(nextAdminRole)) {
        return res.status(400).json({ message: 'Invalid admin role' });
      }

      const currentAdminRole = String(user.adminRole || 'support').toLowerCase();
      if (nextAdminRole !== currentAdminRole) {
        if (!canManageAdminAccess) {
          return res.status(403).json({ message: 'Only superadmin can assign admin roles.' });
        }
        user.adminRole = nextAdminRole;
        if (!user.isAdmin) {
          user.isAdmin = true;
        }
      }
    }

    if (user.isAdmin && !ADMIN_ROLE_VALUES.includes(String(user.adminRole || '').toLowerCase())) {
      user.adminRole = 'support';
    }

    if (typeof req.body?.accountStatus === 'string') {
      const nextStatus = safeText(req.body.accountStatus, 30).toLowerCase();
      if (!['active', 'suspended'].includes(nextStatus)) {
        return res.status(400).json({ message: 'Invalid account status' });
      }
      user.accountStatus = nextStatus;
      if (nextStatus === 'suspended') {
        user.suspensionReason = safeText(req.body?.suspensionReason || user.suspensionReason || '', 500);
        user.suspendedAt = user.suspendedAt || new Date();
      } else {
        user.suspensionReason = '';
        user.suspendedAt = null;
      }
    }

    if (typeof req.body?.suspensionReason === 'string' && String(user.accountStatus || 'active') === 'suspended') {
      user.suspensionReason = safeText(req.body.suspensionReason, 500);
    }

    if (!user.sellerPayoutProfile || typeof user.sellerPayoutProfile !== 'object') {
      user.sellerPayoutProfile = {};
    }

    const nextKyc = safeText(req.body?.sellerPayoutProfile?.kycStatus || '', 30).toLowerCase();
    if (nextKyc) {
      if (!KYC_STATUS_VALUES.includes(nextKyc)) {
        return res.status(400).json({ message: 'Invalid KYC status' });
      }
      user.sellerPayoutProfile.kycStatus = nextKyc;
      user.sellerPayoutProfile.kycVerifiedAt = nextKyc === 'verified' ? new Date() : null;
    }

    if (!user.sellerPayoutSettings || typeof user.sellerPayoutSettings !== 'object') {
      user.sellerPayoutSettings = {};
    }

    if (typeof req.body?.sellerPayoutSettings?.autoPayoutEnabled === 'boolean') {
      user.sellerPayoutSettings.autoPayoutEnabled = req.body.sellerPayoutSettings.autoPayoutEnabled;
    }

    if (Number.isFinite(Number(req.body?.sellerPayoutSettings?.minimumPayoutAmount))) {
      user.sellerPayoutSettings.minimumPayoutAmount = Math.max(0, Number(req.body.sellerPayoutSettings.minimumPayoutAmount));
    }

    if (Number.isFinite(Number(req.body?.sellerPayoutSettings?.reservePercent))) {
      const reservePercent = Number(req.body.sellerPayoutSettings.reservePercent);
      if (reservePercent < 0 || reservePercent > 100) {
        return res.status(400).json({ message: 'reservePercent must be between 0 and 100' });
      }
      user.sellerPayoutSettings.reservePercent = reservePercent;
    }

    if (req.body?.sellerPayoutSettings?.overrideCoolingDays === null) {
      user.sellerPayoutSettings.overrideCoolingDays = null;
    } else if (Number.isFinite(Number(req.body?.sellerPayoutSettings?.overrideCoolingDays))) {
      user.sellerPayoutSettings.overrideCoolingDays = Math.max(0, Math.min(60, Number(req.body.sellerPayoutSettings.overrideCoolingDays)));
    }

    if (!user.sellerTrust || typeof user.sellerTrust !== 'object') {
      user.sellerTrust = {};
    }

    if (typeof req.body?.sellerTrust?.isTrusted === 'boolean') {
      user.sellerTrust.isTrusted = req.body.sellerTrust.isTrusted;
      user.sellerTrust.trustedSince = req.body.sellerTrust.isTrusted ? (user.sellerTrust.trustedSince || new Date()) : null;
    }

    if (Number.isFinite(Number(req.body?.sellerTrust?.deliveredOrderCount))) {
      user.sellerTrust.deliveredOrderCount = Math.max(0, Math.floor(Number(req.body.sellerTrust.deliveredOrderCount)));
    }

    await user.save();

    const after = cleanUserDoc(user);
    await writeAuditLog(req, {
      action: 'update_user',
      targetType: 'user',
      targetId: String(user._id),
      note: safeText(req.body?.note || 'Admin updated user profile/settings', 300),
      before,
      after,
    });

    return res.json({ message: 'User updated successfully', user: after });
  } catch (err) {
    console.error('[ADMIN][UPDATE_USER] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to update user' });
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', auth, admin, async (req, res) => {
  try {
    const userId = toObjectId(req.params.id);
    const deleteReason = safeText(req.adminDeleteReason || req.body?.reason || 'Admin requested deletion', 500);
    const deleteMode = String(req.adminDeleteMode || 'soft');
    if (!userId) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const selfDelete = String(req.user?._id || '') === String(userId);
    if (selfDelete) {
      return res.status(400).json({ message: 'You cannot delete your own account.' });
    }

    const user = await User.findById(userId).select('-password').lean();
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (deleteMode === 'soft') {
      const updatedUser = await User.findByIdAndUpdate(
        userId,
        {
          $set: {
            accountStatus: 'suspended',
            suspensionReason: `Soft deleted by admin: ${deleteReason}`,
            suspendedAt: new Date(),
            isAdmin: false,
            adminRole: 'support',
          },
        },
        { new: true }
      ).select('-password').lean();

      await writeAuditLog(req, {
        action: 'soft_delete_user',
        targetType: 'user',
        targetId: String(userId),
        note: deleteReason,
        before: user,
        after: updatedUser,
        meta: { deleteMode: 'soft' },
      });

      return res.json({
        message: 'User soft deleted (suspended)',
        mode: 'soft',
        user: updatedUser,
      });
    }

    await User.findByIdAndDelete(userId);
    await writeAuditLog(req, {
      action: 'hard_delete_user',
      targetType: 'user',
      targetId: String(userId),
      note: deleteReason,
      before: user,
      after: null,
      meta: { deleteMode: 'hard' },
    });

    return res.json({ message: 'User deleted', mode: 'hard' });
  } catch (err) {
    console.error('[ADMIN][DELETE_USER] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to delete user' });
  }
});

// GET /api/admin/products
router.get('/products', auth, admin, async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req, { limit: 20, maxLimit: 100 });
    const search = safeText(req.query.search || '', 120);
    const status = safeText(req.query.status || '', 40);
    const category = safeText(req.query.category || '', 80);
    const sellerId = toObjectId(req.query.sellerId);

    const query = {};
    if (search) {
      const pattern = new RegExp(escapeRegex(search), 'i');
      query.$or = [
        { title: pattern },
        { description: pattern },
        { sellerName: pattern },
      ];
    }

    if (status === 'active') query.isActive = true;
    if (status === 'inactive') query.isActive = false;
    if (category) query.category = category;
    if (sellerId) query.seller = sellerId;

    const [products, total] = await Promise.all([
      Product.find(query)
        .populate('seller', 'name email accountStatus')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments(query),
    ]);

    return res.json({
      products,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error('[ADMIN][PRODUCTS] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to fetch products' });
  }
});

// PATCH /api/admin/products/:id
router.patch('/products/:id', auth, admin, async (req, res) => {
  try {
    const productId = toObjectId(req.params.id);
    if (!productId) {
      return res.status(400).json({ message: 'Invalid product id' });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const before = product.toObject();

    if (typeof req.body?.title === 'string') {
      product.title = safeText(req.body.title, 180);
    }
    if (typeof req.body?.description === 'string') {
      product.description = safeText(req.body.description, 3000);
    }
    if (typeof req.body?.category === 'string') {
      product.category = safeText(req.body.category, 100);
    }
    if (typeof req.body?.customCategory === 'string') {
      product.customCategory = safeText(req.body.customCategory, 100);
    }
    if (typeof req.body?.isActive === 'boolean') {
      product.isActive = req.body.isActive;
    }
    if (Number.isFinite(Number(req.body?.stock))) {
      product.stock = Math.max(0, Math.floor(Number(req.body.stock)));
    }
    if (Number.isFinite(Number(req.body?.price))) {
      product.price = Math.max(0, Number(req.body.price));
    }
    if (Number.isFinite(Number(req.body?.realPrice))) {
      product.realPrice = Math.max(0, Number(req.body.realPrice));
    }
    if (Number.isFinite(Number(req.body?.discountedPrice))) {
      product.discountedPrice = Math.max(0, Number(req.body.discountedPrice));
    }

    await product.save();
    const after = product.toObject();

    await writeAuditLog(req, {
      action: 'update_product',
      targetType: 'product',
      targetId: String(product._id),
      note: safeText(req.body?.note || 'Admin updated product', 300),
      before,
      after,
    });

    return res.json({ message: 'Product updated', product: after });
  } catch (err) {
    console.error('[ADMIN][UPDATE_PRODUCT] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to update product' });
  }
});

// DELETE /api/admin/products/:id
router.delete('/products/:id', auth, admin, async (req, res) => {
  try {
    const productId = toObjectId(req.params.id);
    const deleteReason = safeText(req.adminDeleteReason || req.body?.reason || 'Admin requested deletion', 500);
    const deleteMode = String(req.adminDeleteMode || 'soft');
    if (!productId) {
      return res.status(400).json({ message: 'Invalid product id' });
    }

    const product = await Product.findById(productId).lean();
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    if (deleteMode === 'soft') {
      const updatedProduct = await Product.findByIdAndUpdate(
        productId,
        { $set: { isActive: false, stock: 0 } },
        { new: true }
      ).lean();

      await writeAuditLog(req, {
        action: 'soft_delete_product',
        targetType: 'product',
        targetId: String(productId),
        note: deleteReason,
        before: product,
        after: updatedProduct,
        meta: { deleteMode: 'soft' },
      });

      return res.json({ message: 'Product soft deleted (deactivated)', mode: 'soft', product: updatedProduct });
    }

    // Attempt to remove any locally stored uploaded files referenced by this product
    try {
      const referencedUrls = [];
      if (Array.isArray(product.media)) {
        product.media.forEach((m) => {
          if (m && m.url) referencedUrls.push(m.url);
        });
      }
      if (Array.isArray(product.images)) {
        product.images.forEach((u) => {
          if (u) referencedUrls.push(u);
        });
      }
      if (product.thumbnailUrl) referencedUrls.push(product.thumbnailUrl);

      for (const u of referencedUrls) {
        try {
          const idx = String(u || '').indexOf('/uploads/');
          if (idx === -1) continue;
          const rel = String(u).substring(idx + '/uploads/'.length);
          const filePath = path.join(__dirname, '..', 'uploads', rel);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log('[ADMIN][DELETE_PRODUCT] removed file', filePath);
          }
        } catch (e) {
          console.error('[ADMIN][DELETE_PRODUCT] failed removing file', u, e?.message || e);
        }
      }
    } catch (e) {
      console.error('[ADMIN][DELETE_PRODUCT] cleanup error', e?.message || e);
    }

    await Product.findByIdAndDelete(productId);
    await writeAuditLog(req, {
      action: 'hard_delete_product',
      targetType: 'product',
      targetId: String(productId),
      note: deleteReason,
      before: product,
      after: null,
      meta: { deleteMode: 'hard' },
    });

    return res.json({ message: 'Product deleted', mode: 'hard' });
  } catch (err) {
    console.error('[ADMIN][DELETE_PRODUCT] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to delete product' });
  }
});

// GET /api/admin/orders
router.get('/orders', auth, admin, async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req, { limit: 20, maxLimit: 100 });
    const search = safeText(req.query.search || '', 120);
    const status = safeText(req.query.status || '', 50);
    const paymentStatus = safeText(req.query.paymentStatus || '', 50);
    const userId = toObjectId(req.query.userId);

    const query = {};

    if (ORDER_STATUS_VALUES.includes(status)) {
      query.status = status;
    }

    if (PAYMENT_STATUS_VALUES.includes(paymentStatus)) {
      query.paymentStatus = paymentStatus;
    }

    if (userId) {
      query.user = userId;
    }

    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      const matchedUsers = await User.find({
        $or: [{ name: regex }, { email: regex }],
      }).select('_id').lean();
      const matchedUserIds = matchedUsers.map((entry) => entry._id);

      if (mongoose.Types.ObjectId.isValid(search)) {
        query.$or = [
          { _id: new mongoose.Types.ObjectId(search) },
          { user: { $in: matchedUserIds } },
        ];
      } else if (matchedUserIds.length > 0) {
        query.user = { $in: matchedUserIds };
      } else {
        query.user = { $in: [] };
      }
    }

    const [orders, total] = await Promise.all([
      Order.find(query)
        .populate('user', 'name email accountStatus')
        .populate('items.product', 'title isActive price')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Order.countDocuments(query),
    ]);

    return res.json({
      orders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error('[ADMIN][ORDERS] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to fetch orders' });
  }
});

// GET /api/admin/orders/:id
router.get('/orders/:id', auth, admin, async (req, res) => {
  try {
    const orderId = toObjectId(req.params.id);
    if (!orderId) {
      return res.status(400).json({ message: 'Invalid order id' });
    }

    const order = await Order.findById(orderId)
      .populate('user', 'name email accountStatus')
      .populate('items.product', 'title isActive price stock')
      .populate('sellerShipments.seller', 'name email')
      .lean();

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    return res.json({ order });
  } catch (err) {
    console.error('[ADMIN][ORDER_DETAIL] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to fetch order details' });
  }
});

// PATCH /api/admin/orders/:id
router.patch('/orders/:id', auth, admin, async (req, res) => {
  try {
    const orderId = toObjectId(req.params.id);
    if (!orderId) {
      return res.status(400).json({ message: 'Invalid order id' });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const before = order.toObject();

    if (typeof req.body?.status === 'string') {
      const nextStatus = safeText(req.body.status, 30).toLowerCase();
      if (!ORDER_STATUS_VALUES.includes(nextStatus)) {
        return res.status(400).json({ message: 'Invalid order status' });
      }
      order.status = nextStatus;
    }

    if (typeof req.body?.paymentStatus === 'string') {
      const nextPaymentStatus = safeText(req.body.paymentStatus, 30).toLowerCase();
      if (!PAYMENT_STATUS_VALUES.includes(nextPaymentStatus)) {
        return res.status(400).json({ message: 'Invalid payment status' });
      }
      order.paymentStatus = nextPaymentStatus;
    }

    if (typeof req.body?.notes === 'string') {
      order.notes = safeText(req.body.notes, 2000);
    }

    await order.save();
    const after = order.toObject();

    await writeAuditLog(req, {
      action: 'update_order',
      targetType: 'order',
      targetId: String(order._id),
      note: safeText(req.body?.note || 'Admin updated order', 300),
      before,
      after,
    });

    return res.json({ message: 'Order updated', order: after });
  } catch (err) {
    console.error('[ADMIN][UPDATE_ORDER] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to update order' });
  }
});

// PATCH /api/admin/orders/:id/items/:itemIndex
router.patch('/orders/:id/items/:itemIndex', auth, admin, async (req, res) => {
  try {
    const orderId = toObjectId(req.params.id);
    const itemIndex = Number.parseInt(String(req.params.itemIndex || ''), 10);
    if (!orderId || !Number.isInteger(itemIndex) || itemIndex < 0) {
      return res.status(400).json({ message: 'Invalid order id or item index' });
    }

    const nextStatus = safeText(req.body?.fulfillmentStatus || '', 30).toLowerCase();
    if (!ITEM_STATUS_VALUES.includes(nextStatus)) {
      return res.status(400).json({ message: 'Invalid item fulfillment status' });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (!Array.isArray(order.items) || itemIndex >= order.items.length) {
      return res.status(400).json({ message: 'Invalid item index for this order' });
    }

    const before = order.toObject();
    const item = order.items[itemIndex];

    item.fulfillmentStatus = nextStatus;
    item.trackingEvents = Array.isArray(item.trackingEvents) ? item.trackingEvents : [];
    item.trackingEvents.push({
      status: nextStatus,
      note: safeText(req.body?.note || `Admin set item to ${nextStatus}`, 300),
      updatedBy: req.user?._id || null,
      at: new Date(),
    });

    order.status = buildOrderStatusFromItems(order.items);
    await order.save();

    const after = order.toObject();
    await writeAuditLog(req, {
      action: 'update_order_item_status',
      targetType: 'order',
      targetId: String(order._id),
      note: `Admin updated item ${itemIndex} to ${nextStatus}`,
      before,
      after,
      meta: { itemIndex, nextStatus },
    });

    return res.json({ message: 'Order item updated', order: after });
  } catch (err) {
    console.error('[ADMIN][UPDATE_ORDER_ITEM] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to update order item' });
  }
});

// DELETE /api/admin/orders/:id
router.delete('/orders/:id', auth, admin, async (req, res) => {
  try {
    const orderId = toObjectId(req.params.id);
    const deleteReason = safeText(req.adminDeleteReason || req.body?.reason || 'Admin requested deletion', 500);
    const deleteMode = String(req.adminDeleteMode || 'soft');
    if (!orderId) {
      return res.status(400).json({ message: 'Invalid order id' });
    }

    const order = await Order.findById(orderId).lean();
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (deleteMode === 'soft') {
      const existingNotes = safeText(order.notes || '', 2000);
      const mergedNotes = [existingNotes, `Soft deleted by admin: ${deleteReason}`]
        .filter(Boolean)
        .join('\n')
        .slice(0, 2000);

      const updatedOrder = await Order.findByIdAndUpdate(
        orderId,
        {
          $set: {
            status: 'cancelled',
            notes: mergedNotes,
            updatedAt: new Date(),
          },
        },
        { new: true }
      ).lean();

      await writeAuditLog(req, {
        action: 'soft_delete_order',
        targetType: 'order',
        targetId: String(orderId),
        note: deleteReason,
        before: order,
        after: updatedOrder,
        meta: { deleteMode: 'soft' },
      });

      return res.json({ message: 'Order soft deleted (cancelled)', mode: 'soft', order: updatedOrder });
    }

    await Order.findByIdAndDelete(orderId);
    await writeAuditLog(req, {
      action: 'hard_delete_order',
      targetType: 'order',
      targetId: String(orderId),
      note: deleteReason,
      before: order,
      after: null,
      meta: { deleteMode: 'hard' },
    });

    return res.json({ message: 'Order deleted', mode: 'hard' });
  } catch (err) {
    console.error('[ADMIN][DELETE_ORDER] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to delete order' });
  }
});

// GET /api/admin/payouts
router.get('/payouts', auth, admin, async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req, { limit: 20, maxLimit: 100 });
    const status = safeText(req.query.status || '', 40);
    const sellerId = toObjectId(req.query.sellerId);

    const query = {};
    if (PAYOUT_STATUS_VALUES.includes(status)) {
      query.status = status;
    }
    if (sellerId) {
      query.seller = sellerId;
    }

    const [payouts, total] = await Promise.all([
      Payout.find(query)
        .populate('seller', 'name email sellerPayoutProfile')
        .populate('order', 'totalAmount paymentStatus status createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Payout.countDocuments(query),
    ]);

    return res.json({
      payouts: payouts.map(mapPayoutForAdmin),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error('[ADMIN][PAYOUTS] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to fetch payouts' });
  }
});

// GET /api/admin/payouts/:id
router.get('/payouts/:id', auth, admin, async (req, res) => {
  try {
    const payoutId = toObjectId(req.params.id);
    if (!payoutId) {
      return res.status(400).json({ message: 'Invalid payout id' });
    }

    const payout = await Payout.findById(payoutId)
      .populate('seller', 'name email sellerPayoutProfile sellerPayoutSettings')
      .populate('order', 'totalAmount paymentStatus status createdAt')
      .lean();

    if (!payout) {
      return res.status(404).json({ message: 'Payout not found' });
    }

    return res.json({ payout: mapPayoutForAdmin(payout) });
  } catch (err) {
    console.error('[ADMIN][PAYOUT_DETAIL] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to fetch payout details' });
  }
});

// PATCH /api/admin/payouts/:id
router.patch('/payouts/:id', auth, admin, async (req, res) => {
  try {
    const payoutId = toObjectId(req.params.id);
    if (!payoutId) {
      return res.status(400).json({ message: 'Invalid payout id' });
    }

    const payout = await Payout.findById(payoutId);
    if (!payout) {
      return res.status(404).json({ message: 'Payout not found' });
    }

    const before = payout.toObject();
    const note = safeText(req.body?.note || '', 500);

    if (typeof req.body?.status === 'string') {
      const nextStatus = safeText(req.body.status, 30).toLowerCase();
      if (!PAYOUT_STATUS_VALUES.includes(nextStatus)) {
        return res.status(400).json({ message: 'Invalid payout status' });
      }
      payout.status = nextStatus;

      if (nextStatus === 'paid') {
        payout.payout = Object.assign({}, payout.payout || {}, {
          paidAt: payout.payout?.paidAt || new Date(),
          initiatedAt: payout.payout?.initiatedAt || new Date(),
          referenceId: String(payout.payout?.referenceId || `HKP-ADMIN-${Date.now()}`),
          failureReason: '',
        });
      }

      if (nextStatus === 'failed') {
        payout.payout = Object.assign({}, payout.payout || {}, {
          failureReason: safeText(req.body?.failureReason || 'Marked as failed by admin', 500),
        });
      }

      if (nextStatus === 'on_hold') {
        payout.holdStartedAt = payout.holdStartedAt || new Date();
        const nextHoldUntil = parseDate(req.body?.holdUntil);
        payout.holdUntil = nextHoldUntil || payout.holdUntil || new Date(Date.now() + (24 * 60 * 60 * 1000));
      }
    }

    if (typeof req.body?.holdUntil === 'string' || req.body?.holdUntil instanceof Date) {
      const parsedHoldUntil = parseDate(req.body.holdUntil);
      if (parsedHoldUntil) {
        payout.holdUntil = parsedHoldUntil;
      }
    }

    if (typeof req.body?.failureReason === 'string') {
      payout.payout = Object.assign({}, payout.payout || {}, {
        failureReason: safeText(req.body.failureReason, 500),
      });
    }

    payout.timeline = Array.isArray(payout.timeline) ? payout.timeline : [];
    if (note || req.body?.status) {
      payout.timeline.push({
        status: String(payout.status || ''),
        note: note || `Admin changed payout status to ${String(payout.status || '')}`,
        source: 'admin',
        at: new Date(),
      });
    }

    await payout.save();
    const after = payout.toObject();

    await writeAuditLog(req, {
      action: 'update_payout',
      targetType: 'payout',
      targetId: String(payout._id),
      note: note || 'Admin updated payout',
      before,
      after,
    });

    return res.json({ message: 'Payout updated', payout: mapPayoutForAdmin(after) });
  } catch (err) {
    console.error('[ADMIN][UPDATE_PAYOUT] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to update payout' });
  }
});

// POST /api/admin/payouts/process-due
router.post('/payouts/process-due', auth, admin, async (req, res) => {
  try {
    const limit = toPositiveInt(req.body?.limit, 100, 500);
    const result = await processDuePayouts({ limit });

    await writeAuditLog(req, {
      action: 'process_due_payouts',
      targetType: 'payout',
      targetId: '',
      note: `Admin processed due payouts (limit ${limit})`,
      before: null,
      after: result,
    });

    return res.json({
      message: 'Due payouts processed',
      result,
    });
  } catch (err) {
    console.error('[ADMIN][PROCESS_DUE_PAYOUTS] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to process due payouts' });
  }
});

// POST /api/admin/payouts/claim
router.post('/payouts/claim', auth, admin, async (req, res) => {
  try {
    const claimAll = req.body?.claimAll === true;
    const sellerId = safeText(req.body?.sellerId || '', 80);
    const payoutIds = Array.isArray(req.body?.payoutIds)
      ? req.body.payoutIds.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [];
    const limit = toPositiveInt(req.body?.limit, 100, 500);

    const result = await claimAdminReadyPayouts({
      claimAll,
      sellerId: sellerId || undefined,
      payoutIds,
      limit,
    });

    await writeAuditLog(req, {
      action: 'claim_payouts',
      targetType: 'payout',
      targetId: '',
      note: `Admin claimed payouts (claimAll=${claimAll}, limit=${limit})`,
      before: null,
      after: result,
      meta: { claimAll, sellerId: sellerId || null, payoutIds },
    });

    return res.json({
      message: 'Payout claim operation completed',
      ...result,
    });
  } catch (err) {
    console.error('[ADMIN][CLAIM_PAYOUTS] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to claim payouts' });
  }
});

// GET /api/admin/reviews
router.get('/reviews', auth, admin, async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req, { limit: 20, maxLimit: 100 });
    const search = safeText(req.query.search || '', 120);
    const productId = toObjectId(req.query.productId);

    const query = {};

    if (req.query.isActive === 'true') query.isActive = true;
    if (req.query.isActive === 'false') query.isActive = false;
    if (productId) query.product = productId;

    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      query.$or = [{ title: regex }, { comment: regex }];
    }

    const [reviews, total] = await Promise.all([
      Review.find(query)
        .populate('user', 'name email')
        .populate('product', 'title isActive')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Review.countDocuments(query),
    ]);

    return res.json({
      reviews,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error('[ADMIN][REVIEWS] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to fetch reviews' });
  }
});

// PATCH /api/admin/reviews/:id
router.patch('/reviews/:id', auth, admin, async (req, res) => {
  try {
    const reviewId = toObjectId(req.params.id);
    if (!reviewId) {
      return res.status(400).json({ message: 'Invalid review id' });
    }

    const review = await Review.findById(reviewId);
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    const before = review.toObject();
    if (typeof req.body?.isActive === 'boolean') {
      review.isActive = req.body.isActive;
    }

    await review.save();
    const after = review.toObject();

    await writeAuditLog(req, {
      action: 'update_review',
      targetType: 'review',
      targetId: String(review._id),
      note: safeText(req.body?.note || 'Admin updated review visibility', 300),
      before,
      after,
    });

    return res.json({ message: 'Review updated', review: after });
  } catch (err) {
    console.error('[ADMIN][UPDATE_REVIEW] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to update review' });
  }
});

// DELETE /api/admin/reviews/:id
router.delete('/reviews/:id', auth, admin, async (req, res) => {
  try {
    const reviewId = toObjectId(req.params.id);
    const deleteReason = safeText(req.adminDeleteReason || req.body?.reason || 'Admin requested deletion', 500);
    const deleteMode = String(req.adminDeleteMode || 'soft');
    if (!reviewId) {
      return res.status(400).json({ message: 'Invalid review id' });
    }

    const review = await Review.findById(reviewId).lean();
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    if (deleteMode === 'soft') {
      const updatedReview = await Review.findByIdAndUpdate(
        reviewId,
        { $set: { isActive: false } },
        { new: true }
      ).lean();

      await writeAuditLog(req, {
        action: 'soft_delete_review',
        targetType: 'review',
        targetId: String(reviewId),
        note: deleteReason,
        before: review,
        after: updatedReview,
        meta: { deleteMode: 'soft' },
      });

      return res.json({ message: 'Review soft deleted (hidden)', mode: 'soft', review: updatedReview });
    }

    await Review.findByIdAndDelete(reviewId);
    await writeAuditLog(req, {
      action: 'hard_delete_review',
      targetType: 'review',
      targetId: String(reviewId),
      note: deleteReason,
      before: review,
      after: null,
      meta: { deleteMode: 'hard' },
    });

    return res.json({ message: 'Review deleted', mode: 'hard' });
  } catch (err) {
    console.error('[ADMIN][DELETE_REVIEW] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to delete review' });
  }
});

// GET /api/admin/chats/conversations
router.get('/chats/conversations', auth, admin, async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req, { limit: 20, maxLimit: 100 });
    const search = safeText(req.query.search || '', 120);

    const query = {};
    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      const matchedUsers = await User.find({ $or: [{ name: regex }, { email: regex }] }).select('_id').lean();
      const matchedUserIds = matchedUsers.map((entry) => entry._id);

      query.$or = [
        { lastMessage: regex },
        { productTitle: regex },
      ];

      if (matchedUserIds.length > 0) {
        query.$or.push({ participants: { $in: matchedUserIds } });
      }
    }

    const [conversations, total] = await Promise.all([
      Conversation.find(query)
        .populate('participants', 'name email avatarUrl')
        .populate('product', 'title')
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Conversation.countDocuments(query),
    ]);

    const items = conversations.map((conversation) => ({
      id: String(conversation._id),
      participants: Array.isArray(conversation.participants)
        ? conversation.participants.map((entry) => ({
            id: String(entry?._id || ''),
            name: String(entry?.name || ''),
            email: String(entry?.email || ''),
            avatarUrl: String(entry?.avatarUrl || ''),
          }))
        : [],
      product: conversation.product
        ? {
            id: String(conversation.product?._id || ''),
            title: String(conversation.product?.title || ''),
          }
        : (conversation.productTitle
            ? { id: '', title: String(conversation.productTitle) }
            : null),
      lastMessage: String(conversation.lastMessage || ''),
      lastMessageAt: conversation.lastMessageAt || null,
      updatedAt: conversation.updatedAt || null,
      unreadTotal: Array.isArray(conversation.participantStates)
        ? conversation.participantStates.reduce((sum, entry) => sum + Number(entry?.unreadCount || 0), 0)
        : 0,
    }));

    return res.json({
      conversations: items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error('[ADMIN][CHAT_CONVERSATIONS] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to fetch conversations' });
  }
});

// GET /api/admin/chats/conversations/:id/messages
router.get('/chats/conversations/:id/messages', auth, admin, async (req, res) => {
  try {
    const conversationId = toObjectId(req.params.id);
    if (!conversationId) {
      return res.status(400).json({ message: 'Invalid conversation id' });
    }

    const conversation = await Conversation.findById(conversationId)
      .populate('participants', 'name email avatarUrl')
      .lean();
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    const messages = await Message.find({ conversation: conversationId })
      .populate('sender', 'name email avatarUrl')
      .sort({ createdAt: 1 })
      .lean();

    return res.json({
      conversation: {
        id: String(conversation._id),
        participants: Array.isArray(conversation.participants)
          ? conversation.participants.map((entry) => ({
              id: String(entry?._id || ''),
              name: String(entry?.name || ''),
              email: String(entry?.email || ''),
              avatarUrl: String(entry?.avatarUrl || ''),
            }))
          : [],
        productId: String(conversation.product || ''),
        productTitle: String(conversation.productTitle || ''),
      },
      messages: messages.map((entry) => ({
        id: String(entry._id),
        conversationId: String(entry.conversation || ''),
        text: String(entry.text || ''),
        sender: {
          id: String(entry.sender?._id || entry.sender || ''),
          name: String(entry.sender?.name || ''),
          email: String(entry.sender?.email || ''),
          avatarUrl: String(entry.sender?.avatarUrl || ''),
        },
        createdAt: entry.createdAt || null,
      })),
    });
  } catch (err) {
    console.error('[ADMIN][CHAT_MESSAGES] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to fetch chat messages' });
  }
});

// DELETE /api/admin/chats/messages/:id
router.delete('/chats/messages/:id', auth, admin, async (req, res) => {
  try {
    const messageId = toObjectId(req.params.id);
    const deleteReason = safeText(req.adminDeleteReason || req.body?.reason || 'Admin requested deletion', 500);
    const deleteMode = String(req.adminDeleteMode || 'soft');
    if (!messageId) {
      return res.status(400).json({ message: 'Invalid message id' });
    }

    const message = await Message.findById(messageId).lean();
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    let after = null;
    if (deleteMode === 'soft') {
      after = await Message.findByIdAndUpdate(
        messageId,
        {
          $set: {
            text: '[Message removed by admin]',
            updatedAt: new Date(),
          },
        },
        { new: true }
      ).lean();
    } else {
      await Message.findByIdAndDelete(messageId);
    }

    const latestMessage = await Message.findOne({ conversation: message.conversation })
      .sort({ createdAt: -1 })
      .lean();

    await Conversation.findByIdAndUpdate(message.conversation, {
      $set: {
        lastMessage: String(latestMessage?.text || ''),
        lastMessageAt: latestMessage?.createdAt || new Date(),
        updatedAt: new Date(),
      },
    });

    await writeAuditLog(req, {
      action: deleteMode === 'soft' ? 'soft_delete_chat_message' : 'hard_delete_chat_message',
      targetType: 'message',
      targetId: String(messageId),
      note: deleteReason,
      before: message,
      after,
      meta: { deleteMode },
    });

    return res.json({ message: deleteMode === 'soft' ? 'Message soft deleted' : 'Message deleted', mode: deleteMode });
  } catch (err) {
    console.error('[ADMIN][DELETE_MESSAGE] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to delete message' });
  }
});

// DELETE /api/admin/chats/conversations/:id
router.delete('/chats/conversations/:id', auth, admin, async (req, res) => {
  try {
    const conversationId = toObjectId(req.params.id);
    const deleteReason = safeText(req.adminDeleteReason || req.body?.reason || 'Admin requested deletion', 500);
    const deleteMode = String(req.adminDeleteMode || 'soft');
    if (!conversationId) {
      return res.status(400).json({ message: 'Invalid conversation id' });
    }

    const conversation = await Conversation.findById(conversationId).lean();
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    if (deleteMode === 'soft') {
      const redactionResult = await Message.updateMany(
        { conversation: conversationId },
        {
          $set: {
            text: '[Message removed by admin]',
            updatedAt: new Date(),
          },
        }
      );

      const updatedConversation = await Conversation.findByIdAndUpdate(
        conversationId,
        {
          $set: {
            lastMessage: '[Conversation hidden by admin]',
            lastMessageAt: new Date(),
            updatedAt: new Date(),
          },
        },
        { new: true }
      ).lean();

      await writeAuditLog(req, {
        action: 'soft_delete_conversation',
        targetType: 'conversation',
        targetId: String(conversationId),
        note: deleteReason,
        before: conversation,
        after: updatedConversation,
        meta: {
          deleteMode: 'soft',
          redactedMessages: Number(redactionResult?.modifiedCount || 0),
        },
      });

      return res.json({
        message: 'Conversation soft deleted (messages redacted)',
        mode: 'soft',
        redactedMessages: Number(redactionResult?.modifiedCount || 0),
      });
    }

    const deletedMessages = await Message.deleteMany({ conversation: conversationId });
    await Conversation.findByIdAndDelete(conversationId);

    await writeAuditLog(req, {
      action: 'hard_delete_conversation',
      targetType: 'conversation',
      targetId: String(conversationId),
      note: deleteReason,
      before: conversation,
      after: null,
      meta: {
        deleteMode: 'hard',
        deletedMessages: Number(deletedMessages?.deletedCount || 0),
      },
    });

    return res.json({ message: 'Conversation deleted', mode: 'hard' });
  } catch (err) {
    console.error('[ADMIN][DELETE_CONVERSATION] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to delete conversation' });
  }
});

// GET /api/admin/audit-logs
router.get('/audit-logs', auth, admin, async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req, { limit: 30, maxLimit: 200 });
    const action = safeText(req.query.action || '', 80);
    const targetType = safeText(req.query.targetType || '', 80);

    const query = {};
    if (action) query.action = action;
    if (targetType) query.targetType = targetType;

    const [rows, total] = await Promise.all([
      AuditLog.find(query)
        .populate('admin', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(query),
    ]);

    return res.json({
      logs: rows.map((row) => ({
        id: String(row._id),
        admin: {
          id: String(row.admin?._id || row.admin || ''),
          name: String(row.admin?.name || ''),
          email: String(row.admin?.email || ''),
        },
        action: String(row.action || ''),
        targetType: String(row.targetType || ''),
        targetId: String(row.targetId || ''),
        note: String(row.note || ''),
        before: row.before ?? null,
        after: row.after ?? null,
        meta: row.meta ?? null,
        ip: String(row.ip || ''),
        userAgent: String(row.userAgent || ''),
        createdAt: row.createdAt || null,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error('[ADMIN][AUDIT_LOGS] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to fetch audit logs' });
  }
});

// GET /api/admin/csr/summary
router.get('/csr/summary', auth, admin, async (req, res) => {
  try {
    const summary = await getOrCreateCsrSummary();
    return res.json({ summary: mapCsrSummary(summary) });
  } catch (err) {
    console.error('[ADMIN][CSR][SUMMARY] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to fetch CSR summary' });
  }
});

// GET /api/admin/csr/activities
router.get('/csr/activities', auth, admin, async (req, res) => {
  try {
    const statusFilter = safeText(req.query.status || '', 20).toLowerCase();
    const query = {};
    if (statusFilter === 'draft' || statusFilter === 'published') {
      query.status = statusFilter;
    }

    const activities = await CsrActivity.find(query)
      .sort({ milestoneNumber: -1, createdAt: -1 })
      .lean();

    return res.json({ activities: activities.map(mapCsrActivity) });
  } catch (err) {
    console.error('[ADMIN][CSR][ACTIVITIES] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to fetch CSR activities' });
  }
});

// POST /api/admin/csr/activities
router.post('/csr/activities', auth, admin, async (req, res) => {
  try {
    const summary = await getOrCreateCsrSummary();
    const fallbackMilestone = Math.max(1, Number(summary.completedMilestones || 0) || 1);
    const milestoneAmount = Math.max(1, Number(summary.milestoneAmount || CSR_MILESTONE_AMOUNT));

    const title = safeText(req.body?.title || '', 160);
    if (!title) {
      return res.status(400).json({ message: 'title is required' });
    }

    const requestedMilestone = Math.max(1, Number(req.body?.milestoneNumber || fallbackMilestone));
    const existing = await CsrActivity.findOne({ milestoneNumber: requestedMilestone }).lean();
    if (existing) {
      return res.status(409).json({ message: 'CSR activity for this milestone already exists' });
    }

    const rawMedia = Array.isArray(req.body?.media) ? req.body.media.slice(0, 20) : [];
    const media = [];
    for (const entry of rawMedia) {
      const saved = await persistCsrMedia(req, entry || {});
      if (saved && saved.url) {
        media.push(saved);
      }
    }

    const activity = await CsrActivity.create({
      title,
      description: safeText(req.body?.description || '', 2000),
      milestoneNumber: requestedMilestone,
      milestoneAmount,
      targetAmount: Math.max(1, Number(req.body?.targetAmount || milestoneAmount)),
      fundedAmount: Math.max(0, Number(req.body?.fundedAmount || milestoneAmount)),
      ordersCounted: Math.max(0, Number(req.body?.ordersCounted || milestoneAmount)),
      activityDate: req.body?.activityDate ? new Date(req.body.activityDate) : null,
      location: safeText(req.body?.location || '', 160),
      media,
      status: req.body?.status === 'published' ? 'published' : 'draft',
      publishedAt: req.body?.status === 'published' ? new Date() : null,
      createdBy: req.user?._id || null,
      updatedBy: req.user?._id || null,
    });

    await writeAuditLog(req, {
      action: 'create_csr_activity',
      targetType: 'csr_activity',
      targetId: String(activity._id),
      note: `Created CSR activity milestone #${requestedMilestone}`,
      before: null,
      after: activity.toObject(),
      meta: { milestoneNumber: requestedMilestone },
    });

    return res.status(201).json({ activity: mapCsrActivity(activity) });
  } catch (err) {
    console.error('[ADMIN][CSR][CREATE] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to create CSR activity' });
  }
});

// PATCH /api/admin/csr/activities/:id
router.patch('/csr/activities/:id', auth, admin, async (req, res) => {
  try {
    const activityId = toObjectId(req.params.id);
    if (!activityId) {
      return res.status(400).json({ message: 'Invalid CSR activity id' });
    }

    const activity = await CsrActivity.findById(activityId);
    if (!activity) {
      return res.status(404).json({ message: 'CSR activity not found' });
    }

    const before = activity.toObject();
    if (typeof req.body?.title === 'string') {
      activity.title = safeText(req.body.title, 160);
    }
    if (typeof req.body?.description === 'string') {
      activity.description = safeText(req.body.description, 2000);
    }
    if (typeof req.body?.location === 'string') {
      activity.location = safeText(req.body.location, 160);
    }
    if (req.body?.activityDate !== undefined) {
      activity.activityDate = req.body.activityDate ? new Date(req.body.activityDate) : null;
    }
    if (req.body?.targetAmount !== undefined) {
      activity.targetAmount = Math.max(1, Number(req.body.targetAmount || CSR_MILESTONE_AMOUNT));
    }
    if (req.body?.fundedAmount !== undefined) {
      activity.fundedAmount = Math.max(0, Number(req.body.fundedAmount || 0));
    }
    if (req.body?.ordersCounted !== undefined) {
      activity.ordersCounted = Math.max(0, Number(req.body.ordersCounted || 0));
    }

    if (Array.isArray(req.body?.media)) {
      const nextMedia = [];
      const trimmed = req.body.media.slice(0, 20);
      for (const entry of trimmed) {
        const saved = await persistCsrMedia(req, entry || {});
        if (saved && saved.url) {
          nextMedia.push(saved);
        }
      }
      activity.media = nextMedia;
    }

    activity.updatedBy = req.user?._id || null;
    await activity.save();

    await writeAuditLog(req, {
      action: 'update_csr_activity',
      targetType: 'csr_activity',
      targetId: String(activity._id),
      note: `Updated CSR activity milestone #${activity.milestoneNumber}`,
      before,
      after: activity.toObject(),
      meta: null,
    });

    return res.json({ activity: mapCsrActivity(activity) });
  } catch (err) {
    console.error('[ADMIN][CSR][UPDATE] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to update CSR activity' });
  }
});

// PATCH /api/admin/csr/activities/:id/publish
router.patch('/csr/activities/:id/publish', auth, admin, async (req, res) => {
  try {
    const activityId = toObjectId(req.params.id);
    if (!activityId) {
      return res.status(400).json({ message: 'Invalid CSR activity id' });
    }

    const shouldPublish = toBoolean(req.body?.published, true);
    const activity = await CsrActivity.findById(activityId);
    if (!activity) {
      return res.status(404).json({ message: 'CSR activity not found' });
    }

    const before = activity.toObject();
    activity.status = shouldPublish ? 'published' : 'draft';
    activity.publishedAt = shouldPublish ? new Date() : null;
    activity.updatedBy = req.user?._id || null;
    await activity.save();

    await writeAuditLog(req, {
      action: shouldPublish ? 'publish_csr_activity' : 'unpublish_csr_activity',
      targetType: 'csr_activity',
      targetId: String(activity._id),
      note: `${shouldPublish ? 'Published' : 'Unpublished'} CSR activity milestone #${activity.milestoneNumber}`,
      before,
      after: activity.toObject(),
      meta: null,
    });

    return res.json({ activity: mapCsrActivity(activity) });
  } catch (err) {
    console.error('[ADMIN][CSR][PUBLISH] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to update CSR publish status' });
  }
});

// ============================================================================
// AUDIT DASHBOARD ENDPOINTS
// ============================================================================

// GET /api/admin/audit/webhooks — Paginated webhook audit log
router.get('/audit/webhooks', auth, admin, async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req, { limit: 50, maxLimit: 200 });
    const query = {};

    const provider = safeText(req.query.provider, 20).toLowerCase();
    if (provider && ['razorpay', 'nimbuspost'].includes(provider)) query.provider = provider;

    if (req.query.signatureValid === 'true') query.signatureValid = true;
    if (req.query.signatureValid === 'false') query.signatureValid = false;

    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    if (from || to) {
      query.receivedAt = {};
      if (from) query.receivedAt.$gte = from;
      if (to) query.receivedAt.$lte = to;
    }

    const orderId = toObjectId(req.query.orderId);
    if (orderId) query.orderId = orderId;

    const awb = safeText(req.query.awbNumber, 50);
    if (awb) query.awbNumber = awb;

    const [docs, total] = await Promise.all([
      WebhookAudit.find(query).sort({ receivedAt: -1 }).skip(skip).limit(limit).lean(),
      WebhookAudit.countDocuments(query),
    ]);

    return res.json({ webhooks: docs, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } });
  } catch (err) {
    console.error('[ADMIN][AUDIT][WEBHOOKS] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to fetch webhook audit log' });
  }
});

// GET /api/admin/audit/reconciliation — Payment reconciliation history
router.get('/audit/reconciliation', auth, admin, async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req, { limit: 50, maxLimit: 200 });
    const query = {};

    const orderId = toObjectId(req.query.orderId);
    const sellerId = toObjectId(req.query.sellerId);
    const event = safeText(req.query.event, 50);
    if (orderId) query.order = orderId;
    if (sellerId) query.seller = sellerId;
    if (event) query.event = event;

    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = from;
      if (to) query.createdAt.$lte = to;
    }

    const [docs, total] = await Promise.all([
      PaymentReconciliation.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      PaymentReconciliation.countDocuments(query),
    ]);

    return res.json({ reconciliations: docs, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } });
  } catch (err) {
    console.error('[ADMIN][AUDIT][RECONCILIATION] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to fetch reconciliation log' });
  }
});

// GET /api/admin/audit/shipment-events — Shipment event log
router.get('/audit/shipment-events', auth, admin, async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req, { limit: 50, maxLimit: 200 });
    const query = {};

    const orderId = toObjectId(req.query.orderId);
    const sellerId = toObjectId(req.query.sellerId);
    const event = safeText(req.query.event, 50);
    const shipmentRef = safeText(req.query.shipmentRef, 50);
    if (orderId) query.order = orderId;
    if (sellerId) query.seller = sellerId;
    if (event) query.event = event;
    if (shipmentRef) query.localShipmentRef = shipmentRef;

    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = from;
      if (to) query.createdAt.$lte = to;
    }

    const [docs, total] = await Promise.all([
      ShipmentEvent.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      ShipmentEvent.countDocuments(query),
    ]);

    return res.json({ shipmentEvents: docs, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } });
  } catch (err) {
    console.error('[ADMIN][AUDIT][SHIPMENT_EVENTS] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to fetch shipment events' });
  }
});

// GET /api/admin/audit/order-log/:orderId — Full order lifecycle timeline
router.get('/audit/order-log/:orderId', auth, admin, async (req, res) => {
  try {
    const orderId = toObjectId(req.params.orderId);
    if (!orderId) return res.status(400).json({ message: 'Invalid order id' });

    const { page, limit, skip } = parsePagination(req, { limit: 100, maxLimit: 500 });

    const [docs, total] = await Promise.all([
      OrderAuditLog.find({ order: orderId }).sort({ createdAt: 1 }).skip(skip).limit(limit).lean(),
      OrderAuditLog.countDocuments({ order: orderId }),
    ]);

    return res.json({ orderAuditLog: docs, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } });
  } catch (err) {
    console.error('[ADMIN][AUDIT][ORDER_LOG] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to fetch order audit log' });
  }
});

// GET /api/admin/audit/seller-actions/:sellerId — Seller action history
router.get('/audit/seller-actions/:sellerId', auth, admin, async (req, res) => {
  try {
    const sellerId = toObjectId(req.params.sellerId);
    if (!sellerId) return res.status(400).json({ message: 'Invalid seller id' });

    const { page, limit, skip } = parsePagination(req, { limit: 50, maxLimit: 200 });
    const action = safeText(req.query.action, 50);
    const query = { seller: sellerId };
    if (action) query.action = action;

    const [docs, total] = await Promise.all([
      SellerAction.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      SellerAction.countDocuments(query),
    ]);

    return res.json({ sellerActions: docs, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } });
  } catch (err) {
    console.error('[ADMIN][AUDIT][SELLER_ACTIONS] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to fetch seller actions' });
  }
});

// GET /api/admin/audit/inventory/:productId — Inventory transaction history
router.get('/audit/inventory/:productId', auth, admin, async (req, res) => {
  try {
    const productId = toObjectId(req.params.productId);
    if (!productId) return res.status(400).json({ message: 'Invalid product id' });

    const { page, limit, skip } = parsePagination(req, { limit: 50, maxLimit: 200 });
    const type = safeText(req.query.type, 30);
    const query = { product: productId };
    if (type) query.type = type;

    const [docs, total] = await Promise.all([
      InventoryTransaction.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      InventoryTransaction.countDocuments(query),
    ]);

    return res.json({ inventoryTransactions: docs, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } });
  } catch (err) {
    console.error('[ADMIN][AUDIT][INVENTORY] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to fetch inventory transactions' });
  }
});

// GET /api/admin/audit/stats — Aggregate audit statistics
router.get('/audit/stats', auth, admin, async (req, res) => {
  try {
    const [
      webhooksByProvider,
      webhookFailedSignatures,
      totalReconciliations,
      totalShipmentEvents,
      totalSellerActions,
      totalInventoryTx,
      totalOrderAuditLogs,
      recentWebhookAvgMs,
    ] = await Promise.all([
      WebhookAudit.aggregate([{ $group: { _id: '$provider', count: { $sum: 1 } } }]),
      WebhookAudit.countDocuments({ signatureValid: false }),
      PaymentReconciliation.countDocuments(),
      ShipmentEvent.countDocuments(),
      SellerAction.countDocuments(),
      InventoryTransaction.countDocuments(),
      OrderAuditLog.countDocuments(),
      WebhookAudit.aggregate([
        { $match: { receivedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } },
        { $group: { _id: null, avgMs: { $avg: '$processingMs' }, count: { $sum: 1 } } },
      ]),
    ]);

    const webhookStats = {};
    for (const row of webhooksByProvider || []) {
      webhookStats[String(row._id || 'unknown')] = Number(row.count || 0);
    }

    const last24hWebhook = recentWebhookAvgMs?.[0] || {};

    return res.json({
      generatedAt: new Date().toISOString(),
      webhooks: {
        byProvider: webhookStats,
        totalFailedSignatures: webhookFailedSignatures,
        last24h: {
          count: Number(last24hWebhook.count || 0),
          avgProcessingMs: Number(Number(last24hWebhook.avgMs || 0).toFixed(1)),
        },
      },
      reconciliations: { total: totalReconciliations },
      shipmentEvents: { total: totalShipmentEvents },
      sellerActions: { total: totalSellerActions },
      inventoryTransactions: { total: totalInventoryTx },
      orderAuditLogs: { total: totalOrderAuditLogs },
    });
  } catch (err) {
    console.error('[ADMIN][AUDIT][STATS] Error:', err?.message || err);
    return res.status(500).json({ message: 'Failed to fetch audit stats' });
  }
});

module.exports = router;
