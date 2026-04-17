const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const sharp = require('sharp');
const router = express.Router();
const Product = require('../models/Product');
const Review = require('../models/Review');
const User = require('../models/User');
const Order = require('../models/Order');
const auth = require('../middleware/auth');

const PRODUCT_UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'products');
const DATA_URI_IMAGE_REGEX = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i;
const MAX_REVIEW_MEDIA_PER_REVIEW = 10;

const ALLOWED_PRODUCT_CATEGORIES = [
  'Jewelry',
  'Home Decor',
  'Kitchen',
  'Textiles',
  'Pottery',
  'Woodwork',
  'Accessories',
  'Art',
  'Others',
];

const ALLOWED_PRODUCT_CATEGORY_MAP = new Map(
  ALLOWED_PRODUCT_CATEGORIES.map((category) => [category.toLowerCase(), category])
);

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

// Multer disk storage for handling file uploads (videos, large files)
let mediaUpload;
try {
  const multer = require('multer');
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        fs.mkdirSync(PRODUCT_UPLOAD_DIR, { recursive: true });
      } catch (e) {
        // ignore
      }
      cb(null, PRODUCT_UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '';
      const base = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
      cb(null, `${base}${ext}`);
    },
  });
  mediaUpload = multer({ storage });
} catch (e) {
  // multer not available in this environment — provide a no-op fallback
  mediaUpload = { single: () => (req, res, next) => next() };
}

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

async function persistImageDataUri(req, dataUri) {
  const parsed = parseImageDataUri(dataUri);
  if (!parsed) {
    return null;
  }

  await fs.promises.mkdir(PRODUCT_UPLOAD_DIR, { recursive: true });

  const baseName = crypto.randomUUID();
  const fileName = `${baseName}.${parsed.extension}`;
  const thumbName = `${baseName}-thumb.jpg`;
  const filePath = path.join(PRODUCT_UPLOAD_DIR, fileName);
  const thumbPath = path.join(PRODUCT_UPLOAD_DIR, thumbName);

  await fs.promises.writeFile(filePath, parsed.buffer);

  let thumbnailUrl = '';
  try {
    await sharp(parsed.buffer)
      .resize({ width: 540, withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toFile(thumbPath);
    thumbnailUrl = `${getPublicBaseUrl(req)}/uploads/products/${thumbName}`;
  } catch {
    // Keep upload resilient if thumbnail transform fails.
  }

  const mediaUrl = `${getPublicBaseUrl(req)}/uploads/products/${fileName}`;
  return {
    url: mediaUrl,
    thumbnailUrl: thumbnailUrl || mediaUrl,
  };
}

function sanitizeReviewMediaEntries(rawMedia) {
  const media = Array.isArray(rawMedia) ? rawMedia.slice(0, MAX_REVIEW_MEDIA_PER_REVIEW) : [];

  return media
    .map((entry) => {
      const type = entry?.type === 'video' ? 'video' : 'image';
      const url = typeof entry?.url === 'string' ? entry.url.trim() : '';
      const thumbnailUrl = typeof entry?.thumbnailUrl === 'string' ? entry.thumbnailUrl.trim() : '';

      if (!url) {
        return null;
      }

      return {
        type,
        url,
        thumbnailUrl: thumbnailUrl || (type === 'image' ? url : ''),
      };
    })
    .filter(Boolean);
}

async function buildReviewMediaGallery(productId) {
  const normalizedProductId = String(productId || '');
  if (!mongoose.Types.ObjectId.isValid(normalizedProductId)) {
    return [];
  }

  const sourceReviews = await Review.find({
    product: normalizedProductId,
    isActive: true,
    'media.0': { $exists: true },
  })
    .select('_id rating createdAt media')
    .sort({ createdAt: -1 })
    .lean();

  const gallery = [];

  for (const review of sourceReviews) {
    const mediaEntries = Array.isArray(review?.media) ? review.media : [];
    for (let index = 0; index < mediaEntries.length; index += 1) {
      const entry = mediaEntries[index];
      const url = String(entry?.url || '').trim();
      if (!url) {
        continue;
      }

      const type = entry?.type === 'video' ? 'video' : 'image';
      const thumbnailUrl = String(entry?.thumbnailUrl || (type === 'image' ? url : '')).trim();

      gallery.push({
        id: `${String(review._id || '')}-${index}`,
        reviewId: String(review._id || ''),
        rating: Number(review?.rating || 0),
        createdAt: review?.createdAt || null,
        type,
        url,
        thumbnailUrl,
      });
    }
  }

  return gallery;
}

function toReviewView(reviewDoc, currentUserId = null) {
  const review = typeof reviewDoc?.toObject === 'function'
    ? reviewDoc.toObject()
    : (reviewDoc || {});
  const author = review?.user && typeof review.user === 'object' ? review.user : null;
  const currentUser = currentUserId ? String(currentUserId) : '';
  const helpfulBy = Array.isArray(review.helpfulBy)
    ? review.helpfulBy.map((entry) => String(entry))
    : [];
  const helpfulCount = Math.max(0, Number(review.helpfulCount || helpfulBy.length || 0));

  return {
    id: String(review._id || ''),
    rating: Number(review.rating || 0),
    title: String(review.title || ''),
    comment: String(review.comment || ''),
    media: Array.isArray(review.media)
      ? review.media.map((entry) => ({
          type: entry?.type === 'video' ? 'video' : 'image',
          url: String(entry?.url || ''),
          thumbnailUrl: String(entry?.thumbnailUrl || ''),
        }))
      : [],
    verifiedPurchase: Boolean(review.verifiedPurchase),
    helpfulCount,
    isHelpfulByMe: currentUser ? helpfulBy.includes(currentUser) : false,
    isMine: currentUser ? String(author?._id || review.user || '') === currentUser : false,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
    user: {
      id: String(author?._id || review.user || ''),
      name: String(author?.name || 'Buyer'),
      avatarUrl: String(author?.avatarUrl || ''),
    },
  };
}

async function buildReviewSummary(productId) {
  const emptySummary = {
    averageRating: 0,
    totalReviews: 0,
    mediaCount: 0,
    verifiedCount: 0,
    ratingBreakdown: {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    },
  };

  const normalizedProductId = String(productId || '');
  if (!mongoose.Types.ObjectId.isValid(normalizedProductId)) {
    return emptySummary;
  }

  const productObjectId = new mongoose.Types.ObjectId(normalizedProductId);
  const [summaryAgg, breakdownAgg] = await Promise.all([
    Review.aggregate([
      { $match: { product: productObjectId, isActive: true } },
      {
        $group: {
          _id: null,
          totalReviews: { $sum: 1 },
          averageRating: { $avg: '$rating' },
          mediaCount: { $sum: { $size: { $ifNull: ['$media', []] } } },
          verifiedCount: {
            $sum: {
              $cond: [{ $eq: ['$verifiedPurchase', true] }, 1, 0],
            },
          },
        },
      },
    ]),
    Review.aggregate([
      { $match: { product: productObjectId, isActive: true } },
      { $group: { _id: '$rating', count: { $sum: 1 } } },
    ]),
  ]);

  const base = summaryAgg[0];
  if (!base) {
    return emptySummary;
  }

  const ratingBreakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  breakdownAgg.forEach((row) => {
    const rating = Math.max(1, Math.min(5, Number(row?._id) || 0));
    if (rating >= 1 && rating <= 5) {
      ratingBreakdown[rating] = Number(row?.count || 0);
    }
  });

  return {
    averageRating: Number(Number(base.averageRating || 0).toFixed(1)),
    totalReviews: Number(base.totalReviews || 0),
    mediaCount: Number(base.mediaCount || 0),
    verifiedCount: Number(base.verifiedCount || 0),
    ratingBreakdown,
  };
}

async function syncProductReviewSnapshot(productId) {
  const summary = await buildReviewSummary(productId);
  await Product.findByIdAndUpdate(productId, {
    ratingAverage: summary.averageRating,
    reviewCount: summary.totalReviews,
  });
  return summary;
}

async function findVerifiedOrderForReview(userId, productId) {
  return Order.findOne({
    user: userId,
    paymentStatus: 'completed',
    status: { $ne: 'cancelled' },
    items: {
      $elemMatch: {
        product: productId,
        fulfillmentStatus: { $ne: 'cancelled' },
      },
    },
  })
    .sort({ createdAt: -1 })
    .select('_id');
}

const sampleProducts = [
  {
    title: 'Handwoven Jute Wall Basket',
    description: 'Natural jute basket handwoven by local artisans for wall decor and storage.',
    price: 34,
    category: 'Home Decor',
    material: 'Jute',
    stock: 12,
    sellerName: 'Mira Crafts',
    images: ['https://images.unsplash.com/photo-1616627781436-9f1f9fdf7dd1?w=800'],
  },
  {
    title: 'Terracotta Tea Cup Set',
    description: 'Set of 4 handmade terracotta cups, kiln-fired and food-safe.',
    price: 22,
    category: 'Kitchen',
    material: 'Clay',
    stock: 20,
    sellerName: 'ClayStory Studio',
    images: ['https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800'],
  },
  {
    title: 'Macrame Plant Hanger',
    description: 'Boho macrame hanger made with premium cotton rope for indoor plants.',
    price: 18,
    category: 'Home Decor',
    material: 'Cotton Rope',
    stock: 30,
    sellerName: 'Knot & Bloom',
    images: ['https://images.unsplash.com/photo-1485955900006-10f4d324d411?w=800'],
  },
  {
    title: 'Block-Printed Cotton Tote',
    description: 'Reusable tote with hand block-printed patterns and reinforced handles.',
    price: 16,
    category: 'Accessories',
    material: 'Cotton',
    stock: 25,
    sellerName: 'Rang Prints',
    images: ['https://images.unsplash.com/photo-1591561954557-26941169b49e?w=800'],
  },
  {
    title: 'Carved Wooden Serving Board',
    description: 'Hand-carved mango wood board for serving cheese, bread, and snacks.',
    price: 28,
    category: 'Kitchen',
    material: 'Mango Wood',
    stock: 15,
    sellerName: 'Woodline Atelier',
    images: ['https://images.unsplash.com/photo-1546549032-9571cd6b27df?w=800'],
  },
  {
    title: 'Hand-Embroidered Cushion Cover',
    description: 'Detailed hand embroidery on breathable cotton, 16x16 inch cover.',
    price: 20,
    category: 'Textiles',
    material: 'Cotton',
    stock: 18,
    sellerName: 'Thread Tales',
    images: ['https://images.unsplash.com/photo-1616486029423-aaa4789e8c9a?w=800'],
  },
];

async function seedProducts(req, res) {
  try {
    const existing = await Product.countDocuments();
    if (existing > 0 && req.query.force !== 'true') {
      return res.status(400).json({
        message: 'Products already exist. Pass force=true to reseed.',
      });
    }

    if (req.query.force === 'true') {
      await Product.deleteMany({});
    }

    const inserted = await Product.insertMany(sampleProducts);
    res.json({ message: 'Sample products seeded', count: inserted.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
}

// GET /api/products
router.get('/', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
    const skip = (page - 1) * limit;

    const query = { isActive: true };

    if (req.query.category) {
      query.category = req.query.category;
    }

    if (req.query.search) {
      query.$or = [
        { title: { $regex: req.query.search, $options: 'i' } },
        { description: { $regex: req.query.search, $options: 'i' } },
        { sellerName: { $regex: req.query.search, $options: 'i' } },
      ];
    }

    if (req.query.minPrice || req.query.maxPrice) {
      query.price = {};
      if (req.query.minPrice) query.price.$gte = Number(req.query.minPrice);
      if (req.query.maxPrice) query.price.$lte = Number(req.query.maxPrice);
    }

    const sortMap = {
      newest: { createdAt: -1 },
      price_asc: { price: 1 },
      price_desc: { price: -1 },
    };
    const sort = sortMap[req.query.sort] || sortMap.newest;

    const [items, total] = await Promise.all([
      Product.find(query).sort(sort).skip(skip).limit(limit),
      Product.countDocuments(query),
    ]);

    const productIds = items.map((item) => item._id).filter(Boolean);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const soldByProduct = new Map();
    const savesByProduct = new Map();

    if (productIds.length > 0) {
      const [soldAgg, savesAgg] = await Promise.all([
        Order.aggregate([
          { $match: { createdAt: { $gte: monthStart } } },
          { $unwind: '$items' },
          { $match: { 'items.product': { $in: productIds } } },
          { $group: { _id: '$items.product', monthlySold: { $sum: '$items.quantity' } } },
        ]),
        User.aggregate([
          { $unwind: '$likedProductTimestamps' },
          {
            $match: {
              'likedProductTimestamps.product': { $in: productIds },
              'likedProductTimestamps.likedAt': { $gte: monthStart },
            },
          },
          { $group: { _id: '$likedProductTimestamps.product', monthlySaves: { $sum: 1 } } },
        ]),
      ]);

      soldAgg.forEach((row) => {
        soldByProduct.set(String(row._id), Number(row.monthlySold) || 0);
      });

      savesAgg.forEach((row) => {
        savesByProduct.set(String(row._id), Number(row.monthlySaves) || 0);
      });
    }

    const itemsWithMetrics = items.map((item) => {
      const plain = item.toObject();
      const key = String(item._id);
      plain.monthlySold = soldByProduct.get(key) || 0;
      plain.monthlySaves = savesByProduct.get(key) || 0;
      return plain;
    });

    res.json({
      items: itemsWithMetrics,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/products/seed
router.post('/seed', seedProducts);

// GET /api/products/seed (browser convenience)
router.get('/seed', seedProducts);

// GET /api/products/:id/seller-insights
router.get('/:id/seller-insights', auth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product || !product.isActive) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const currentUser = await User.findById(req.user._id).select('name');
    if (!currentUser) {
      return res.status(401).json({ message: 'User not found' });
    }

    const isSellerOwnerById = product.seller && String(product.seller) === String(req.user._id);
    const isLegacyOwnerByName = String(currentUser.name || '').trim() === String(product.sellerName || '').trim();
    if (!isSellerOwnerById && !isLegacyOwnerByName) {
      return res.status(403).json({ message: 'Not allowed to view seller insights for this product' });
    }

    const productId = product._id;
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const sellerOwnershipMatch = [];
    if (product.seller) {
      sellerOwnershipMatch.push({ seller: product.seller });
    }
    if (product.sellerName) {
      sellerOwnershipMatch.push({ sellerName: product.sellerName });
    }

    const [
      lifetimeSalesAgg,
      monthlySalesAgg,
      monthlySavesAgg,
      lifetimeSavesAgg,
      sellerCategoryAgg,
    ] = await Promise.all([
      Order.aggregate([
        { $match: { status: { $ne: 'cancelled' } } },
        { $unwind: '$items' },
        { $match: { 'items.product': productId } },
        {
          $group: {
            _id: '$items.product',
            unitsSold: { $sum: '$items.quantity' },
            grossRevenue: { $sum: { $multiply: ['$items.quantity', '$items.price'] } },
            lastOrderAt: { $max: '$createdAt' },
          },
        },
      ]),
      Order.aggregate([
        { $match: { status: { $ne: 'cancelled' }, createdAt: { $gte: monthStart } } },
        { $unwind: '$items' },
        { $match: { 'items.product': productId } },
        { $group: { _id: '$items.product', monthlySold: { $sum: '$items.quantity' } } },
      ]),
      User.aggregate([
        { $unwind: '$likedProductTimestamps' },
        {
          $match: {
            'likedProductTimestamps.product': productId,
            'likedProductTimestamps.likedAt': { $gte: monthStart },
          },
        },
        { $group: { _id: '$likedProductTimestamps.product', monthlySaves: { $sum: 1 } } },
      ]),
      User.aggregate([
        { $unwind: '$likedProductTimestamps' },
        { $match: { 'likedProductTimestamps.product': productId } },
        { $group: { _id: '$likedProductTimestamps.product', lifetimeSaves: { $sum: 1 } } },
      ]),
      Product.aggregate([
        {
          $match: {
            isActive: true,
            ...(sellerOwnershipMatch.length > 0 ? { $or: sellerOwnershipMatch } : { _id: productId }),
          },
        },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    const lifetimeSales = lifetimeSalesAgg[0] || { unitsSold: 0, grossRevenue: 0, lastOrderAt: null };
    const monthlySold = monthlySalesAgg[0]?.monthlySold || 0;
    const monthlySaves = monthlySavesAgg[0]?.monthlySaves || 0;
    const lifetimeSaves = lifetimeSavesAgg[0]?.lifetimeSaves || 0;
    const stock = Math.max(0, Number(product.stock) || 0);
    const conversionRate = monthlySaves > 0 ? Number(((monthlySold / monthlySaves) * 100).toFixed(1)) : 0;

    const categoryLeaders = sellerCategoryAgg.slice(0, 3).map((entry) => ({
      category: entry._id || 'Others',
      count: entry.count,
    }));

    const suggestions = [];
    if (stock <= 3) {
      suggestions.push('Stock is low. Restock soon to avoid missing orders.');
    }
    if (monthlySaves >= 5 && monthlySold === 0) {
      suggestions.push('Strong interest but low conversion. Consider improving first image, title, or pricing.');
    }
    if (monthlySaves === 0 && monthlySold === 0) {
      suggestions.push('No traction this month yet. Share this listing and refresh media to boost visibility.');
    }
    if (suggestions.length === 0) {
      suggestions.push('Listing performance looks healthy. Keep stock ready and maintain fast dispatch.');
    }

    res.json({
      item: product,
      insights: {
        unitsSold: lifetimeSales.unitsSold || 0,
        grossRevenue: Number(lifetimeSales.grossRevenue) || 0,
        monthlySold,
        monthlySaves,
        lifetimeSaves,
        conversionRate,
        stock,
        stockStatus: stock <= 0 ? 'out_of_stock' : stock <= 3 ? 'low' : 'healthy',
        lastOrderAt: lifetimeSales.lastOrderAt || null,
        categoryLeaders,
      },
      suggestions,
    });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ message: 'Product not found' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/products/media/upload
router.post('/media/upload', auth, async (req, res) => {
  try {
    const incoming = Array.isArray(req.body?.media) ? req.body.media : [];
    const prepared = [];

    for (const entry of incoming) {
      const type = entry?.type === 'video' ? 'video' : 'image';
      const rawUrl = typeof entry?.url === 'string' ? entry.url.trim() : '';
      const rawThumbnail = typeof entry?.thumbnailUrl === 'string' ? entry.thumbnailUrl.trim() : '';
      const ratio = Number(entry?.aspectRatio || 1);
      const safeRatio = Number.isNaN(ratio) ? 1 : Math.max(0.5, Math.min(2, ratio));

      if (!rawUrl) {
        continue;
      }

      if (type === 'image') {
        const persisted = await persistImageDataUri(req, rawUrl);
        if (persisted) {
          prepared.push({
            type: 'image',
            url: persisted.url,
            thumbnailUrl: persisted.thumbnailUrl,
            aspectRatio: safeRatio,
          });
          continue;
        }
      }

      prepared.push({
        type,
        url: rawUrl,
        thumbnailUrl: rawThumbnail || (type === 'image' ? rawUrl : ''),
        aspectRatio: safeRatio,
      });
    }

    return res.json({
      media: prepared,
      images: prepared.filter((entry) => entry.type === 'image').map((entry) => entry.url),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to process uploaded media' });
  }
});

// POST /api/products/media/upload-file
// Accepts a single multipart file upload (field name: 'file') and returns a public URL.
router.post('/media/upload-file', auth, mediaUpload.single('file'), async (req, res) => {
  try {
    console.log('[UPLOAD FILE] incoming upload-file request', {
      headers: Object.keys(req.headers || {}).reduce((acc, k) => ({ ...acc, [k]: req.headers[k] }), {}),
      user: req.user ? String(req.user._id) : null,
    });
    console.log('[UPLOAD FILE] body keys:', Object.keys(req.body || {}));
    console.log('[UPLOAD FILE] multer req.file present?', !!req.file);
    // If multer parsed a multipart upload, return the stored file URL.
    if (req.file) {
      const fileName = path.basename(req.file.path || req.file.filename || req.file.originalname);
      const publicUrl = `${getPublicBaseUrl(req)}/uploads/products/${fileName}`;
      return res.json({ url: publicUrl });
    }

    // Fallback: accept JSON uploads containing a Base64-encoded file.
    // Clients that cannot send multipart/form-data may POST JSON with
    // { filename, mimeType, base64 } or { fileBase64 }.
    const b64 = (req.body && (req.body.base64 || req.body.fileBase64 || req.body.file)) || null;
    if (b64 && typeof b64 === 'string') {
      try {
        console.log('[UPLOAD FILE] using JSON base64 fallback', { bodyKeys: Object.keys(req.body || {}), length: b64.length });
        const providedName = String(req.body.filename || req.body.name || `upload-${Date.now()}`);
        const ext = path.extname(providedName) || '';
        const destName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
        const destPath = path.join(PRODUCT_UPLOAD_DIR, destName);
        await fs.promises.mkdir(PRODUCT_UPLOAD_DIR, { recursive: true });
        await fs.promises.writeFile(destPath, Buffer.from(b64, 'base64'));
        const publicUrl = `${getPublicBaseUrl(req)}/uploads/products/${destName}`;
        return res.json({ url: publicUrl });
      } catch (writeErr) {
        console.error('[UPLOAD FILE] failed to write base64 upload', writeErr);
        return res.status(500).json({ message: 'Failed to accept uploaded file' });
      }
    }

    return res.status(400).json({ message: 'No file uploaded' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to accept uploaded file' });
  }
});

// GET /api/products/:id/reviews
router.get('/:id/reviews', async (req, res) => {
  try {
    const productId = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const productExists = await Product.exists({ _id: productId, isActive: true });
    if (!productExists) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 8));
    const skip = (page - 1) * limit;
    const sortBy = String(req.query.sort || 'top').trim().toLowerCase();
    const ratingFilterRaw = req.query.rating;

    const query = { product: productId, isActive: true };
    const sortMap = {
      top: { helpfulCount: -1, createdAt: -1 },
      latest: { createdAt: -1 },
      rating_high: { rating: -1, createdAt: -1 },
      rating_low: { rating: 1, createdAt: -1 },
      media: { createdAt: -1 },
    };

    if (sortBy === 'media') {
      query['media.0'] = { $exists: true };
    }

    if (ratingFilterRaw !== undefined) {
      const ratingFilter = Number(ratingFilterRaw);
      if (!Number.isInteger(ratingFilter) || ratingFilter < 1 || ratingFilter > 5) {
        return res.status(400).json({ message: 'rating must be an integer between 1 and 5' });
      }
      query.rating = ratingFilter;
    }

    const sort = sortMap[sortBy] || sortMap.top;

    const [reviews, total, summary, mediaGallery] = await Promise.all([
      Review.find(query)
        .populate('user', 'name avatarUrl')
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      Review.countDocuments(query),
      buildReviewSummary(productId),
      buildReviewMediaGallery(productId),
    ]);

    return res.json({
      reviews: reviews.map((entry) => toReviewView(entry)),
      summary,
      mediaGallery,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/products/:id/reviews/eligibility
router.get('/:id/reviews/eligibility', auth, async (req, res) => {
  try {
    const productId = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const product = await Product.findOne({ _id: productId, isActive: true }).select('_id');
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const [order, existingReview] = await Promise.all([
      findVerifiedOrderForReview(req.user._id, product._id),
      Review.findOne({ product: product._id, user: req.user._id, isActive: true }).select('_id'),
    ]);

    const canReview = Boolean(order);
    const hasReviewed = Boolean(existingReview);

    let message = 'You can review this product.';
    if (!canReview) {
      message = 'Only buyers who purchased this product can post reviews.';
    } else if (hasReviewed) {
      message = 'You can edit your existing review.';
    }

    return res.json({
      canReview,
      hasReviewed,
      reviewId: existingReview ? String(existingReview._id) : null,
      message,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/products/:id/reviews
router.post('/:id/reviews', auth, async (req, res) => {
  try {
    const productId = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const product = await Product.findOne({ _id: productId, isActive: true }).select('_id');
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const rating = Number(req.body?.rating);
    const title = String(req.body?.title || '').trim().slice(0, 90);
    const comment = String(req.body?.comment || '').trim().slice(0, 1200);
    const media = sanitizeReviewMediaEntries(req.body?.media);

    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Rating must be between 1 and 5.' });
    }

    if (!title && !comment && media.length === 0) {
      return res.status(400).json({ message: 'Add review text or media before submitting.' });
    }

    const verifiedOrder = await findVerifiedOrderForReview(req.user._id, product._id);
    if (!verifiedOrder) {
      return res.status(403).json({ message: 'Only buyers who purchased this product can post reviews.' });
    }

    let review = await Review.findOne({ product: product._id, user: req.user._id });
    const isUpdate = Boolean(review);

    if (!review) {
      review = new Review({
        product: product._id,
        user: req.user._id,
        helpfulBy: [],
      });
    }

    review.order = verifiedOrder._id;
    review.rating = Math.max(1, Math.min(5, Math.round(rating)));
    review.title = title;
    review.comment = comment;
    review.media = media;
    review.verifiedPurchase = true;
    review.isActive = true;
    await review.save();

    const populatedReview = await Review.findById(review._id)
      .populate('user', 'name avatarUrl')
      .lean();
    const summary = await syncProductReviewSnapshot(product._id);

    return res.status(isUpdate ? 200 : 201).json({
      message: isUpdate ? 'Review updated successfully' : 'Review posted successfully',
      review: toReviewView(populatedReview, req.user._id),
      summary,
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ message: 'You already reviewed this product. Please update your existing review.' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/products/:id/reviews/:reviewId/helpful
router.post('/:id/reviews/:reviewId/helpful', auth, async (req, res) => {
  try {
    const productId = String(req.params.id || '').trim();
    const reviewId = String(req.params.reviewId || '').trim();

    if (!mongoose.Types.ObjectId.isValid(productId) || !mongoose.Types.ObjectId.isValid(reviewId)) {
      return res.status(404).json({ message: 'Review not found' });
    }

    const review = await Review.findOne({ _id: reviewId, product: productId, isActive: true });
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    if (String(review.user || '') === String(req.user._id)) {
      return res.status(400).json({ message: 'You cannot mark your own review as helpful.' });
    }

    review.helpfulBy = Array.isArray(review.helpfulBy) ? review.helpfulBy : [];
    const hasMarkedHelpful = review.helpfulBy.some((entry) => String(entry) === String(req.user._id));

    if (hasMarkedHelpful) {
      review.helpfulBy = review.helpfulBy.filter((entry) => String(entry) !== String(req.user._id));
    } else {
      review.helpfulBy.push(req.user._id);
    }

    review.helpfulCount = review.helpfulBy.length;
    await review.save();

    return res.json({
      message: hasMarkedHelpful ? 'Helpful vote removed' : 'Marked as helpful',
      helpfulCount: review.helpfulCount,
      isHelpfulByMe: !hasMarkedHelpful,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/products/:id
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findOne({ _id: req.params.id, isActive: true });
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json(product);
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ message: 'Product not found' });
    }
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

async function deleteProductHandler(req, res) {
  try {
    const product = await Product.findById(req.params.id);
    if (!product || !product.isActive) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const isSellerOwnerById = product.seller && String(product.seller) === String(req.user._id);
    let isLegacyOwnerByName = false;

    if (!isSellerOwnerById && product.sellerName) {
      const currentUser = await User.findById(req.user._id).select('name');
      if (currentUser && String(currentUser.name || '').trim() === String(product.sellerName || '').trim()) {
        isLegacyOwnerByName = true;
      }
    }

    if (!isSellerOwnerById && !isLegacyOwnerByName) {
      return res.status(403).json({ message: 'Not allowed to delete this product' });
    }

    product.isActive = false;
    await product.save();

    await User.updateMany(
      {},
      {
        $pull: {
          likedProducts: product._id,
          likedProductTimestamps: { product: product._id },
          cartItems: { product: product._id },
        },
      }
    );

    return res.json({ message: 'Post deleted successfully' });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ message: 'Product not found' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
}

// DELETE /api/products/:id
router.delete('/:id', auth, deleteProductHandler);

// POST /api/products/:id/delete (compatibility fallback for clients/environments where DELETE may fail)
router.post('/:id/delete', auth, deleteProductHandler);

// POST /api/products
router.post('/', auth, async (req, res) => {
  try {
    const {
      title,
      description = '',
      price,
      realPrice,
      discountedPrice,
      category,
      customCategory = '',
      material = '',
      stock = 0,
      packageWeightGrams = 0,
      packageLengthCm = 0,
      packageBreadthCm = 0,
      packageHeightCm = 0,
      images = [],
      media = [],
      imageAspectRatio = 1,
      customizable: rawCustomizable,
      isCustomizable,
      customizationEnabled,
      pickupAddressId,
      pickupAddress,
    } = req.body;

    const customizable = rawCustomizable ?? isCustomizable ?? customizationEnabled ?? false;

    if (!title || !category || (price === undefined || price === null) && (realPrice === undefined || realPrice === null)) {
      return res.status(400).json({ message: 'Title, category and price are required' });
    }

    const resolvedRealPrice = realPrice !== undefined && realPrice !== null ? realPrice : price;
    const parsedPrice = Number(resolvedRealPrice);
    const parsedDiscountedPrice = discountedPrice === undefined || discountedPrice === null || String(discountedPrice).trim() === ''
      ? null
      : Number(discountedPrice);
    const parsedStock = Number(stock || 0);
    const parsedPackageWeightGrams = Number(packageWeightGrams || 0);
    const parsedPackageLengthCm = Number(packageLengthCm || 0);
    const parsedPackageBreadthCm = Number(packageBreadthCm || 0);
    const parsedPackageHeightCm = Number(packageHeightCm || 0);
    const parsedAspectRatio = Number(imageAspectRatio || 1);
    const normalizedCategoryInput = String(category || '').trim().toLowerCase();
    const normalizedCategory = ALLOWED_PRODUCT_CATEGORY_MAP.get(normalizedCategoryInput);
    const normalizedCustomCategory = String(customCategory || '').trim();
    if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
      return res.status(400).json({ message: 'Price must be a valid non-negative number' });
    }
    if (parsedDiscountedPrice !== null) {
      if (Number.isNaN(parsedDiscountedPrice) || parsedDiscountedPrice < 0) {
        return res.status(400).json({ message: 'Discounted price must be a valid non-negative number' });
      }
      if (parsedDiscountedPrice > parsedPrice) {
        return res.status(400).json({ message: 'Discounted price cannot be greater than real price' });
      }
    }
    if (Number.isNaN(parsedStock) || parsedStock < 0) {
      return res.status(400).json({ message: 'Stock must be a valid non-negative number' });
    }
    if (Number.isNaN(parsedPackageWeightGrams) || parsedPackageWeightGrams < 0) {
      return res.status(400).json({ message: 'Package weight must be a valid non-negative number' });
    }
    if (Number.isNaN(parsedPackageLengthCm) || parsedPackageLengthCm < 0
      || Number.isNaN(parsedPackageBreadthCm) || parsedPackageBreadthCm < 0
      || Number.isNaN(parsedPackageHeightCm) || parsedPackageHeightCm < 0) {
      return res.status(400).json({ message: 'Package dimensions must be valid non-negative numbers' });
    }
    if (Number.isNaN(parsedAspectRatio) || parsedAspectRatio < 0.5 || parsedAspectRatio > 2) {
      return res.status(400).json({ message: 'Image aspect ratio must be between 0.5 and 2' });
    }
    if (!normalizedCategory) {
      return res.status(400).json({
        message: `Category must be one of: ${ALLOWED_PRODUCT_CATEGORIES.join(', ')}`,
      });
    }
    if (normalizedCategory === 'Others' && !normalizedCustomCategory) {
      return res.status(400).json({
        message: 'Please specify custom category when selecting Others',
      });
    }

    const seller = await User.findById(req.user._id).select('name sellerDisplayName addresses sellerPickupAddress');
    if (!seller) {
      return res.status(401).json({ message: 'User not found' });
    }

    const normalizedPickupAddressId = typeof pickupAddressId === 'string'
      ? pickupAddressId.trim()
      : '';
    let selectedPickupAddress = null;

    if (normalizedPickupAddressId) {
      if (!mongoose.Types.ObjectId.isValid(normalizedPickupAddressId)) {
        return res.status(400).json({ message: 'Invalid pickupAddressId value' });
      }

      const resolvedAddress = (seller.addresses || []).find(
        (entry) => String(entry?._id || '') === normalizedPickupAddressId
      );

      if (!resolvedAddress) {
        return res.status(400).json({ message: 'Selected pickup address was not found in your saved addresses.' });
      }

      if (!String(resolvedAddress?.state || '').trim()) {
        return res.status(400).json({ message: 'Selected pickup address is missing state. Please edit the address and add state.' });
      }

      selectedPickupAddress = mapAddressToSellerPickup(resolvedAddress, {
        addressId: normalizedPickupAddressId,
      });
    }

    if (!selectedPickupAddress && pickupAddress) {
      selectedPickupAddress = sanitizeSellerPickupAddress(pickupAddress);
      if (!selectedPickupAddress) {
        return res.status(400).json({ message: 'Invalid pickupAddress payload. Missing required fields.' });
      }
    }

    if (selectedPickupAddress) {
      seller.sellerPickupAddress = {
        ...selectedPickupAddress,
        updatedAt: new Date(),
      };
      await seller.save();
    }

    const sanitizedImages = Array.isArray(images)
      ? images.filter(img => typeof img === 'string' && img.trim().length > 0)
      : [];

    const sanitizedMedia = Array.isArray(media)
      ? media
          .map((item) => {
            const type = item?.type === 'video' ? 'video' : 'image';
            const url = typeof item?.url === 'string' ? item.url.trim() : '';
            const thumbnailUrl = typeof item?.thumbnailUrl === 'string' ? item.thumbnailUrl.trim() : '';
            const ratio = Number(item?.aspectRatio || parsedAspectRatio || 1);
            if (!url) return null;
            return {
              type,
              url,
              thumbnailUrl,
              aspectRatio: Number.isNaN(ratio) ? parsedAspectRatio : Math.max(0.5, Math.min(2, ratio)),
            };
          })
          .filter(Boolean)
      : [];

    const finalMedia = sanitizedMedia.length > 0
      ? sanitizedMedia
      : sanitizedImages.map((url) => ({ type: 'image', url, thumbnailUrl: url, aspectRatio: parsedAspectRatio }));

    const finalImages = finalMedia
      .filter((item) => item.type === 'image')
      .map((item) => item.url);

    const hasDiscount = parsedDiscountedPrice !== null && parsedDiscountedPrice < parsedPrice;
    const computedDiscountPercentage = hasDiscount
      ? Number((((parsedPrice - parsedDiscountedPrice) / parsedPrice) * 100).toFixed(1))
      : 0;

    const product = new Product({
      title: String(title).trim(),
      description: String(description || '').trim(),
      price: parsedPrice,
      realPrice: parsedPrice,
      discountedPrice: hasDiscount ? parsedDiscountedPrice : null,
      discountPercentage: hasDiscount ? computedDiscountPercentage : 0,
      category: normalizedCategory,
      customCategory: normalizedCategory === 'Others' ? normalizedCustomCategory : '',
      material: String(material || '').trim(),
      stock: parsedStock,
      packageWeightGrams: parsedPackageWeightGrams,
      packageLengthCm: parsedPackageLengthCm,
      packageBreadthCm: parsedPackageBreadthCm,
      packageHeightCm: parsedPackageHeightCm,
      imageAspectRatio: parsedAspectRatio,
      media: finalMedia,
      customizable: Boolean(customizable),
      images: finalImages,
      seller: seller._id,
      sellerName: String(seller.sellerDisplayName || seller.name || 'Handmade Artisan'),
      isActive: true,
    });

    await product.save();
    res.status(201).json({ message: 'Item posted successfully', item: product });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

async function updateStockHandler(req, res) {
  try {
    const addBy = Number(req.body?.addBy ?? 1);

    if (!Number.isInteger(addBy) || addBy <= 0) {
      return res.status(400).json({ message: 'addBy must be a positive integer' });
    }

    const product = await Product.findById(req.params.id);
    if (!product || !product.isActive) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Allow seller ownership by id. Fallback to sellerName for legacy listings.
    const isSellerOwnerById = product.seller && String(product.seller) === String(req.user._id);
    let isLegacyOwnerByName = false;

    if (!isSellerOwnerById && product.sellerName) {
      const currentUser = await User.findById(req.user._id).select('name');
      if (currentUser && String(currentUser.name || '').trim() === String(product.sellerName || '').trim()) {
        isLegacyOwnerByName = true;
      }
    }

    if (!isSellerOwnerById && !isLegacyOwnerByName) {
      return res.status(403).json({ message: 'Not allowed to update this product stock' });
    }

    product.stock = Math.max(0, Number(product.stock || 0)) + addBy;
    await product.save();

    return res.json({
      message: 'Stock updated successfully',
      item: product,
    });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ message: 'Product not found' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
}

// PATCH /api/products/:id/stock
router.patch('/:id/stock', auth, updateStockHandler);

// POST /api/products/:id/stock (compatibility fallback for clients/environments where PATCH may fail)
router.post('/:id/stock', auth, updateStockHandler);

module.exports = router;