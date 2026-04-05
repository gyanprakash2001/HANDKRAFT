const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  price: { type: Number, required: true, min: 0 },
  realPrice: { type: Number, min: 0 },
  discountedPrice: { type: Number, min: 0 },
  discountPercentage: { type: Number, min: 0, max: 100 },
  images: [{ type: String }],
  category: { type: String, required: true, trim: true },
  customCategory: { type: String, default: '', trim: true },
  material: { type: String, default: '' },
  stock: { type: Number, default: 0, min: 0 },
  imageAspectRatio: { type: Number, default: 1, min: 0.5, max: 2 },
  media: [{
    type: {
      type: String,
      enum: ['image', 'video'],
      required: true,
    },
    url: { type: String, required: true },
    thumbnailUrl: { type: String, default: '' },
    aspectRatio: { type: Number, min: 0.5, max: 2 },
  }],
  customizable: { type: Boolean, default: false },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  sellerName: { type: String, default: 'Handmade Artisan' },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Product', productSchema);