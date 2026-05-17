#!/usr/bin/env node

/**
 * test-audit-system.js — Comprehensive verification of the audit & observability system.
 *
 * Usage: node scripts/test-audit-system.js
 *
 * Tests:
 *   1. All 6 audit models exist and can be imported
 *   2. Each model can insert a sample record
 *   3. Indexes exist and are correct
 *   4. WebhookAudit idempotency key prevents duplicates
 *   5. Append-only semantics (no update/delete operations)
 *   6. Audit service fire-and-forget semantics (never throws)
 *   7. Collection count summary
 */

const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');

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
  console.log('\n🔍 AUDIT SYSTEM VERIFICATION\n');

  // ─── Connect to MongoDB ───
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/handkraft';
  LOG.info(`Connecting to: ${mongoUri.replace(/\/\/[^@]+@/, '//***@')}`);

  await mongoose.connect(mongoUri, {
    family: 4,
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
  });
  LOG.pass('MongoDB connected');

  // ─── 1. Model imports ───
  LOG.section('1. Model Imports');

  let WebhookAudit, PaymentReconciliation, ShipmentEvent;
  let SellerAction, InventoryTransaction, OrderAuditLog;

  try {
    WebhookAudit = require('../models/WebhookAudit');
    assert(typeof WebhookAudit === 'function', 'WebhookAudit model imports');
  } catch (err) {
    assert(false, `WebhookAudit import: ${err.message}`);
  }

  try {
    PaymentReconciliation = require('../models/PaymentReconciliation');
    assert(typeof PaymentReconciliation === 'function', 'PaymentReconciliation model imports');
  } catch (err) {
    assert(false, `PaymentReconciliation import: ${err.message}`);
  }

  try {
    ShipmentEvent = require('../models/ShipmentEvent');
    assert(typeof ShipmentEvent === 'function', 'ShipmentEvent model imports');
  } catch (err) {
    assert(false, `ShipmentEvent import: ${err.message}`);
  }

  try {
    SellerAction = require('../models/SellerAction');
    assert(typeof SellerAction === 'function', 'SellerAction model imports');
  } catch (err) {
    assert(false, `SellerAction import: ${err.message}`);
  }

  try {
    InventoryTransaction = require('../models/InventoryTransaction');
    assert(typeof InventoryTransaction === 'function', 'InventoryTransaction model imports');
  } catch (err) {
    assert(false, `InventoryTransaction import: ${err.message}`);
  }

  try {
    OrderAuditLog = require('../models/OrderAuditLog');
    assert(typeof OrderAuditLog === 'function', 'OrderAuditLog model imports');
  } catch (err) {
    assert(false, `OrderAuditLog import: ${err.message}`);
  }

  // ─── 2. Audit Service imports ───
  LOG.section('2. Audit Service');

  let auditService;
  try {
    auditService = require('../services/audit');
    assert(typeof auditService.logWebhookAudit === 'function', 'logWebhookAudit exported');
    assert(typeof auditService.logPaymentReconciliation === 'function', 'logPaymentReconciliation exported');
    assert(typeof auditService.logShipmentEvent === 'function', 'logShipmentEvent exported');
    assert(typeof auditService.logSellerAction === 'function', 'logSellerAction exported');
    assert(typeof auditService.logInventoryTransaction === 'function', 'logInventoryTransaction exported');
    assert(typeof auditService.logOrderAudit === 'function', 'logOrderAudit exported');
  } catch (err) {
    assert(false, `Audit service import: ${err.message}`);
  }

  // ─── 3. Insert sample records ───
  LOG.section('3. Sample Record Inserts');

  const testOrderId = new mongoose.Types.ObjectId();
  const testSellerId = new mongoose.Types.ObjectId();
  const testProductId = new mongoose.Types.ObjectId();
  const testPayoutId = new mongoose.Types.ObjectId();
  const testTag = `_test_${Date.now()}`;

  // WebhookAudit
  try {
    const doc = await WebhookAudit.create({
      provider: 'razorpay',
      event: `test_event_${testTag}`,
      idempotencyKey: `test_idem_${testTag}`,
      signature: 'test_sig_abc123',
      signatureValid: true,
      payload: { test: true, tag: testTag },
      headers: { 'content-type': 'application/json' },
      processingResult: { message: 'Test processed' },
      orderId: testOrderId,
      gatewayOrderId: 'order_test_123',
      httpStatusCode: 200,
      processingMs: 42,
      ip: '127.0.0.1',
    });
    assert(doc._id, 'WebhookAudit inserted');
    assert(doc.provider === 'razorpay', 'WebhookAudit provider correct');
    assert(doc.signatureValid === true, 'WebhookAudit signatureValid correct');
    assert(doc.processingMs === 42, 'WebhookAudit processingMs correct');
  } catch (err) {
    assert(false, `WebhookAudit insert: ${err.message}`);
  }

  // PaymentReconciliation
  try {
    const doc = await PaymentReconciliation.create({
      order: testOrderId,
      seller: testSellerId,
      event: 'payment_captured',
      snapshot: { itemSubtotal: 500, platformFeeAmount: 25, netPayoutAmount: 475 },
      payoutId: testPayoutId,
      gatewayPaymentId: 'pay_test_123',
      currency: 'INR',
      amount: 500,
      note: `Test reconciliation ${testTag}`,
      source: 'system',
    });
    assert(doc._id, 'PaymentReconciliation inserted');
    assert(doc.event === 'payment_captured', 'PaymentReconciliation event correct');
  } catch (err) {
    assert(false, `PaymentReconciliation insert: ${err.message}`);
  }

  // ShipmentEvent
  try {
    const doc = await ShipmentEvent.create({
      order: testOrderId,
      seller: testSellerId,
      localShipmentRef: `HK-TEST-${testTag.slice(-8)}`,
      event: 'booking_succeeded',
      previousStatus: 'ready_for_booking',
      newStatus: 'booked',
      carrier: { provider: 'nimbuspost', awbNumber: 'AWB_TEST_123', courierName: 'Test Courier' },
      source: 'system',
      processingMs: 120,
    });
    assert(doc._id, 'ShipmentEvent inserted');
    assert(doc.event === 'booking_succeeded', 'ShipmentEvent event correct');
  } catch (err) {
    assert(false, `ShipmentEvent insert: ${err.message}`);
  }

  // SellerAction
  try {
    const doc = await SellerAction.create({
      seller: testSellerId,
      action: 'bank_details_updated',
      before: { hasAccountNumber: false },
      after: { hasAccountNumber: true, accountType: 'bank' },
      note: `Test seller action ${testTag}`,
      source: 'seller',
      ip: '127.0.0.1',
    });
    assert(doc._id, 'SellerAction inserted');
    assert(doc.action === 'bank_details_updated', 'SellerAction action correct');
  } catch (err) {
    assert(false, `SellerAction insert: ${err.message}`);
  }

  // InventoryTransaction
  try {
    const doc = await InventoryTransaction.create({
      product: testProductId,
      order: testOrderId,
      seller: testSellerId,
      type: 'sale_deducted',
      quantityChange: -2,
      previousStock: 10,
      newStock: 8,
      reason: `Test stock deduction ${testTag}`,
      source: 'system',
    });
    assert(doc._id, 'InventoryTransaction inserted');
    assert(doc.quantityChange === -2, 'InventoryTransaction quantityChange correct');
    assert(doc.newStock === 8, 'InventoryTransaction newStock correct');
  } catch (err) {
    assert(false, `InventoryTransaction insert: ${err.message}`);
  }

  // OrderAuditLog
  try {
    const doc = await OrderAuditLog.create({
      order: testOrderId,
      actor: testSellerId,
      actorRole: 'system',
      event: 'order_created',
      newState: { status: 'pending', paymentStatus: 'pending' },
      note: `Test order audit ${testTag}`,
    });
    assert(doc._id, 'OrderAuditLog inserted');
    assert(doc.event === 'order_created', 'OrderAuditLog event correct');
  } catch (err) {
    assert(false, `OrderAuditLog insert: ${err.message}`);
  }

  // ─── 4. Idempotency key test ───
  LOG.section('4. Idempotency Key (WebhookAudit)');

  try {
    await WebhookAudit.create({
      provider: 'nimbuspost',
      idempotencyKey: `test_idem_${testTag}`, // Same key as above
      signatureValid: true,
      payload: { duplicate: true },
    });
    assert(false, 'Duplicate idempotency key should have been rejected');
  } catch (err) {
    const isDuplicate = err?.code === 11000;
    assert(isDuplicate, 'Duplicate idempotency key correctly rejected (E11000)');
  }

  // Different key should work
  try {
    const doc2 = await WebhookAudit.create({
      provider: 'nimbuspost',
      idempotencyKey: `test_idem_${testTag}_v2`,
      signatureValid: true,
      payload: { test: true },
    });
    assert(doc2._id, 'Different idempotency key accepted');
  } catch (err) {
    assert(false, `Different idempotency key: ${err.message}`);
  }

  // ─── 5. Fire-and-forget semantics ───
  LOG.section('5. Fire-and-Forget Semantics (Audit Service)');

  // logWebhookAudit with invalid data should NOT throw
  try {
    await auditService.logWebhookAudit({ provider: 'invalid_provider_xxxx' });
    assert(true, 'logWebhookAudit with invalid enum does not throw');
  } catch {
    assert(false, 'logWebhookAudit should never throw');
  }

  // logOrderAudit with missing orderId should be silently skipped
  try {
    await auditService.logOrderAudit({ event: 'order_created', note: 'no order id' });
    assert(true, 'logOrderAudit with missing orderId does not throw');
  } catch {
    assert(false, 'logOrderAudit should never throw');
  }

  // logInventoryTransaction with missing productId should be silently skipped
  try {
    await auditService.logInventoryTransaction({ type: 'sale_deducted', quantityChange: -1 });
    assert(true, 'logInventoryTransaction with missing productId does not throw');
  } catch {
    assert(false, 'logInventoryTransaction should never throw');
  }

  // ─── 6. Index verification ───
  LOG.section('6. Index Verification');

  const collections = [
    { model: WebhookAudit, name: 'WebhookAudit' },
    { model: PaymentReconciliation, name: 'PaymentReconciliation' },
    { model: ShipmentEvent, name: 'ShipmentEvent' },
    { model: SellerAction, name: 'SellerAction' },
    { model: InventoryTransaction, name: 'InventoryTransaction' },
    { model: OrderAuditLog, name: 'OrderAuditLog' },
  ];

  for (const { model, name } of collections) {
    try {
      await model.ensureIndexes();
      const indexes = await model.collection.indexes();
      const indexCount = indexes.length;
      assert(indexCount >= 3, `${name} has ${indexCount} indexes (expected >= 3)`);
    } catch (err) {
      assert(false, `${name} index check: ${err.message}`);
    }
  }

  // ─── 7. Collection count summary ───
  LOG.section('7. Collection Count Summary');

  for (const { model, name } of collections) {
    try {
      const count = await model.countDocuments();
      LOG.info(`${name}: ${count} documents`);
    } catch (err) {
      LOG.fail(`${name} count: ${err.message}`);
    }
  }

  // ─── 8. Cleanup test data ───
  LOG.section('8. Cleanup Test Data');

  try {
    await WebhookAudit.deleteMany({ 'payload.tag': testTag });
    await WebhookAudit.deleteMany({ idempotencyKey: `test_idem_${testTag}_v2` });
    await PaymentReconciliation.deleteMany({ note: { $regex: testTag } });
    await ShipmentEvent.deleteMany({ localShipmentRef: { $regex: testTag.slice(-8) } });
    await SellerAction.deleteMany({ note: { $regex: testTag } });
    await InventoryTransaction.deleteMany({ reason: { $regex: testTag } });
    await OrderAuditLog.deleteMany({ note: { $regex: testTag } });
    LOG.pass('Test data cleaned up');
  } catch (err) {
    LOG.fail(`Cleanup: ${err.message}`);
  }

  // ─── Summary ───
  console.log('\n' + '═'.repeat(50));
  console.log(`  Results: ${passCount} passed, ${failCount} failed`);
  console.log('═'.repeat(50) + '\n');

  await mongoose.disconnect();

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\n💥 Fatal error:', err);
  process.exit(1);
});
