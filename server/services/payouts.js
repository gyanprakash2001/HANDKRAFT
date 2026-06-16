const mongoose = require('mongoose');
const { env } = require('../config/env');
const Order = require('../models/Order');
const User = require('../models/User');
const Payout = require('../models/Payout');
const { logPaymentReconciliation, logSellerAction } = require('./audit');

function roundCurrency(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Number(parsed.toFixed(2));
}

function isBankDetailsComplete(seller) {
  const bank = seller?.sellerPayoutProfile?.bankDetails;
  if (!bank) return false;
  const type = String(bank.accountType || 'bank').toLowerCase();
  if (type === 'upi') {
    return Boolean(String(bank.upiId || '').trim());
  }
  // Bank account: need at minimum an account number (or masked) + IFSC.
  const hasAccount = Boolean(String(bank.accountNumber || bank.accountNumberMasked || '').trim());
  const hasIfsc = Boolean(String(bank.ifsc || '').trim());
  return hasAccount && hasIfsc;
}

function createInternalPayoutReference() {
  const now = new Date();
  const datePart = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `HKT-${datePart}-${rand}`;
}

function getPayoutPolicy() {
  const configured = env?.payouts || {};
  // 2-day hold after delivery before payout can be requested.
  const holdDaysAfterDelivery = Math.max(0, Math.floor(Number(configured.holdDaysAfterDelivery ?? 2)));
  // Flat platform fee per order in INR (default ₹8, includes CSR).
  const platformFeeFlat = Math.max(0, Number(configured.platformFeeFlat ?? 8));
  // CSR portion of the platform fee (default ₹1).
  const csrAmount = Math.min(platformFeeFlat, Math.max(0, Number(configured.csrAmount ?? 1)));

  return {
    holdDaysAfterDelivery,
    claimMode: 'manual',
    platformFeeFlat,
    csrAmount,
    // Legacy fields — always 0 now.
    defaultPlatformFeePercent: 0,
    defaultReservePercent: 0,
    defaultMinimumPayoutAmount: Number(configured.defaultMinimumPayoutAmount || 0),
    trustedOrderThreshold: 1,
    defaultCoolingDays: holdDaysAfterDelivery,
    trustedCoolingDays: holdDaysAfterDelivery,
  };
}

function toObjectId(value) {
  const raw = String(value || '').trim();
  if (!raw || !mongoose.Types.ObjectId.isValid(raw)) {
    return null;
  }

  return new mongoose.Types.ObjectId(raw);
}

function appendPayoutTimeline(payout, { status, note, source = 'system' }) {
  payout.timeline = Array.isArray(payout.timeline) ? payout.timeline : [];
  payout.timeline.push({
    status,
    note: String(note || ''),
    source,
    at: new Date(),
  });
}

function applyPayoutDeliveryHold(payout, { coolingDays = 0, source = 'system', now = new Date() } = {}) {
  const normalizedCoolingDays = Math.max(0, Number(coolingDays || 0));
  const releaseImmediately = normalizedCoolingDays <= 0;
  const holdUntil = new Date(now.getTime() + (normalizedCoolingDays * 24 * 60 * 60 * 1000));

  payout.status = releaseImmediately ? 'ready_for_payout' : 'on_hold';
  payout.deliveredAt = payout.deliveredAt || now;
  payout.holdStartedAt = now;
  payout.holdUntil = releaseImmediately ? now : holdUntil;
  payout.payout = Object.assign({}, payout.payout || {}, {
    mode: 'manual',
    provider: 'internal',
    failureReason: '',
  });

  appendPayoutTimeline(payout, {
    status: payout.status,
    note: releaseImmediately
      ? 'Delivery completed. Amount is now available in seller wallet for claim.'
      : `Delivery completed. Payout moved to hold for ${normalizedCoolingDays} day(s).`,
    source,
  });

  return payout;
}

function releasePayoutFromHold(payout, { source = 'scheduler' } = {}) {
  payout.status = 'ready_for_payout';
  payout.payout = Object.assign({}, payout.payout || {}, {
    mode: 'manual',
    provider: 'internal',
    failureReason: '',
  });

  appendPayoutTimeline(payout, {
    status: 'ready_for_payout',
    note: 'Hold completed. Amount is now available in seller wallet for manual claim.',
    source,
  });

  return payout;
}

function getSellerItems(order, sellerId) {
  const normalized = String(sellerId || '');
  return (order?.items || []).filter((item) => String(item?.seller || '') === normalized);
}

function getSellerShipmentRef(order, sellerId) {
  const normalized = String(sellerId || '');
  const shipment = (order?.sellerShipments || []).find((entry) => String(entry?.seller || '') === normalized);
  return shipment?.localShipmentRef || '';
}

function computeSellerSplit(order, sellerId, policy = {}) {
  const sellerItems = getSellerItems(order, sellerId);
  // Use discountedPrice if available — this is the price the seller actually posted.
  // Fall back to price if discountedPrice is not set.
  const itemSubtotal = roundCurrency(
    sellerItems.reduce((sum, item) => {
      const unitPrice = Number(item?.discountedPrice) > 0
        ? Number(item.discountedPrice)
        : Number(item?.price) || 0;
      return sum + (unitPrice * (Number(item?.quantity) || 0));
    }, 0)
  );

  const orderSubtotal = Number(order?.subtotal || 0);
  const orderShippingCost = Number(order?.shippingCost || 0);
  const shippingShare = orderSubtotal > 0
    ? roundCurrency(orderShippingCost * (itemSubtotal / orderSubtotal))
    : 0;

  // Platform fee is a flat ₹8 per order (not percentage). Includes ₹1 CSR.
  const platformFeeFlat = Math.max(0, Number(policy?.platformFeeFlat ?? 8));
  const csrAmount = Math.min(platformFeeFlat, Math.max(0, Number(policy?.csrAmount ?? 1)));
  // platformFeeAmount is the same as platformFeeFlat (kept for legacy field compat).
  const platformFeeAmount = platformFeeFlat;

  const grossAmount = roundCurrency(itemSubtotal);
  const shippingDeduction = shippingShare;
  const deductionsTotal = roundCurrency(shippingDeduction + platformFeeFlat);
  const basePayoutAmount = roundCurrency(Math.max(0, grossAmount - deductionsTotal));

  return {
    itemSubtotal,
    shippingShare,
    shippingDeduction,
    grossAmount,
    platformFeeFlat,
    csrAmount,
    platformFeePercent: 0,
    platformFeeAmount,
    deductionsTotal,
    basePayoutAmount,
    sellerItems,
  };
}

async function countDeliveredOrdersForSeller(sellerId) {
  const sellerObjectId = toObjectId(sellerId);
  if (!sellerObjectId) {
    return 0;
  }

  const byShipmentCount = await Order.countDocuments({
    paymentStatus: 'completed',
    sellerShipments: {
      $elemMatch: {
        seller: sellerObjectId,
        status: 'delivered',
      },
    },
  });

  if (byShipmentCount > 0) {
    return byShipmentCount;
  }

  // Fallback for older records where shipment snapshots may be incomplete.
  const rows = await Order.aggregate([
    { $match: { paymentStatus: 'completed' } },
    { $unwind: '$items' },
    {
      $match: {
        'items.seller': sellerObjectId,
        'items.fulfillmentStatus': 'delivered',
      },
    },
    { $group: { _id: '$_id' } },
    { $count: 'count' },
  ]);

  return Number(rows?.[0]?.count || 0);
}

function resolveSellerReservePercent(seller, policy) {
  const sellerReserve = Number(seller?.sellerPayoutSettings?.reservePercent);
  if (Number.isFinite(sellerReserve) && sellerReserve >= 0 && sellerReserve <= 100) {
    return sellerReserve;
  }

  return Number(policy.defaultReservePercent || 0);
}

function resolveSellerMinimumPayoutAmount(seller, policy) {
  const configured = Number(seller?.sellerPayoutSettings?.minimumPayoutAmount);
  if (Number.isFinite(configured) && configured >= 0) {
    return configured;
  }

  return Number(policy.defaultMinimumPayoutAmount || 0);
}

function resolveCoolingDays(policy) {
  return Math.max(0, Number(policy.holdDaysAfterDelivery || 0));
}

function buildTrustSnapshot(seller, coolingDays) {
  return {
    deliveredOrderCount: Number(seller?.sellerTrust?.deliveredOrderCount || 0),
    trustedThreshold: 1,
    isTrusted: false,
    coolingDays,
  };
}

async function upsertOrderSellerPayout(order, sellerId) {
  const sellerObjectId = toObjectId(sellerId);
  if (!sellerObjectId) {
    return null;
  }

  const policy = getPayoutPolicy();
  const splitResult = computeSellerSplit(order, sellerObjectId, policy);

  if (splitResult.grossAmount <= 0) {
    return null;
  }

  const seller = await User.findById(sellerObjectId);
  if (!seller) {
    return null;
  }

  // Reserve is removed from the new formula — seller receives full base payout amount.
  const reservePercent = 0;
  const reserveAmount = 0;
  const netPayoutAmount = roundCurrency(Math.max(0, splitResult.basePayoutAmount));

  const coolingDays = resolveCoolingDays(policy);

  let payout = await Payout.findOne({ order: order._id, seller: sellerObjectId });

  const nextSplit = {
    itemSubtotal: splitResult.itemSubtotal,
    shippingShare: splitResult.shippingShare,
    shippingDeduction: splitResult.shippingDeduction,
    grossAmount: splitResult.grossAmount,
    platformFeeFlat: splitResult.platformFeeFlat,
    csrAmount: splitResult.csrAmount,
    platformFeePercent: 0,
    platformFeeAmount: splitResult.platformFeeAmount,
    deductionsTotal: splitResult.deductionsTotal,
    basePayoutAmount: splitResult.basePayoutAmount,
    reservePercent: 0,
    reserveAmount: 0,
    netPayoutAmount,
    refundedAmount: Number(payout?.split?.refundedAmount || 0),
  };

  const trustSnapshot = buildTrustSnapshot(seller, coolingDays);

  if (!payout) {
    payout = new Payout({
      seller: sellerObjectId,
      order: order._id,
      sellerShipmentRef: getSellerShipmentRef(order, sellerObjectId),
      currency: String(order?.paymentGateway?.currency || 'INR').toUpperCase(),
      status: 'awaiting_delivery',
      split: nextSplit,
      trustSnapshot,
      timeline: [
        {
          status: 'awaiting_delivery',
          note: 'Payment captured. Payout record created and waiting for delivery confirmation.',
          source: 'system',
          at: new Date(),
        },
      ],
    });

    await payout.save();
    return payout;
  }

  payout.sellerShipmentRef = getSellerShipmentRef(order, sellerObjectId);
  payout.currency = String(order?.paymentGateway?.currency || payout.currency || 'INR').toUpperCase();
  payout.split = nextSplit;
  payout.trustSnapshot = trustSnapshot;

  await payout.save();
  return payout;
}

async function ensureOrderPayoutRecords(order) {
  const sellerIds = Array.from(
    new Set(
      (order?.items || [])
        .map((item) => String(item?.seller || '').trim())
        .filter((sellerId) => mongoose.Types.ObjectId.isValid(sellerId))
    )
  );

  const payouts = [];
  for (const sellerId of sellerIds) {
    const payout = await upsertOrderSellerPayout(order, sellerId);
    if (payout) {
      payouts.push(payout);
    }
  }

  return payouts;
}

function getSellerDeliveryState(order, sellerId) {
  const sellerItems = getSellerItems(order, sellerId);
  const sellerShipment = (order?.sellerShipments || []).find(
    (entry) => String(entry?.seller || '') === String(sellerId)
  );

  const shipmentStatus = String(sellerShipment?.status || '').toLowerCase();
  const shipmentDelivered = shipmentStatus === 'delivered';

  if (sellerItems.length === 0) {
    return {
      hasItems: false,
      allCancelled: false,
      deliveryComplete: shipmentDelivered,
    };
  }

  const statuses = sellerItems.map((item) => String(item?.fulfillmentStatus || 'new').toLowerCase());
  const allCancelled = statuses.every((status) => status === 'cancelled');
  const allCompleted = statuses.every((status) => status === 'delivered' || status === 'cancelled');
  const hasDelivered = statuses.some((status) => status === 'delivered');

  return {
    hasItems: true,
    allCancelled,
    deliveryComplete: shipmentDelivered || (allCompleted && hasDelivered),
  };
}

async function syncSellerPayoutAfterFulfillment(order, sellerId, source = 'system') {
  const sellerObjectId = toObjectId(sellerId);
  if (!sellerObjectId) {
    return null;
  }

  const payout = await upsertOrderSellerPayout(order, sellerObjectId);
  if (!payout) {
    return null;
  }

  if (['paid', 'reversed'].includes(String(payout.status))) {
    return payout;
  }

  const deliveryState = getSellerDeliveryState(order, sellerObjectId);
  if (!deliveryState.hasItems) {
    return payout;
  }

  if (deliveryState.allCancelled) {
    payout.status = 'cancelled';
    payout.deliveredAt = payout.deliveredAt || null;
    payout.holdStartedAt = null;
    payout.holdUntil = null;
    appendPayoutTimeline(payout, {
      status: 'cancelled',
      note: 'All seller items in this order were cancelled. Payout cancelled.',
      source,
    });
    await payout.save();
    return payout;
  }

  if (!deliveryState.deliveryComplete) {
    return payout;
  }

  const policy = getPayoutPolicy();
  const coolingDays = resolveCoolingDays(policy);

  const now = new Date();
  applyPayoutDeliveryHold(payout, { coolingDays, source, now });
  const seller = await User.findById(sellerObjectId).select('sellerTrust');
  payout.trustSnapshot = buildTrustSnapshot(seller, coolingDays);

  await payout.save();

  // Audit: payout hold started
  logPaymentReconciliation({
    orderId: order._id,
    sellerId: sellerObjectId,
    event: 'payout_hold_started',
    snapshot: payout.split ? payout.split.toObject ? payout.split.toObject() : payout.split : null,
    payoutId: payout._id,
    payoutStatus: payout.status,
    note: `Delivery confirmed. Payout moved to ${payout.status} (cooling: ${coolingDays} day(s)).`,
    source,
  });

  return payout;
}

function isBankDetailsComplete(seller) {
  const profile = seller?.sellerPayoutProfile || {};
  const bank = profile?.bankDetails || {};
  const accountType = String(bank.accountType || 'bank').toLowerCase();

  if (String(profile.kycStatus || '').toLowerCase() !== 'verified') {
    return false;
  }

  if (accountType === 'upi') {
    return Boolean(String(bank.upiId || '').trim());
  }

  return Boolean(String(bank.accountNumber || '').trim() && String(bank.ifsc || '').trim());
}

function createInternalPayoutReference() {
  const ts = Date.now().toString().slice(-8);
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `HKP-${ts}-${rand}`;
}

function maskBankDetails(bankDetails = {}) {
  const accountNumber = String(bankDetails.accountNumber || '');
  const accountSuffix = accountNumber ? accountNumber.slice(-4) : '';

  return {
    accountHolderName: String(bankDetails.accountHolderName || ''),
    accountNumberMasked: accountSuffix ? `XXXXXX${accountSuffix}` : '',
    ifsc: String(bankDetails.ifsc || ''),
    bankName: String(bankDetails.bankName || ''),
    branch: String(bankDetails.branch || ''),
    upiId: String(bankDetails.upiId || ''),
    accountType: String(bankDetails.accountType || 'bank'),
    razorpayLinkedAccountId: String(bankDetails.razorpayLinkedAccountId || ''),
    isVerified: Boolean(bankDetails.isVerified),
    verifiedAt: bankDetails.verifiedAt || null,
  };
}

async function processDuePayouts({ limit = 50 } = {}) {
  const now = new Date();
  const duePayouts = await Payout.find({
    status: 'on_hold',
    holdUntil: { $lte: now },
  })
    .sort({ holdUntil: 1, createdAt: 1 })
    .limit(Math.max(1, Number(limit || 50)));

  let releasedCount = 0;
  let failedCount = 0;

  for (const payout of duePayouts) {
    const seller = await User.findById(payout.seller);

    if (!seller) {
      payout.status = 'failed';
      payout.payout = Object.assign({}, payout.payout || {}, {
        initiatedAt: now,
        failureReason: 'Seller account not found for payout.',
      });
      appendPayoutTimeline(payout, {
        status: 'failed',
        note: 'Automatic payout failed because seller profile could not be loaded.',
        source: 'scheduler',
      });
      await payout.save();
      failedCount += 1;
      continue;
    }

    releasePayoutFromHold(payout, { source: 'scheduler' });

    await payout.save();
    releasedCount += 1;

    // Audit: payout released from hold
    logPaymentReconciliation({
      orderId: payout.order,
      sellerId: payout.seller,
      event: 'payout_released',
      snapshot: payout.split ? (payout.split.toObject ? payout.split.toObject() : payout.split) : null,
      payoutId: payout._id,
      payoutStatus: 'ready_for_payout',
      note: 'Hold period expired. Payout released to seller wallet.',
      source: 'scheduler',
    });
  }

  return {
    scanned: duePayouts.length,
    releasedCount,
    // Legacy compatibility for existing clients still reading these keys.
    paidCount: 0,
    pendingActionCount: releasedCount,
    failedCount,
  };
}

async function claimReadyPayoutsInternal({ sellerId = null, payoutIds = [], limit = 50, source = 'seller' } = {}) {
  const normalizedLimit = Math.min(Math.max(Number(limit || 50), 1), 500);
  const policy = getPayoutPolicy();

  const query = {
    status: 'ready_for_payout',
  };

  if (sellerId) {
    const sellerObjectId = toObjectId(sellerId);
    if (!sellerObjectId) {
      throw new Error('Invalid seller id');
    }
    query.seller = sellerObjectId;
  }

  const normalizedIds = Array.isArray(payoutIds)
    ? payoutIds
      .map((id) => String(id || '').trim())
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id))
    : [];

  if (normalizedIds.length > 0) {
    query._id = { $in: normalizedIds };
  }

  const payouts = await Payout.find(query)
    .sort({ holdUntil: 1, createdAt: 1 })
    .limit(normalizedLimit);

  if (payouts.length === 0) {
    return {
      scanned: 0,
      claimedCount: 0,
      claimedAmount: 0,
      blockedCount: 0,
      blocked: [],
    };
  }

  const sellerIds = Array.from(new Set(payouts.map((entry) => String(entry.seller || ''))))
    .filter((id) => mongoose.Types.ObjectId.isValid(id));

  const sellers = sellerIds.length > 0
    ? await User.find({ _id: { $in: sellerIds } })
      .select('sellerPayoutProfile sellerPayoutSettings')
      .lean()
    : [];
  const sellerMap = new Map((sellers || []).map((entry) => [String(entry._id), entry]));

  const blocked = [];
  let claimedCount = 0;
  let claimedAmount = 0;

  for (const payout of payouts) {
    const seller = sellerMap.get(String(payout.seller || ''));
    if (!seller) {
      payout.status = 'failed';
      payout.payout = Object.assign({}, payout.payout || {}, {
        initiatedAt: new Date(),
        failureReason: 'Seller account not found for payout claim.',
      });
      appendPayoutTimeline(payout, {
        status: 'failed',
        note: 'Payout claim failed because seller profile is unavailable.',
        source,
      });
      await payout.save();

      blocked.push({
        payoutId: String(payout._id),
        orderId: String(payout.order || ''),
        reason: 'Seller account not found for payout claim.',
      });
      continue;
    }

    const minPayoutAmount = resolveSellerMinimumPayoutAmount(seller, policy);
    const netPayoutAmount = Number(payout?.split?.netPayoutAmount || 0);

    if (!isBankDetailsComplete(seller)) {
      const reason = 'Complete KYC and settlement account details before claiming this payout.';
      payout.payout = Object.assign({}, payout.payout || {}, { failureReason: reason });
      appendPayoutTimeline(payout, {
        status: 'ready_for_payout',
        note: 'Claim attempt blocked: KYC or settlement account details are incomplete.',
        source,
      });
      await payout.save();

      blocked.push({
        payoutId: String(payout._id),
        orderId: String(payout.order || ''),
        reason,
      });
      continue;
    }

    if (netPayoutAmount < minPayoutAmount) {
      const reason = `Payout amount (${netPayoutAmount}) is below your minimum claim threshold (${minPayoutAmount}).`;
      payout.payout = Object.assign({}, payout.payout || {}, { failureReason: reason });
      appendPayoutTimeline(payout, {
        status: 'ready_for_payout',
        note: `Claim attempt blocked: amount below minimum threshold (${minPayoutAmount}).`,
        source,
      });
      await payout.save();

      blocked.push({
        payoutId: String(payout._id),
        orderId: String(payout.order || ''),
        reason,
      });
      continue;
    }

    const now = new Date();
    payout.status = 'paid';
    payout.payout = Object.assign({}, payout.payout || {}, {
      mode: 'manual',
      provider: 'internal',
      referenceId: createInternalPayoutReference(),
      initiatedAt: now,
      paidAt: now,
      failureReason: '',
    });

    appendPayoutTimeline(payout, {
      status: 'paid',
      note: source === 'admin'
        ? 'Payout claimed and marked as paid by admin operation.'
        : 'Payout claimed from seller wallet and marked as paid.',
      source,
    });

    await payout.save();
    claimedCount += 1;
    claimedAmount += netPayoutAmount;

    // Audit: payout claimed
    logPaymentReconciliation({
      orderId: payout.order,
      sellerId: payout.seller,
      event: 'payout_claimed',
      snapshot: payout.split ? (payout.split.toObject ? payout.split.toObject() : payout.split) : null,
      payoutId: payout._id,
      payoutStatus: 'paid',
      amount: netPayoutAmount,
      note: `Payout claimed. Amount: ${netPayoutAmount}. Ref: ${payout.payout?.referenceId || ''}.`,
      source,
    });
    logSellerAction({
      sellerId: payout.seller,
      action: 'payout_claimed',
      after: { payoutId: String(payout._id), amount: netPayoutAmount, referenceId: payout.payout?.referenceId || '' },
      note: `Payout of ${netPayoutAmount} claimed.`,
      source,
    });
  }

  return {
    scanned: payouts.length,
    claimedCount,
    claimedAmount: roundCurrency(claimedAmount),
    blockedCount: blocked.length,
    blocked,
  };
}

function buildSummaryFromRows(rows = []) {
  const summary = {
    totalPayouts: 0,
    // incomingAmount: orders placed but not yet delivered
    incomingAmount: 0,
    // onHoldAmount: delivered, inside 2-day hold window
    onHoldAmount: 0,
    // readyAmount: hold expired, seller can request payout
    readyAmount: 0,
    // processingAmount: seller requested payout, awaiting admin settlement
    processingAmount: 0,
    // paidAmount: admin has settled the payout
    paidAmount: 0,
    // nextReleaseAt: earliest date any on-hold payout will unlock
    nextReleaseAt: null,
  };

  rows.forEach((entry) => {
    const net = Number(entry?.split?.netPayoutAmount || 0);
    summary.totalPayouts += 1;

    if (entry.status === 'awaiting_delivery') {
      summary.incomingAmount += net;
      return;
    }

    if (entry.status === 'on_hold') {
      summary.onHoldAmount += net;
      const holdUntil = entry?.holdUntil ? new Date(entry.holdUntil) : null;
      if (holdUntil && !Number.isNaN(holdUntil.getTime())) {
        if (!summary.nextReleaseAt || holdUntil.getTime() < new Date(summary.nextReleaseAt).getTime()) {
          summary.nextReleaseAt = holdUntil.toISOString();
        }
      }
      return;
    }

    if (entry.status === 'ready_for_payout') {
      summary.readyAmount += net;
      return;
    }

    if (entry.status === 'processing') {
      summary.processingAmount += net;
      return;
    }

    if (entry.status === 'paid') {
      summary.paidAmount += net;
    }
  });

  summary.incomingAmount = roundCurrency(summary.incomingAmount);
  summary.onHoldAmount = roundCurrency(summary.onHoldAmount);
  summary.readyAmount = roundCurrency(summary.readyAmount);
  summary.processingAmount = roundCurrency(summary.processingAmount);
  summary.paidAmount = roundCurrency(summary.paidAmount);
  // claimableAmount = ready_for_payout (can request withdrawal)
  summary.claimableAmount = summary.readyAmount;
  // Legacy fields for backward compatibility
  summary.awaitingDeliveryAmount = summary.incomingAmount;
  summary.reserveHeldAmount = 0;

  return summary;
}

async function claimSellerWallet(sellerId, { payoutIds = [], limit = 50, claimAll = false } = {}) {
  const sellerObjectId = toObjectId(sellerId);
  if (!sellerObjectId) {
    throw new Error('Invalid seller id');
  }

  if (!claimAll && (!Array.isArray(payoutIds) || payoutIds.length === 0)) {
    throw new Error('Provide payoutIds or set claimAll=true to claim from wallet.');
  }

  const releaseResult = await processDuePayouts({ limit: Math.max(50, Number(limit || 50)) });
  const claimResult = await claimReadyPayoutsInternal({
    sellerId: sellerObjectId,
    payoutIds: claimAll ? [] : payoutIds,
    limit,
    source: 'seller',
  });
  const dashboard = await getSellerPayoutDashboard(sellerObjectId, { page: 1, limit: 50 });

  return {
    releaseResult,
    claimResult,
    dashboard,
  };
}

async function getSellerPayoutDashboard(sellerId, { page = 1, limit = 20, status } = {}) {
  const sellerObjectId = toObjectId(sellerId);
  if (!sellerObjectId) {
    throw new Error('Invalid seller id');
  }

  const normalizedLimit = Math.min(Math.max(Number(limit || 20), 1), 100);
  const normalizedPage = Math.max(Number(page || 1), 1);
  const skip = (normalizedPage - 1) * normalizedLimit;

  const query = { seller: sellerObjectId };
  if (status) {
    query.status = String(status);
  }

  const [rows, total, seller] = await Promise.all([
    Payout.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(normalizedLimit)
      .lean(),
    Payout.countDocuments(query),
    User.findById(sellerObjectId)
      .select('name sellerTrust sellerPayoutProfile sellerPayoutSettings')
      .lean(),
  ]);

  const orderIds = rows.map((entry) => entry.order).filter(Boolean);
  const relatedOrders = orderIds.length > 0
    ? await Order.find({ _id: { $in: orderIds } })
      .select('_id subtotal shippingCost totalAmount createdAt paymentStatus')
      .lean()
    : [];

  const orderMap = new Map((relatedOrders || []).map((entry) => [String(entry._id), entry]));

  const summary = buildSummaryFromRows(rows);

  const payouts = rows.map((entry) => {
    const order = orderMap.get(String(entry.order));

    return {
      id: String(entry._id),
      orderId: String(entry.order),
      sellerShipmentRef: entry.sellerShipmentRef || '',
      status: entry.status,
      currency: entry.currency || 'INR',
      split: {
        itemSubtotal: Number(entry?.split?.itemSubtotal || 0),
        shippingShare: Number(entry?.split?.shippingShare || 0),
        shippingDeduction: Number(entry?.split?.shippingDeduction || 0),
        grossAmount: Number(entry?.split?.grossAmount || 0),
        platformFeePercent: Number(entry?.split?.platformFeePercent || 0),
        platformFeeAmount: Number(entry?.split?.platformFeeAmount || 0),
        deductionsTotal: Number(entry?.split?.deductionsTotal || 0),
        basePayoutAmount: Number(entry?.split?.basePayoutAmount || 0),
        reservePercent: Number(entry?.split?.reservePercent || 0),
        reserveAmount: Number(entry?.split?.reserveAmount || 0),
        netPayoutAmount: Number(entry?.split?.netPayoutAmount || 0),
        refundedAmount: Number(entry?.split?.refundedAmount || 0),
      },
      trustSnapshot: entry.trustSnapshot || null,
      deliveredAt: entry.deliveredAt || null,
      holdStartedAt: entry.holdStartedAt || null,
      holdUntil: entry.holdUntil || null,
      payout: {
        mode: entry?.payout?.mode || 'auto',
        provider: entry?.payout?.provider || 'internal',
        referenceId: entry?.payout?.referenceId || '',
        initiatedAt: entry?.payout?.initiatedAt || null,
        paidAt: entry?.payout?.paidAt || null,
        failureReason: entry?.payout?.failureReason || '',
      },
      order: {
        subtotal: Number(order?.subtotal || 0),
        shippingCost: Number(order?.shippingCost || 0),
        totalAmount: Number(order?.totalAmount || 0),
        paymentStatus: order?.paymentStatus || 'pending',
        createdAt: order?.createdAt || null,
      },
      timeline: Array.isArray(entry.timeline)
        ? entry.timeline.map((step) => ({
            status: step.status,
            note: step.note || '',
            source: step.source || 'system',
            at: step.at || null,
          }))
        : [],
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  });

  return {
    summary,
    payouts,
    pagination: {
      page: normalizedPage,
      limit: normalizedLimit,
      total,
      totalPages: Math.max(1, Math.ceil(total / normalizedLimit)),
    },
    seller: {
      id: String(seller?._id || sellerId),
      name: String(seller?.name || ''),
      deliveredOrderCount: Number(seller?.sellerTrust?.deliveredOrderCount || 0),
      payoutProfile: {
        kycStatus: String(seller?.sellerPayoutProfile?.kycStatus || 'pending'),
        kycVerifiedAt: seller?.sellerPayoutProfile?.kycVerifiedAt || null,
        bankDetails: maskBankDetails(seller?.sellerPayoutProfile?.bankDetails || {}),
      },
      payoutSettings: {
        minimumPayoutAmount: Number(seller?.sellerPayoutSettings?.minimumPayoutAmount || 0),
      },
      // Simplified wallet summary — the three numbers that matter to a seller:
      wallet: {
        availableToWithdraw: summary.claimableAmount,
        onHold: summary.onHoldAmount,
        incoming: summary.incomingAmount,
        totalPaid: summary.paidAmount,
        nextReleaseAt: summary.nextReleaseAt,
      },
      policy: getPayoutPolicy(),
    },
  };
}

async function getAdminPayoutDashboard({ page = 1, limit = 20, status, sellerId } = {}) {
  const normalizedLimit = Math.min(Math.max(Number(limit || 20), 1), 100);
  const normalizedPage = Math.max(Number(page || 1), 1);
  const skip = (normalizedPage - 1) * normalizedLimit;

  const query = {};
  if (status) {
    query.status = String(status);
  }

  if (sellerId) {
    const sellerObjectId = toObjectId(sellerId);
    if (!sellerObjectId) {
      throw new Error('Invalid seller id');
    }
    query.seller = sellerObjectId;
  }

  const [rows, total] = await Promise.all([
    Payout.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(normalizedLimit)
      .lean(),
    Payout.countDocuments(query),
  ]);

  const sellerIds = Array.from(new Set(rows.map((entry) => String(entry?.seller || ''))))
    .filter((id) => mongoose.Types.ObjectId.isValid(id));
  const orderIds = Array.from(new Set(rows.map((entry) => String(entry?.order || ''))))
    .filter((id) => mongoose.Types.ObjectId.isValid(id));

  const [sellers, orders] = await Promise.all([
    sellerIds.length > 0
      ? User.find({ _id: { $in: sellerIds } })
        .select('name email sellerPayoutProfile')
        .lean()
      : Promise.resolve([]),
    orderIds.length > 0
      ? Order.find({ _id: { $in: orderIds } })
        .select('_id paymentStatus createdAt totalAmount')
        .lean()
      : Promise.resolve([]),
  ]);

  const sellerMap = new Map((sellers || []).map((entry) => [String(entry._id), entry]));
  const orderMap = new Map((orders || []).map((entry) => [String(entry._id), entry]));

  const summary = buildSummaryFromRows(rows);

  const payouts = rows.map((entry) => {
    const seller = sellerMap.get(String(entry.seller || ''));
    const order = orderMap.get(String(entry.order || ''));

    return {
      id: String(entry._id),
      orderId: String(entry.order || ''),
      seller: {
        id: String(entry.seller || ''),
        name: String(seller?.name || ''),
        email: String(seller?.email || ''),
        kycStatus: String(seller?.sellerPayoutProfile?.kycStatus || 'pending'),
      },
      status: String(entry.status || ''),
      holdUntil: entry.holdUntil || null,
      deliveredAt: entry.deliveredAt || null,
      split: {
        itemSubtotal: Number(entry?.split?.itemSubtotal || 0),
        shippingDeduction: Number(entry?.split?.shippingDeduction || entry?.split?.shippingShare || 0),
        grossAmount: Number(entry?.split?.grossAmount || 0),
        platformFeeAmount: Number(entry?.split?.platformFeeAmount || 0),
        deductionsTotal: Number(entry?.split?.deductionsTotal || 0),
        basePayoutAmount: Number(entry?.split?.basePayoutAmount || 0),
        reserveAmount: Number(entry?.split?.reserveAmount || 0),
        netPayoutAmount: Number(entry?.split?.netPayoutAmount || 0),
      },
      payout: {
        referenceId: String(entry?.payout?.referenceId || ''),
        paidAt: entry?.payout?.paidAt || null,
        failureReason: String(entry?.payout?.failureReason || ''),
      },
      order: {
        paymentStatus: String(order?.paymentStatus || ''),
        createdAt: order?.createdAt || null,
        totalAmount: Number(order?.totalAmount || 0),
      },
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  });

  return {
    summary,
    payouts,
    pagination: {
      page: normalizedPage,
      limit: normalizedLimit,
      total,
      totalPages: Math.max(1, Math.ceil(total / normalizedLimit)),
    },
    policy: getPayoutPolicy(),
  };
}

async function claimAdminReadyPayouts({ sellerId, payoutIds = [], limit = 100, claimAll = false } = {}) {
  if (!claimAll && !sellerId && (!Array.isArray(payoutIds) || payoutIds.length === 0)) {
    throw new Error('Provide sellerId, payoutIds, or set claimAll=true.');
  }

  const releaseResult = await processDuePayouts({ limit: Math.max(100, Number(limit || 100)) });
  const claimResult = await claimReadyPayoutsInternal({
    sellerId: sellerId ? toObjectId(sellerId) : null,
    payoutIds: claimAll ? [] : payoutIds,
    limit,
    source: 'admin',
  });
  const dashboard = await getAdminPayoutDashboard({ page: 1, limit: 50 });

  return {
    releaseResult,
    claimResult,
    dashboard,
  };
}


// ─── requestSellerPayout ────────────────────────────────────────────────────
// Seller taps "Request Payout". Moves ready_for_payout → processing.
// Bank/KYC validation is required before this is accepted.
async function requestSellerPayout(sellerId, { payoutIds = [], requestAll = false } = {}) {
  const sellerObjectId = toObjectId(sellerId);
  if (!sellerObjectId) {
    throw new Error('Invalid seller id');
  }

  // First release any holds that have expired.
  await processDuePayouts({ limit: 100 });

  const query = { seller: sellerObjectId, status: 'ready_for_payout' };
  if (!requestAll && Array.isArray(payoutIds) && payoutIds.length > 0) {
    const normalizedIds = payoutIds
      .map((id) => String(id || '').trim())
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    if (normalizedIds.length > 0) {
      query._id = { $in: normalizedIds };
    }
  }

  const payouts = await Payout.find(query).sort({ createdAt: 1 }).limit(100);
  if (payouts.length === 0) {
    return { requested: 0, requestedAmount: 0, blocked: [] };
  }

  const seller = await User.findById(sellerObjectId)
    .select('name email sellerPayoutProfile sellerPayoutSettings')
    .lean();

  if (!seller) {
    throw new Error('Seller account not found');
  }

  if (!isBankDetailsComplete(seller)) {
    throw new Error('Complete KYC and add your bank/UPI details before requesting a payout.');
  }

  const blocked = [];
  let requested = 0;
  let requestedAmount = 0;

  for (const payout of payouts) {
    const net = Number(payout?.split?.netPayoutAmount || 0);

    payout.status = 'processing';
    payout.payout = Object.assign({}, payout.payout || {}, {
      mode: 'manual',
      provider: 'internal',
      failureReason: '',
      initiatedAt: new Date(),
    });

    appendPayoutTimeline(payout, {
      status: 'processing',
      note: 'Seller requested payout. Awaiting admin settlement (est. 2 hours).',
      source: 'seller',
    });

    await payout.save();
    requested += 1;
    requestedAmount += net;

    logSellerAction({
      sellerId: sellerObjectId,
      action: 'payout_requested',
      after: { payoutId: String(payout._id), amount: net },
      note: `Seller requested payout of ₹${net}. Pending admin settlement.`,
      source: 'seller',
    });
  }

  const dashboard = await getSellerPayoutDashboard(sellerObjectId, { page: 1, limit: 50 });

  return {
    requested,
    requestedAmount: roundCurrency(requestedAmount),
    blockedCount: blocked.length,
    blocked,
    dashboard,
  };
}

// ─── adminMarkPayoutsPaid ────────────────────────────────────────────────────
// Admin taps "Mark as Paid" after manually transferring funds.
// Moves processing → paid and generates an internal reference.
async function adminMarkPayoutsPaid({ payoutIds = [], sellerId, markAll = false } = {}) {
  const query = { status: 'processing' };

  if (sellerId) {
    const sellerObjectId = toObjectId(sellerId);
    if (!sellerObjectId) throw new Error('Invalid seller id');
    query.seller = sellerObjectId;
  }

  if (!markAll && Array.isArray(payoutIds) && payoutIds.length > 0) {
    const normalizedIds = payoutIds
      .map((id) => String(id || '').trim())
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    if (normalizedIds.length > 0) {
      query._id = { $in: normalizedIds };
    }
  }

  const payouts = await Payout.find(query).sort({ createdAt: 1 }).limit(200);
  if (payouts.length === 0) {
    return { settled: 0, settledAmount: 0 };
  }

  const now = new Date();
  let settled = 0;
  let settledAmount = 0;

  for (const payout of payouts) {
    const net = Number(payout?.split?.netPayoutAmount || 0);
    const referenceId = createInternalPayoutReference();

    payout.status = 'paid';
    payout.payout = Object.assign({}, payout.payout || {}, {
      mode: 'manual',
      provider: 'internal',
      referenceId,
      paidAt: now,
      failureReason: '',
    });

    appendPayoutTimeline(payout, {
      status: 'paid',
      note: `Admin settled payout. Reference: ${referenceId}. Amount: ₹${net}.`,
      source: 'admin',
    });

    await payout.save();
    settled += 1;
    settledAmount += net;

    logPaymentReconciliation({
      orderId: payout.order,
      sellerId: payout.seller,
      event: 'payout_settled_by_admin',
      payoutId: payout._id,
      payoutStatus: 'paid',
      amount: net,
      note: `Admin manually settled payout of ₹${net}. Ref: ${referenceId}.`,
      source: 'admin',
    });
  }

  const dashboard = await getAdminPayoutDashboard({ page: 1, limit: 100 });

  return {
    settled,
    settledAmount: roundCurrency(settledAmount),
    dashboard,
  };
}

module.exports = {

  ensureOrderPayoutRecords,
  syncSellerPayoutAfterFulfillment,
  processDuePayouts,
  requestSellerPayout,
  adminMarkPayoutsPaid,
  claimSellerWallet,
  getSellerPayoutDashboard,
  getAdminPayoutDashboard,
  claimAdminReadyPayouts,
  getPayoutPolicy,
  maskBankDetails,
  applyPayoutDeliveryHold,
  releasePayoutFromHold,
};
