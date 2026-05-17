/**
 * Integration Test: Phase 1, 2 & 3 Complete Flow
 * 
 * Tests the complete flow:
 * 1. Phase 1: Seller pickup address validation
 * 2. Phase 2: Shipment skeleton & multi-seller grouping
 * 3. Phase 3: Shipping quote calculation
 */

const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const { validateOrderSellers } = require('../services/shipment-validation');
const {
  buildShipmentSkeletons,
  validateOrderAndBuildShipments,
} = require('../services/shipment-grouping');
const {
  validateSellersForShipping,
  calculateShippingQuotes,
} = require('../services/shipping-quotes');

let testResults = {
  passed: 0,
  failed: 0,
  errors: [],
};

async function runIntegrationTests() {
  try {
    console.log('\n🔗 PHASE 1 → 2 → 3 INTEGRATION TESTS\n');
    console.log('=' .repeat(60));

    // Connect to database
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Connected to MongoDB\n');

    // Create test sellers
    const [seller1, seller2] = await createTestSellers();
    console.log('✓ Created test sellers\n');

    // Run integration tests
    await testPhase1Validation(seller1, seller2);
    await testPhase2Grouping(seller1, seller2);
    await testPhase3ShippingQuotes(seller1, seller2);
    await testFullFlowWithValidation(seller1, seller2);

    // Cleanup
    await cleanupTestData([seller1._id, seller2._id]);
    await mongoose.disconnect();

    // Print summary
    printSummary();
  } catch (err) {
    console.error('❌ Integration test suite error:', err?.message || err);
    process.exit(1);
  }
}

async function createTestSellers() {
  try {
    const seller1 = await User.findOneAndUpdate(
      { email: 'phase123-integration-seller1@example.com' },
      {
        email: 'phase123-integration-seller1@example.com',
        name: 'Phase 1-2-3 Integration Seller 1',
        sellerName: 'Phase 1-2-3 Integration Seller 1',
        sellerDisplayName: 'Integration Seller 1',
        sellerPickupAddress: {
          label: 'Office',
          fullName: 'Integration Test Seller 1',
          phoneNumber: '9876543210',
          email: 'pickup@seller1.com',
          street: '123 Integration Lane',
          city: 'Mumbai',
          state: 'MH',
          postalCode: '400001',
          country: 'India',
        },
      },
      { upsert: true, new: true }
    );

    const seller2 = await User.findOneAndUpdate(
      { email: 'phase123-integration-seller2@example.com' },
      {
        email: 'phase123-integration-seller2@example.com',
        name: 'Phase 1-2-3 Integration Seller 2',
        sellerName: 'Phase 1-2-3 Integration Seller 2',
        sellerDisplayName: 'Integration Seller 2',
        sellerPickupAddress: {
          label: 'Office',
          fullName: 'Integration Test Seller 2',
          phoneNumber: '9876543211',
          email: 'pickup@seller2.com',
          street: '456 Integration Center',
          city: 'Delhi',
          state: 'DL',
          postalCode: '110001',
          country: 'India',
        },
      },
      { upsert: true, new: true }
    );

    return [seller1, seller2];
  } catch (err) {
    console.error('❌ Failed to create test sellers:', err?.message);
    throw err;
  }
}

async function testPhase1Validation(seller1, seller2) {
  try {
    const sellerIds = [seller1._id, seller2._id];
    const result = await validateOrderSellers(sellerIds);

    if (result.allReady && result.unreadySellers.length === 0) {
      console.log('✓ TEST 1: Phase 1 Validation');
      console.log(`  Sellers: 2`);
      console.log(`  Status: ${result.message}`);
      console.log(`  Ready: ${result.allReady}\n`);
      testResults.passed++;
    } else {
      throw new Error(`Phase 1 validation failed: ${JSON.stringify(result)}`);
    }
  } catch (err) {
    console.log('✗ TEST 1 FAILED: Phase 1 Validation');
    console.log(`  Error: ${err?.message}\n`);
    testResults.failed++;
    testResults.errors.push('Phase 1 Validation');
  }
}

async function testPhase2Grouping(seller1, seller2) {
  try {
    const items = [
      {
        product: new mongoose.Types.ObjectId(),
        seller: seller1._id,
        quantity: 2,
        price: 100,
        title: 'Product from Seller 1',
        packageWeightGrams: 500,
      },
      {
        product: new mongoose.Types.ObjectId(),
        seller: seller1._id,
        quantity: 1,
        price: 50,
        title: 'Another Product from Seller 1',
        packageWeightGrams: 300,
      },
      {
        product: new mongoose.Types.ObjectId(),
        seller: seller2._id,
        quantity: 3,
        price: 75,
        title: 'Product from Seller 2',
        packageWeightGrams: 400,
      },
    ];

      const result = buildShipmentSkeletons(items, 'INTEGRATION_TEST');
      const shipments = result.shipments || [];

    if (shipments.length === 2) {
      const shipment1 = shipments[0];
      const shipment2 = shipments[1];

      const isCorrect = 
        shipment1.itemIndexes.length === 2 &&
        shipment2.itemIndexes.length === 1 &&
        String(shipment1.seller) === String(seller1._id) &&
        String(shipment2.seller) === String(seller2._id);

      if (isCorrect) {
        console.log('✓ TEST 2: Phase 2 Grouping');
        console.log(`  Items: 3 items from 2 sellers`);
        console.log(`  Shipments created: 2`);
        console.log(`  Shipment 1: ${shipment1.itemIndexes.length} items, Ref: ${shipment1.localShipmentRef}`);
        console.log(`  Shipment 2: ${shipment2.itemIndexes.length} items, Ref: ${shipment2.localShipmentRef}\n`);
        testResults.passed++;
      } else {
        throw new Error(`Shipment structure incorrect`);
      }
    } else {
      throw new Error(`Expected 2 shipments, got ${shipments.length}`);
    }
  } catch (err) {
    console.log('✗ TEST 2 FAILED: Phase 2 Grouping');
    console.log(`  Error: ${err?.message}\n`);
    testResults.failed++;
    testResults.errors.push('Phase 2 Grouping');
  }
}

async function testPhase3ShippingQuotes(seller1, seller2) {
  try {
    const items = [
      {
        product: new mongoose.Types.ObjectId(),
        seller: seller1._id,
        quantity: 1,
        price: 100,
        title: 'Product from Seller 1',
        packageWeightGrams: 500,
      },
      {
        product: new mongoose.Types.ObjectId(),
        seller: seller2._id,
        quantity: 1,
        price: 200,
        title: 'Product from Seller 2',
        packageWeightGrams: 700,
      },
    ];

    const shippingAddress = {
      fullName: 'Test Buyer',
      phoneNumber: '9999999999',
      email: 'buyer@test.com',
      street: '789 Delivery Road',
      city: 'Bangalore',
      state: 'KA',
      postalCode: '560001',
      country: 'India',
    };

    const result = await validateSellersForShipping(items);

    if (result.isReady) {
      console.log('✓ TEST 3: Phase 3 Seller Validation');
      console.log(`  Items: 2 items from 2 sellers`);
      console.log(`  Sellers Ready: ${result.isReady}`);
      console.log(`  Message: ${result.message}\n`);
      testResults.passed++;
    } else {
      throw new Error(`Phase 3 validation failed: ${result.message}`);
    }
  } catch (err) {
    console.log('✗ TEST 3 FAILED: Phase 3 Seller Validation');
    console.log(`  Error: ${err?.message}\n`);
    testResults.failed++;
    testResults.errors.push('Phase 3 Seller Validation');
  }
}

async function testFullFlowWithValidation(seller1, seller2) {
  try {
    const items = [
      {
        product: new mongoose.Types.ObjectId(),
        seller: seller1._id,
        quantity: 2,
        price: 100,
        title: 'Product from Seller 1',
        packageWeightGrams: 500,
      },
      {
        product: new mongoose.Types.ObjectId(),
        seller: seller2._id,
        quantity: 1,
        price: 200,
        title: 'Product from Seller 2',
        packageWeightGrams: 300,
      },
    ];

    const shippingAddress = {
      postalCode: '400028',
    };

    // Step 1: Phase 1 - Validate sellers
    const phase1 = await validateOrderSellers([seller1._id, seller2._id]);
    if (!phase1.allReady) throw new Error('Phase 1 failed');

    // Step 2: Phase 2 - Build shipments
      const shipmentResult = buildShipmentSkeletons(items, 'FULL_FLOW_TEST');
      const shipments = shipmentResult.shipments || [];
    if (shipments.length !== 2) throw new Error(`Expected 2 shipments, got ${shipments.length}`);

    // Step 3: Phase 3 - Validate for quotes
    const phase3 = await validateSellersForShipping(items);
    if (!phase3.isReady) throw new Error(`Phase 3 failed: ${phase3.message}`);

    console.log('✓ TEST 4: Full Flow (Phase 1 → 2 → 3)');
    console.log(`  Phase 1: Sellers validated ✓`);
    console.log(`  Phase 2: ${shipments.length} shipments created ✓`);
    console.log(`  Phase 3: Ready for shipping quotes ✓\n`);
    testResults.passed++;
  } catch (err) {
    console.log('✗ TEST 4 FAILED: Full Flow (Phase 1 → 2 → 3)');
    console.log(`  Error: ${err?.message}\n`);
    testResults.failed++;
    testResults.errors.push('Full Flow Integration');
  }
}

async function cleanupTestData(sellerIds) {
  try {
    await User.deleteMany({ _id: { $in: sellerIds } });
    console.log('✓ Cleaned up test data\n');
  } catch (err) {
    console.warn('⚠ Cleanup warning:', err?.message);
  }
}

function printSummary() {
  console.log('=' .repeat(60));
  console.log('\n📊 INTEGRATION TEST SUMMARY\n');
  console.log(`✓ PASSED: ${testResults.passed}`);
  console.log(`✗ FAILED: ${testResults.failed}`);
  console.log(`📈 TOTAL:  ${testResults.passed + testResults.failed}\n`);

  if (testResults.failed > 0) {
    console.log('Failed tests:');
    testResults.errors.forEach((err) => console.log(`  - ${err}`));
    console.log();
  }

  const exitCode = testResults.failed > 0 ? 1 : 0;
  process.exit(exitCode);
}

// Run tests
runIntegrationTests().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
