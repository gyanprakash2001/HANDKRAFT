/**
 * Unit Tests: Payment Shipment Booking (Phase 4)
 * 
 * Verifies the post-payment booking pass updates shipments with AWB / carrier data
 * and marks failures without affecting unrelated order data.
 */

const assert = require('assert');
const {
  bookReadySellerShipmentsAfterPayment,
} = require('../services/payment-booking');

const testResults = {
  passed: 0,
  failed: 0,
};

function createOrderFixture() {
  return {
    _id: 'order123',
    items: [
      {
        product: 'prod1',
        title: 'Item 1',
        quantity: 2,
        price: 100,
        fulfillmentStatus: 'new',
        trackingEvents: [],
      },
      {
        product: 'prod2',
        title: 'Item 2',
        quantity: 1,
        price: 250,
        fulfillmentStatus: 'new',
        trackingEvents: [],
      },
    ],
    shippingAddress: {
      fullName: 'Buyer Name',
      street: '1 Main St',
      city: 'Mumbai',
      state: 'MH',
      postalCode: '400001',
      phoneNumber: '9999999999',
      email: 'buyer@example.com',
    },
    subtotal: 450,
    shippingCost: 80,
    paymentMethod: 'razorpay',
    sellerShipments: [
      {
        seller: 'seller1',
        itemIndexes: [0],
        localShipmentRef: 'HK-ORDER123-01',
        status: 'ready_for_booking',
        lastError: '',
        carrier: {},
        timeline: [],
        quotedShippingCost: 30,
      },
      {
        seller: 'seller2',
        itemIndexes: [1],
        localShipmentRef: 'HK-ORDER123-02',
        status: 'ready_for_booking',
        lastError: '',
        carrier: {},
        timeline: [],
        quotedShippingCost: 50,
      },
    ],
  };
}

function createDeps() {
  const sellerPickupMap = new Map([
    ['seller1', { warehouseName: 'WH1' }],
    ['seller2', { warehouseName: 'WH2' }],
  ]);

  const calls = [];

  const createShipment = async (payload) => {
    calls.push(payload);
    if (payload.localShipmentRef === 'HK-ORDER123-01') {
      return {
        mode: 'v2',
        orderId: 'remote-order-1',
        shipmentId: 'remote-shipment-1',
        awbNumber: 'AWB1234567890',
        courierId: 'courier-1',
        courierName: 'Nimbus Express',
        remoteStatus: 'booked',
        labelUrl: 'https://example.com/label-1',
        manifestUrl: 'https://example.com/manifest-1',
      };
    }

    throw new Error('[NimbusPost] booking failed');
  };

  return {
    sellerPickupMap,
    createShipment,
    calls,
  };
}

async function testSuccessfulAndFailedBooking() {
  const order = createOrderFixture();
  const deps = createDeps();

  const result = await bookReadySellerShipmentsAfterPayment({
    order,
    shipmentsToBook: order.sellerShipments,
    sellerPickupMap: deps.sellerPickupMap,
    createShipment: deps.createShipment,
    buildNimbusShipmentPayload: (orderDoc, shipment, pickupAddress) => ({
      localShipmentRef: shipment.localShipmentRef,
      pickupAddress,
      shippingAddress: orderDoc.shippingAddress,
      items: shipment.itemIndexes.map((index) => orderDoc.items[index]),
      paymentType: 'prepaid',
      shippingCharges: shipment.quotedShippingCost,
      discount: 0,
      codCharges: 0,
      orderAmount: 0,
      courierId: 'courier-preferred',
    }),
    mapNimbusStatusToShipmentStatus: (status) => (String(status).toLowerCase().includes('book') ? 'booked' : 'failed'),
    buildNimbusTrackingUrl: (awbNumber) => `https://nimbuspost.com/tracking/?awb=${encodeURIComponent(awbNumber)}`,
    appendShipmentTimelineEntry: (shipment, entry) => {
      shipment.timeline = Array.isArray(shipment.timeline) ? shipment.timeline : [];
      shipment.timeline.push(entry);
    },
    syncOrderItemsFromShipment: (orderDoc, shipment) => {
      const nextStatus = shipment.status === 'failed' ? null : 'shipped';
      if (!nextStatus) {
        return;
      }
      for (const index of shipment.itemIndexes) {
        orderDoc.items[index].fulfillmentStatus = nextStatus;
      }
    },
    allowedShipmentStatuses: ['pending', 'ready_for_booking', 'booked', 'awb_assigned', 'pickup_scheduled', 'in_transit', 'delivered', 'cancelled', 'failed'],
  });

  assert.strictEqual(result.bookedCount, 1);
  assert.strictEqual(result.failedCount, 1);
  assert.strictEqual(order.sellerShipments[0].status, 'awb_assigned');
  assert.strictEqual(order.sellerShipments[0].carrier.awbNumber, 'AWB1234567890');
  assert.strictEqual(order.sellerShipments[0].carrier.trackingUrl, 'https://nimbuspost.com/tracking/?awb=AWB1234567890');
  assert.strictEqual(order.sellerShipments[1].status, 'failed');
  assert.ok(order.sellerShipments[1].lastError.includes('booking failed'));
  assert.strictEqual(order.items[0].fulfillmentStatus, 'shipped');
  assert.strictEqual(order.items[1].fulfillmentStatus, 'new');
  assert.strictEqual(deps.calls.length, 2);
}

async function testNoShipmentsReturnsNoop() {
  const order = createOrderFixture();
  const result = await bookReadySellerShipmentsAfterPayment({
    order,
    shipmentsToBook: [],
    sellerPickupMap: new Map(),
    createShipment: async () => {
      throw new Error('should not be called');
    },
    buildNimbusShipmentPayload: () => ({}),
  });

  assert.strictEqual(result.bookedCount, 0);
  assert.strictEqual(result.failedCount, 0);
}

async function run() {
  console.log('\n========== PHASE 4: PAYMENT → SHIPMENT BOOKING TESTS ==========' );

  try {
    await testSuccessfulAndFailedBooking();
    console.log('✓ PASS: mixed success/failure booking updates AWB and status');
    testResults.passed++;
  } catch (err) {
    console.log('✗ FAIL: mixed success/failure booking updates AWB and status');
    console.log(`  ${err?.message || err}`);
    testResults.failed++;
  }

  try {
    await testNoShipmentsReturnsNoop();
    console.log('✓ PASS: empty shipment list is a no-op');
    testResults.passed++;
  } catch (err) {
    console.log('✗ FAIL: empty shipment list is a no-op');
    console.log(`  ${err?.message || err}`);
    testResults.failed++;
  }

  console.log('');
  console.log('========== TEST SUMMARY ==========' );
  console.log(`✓ PASSED: ${testResults.passed}`);
  console.log(`✗ FAILED: ${testResults.failed}`);
  console.log(`📈 TOTAL:  ${testResults.passed + testResults.failed}`);

  process.exit(testResults.failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
