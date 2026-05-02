const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Product = require('../models/Product');
const User = require('../models/User');

async function main() {
  const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/handkraft';
  console.log('Connecting to MongoDB:', mongoUri);
  await mongoose.connect(mongoUri);

  // 1) Clear images/media on existing products
  console.log('Clearing images and media for existing products...');
  await Product.updateMany({}, { $set: { images: [], media: [] } });

  // 2) Find a seller to assign (fallback to null)
  const seller = await User.findOne() || null;
  const sellerId = seller ? seller._id : null;

  // 3) Seed 10 sample products with public image URLs
  const samples = [
    { q: 'handmade,jewelry', w: 800, h: 1200, cat: 'Jewelry' },
    { q: 'handmade,home decor', w: 1000, h: 800, cat: 'Home Decor' },
    { q: 'handmade,accessories', w: 800, h: 800, cat: 'Accessories' },
    { q: 'handmade,wood', w: 900, h: 1200, cat: 'Home Decor' },
    { q: 'handmade,textiles', w: 1200, h: 900, cat: 'Textiles' },
    { q: 'handmade,ceramic', w: 1000, h: 1400, cat: 'Home Decor' },
    { q: 'handmade,bags', w: 1000, h: 1000, cat: 'Bags' },
    { q: 'handmade,art', w: 1200, h: 800, cat: 'Art' },
    { q: 'handmade,wooden', w: 900, h: 900, cat: 'Kitchen' },
    { q: 'handmade,cushion', w: 1100, h: 900, cat: 'Home Decor' },
  ];

  const created = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    // Use Unsplash source to get relevant images (no API key required for Source)
    const url = `https://source.unsplash.com/featured/${s.w}x${s.h}/?${encodeURIComponent(s.q)}`;
    const aspect = Number((s.w / s.h).toFixed(2));

    const p = new Product({
      title: `${s.q.split(',')[1] ? s.q.split(',')[1] : 'Handmade'} ${i + 1}`,
      description: `Beautiful ${s.q.split(',')[1] || 'handmade item'} crafted by local artisans.`,
      price: Math.floor(100 + Math.random() * 900),
      realPrice: null,
      discountedPrice: null,
      discountPercentage: 0,
      images: [url],
      category: s.cat,
      stock: 10 + Math.floor(Math.random() * 50),
      imageAspectRatio: aspect,
      media: [
        {
          type: 'image',
          url,
          thumbnailUrl: url,
          aspectRatio: aspect,
        },
      ],
      customizable: false,
      seller: sellerId,
      sellerName: seller ? seller.name : 'Handmade Artisan',
      isActive: true,
    });

    await p.save();
    created.push(p);
    console.log(`Created sample product ${p.title}`);
  }

  console.log(`Done. Created ${created.length} sample products.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Error seeding feed images:', err);
  process.exit(1);
});
