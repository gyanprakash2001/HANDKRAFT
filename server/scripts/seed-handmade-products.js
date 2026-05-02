const mongoose = require('mongoose');
const path = require('path');
const { env } = require('../config/env');
const Product = require('../models/Product');

async function run() {
  await mongoose.connect(env.mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('[SEED] Connected to MongoDB:', env.mongoUri);

  const items = [
    {
      title: 'Hand-thrown Ceramic Mug',
      description: 'A glazed hand-thrown ceramic mug, perfect for tea or coffee. Microwave and dishwasher safe.',
      category: 'ceramics',
      material: 'Clay',
      price: 1200,
      realPrice: 1500,
      discountedPrice: 1200,
      stock: 12,
      packageWeightGrams: 600,
      packageLengthCm: 12,
      packageBreadthCm: 10,
      packageHeightCm: 10,
      customizable: false,
      imageAspectRatio: 0.9,
      images: [],
      media: [],
    },
    {
      title: 'Handwoven Wool Scarf',
      description: 'Soft, handwoven wool scarf with subtle color gradients. One size, unisex.',
      category: 'textiles',
      material: 'Wool',
      price: 2200,
      realPrice: 2800,
      discountedPrice: 2200,
      stock: 8,
      packageWeightGrams: 300,
      packageLengthCm: 30,
      packageBreadthCm: 20,
      packageHeightCm: 4,
      customizable: true,
      imageAspectRatio: 1.2,
      images: [],
      media: [],
    },
    {
      title: 'Beaded Necklace - Brass & Gemstone',
      description: 'Hand-strung bead necklace with natural gemstone accents and brass clasp.',
      category: 'jewelry',
      material: 'Gemstone, Brass',
      price: 1800,
      realPrice: 1800,
      discountedPrice: null,
      stock: 20,
      packageWeightGrams: 100,
      packageLengthCm: 10,
      packageBreadthCm: 8,
      packageHeightCm: 3,
      customizable: true,
      imageAspectRatio: 1,
      images: [],
      media: [],
    },
    {
      title: 'Hand-carved Wooden Cutting Board',
      description: 'Sustainably sourced wood, hand-carved edges. Great for serving and prep.',
      category: 'woodwork',
      material: 'Acacia wood',
      price: 3500,
      realPrice: 4000,
      discountedPrice: 3500,
      stock: 6,
      packageWeightGrams: 1500,
      packageLengthCm: 40,
      packageBreadthCm: 25,
      packageHeightCm: 4,
      customizable: false,
      imageAspectRatio: 1.3,
      images: [],
      media: [],
    },
    {
      title: 'Macrame Wall Hanging',
      description: 'Neutral-tone macrame wall hanging to add texture to any room.',
      category: 'home-decor',
      material: 'Cotton cord',
      price: 2800,
      realPrice: 2800,
      discountedPrice: null,
      stock: 5,
      packageWeightGrams: 400,
      packageLengthCm: 60,
      packageBreadthCm: 8,
      packageHeightCm: 8,
      customizable: true,
      imageAspectRatio: 0.6,
      images: [],
      media: [],
    },
    {
      title: 'Hand-poured Soy Candle',
      description: 'Long-burning soy wax candle with natural essential oil blend.',
      category: 'candles',
      material: 'Soy Wax',
      price: 600,
      realPrice: 750,
      discountedPrice: 600,
      stock: 30,
      packageWeightGrams: 400,
      packageLengthCm: 8,
      packageBreadthCm: 8,
      packageHeightCm: 10,
      customizable: false,
      imageAspectRatio: 1,
      images: [],
      media: [],
    },
    {
      title: 'Embroidered Pouch',
      description: 'Small embroidered pouch perfect for coins, jewelry or small keepsakes.',
      category: 'accessories',
      material: 'Cotton, Embroidery thread',
      price: 450,
      realPrice: 450,
      discountedPrice: null,
      stock: 40,
      packageWeightGrams: 80,
      packageLengthCm: 12,
      packageBreadthCm: 8,
      packageHeightCm: 2,
      customizable: true,
      imageAspectRatio: 1.1,
      images: [],
      media: [],
    },
    {
      title: 'Leather Keychain - Handstitched',
      description: 'Vegetable-tanned leather keychain hand-stitched for durability.',
      category: 'accessories',
      material: 'Leather',
      price: 350,
      realPrice: 350,
      discountedPrice: null,
      stock: 60,
      packageWeightGrams: 60,
      packageLengthCm: 6,
      packageBreadthCm: 4,
      packageHeightCm: 1,
      customizable: false,
      imageAspectRatio: 0.8,
      images: [],
      media: [],
    },
    {
      title: 'Stoneware Vase',
      description: 'Elegant stoneware vase with matte finish, suitable for fresh or dried flowers.',
      category: 'ceramics',
      material: 'Stoneware',
      price: 3200,
      realPrice: 3600,
      discountedPrice: 3200,
      stock: 7,
      packageWeightGrams: 1200,
      packageLengthCm: 18,
      packageBreadthCm: 18,
      packageHeightCm: 30,
      customizable: false,
      imageAspectRatio: 0.5,
      images: [],
      media: [],
    },
    {
      title: 'Knitted Baby Booties',
      description: 'Soft hand-knitted baby booties made from organic yarn.',
      category: 'baby',
      material: 'Organic yarn',
      price: 750,
      realPrice: 900,
      discountedPrice: 750,
      stock: 25,
      packageWeightGrams: 120,
      packageLengthCm: 10,
      packageBreadthCm: 8,
      packageHeightCm: 6,
      customizable: true,
      imageAspectRatio: 1,
      images: [],
      media: [],
    },
  ];

  // Use picsum.photos seeded images with varying sizes to simulate aspect ratios
  const seeds = ['ceramic', 'scarf', 'necklace', 'wood', 'macrame', 'candle', 'pouch', 'leather', 'vase', 'booties'];
  const sizes = [800, 1000, 600, 1200, 700, 800, 900, 600, 1200, 800];
  const heights = [1000, 800, 800, 900, 1200, 800, 800, 700, 1600, 800];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const w = sizes[i] || 800;
    const h = heights[i] || 800;
    const seed = seeds[i] || `handmade${i}`;
    const imageUrl = `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`;
    const thumbUrl = `https://picsum.photos/seed/${encodeURIComponent(seed)}=${i}/300/300`;

    item.images = [imageUrl];
    item.media = [
      {
        type: 'image',
        url: imageUrl,
        thumbnailUrl: thumbUrl,
        aspectRatio: Math.max(0.5, Math.min(2, Number((w / h).toFixed(2)))),
      },
    ];

    // compute discount percent if discountedPrice provided
    if (item.discountedPrice && item.realPrice && item.realPrice > 0) {
      item.discountPercentage = Math.round(((item.realPrice - item.discountedPrice) / item.realPrice) * 100);
    }
  }

  try {
    const created = [];
    for (const p of items) {
      const exists = await Product.findOne({ title: p.title }).lean();
      if (exists) {
        console.log('[SEED] Skipping existing product:', p.title);
        continue;
      }
      const prod = await Product.create(p);
      console.log('[SEED] Created product:', prod.title, prod._id.toString());
      created.push(prod);
    }

    console.log('[SEED] Completed. Created', created.length, 'products.');
  } catch (err) {
    console.error('[SEED] Error creating products:', err);
  } finally {
    await mongoose.disconnect();
    console.log('[SEED] Disconnected from MongoDB');
  }
}

if (require.main === module) {
  run().catch((err) => {
    console.error('[SEED] Unhandled error', err);
    process.exit(1);
  });
}
