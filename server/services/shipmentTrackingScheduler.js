const { env } = require('../config/env');
const Order = require('../models/Order');
const { isNimbuspostEnabled, trackShipmentByAwb } = require('./nimbuspost');
const { syncSellerPayoutAfterFulfillment } = require('./payouts');

const ACTIVE_SHIPMENT_STATUSES = new Set(['booked', 'awb_assigned', 'pickup_scheduled', 'in_transit']);
const ITEM_STATUS_ORDER = ['new', 'processing', 'packed', 'shipped', 'delivered', 'cancelled'];

let schedulerHandle = null;
let schedulerRunning = false;

function getSchedulerConfig() {
  const nimbus = env?.nimbuspost || {};
  return {
    enabled: isNimbuspostEnabled(),
    schedulerEnabled: nimbus.trackingSchedulerEnabled !== false,
    intervalMs: Number(nimbus.trackingSchedulerIntervalMs || 120000),
    batchLimit: Number(nimbus.trackingSchedulerBatchLimit || 25),
  };
}

function mapNimbusStatusToShipmentStatus(rawStatus) {
  const normalized = String(rawStatus || '').trim().toLowerCase();
  if (!normalized) {
    return 'booked';
  }

  if (normalized.includes('cancel')) {
    return 'cancelled';
  }

  if (normalized.includes('rto') || normalized.includes('exception') || normalized.includes('undeliver') || normalized.includes('fail')) {
    return 'failed';
  }

  if (normalized.includes('deliver')) {
    return 'delivered';
  }

  if (normalized.includes('out for delivery') || normalized.includes('in transit') || normalized === 'it' || normalized.includes('shipped')) {
    return 'in_transit';
  }

  if (normalized.includes('pickup')) {
    return 'pickup_scheduled';
  }

  if (normalized.includes('awb') || normalized.includes('booked')) {
    return 'awb_assigned';
  }

  return 'booked';
}

function mapShipmentStatusToSellerItemStatus(shipmentStatus) {
  const normalized = String(shipmentStatus || '').trim().toLowerCase();

  if (normalized === 'delivered') {
    return 'delivered';
  }

  if (normalized === 'cancelled') {
    return 'cancelled';
  }

  if (['booked', 'awb_assigned', 'pickup_scheduled', 'in_transit'].includes(normalized)) {
    return 'shipped';
  }

  return null;
}

function getItemStatusRank(status) {
  const normalized = String(status || 'new').trim().toLowerCase();
  const index = ITEM_STATUS_ORDER.indexOf(normalized);
  return index >= 0 ? index : 0;
}

function buildOrderStatusFromItems(items = []) {
  const statuses = items.map((item) => item?.fulfillmentStatus || 'new');

  if (statuses.length > 0 && statuses.every((status) => status === 'cancelled')) {
    return 'cancelled';
  }

  if (statuses.length > 0 && statuses.every((status) => status === 'delivered' || status === 'cancelled')) {
    return 'delivered';
  }

  if (statuses.some((status) => status === 'shipped' || status === 'delivered')) {
    return 'shipped';
  }

  return 'confirmed';
}

function appendShipmentTimelineEntry(shipment, { status, note, source = 'scheduler' }) {
  shipment.timeline = Array.isArray(shipment.timeline) ? shipment.timeline : [];
  shipment.timeline.push({
    status,
    note: note || '',
    source,
    at: new Date(),
  });
}

function syncOrderItemsFromShipment(order, shipment, { note = '', updatedBy = null } = {}) {
  const nextStatus = mapShipmentStatusToSellerItemStatus(shipment?.status);
  if (!nextStatus) {
    return { changed: false, affectedCount: 0 };
  }

  const itemIndexes = Array.isArray(shipment?.itemIndexes)
    ? shipment.itemIndexes.filter((index) => Number.isInteger(index) && index >= 0)
    : [];

  if (itemIndexes.length === 0) {
    return { changed: false, affectedCount: 0 };
  }

  const nextRank = getItemStatusRank(nextStatus);
  let changed = false;
  let affectedCount = 0;

  for (const index of itemIndexes) {
    const orderItem = order?.items?.[index];
    if (!orderItem) {
      continue;
    }

    const currentStatus = String(orderItem?.fulfillmentStatus || 'new').trim().toLowerCase();
    if (currentStatus === nextStatus) {
      continue;
    }

    if (currentStatus === 'cancelled' && nextStatus !== 'cancelled') {
      continue;
    }

    if (nextStatus === 'cancelled' && currentStatus === 'delivered') {
      continue;
    }

    if (nextStatus !== 'cancelled' && getItemStatusRank(currentStatus) > nextRank) {
      continue;
    }

    orderItem.fulfillmentStatus = nextStatus;
    orderItem.trackingEvents = Array.isArray(orderItem.trackingEvents) ? orderItem.trackingEvents : [];
    orderItem.trackingEvents.push({
      status: nextStatus,
      note: note || `Auto tracking sync: shipment status ${String(shipment?.status || nextStatus)}`,
      updatedBy,
      at: new Date(),
    });

    changed = true;
    affectedCount += 1;
  }

  if (changed) {
    order.status = buildOrderStatusFromItems(order.items || []);
  }

  return { changed, affectedCount };
}

async function runShipmentTrackingSchedulerTick() {
  if (schedulerRunning) {
    return;
  }

  schedulerRunning = true;
  try {
    const config = getSchedulerConfig();
    if (!config.enabled || !config.schedulerEnabled) {
      return;
    }

    const orders = await Order.find({
      sellerShipments: {
        $elemMatch: {
          'carrier.provider': 'nimbuspost',
          'carrier.awbNumber': { $nin: ['', null] },
          status: { $in: Array.from(ACTIVE_SHIPMENT_STATUSES) },
        },
      },
    })
      .sort({ updatedAt: 1 })
      .limit(Math.max(1, Number(config.batchLimit || 25)));

    if (!orders.length) {
      return;
    }

    let syncedShipments = 0;
    let deliveredShipments = 0;
    let failedSyncs = 0;

    for (const order of orders) {
      let orderChanged = false;
      const touchedSellerIds = new Set();

      for (const shipment of order.sellerShipments || []) {
        const provider = String(shipment?.carrier?.provider || '').trim().toLowerCase();
        const awbNumber = String(shipment?.carrier?.awbNumber || '').trim();
        const shipmentStatus = String(shipment?.status || '').trim().toLowerCase();

        if (provider !== 'nimbuspost' || !awbNumber || !ACTIVE_SHIPMENT_STATUSES.has(shipmentStatus)) {
          continue;
        }

        try {
          const tracking = await trackShipmentByAwb(awbNumber);
          const remoteStatus = String(tracking?.remoteStatus || '').trim();
          const mappedStatus = mapNimbusStatusToShipmentStatus(remoteStatus);

          let shipmentChanged = false;
          if (mappedStatus && mappedStatus !== shipment.status) {
            shipment.status = mappedStatus;
            shipmentChanged = true;
          }

          if (remoteStatus && remoteStatus !== String(shipment?.carrier?.remoteStatus || '')) {
            shipment.carrier.remoteStatus = remoteStatus;
            shipmentChanged = true;
          }

          if (shipmentChanged) {
            appendShipmentTimelineEntry(shipment, {
              status: shipment.status,
              note: remoteStatus
                ? `Auto Nimbus tracking sync: ${remoteStatus}`
                : 'Auto Nimbus tracking sync completed.',
              source: 'scheduler',
            });
          }

          const itemSync = syncOrderItemsFromShipment(order, shipment, {
            note: remoteStatus
              ? `Auto Nimbus tracking sync: ${remoteStatus}`
              : 'Auto Nimbus tracking sync completed.',
            updatedBy: null,
          });

          if (shipmentChanged || itemSync.changed) {
            orderChanged = true;
            syncedShipments += 1;

            const sellerId = String(shipment?.seller || '').trim();
            if (sellerId) {
              touchedSellerIds.add(sellerId);
            }

            if (String(shipment.status || '').toLowerCase() === 'delivered') {
              deliveredShipments += 1;
            }
          }
        } catch (err) {
          failedSyncs += 1;
          const errorMessage = String(err?.message || 'Nimbus tracking sync failed').trim();
          if (errorMessage && shipment.lastError !== errorMessage) {
            shipment.lastError = errorMessage;
            appendShipmentTimelineEntry(shipment, {
              status: shipment.status,
              note: `Auto Nimbus tracking sync failed: ${errorMessage}`,
              source: 'scheduler',
            });
            orderChanged = true;
          }
        }
      }

      if (!orderChanged) {
        continue;
      }

      order.status = buildOrderStatusFromItems(order.items || []);
      await order.save();

      for (const sellerId of touchedSellerIds) {
        if (!sellerId) {
          continue;
        }

        try {
          await syncSellerPayoutAfterFulfillment(order, sellerId, 'scheduler');
        } catch (payoutErr) {
          console.warn('[SHIPMENT_TRACKING][PAYOUT] Failed to sync payout state:', payoutErr?.message || payoutErr);
        }
      }
    }

    if (syncedShipments > 0 || failedSyncs > 0) {
      console.log(`[SHIPMENT_TRACKING][SCHEDULER] scanned_orders=${orders.length} synced_shipments=${syncedShipments} delivered=${deliveredShipments} failed_syncs=${failedSyncs}`);
    }
  } catch (err) {
    console.error('[SHIPMENT_TRACKING][SCHEDULER] Tick failed:', err?.message || err);
  } finally {
    schedulerRunning = false;
  }
}

function startShipmentTrackingScheduler() {
  const config = getSchedulerConfig();

  if (!config.enabled || !config.schedulerEnabled) {
    console.log('[SHIPMENT_TRACKING][SCHEDULER] Disabled by configuration.');
    return;
  }

  if (schedulerHandle) {
    return;
  }

  const intervalMs = Math.max(10000, Number(config.intervalMs || 120000));
  schedulerHandle = setInterval(() => {
    void runShipmentTrackingSchedulerTick();
  }, intervalMs);

  if (typeof schedulerHandle.unref === 'function') {
    schedulerHandle.unref();
  }

  console.log(`[SHIPMENT_TRACKING][SCHEDULER] Started. interval=${intervalMs}ms batchLimit=${config.batchLimit}`);
  void runShipmentTrackingSchedulerTick();
}

function stopShipmentTrackingScheduler() {
  if (!schedulerHandle) {
    return;
  }

  clearInterval(schedulerHandle);
  schedulerHandle = null;
  schedulerRunning = false;
  console.log('[SHIPMENT_TRACKING][SCHEDULER] Stopped.');
}

module.exports = {
  startShipmentTrackingScheduler,
  stopShipmentTrackingScheduler,
  runShipmentTrackingSchedulerTick,
};
