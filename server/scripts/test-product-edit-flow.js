#!/usr/bin/env node

/**
 * test-product-edit-flow.js
 * 
 * Verification script to test listing edit APIs and inventory transaction logs end-to-end.
 * 
 * Run with: node server/scripts/test-product-edit-flow.js
 */

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const Product = require('../models/Product');
const User = require('../models/User');
const InventoryTransaction = require('../models/InventoryTransaction');
const { logInventoryTransaction } = require('../services/audit');

const LOG = {
  pass: (msg) => console.log(`  ✅ PASS: ${msg}`),
  fail: (msg) => console.log(`  ❌ FAIL: ${msg}`),
  info: (msg) => console.log(`  ℹ️  ${msg}`),
  section: (msg) => console.log(`\n━━━ ${msg} ━━━`),
};

let passCount = 0;
let failCount = 0;

function assert(condition, msg) {
  if (condition) {
    LOG.pass(msg);
    passCount++;
  } else {
    LOG.fail(msg);
    failCount++;
  }
}

async function main() {
  console.log('\n🔍 TESTING PRODUCT EDIT AND INVENTORY LOGS FLOW\n');

  // Connect to MongoDB
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/handkraft';
  LOG.info(`Connecting to: ${mongoUri.replace(/\/\/[^@]+@/, '//***@')}`);

  try {
    await mongoose.connect(mongoUri, {
      family: 4,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });
    LOG.pass('Connected to MongoDB');
  } catch (err) {
    LOG.fail(`Failed to connect to MongoDB: ${err.message}`);
    process.exit(1);
  }

  try {
    // 1. Create mock seller
    LOG.section('1. Creating Mock Seller');
    const mockSeller = await User.create({
      name: 'Verification Seller',
      email: `seller-test-${Date.now()}@example.com`,
      role: 'seller',
      sellerDisplayName: 'Artisan Verification Lab',
      sellerPickupAddress: {
        label: 'Lab Warehouse',
        fullName: 'Artisan Lead',
        phoneNumber: '9876543210',
        email: 'lead@example.com',
        street: '12 Innovation Way',
        city: 'Mumbai',
        state: 'MH',
        postalCode: '400001',
        country: 'India',
      },
    });
    assert(mockSeller._id, `Created mock seller with ID: ${mockSeller._id}`);

    // 2. Create sample product
    LOG.section('2. Creating Sample Product');
    const product = await Product.create({
      title: 'Original Clay Pot',
      description: 'A finely crafted original clay pot.',
      price: 1500,
      realPrice: 1500,
      category: 'Pottery',
      stock: 10,
      seller: mockSeller._id,
      sellerName: mockSeller.sellerDisplayName,
    });
    assert(product._id, `Created product with ID: ${product._id}, Initial Stock: ${product.stock}`);

    // 3. Edit product details & stock (Simulate Listing Edit)
    LOG.section('3. Simulating Listing Edit (Updating Title, Price, and Stock)');
    
    // Simulate req.body payload
    const updatePayload = {
      title: 'Modified Premium Clay Pot',
      price: 1800,
      stock: 15, // Stock increases by 5
    };

    const targetProduct = await Product.findById(product._id);
    assert(targetProduct, 'Found product in database before update');

    // Title update
    if (updatePayload.title) {
      targetProduct.title = updatePayload.title;
    }
    // Price update
    if (updatePayload.price) {
      targetProduct.price = updatePayload.price;
      targetProduct.realPrice = updatePayload.price;
    }

    // Stock update & log transaction
    const previousStock = targetProduct.stock;
    const newStock = updatePayload.stock;
    if (newStock !== previousStock) {
      targetProduct.stock = newStock;
      
      await logInventoryTransaction({
        productId: targetProduct._id,
        sellerId: mockSeller._id,
        type: 'manual_adjustment',
        quantityChange: newStock - previousStock,
        previousStock,
        newStock,
        reason: 'Seller manual adjustment via listing edit',
        source: 'seller',
      });
    }

    await targetProduct.save();
    LOG.pass('Product listing updated and saved successfully.');

    // Fetch updated product to verify
    const updatedProduct = await Product.findById(product._id);
    assert(updatedProduct.title === 'Modified Premium Clay Pot', 'Product title correctly updated');
    assert(updatedProduct.price === 1800, 'Product price correctly updated');
    assert(updatedProduct.stock === 15, 'Product stock correctly updated to 15');

    // Verify InventoryTransaction log for manual_adjustment
    const adjustmentTx = await InventoryTransaction.findOne({
      product: product._id,
      type: 'manual_adjustment',
    });
    assert(adjustmentTx, 'Found manual adjustment inventory transaction log');
    if (adjustmentTx) {
      assert(adjustmentTx.quantityChange === 5, `Correct quantity change logged (+5)`);
      assert(adjustmentTx.previousStock === 10, `Correct previous stock logged (10)`);
      assert(adjustmentTx.newStock === 15, `Correct new stock logged (15)`);
      assert(String(adjustmentTx.seller) === String(mockSeller._id), 'Logged seller matches mock seller');
    }

    // 4. Simulate Stock Restock (Simulate Stock PATCH endpoint)
    LOG.section('4. Simulating Restock Action (+10 Stock)');
    const restockProduct = await Product.findById(product._id);
    const addQty = 10;
    
    const restockPrevStock = restockProduct.stock;
    const restockNewStock = restockPrevStock + addQty;
    restockProduct.stock = restockNewStock;
    await restockProduct.save();

    await logInventoryTransaction({
      productId: restockProduct._id,
      sellerId: mockSeller._id,
      type: 'restock',
      quantityChange: addQty,
      previousStock: restockPrevStock,
      newStock: restockNewStock,
      reason: 'Seller manual restock from insights panel',
      source: 'seller',
    });

    const finalProduct = await Product.findById(product._id);
    assert(finalProduct.stock === 25, 'Product stock correctly updated to 25 after restock');

    // Verify InventoryTransaction log for restock
    const restockTx = await InventoryTransaction.findOne({
      product: product._id,
      type: 'restock',
    });
    assert(restockTx, 'Found restock inventory transaction log');
    if (restockTx) {
      assert(restockTx.quantityChange === 10, 'Correct restock quantity logged (+10)');
      assert(restockTx.previousStock === 15, 'Correct previous stock logged (15)');
      assert(restockTx.newStock === 25, 'Correct new stock logged (25)');
    }

    // Clean up
    LOG.section('5. Cleaning Up Test Data');
    await Product.findByIdAndDelete(product._id);
    await User.findByIdAndDelete(mockSeller._id);
    await InventoryTransaction.deleteMany({ product: product._id });
    LOG.pass('Test data cleaned up successfully.');

  } catch (err) {
    LOG.fail(`Error during verification: ${err.message}`);
    failCount++;
  } finally {
    await mongoose.disconnect();
    LOG.info('Disconnected from MongoDB');

    console.log('\n========== VERIFICATION SUMMARY ==========\n');
    console.log(`  ✅ PASSED: ${passCount}`);
    console.log(`  ❌ FAILED: ${failCount}`);
    console.log(`  📈 TOTAL:  ${passCount + failCount}`);

    process.exit(failCount > 0 ? 1 : 0);
  }
}

main();
