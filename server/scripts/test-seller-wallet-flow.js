const mongoose = require('mongoose');

require('dotenv').config({ path: __dirname + '/../.env' });

const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Payout = require('../models/Payout');
const {
  ensureOrderPayoutRecords,
  syncSellerPayoutAfterFulfillment,
  processDuePayouts,
  claimSellerWallet,
  getSellerPayoutDashboard,
} = require('../services/payouts');

function roundCurrency(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Number(parsed.toFixed(2));
}

function buildSellerShipments(orderId, items) {
  const grouped = new Map();

  (items || []).forEach((item, index) => {
    const sellerKey = String(item.seller || '');
    if (!grouped.has(sellerKey)) {
      grouped.set(sellerKey, []);
    }
    grouped.get(sellerKey).push(index);
  });

  let seq = 1;
  return Array.from(grouped.entries()).map(([sellerId, itemIndexes]) => ({
    seller: sellerId,
    itemIndexes,
    localShipmentRef: `HK-${String(orderId).slice(-8).toUpperCase()}-${String(seq++).padStart(2, '0')}`,
    status: 'ready_for_booking',
    lastError: '',
    timeline: [
      {
        status: 'ready_for_booking',
        note: 'Test wallet flow shipment created.',
        source: 'system',
        at: new Date(),
      },
    ],
  }));
}

async function ensureSellerPayoutProfileForClaim(sellerId) {
  await User.findByIdAndUpdate(sellerId, {
    sellerPayoutProfile: {
      kycStatus: 'verified',
      kycVerifiedAt: new Date(),
      bankDetails: {
        accountHolderName: 'Seller Test Account',
        accountNumber: '123456789012',
        ifsc: 'HDFC0001234',
        bankName: 'HDFC Bank',
        branch: 'Test Branch',
        upiId: '',
        accountType: 'bank',
        razorpayLinkedAccountId: '',
        isVerified: true,
        verifiedAt: new Date(),
      },
    },
    sellerPayoutSettings: {
      autoPayoutEnabled: false,
      minimumPayoutAmount: 0,
      reservePercent: 10,
      overrideCoolingDays: null,
    },
  });
}

async function createPaidOrderFixture() {
  const buyer = await User.findOne({ isAdmin: false }).select('_id name email');
  if (!buyer) {
    throw new Error('No buyer user found to run wallet flow fixture.');
  }

  const products = await Product.find({ isActive: true, stock: { $gt: 0 }, seller: { $ne: null } })
    .select('_id title seller price')
    .limit(4)
    .lean();

  if (!products || products.length === 0) {
    throw new Error('No active seller products found to run wallet flow fixture.');
  }

  const selectedBySeller = new Map();
  for (const product of products) {
    const sellerId = String(product.seller || '');
    if (!sellerId) {
      continue;
    }
    if (!selectedBySeller.has(sellerId)) {
      selectedBySeller.set(sellerId, product);
    }
    if (selectedBySeller.size >= 2) {
      break;
    }
  }

  const chosenProducts = Array.from(selectedBySeller.values());
  if (chosenProducts.length === 0) {
    throw new Error('Could not find products with seller mapping for fixture order.');
  }

  const items = chosenProducts.map((product, index) => {
    const unitPrice = roundCurrency(product.price || 0);
    const quantity = index % 2 === 0 ? 1 : 2;
    return {
      product: product._id,
      seller: product.seller,
      quantity,
      price: unitPrice,
      title: product.title || `Fixture Product ${index + 1}`,
      image: '',
      fulfillmentStatus: 'new',
      sellerNote: '',
    };
  });

  const subtotal = roundCurrency(items.reduce((sum, item) => sum + (item.price * item.quantity), 0));
  const shippingCost = subtotal > 500 ? 0 : 50;
  const tax = roundCurrency(subtotal * 0.05);
  const totalAmount = roundCurrency(subtotal + shippingCost + tax);

  const order = new Order({
    user: buyer._id,
    items,
    sellerShipments: [],
    shippingAddress: {
      fullName: buyer.name || 'Wallet Flow Buyer',
      phoneNumber: '9876543210',
      email: buyer.email || 'buyer@example.com',
      street: '12 Wallet Test Street',
      city: 'Bengaluru',
      postalCode: '560001',
      country: 'India',
    },
    subtotal,
    shippingCost,
    tax,
    totalAmount,
    status: 'confirmed',
    paymentStatus: 'completed',
    paymentMethod: 'card',
    transactionId: `fixture_${Date.now()}`,
  });

  order.sellerShipments = buildSellerShipments(order._id, items);
  await order.save();

  return order;
}

async function main() {
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/handkraft';
  await mongoose.connect(mongoUri, { family: 4 });

  try {
    const order = await createPaidOrderFixture();
    console.log('[WALLET_TEST] Created fixture order:', String(order._id));

    const payouts = await ensureOrderPayoutRecords(order);
    if (!Array.isArray(payouts) || payouts.length === 0) {
      throw new Error('No payout records created from paid order fixture.');
    }

    const sellerIds = Array.from(new Set(order.items.map((item) => String(item.seller || '')).filter(Boolean)));

    order.items = order.items.map((item) => ({
      ...item.toObject(),
      fulfillmentStatus: 'delivered',
    }));
    order.sellerShipments = (order.sellerShipments || []).map((shipment) => ({
      ...shipment.toObject(),
      status: 'delivered',
      timeline: [
        ...(shipment.timeline || []),
        {
          status: 'delivered',
          note: 'Fixture shipment marked delivered.',
          source: 'system',
          at: new Date(),
        },
      ],
    }));
    await order.save();

    for (const sellerId of sellerIds) {
      await syncSellerPayoutAfterFulfillment(order, sellerId, 'system');
      await ensureSellerPayoutProfileForClaim(sellerId);
    }

    // Simulate hold expiry so release step can run inside test duration.
    await Payout.updateMany(
      { order: order._id, status: 'on_hold' },
      { $set: { holdUntil: new Date(Date.now() - 60 * 1000) } }
    );

    const releaseResult = await processDuePayouts({ limit: 100 });
    console.log('[WALLET_TEST] Release result:', releaseResult);

    let totalClaimed = 0;
    for (const sellerId of sellerIds) {
      const claimResult = await claimSellerWallet(sellerId, { claimAll: true, limit: 100 });
      totalClaimed += Number(claimResult?.claimResult?.claimedCount || 0);
      console.log('[WALLET_TEST] Claim result for seller', sellerId, claimResult.claimResult);

      const dashboard = await getSellerPayoutDashboard(sellerId, { page: 1, limit: 20 });
      const paidRows = (dashboard.payouts || []).filter((entry) => entry.status === 'paid');
      if (paidRows.length === 0) {
        throw new Error(`Seller ${sellerId} has no paid payouts after claim.`);
      }
    }

    if (totalClaimed <= 0) {
      throw new Error('No payouts were claimed in wallet flow test.');
    }

    console.log('[WALLET_TEST] PASS: release + claim wallet flow completed successfully.');
  } finally {
    await mongoose.connection.close();
  }
}

main().catch((err) => {
  console.error('[WALLET_TEST] FAIL:', err?.message || err);
  if (err?.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
