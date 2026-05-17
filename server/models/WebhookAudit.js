const mongoose = require('mongoose');

/**
 * WebhookAudit — Append-only audit log for every webhook received.
 *
 * Tracks NimbusPost & Razorpay webhooks with signature verification,
 * full payload capture, and idempotency key to prevent duplicate processing.
 *
 * Compliance: proof that webhook was received and how it was handled.
 * ~500K–1M rows/year estimate.
 */
const webhookAuditSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: ['razorpay', 'nimbuspost', 'unknown'],
      required: true,
      index: true,
    },
    event: { type: String, default: '', trim: true },
    idempotencyKey: {
      type: String,
      trim: true,
    },
    signature: { type: String, default: '' },
    signatureValid: { type: Boolean, default: null },
    payload: { type: mongoose.Schema.Types.Mixed, default: null },
    headers: { type: mongoose.Schema.Types.Mixed, default: null },
    processingResult: { type: mongoose.Schema.Types.Mixed, default: null },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    awbNumber: { type: String, default: '', trim: true },
    gatewayOrderId: { type: String, default: '', trim: true },
    gatewayPaymentId: { type: String, default: '', trim: true },
    httpStatusCode: { type: Number, default: 0 },
    processingMs: { type: Number, default: 0, min: 0 },
    error: { type: String, default: '' },
    ip: { type: String, default: '' },
    receivedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

// Query patterns: filter by provider+date, lookup by idempotency, find by order/awb
webhookAuditSchema.index({ provider: 1, receivedAt: -1 });
webhookAuditSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
webhookAuditSchema.index({ orderId: 1 }, { sparse: true });
webhookAuditSchema.index({ awbNumber: 1 }, { sparse: true });
webhookAuditSchema.index({ gatewayOrderId: 1 }, { sparse: true });
webhookAuditSchema.index({ receivedAt: -1 });
webhookAuditSchema.index({ signatureValid: 1, receivedAt: -1 });

module.exports = mongoose.model('WebhookAudit', webhookAuditSchema);
