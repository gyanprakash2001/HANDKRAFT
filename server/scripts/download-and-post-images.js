const axios = require('axios');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const mongoose = require('mongoose');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Product = require('../models/Product');
const User = require('../models/User');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'products');
async function ensureDir() {
  await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
}

function publicBase() {
  const explicit = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (explicit) return explicit;
  const host = `http://localhost:${process.env.PORT || 5000}`;
  return host.replace(/\/+$/, '');
}

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

async function downloadToBuffer(url) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
  return Buffer.from(res.data);
}

async function saveImageBuffer(buf, filename) {
  const filePath = path.join(UPLOAD_DIR, filename);
  await fs.promises.writeFile(filePath, buf);
  return filePath;
}

async function makeThumbnail(buf, thumbPath) {
  await sharp(buf).resize({ width: 540, withoutEnlargement: true }).jpeg({ quality: 76 }).toFile(thumbPath);
}

async function run() {
  await ensureDir();
  const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/handkraft';
  console.log('Connecting to MongoDB', mongoUri);
  await mongoose.connect(mongoUri);

  const seller = await User.findOne() || null;
  const sellerId = seller ? seller._id : null;

  const created = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const url = `https://source.unsplash.com/featured/${s.w}x${s.h}/?${encodeURIComponent(s.q)}`;
    console.log('Downloading', url);
    let buf;
    try {
      buf = await downloadToBuffer(url);
    } catch (err) {
      console.warn('Primary download failed for', url, err.message || err);
      // fallback to picsum photos seeded endpoint
      const picsum = `https://picsum.photos/seed/${encodeURIComponent(s.q + '-' + i)}/${s.w}/${s.h}`;
      try {
        console.log('Falling back to', picsum);
        buf = await downloadToBuffer(picsum);
      } catch (err2) {
        console.error('Fallback download failed for', picsum, err2.message || err2);
        continue;
      }
    }

    const ext = 'jpg';
    const base = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${i}`;
    const fileName = `${base}.${ext}`;
    const thumbName = `${base}-thumb.jpg`;

    const filePath = await saveImageBuffer(buf, fileName);

    const thumbPath = path.join(UPLOAD_DIR, thumbName);
    try {
      await makeThumbnail(buf, thumbPath);
    } catch (err) {
      console.warn('Thumbnail creation failed:', err.message || err);
      // fallback: copy original
      await fs.promises.copyFile(filePath, thumbPath);
    }

    const aspect = Number((s.w / s.h).toFixed(2));

    const publicPrefix = publicBase();
    const mediaUrl = `${publicPrefix}/uploads/products/${fileName}`;
    const thumbUrl = `${publicPrefix}/uploads/products/${thumbName}`;

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
    console.log('Saved product with local image:', product.title);
    created.push(product);
  }

  console.log('Created', created.length, 'products with downloaded images.');
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
