/**
 * Test: Payout Hold & Release (Phase 7)
 *
 * Verifies delivery moves payouts to hold when a cooling window is configured,
 * due holds are released by the scheduler path, and zero-day holds release immediately.
 */

const assert = require('assert');
const mongoose = require('mongoose');

require('dotenv').config({ path: __dirname + '/../.env' });

const { env } = require('../config/env');
const User = require('../models/User');
const Order = require('../models/Order');
const Payout = require('../models/Payout');
const {
  applyPayoutDeliveryHold,
  ensureOrderPayoutRecords,
  processDuePayouts,
  syncSellerPayoutAfterFulfillment,
} = require('../services/payouts');

function buildOrderFixture({ buyerId, sellerId, suffix = '01' }) {
  const productId = new mongoose.Types.ObjectId();
  return new Order({
    user: buyerId,
    items: [
      {
        product: productId,
        seller: sellerId,
        quantity: 1,
        price: 1000,
        title: `Phase 7 Test Item ${suffix}`,
        image: '',
        fulfillmentStatus: 'delivered',
        trackingEvents: [],
      },
    ],
    sellerShipments: [
      {
        seller: sellerId,
        itemIndexes: [0],
        localShipmentRef: `HK-PHASE7-${suffix}`,
        status: 'delivered',
        timeline: [
          {
            status: 'delivered',
            note: 'Test shipment delivered.',
            source: 'system',
            at: new Date(),
          },
        ],
      },
    ],
    shippingAddress: {
      fullName: 'Phase 7 Buyer',
      phoneNumber: '9999999999',
      email: 'phase7-buyer@example.com',
      street: '1 Test Lane',
      city: 'Bengaluru',
      state: 'KA',
      postalCode: '560001',
      country: 'India',
    },
    subtotal: 1000,
    shippingCost: 0,
    tax: 0,
    totalAmount: 1000,
    status: 'confirmed',
    paymentStatus: 'completed',
    paymentMethod: 'card',
    transactionId: `phase7_${Date.now()}_${suffix}`,
  });
}

async function testInMemoryHelperTransitions() {
  const immediatePayout = {
    status: 'awaiting_delivery',
    payout: {},
    timeline: [],
  };

  const now = new Date();
  applyPayoutDeliveryHold(immediatePayout, { coolingDays: 0, now, source: 'system' });
  assert.strictEqual(immediatePayout.status, 'ready_for_payout');
  assert.ok(immediatePayout.holdUntil instanceof Date);
  assert.strictEqual(immediatePayout.timeline.at(-1).status, 'ready_for_payout');

  const delayedPayout = {
    status: 'awaiting_delivery',
    payout: {},
    timeline: [],
  };

  applyPayoutDeliveryHold(delayedPayout, { coolingDays: 3, now, source: 'system' });
  assert.strictEqual(delayedPayout.status, 'on_hold');
  assert.ok(delayedPayout.holdUntil instanceof Date);
  const deltaDays = (delayedPayout.holdUntil.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
  assert.ok(deltaDays >= 2.9 && deltaDays <= 3.1);
  assert.strictEqual(delayedPayout.timeline.at(-1).status, 'on_hold');
}

async function testDeliveryHoldAndReleaseFlow() {
  const originalHoldDays = env?.payouts?.holdDaysAfterDelivery;
  const createdIds = { buyer: null, seller: null, order: null };

  try {
    env.payouts.holdDaysAfterDelivery = 2;

    const buyer = await User.create({
      name: 'Phase 7 Buyer',
      email: `phase7-buyer-${Date.now()}@example.com`,
      authProvider: 'local',
      accountStatus: 'active',
    });
    const seller = await User.create({
      name: 'Phase 7 Seller',
      email: `phase7-seller-${Date.now()}@example.com`,
      authProvider: 'local',
      accountStatus: 'active',
      sellerPayoutProfile: {
        kycStatus: 'verified',
        kycVerifiedAt: new Date(),
        bankDetails: {
          accountHolderName: 'Phase 7 Seller',
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

    createdIds.buyer = buyer._id;
    createdIds.seller = seller._id;

    const order = buildOrderFixture({ buyerId: buyer._id, sellerId: seller._id });
    await order.save();
    createdIds.order = order._id;

    const payouts = await ensureOrderPayoutRecords(order);
    assert.ok(Array.isArray(payouts) && payouts.length === 1);
    assert.strictEqual(String(payouts[0].status), 'awaiting_delivery');

    const heldPayout = await syncSellerPayoutAfterFulfillment(order, seller._id, 'system');
    assert.strictEqual(String(heldPayout.status), 'on_hold');
    assert.ok(heldPayout.holdUntil instanceof Date);

    await Payout.updateOne(
      { _id: heldPayout._id },
      { $set: { holdUntil: new Date(Date.now() - 60 * 1000) } }
    );

    const releaseResult = await processDuePayouts({ limit: 10 });
    assert.strictEqual(releaseResult.releasedCount, 1);

    const releasedPayout = await Payout.findById(heldPayout._id).lean();
    assert.strictEqual(String(releasedPayout.status), 'ready_for_payout');
    assert.ok(Array.isArray(releasedPayout.timeline));
    assert.strictEqual(releasedPayout.timeline.at(-1).status, 'ready_for_payout');
  } finally {
    env.payouts.holdDaysAfterDelivery = originalHoldDays;
    if (createdIds.order) {
      await Payout.deleteMany({ order: createdIds.order });
      await Order.deleteOne({ _id: createdIds.order });
    }
    if (createdIds.buyer) {
      await User.deleteOne({ _id: createdIds.buyer });
    }
    if (createdIds.seller) {
      await User.deleteOne({ _id: createdIds.seller });
    }
  }
}

async function run() {
  console.log('\n========== PHASE 7: PAYOUT HOLD & RELEASE TESTS ==========' );

  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/handkraft';
  await mongoose.connect(mongoUri, { family: 4 });

  let passed = 0;
  let failed = 0;

  try {
    await testInMemoryHelperTransitions();
    console.log('✓ PASS: in-memory hold helper applies immediate and delayed release states');
    passed += 1;
  } catch (err) {
    console.log('✗ FAIL: in-memory hold helper applies immediate and delayed release states');
    console.log(`  ${err?.message || err}`);
    failed += 1;
  }

  try {
    await testDeliveryHoldAndReleaseFlow();
    console.log('✓ PASS: delivered payout moves to hold and releases when due');
    passed += 1;
  } catch (err) {
    console.log('✗ FAIL: delivered payout moves to hold and releases when due');
    console.log(`  ${err?.message || err}`);
    failed += 1;
  }

  await mongoose.connection.close();

  console.log('');
  console.log('========== TEST SUMMARY ==========' );
  console.log(`✓ PASSED: ${passed}`);
  console.log(`✗ FAILED: ${failed}`);
  console.log(`📈 TOTAL:  ${passed + failed}`);

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});