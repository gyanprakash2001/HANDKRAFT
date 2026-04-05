const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, default: 1, min: 1 },
  },
  { _id: false }
);

const likedProductTimestampSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    likedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const addressSchema = new mongoose.Schema(
  {
    label: { type: String, default: 'Home' },
    fullName: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    email: { type: String, required: true },
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, default: '' },
    postalCode: { type: String, required: true },
    country: { type: String, default: 'India' },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  firstName: { type: String, default: '' },
  lastName: { type: String, default: '' },
  email: { type: String, required: true, unique: true },
  emailVerified: { type: Boolean, default: false },
  // password is optional to support OAuth users (Google sign-in)
  password: { type: String, default: '' },
  // Google account id (sub) when user signs in via Google
  googleId: { type: String, default: null },
  // auth provider: 'local' (email/password) or 'google'
  authProvider: { type: String, enum: ['local', 'google'], default: 'local' },
  avatarUrl: { type: String, default: '' },
  phoneNumber: { type: String, default: '' },
  locale: { type: String, default: '' },
  bio: { type: String, default: '' },
  likedProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  likedProductTimestamps: [likedProductTimestampSchema],
  cartItems: [cartItemSchema],
  addresses: [addressSchema],
  isAdmin: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('User', userSchema);
