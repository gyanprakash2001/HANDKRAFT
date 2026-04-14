const mongoose = require('mongoose');

const payoutTimelineSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['awaiting_delivery', 'on_hold', 'ready_for_payout', 'paid', 'failed', 'reversed', 'cancelled'],
      required: true,
    },
    note: { type: String, default: '' },
    source: {
      type: String,
      enum: ['system', 'seller', 'admin', 'scheduler'],
      default: 'system',
    },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const payoutSplitSchema = new mongoose.Schema(
  {
    itemSubtotal: { type: Number, required: true, min: 0 },
    shippingShare: { type: Number, default: 0, min: 0 },
    shippingDeduction: { type: Number, default: 0, min: 0 },
    grossAmount: { type: Number, required: true, min: 0 },
    platformFeePercent: { type: Number, default: 0, min: 0, max: 100 },
    platformFeeAmount: { type: Number, default: 0, min: 0 },
    deductionsTotal: { type: Number, default: 0, min: 0 },
    basePayoutAmount: { type: Number, default: 0, min: 0 },
    reservePercent: { type: Number, default: 0, min: 0, max: 100 },
    reserveAmount: { type: Number, default: 0, min: 0 },
    netPayoutAmount: { type: Number, required: true, min: 0 },
    refundedAmount: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const payoutTrustSnapshotSchema = new mongoose.Schema(
  {
    deliveredOrderCount: { type: Number, default: 0, min: 0 },
    trustedThreshold: { type: Number, default: 100, min: 1 },
    isTrusted: { type: Boolean, default: false },
    coolingDays: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const payoutPayoutMetaSchema = new mongoose.Schema(
  {
    mode: { type: String, enum: ['auto', 'manual'], default: 'auto' },
    provider: { type: String, enum: ['internal', 'razorpay_route'], default: 'internal' },
    referenceId: { type: String, default: '' },
    initiatedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    failureReason: { type: String, default: '' },
    raw: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const payoutSchema = new mongoose.Schema({
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  sellerShipmentRef: { type: String, default: '' },
  currency: { type: String, default: 'INR' },
  status: {
    type: String,
    enum: ['awaiting_delivery', 'on_hold', 'ready_for_payout', 'paid', 'failed', 'reversed', 'cancelled'],
    default: 'awaiting_delivery',
  },
  split: { type: payoutSplitSchema, required: true },
  trustSnapshot: { type: payoutTrustSnapshotSchema, required: true },
  deliveredAt: { type: Date, default: null },
  holdStartedAt: { type: Date, default: null },
  holdUntil: { type: Date, default: null },
  payout: { type: payoutPayoutMetaSchema, default: () => ({}) },
  timeline: [payoutTimelineSchema],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

payoutSchema.index({ seller: 1, status: 1, holdUntil: 1 });
payoutSchema.index({ seller: 1, createdAt: -1 });
payoutSchema.index({ order: 1, seller: 1 }, { unique: true });

payoutSchema.pre('save', function setUpdatedAt() {
  this.updatedAt = new Date();
});

module.exports = mongoose.model('Payout', payoutSchema);
