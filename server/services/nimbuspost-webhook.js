const crypto = require('crypto');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const { env } = require('../config/env');
const { syncSellerPayoutAfterFulfillment } = require('./payouts');
const { logShipmentEvent, logOrderAudit } = require('./audit');

const SELLER_SHIPMENT_STATUS_ORDER = ['pending', 'ready_for_booking', 'booked', 'awb_assigned', 'pickup_scheduled', 'in_transit', 'delivered', 'cancelled', 'failed'];

function pickFirstNonEmpty(values = []) {
  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }

    const normalized = String(value).trim();
    if (normalized) {
      return normalized;
    }
  }

  return '';
}

function extractNimbusWebhookAwb(payload = {}) {
  return pickFirstNonEmpty([
    payload?.awb,
    payload?.awb_number,
    payload?.data?.awb,
    payload?.data?.awb_number,
    payload?.data?.shipment?.awb,
    payload?.data?.shipment?.awb_number,
    payload?.shipment?.awb,
    payload?.shipment?.awb_number,
  ]);
}

function extractNimbusWebhookStatus(payload = {}) {
  return pickFirstNonEmpty([
    payload?.current_status,
    payload?.shipment_status,
    payload?.status,
    payload?.data?.current_status,
    payload?.data?.shipment_status,
    payload?.data?.status,
    payload?.data?.shipment?.status,
  ]);
}

function extractNimbusWebhookNote(payload = {}) {
  return pickFirstNonEmpty([
    payload?.message,
    payload?.remark,
    payload?.current_status,
    payload?.shipment_status,
    payload?.status,
    payload?.data?.message,
  ]);
}

function isEqualSafe(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function isNimbusWebhookAuthorized({ headers = {}, rawBody = '', body = {}, secret = '' } = {}) {
  const normalizedSecret = String(secret || '').trim();
  if (!normalizedSecret) {
    return true;
  }

  const plainSecretHeader = String(
    headers['x-webhook-secret']
    || headers['x-nimbuspost-secret']
    || headers['x-api-key']
    || ''
  ).trim();

  if (plainSecretHeader && isEqualSafe(plainSecretHeader, normalizedSecret)) {
    return true;
  }

  const signatureHeader = String(headers['x-hmac-sha256'] || '').trim();
  if (!signatureHeader) {
    return false;
  }

  const payload = rawBody && String(rawBody).length > 0
    ? String(rawBody)
    : JSON.stringify(body || {});

  const computedSignature = crypto
    .createHmac('sha256', normalizedSecret)
    .update(payload, 'utf8')
    .digest('base64');

  return isEqualSafe(signatureHeader, computedSignature);
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

function appendShipmentTimelineEntry(shipment, { status, note, source = 'system' }) {
  shipment.timeline = Array.isArray(shipment.timeline) ? shipment.timeline : [];
  shipment.timeline.push({
    status,
    note: note || '',
    source,
    at: new Date(),
  });
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

    orderItem.fulfillmentStatus = nextStatus;
    orderItem.trackingEvents = Array.isArray(orderItem.trackingEvents) ? orderItem.trackingEvents : [];
    orderItem.trackingEvents.push({
      status: nextStatus,
      note: note || `Auto-updated from shipment status: ${String(shipment?.status || nextStatus)}`,
      updatedBy,
      at: new Date(),
    });

    changed = true;
    affectedCount += 1;
  }

  return { changed, affectedCount };
}

async function processNimbuspostWebhook({
  headers = {},
  rawBody = '',
  body = {},
  secret = env.nimbuspost?.webhookSecret || '',
  orderModel = Order,
  payoutSync = syncSellerPayoutAfterFulfillment,
  logger = console,
} = {}) {
  if (!isNimbusWebhookAuthorized({ headers, rawBody, body, secret })) {
    return { statusCode: 401, body: { message: 'Invalid webhook signature/secret' } };
  }

  const payload = body || {};
  const awbNumber = extractNimbusWebhookAwb(payload);

  if (!awbNumber) {
    return { statusCode: 400, body: { message: 'AWB number is required in webhook payload.' } };
  }

  const order = await orderModel.findOne({ 'sellerShipments.carrier.awbNumber': awbNumber });
  if (!order) {
    return { statusCode: 200, body: { message: 'No shipment found for AWB.' } };
  }

  const shipment = (order.sellerShipments || []).find(
    (entry) => String(entry?.carrier?.awbNumber || '').trim() === awbNumber
  );

  if (!shipment) {
    return { statusCode: 200, body: { message: 'Shipment entry not found for AWB.' } };
  }

  const remoteStatus = extractNimbusWebhookStatus(payload);
  const mappedStatus = mapNimbusStatusToShipmentStatus(remoteStatus);
  const previousShipmentStatus = String(shipment.status || 'pending');

  if (SELLER_SHIPMENT_STATUS_ORDER.includes(mappedStatus)) {
    shipment.status = mappedStatus;
  }

  shipment.lastError = mappedStatus === 'failed'
    ? (extractNimbusWebhookNote(payload) || shipment.lastError || 'NimbusPost reported shipment exception.')
    : '';

  shipment.carrier = shipment.carrier || {};
  shipment.carrier.provider = 'nimbuspost';
  shipment.carrier.remoteStatus = remoteStatus || shipment.carrier.remoteStatus || '';

  appendShipmentTimelineEntry(shipment, {
    status: shipment.status,
    note: extractNimbusWebhookNote(payload) || `NimbusPost webhook status: ${remoteStatus || shipment.status}`,
    source: 'system',
  });

  syncOrderItemsFromShipment(order, shipment, {
    note: extractNimbusWebhookNote(payload) || `NimbusPost status: ${remoteStatus || shipment.status}`,
    updatedBy: null,
  });

  await order.save();

  // Audit: shipment event from webhook
  logShipmentEvent({
    orderId: order._id,
    sellerId: shipment?.seller,
    localShipmentRef: shipment?.localShipmentRef,
    event: 'webhook_status_applied',
    previousStatus: previousShipmentStatus,
    newStatus: shipment.status,
    carrier: {
      provider: 'nimbuspost',
      awbNumber: awbNumber,
      remoteStatus: remoteStatus,
    },
    source: 'webhook',
  });
  logOrderAudit({
    orderId: order._id,
    actorRole: 'webhook',
    event: 'shipment_status_changed',
    previousState: { shipmentStatus: previousShipmentStatus },
    newState: { shipmentStatus: shipment.status, awbNumber },
    note: `NimbusPost webhook: ${remoteStatus} → ${shipment.status}`,
  });

  const shipmentSellerId = String(shipment?.seller || '');
  if (shipmentSellerId && mongoose.Types.ObjectId.isValid(shipmentSellerId)) {
    try {
      await payoutSync(order, shipmentSellerId, 'system');
    } catch (payoutErr) {
      logger.warn('[NIMBUS_WEBHOOK][PAYOUT] Failed to sync payout state:', payoutErr?.message || payoutErr);
    }
  }

  return { statusCode: 200, body: { message: 'NimbusPost webhook processed.' } };
}

module.exports = {
  processNimbuspostWebhook,
  isNimbusWebhookAuthorized,
  extractNimbusWebhookAwb,
  extractNimbusWebhookStatus,
  extractNimbusWebhookNote,
  mapNimbusStatusToShipmentStatus,
};