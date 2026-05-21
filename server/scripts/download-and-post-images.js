const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Product = require('../models/Product');
const User = require('../models/User');

// Stable, direct image URLs from Unsplash (no redirects, reliable on mobile)
const samples = [
  { title: 'Handmade Jewelry Earrings', desc: 'Handcrafted earrings with natural stones — artist-made and unique.', w: 800, h: 1200, cat: 'Jewelry', url: 'https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?w=800&h=1200&fit=crop' },
  { title: 'Woven Home Decor Basket', desc: 'Beautiful handwoven basket for home decoration.', w: 1000, h: 800, cat: 'Home Decor', url: 'https://images.unsplash.com/photo-1616627781436-9f1f9fdf7dd1?w=1000&h=800&fit=crop' },
  { title: 'Leather Accessories Bag', desc: 'Hand-stitched leather accessories pouch — artisan crafted.', w: 800, h: 800, cat: 'Accessories', url: 'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=800&h=800&fit=crop' },
  { title: 'Carved Wooden Box', desc: 'Hand-carved wooden decorative box with intricate patterns.', w: 900, h: 1200, cat: 'Home Decor', url: 'https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=900&h=1200&fit=crop' },
  { title: 'Hand-Dyed Textiles Scarf', desc: 'Beautiful hand-dyed textiles scarf crafted by local artisans.', w: 1200, h: 900, cat: 'Textiles', url: 'https://images.unsplash.com/photo-1606722590583-6951b5ea92ad?w=1200&h=900&fit=crop' },
  { title: 'Handmade Ceramic Vase', desc: 'Artisan ceramic vase with hand-painted glazing.', w: 1000, h: 1400, cat: 'Home Decor', url: 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=1000&h=1400&fit=crop' },
  { title: 'Woven Cotton Tote Bag', desc: 'Hand-woven cotton tote with natural dye patterns.', w: 1000, h: 1000, cat: 'Accessories', url: 'https://images.unsplash.com/photo-1591561954557-26941169b49e?w=1000&h=1000&fit=crop' },
  { title: 'Handmade Wall Art Print', desc: 'Original handmade wall art print on handmade paper.', w: 1200, h: 800, cat: 'Art', url: 'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?w=1200&h=800&fit=crop' },
  { title: 'Wooden Kitchen Board', desc: 'Hand-carved wooden kitchen cutting and serving board.', w: 900, h: 900, cat: 'Kitchen', url: 'https://images.unsplash.com/photo-1546549032-9571cd6b27df?w=900&h=900&fit=crop' },
  { title: 'Embroidered Cushion Cover', desc: 'Beautiful hand-embroidered cushion cover in natural cotton.', w: 1100, h: 900, cat: 'Home Decor', url: 'https://images.unsplash.com/photo-1616486029423-aaa4789e8c9a?w=1100&h=900&fit=crop' },
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
    const thumbUrl = `${s.url.split('?')[0]}?w=540&h=${Math.max(1, Math.round(540 / Math.max(0.5, aspect)))}&fit=crop&q=70`;

    const product = new Product({
      title: s.title,
      description: s.desc,
      price: Math.floor(200 + Math.random() * 2000),
      images: [s.url],
      category: s.cat,
      stock: 5 + Math.floor(Math.random() * 20),
      imageAspectRatio: aspect,
      media: [ { type: 'image', url: s.url, thumbnailUrl: thumbUrl, aspectRatio: aspect } ],
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
