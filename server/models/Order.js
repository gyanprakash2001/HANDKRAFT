const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
    title: { type: String, required: true },
    image: { type: String, default: '' },
    packageWeightGrams: { type: Number, default: 0, min: 0 },
    packageLengthCm: { type: Number, default: 0, min: 0 },
    packageBreadthCm: { type: Number, default: 0, min: 0 },
    packageHeightCm: { type: Number, default: 0, min: 0 },
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

const sellerShipmentTimelineSchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    note: { type: String, default: '' },
    source: {
      type: String,
      enum: ['system', 'seller', 'admin'],
      default: 'system',
    },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const sellerShipmentCarrierSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ['', 'nimbuspost'], default: '' },
    mode: { type: String, enum: ['', 'v1', 'v2'], default: '' },
    orderId: { type: String, default: '' },
    shipmentId: { type: String, default: '' },
    awbNumber: { type: String, default: '' },
    courierId: { type: String, default: '' },
    courierName: { type: String, default: '' },
    remoteStatus: { type: String, default: '' },
    labelUrl: { type: String, default: '' },
    manifestUrl: { type: String, default: '' },
    trackingUrl: { type: String, default: '' },
  },
  { _id: false }
);

const sellerShipmentSchema = new mongoose.Schema({
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  itemIndexes: [{ type: Number, min: 0 }],
  localShipmentRef: { type: String, required: true, trim: true },
  status: {
    type: String,
    enum: ['pending', 'ready_for_booking', 'booked', 'awb_assigned', 'pickup_scheduled', 'in_transit', 'delivered', 'cancelled', 'failed'],
    default: 'pending',
  },
  lastError: { type: String, default: '' },
  preferredCourierId: { type: String, default: '' },
  preferredCourierName: { type: String, default: '' },
  quotedShippingCost: { type: Number, default: 0, min: 0 },
  carrier: { type: sellerShipmentCarrierSchema, default: () => ({}) },
  timeline: [sellerShipmentTimelineSchema],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const paymentGatewaySchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ['', 'razorpay'], default: '' },
    gatewayOrderId: { type: String, default: '' },
    gatewayPaymentId: { type: String, default: '' },
    signature: { type: String, default: '' },
    amount: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'INR' },
    status: { type: String, default: '' },
    captured: { type: Boolean, default: false },
    paidAt: { type: Date, default: null },
    raw: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items: [orderItemSchema],
  sellerShipments: [sellerShipmentSchema],
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
  paymentGateway: { type: paymentGatewaySchema, default: () => ({}) },
  notes: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Speeds up per-user order history queries used in profile and recommendations.
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ 'sellerShipments.seller': 1, createdAt: -1 });
orderSchema.index({ 'sellerShipments.localShipmentRef': 1 });
orderSchema.index({ 'sellerShipments.carrier.awbNumber': 1 });

orderSchema.pre('save', async function() {
  const now = new Date();
  this.updatedAt = now;

  if (Array.isArray(this.sellerShipments)) {
    this.sellerShipments.forEach((shipment) => {
      if (!shipment.createdAt) {
        shipment.createdAt = now;
      }
      shipment.updatedAt = now;
    });
  }
});

module.exports = mongoose.model('Order', orderSchema);
