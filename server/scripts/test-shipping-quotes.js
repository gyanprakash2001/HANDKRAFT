/**
 * Unit Tests: Shipping Quotes Service (Phase 3)
 * 
 * Tests integration of Phase 1 (seller validation) & Phase 2 (shipment grouping)
 * with NimbusPost shipping quote calculation.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const {
  calculateShippingQuotes,
  validateSellersForShipping,
  getUniqueSellersFromItems,
} = require('../services/shipping-quotes');

let testResults = {
  passed: 0,
  failed: 0,
  errors: [],
};

async function runTests() {
  try {
    console.log('\n📦 SHIPPING QUOTES SERVICE TESTS (Phase 3)\n');
    console.log('=' .repeat(60));

    // Connect to database
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Connected to MongoDB\n');

    // Create test sellers
    const [seller1, seller2, seller3] = await createTestSellers();
    console.log('✓ Created test sellers\n');

    // Run tests
    await testGetUniqueSellersFromItems(seller1, seller2);
    await testValidateSellersForShippingWithCompleteSellers(seller1, seller2);
    await testValidateSellersForShippingWithIncompleteSellers(seller3);
    await testValidateSellersForShippingWithEmptyItems();
    await testValidateSellersForShippingWithMixedStatus(seller1, seller3);
    await testCalculateShippingQuotesWithEmptyItems();
    await testCalculateShippingQuotesWithNullPincode();
    await testGetUniqueSellersFromItemsWithNullSellers();

    // Cleanup
    await cleanupTestData([seller1._id, seller2._id, seller3._id]);
    await mongoose.disconnect();

    // Print summary
    printSummary();
  } catch (err) {
    console.error('❌ Test suite error:', err?.message || err);
    process.exit(1);
  }
}

async function createTestSellers() {
  try {
    const seller1 = await User.findOneAndUpdate(
      { email: 'phase3-test-seller-complete@example.com' },
      {
        email: 'phase3-test-seller-complete@example.com',
        name: 'Phase 3 Test Seller 1 Complete',
        sellerName: 'Phase 3 Test Seller 1 Complete',
        sellerDisplayName: 'Test Seller 1 Complete',
        sellerPickupAddress: {
          label: 'Office',
          fullName: 'Complete Seller 1',
          phoneNumber: '9876543210',
          email: 'pickup@seller1.com',
          street: '123 Warehouse Lane',
          city: 'Mumbai',
          state: 'MH',
          postalCode: '400001',
          country: 'India',
        },
      },
      { upsert: true, new: true }
    );

    const seller2 = await User.findOneAndUpdate(
      { email: 'phase3-test-seller-complete-2@example.com' },
      {
        email: 'phase3-test-seller-complete-2@example.com',
        name: 'Phase 3 Test Seller 2 Complete',
        sellerName: 'Phase 3 Test Seller 2 Complete',
        sellerDisplayName: 'Test Seller 2 Complete',
        sellerPickupAddress: {
          label: 'Office',
          fullName: 'Complete Seller 2',
          phoneNumber: '9876543211',
          email: 'pickup@seller2.com',
          street: '456 Distribution Center',
          city: 'Delhi',
          state: 'DL',
          postalCode: '110001',
          country: 'India',
        },
      },
      { upsert: true, new: true }
    );

    const seller3 = await User.findOneAndUpdate(
      { email: 'phase3-test-seller-incomplete@example.com' },
      {
        email: 'phase3-test-seller-incomplete@example.com',
        name: 'Phase 3 Test Seller 3 Incomplete',
        sellerName: 'Phase 3 Test Seller 3 Incomplete',
        sellerDisplayName: 'Test Seller 3 Incomplete',
        sellerPickupAddress: {
          label: 'Office',
          fullName: 'Incomplete Seller',
          phoneNumber: '',
          email: '',
          street: '',
          city: '',
          state: '',
          postalCode: '',
          country: 'India',
        },
      },
      { upsert: true, new: true }
    );

    return [seller1, seller2, seller3];
  } catch (err) {
    console.error('❌ Failed to create test sellers:', err?.message);
    throw err;
  }
}

async function testGetUniqueSellersFromItems(seller1, seller2) {
  try {
    const items = [
      { seller: seller1._id, quantity: 2 },
      { seller: seller1._id, quantity: 1 },
      { seller: seller2._id, quantity: 3 },
    ];

    const result = getUniqueSellersFromItems(items);
    const isCorrect = result.length === 2 &&
      String(result[0]) === String(seller1._id) &&
      String(result[1]) === String(seller2._id);

    if (isCorrect) {
      console.log('✓ TEST 1: Get unique sellers from items');
      console.log('  Items: 3 items from 2 sellers');
      console.log(`  Result: ${result.length} unique sellers\n`);
      testResults.passed++;
    } else {
      throw new Error(`Expected 2 sellers, got ${result.length}`);
    }
  } catch (err) {
    console.log('✗ TEST 1 FAILED: Get unique sellers from items');
    console.log(`  Error: ${err?.message}\n`);
    testResults.failed++;
    testResults.errors.push('Get unique sellers from items');
  }
}

async function testValidateSellersForShippingWithCompleteSellers(seller1, seller2) {
  try {
    const items = [
      { seller: seller1._id, quantity: 2 },
      { seller: seller2._id, quantity: 1 },
    ];

    const result = await validateSellersForShipping(items);

    if (result.isReady && result.unreadySellers.length === 0) {
      console.log('✓ TEST 2: Validate sellers with complete addresses');
      console.log(`  Sellers: 2`);
      console.log(`  Message: ${result.message}\n`);
      testResults.passed++;
    } else {
      throw new Error(`Expected all ready, got: ${JSON.stringify(result)}`);
    }
  } catch (err) {
    console.log('✗ TEST 2 FAILED: Validate sellers with complete addresses');
    console.log(`  Error: ${err?.message}\n`);
    testResults.failed++;
    testResults.errors.push('Validate sellers with complete addresses');
  }
}

async function testValidateSellersForShippingWithIncompleteSellers(seller3) {
  try {
    const items = [
      { seller: seller3._id, quantity: 1 },
    ];

    const result = await validateSellersForShipping(items);

    if (!result.isReady && result.unreadySellers.length > 0) {
      console.log('✓ TEST 3: Validate sellers with incomplete addresses');
      console.log(`  Sellers: 1 incomplete`);
      console.log(`  Message: ${result.message}`);
      console.log(`  Unready sellers: ${result.unreadySellers.length}\n`);
      testResults.passed++;
    } else {
      throw new Error(`Expected validation to fail`);
    }
  } catch (err) {
    console.log('✗ TEST 3 FAILED: Validate sellers with incomplete addresses');
    console.log(`  Error: ${err?.message}\n`);
    testResults.failed++;
    testResults.errors.push('Validate sellers with incomplete addresses');
  }
}

async function testValidateSellersForShippingWithEmptyItems() {
  try {
    const items = [];

    const result = await validateSellersForShipping(items);

    if (!result.isReady && result.message.includes('No sellers')) {
      console.log('✓ TEST 4: Validate empty items list');
      console.log(`  Items: 0`);
      console.log(`  Message: ${result.message}\n`);
      testResults.passed++;
    } else {
      throw new Error(`Expected empty items validation to fail`);
    }
  } catch (err) {
    console.log('✗ TEST 4 FAILED: Validate empty items list');
    console.log(`  Error: ${err?.message}\n`);
    testResults.failed++;
    testResults.errors.push('Validate empty items list');
  }
}

async function testValidateSellersForShippingWithMixedStatus(seller1, seller3) {
  try {
    const items = [
      { seller: seller1._id, quantity: 1 },
      { seller: seller3._id, quantity: 1 },
    ];

    const result = await validateSellersForShipping(items);

    if (!result.isReady && result.unreadySellers.length === 1) {
      console.log('✓ TEST 5: Validate mixed seller status (1 complete, 1 incomplete)');
      console.log(`  Sellers: 2 (1 complete, 1 incomplete)`);
      console.log(`  Unready: ${result.unreadySellers.length}`);
      console.log(`  Message: ${result.message}\n`);
      testResults.passed++;
    } else {
      throw new Error(`Expected 1 unready seller`);
    }
  } catch (err) {
    console.log('✗ TEST 5 FAILED: Validate mixed seller status');
    console.log(`  Error: ${err?.message}\n`);
    testResults.failed++;
    testResults.errors.push('Validate mixed seller status');
  }
}

async function testCalculateShippingQuotesWithEmptyItems() {
  try {
    const result = await calculateShippingQuotes({
      items: [],
      shippingAddress: { postalCode: '400028' },
    });

    if (!result.success && result.message.includes('No items')) {
      console.log('✓ TEST 6: Calculate quotes with empty items');
      console.log(`  Items: 0`);
      console.log(`  Success: ${result.success}`);
      console.log(`  Message: ${result.message}\n`);
      testResults.passed++;
    } else {
      throw new Error(`Expected quote calculation to fail`);
    }
  } catch (err) {
    console.log('✗ TEST 6 FAILED: Calculate quotes with empty items');
    console.log(`  Error: ${err?.message}\n`);
    testResults.failed++;
    testResults.errors.push('Calculate quotes with empty items');
  }
}

async function testCalculateShippingQuotesWithNullPincode() {
  try {
    const result = await calculateShippingQuotes({
      items: [{ seller: new mongoose.Types.ObjectId(), quantity: 1 }],
      shippingAddress: {},
    });

    if (!result.success && result.message.includes('pincode')) {
      console.log('✓ TEST 7: Calculate quotes with missing pincode');
      console.log(`  Pincode: missing`);
      console.log(`  Success: ${result.success}`);
      console.log(`  Message: ${result.message}\n`);
      testResults.passed++;
    } else {
      throw new Error(`Expected validation to fail for missing pincode`);
    }
  } catch (err) {
    console.log('✗ TEST 7 FAILED: Calculate quotes with missing pincode');
    console.log(`  Error: ${err?.message}\n`);
    testResults.failed++;
    testResults.errors.push('Calculate quotes with missing pincode');
  }
}

async function testGetUniqueSellersFromItemsWithNullSellers() {
  try {
    const items = [
      { seller: new mongoose.Types.ObjectId(), quantity: 1 },
      { seller: null, quantity: 1 },
      { seller: undefined, quantity: 1 },
      { seller: 'invalid', quantity: 1 },
    ];

    const result = getUniqueSellersFromItems(items);

    if (result.length === 1) {
      console.log('✓ TEST 8: Get unique sellers filtering null/invalid sellers');
      console.log(`  Items with null/invalid sellers: 4`);
      console.log(`  Valid sellers found: ${result.length}\n`);
      testResults.passed++;
    } else {
      throw new Error(`Expected 1 valid seller, got ${result.length}`);
    }
  } catch (err) {
    console.log('✗ TEST 8 FAILED: Get unique sellers filtering null/invalid');
    console.log(`  Error: ${err?.message}\n`);
    testResults.failed++;
    testResults.errors.push('Get unique sellers filtering null/invalid');
  }
}

async function cleanupTestData(sellerIds) {
  try {
    await User.deleteMany({ _id: { $in: sellerIds } });
    console.log('✓ Cleaned up test sellers\n');
  } catch (err) {
    console.warn('⚠ Cleanup warning:', err?.message);
  }
}

function printSummary() {
  console.log('=' .repeat(60));
  console.log('\n📊 TEST SUMMARY\n');
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
runTests().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
