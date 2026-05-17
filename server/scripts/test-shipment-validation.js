#!/usr/bin/env node

/**
 * Test script for Phase 1: Seller Pickup Address Validation
 * Tests the shipment-validation service
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const { isSellerReadyForShipping, validateOrderSellers } = require('../services/shipment-validation');

const TEST_SELLERS = [];

async function cleanup() {
  try {
    if (TEST_SELLERS.length > 0) {
      await User.deleteMany({ _id: { $in: TEST_SELLERS } });
      console.log(`[CLEANUP] Deleted ${TEST_SELLERS.length} test sellers`);
    }
  } catch (err) {
    console.error('[CLEANUP ERROR]', err.message);
  }
}

async function createTestSeller(name, pickupData) {
  try {
    const seller = new User({
      name,
      email: `seller-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.handkraft.com`,
      sellerDisplayName: name,
      sellerPickupAddress: pickupData || {},
    });
    await seller.save();
    TEST_SELLERS.push(seller._id);
    return seller;
  } catch (err) {
    console.error(`[CREATE SELLER ERROR] ${name}:`, err.message);
    throw err;
  }
}

async function runTests() {
  try {
    console.log('\n========== PHASE 1: SELLER PICKUP ADDRESS VALIDATION TESTS ==========\n');

    // Connect to MongoDB
    console.log('[1/5] Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Connected\n');

    // Test 1: Create seller with COMPLETE pickup address
    console.log('[2/5] Creating test seller with COMPLETE pickup address...');
    const sellerComplete = await createTestSeller('Complete Seller', {
      fullName: 'Rahul Kumar',
      phoneNumber: '9876543210',
      street: '123 Main Street',
      city: 'Bangalore',
      state: 'Karnataka',
      postalCode: '560042',
    });
    console.log(`✓ Created: ${sellerComplete._id}\n`);

    // Test 2: Create seller with INCOMPLETE pickup address (missing city & state)
    console.log('[3/5] Creating test seller with INCOMPLETE pickup address...');
    const sellerIncomplete = await createTestSeller('Incomplete Seller', {
      fullName: 'Priya Singh',
      phoneNumber: '8765432109',
      street: '456 Oak Street',
      city: '', // MISSING
      state: '', // MISSING
      postalCode: '560034',
    });
    console.log(`✓ Created: ${sellerIncomplete._id}\n`);

    // Test 3: Create seller with EMPTY pickup address
    console.log('[4/5] Creating test seller with EMPTY pickup address...');
    const sellerEmpty = await createTestSeller('Empty Seller', {});
    console.log(`✓ Created: ${sellerEmpty._id}\n`);

    // Test 4: Run validation tests
    console.log('[5/5] Running validation tests...\n');

    // Test 4a: Validate complete seller
    console.log('TEST 4a: Validate seller with COMPLETE pickup address');
    const resultComplete = await isSellerReadyForShipping(sellerComplete._id);
    console.log(`  isReady: ${resultComplete.isReady}`);
    console.log(`  sellerName: ${resultComplete.sellerName}`);
    console.log(`  missingFields: ${JSON.stringify(resultComplete.missingFields)}`);
    if (resultComplete.isReady && resultComplete.missingFields.length === 0) {
      console.log('  ✓ PASS\n');
    } else {
      console.log('  ✗ FAIL - Expected isReady=true and no missing fields\n');
    }

    // Test 4b: Validate incomplete seller
    console.log('TEST 4b: Validate seller with INCOMPLETE pickup address');
    const resultIncomplete = await isSellerReadyForShipping(sellerIncomplete._id);
    console.log(`  isReady: ${resultIncomplete.isReady}`);
    console.log(`  sellerName: ${resultIncomplete.sellerName}`);
    console.log(`  missingFields: ${JSON.stringify(resultIncomplete.missingFields)}`);
    if (!resultIncomplete.isReady && resultIncomplete.missingFields.length > 0) {
      console.log('  ✓ PASS\n');
    } else {
      console.log('  ✗ FAIL - Expected isReady=false and missing fields\n');
    }

    // Test 4c: Validate empty seller
    console.log('TEST 4c: Validate seller with EMPTY pickup address');
    const resultEmpty = await isSellerReadyForShipping(sellerEmpty._id);
    console.log(`  isReady: ${resultEmpty.isReady}`);
    console.log(`  sellerName: ${resultEmpty.sellerName}`);
    console.log(`  missingFields: ${JSON.stringify(resultEmpty.missingFields)}`);
    if (!resultEmpty.isReady && resultEmpty.missingFields.length === 6) {
      console.log('  ✓ PASS\n');
    } else {
      console.log('  ✗ FAIL - Expected isReady=false and 6 missing fields\n');
    }

    // Test 4d: Validate multiple sellers
    console.log('TEST 4d: Validate MULTIPLE sellers at once');
    const multiResult = await validateOrderSellers([
      sellerComplete._id,
      sellerIncomplete._id,
      sellerEmpty._id,
    ]);
    console.log(`  allReady: ${multiResult.allReady}`);
    console.log(`  totalSellers: ${multiResult.results.length}`);
    console.log(`  unreadySellers: ${multiResult.unreadySellers.length}`);
    console.log(`  message: ${multiResult.message}`);
    if (!multiResult.allReady && multiResult.unreadySellers.length === 2) {
      console.log('  ✓ PASS\n');
    } else {
      console.log('  ✗ FAIL - Expected allReady=false and 2 unready sellers\n');
    }

    // Test 4e: Invalid pincode (non-numeric)
    console.log('TEST 4e: Validate seller with INVALID pincode');
    const sellerInvalidPin = await createTestSeller('Invalid Pincode Seller', {
      fullName: 'Test User',
      phoneNumber: '9876543210',
      street: 'Test Street',
      city: 'Test City',
      state: 'Test State',
      postalCode: 'ABCDEF', // Invalid - not numeric
    });
    const resultInvalidPin = await isSellerReadyForShipping(sellerInvalidPin._id);
    console.log(`  isReady: ${resultInvalidPin.isReady}`);
    console.log(`  missingFields: ${JSON.stringify(resultInvalidPin.missingFields)}`);
    if (!resultInvalidPin.isReady && resultInvalidPin.missingFields.includes('postalCode (must be 6-digit number)')) {
      console.log('  ✓ PASS\n');
    } else {
      console.log('  ✗ FAIL - Expected pincode validation to fail\n');
    }

    console.log('========== ALL TESTS COMPLETED ==========\n');

  } catch (err) {
    console.error('[TEST ERROR]', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    // Cleanup
    await cleanup();
    await mongoose.disconnect();
    console.log('[INFO] Disconnected from MongoDB\n');
  }
}

runTests().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
