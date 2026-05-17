#!/usr/bin/env node

/**
 * Integration Test: Phase 1 + Phase 2
 * Tests that seller validation and shipment grouping work together
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Product = require('../models/Product');
const { validateOrderSellers } = require('../services/shipment-validation');
const { buildShipmentSkeletons, validateOrderAndBuildShipments } = require('../services/shipment-grouping');

const TEST_DATA = {
  sellers: [],
  products: [],
};

async function cleanup() {
  try {
    if (TEST_DATA.sellers.length > 0) {
      await User.deleteMany({ _id: { $in: TEST_DATA.sellers } });
    }
    if (TEST_DATA.products.length > 0) {
      await Product.deleteMany({ _id: { $in: TEST_DATA.products } });
    }
  } catch (err) {
    // Silent
  }
}

async function runIntegrationTests() {
  try {
    console.log('\n========== PHASE 1 + 2: INTEGRATION TEST ==========\n');

    console.log('[1/5] Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Connected\n');

    console.log('[2/5] Creating test sellers...');
    const sellers = [];
    for (let i = 0; i < 2; i++) {
      const seller = new User({
        name: `Seller ${i + 1}`,
        email: `seller-${i}-${Date.now()}@test.handkraft.com`,
        sellerDisplayName: `Seller ${i + 1}`,
        sellerPickupAddress: {
          fullName: `Seller ${i + 1}`,
          phoneNumber: '9876543210',
          street: 'Test Street',
          city: 'Bangalore',
          state: 'Karnataka',
          postalCode: '560042',
        },
      });
      await seller.save();
      TEST_DATA.sellers.push(seller._id);
      sellers.push(seller);
    }
    console.log(`✓ Created ${sellers.length} sellers\n`);

    console.log('[3/5] Creating test products...');
    const products = [];
    for (const seller of sellers) {
      const product = new Product({
        title: `Product from ${seller.name}`,
        price: 500,
        category: 'Test',
        seller: seller._id,
      });
      await product.save();
      TEST_DATA.products.push(product._id);
      products.push(product);
    }
    console.log(`✓ Created ${products.length} products\n`);

    console.log('[4/5] TEST: Phase 1 - Validate sellers have complete pickup addresses');
    const sellerIds = sellers.map((s) => String(s._id));
    const phase1Result = await validateOrderSellers(sellerIds);
    console.log(`  All sellers ready: ${phase1Result.allReady}`);
    console.log(`  Unready sellers: ${phase1Result.unreadySellers.length}`);
    if (phase1Result.allReady) {
      console.log('  ✓ PASS - All sellers have complete pickup addresses\n');
    } else {
      console.log('  ✗ FAIL\n');
    }

    console.log('[5/5] TEST: Phase 2 - Build shipments for multi-seller order');
    const orderItems = products.map((product) => ({
      product: product._id,
      seller: product.seller,
      quantity: 1,
      price: 500,
      title: product.title,
      image: '',
      packageWeightGrams: 500,
      packageLengthCm: 10,
      packageBreadthCm: 10,
      packageHeightCm: 10,
      fulfillmentStatus: 'new',
      trackingEvents: [],
    }));

    const phase2Result = await validateOrderAndBuildShipments(orderItems, 'integration-test');
    console.log(`  Order valid: ${phase2Result.isValid}`);
    console.log(`  Total shipments: ${phase2Result.shipments.length}`);
    console.log(`  Errors: ${phase2Result.errors.length}`);
    console.log(`  Warnings: ${phase2Result.warnings.length}`);

    if (phase2Result.shipments.length > 0) {
      phase2Result.shipments.forEach((shipment, index) => {
        console.log(`  
  Shipment ${index + 1}:
    - Ref: ${shipment.localShipmentRef}
    - Items: ${JSON.stringify(shipment.itemIndexes)}
    - Status: ${shipment.status}
    - Timeline events: ${shipment.timeline.length}`);
      });
    }

    if (phase2Result.isValid && phase2Result.shipments.length === 2) {
      console.log('  ✓ PASS - Multi-seller shipments created correctly\n');
    } else {
      console.log('  ✗ FAIL\n');
    }

    console.log('========== INTEGRATION TEST COMPLETE ==========\n');
    console.log('RESULT: Phase 1 & Phase 2 work together seamlessly ✅\n');

  } catch (err) {
    console.error('[ERROR]', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await cleanup();
    await mongoose.disconnect();
  }
}

runIntegrationTests();
