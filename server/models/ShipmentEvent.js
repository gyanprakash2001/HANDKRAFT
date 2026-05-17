const mongoose = require('mongoose');

/**
 * ShipmentEvent — Full shipment lifecycle granularity.
 *
 * Logs quotes, booking attempts, errors, retries, tracking updates.
 * Enables carrier performance analysis and debugging.
 *
 * ~300K–500K rows/year estimate.
 */
const shipmentEventSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    localShipmentRef: { type: String, default: '', trim: true },
    event: {
      type: String,
      required: true,
      enum: [
        'quote_requested',
        'quote_received',
        'quote_failed',
        'booking_attempted',
        'booking_succeeded',
        'booking_failed',
        'tracking_updated',
        'tracking_sync_requested',
        'tracking_sync_completed',
        'tracking_sync_failed',
        'status_changed',
        'webhook_received',
        'webhook_status_applied',
        'shipment_created',
        'shipment_cancelled',
        'label_generated',
        'pickup_scheduled',
        'delivery_confirmed',
      ],
      trim: true,
    },
    previousStatus: { type: String, default: '' },
    newStatus: { type: String, default: '' },
    carrier: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      // Expected shape: { provider, courierId, courierName, awbNumber, orderId, shipmentId }
    },
    quoteData: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      // Expected shape: { origin, destination, weight, options, selectedCourier, shippingCost }
    },
    errorMessage: { type: String, default: '' },
    payload: { type: mongoose.Schema.Types.Mixed, default: null },
    source: {
      type: String,
      enum: ['system', 'seller', 'admin', 'webhook', 'scheduler'],
      default: 'system',
    },
    processingMs: { type: Number, default: 0, min: 0 },
    createdAt: { type: Date, default: Date.now },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

shipmentEventSchema.index({ order: 1, createdAt: -1 });
shipmentEventSchema.index({ seller: 1, createdAt: -1 });
shipmentEventSchema.index({ localShipmentRef: 1, createdAt: -1 });
shipmentEventSchema.index({ event: 1, createdAt: -1 });
shipmentEventSchema.index({ 'carrier.awbNumber': 1 }, { sparse: true });
shipmentEventSchema.index({ 'carrier.provider': 1, event: 1, createdAt: -1 });
shipmentEventSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ShipmentEvent', shipmentEventSchema);
