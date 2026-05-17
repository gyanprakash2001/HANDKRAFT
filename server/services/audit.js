const mongoose = require('mongoose');
const WebhookAudit = require('../models/WebhookAudit');
const PaymentReconciliation = require('../models/PaymentReconciliation');
const ShipmentEvent = require('../models/ShipmentEvent');
const SellerAction = require('../models/SellerAction');
const InventoryTransaction = require('../models/InventoryTransaction');
const OrderAuditLog = require('../models/OrderAuditLog');

/**
 * Central audit service — fire-and-forget helpers.
 *
 * Every function is async and internally try/catch-wrapped.
 * Callers should NOT await these unless they specifically need
 * confirmation that the audit record was persisted.
 *
 * Design principles:
 *   - Append-only: no updates or deletes
 *   - Fire-and-forget: never throws, never blocks the caller
 *   - Minimal overhead: each call is a single insert
 */

const LOG_PREFIX = '[AUDIT]';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeStr(value, maxLen = 500) {
  const raw = String(value ?? '').trim();
  return raw.length > maxLen ? raw.slice(0, maxLen) : raw;
}

function safeObjectId(value) {
  const raw = String(value ?? '').trim();
  return raw && mongoose.Types.ObjectId.isValid(raw)
    ? new mongoose.Types.ObjectId(raw)
    : null;
}

function safeMixed(value, maxDepth = 4) {
  if (value === undefined || value === null) return null;
  try {
    // Ensure it's serializable and not excessively large
    const serialized = JSON.stringify(value);
    if (serialized.length > 50000) {
      return { _truncated: true, sizeBytes: serialized.length };
    }
    return JSON.parse(serialized);
  } catch {
    return { _serializationError: true, type: typeof value };
  }
}

function sanitizeHeaders(headers = {}) {
  if (!headers || typeof headers !== 'object') return null;
  // Capture only relevant webhook headers, omit sensitive/large ones
  const keys = [
    'content-type', 'x-razorpay-signature', 'x-razorpay-event-id',
    'x-webhook-secret', 'x-nimbuspost-secret', 'x-api-key',
    'x-hmac-sha256', 'x-forwarded-for', 'user-agent',
    'x-request-id', 'host',
  ];
  const result = {};
  for (const key of keys) {
    if (headers[key] !== undefined) {
      result[key] = safeStr(headers[key], 200);
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

function nowMs() {
  return Date.now();
}

// ---------------------------------------------------------------------------
// 1. WebhookAudit
// ---------------------------------------------------------------------------

/**
 * Log a webhook receipt and processing result.
 *
 * @param {object} data
 * @param {string} data.provider - 'razorpay' | 'nimbuspost'
 * @param {string} [data.event] - Webhook event type
 * @param {string} [data.idempotencyKey] - Unique key (e.g. razorpay event_id, nimbus awb+status)
 * @param {string} [data.signature] - Raw signature header
 * @param {boolean} [data.signatureValid] - Verification result
 * @param {object} [data.payload] - Full webhook body
 * @param {object} [data.headers] - Request headers
 * @param {object} [data.processingResult] - What our handler returned
 * @param {string} [data.orderId] - Linked order
 * @param {string} [data.awbNumber] - AWB (NimbusPost)
 * @param {string} [data.gatewayOrderId] - Razorpay order ID
 * @param {string} [data.gatewayPaymentId] - Razorpay payment ID
 * @param {number} [data.httpStatusCode] - Response status
 * @param {number} [data.processingMs] - Processing duration
 * @param {string} [data.error] - Error message if failed
 * @param {string} [data.ip] - Source IP
 */
async function logWebhookAudit(data = {}) {
  try {
    const doc = {
      provider: safeStr(data.provider || 'unknown', 20),
      event: safeStr(data.event, 100),
      idempotencyKey: safeStr(data.idempotencyKey, 200) || undefined,
      signature: safeStr(data.signature, 500),
      signatureValid: data.signatureValid ?? null,
      payload: safeMixed(data.payload),
      headers: sanitizeHeaders(data.headers),
      processingResult: safeMixed(data.processingResult),
      orderId: safeObjectId(data.orderId),
      awbNumber: safeStr(data.awbNumber, 50),
      gatewayOrderId: safeStr(data.gatewayOrderId, 100),
      gatewayPaymentId: safeStr(data.gatewayPaymentId, 100),
      httpStatusCode: Number(data.httpStatusCode || 0),
      processingMs: Math.max(0, Number(data.processingMs || 0)),
      error: safeStr(data.error, 1000),
      ip: safeStr(data.ip, 50),
      receivedAt: data.receivedAt || new Date(),
    };

    // Skip empty idempotency keys to avoid unique constraint issues
    if (!doc.idempotencyKey) {
      delete doc.idempotencyKey;
    }

    await WebhookAudit.create(doc);
  } catch (err) {
    // Duplicate idempotency key — that's expected for replays, not an error
    if (err?.code === 11000 && String(err?.message || '').includes('idempotencyKey')) {
      console.log(`${LOG_PREFIX}[WEBHOOK] Duplicate idempotency key ignored: ${safeStr(data.idempotencyKey, 40)}`);
      return;
    }
    console.warn(`${LOG_PREFIX}[WEBHOOK] Failed to log webhook audit:`, err?.message || err);
  }
}

// ---------------------------------------------------------------------------
// 2. PaymentReconciliation
// ---------------------------------------------------------------------------

/**
 * Log a payment reconciliation event.
 *
 * @param {object} data
 * @param {string} data.orderId
 * @param {string} data.sellerId
 * @param {string} data.event - One of the reconciliation event types
 * @param {object} [data.snapshot] - Full split breakdown
 * @param {string} [data.payoutId]
 * @param {string} [data.payoutStatus]
 * @param {string} [data.gatewayPaymentId]
 * @param {string} [data.gatewayOrderId]
 * @param {string} [data.currency]
 * @param {number} [data.amount]
 * @param {string} [data.note]
 * @param {string} [data.source]
 */
async function logPaymentReconciliation(data = {}) {
  try {
    const orderOid = safeObjectId(data.orderId);
    const sellerOid = safeObjectId(data.sellerId);
    if (!orderOid || !sellerOid) {
      return;
    }

    await PaymentReconciliation.create({
      order: orderOid,
      seller: sellerOid,
      event: safeStr(data.event, 50),
      snapshot: safeMixed(data.snapshot),
      payoutId: safeObjectId(data.payoutId),
      payoutStatus: safeStr(data.payoutStatus, 30),
      gatewayPaymentId: safeStr(data.gatewayPaymentId, 100),
      gatewayOrderId: safeStr(data.gatewayOrderId, 100),
      currency: safeStr(data.currency || 'INR', 10),
      amount: Number(data.amount || 0),
      note: safeStr(data.note, 500),
      source: safeStr(data.source || 'system', 20),
    });
  } catch (err) {
    console.warn(`${LOG_PREFIX}[RECONCILIATION] Failed:`, err?.message || err);
  }
}

// ---------------------------------------------------------------------------
// 3. ShipmentEvent
// ---------------------------------------------------------------------------

/**
 * Log a shipment lifecycle event.
 *
 * @param {object} data
 * @param {string} data.orderId
 * @param {string} [data.sellerId]
 * @param {string} [data.localShipmentRef]
 * @param {string} data.event - One of the shipment event types
 * @param {string} [data.previousStatus]
 * @param {string} [data.newStatus]
 * @param {object} [data.carrier]
 * @param {object} [data.quoteData]
 * @param {string} [data.errorMessage]
 * @param {object} [data.payload]
 * @param {string} [data.source]
 * @param {number} [data.processingMs]
 */
async function logShipmentEvent(data = {}) {
  try {
    const orderOid = safeObjectId(data.orderId);
    if (!orderOid) return;

    await ShipmentEvent.create({
      order: orderOid,
      seller: safeObjectId(data.sellerId),
      localShipmentRef: safeStr(data.localShipmentRef, 50),
      event: safeStr(data.event, 50),
      previousStatus: safeStr(data.previousStatus, 30),
      newStatus: safeStr(data.newStatus, 30),
      carrier: safeMixed(data.carrier),
      quoteData: safeMixed(data.quoteData),
      errorMessage: safeStr(data.errorMessage, 1000),
      payload: safeMixed(data.payload),
      source: safeStr(data.source || 'system', 20),
      processingMs: Math.max(0, Number(data.processingMs || 0)),
    });
  } catch (err) {
    console.warn(`${LOG_PREFIX}[SHIPMENT] Failed:`, err?.message || err);
  }
}

// ---------------------------------------------------------------------------
// 4. SellerAction
// ---------------------------------------------------------------------------

/**
 * Log a seller self-service action.
 *
 * @param {object} data
 * @param {string} data.sellerId
 * @param {string} data.action - One of the seller action types
 * @param {object} [data.before]
 * @param {object} [data.after]
 * @param {object} [data.meta]
 * @param {string} [data.note]
 * @param {string} [data.source]
 * @param {string} [data.ip]
 * @param {string} [data.userAgent]
 */
async function logSellerAction(data = {}) {
  try {
    const sellerOid = safeObjectId(data.sellerId);
    if (!sellerOid) return;

    await SellerAction.create({
      seller: sellerOid,
      action: safeStr(data.action, 50),
      before: safeMixed(data.before),
      after: safeMixed(data.after),
      meta: safeMixed(data.meta),
      note: safeStr(data.note, 500),
      source: safeStr(data.source || 'seller', 20),
      ip: safeStr(data.ip, 50),
      userAgent: safeStr(data.userAgent, 300),
    });
  } catch (err) {
    console.warn(`${LOG_PREFIX}[SELLER_ACTION] Failed:`, err?.message || err);
  }
}

// ---------------------------------------------------------------------------
// 5. InventoryTransaction
// ---------------------------------------------------------------------------

/**
 * Log an inventory transaction (stock change).
 *
 * @param {object} data
 * @param {string} data.productId
 * @param {string} [data.orderId]
 * @param {string} [data.sellerId]
 * @param {string} data.type - One of the transaction types
 * @param {number} data.quantityChange - Signed (+/-)
 * @param {number} data.previousStock
 * @param {number} data.newStock
 * @param {string} [data.reason]
 * @param {string} [data.source]
 * @param {string} [data.reversalOf]
 * @param {object} [data.meta]
 */
async function logInventoryTransaction(data = {}) {
  try {
    const productOid = safeObjectId(data.productId);
    if (!productOid) return;

    await InventoryTransaction.create({
      product: productOid,
      order: safeObjectId(data.orderId),
      seller: safeObjectId(data.sellerId),
      type: safeStr(data.type, 30),
      quantityChange: Number(data.quantityChange || 0),
      previousStock: Math.max(0, Number(data.previousStock || 0)),
      newStock: Math.max(0, Number(data.newStock ?? data.previousStock ?? 0)),
      reason: safeStr(data.reason, 500),
      source: safeStr(data.source || 'system', 20),
      reversalOf: safeObjectId(data.reversalOf),
      meta: safeMixed(data.meta),
    });
  } catch (err) {
    console.warn(`${LOG_PREFIX}[INVENTORY] Failed:`, err?.message || err);
  }
}

// ---------------------------------------------------------------------------
// 6. OrderAuditLog
// ---------------------------------------------------------------------------

/**
 * Log an order state transition.
 *
 * @param {object} data
 * @param {string} data.orderId
 * @param {string} [data.actorId] - Who caused this (userId)
 * @param {string} [data.actorRole] - buyer/seller/admin/system/webhook/scheduler
 * @param {string} data.event - One of the order audit event types
 * @param {object} [data.previousState]
 * @param {object} [data.newState]
 * @param {object} [data.meta]
 * @param {string} [data.note]
 */
async function logOrderAudit(data = {}) {
  try {
    const orderOid = safeObjectId(data.orderId);
    if (!orderOid) return;

    await OrderAuditLog.create({
      order: orderOid,
      actor: safeObjectId(data.actorId),
      actorRole: safeStr(data.actorRole || 'system', 20),
      event: safeStr(data.event, 50),
      previousState: safeMixed(data.previousState),
      newState: safeMixed(data.newState),
      meta: safeMixed(data.meta),
      note: safeStr(data.note, 1000),
    });
  } catch (err) {
    console.warn(`${LOG_PREFIX}[ORDER] Failed:`, err?.message || err);
  }
}

// ---------------------------------------------------------------------------
// Convenience: batch log multiple order audit entries
// ---------------------------------------------------------------------------

async function logOrderAuditBatch(entries = []) {
  for (const entry of (entries || [])) {
    await logOrderAudit(entry);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  logWebhookAudit,
  logPaymentReconciliation,
  logShipmentEvent,
  logSellerAction,
  logInventoryTransaction,
  logOrderAudit,
  logOrderAuditBatch,
  // Helpers exposed for testing
  safeStr,
  safeObjectId,
  safeMixed,
  sanitizeHeaders,
  nowMs,
};
