#!/usr/bin/env node

/**
 * Test script for Phase 2: Shipment Skeleton & Multi-Seller Grouping
 * Tests the shipment-grouping service
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Product = require('../models/Product');
const {
  groupItemsBySeller,
  validateItemsSellers,
  validateSellersExist,
  buildShipmentSkeletons,
  validateOrderAndBuildShipments,
  getShipmentsSummary,
} = require('../services/shipment-grouping');

const TEST_DATA = {
  sellers: [],
  products: [],
};

async function cleanup() {
  try {
    if (TEST_DATA.sellers.length > 0) {
      await User.deleteMany({ _id: { $in: TEST_DATA.sellers } });
      console.log(`[CLEANUP] Deleted ${TEST_DATA.sellers.length} test sellers`);
    }
    if (TEST_DATA.products.length > 0) {
      await Product.deleteMany({ _id: { $in: TEST_DATA.products } });
      console.log(`[CLEANUP] Deleted ${TEST_DATA.products.length} test products`);
    }
  } catch (err) {
    console.error('[CLEANUP ERROR]', err.message);
  }
}

async function createTestSellers(count = 2) {
  const sellers = [];
  for (let i = 0; i < count; i++) {
    const seller = new User({
      name: `Test Seller ${i + 1}`,
      email: `seller-${i}-${Date.now()}@test.handkraft.com`,
      sellerDisplayName: `Test Seller ${i + 1}`,
    });
    await seller.save();
    TEST_DATA.sellers.push(seller._id);
    sellers.push(seller);
  }
  return sellers;
}

async function createTestProducts(sellers) {
  const products = [];
  for (const seller of sellers) {
    for (let i = 0; i < 2; i++) {
      const product = new Product({
        title: `Product from ${seller.name} - Item ${i + 1}`,
        price: 500 + i * 100,
        category: 'Test',
        seller: seller._id,
      });
      await product.save();
      TEST_DATA.products.push(product._id);
      products.push(product);
    }
  }
  return products;
}

function createOrderItems(products) {
  return products.map((product, index) => ({
    product: product._id,
    seller: product.seller,
    quantity: 1,
    price: product.price,
    title: product.title,
    image: '',
    packageWeightGrams: 500,
    packageLengthCm: 10,
    packageBreadthCm: 10,
    packageHeightCm: 10,
    fulfillmentStatus: 'new',
    trackingEvents: [],
  }));
}

async function runTests() {
  try {
    console.log('\n========== PHASE 2: SHIPMENT SKELETON & MULTI-SELLER GROUPING TESTS ==========\n');

    // Connect to MongoDB
    console.log('[1/7] Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Connected\n');

    // Create test data
    console.log('[2/7] Creating test sellers and products...');
    const sellers = await createTestSellers(2);
    const products = await createTestProducts(sellers);
    const orderItems = createOrderItems(products);
    console.log(`✓ Created ${sellers.length} sellers and ${products.length} products\n`);

    // Test 1: Group items by seller
    console.log('[3/7] TEST 1: groupItemsBySeller');
    const grouped = groupItemsBySeller(orderItems);
    console.log(`  Total groups: ${grouped.size}`);
    const groupsArray = Array.from(grouped.values());
    console.log(`  Items per group: ${groupsArray.map((g) => g.itemIndexes.length).join(', ')}`);
    if (grouped.size === 2 && groupsArray.every((g) => g.itemIndexes.length === 2)) {
      console.log('  ✓ PASS\n');
    } else {
      console.log('  ✗ FAIL - Expected 2 groups with 2 items each\n');
    }

    // Test 2: Validate items with sellers
    console.log('[4/7] TEST 2: validateItemsSellers');
    const validationWithSellers = validateItemsSellers(orderItems);
    console.log(`  isValid: ${validationWithSellers.isValid}`);
    console.log(`  missingSellerIndices: ${JSON.stringify(validationWithSellers.missingSellerIndices)}`);
    if (validationWithSellers.isValid && validationWithSellers.missingSellerIndices.length === 0) {
      console.log('  ✓ PASS\n');
    } else {
      console.log('  ✗ FAIL\n');
    }

    // Test 3: Detect missing sellers
    console.log('[5/7] TEST 3: validateItemsSellers with NULL sellers');
    const itemsWithoutSeller = [
      ...orderItems.slice(0, 2),
      { ...orderItems[2], seller: null },
    ];
    const validationMissing = validateItemsSellers(itemsWithoutSeller);
    console.log(`  isValid: ${validationMissing.isValid}`);
    console.log(`  missingSellerIndices: ${JSON.stringify(validationMissing.missingSellerIndices)}`);
    if (!validationMissing.isValid && validationMissing.missingSellerIndices.length === 1) {
      console.log('  ✓ PASS\n');
    } else {
      console.log('  ✗ FAIL\n');
    }

    // Test 4: Validate sellers exist
    console.log('[6/7] TEST 4: validateSellersExist');
    const sellerValidation = await validateSellersExist(orderItems);
    console.log(`  isValid: ${sellerValidation.isValid}`);
    console.log(`  totalSellers: ${sellerValidation.totalSellers}`);
    console.log(`  sellerIds: ${sellerValidation.sellerIds.length}`);
    if (sellerValidation.isValid && sellerValidation.totalSellers === 2) {
      console.log('  ✓ PASS\n');
    } else {
      console.log('  ✗ FAIL\n');
    }

    // Test 5: Build shipment skeletons
    console.log('[7/7] TEST 5: buildShipmentSkeletons');
    const skeletonsResult = buildShipmentSkeletons(orderItems, 'testorder123');
    console.log(`  isValid: ${skeletonsResult.isValid}`);
    console.log(`  totalShipments: ${skeletonsResult.shipments.length}`);
    console.log(`  errors: ${skeletonsResult.errors.length}`);
    
    if (skeletonsResult.shipments.length > 0) {
      const shipment1 = skeletonsResult.shipments[0];
      console.log(`  Shipment 1 ref: ${shipment1.localShipmentRef}`);
      console.log(`  Shipment 1 itemIndexes: ${JSON.stringify(shipment1.itemIndexes)}`);
      console.log(`  Shipment 1 status: ${shipment1.status}`);
    }
    
    if (skeletonsResult.isValid && skeletonsResult.shipments.length === 2) {
      console.log('  ✓ PASS\n');
    } else {
      console.log('  ✗ FAIL\n');
    }

    // Test 6: Full order validation and shipment building
    console.log('[8/7] TEST 6: validateOrderAndBuildShipments');
    const fullValidation = await validateOrderAndBuildShipments(orderItems, 'fulltest456');
    console.log(`  isValid: ${fullValidation.isValid}`);
    console.log(`  errors: ${fullValidation.errors.length}`);
    console.log(`  warnings: ${fullValidation.warnings.length}`);
    console.log(`  shipments: ${fullValidation.shipments.length}`);
    
    if (fullValidation.shipments.length > 0) {
      const summary = getShipmentsSummary(fullValidation.shipments);
      console.log(`  Summary:
    - Total Shipments: ${summary.totalShipments}
    - Successful: ${summary.successfulShipments}
    - Failed: ${summary.failedShipments}
    - Total Items: ${summary.totalItems}
    - Ready: ${summary.isReady}`);
    }
    
    if (fullValidation.isValid && fullValidation.shipments.length === 2) {
      console.log('  ✓ PASS\n');
    } else {
      console.log('  ✗ FAIL\n');
    }

    // Test 7: Edge case - all items from same seller
    console.log('[9/7] TEST 7: All items from SINGLE seller');
    const singleSellerItems = orderItems.filter((item) => String(item.seller) === String(sellers[0]._id));
    const singleSellerResult = buildShipmentSkeletons(singleSellerItems, 'singletest');
    console.log(`  totalShipments: ${singleSellerResult.shipments.length}`);
    if (singleSellerResult.shipments.length === 1) {
      console.log('  ✓ PASS\n');
    } else {
      console.log('  ✗ FAIL\n');
    }

    // Test 8: Reject order with null sellers
    console.log('[10/7] TEST 8: Reject order with NULL sellers');
    const invalidResult = await validateOrderAndBuildShipments(itemsWithoutSeller, 'invalidtest');
    console.log(`  isValid: ${invalidResult.isValid}`);
    console.log(`  errors: ${invalidResult.errors.length}`);
    if (!invalidResult.isValid && invalidResult.errors.length > 0) {
      console.log('  ✓ PASS\n');
    } else {
      console.log('  ✗ FAIL\n');
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
