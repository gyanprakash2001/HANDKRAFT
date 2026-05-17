/**
 * Test: NimbusPost Webhook Processing (Phase 6)
 * 
 * Verifies tracking updates, timeline writes, and payout sync handoff.
 */

const assert = require('assert');
const mongoose = require('mongoose');
const {
  processNimbuspostWebhook,
  isNimbusWebhookAuthorized,
  mapNimbusStatusToShipmentStatus,
} = require('../services/nimbuspost-webhook');

async function run() {
  console.log('\n========== NIMBUSPOST WEBHOOK TESTS ==========' );

  const sellerId = new mongoose.Types.ObjectId();
  let saveCalled = false;
  let payoutCalls = [];

  const order = {
    sellerShipments: [
      {
        seller: sellerId,
        itemIndexes: [0],
        localShipmentRef: 'HK-ORDER999-01',
        status: 'in_transit',
        lastError: '',
        carrier: {
          provider: 'nimbuspost',
          awbNumber: 'AWB999000111',
          remoteStatus: 'In Transit',
        },
        timeline: [],
      },
    ],
    items: [
      {
        fulfillmentStatus: 'shipped',
        trackingEvents: [],
      },
    ],
    async save() {
      saveCalled = true;
    },
  };

  const orderModel = {
    async findOne(query) {
      const awb = String(query?.['sellerShipments.carrier.awbNumber'] || '').trim();
      return awb === 'AWB999000111' ? order : null;
    },
  };

  const authAllowed = isNimbusWebhookAuthorized({
    headers: { 'x-webhook-secret': 'shared-secret' },
    rawBody: '{"awb":"AWB999000111"}',
    body: { awb: 'AWB999000111' },
    secret: 'shared-secret',
  });
  assert.strictEqual(authAllowed, true);

  const authDenied = isNimbusWebhookAuthorized({
    headers: { 'x-webhook-secret': 'wrong-secret' },
    rawBody: '{"awb":"AWB999000111"}',
    body: { awb: 'AWB999000111' },
    secret: 'shared-secret',
  });
  assert.strictEqual(authDenied, false);

  assert.strictEqual(mapNimbusStatusToShipmentStatus('Delivered'), 'delivered');
  assert.strictEqual(mapNimbusStatusToShipmentStatus('Out for delivery'), 'delivered');
  assert.strictEqual(mapNimbusStatusToShipmentStatus('RTO failed'), 'failed');

  const result = await processNimbuspostWebhook({
    headers: { 'x-webhook-secret': 'shared-secret' },
    rawBody: '{"awb":"AWB999000111"}',
    body: {
      awb: 'AWB999000111',
      current_status: 'Delivered',
      message: 'Delivered successfully',
    },
    secret: 'shared-secret',
    orderModel,
    payoutSync: async (orderDoc, seller, source) => {
      payoutCalls.push({ orderDoc, seller, source });
    },
    logger: console,
  });

  assert.strictEqual(result.statusCode, 200);
  assert.strictEqual(result.body.message, 'NimbusPost webhook processed.');
  assert.strictEqual(saveCalled, true);
  assert.strictEqual(order.sellerShipments[0].status, 'delivered');
  assert.strictEqual(order.sellerShipments[0].carrier.provider, 'nimbuspost');
  assert.strictEqual(order.sellerShipments[0].carrier.remoteStatus, 'Delivered');
  assert.strictEqual(order.sellerShipments[0].timeline.length, 1);
  assert.strictEqual(order.items[0].fulfillmentStatus, 'delivered');
  assert.strictEqual(order.items[0].trackingEvents.length, 1);
  assert.strictEqual(payoutCalls.length, 1);
  assert.strictEqual(String(payoutCalls[0].seller), String(sellerId));
  assert.strictEqual(payoutCalls[0].source, 'system');

  const missingOrder = await processNimbuspostWebhook({
    headers: { 'x-webhook-secret': 'shared-secret' },
    rawBody: '{"awb":"AWB-NOT-FOUND"}',
    body: { awb: 'AWB-NOT-FOUND', status: 'booked' },
    secret: 'shared-secret',
    orderModel,
    payoutSync: async () => {
      throw new Error('should not be called');
    },
    logger: console,
  });

  assert.strictEqual(missingOrder.statusCode, 200);
  assert.strictEqual(missingOrder.body.message, 'No shipment found for AWB.');

  console.log('✓ PASS: signature authorization helper');
  console.log('✓ PASS: status mapping helper');
  console.log('✓ PASS: delivered webhook updates shipment, items, and payout sync');
  console.log('✓ PASS: missing shipment returns acknowledged no-op');
  console.log('');
  console.log('========== TEST SUMMARY ==========' );
  console.log('✓ PASSED: 4');
  console.log('✗ FAILED: 0');
  console.log('📈 TOTAL:  4');
}

run().catch((err) => {
  console.error('Fatal webhook test error:', err);
  process.exit(1);
});
