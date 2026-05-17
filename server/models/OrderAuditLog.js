const mongoose = require('mongoose');

/**
 * OrderAuditLog — Order state transition audit trail.
 *
 * All status changes timestamped for buyer communication,
 * dispute resolution, and full transition audit trail.
 *
 * ~100K rows/year estimate.
 */
const orderAuditLogSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorRole: {
      type: String,
      enum: ['buyer', 'seller', 'admin', 'system', 'webhook', 'scheduler'],
      default: 'system',
    },
    event: {
      type: String,
      required: true,
      enum: [
        'order_created',
        'order_confirmed',
        'payment_initiated',
        'payment_completed',
        'payment_failed',
        'payment_webhook_received',
        'status_changed',
        'item_status_changed',
        'shipment_created',
        'shipment_booked',
        'shipment_booking_failed',
        'shipment_status_changed',
        'shipment_delivered',
        'cancelled',
        'draft_revealed',
        'refund_initiated',
        'payout_created',
        'shipping_quote_calculated',
        'cart_cleared',
        'stock_deducted',
      ],
      trim: true,
    },
    previousState: { type: mongoose.Schema.Types.Mixed, default: null },
    newState: { type: mongoose.Schema.Types.Mixed, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
    note: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

orderAuditLogSchema.index({ order: 1, createdAt: -1 });
orderAuditLogSchema.index({ event: 1, createdAt: -1 });
orderAuditLogSchema.index({ actor: 1, createdAt: -1 });
orderAuditLogSchema.index({ actorRole: 1, createdAt: -1 });
orderAuditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('OrderAuditLog', orderAuditLogSchema);
