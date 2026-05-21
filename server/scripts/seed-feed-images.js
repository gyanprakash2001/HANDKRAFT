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

  // 3) Seed 10 sample products with stable, direct image URLs (no redirects)
  const samples = [
    { title: 'Handcrafted Jewelry', w: 800, h: 1200, cat: 'Jewelry', url: 'https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?w=800&h=1200&fit=crop' },
    { title: 'Woven Home Decor', w: 1000, h: 800, cat: 'Home Decor', url: 'https://images.unsplash.com/photo-1616627781436-9f1f9fdf7dd1?w=1000&h=800&fit=crop' },
    { title: 'Leather Accessories', w: 800, h: 800, cat: 'Accessories', url: 'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=800&h=800&fit=crop' },
    { title: 'Carved Woodwork', w: 900, h: 1200, cat: 'Home Decor', url: 'https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=900&h=1200&fit=crop' },
    { title: 'Hand-Dyed Textiles', w: 1200, h: 900, cat: 'Textiles', url: 'https://images.unsplash.com/photo-1606722590583-6951b5ea92ad?w=1200&h=900&fit=crop' },
    { title: 'Ceramic Pottery', w: 1000, h: 1400, cat: 'Home Decor', url: 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=1000&h=1400&fit=crop' },
    { title: 'Handmade Tote Bag', w: 1000, h: 1000, cat: 'Accessories', url: 'https://images.unsplash.com/photo-1591561954557-26941169b49e?w=1000&h=1000&fit=crop' },
    { title: 'Original Wall Art', w: 1200, h: 800, cat: 'Art', url: 'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?w=1200&h=800&fit=crop' },
    { title: 'Wooden Cutting Board', w: 900, h: 900, cat: 'Kitchen', url: 'https://images.unsplash.com/photo-1546549032-9571cd6b27df?w=900&h=900&fit=crop' },
    { title: 'Embroidered Cushion', w: 1100, h: 900, cat: 'Home Decor', url: 'https://images.unsplash.com/photo-1616486029423-aaa4789e8c9a?w=1100&h=900&fit=crop' },
  ];

  const created = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const aspect = Number((s.w / s.h).toFixed(2));

    const p = new Product({
      title: `${s.title} ${i + 1}`,
      description: `Beautiful ${s.title.toLowerCase()} crafted by local artisans.`,
      price: Math.floor(100 + Math.random() * 900),
      realPrice: null,
      discountedPrice: null,
      discountPercentage: 0,
      images: [s.url],
      category: s.cat,
      stock: 10 + Math.floor(Math.random() * 50),
      imageAspectRatio: aspect,
      media: [
        {
          type: 'image',
          url: s.url,
          thumbnailUrl: s.url,
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
    console.log(`Created sample product ${p.title} with remote image URL`);
  }

  console.log(`Done. Created ${created.length} sample products.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Error seeding feed images:', err);
  process.exit(1);
});
