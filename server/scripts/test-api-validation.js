#!/usr/bin/env node

/**
 * API Test for Phase 1: Seller Pickup Address Validation
 * Tests the POST /api/orders/validate-sellers endpoint
 */

require('dotenv').config();
const mongoose = require('mongoose');
const express = require('express');
const User = require('../models/User');
const router = require('../routes/orders');

const TEST_DATA = {
  sellers: [],
  testUserId: null,
};

async function cleanup() {
  try {
    if (TEST_DATA.sellers.length > 0) {
      await User.deleteMany({ _id: { $in: TEST_DATA.sellers } });
      console.log(`[CLEANUP] Deleted ${TEST_DATA.sellers.length} test sellers`);
    }
  } catch (err) {
    console.error('[CLEANUP ERROR]', err.message);
  }
}

async function createTestData() {
  try {
    // Create test sellers
    const sellerComplete = new User({
      name: 'Complete Seller',
      email: `seller-complete-${Date.now()}@test.handkraft.com`,
      sellerDisplayName: 'Complete Seller',
      sellerPickupAddress: {
        fullName: 'Rahul Kumar',
        phoneNumber: '9876543210',
        street: '123 Main Street',
        city: 'Bangalore',
        state: 'Karnataka',
        postalCode: '560042',
      },
    });
    await sellerComplete.save();
    TEST_DATA.sellers.push(sellerComplete._id);

    const sellerIncomplete = new User({
      name: 'Incomplete Seller',
      email: `seller-incomplete-${Date.now()}@test.handkraft.com`,
      sellerDisplayName: 'Incomplete Seller',
      sellerPickupAddress: {
        fullName: 'Priya Singh',
        phoneNumber: '8765432109',
        street: '456 Oak Street',
        // Missing city and state
        postalCode: '560034',
      },
    });
    await sellerIncomplete.save();
    TEST_DATA.sellers.push(sellerIncomplete._id);

    // Create a test buyer/user
    const testUser = new User({
      name: 'Test Buyer',
      email: `buyer-${Date.now()}@test.handkraft.com`,
    });
    await testUser.save();
    TEST_DATA.testUserId = testUser._id;

    console.log(`✓ Created ${TEST_DATA.sellers.length} test sellers`);
    console.log(`✓ Created test user: ${TEST_DATA.testUserId}\n`);

    return {
      sellerCompleteId: String(sellerComplete._id),
      sellerIncompleteId: String(sellerIncomplete._id),
      testUserId: String(testUser._id),
    };
  } catch (err) {
    console.error('[CREATE TEST DATA ERROR]', err.message);
    throw err;
  }
}

async function runApiTests(testIds) {
  try {
    console.log('\n========== API ENDPOINT TESTS ==========\n');

    // Create Express app for testing
    const app = express();
    app.use(express.json());

    // Mock auth middleware
    app.use((req, res, next) => {
      req.user = { _id: testIds.testUserId };
      next();
    });

    // Mount the orders router
    app.use('/api/orders', router);

    // Create test server
    const server = app.listen(0, '127.0.0.1', async () => {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}/api/orders`;

      console.log(`[TEST SERVER] Started on ${baseUrl}\n`);

      try {
        // Test 1: Valid request with complete seller
        console.log('TEST 1: Validate COMPLETE seller');
        const req1 = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        };
        const res1 = await new Promise((resolve) => {
          const mockRes = {
            status: (code) => ({
              json: (data) => {
                resolve({ statusCode: code, body: data });
              },
            }),
            json: (data) => {
              resolve({ statusCode: 200, body: data });
            },
          };
          const mockReq = {
            user: req1.user,
            body: { sellerIds: [testIds.sellerCompleteId] },
            method: 'POST',
          };
          router.stack
            .find((layer) => layer.route && layer.route.path === '/validate-sellers')
            .route.stack.find((layer) => layer.name === 'async')
            .handle(mockReq, mockRes);
        });
        console.log(`  Status: ${res1.statusCode}`);
        console.log(`  Success: ${res1.body.success}`);
        console.log(`  AllReady: ${res1.body.allReady}`);
        console.log(`  UnreadySellers: ${res1.body.unreadySellers.length}`);
        if (res1.body.success && res1.body.allReady && res1.body.unreadySellers.length === 0) {
          console.log('  ✓ PASS\n');
        } else {
          console.log('  ✗ FAIL\n');
        }

        // Test 2: Validate INCOMPLETE seller
        console.log('TEST 2: Validate INCOMPLETE seller');
        const res2 = await new Promise((resolve) => {
          const mockRes = {
            status: (code) => ({
              json: (data) => {
                resolve({ statusCode: code, body: data });
              },
            }),
            json: (data) => {
              resolve({ statusCode: 200, body: data });
            },
          };
          const mockReq = {
            user: req1.user,
            body: { sellerIds: [testIds.sellerIncompleteId] },
            method: 'POST',
          };
          router.stack
            .find((layer) => layer.route && layer.route.path === '/validate-sellers')
            .route.stack.find((layer) => layer.name === 'async')
            .handle(mockReq, mockRes);
        });
        console.log(`  Status: ${res2.statusCode}`);
        console.log(`  Success: ${res2.body.success}`);
        console.log(`  AllReady: ${res2.body.allReady}`);
        console.log(`  UnreadySellers: ${res2.body.unreadySellers.length}`);
        if (!res2.body.success && !res2.body.allReady && res2.body.unreadySellers.length === 1) {
          console.log('  ✓ PASS\n');
        } else {
          console.log('  ✗ FAIL\n');
        }

        // Test 3: Validate MULTIPLE sellers
        console.log('TEST 3: Validate MULTIPLE sellers');
        const res3 = await new Promise((resolve) => {
          const mockRes = {
            status: (code) => ({
              json: (data) => {
                resolve({ statusCode: code, body: data });
              },
            }),
            json: (data) => {
              resolve({ statusCode: 200, body: data });
            },
          };
          const mockReq = {
            user: req1.user,
            body: {
              sellerIds: [testIds.sellerCompleteId, testIds.sellerIncompleteId],
            },
            method: 'POST',
          };
          router.stack
            .find((layer) => layer.route && layer.route.path === '/validate-sellers')
            .route.stack.find((layer) => layer.name === 'async')
            .handle(mockReq, mockRes);
        });
        console.log(`  Status: ${res3.statusCode}`);
        console.log(`  Success: ${res3.body.success}`);
        console.log(`  AllReady: ${res3.body.allReady}`);
        console.log(`  Total Validations: ${res3.body.validations.length}`);
        console.log(`  UnreadySellers: ${res3.body.unreadySellers.length}`);
        if (
          !res3.body.success &&
          !res3.body.allReady &&
          res3.body.validations.length === 2 &&
          res3.body.unreadySellers.length === 1
        ) {
          console.log('  ✓ PASS\n');
        } else {
          console.log('  ✗ FAIL\n');
        }

        // Test 4: Missing sellerIds
        console.log('TEST 4: Request with MISSING sellerIds');
        const res4 = await new Promise((resolve) => {
          const mockRes = {
            status: (code) => ({
              json: (data) => {
                resolve({ statusCode: code, body: data });
              },
            }),
            json: (data) => {
              resolve({ statusCode: 200, body: data });
            },
          };
          const mockReq = {
            user: req1.user,
            body: {},
            method: 'POST',
          };
          router.stack
            .find((layer) => layer.route && layer.route.path === '/validate-sellers')
            .route.stack.find((layer) => layer.name === 'async')
            .handle(mockReq, mockRes);
        });
        console.log(`  Status: ${res4.statusCode}`);
        console.log(`  Expected 400 Bad Request`);
        if (res4.statusCode === 400) {
          console.log('  ✓ PASS\n');
        } else {
          console.log('  ✗ FAIL\n');
        }

        console.log('========== API TESTS COMPLETED ==========\n');
      } catch (err) {
        console.error('[API TEST ERROR]', err.message);
        console.error(err.stack);
      } finally {
        server.close();
      }
    });
  } catch (err) {
    console.error('[API TEST ERROR]', err.message);
    console.error(err.stack);
  }
}

async function main() {
  try {
    console.log('\n========== API ENDPOINT VALIDATION TEST ==========\n');

    // Connect to MongoDB
    console.log('[1/3] Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Connected\n');

    // Create test data
    console.log('[2/3] Creating test data...');
    const testIds = await createTestData();

    // Run API tests
    console.log('[3/3] Running API tests...');
    await runApiTests(testIds);

  } catch (err) {
    console.error('[FATAL]', err);
    process.exit(1);
  } finally {
    // Cleanup
    await cleanup();
    await mongoose.disconnect();
    console.log('[INFO] Disconnected from MongoDB\n');
  }
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
