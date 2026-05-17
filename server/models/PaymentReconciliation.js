const mongoose = require('mongoose');

/**
 * PaymentReconciliation — Immutable audit trail for payment splits.
 *
 * Records exact platform fee, reserve %, deductions per seller per order
 * at every significant financial event. Sellers can verify their split,
 * admins can trace the full financial lifecycle.
 *
 * ~100K rows/year estimate.
 */
const paymentReconciliationSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    event: {
      type: String,
      required: true,
      enum: [
        'payment_captured',
        'payout_record_created',
        'payout_hold_started',
        'payout_released',
        'payout_claimed',
        'payout_failed',
        'payout_cancelled',
        'reserve_released',
        'refund_issued',
        'split_recalculated',
      ],
      trim: true,
    },
    snapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      // Expected shape:
      // {
      //   itemSubtotal, shippingShare, shippingDeduction, grossAmount,
      //   platformFeePercent, platformFeeAmount, deductionsTotal,
      //   basePayoutAmount, reservePercent, reserveAmount, netPayoutAmount,
      //   refundedAmount, orderTotalAmount, orderShippingCost
      // }
    },
    payoutId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payout', default: null },
    payoutStatus: { type: String, default: '' },
    gatewayPaymentId: { type: String, default: '', trim: true },
    gatewayOrderId: { type: String, default: '', trim: true },
    currency: { type: String, default: 'INR', trim: true },
    amount: { type: Number, default: 0 },
    note: { type: String, default: '' },
    source: {
      type: String,
      enum: ['system', 'admin', 'seller', 'scheduler', 'webhook'],
      default: 'system',
    },
    createdAt: { type: Date, default: Date.now },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

paymentReconciliationSchema.index({ order: 1, seller: 1, createdAt: -1 });
paymentReconciliationSchema.index({ seller: 1, createdAt: -1 });
paymentReconciliationSchema.index({ event: 1, createdAt: -1 });
paymentReconciliationSchema.index({ payoutId: 1 }, { sparse: true });
paymentReconciliationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('PaymentReconciliation', paymentReconciliationSchema);
