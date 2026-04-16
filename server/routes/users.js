const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const router = express.Router();
const auth = require('../middleware/auth');
const mongoose = require('mongoose');
const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Review = require('../models/Review');
const { getPayoutPolicy, maskBankDetails } = require('../services/payouts');

const AVATAR_UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'avatars');
const DATA_URI_IMAGE_REGEX = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i;

function parseImageDataUri(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = trimmed.match(DATA_URI_IMAGE_REGEX);
  if (!match || !match[2]) return null;

  const format = String(match[1] || 'jpeg').toLowerCase();
  const extension = format === 'jpg' ? 'jpeg' : format;
  let buffer;
  try {
    buffer = Buffer.from(match[2], 'base64');
  } catch {
    return null;
  }
  if (!buffer || !buffer.length) return null;
  return { extension, buffer };
}

async function persistAvatarDataUri(req, dataUri) {
  const parsed = parseImageDataUri(dataUri);
  if (!parsed) return null;

  await fs.promises.mkdir(AVATAR_UPLOAD_DIR, { recursive: true });

  const baseName = crypto.randomUUID();
  const fileName = `${baseName}.${parsed.extension}`;
  const thumbName = `${baseName}-thumb.jpg`;
  const filePath = path.join(AVATAR_UPLOAD_DIR, fileName);
  const thumbPath = path.join(AVATAR_UPLOAD_DIR, thumbName);

  await fs.promises.writeFile(filePath, parsed.buffer);

  let thumbnailUrl = '';
  try {
    await sharp(parsed.buffer)
      .resize({ width: 320, height: 320, fit: 'cover' })
      .jpeg({ quality: 80 })
      .toFile(thumbPath);
    thumbnailUrl = `${req.protocol}://${req.get('host')}/uploads/avatars/${thumbName}`;
  } catch (e) {
    // continue without thumbnail
  }

  const mediaUrl = `${req.protocol}://${req.get('host')}/uploads/avatars/${fileName}`;
  return { url: mediaUrl, thumbnailUrl: thumbnailUrl || mediaUrl };
}

async function getDashboardPayload(user) {
  const listedItemsPromise = Product.find({
    isActive: true,
    $or: [{ seller: user._id }, { sellerName: user.name }],
  }).sort({ createdAt: -1 }).lean();

  const likedIds = (Array.isArray(user.likedProducts) ? user.likedProducts : [])
    .map((id) => String(id))
    .filter(Boolean);

  const cartEntries = Array.isArray(user.cartItems) ? user.cartItems : [];
  const cartProductIds = cartEntries
    .map((entry) => String(entry?.product || ''))
    .filter(Boolean);

  const likedItemsPromise = likedIds.length > 0
    ? Product.find({ _id: { $in: likedIds }, isActive: true }).sort({ createdAt: -1 }).lean()
    : Promise.resolve([]);

  const cartProductsPromise = cartProductIds.length > 0
    ? Product.find({ _id: { $in: cartProductIds }, isActive: true }).lean()
    : Promise.resolve([]);

  const [listedItems, likedItems, cartProducts] = await Promise.all([
    listedItemsPromise,
    likedItemsPromise,
    cartProductsPromise,
  ]);

  const cartProductMap = new Map(cartProducts.map((product) => [String(product._id), product]));
  const cartItems = cartEntries
    .map((entry) => {
      const product = cartProductMap.get(String(entry?.product || ''));
      if (!product) return null;
      return { product, quantity: Number(entry.quantity) || 1 };
    })
    .filter(Boolean);

  return {
    user: {
      id: user._id,
      name: user.name,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      email: user.email,
      emailVerified: Boolean(user.emailVerified),
      googleId: user.googleId || null,
      authProvider: user.authProvider || 'local',
      avatarUrl: user.avatarUrl || '',
      phoneNumber: user.phoneNumber || '',
      locale: user.locale || '',
      isAdmin: Boolean(user.isAdmin),
      createdAt: user.createdAt,
      stats: {
        listedCount: listedItems.length,
        likedCount: likedItems.length,
        cartCount: cartItems.length,
      },
    },
    listedItems,
    likedItems,
    cartItems,
  };
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeTextField(value, maxLength = 240) {
  if (typeof value !== 'string') {
    return undefined;
  }
  return value.trim().slice(0, maxLength);
}

function normalizeSellerWebsite(value) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim().slice(0, 240);
  if (!trimmed) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function mapAddressToSellerPickup(addressDoc = {}, overrides = {}) {
  return {
    addressId: String(overrides.addressId || addressDoc?._id || '').trim(),
    label: String(overrides.label || addressDoc?.label || 'Pickup').trim().slice(0, 60),
    fullName: String(overrides.fullName || addressDoc?.fullName || '').trim().slice(0, 120),
    phoneNumber: String(overrides.phoneNumber || addressDoc?.phoneNumber || '').trim().slice(0, 40),
    email: String(overrides.email || addressDoc?.email || '').trim().slice(0, 140),
    street: String(overrides.street || addressDoc?.street || '').trim().slice(0, 240),
    city: String(overrides.city || addressDoc?.city || '').trim().slice(0, 120),
    state: String(overrides.state || addressDoc?.state || '').trim().slice(0, 120),
    postalCode: String(overrides.postalCode || addressDoc?.postalCode || '').trim().slice(0, 20),
    country: String(overrides.country || addressDoc?.country || 'India').trim().slice(0, 80) || 'India',
  };
}

function sanitizeSellerPickupAddress(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const next = mapAddressToSellerPickup(raw, {
    addressId: typeof raw.addressId === 'string' ? raw.addressId : '',
  });

  if (!next.fullName || !next.phoneNumber || !next.street || !next.city || !next.state || !next.postalCode) {
    return null;
  }

  return next;
}

function toNonNegativeNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

async function resolveSellerUser({ sellerId, sellerName, productId }) {
  const normalizedSellerId = String(sellerId || '').trim();
  const normalizedSellerName = String(sellerName || '').trim();
  const normalizedProductId = String(productId || '').trim();

  if (mongoose.Types.ObjectId.isValid(normalizedSellerId)) {
    const userById = await User.findById(normalizedSellerId)
      .select('-password -likedProducts -cartItems -addresses');
    if (userById) {
      return userById;
    }
  }

  if (normalizedSellerName) {
    const sellerRegex = new RegExp(`^${escapeRegex(normalizedSellerName)}$`, 'i');
    const userByName = await User.findOne({ name: { $regex: sellerRegex } })
      .select('-password -likedProducts -cartItems -addresses');
    if (userByName) {
      return userByName;
    }
  }

  if (mongoose.Types.ObjectId.isValid(normalizedProductId)) {
    const product = await Product.findOne({ _id: normalizedProductId, isActive: true }).select('seller sellerName');
    if (product?.seller) {
      const sellerByProductId = await User.findById(product.seller)
        .select('-password -likedProducts -cartItems -addresses');
      if (sellerByProductId) {
        return sellerByProductId;
      }
    }

    if (product?.sellerName) {
      const sellerRegex = new RegExp(`^${escapeRegex(product.sellerName)}$`, 'i');
      const sellerByProductName = await User.findOne({ name: { $regex: sellerRegex } })
        .select('-password -likedProducts -cartItems -addresses');
      if (sellerByProductName) {
        return sellerByProductName;
      }
    }
  }

  return null;
}

// GET /api/users/seller-public?sellerId=...&sellerName=...&productId=...
router.get('/seller-public', async (req, res) => {
  try {
    const seller = await resolveSellerUser({
      sellerId: req.query.sellerId,
      sellerName: req.query.sellerName,
      productId: req.query.productId,
    });

    if (!seller) {
      return res.status(404).json({ message: 'Seller not found' });
    }

    const sellerNameVariants = [seller.name, seller.sellerDisplayName]
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);

    const listedItems = await Product.find({
      isActive: true,
      $or: [
        { seller: seller._id },
        ...sellerNameVariants.map((entry) => ({ sellerName: entry })),
      ],
    })
      .sort({ createdAt: -1 })
      .lean();

    const productIds = listedItems.map((entry) => entry._id).filter(Boolean);
    const [soldAgg, reviewAgg] = productIds.length > 0
      ? await Promise.all([
          Order.aggregate([
            { $match: { status: { $ne: 'cancelled' } } },
            { $unwind: '$items' },
            { $match: { 'items.product': { $in: productIds } } },
            { $group: { _id: null, totalSold: { $sum: '$items.quantity' } } },
          ]),
          Review.aggregate([
            { $match: { product: { $in: productIds }, isActive: true } },
            {
              $group: {
                _id: null,
                averageRating: { $avg: '$rating' },
                totalReviews: { $sum: 1 },
              },
            },
          ]),
        ])
      : [[], []];

    const totalSold = Number(soldAgg?.[0]?.totalSold || 0);
    const averageRating = Number(Number(reviewAgg?.[0]?.averageRating || 0).toFixed(1));
    const totalReviews = Number(reviewAgg?.[0]?.totalReviews || 0);

    return res.json({
      seller: {
        id: String(seller._id),
        name: String(seller.name || ''),
        displayName: String(seller.sellerDisplayName || seller.name || ''),
        avatarUrl: String(seller.avatarUrl || ''),
        tagline: String(seller.sellerTagline || ''),
        story: String(seller.sellerStory || ''),
        storyVideoUrl: String(seller.sellerStoryVideoUrl || ''),
        instagram: String(seller.sellerInstagram || ''),
        contactEmail: String(seller.sellerContactEmail || seller.email || ''),
        contactPhone: String(seller.sellerContactPhone || seller.phoneNumber || ''),
        website: String(seller.sellerWebsite || ''),
        location: String(seller.sellerLocation || ''),
      },
      stats: {
        totalListings: listedItems.length,
        totalSold,
        averageRating,
        totalReviews,
      },
      items: listedItems,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/users/me/seller-profile
router.put('/me/seller-profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('name sellerDisplayName sellerTagline sellerStory sellerStoryVideoUrl sellerInstagram sellerContactEmail sellerContactPhone sellerWebsite sellerLocation sellerPickupAddress addresses updatedAt');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const updates = {};

    const sellerDisplayName = sanitizeTextField(req.body?.sellerDisplayName, 80);
    const sellerTagline = sanitizeTextField(req.body?.sellerTagline, 120);
    const sellerStory = sanitizeTextField(req.body?.sellerStory, 2000);
    const sellerStoryVideoUrl = sanitizeTextField(req.body?.sellerStoryVideoUrl, 600);
    const sellerInstagram = sanitizeTextField(req.body?.sellerInstagram, 140);
    const sellerContactEmail = sanitizeTextField(req.body?.sellerContactEmail, 140);
    const sellerContactPhone = sanitizeTextField(req.body?.sellerContactPhone, 40);
    const sellerWebsite = normalizeSellerWebsite(req.body?.sellerWebsite);
    const sellerLocation = sanitizeTextField(req.body?.sellerLocation, 140);

    if (sellerDisplayName !== undefined) updates.sellerDisplayName = sellerDisplayName;
    if (sellerTagline !== undefined) updates.sellerTagline = sellerTagline;
    if (sellerStory !== undefined) updates.sellerStory = sellerStory;
    if (sellerStoryVideoUrl !== undefined) updates.sellerStoryVideoUrl = sellerStoryVideoUrl;
    if (sellerInstagram !== undefined) updates.sellerInstagram = sellerInstagram;
    if (sellerContactEmail !== undefined) updates.sellerContactEmail = sellerContactEmail;
    if (sellerContactPhone !== undefined) updates.sellerContactPhone = sellerContactPhone;
    if (sellerWebsite !== undefined) updates.sellerWebsite = sellerWebsite;
    if (sellerLocation !== undefined) updates.sellerLocation = sellerLocation;

    const pickupAddressId = typeof req.body?.sellerPickupAddressId === 'string'
      ? req.body.sellerPickupAddressId.trim()
      : '';
    const pickupAddressPayload = sanitizeSellerPickupAddress(req.body?.sellerPickupAddress);

    if (pickupAddressId) {
      if (!mongoose.Types.ObjectId.isValid(pickupAddressId)) {
        return res.status(400).json({ message: 'Invalid sellerPickupAddressId value' });
      }

      const selectedAddress = (user.addresses || []).find(
        (entry) => String(entry?._id || '') === pickupAddressId
      );

      if (!selectedAddress) {
        return res.status(400).json({ message: 'Selected pickup address was not found in your saved addresses.' });
      }

      if (!String(selectedAddress?.state || '').trim()) {
        return res.status(400).json({ message: 'Selected pickup address is missing state. Please edit the address and add state.' });
      }

      updates.sellerPickupAddress = {
        ...mapAddressToSellerPickup(selectedAddress, {
          addressId: pickupAddressId,
          label: selectedAddress.label || 'Pickup',
        }),
        updatedAt: new Date(),
      };
    } else if (pickupAddressPayload) {
      updates.sellerPickupAddress = {
        ...pickupAddressPayload,
        updatedAt: new Date(),
      };
    }

    Object.entries(updates).forEach(([key, value]) => {
      user[key] = value;
    });
    user.updatedAt = new Date();
    await user.save();

    const persistedUser = await User.findById(req.user._id)
      .select('-password -likedProducts -cartItems -addresses');

    if (!persistedUser) {
      return res.status(404).json({ message: 'User not found after update' });
    }

    if (sellerDisplayName !== undefined) {
      const listingDisplayName = String(sellerDisplayName || user.name || '').trim();
      if (listingDisplayName) {
        await Product.updateMany(
          { seller: persistedUser._id },
          { sellerName: listingDisplayName }
        );
      }
    }

    return res.json({
      message: 'Seller profile updated successfully',
      sellerProfile: {
        id: String(persistedUser._id),
        displayName: String(persistedUser.sellerDisplayName || persistedUser.name || ''),
        tagline: String(persistedUser.sellerTagline || ''),
        story: String(persistedUser.sellerStory || ''),
        storyVideoUrl: String(persistedUser.sellerStoryVideoUrl || ''),
        instagram: String(persistedUser.sellerInstagram || ''),
        contactEmail: String(persistedUser.sellerContactEmail || persistedUser.email || ''),
        contactPhone: String(persistedUser.sellerContactPhone || persistedUser.phoneNumber || ''),
        website: String(persistedUser.sellerWebsite || ''),
        location: String(persistedUser.sellerLocation || ''),
        sellerPickupAddress: {
          addressId: String(persistedUser?.sellerPickupAddress?.addressId || ''),
          label: String(persistedUser?.sellerPickupAddress?.label || ''),
          fullName: String(persistedUser?.sellerPickupAddress?.fullName || ''),
          phoneNumber: String(persistedUser?.sellerPickupAddress?.phoneNumber || ''),
          email: String(persistedUser?.sellerPickupAddress?.email || ''),
          street: String(persistedUser?.sellerPickupAddress?.street || ''),
          city: String(persistedUser?.sellerPickupAddress?.city || ''),
          state: String(persistedUser?.sellerPickupAddress?.state || ''),
          postalCode: String(persistedUser?.sellerPickupAddress?.postalCode || ''),
          country: String(persistedUser?.sellerPickupAddress?.country || 'India'),
          updatedAt: persistedUser?.sellerPickupAddress?.updatedAt || null,
        },
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/users/me/seller-payout-profile
router.get('/me/seller-payout-profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('sellerPayoutProfile sellerPayoutSettings sellerTrust');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.json({
      payoutProfile: {
        kycStatus: String(user?.sellerPayoutProfile?.kycStatus || 'pending'),
        kycVerifiedAt: user?.sellerPayoutProfile?.kycVerifiedAt || null,
        bankDetails: maskBankDetails(user?.sellerPayoutProfile?.bankDetails || {}),
      },
      payoutSettings: {
        autoPayoutEnabled: user?.sellerPayoutSettings?.autoPayoutEnabled !== false,
        minimumPayoutAmount: Number(user?.sellerPayoutSettings?.minimumPayoutAmount || 0),
        reservePercent: Number(user?.sellerPayoutSettings?.reservePercent || 10),
        overrideCoolingDays: user?.sellerPayoutSettings?.overrideCoolingDays ?? null,
      },
      trust: {
        deliveredOrderCount: Number(user?.sellerTrust?.deliveredOrderCount || 0),
        isTrusted: Boolean(user?.sellerTrust?.isTrusted),
        trustedSince: user?.sellerTrust?.trustedSince || null,
      },
      policy: getPayoutPolicy(),
    });
  } catch (err) {
    console.error('[USERS][SELLER_PAYOUT_PROFILE][GET] Error:', err?.message || err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/users/me/seller-payout-profile
router.put('/me/seller-payout-profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.sellerPayoutProfile = user.sellerPayoutProfile || {};
    user.sellerPayoutProfile.bankDetails = user.sellerPayoutProfile.bankDetails || {};
    user.sellerPayoutSettings = user.sellerPayoutSettings || {};

    const kycStatus = typeof req.body?.kycStatus === 'string' ? req.body.kycStatus.trim().toLowerCase() : null;
    if (kycStatus && !['pending', 'verified', 'rejected'].includes(kycStatus)) {
      return res.status(400).json({ message: 'Invalid kycStatus value' });
    }

    if (kycStatus) {
      user.sellerPayoutProfile.kycStatus = kycStatus;
      user.sellerPayoutProfile.kycVerifiedAt = kycStatus === 'verified' ? new Date() : null;
    }

    const bankPayload = req.body?.bankDetails || {};
    const accountType = typeof bankPayload?.accountType === 'string'
      ? bankPayload.accountType.trim().toLowerCase()
      : null;

    if (accountType && !['bank', 'upi'].includes(accountType)) {
      return res.status(400).json({ message: 'Invalid bankDetails.accountType value' });
    }

    if (accountType) user.sellerPayoutProfile.bankDetails.accountType = accountType;
    if (typeof bankPayload?.accountHolderName === 'string') user.sellerPayoutProfile.bankDetails.accountHolderName = bankPayload.accountHolderName.trim().slice(0, 120);
    if (typeof bankPayload?.accountNumber === 'string') user.sellerPayoutProfile.bankDetails.accountNumber = bankPayload.accountNumber.replace(/\s+/g, '').slice(0, 32);
    if (typeof bankPayload?.ifsc === 'string') user.sellerPayoutProfile.bankDetails.ifsc = bankPayload.ifsc.trim().toUpperCase().slice(0, 20);
    if (typeof bankPayload?.bankName === 'string') user.sellerPayoutProfile.bankDetails.bankName = bankPayload.bankName.trim().slice(0, 120);
    if (typeof bankPayload?.branch === 'string') user.sellerPayoutProfile.bankDetails.branch = bankPayload.branch.trim().slice(0, 120);
    if (typeof bankPayload?.upiId === 'string') user.sellerPayoutProfile.bankDetails.upiId = bankPayload.upiId.trim().slice(0, 140);
    if (typeof bankPayload?.razorpayLinkedAccountId === 'string') {
      user.sellerPayoutProfile.bankDetails.razorpayLinkedAccountId = bankPayload.razorpayLinkedAccountId.trim().slice(0, 80);
    }

    if (typeof bankPayload?.isVerified === 'boolean') {
      user.sellerPayoutProfile.bankDetails.isVerified = bankPayload.isVerified;
      user.sellerPayoutProfile.bankDetails.verifiedAt = bankPayload.isVerified ? new Date() : null;
    }

    const finalAccountType = String(user?.sellerPayoutProfile?.bankDetails?.accountType || 'bank').toLowerCase();
    if (finalAccountType === 'bank') {
      const hasAccount = Boolean(String(user?.sellerPayoutProfile?.bankDetails?.accountNumber || '').trim());
      const hasIfsc = Boolean(String(user?.sellerPayoutProfile?.bankDetails?.ifsc || '').trim());
      if ((hasAccount && !hasIfsc) || (!hasAccount && hasIfsc)) {
        return res.status(400).json({ message: 'Both account number and IFSC are required for bank payouts.' });
      }
    }

    const settingsPayload = req.body?.payoutSettings || {};
    if (typeof settingsPayload?.autoPayoutEnabled === 'boolean') {
      user.sellerPayoutSettings.autoPayoutEnabled = settingsPayload.autoPayoutEnabled;
    }

    if (settingsPayload?.minimumPayoutAmount !== undefined) {
      user.sellerPayoutSettings.minimumPayoutAmount = toNonNegativeNumber(settingsPayload.minimumPayoutAmount, 0);
    }

    if (settingsPayload?.reservePercent !== undefined) {
      const reservePercent = toNonNegativeNumber(settingsPayload.reservePercent, 10);
      if (reservePercent > 100) {
        return res.status(400).json({ message: 'reservePercent cannot be greater than 100' });
      }
      user.sellerPayoutSettings.reservePercent = reservePercent;
    }

    if (settingsPayload?.overrideCoolingDays !== undefined) {
      if (settingsPayload.overrideCoolingDays === null || settingsPayload.overrideCoolingDays === '') {
        user.sellerPayoutSettings.overrideCoolingDays = null;
      } else {
        const coolingDays = toNonNegativeNumber(settingsPayload.overrideCoolingDays, 0);
        if (coolingDays > 60) {
          return res.status(400).json({ message: 'overrideCoolingDays cannot exceed 60 days' });
        }
        user.sellerPayoutSettings.overrideCoolingDays = Math.floor(coolingDays);
      }
    }

    user.updatedAt = new Date();
    await user.save();

    return res.json({
      message: 'Seller payout profile updated successfully',
      payoutProfile: {
        kycStatus: String(user?.sellerPayoutProfile?.kycStatus || 'pending'),
        kycVerifiedAt: user?.sellerPayoutProfile?.kycVerifiedAt || null,
        bankDetails: maskBankDetails(user?.sellerPayoutProfile?.bankDetails || {}),
      },
      payoutSettings: {
        autoPayoutEnabled: user?.sellerPayoutSettings?.autoPayoutEnabled !== false,
        minimumPayoutAmount: Number(user?.sellerPayoutSettings?.minimumPayoutAmount || 0),
        reservePercent: Number(user?.sellerPayoutSettings?.reservePercent || 10),
        overrideCoolingDays: user?.sellerPayoutSettings?.overrideCoolingDays ?? null,
      },
    });
  } catch (err) {
    console.error('[USERS][SELLER_PAYOUT_PROFILE][PUT] Error:', err?.message || err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/users/me
router.get('/me', auth, async (req, res) => {
  try {
      const user = await User.findById(req.user._id).select('-password -likedProducts -cartItems');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/users/me/profile-dashboard
router.get('/me/profile-dashboard', auth, async (req, res) => {
  try {
      const user = await User.findById(req.user._id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const payload = await getDashboardPayload(user);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/users/me/listed-items
router.get('/me/listed-items', auth, async (req, res) => {
  try {
      const user = await User.findById(req.user._id).select('name');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const listedItems = await Product.find({
      isActive: true,
      $or: [{ seller: user._id }, { sellerName: user.name }],
    })
      .select('_id title description price images customizable isCustomizable monthlySold createdAt')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ items: listedItems });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/users/me/liked/:productId (toggle)
router.post('/me/liked/:productId', auth, async (req, res) => {
  try {
    const { productId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ message: 'Invalid product id' });
    }

    const product = await Product.findOne({ _id: productId, isActive: true }).select('_id');
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

      const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!Array.isArray(user.likedProductTimestamps)) {
      user.likedProductTimestamps = [];
    }

    const exists = user.likedProducts.some((id) => String(id) === String(productId));
    if (exists) {
      user.likedProducts = user.likedProducts.filter((id) => String(id) !== String(productId));
      user.likedProductTimestamps = user.likedProductTimestamps.filter(
        (entry) => String(entry.product) !== String(productId)
      );
    } else {
      user.likedProducts.push(productId);
      const tsIndex = user.likedProductTimestamps.findIndex(
        (entry) => String(entry.product) === String(productId)
      );
      if (tsIndex >= 0) {
        user.likedProductTimestamps[tsIndex].likedAt = new Date();
      } else {
        user.likedProductTimestamps.push({ product: productId, likedAt: new Date() });
      }
    }

    await user.save();
    res.json({
      liked: !exists,
      likedProductIds: user.likedProducts,
      message: exists ? 'Removed from liked items' : 'Added to liked items',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/users/me/cart/:productId
router.post('/me/cart/:productId', auth, async (req, res) => {
  try {
    const { productId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ message: 'Invalid product id' });
    }

    const product = await Product.findOne({ _id: productId, isActive: true }).select('_id');
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const quantity = Math.max(Number(req.body?.quantity) || 1, 1);

    // Atomic update to prevent cart overwrite when multiple add requests happen close together.
      const incremented = await User.findOneAndUpdate(
        { _id: req.user._id, 'cartItems.product': productId },
      { $inc: { 'cartItems.$.quantity': quantity } },
      { new: true }
    );

    if (!incremented) {
        await User.findOneAndUpdate(
          { _id: req.user._id, 'cartItems.product': { $ne: productId } },
        { $push: { cartItems: { product: productId, quantity } } },
        { new: true }
      );
    }

    res.json({ message: 'Added to cart' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/users/me/cart
router.put('/me/cart', auth, async (req, res) => {
  try {
    const incomingItems = Array.isArray(req.body?.items) ? req.body.items : [];

    const merged = new Map();
    for (const rawItem of incomingItems) {
      const productId = String(rawItem?.productId || rawItem?.product || '').trim();
      if (!mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({ message: 'Invalid product id in cart items' });
      }

      const quantity = Math.max(Number(rawItem?.quantity) || 1, 1);
      merged.set(productId, (merged.get(productId) || 0) + quantity);
    }

    const productIds = Array.from(merged.keys());

    if (productIds.length > 0) {
      const products = await Product.find({ _id: { $in: productIds }, isActive: true }).select('_id');
      if (products.length !== productIds.length) {
        return res.status(400).json({ message: 'One or more cart products are invalid or inactive' });
      }
    }

      const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.cartItems = productIds.map((productId) => ({
      product: productId,
      quantity: merged.get(productId),
    }));

    await user.save();
    res.json({ message: 'Cart synchronized successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/users/me/cart/:productId
router.delete('/me/cart/:productId', auth, async (req, res) => {
  try {
    const { productId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ message: 'Invalid product id' });
    }

      const user = await User.findByIdAndUpdate(
        req.user._id,
      { $pull: { cartItems: { product: productId } } },
      { new: true }
    );
    if (!user) return res.status(404).json({ message: 'User not found' });

    res.json({ message: 'Removed from cart' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/users/me - Update user profile
router.put('/me', auth, async (req, res) => {
  try {
    const { name, phoneNumber, bio, avatarUrl } = req.body;
    
    const updates = {};
    if (typeof name === 'string' && name.trim()) {
      const normalizedName = name.trim();
      const parts = normalizedName.split(/\s+/).filter(Boolean);
      updates.name = normalizedName;
      updates.firstName = parts[0] || '';
      updates.lastName = parts.slice(1).join(' ');
    }
    if (typeof phoneNumber === 'string') updates.phoneNumber = phoneNumber.trim();
    if (typeof bio === 'string') updates.bio = bio.trim();
    if (typeof avatarUrl === 'string') updates.avatarUrl = avatarUrl.trim();

      const user = await User.findByIdAndUpdate(
        req.user._id,
      { ...updates, updatedAt: Date.now() },
      { new: true }
    ).select('-password -cartItems -likedProducts');

    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/users/me/avatar - Upload avatar as data URI; by default sets on user.
// If caller passes { setOnProfile: false } the image will be persisted but not applied to the user's profile.
router.post('/me/avatar', auth, async (req, res) => {
  try {
    const { dataUri, setOnProfile } = req.body || {};
    if (!dataUri || typeof dataUri !== 'string') {
      return res.status(400).json({ message: 'Missing image data' });
    }

    const persisted = await persistAvatarDataUri(req, dataUri);
    if (!persisted) {
      return res.status(400).json({ message: 'Invalid image data' });
    }

    const shouldSet = setOnProfile === undefined ? true : Boolean(setOnProfile);
    if (!shouldSet) {
      return res.json({ message: 'Avatar uploaded', url: persisted.url, thumbnailUrl: persisted.thumbnailUrl });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { avatarUrl: persisted.url, updatedAt: Date.now() },
      { new: true }
    ).select('-password -cartItems -likedProducts');

    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'Avatar uploaded', user });
  } catch (err) {
    console.error('Upload avatar error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/users/avatars - list available default avatars from uploads/avatars
router.get('/avatars', async (req, res) => {
  try {
    await fs.promises.mkdir(AVATAR_UPLOAD_DIR, { recursive: true });
    const files = await fs.promises.readdir(AVATAR_UPLOAD_DIR);
    const imageFiles = files.filter((f) => /\.(jpe?g|png|webp)$/i.test(f) && !f.endsWith('-thumb.jpg'));
    const images = await Promise.all(imageFiles.map(async (f) => {
      const filePath = path.join(AVATAR_UPLOAD_DIR, f);
      try {
        const st = await fs.promises.stat(filePath);
        const mtime = Math.floor(st.mtimeMs || Date.now());
        const base = `${req.protocol}://${req.get('host')}/uploads/avatars/${f}`;
        return `${base}?v=${mtime}`;
      } catch (e) {
        return `${req.protocol}://${req.get('host')}/uploads/avatars/${f}`;
      }
    }));
    res.json({ avatars: images });
  } catch (err) {
    console.error('List avatars error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/users/me/orders - Get order history
router.get('/me/orders', auth, async (req, res) => {
  try {
    const Order = require('../models/Order');
    // Lightweight list payload for profile + recommendation features.
    const orders = await Order.find({ user: req.user._id })
      .select('_id status createdAt totalAmount items.product items.title')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ orders });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/users/me/orders/:orderId - Get single order details
router.get('/me/orders/:orderId', auth, async (req, res) => {
  try {
    const Order = require('../models/Order');
    if (!mongoose.Types.ObjectId.isValid(req.params.orderId)) {
      return res.status(400).json({ message: 'Invalid order id' });
    }

    const order = await Order.findOne({
      _id: req.params.orderId,
      user: req.user._id,
    }).lean();

    if (!order) return res.status(404).json({ message: 'Order not found' });
    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/users/me/addresses - Get saved addresses
router.get('/me/addresses', auth, async (req, res) => {
  try {
      const user = await User.findById(req.user._id).select('addresses');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ addresses: user.addresses || [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/users/me/addresses - Add new address
router.post('/me/addresses', auth, async (req, res) => {
  try {
    const { label, fullName, phoneNumber, email, street, city, state, postalCode, country, isDefault } = req.body;

    if (!fullName || !phoneNumber || !email || !street || !city || !postalCode) {
      return res.status(400).json({ message: 'Missing required address fields' });
    }

    const newAddress = {
      label: label || 'Home',
      fullName,
      phoneNumber,
      email,
      street,
      city,
      state: state || '',
      postalCode,
      country: country || 'India',
      isDefault: isDefault === true,
    };

      const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (isDefault) {
      user.addresses.forEach((addr) => {
        addr.isDefault = false;
      });
    }

    user.addresses.push(newAddress);
    await user.save();

    res.json({ message: 'Address added successfully', addresses: user.addresses });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/users/me/addresses/:addressIndex - Update address
router.put('/me/addresses/:addressIndex', auth, async (req, res) => {
  try {
    const index = parseInt(req.params.addressIndex, 10);
    const { label, fullName, phoneNumber, email, street, city, state, postalCode, country, isDefault } = req.body;

    if (!fullName || !phoneNumber || !email || !street || !city || !postalCode) {
      return res.status(400).json({ message: 'Missing required address fields' });
    }

      const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (index < 0 || index >= user.addresses.length) {
      return res.status(400).json({ message: 'Invalid address index' });
    }

    if (isDefault) {
      user.addresses.forEach((addr) => {
        addr.isDefault = false;
      });
    }

    user.addresses[index] = {
      label: label || user.addresses[index]?.label || 'Home',
      fullName,
      phoneNumber,
      email,
      street,
      city,
      state: state || '',
      postalCode,
      country: country || 'India',
      isDefault: isDefault === true,
    };

    await user.save();
    res.json({ message: 'Address updated successfully', addresses: user.addresses });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/users/me/addresses/:addressIndex - Delete address
router.delete('/me/addresses/:addressIndex', auth, async (req, res) => {
  try {
    const index = parseInt(req.params.addressIndex, 10);

      const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (index < 0 || index >= user.addresses.length) {
      return res.status(400).json({ message: 'Invalid address index' });
    }

    user.addresses.splice(index, 1);
    await user.save();

    res.json({ message: 'Address deleted successfully', addresses: user.addresses });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
