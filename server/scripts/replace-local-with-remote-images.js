const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Product = require('../models/Product');

async function run() {
  const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/handkraft';
  console.log('Connecting to MongoDB', mongoUri);
  await mongoose.connect(mongoUri);

  const products = await Product.find({ 'media.0.url': /uploads\/products\// }).limit(50);
  console.log('Found', products.length, 'products with local uploads');

  let updated = 0;
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const aspect = Number(p.imageAspectRatio) || 1;
    const w = Math.round(1000 * Math.min(1.5, aspect));
    const h = Math.round(w / aspect);
    const seed = encodeURIComponent((p.title || `product-${i}`).replace(/\s+/g, '-'));
    const remote = `https://picsum.photos/seed/${seed}/${w}/${h}`;
    const thumb = `https://picsum.photos/seed/${seed}/540/540`;

    p.images = [remote];
    p.media = [{ type: 'image', url: remote, thumbnailUrl: thumb, aspectRatio: aspect }];
    await p.save();
    updated++;
  }

  console.log('Updated', updated, 'products to remote picsum URLs');
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
