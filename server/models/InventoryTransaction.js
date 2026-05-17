const mongoose = require('mongoose');

/**
 * InventoryTransaction — Atomic, reversal-capable stock change log.
 *
 * Every stock change linked to an order. Prevents overselling analysis
 * and provides forensics to trace where stock went.
 *
 * ~200K–500K rows/year estimate.
 */
const inventoryTransactionSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    type: {
      type: String,
      required: true,
      enum: [
        'sale_deducted',
        'sale_reversed',
        'manual_adjustment',
        'restock',
        'initial_stock',
        'admin_correction',
        'cancelled_order_reversed',
      ],
      trim: true,
    },
    quantityChange: { type: Number, required: true },
    previousStock: { type: Number, required: true, min: 0 },
    newStock: { type: Number, required: true },
    reason: { type: String, default: '' },
    source: {
      type: String,
      enum: ['system', 'admin', 'seller'],
      default: 'system',
    },
    reversalOf: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InventoryTransaction',
      default: null,
    },
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

inventoryTransactionSchema.index({ product: 1, createdAt: -1 });
inventoryTransactionSchema.index({ order: 1 }, { sparse: true });
inventoryTransactionSchema.index({ seller: 1, createdAt: -1 });
inventoryTransactionSchema.index({ type: 1, createdAt: -1 });
inventoryTransactionSchema.index({ reversalOf: 1 }, { sparse: true });
inventoryTransactionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('InventoryTransaction', inventoryTransactionSchema);
