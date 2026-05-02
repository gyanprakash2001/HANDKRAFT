const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Product = require('../models/Product');
const User = require('../models/User');

const samples = [
  { q: 'handmade jewelry', w: 800, h: 1200, cat: 'Jewelry' },
  { q: 'handmade home decor', w: 1000, h: 800, cat: 'Home Decor' },
  { q: 'handmade accessories', w: 800, h: 800, cat: 'Accessories' },
  { q: 'handmade wooden', w: 900, h: 1200, cat: 'Home Decor' },
  { q: 'handmade textiles', w: 1200, h: 900, cat: 'Textiles' },
  { q: 'handmade ceramic', w: 1000, h: 1400, cat: 'Home Decor' },
  { q: 'handmade bags', w: 1000, h: 1000, cat: 'Bags' },
  { q: 'handmade art', w: 1200, h: 800, cat: 'Art' },
  { q: 'handmade kitchen', w: 900, h: 900, cat: 'Kitchen' },
  { q: 'handmade cushion', w: 1100, h: 900, cat: 'Home Decor' },
];

async function run() {
  const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/handkraft';
  console.log('Connecting to MongoDB', mongoUri);
  await mongoose.connect(mongoUri);

  const seller = await User.findOne() || null;
  const sellerId = seller ? seller._id : null;

  const created = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const aspect = Number((s.w / s.h).toFixed(2));
    const mediaUrl = `https://picsum.photos/seed/${encodeURIComponent(s.q + '-' + i)}/${s.w}/${s.h}`;
    const thumbUrl = `https://picsum.photos/seed/${encodeURIComponent(s.q + '-thumb-' + i)}/540/${Math.max(1, Math.round(540 / Math.max(0.5, aspect)))}`;

    const product = new Product({
      title: `${s.q.split(' ')[1] ? s.q.split(' ')[1] : 'Handmade'} ${i + 1}`,
      description: `Handmade ${s.q.split(' ')[1] || 'item'} — artist-made and unique.`,
      price: Math.floor(200 + Math.random() * 2000),
      images: [mediaUrl],
      category: s.cat,
      stock: 5 + Math.floor(Math.random() * 20),
      imageAspectRatio: aspect,
      media: [ { type: 'image', url: mediaUrl, thumbnailUrl: thumbUrl, aspectRatio: aspect } ],
      customizable: false,
      seller: sellerId,
      sellerName: seller ? seller.name : 'Handmade Artisan',
      isActive: true,
    });

    await product.save();
    console.log('Saved product with remote image:', product.title);
    created.push(product);
  }

  console.log('Created', created.length, 'products with remote image URLs.');
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
