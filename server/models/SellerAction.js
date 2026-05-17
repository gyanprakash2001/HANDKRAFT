const mongoose = require('mongoose');

/**
 * SellerAction — Seller self-service audit log.
 *
 * Tracks bank detail updates, address changes, payout claims, profile updates.
 * Foundation for trust scoring and KYC/verification history compliance.
 *
 * ~50K–100K rows/year estimate.
 */
const sellerActionSchema = new mongoose.Schema(
  {
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    action: {
      type: String,
      required: true,
      enum: [
        'bank_details_updated',
        'pickup_address_updated',
        'kyc_submitted',
        'kyc_verified',
        'kyc_rejected',
        'payout_claimed',
        'payout_claim_blocked',
        'profile_updated',
        'account_suspended',
        'account_reactivated',
        'seller_profile_created',
        'payout_settings_updated',
      ],
      trim: true,
    },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
    note: { type: String, default: '' },
    source: {
      type: String,
      enum: ['seller', 'admin', 'system'],
      default: 'seller',
    },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

sellerActionSchema.index({ seller: 1, createdAt: -1 });
sellerActionSchema.index({ action: 1, createdAt: -1 });
sellerActionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('SellerAction', sellerActionSchema);
