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

const sellerBankDetailsSchema = new mongoose.Schema(
  {
    accountHolderName: { type: String, default: '' },
    accountNumber: { type: String, default: '' },
    ifsc: { type: String, default: '' },
    bankName: { type: String, default: '' },
    branch: { type: String, default: '' },
    upiId: { type: String, default: '' },
    accountType: { type: String, enum: ['bank', 'upi'], default: 'bank' },
    razorpayLinkedAccountId: { type: String, default: '' },
    isVerified: { type: Boolean, default: false },
    verifiedAt: { type: Date, default: null },
  },
  { _id: false }
);

const sellerPayoutProfileSchema = new mongoose.Schema(
  {
    kycStatus: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
    kycVerifiedAt: { type: Date, default: null },
    bankDetails: { type: sellerBankDetailsSchema, default: () => ({}) },
  },
  { _id: false }
);

const sellerPayoutSettingsSchema = new mongoose.Schema(
  {
    autoPayoutEnabled: { type: Boolean, default: true },
    minimumPayoutAmount: { type: Number, default: 0, min: 0 },
    reservePercent: { type: Number, default: 10, min: 0, max: 100 },
    overrideCoolingDays: { type: Number, default: null, min: 0, max: 60 },
  },
  { _id: false }
);

const sellerTrustSchema = new mongoose.Schema(
  {
    deliveredOrderCount: { type: Number, default: 0, min: 0 },
    isTrusted: { type: Boolean, default: false },
    trustedSince: { type: Date, default: null },
  },
  { _id: false }
);

const sellerPickupAddressSchema = new mongoose.Schema(
  {
    addressId: { type: String, default: '' },
    label: { type: String, default: 'Pickup' },
    fullName: { type: String, default: '' },
    phoneNumber: { type: String, default: '' },
    email: { type: String, default: '' },
    street: { type: String, default: '' },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    postalCode: { type: String, default: '' },
    country: { type: String, default: 'India' },
    updatedAt: { type: Date, default: null },
  },
  { _id: false }
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
  sellerDisplayName: { type: String, default: '' },
  sellerTagline: { type: String, default: '' },
  sellerStory: { type: String, default: '' },
  sellerStoryVideoUrl: { type: String, default: '' },
  sellerInstagram: { type: String, default: '' },
  sellerContactEmail: { type: String, default: '' },
  sellerContactPhone: { type: String, default: '' },
  sellerWebsite: { type: String, default: '' },
  sellerLocation: { type: String, default: '' },
  sellerPickupAddress: { type: sellerPickupAddressSchema, default: () => ({}) },
  sellerPayoutProfile: { type: sellerPayoutProfileSchema, default: () => ({}) },
  sellerPayoutSettings: { type: sellerPayoutSettingsSchema, default: () => ({}) },
  sellerTrust: { type: sellerTrustSchema, default: () => ({}) },
  likedProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  likedProductTimestamps: [likedProductTimestampSchema],
  cartItems: [cartItemSchema],
  addresses: [addressSchema],
  isAdmin: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('User', userSchema);
