const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
    title: { type: String, required: true },
    image: { type: String, default: '' },
    fulfillmentStatus: {
      type: String,
      enum: ['new', 'processing', 'packed', 'shipped', 'delivered', 'cancelled'],
      default: 'new',
    },
    trackingEvents: [
      {
        status: {
          type: String,
          enum: ['new', 'processing', 'packed', 'shipped', 'delivered', 'cancelled'],
          required: true,
        },
        note: { type: String, default: '' },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { _id: false }
);

const shippingAddressSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    email: { type: String, required: true },
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, default: '' },
    postalCode: { type: String, required: true },
    country: { type: String, required: true },
    isDefaultAddress: { type: Boolean, default: false },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items: [orderItemSchema],
  shippingAddress: shippingAddressSchema,
  subtotal: { type: Number, required: true, min: 0 },
  shippingCost: { type: Number, default: 0, min: 0 },
  tax: { type: Number, default: 0, min: 0 },
  totalAmount: { type: Number, required: true, min: 0 },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'],
    default: 'pending',
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending',
  },
  paymentMethod: { type: String, default: 'card' },
  transactionId: { type: String, default: '' },
  notes: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Speeds up per-user order history queries used in profile and recommendations.
orderSchema.index({ user: 1, createdAt: -1 });

orderSchema.pre('save', async function() {
  this.updatedAt = Date.now();
});

module.exports = mongoose.model('Order', orderSchema);
