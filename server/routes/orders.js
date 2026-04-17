const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const mongoose = require('mongoose');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const { env } = require('../config/env');
const {
  createShipment,
  getCourierServiceabilityQuote,
  isNimbuspostEnabled,
  trackShipmentByAwb,
} = require('../services/nimbuspost');
const {
  ensureOrderPayoutRecords,
  syncSellerPayoutAfterFulfillment,
} = require('../services/payouts');

// Helper: Calculate tax (assumed 5% for demo)
function calculateTax(subtotal) {
  return Number((subtotal * 0.05).toFixed(2));
}

function toPositiveNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function classifyNimbusQuoteError(rawMessage = '') {
  const normalizedRaw = String(rawMessage || '').trim();
  const normalized = normalizedRaw.toLowerCase();

  if (
    normalized.includes('nimbuspost is disabled')
    || normalized.includes('integration is disabled')
  ) {
    return {
      code: 'NIMBUS_DISABLED',
      retryable: false,
      userMessage: 'NimbusPost is disabled on server. Live shipping quote is required before checkout can continue.',
    };
  }

  if (normalized.includes('wallet balance is low')) {
    return {
      code: 'NIMBUS_WALLET_LOW',
      retryable: false,
      userMessage: 'Shipping partner wallet balance is low. Please recharge Nimbus wallet and try again.',
    };
  }

  if (
    normalized.includes('support email and phone number')
    || normalized.includes('otp-verified')
    || normalized.includes('otp verified')
  ) {
    return {
      code: 'NIMBUS_SUPPORT_CONTACT_NOT_VERIFIED',
      retryable: false,
      userMessage: 'Nimbus support email and phone must be OTP-verified in Label Settings before booking shipments.',
    };
  }

  if (normalized.includes('seller pickup address is missing or incomplete')) {
    return {
      code: 'SELLER_PICKUP_ADDRESS_INCOMPLETE',
      retryable: false,
      userMessage: 'One or more seller pickup addresses are incomplete. Please update seller pickup address details and retry.',
    };
  }

  if (
    normalized.includes('no courier quotes were returned')
    || normalized.includes('selected courier')
  ) {
    return {
      code: 'NIMBUS_NO_SERVICEABLE_COURIER',
      retryable: false,
      userMessage: 'No courier service is currently available for this address from one of the seller pickup locations.',
    };
  }

  if (normalized.includes('destination pincode is required')) {
    return {
      code: 'DESTINATION_PINCODE_REQUIRED',
      retryable: false,
      userMessage: 'Destination pincode is required to fetch live shipping quote.',
    };
  }

  if (
    normalized.includes('network error while calling')
    || normalized.includes('fetch failed')
    || normalized.includes('timed out')
    || normalized.includes('socket hang up')
  ) {
    return {
      code: 'NIMBUS_TEMPORARY_UNREACHABLE',
      retryable: true,
      userMessage: 'Nimbus is temporarily unreachable. Please retry in a few seconds.',
    };
  }

  return {
    code: 'NIMBUS_QUOTE_UNAVAILABLE',
    retryable: false,
    userMessage: normalizedRaw || 'Live shipping quote is currently unavailable. Please verify pincode and package details.',
  };
}

function estimateItemChargeableWeightGrams(item = {}) {
  const qty = Math.max(1, Math.round(toPositiveNumber(item?.quantity, 1)));
  const itemWeight = Math.max(0, Math.round(toPositiveNumber(item?.packageWeightGrams, 0)));
  const actualWeight = itemWeight > 0 ? itemWeight * qty : 0;

  const lengthCm = toPositiveNumber(item?.packageLengthCm, 0);
  const breadthCm = toPositiveNumber(item?.packageBreadthCm, 0);
  const heightCm = toPositiveNumber(item?.packageHeightCm, 0);
  const volumetricWeightPerItemGrams = lengthCm > 0 && breadthCm > 0 && heightCm > 0
    ? Math.ceil(((lengthCm * breadthCm * heightCm) / 5000) * 1000)
    : 0;
  const volumetricWeight = volumetricWeightPerItemGrams > 0
    ? volumetricWeightPerItemGrams * qty
    : 0;

  return Math.max(actualWeight, volumetricWeight, 0);
}

function estimateShipmentWeightGrams(items = []) {
  const perItemWeight = Math.max(0, Number(env.nimbuspost?.weightPerItemGrams || 0));
  const defaultWeight = Math.max(1, Math.round(Number(env.nimbuspost?.packageWeightGrams || 500)));

  let calculated = 0;
  for (const item of (items || [])) {
    const qty = Math.max(1, Number(item?.quantity || 1));
    const itemChargeableWeight = estimateItemChargeableWeightGrams(item);

    if (itemChargeableWeight > 0) {
      calculated += itemChargeableWeight;
    } else if (perItemWeight > 0) {
      calculated += Math.max(1, Math.round(perItemWeight)) * qty;
    }
  }

  if (calculated > 0) {
    return Math.max(1, Math.round(calculated));
  }

  return defaultWeight;
}

function buildPreferredCourierMap(selectedShippingQuotes = []) {
  const map = new Map();

  if (!Array.isArray(selectedShippingQuotes)) {
    return map;
  }

  for (const entry of selectedShippingQuotes) {
    const courierId = String(entry?.courierId || '').trim();
    const shipmentRef = String(entry?.shipmentRef || '').trim();
    const sellerId = String(entry?.sellerId || '').trim();

    if (!courierId) {
      continue;
    }

    if (shipmentRef) {
      map.set(`shipment:${shipmentRef}`, courierId);
    }

    if (sellerId) {
      map.set(`seller:${sellerId}`, courierId);
    }
  }

  return map;
}

function getPreferredCourierForShipment(preferredCouriers, shipment = {}) {
  if (!preferredCouriers || typeof preferredCouriers.get !== 'function') {
    return '';
  }

  const shipmentRef = String(shipment?.localShipmentRef || '').trim();
  const sellerId = String(shipment?.seller || '').trim();

  if (shipmentRef) {
    const fromShipment = String(preferredCouriers.get(`shipment:${shipmentRef}`) || '').trim();
    if (fromShipment) {
      return fromShipment;
    }
  }

  if (sellerId) {
    const fromSeller = String(preferredCouriers.get(`seller:${sellerId}`) || '').trim();
    if (fromSeller) {
      return fromSeller;
    }
  }

  return '';
}

function normalizeNimbusQuoteOption(option = {}) {
  const totalCharges = roundCurrency(Number(option?.totalCharges || 0));
  const freightCharges = roundCurrency(Number(option?.freightCharges || 0));
  const codCharges = roundCurrency(Number(option?.codCharges || 0));
  const chargeableWeight = Math.max(1, Math.round(Number(option?.chargeableWeight || 0) || 0));

  return {
    courierId: String(option?.courierId || ''),
    courierName: String(option?.courierName || ''),
    totalCharges,
    freightCharges,
    codCharges,
    etd: String(option?.etd || ''),
    chargeableWeight,
  };
}

function pickRelevantChargeableWeight(options = [], shipmentWeight = 0) {
  const normalizedShipmentWeight = Math.max(1, Math.round(Number(shipmentWeight) || 1));
  const slabs = Array.from(new Set(
    (options || [])
      .map((entry) => Math.max(1, Math.round(Number(entry?.chargeableWeight || 0) || 0)))
      .filter((value) => Number.isFinite(value) && value > 0)
  )).sort((a, b) => a - b);

  if (slabs.length === 0) {
    return normalizedShipmentWeight;
  }

  const eligibleSlab = slabs.find((slab) => slab >= normalizedShipmentWeight);
  return eligibleSlab || slabs[0];
}

function filterNimbusQuoteOptionsByWeight(options = [], shipmentWeight = 0) {
  const normalizedOptions = Array.isArray(options) ? options : [];
  if (normalizedOptions.length === 0) {
    return [];
  }

  const targetSlab = pickRelevantChargeableWeight(normalizedOptions, shipmentWeight);
  const filtered = normalizedOptions.filter((entry) => {
    const slab = Math.max(1, Math.round(Number(entry?.chargeableWeight || 0) || 0));
    return slab === targetSlab;
  });

  return filtered.length > 0 ? filtered : normalizedOptions;
}

function mapNimbusPickupCandidate(candidate = {}, fallbackEmail = '') {
  const label = String(candidate?.label || 'Pickup').trim();
  const name = String(candidate?.fullName || '').trim();
  const address1 = String(candidate?.street || '').trim();
  const address2 = String(candidate?.address2 || '').trim();
  const city = String(candidate?.city || '').trim();
  const state = String(candidate?.state || '').trim();
  const pincode = normalizePincodeForNimbus(candidate?.postalCode || '');
  const phone = normalizePhoneForNimbus(candidate?.phoneNumber || '');
  const email = String(candidate?.email || fallbackEmail || '').trim();

  if (!name || !address1 || !city || !state || !pincode || !phone) {
    return null;
  }

  return {
    warehouseName: (label || 'Pickup').slice(0, 20),
    name: name.slice(0, 200),
    address1: address1.slice(0, 200),
    address2: address2.slice(0, 200),
    city: city.slice(0, 40),
    state: state.slice(0, 40),
    pincode,
    phone,
    email: email.slice(0, 140),
  };
}

function mapDefaultPickupForNimbus(fallbackEmail = '') {
  const pickup = env?.nimbuspost?.pickup || {};

  return mapNimbusPickupCandidate({
    label: pickup?.warehouseName || 'Pickup',
    fullName: pickup?.name || '',
    street: pickup?.address1 || '',
    address2: pickup?.address2 || '',
    city: pickup?.city || '',
    state: pickup?.state || '',
    postalCode: pickup?.pincode || '',
    phoneNumber: pickup?.phone || '',
    email: fallbackEmail,
  }, fallbackEmail);
}

function mapSellerPickupForNimbus(seller = null) {
  const sellerName = String(seller?.sellerDisplayName || seller?.name || 'seller').trim();
  const sellerEmail = String(seller?.sellerContactEmail || seller?.email || '').trim();
  const pickup = seller?.sellerPickupAddress || {};

  const sellerPickup = mapNimbusPickupCandidate({
    label: pickup?.label || sellerName || 'Pickup',
    fullName: pickup?.fullName || sellerName || '',
    street: pickup?.street || '',
    address2: '',
    city: pickup?.city || '',
    state: pickup?.state || '',
    postalCode: pickup?.postalCode || '',
    phoneNumber: pickup?.phoneNumber || '',
    email: pickup?.email || sellerEmail,
  }, sellerEmail);

  if (sellerPickup) {
    return sellerPickup;
  }

  const defaultPickup = mapDefaultPickupForNimbus(sellerEmail);
  if (defaultPickup) {
    console.warn(`[NIMBUS][PICKUP_FALLBACK] Using default pickup profile for ${sellerName}.`);
    return defaultPickup;
  }

  return null;
}

async function estimateOrderShippingFromNimbus({ orderItems = [], sellerShipments = [], shippingAddress = {}, preferredCouriers = new Map() }) {
  if (!isNimbuspostEnabled()) {
    throw new Error('Live shipping quote is unavailable because NimbusPost is disabled.');
  }

  const destination = normalizePincodeForNimbus(shippingAddress?.postalCode || '');
  if (!destination) {
    throw new Error('Destination pincode is required for live shipping quotes.');
  }

  const sellerIds = Array.from(new Set(
    (sellerShipments || [])
      .map((shipment) => String(shipment?.seller || '').trim())
      .filter((value) => mongoose.Types.ObjectId.isValid(value))
  ));

  const sellers = sellerIds.length > 0
    ? await User.find({ _id: { $in: sellerIds } })
      .select('name email sellerDisplayName sellerContactEmail sellerPickupAddress')
      .lean()
    : [];
  const sellerMap = new Map((sellers || []).map((entry) => [String(entry._id), entry]));

  const quoteDetails = [];
  let totalShipping = 0;

  for (const shipment of sellerShipments || []) {
    const itemIndexes = Array.isArray(shipment?.itemIndexes)
      ? shipment.itemIndexes.filter((index) => Number.isInteger(index) && index >= 0)
      : [];

    const shipmentItems = itemIndexes
      .map((index) => orderItems[index])
      .filter(Boolean);

    if (shipmentItems.length === 0) {
      continue;
    }

    const seller = sellerMap.get(String(shipment?.seller || '')) || null;
    const pickup = mapSellerPickupForNimbus(seller);
    if (!pickup?.pincode) {
      const sellerName = String(seller?.sellerDisplayName || seller?.name || shipment?.seller || 'seller').trim();
      throw new Error(`Seller pickup address is missing or incomplete for ${sellerName}.`);
    }

    const origin = pickup.pincode;

    const weight = estimateShipmentWeightGrams(shipmentItems);
    const preferredCourierId = getPreferredCourierForShipment(preferredCouriers, shipment);
    const quote = await getCourierServiceabilityQuote({
      origin,
      destination,
      paymentType: 'prepaid',
      weight,
    });

    const options = Array.isArray(quote?.quotes)
      ? quote.quotes.map(normalizeNimbusQuoteOption).filter((entry) => entry.totalCharges > 0)
      : [];

    if (options.length === 0) {
      throw new Error(`No courier quotes were returned for shipment ${String(shipment?.localShipmentRef || '')}.`);
    }

    const relevantOptions = filterNimbusQuoteOptionsByWeight(options, weight);

    const selectedOption = preferredCourierId
      ? relevantOptions.find((entry) => String(entry.courierId || '') === preferredCourierId)
      : relevantOptions[0];

    if (preferredCourierId && !selectedOption) {
      throw new Error(`Selected courier ${preferredCourierId} is not available for one of the shipments.`);
    }

    const resolvedSelection = selectedOption || relevantOptions[0];
    const shipmentCharge = roundCurrency(Number(resolvedSelection.totalCharges || 0));
    totalShipping += shipmentCharge;

    const sellerId = String(shipment?.seller || '');
    const shipmentRef = String(shipment?.localShipmentRef || '');

    quoteDetails.push({
      sellerId,
      shipmentRef,
      origin,
      destination,
      weight,
      options: relevantOptions,
      selectedCourierId: String(resolvedSelection.courierId || ''),
      selectedCourierName: String(resolvedSelection.courierName || ''),
      selectedTotalCharges: shipmentCharge,
      selectedEtd: String(resolvedSelection.etd || ''),
    });
  }

  if (quoteDetails.length === 0) {
    throw new Error('No shippable items were found for live quote calculation.');
  }

  return {
    source: 'nimbus_serviceability',
    shippingCost: roundCurrency(totalShipping),
    details: quoteDetails,
    reason: '',
  };
}

function resolveEffectiveUnitPrice(product = {}) {
  const realPrice = Math.max(0, Number(product?.realPrice ?? product?.price) || 0);
  const discountedPrice = Number(product?.discountedPrice);
  const hasDiscount = Number.isFinite(discountedPrice)
    && discountedPrice >= 0
    && discountedPrice < realPrice;

  return hasDiscount ? discountedPrice : realPrice;
}

function escapeRegex(input) {
  return String(input || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SELLER_STATUS_ORDER = ['new', 'processing', 'packed', 'shipped', 'delivered', 'cancelled'];
const SELLER_SHIPMENT_STATUS_ORDER = ['pending', 'ready_for_booking', 'booked', 'awb_assigned', 'pickup_scheduled', 'in_transit', 'delivered', 'cancelled', 'failed'];

function getSellerStatusRank(status) {
  const normalized = String(status || 'new').trim().toLowerCase();
  const index = SELLER_STATUS_ORDER.indexOf(normalized);
  return index >= 0 ? index : 0;
}

function mapShipmentStatusToSellerItemStatus(shipmentStatus) {
  const normalized = String(shipmentStatus || '').trim().toLowerCase();

  if (!normalized) {
    return null;
  }

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

  const nextRank = getSellerStatusRank(nextStatus);
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

    if (nextStatus !== 'cancelled' && getSellerStatusRank(currentStatus) > nextRank) {
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

  if (changed) {
    order.status = buildOrderStatusFromItems(order.items || []);
  }

  return { changed, affectedCount };
}

function roundCurrency(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Number(parsed.toFixed(2));
}

function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizePhoneForNimbus(value) {
  const digits = normalizeDigits(value);
  if (!digits) {
    return '';
  }

  if (digits.length <= 10) {
    return digits;
  }

  return digits.slice(-10);
}

function normalizePincodeForNimbus(value) {
  const digits = normalizeDigits(value);
  if (!digits) {
    return '';
  }

  return digits.slice(0, 6);
}

function toNimbusPaymentType(order) {
  const paymentMethod = String(order?.paymentMethod || '').trim().toLowerCase();
  return paymentMethod === 'cod' ? 'cod' : 'prepaid';
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

function buildNimbusTrackingUrl(awbNumber) {
  const awb = String(awbNumber || '').trim();
  if (!awb) {
    return '';
  }

  return `https://nimbuspost.com/tracking/?awb=${encodeURIComponent(awb)}`;
}

function buildNimbusShipmentPayload(order, shipment, pickupAddress = null) {
  const itemIndexes = Array.isArray(shipment?.itemIndexes)
    ? shipment.itemIndexes.filter((index) => Number.isInteger(index) && index >= 0)
    : [];

  const items = itemIndexes
    .map((index) => ({ item: order?.items?.[index], index }))
    .filter(({ item }) => Boolean(item))
    .map(({ item, index }) => ({
      product: item.product,
      title: item.title || `Item ${index + 1}`,
      quantity: Number(item.quantity) || 1,
      price: Number(item.price) || 0,
      packageWeightGrams: Number(item.packageWeightGrams || 0),
      packageLengthCm: Number(item.packageLengthCm || 0),
      packageBreadthCm: Number(item.packageBreadthCm || 0),
      packageHeightCm: Number(item.packageHeightCm || 0),
      sku: item.product?._id ? String(item.product._id) : String(item.product || `${shipment.localShipmentRef}-${index + 1}`),
    }));

  if (items.length === 0) {
    throw new Error('Shipment has no valid order items to book on NimbusPost.');
  }

  if (!pickupAddress || typeof pickupAddress !== 'object') {
    throw new Error('Seller pickup address is missing or incomplete for this shipment.');
  }

  const sellerSubtotal = items.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0), 0);
  const orderSubtotal = Number(order?.subtotal || 0);
  const shippingCost = Number(order?.shippingCost || 0);
  const proportionalShippingCost = orderSubtotal > 0 ? (shippingCost * (sellerSubtotal / orderSubtotal)) : 0;
  const quotedShippingCost = Number(shipment?.quotedShippingCost);
  const resolvedShippingCost = Number.isFinite(quotedShippingCost) && quotedShippingCost >= 0
    ? quotedShippingCost
    : proportionalShippingCost;
  const orderAmount = sellerSubtotal + resolvedShippingCost;

  const shippingAddress = order?.shippingAddress || {};

  return {
    localShipmentRef: String(shipment?.localShipmentRef || ''),
    shippingAddress: {
      fullName: String(shippingAddress.fullName || 'Customer'),
      street: String(shippingAddress.street || ''),
      city: String(shippingAddress.city || ''),
      state: String(shippingAddress.state || ''),
      postalCode: normalizePincodeForNimbus(shippingAddress.postalCode) || String(shippingAddress.postalCode || ''),
      phoneNumber: normalizePhoneForNimbus(shippingAddress.phoneNumber) || String(shippingAddress.phoneNumber || ''),
      email: String(shippingAddress.email || ''),
    },
    items,
    paymentType: toNimbusPaymentType(order),
    shippingCharges: roundCurrency(resolvedShippingCost),
    discount: 0,
    codCharges: 0,
    orderAmount: roundCurrency(orderAmount),
    pickupAddress,
    courierId: String(shipment?.preferredCourierId || '').trim() || undefined,
  };
}

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

function isNimbusWebhookAuthorized(req, secret) {
  const normalizedSecret = String(secret || '').trim();
  if (!normalizedSecret) {
    return true;
  }

  // Backward-compatible support for plain secret headers.
  const plainSecretHeader = String(
    req.headers['x-webhook-secret']
    || req.headers['x-nimbuspost-secret']
    || req.headers['x-api-key']
    || ''
  ).trim();

  if (plainSecretHeader && isEqualSafe(plainSecretHeader, normalizedSecret)) {
    return true;
  }

  // Nimbus can send an HMAC signature in x-hmac-sha256.
  const signatureHeader = String(req.headers['x-hmac-sha256'] || '').trim();
  if (!signatureHeader) {
    return false;
  }

  const payload = req.rawBody && String(req.rawBody).length > 0
    ? String(req.rawBody)
    : JSON.stringify(req.body || {});

  const computedSignature = crypto
    .createHmac('sha256', normalizedSecret)
    .update(payload, 'utf8')
    .digest('base64');

  return isEqualSafe(signatureHeader, computedSignature);
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

function buildSellerShipmentStatusFromItems(itemStatuses = []) {
  const statuses = (itemStatuses || []).map((status) => String(status || 'new').toLowerCase());

  if (statuses.length === 0) {
    return 'pending';
  }

  if (statuses.every((status) => status === 'cancelled')) {
    return 'cancelled';
  }

  if (statuses.every((status) => status === 'delivered' || status === 'cancelled')) {
    return 'delivered';
  }

  if (statuses.some((status) => status === 'shipped' || status === 'delivered')) {
    return 'in_transit';
  }

  if (statuses.some((status) => status === 'packed' || status === 'processing')) {
    return 'ready_for_booking';
  }

  return 'pending';
}

function buildSellerShipmentSkeletons(items = [], orderId) {
  const groupedBySeller = new Map();

  (items || []).forEach((item, index) => {
    const sellerKey = item?.seller ? String(item.seller) : `missing:${index}`;
    if (!groupedBySeller.has(sellerKey)) {
      groupedBySeller.set(sellerKey, {
        seller: item?.seller || null,
        itemIndexes: [],
      });
    }

    groupedBySeller.get(sellerKey).itemIndexes.push(index);
  });

  const orderRefPart = String(orderId || '').slice(-8).toUpperCase() || Date.now().toString(36).toUpperCase();
  let sequence = 1;

  return Array.from(groupedBySeller.values()).map((group) => {
    const hasSeller = Boolean(group.seller);
    const status = hasSeller ? 'pending' : 'failed';

    return {
      seller: group.seller || null,
      itemIndexes: group.itemIndexes,
      localShipmentRef: `HK-${orderRefPart}-${String(sequence++).padStart(2, '0')}`,
      status,
      lastError: hasSeller ? '' : 'Missing seller mapping for one or more order items.',
      timeline: [
        {
          status,
          note: hasSeller
            ? 'Shipment record initialized and waiting for seller processing.'
            : 'Shipment record initialization failed because seller mapping is missing.',
          source: 'system',
          at: new Date(),
        },
      ],
    };
  });
}

function toSellerShipmentView(shipment) {
  if (!shipment) {
    return null;
  }

  return {
    id: shipment?._id ? String(shipment._id) : '',
    localShipmentRef: shipment.localShipmentRef || '',
    status: shipment.status || 'pending',
    lastError: shipment.lastError || '',
    itemIndexes: Array.isArray(shipment.itemIndexes) ? shipment.itemIndexes : [],
    timeline: (shipment.timeline || []).map((entry) => ({
      status: entry?.status || '',
      note: entry?.note || '',
      source: entry?.source || 'system',
      at: entry?.at || null,
    })),
    carrier: shipment.carrier
      ? {
          provider: shipment.carrier.provider || '',
          mode: shipment.carrier.mode || '',
          orderId: shipment.carrier.orderId || '',
          shipmentId: shipment.carrier.shipmentId || '',
          awbNumber: shipment.carrier.awbNumber || '',
          courierId: shipment.carrier.courierId || '',
          courierName: shipment.carrier.courierName || '',
          remoteStatus: shipment.carrier.remoteStatus || '',
          labelUrl: shipment.carrier.labelUrl || '',
          manifestUrl: shipment.carrier.manifestUrl || '',
          trackingUrl: shipment.carrier.trackingUrl || '',
        }
      : null,
    createdAt: shipment.createdAt || null,
    updatedAt: shipment.updatedAt || null,
  };
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

function toSellerOrderView(order, sellerId) {
  const items = (order.items || [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => String(item.seller || '') === String(sellerId));

  if (items.length === 0) {
    return null;
  }
  const sellerSubtotal = items.reduce((sum, { item }) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0), 0);
  const sellerShipment = (order.sellerShipments || []).find(
    (shipment) => String(shipment?.seller || '') === String(sellerId)
  );

  return {
    id: String(order._id),
    orderId: String(order._id),
    buyer: {
      id: String(order.user?._id || order.user || ''),
      name: order.user?.name || 'Buyer',
      email: order.user?.email || '',
    },
    shippingAddress: order.shippingAddress,
    paymentStatus: order.paymentStatus,
    overallStatus: order.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    sellerSubtotal: Number(sellerSubtotal.toFixed(2)),
    shipment: toSellerShipmentView(sellerShipment),
    items: items.map(({ item, index }) => ({
      itemIndex: index,
      productId: item.product?._id ? String(item.product._id) : String(item.product || ''),
      title: item.title,
      image: item.image || '',
      quantity: item.quantity,
      unitPrice: item.price,
      lineTotal: Number(((Number(item.price) || 0) * (Number(item.quantity) || 0)).toFixed(2)),
      fulfillmentStatus: item.fulfillmentStatus || 'new',
      trackingEvents: (item.trackingEvents || []).map((event) => ({
        status: event.status,
        note: event.note || '',
        at: event.at,
      })),
    })),
  };
}

let razorpayClient = null;

function isRazorpayEnabled() {
  return Boolean(env.razorpay?.enabled);
}

function getRazorpayCurrency() {
  return String(env.razorpay?.currency || 'INR').trim().toUpperCase() || 'INR';
}

function toAmountInPaise(amountInInr) {
  const normalized = Number(amountInInr || 0);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return 0;
  }

  return Math.round(normalized * 100);
}

function getRazorpayClient() {
  if (!isRazorpayEnabled()) {
    throw new Error('[PAYMENT][RAZORPAY] Razorpay is disabled. Set RAZORPAY_ENABLED=true.');
  }

  if (!razorpayClient) {
    razorpayClient = new Razorpay({
      key_id: String(env.razorpay?.keyId || '').trim(),
      key_secret: String(env.razorpay?.keySecret || '').trim(),
    });
  }

  return razorpayClient;
}

function verifyRazorpaySignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
  const expectedSignature = crypto
    .createHmac('sha256', String(env.razorpay?.keySecret || '').trim())
    .update(`${razorpayOrderId}|${razorpayPaymentId}`, 'utf8')
    .digest('hex');

  return isEqualSafe(expectedSignature, razorpaySignature);
}

function verifyRazorpayWebhookSignature({ payload, signature }) {
  const webhookSecret = String(env.razorpay?.webhookSecret || '').trim();
  if (!webhookSecret) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(String(payload || ''), 'utf8')
    .digest('hex');

  return isEqualSafe(expectedSignature, signature);
}

function createRazorpayReceipt(orderId) {
  const orderPart = String(orderId || '').replace(/[^a-zA-Z0-9]/g, '').slice(-10).toUpperCase() || 'ORDER';
  const tsPart = Date.now().toString().slice(-7);
  return `HK${orderPart}${tsPart}`.slice(0, 40);
}

function assertOrderOwnership(order, userId) {
  if (String(order.user) !== String(userId)) {
    const err = new Error('Unauthorized');
    err.status = 403;
    throw err;
  }
}

async function applySuccessfulPaymentEffects(order, { transactionId, paymentMethod = 'card', paymentGateway = null } = {}) {
  order.paymentStatus = 'completed';
  order.status = 'confirmed';
  order.transactionId = String(transactionId || '');
  order.paymentMethod = String(paymentMethod || 'card');

  if (paymentGateway && typeof paymentGateway === 'object') {
    order.paymentGateway = Object.assign({}, order.paymentGateway || {}, paymentGateway);
  }

  if (Array.isArray(order.sellerShipments)) {
    order.sellerShipments.forEach((shipment) => {
      if (String(shipment.status || '').toLowerCase() === 'pending') {
        shipment.status = 'ready_for_booking';
        shipment.lastError = '';
        shipment.timeline = Array.isArray(shipment.timeline) ? shipment.timeline : [];
        shipment.timeline.push({
          status: 'ready_for_booking',
          note: 'Payment completed. Shipment is ready for processing.',
          source: 'system',
          at: new Date(),
        });
      }
    });
  }

  await order.save();

  try {
    await ensureOrderPayoutRecords(order);
  } catch (payoutErr) {
    console.warn('[PAYMENT][PAYOUT] Failed to initialize payout ledger:', payoutErr?.message || payoutErr);
  }

  if (order.items && order.items.length > 0) {
    const stockPromises = order.items.map((item) =>
      Product.findByIdAndUpdate(
        item.product,
        { $inc: { stock: -Number(item.quantity || 0) } },
        { new: false, runValidators: false }
      ).catch((e) => {
        console.warn(`[PAYMENT] Stock update warning for product ${item.product}:`, e?.message);
      })
    );
    await Promise.all(stockPromises);
  }

  try {
    const buyer = await User.findById(order.user);
    if (buyer && buyer.cartItems && buyer.cartItems.length > 0) {
      const orderedProductIds = new Set((order.items || []).map((item) => String(item.product || '')));
      buyer.cartItems = buyer.cartItems.filter(
        (entry) => !orderedProductIds.has(String(entry.product || ''))
      );
      await buyer.save();
    }
  } catch (cartErr) {
    console.warn('[PAYMENT] Cart update warning:', cartErr?.message);
  }

  if (isNimbuspostEnabled() && Array.isArray(order.sellerShipments)) {
    const shipmentsToBook = order.sellerShipments.filter(
      (shipment) => String(shipment?.status || '').toLowerCase() === 'ready_for_booking'
    );

    if (shipmentsToBook.length > 0) {
      console.log(`[PAYMENT][NIMBUS] Attempting booking for ${shipmentsToBook.length} seller shipments...`);

      const sellerIds = Array.from(new Set(
        shipmentsToBook
          .map((shipment) => String(shipment?.seller || '').trim())
          .filter((id) => mongoose.Types.ObjectId.isValid(id))
      ));

      const sellers = sellerIds.length > 0
        ? await User.find({ _id: { $in: sellerIds } })
          .select('name email sellerDisplayName sellerContactEmail sellerPickupAddress')
          .lean()
        : [];
      const sellerPickupMap = new Map(
        (sellers || []).map((seller) => [String(seller._id), mapSellerPickupForNimbus(seller)])
      );

      for (const shipment of shipmentsToBook) {
        try {
          const pickupOverride = sellerPickupMap.get(String(shipment?.seller || '')) || null;
          if (!pickupOverride) {
            throw new Error('Seller pickup address is missing or incomplete for this shipment.');
          }

          const payload = buildNimbusShipmentPayload(order, shipment, pickupOverride);
          const booking = await createShipment(payload);

          const mappedStatus = booking.awbNumber
            ? 'awb_assigned'
            : mapNimbusStatusToShipmentStatus(booking.remoteStatus || 'booked');

          shipment.status = SELLER_SHIPMENT_STATUS_ORDER.includes(mappedStatus)
            ? mappedStatus
            : 'booked';
          shipment.lastError = '';
          shipment.carrier = {
            provider: 'nimbuspost',
            mode: booking.mode || '',
            orderId: booking.orderId || '',
            shipmentId: booking.shipmentId || '',
            awbNumber: booking.awbNumber || '',
            courierId: booking.courierId || '',
            courierName: booking.courierName || '',
            remoteStatus: booking.remoteStatus || '',
            labelUrl: booking.labelUrl || '',
            manifestUrl: booking.manifestUrl || '',
            trackingUrl: buildNimbusTrackingUrl(booking.awbNumber),
          };

          appendShipmentTimelineEntry(shipment, {
            status: shipment.status,
            note: booking.awbNumber
              ? `NimbusPost booking successful. AWB: ${booking.awbNumber}.`
              : 'NimbusPost booking successful.',
            source: 'system',
          });

          syncOrderItemsFromShipment(order, shipment, {
            note: booking.awbNumber
              ? `Shipment AWB assigned (${booking.awbNumber}).`
              : 'Shipment booked with NimbusPost.',
            updatedBy: null,
          });
        } catch (bookingError) {
          const bookingMessage = bookingError?.message || 'Unknown NimbusPost booking error';
          shipment.status = 'failed';
          shipment.lastError = bookingMessage;

          appendShipmentTimelineEntry(shipment, {
            status: 'failed',
            note: `NimbusPost booking failed: ${bookingMessage}`,
            source: 'system',
          });

          console.warn(`[PAYMENT][NIMBUS] Booking failed for ${shipment.localShipmentRef}:`, bookingMessage);
        }
      }

      await order.save();
      console.log('[PAYMENT][NIMBUS] Shipment booking pass completed.');
    }
  }
}

// POST /api/orders/estimate-shipping - Estimate checkout totals using current cart and destination
router.post('/estimate-shipping', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('cartItems');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!Array.isArray(user.cartItems) || user.cartItems.length === 0) {
      return res.status(400).json({ message: 'Cart is empty' });
    }

    const shippingAddress = req.body?.shippingAddress || {};
    if (!shippingAddress || !shippingAddress.postalCode) {
      return res.status(400).json({ message: 'shippingAddress.postalCode is required' });
    }

    const orderItems = [];
    let subtotal = 0;
    const sellerCache = new Map();

    for (const cartItem of user.cartItems) {
      const product = await Product.findById(cartItem.product);
      if (!product || !product.isActive) {
        return res.status(404).json({ message: `Product ${cartItem.product} not found` });
      }

      if (product.stock < cartItem.quantity) {
        return res.status(400).json({ message: `Insufficient stock for ${product.title}` });
      }

      const unitPrice = roundCurrency(resolveEffectiveUnitPrice(product));
      subtotal += unitPrice * cartItem.quantity;

      let sellerId = null;
      const rawSeller = product?.seller ? String(product.seller) : '';
      if (rawSeller && mongoose.Types.ObjectId.isValid(rawSeller)) {
        sellerId = new mongoose.Types.ObjectId(rawSeller);
      } else {
        const sellerNameKey = String(product?.sellerName || '').trim().toLowerCase();
        if (sellerNameKey) {
          if (sellerCache.has(sellerNameKey)) {
            sellerId = sellerCache.get(sellerNameKey);
          } else {
            const sellerRegex = new RegExp(`^${escapeRegex(product.sellerName)}$`, 'i');
            const sellerUser = await User.findOne({ name: { $regex: sellerRegex } }).select('_id');
            const resolved = sellerUser ? String(sellerUser._id) : null;
            sellerCache.set(sellerNameKey, resolved);
            sellerId = resolved;
          }
        }
      }

      orderItems.push({
        product: product._id,
        seller: sellerId,
        quantity: cartItem.quantity,
        price: unitPrice,
        title: product.title,
        image: product.images?.[0] || product.media?.[0]?.url || '',
        packageWeightGrams: Number(product?.packageWeightGrams || 0),
        packageLengthCm: Number(product?.packageLengthCm || 0),
        packageBreadthCm: Number(product?.packageBreadthCm || 0),
        packageHeightCm: Number(product?.packageHeightCm || 0),
      });
    }

    const quoteShipments = buildSellerShipmentSkeletons(orderItems, 'ESTIMATE');

    let shippingQuote;
    try {
      shippingQuote = await estimateOrderShippingFromNimbus({
        orderItems,
        sellerShipments: quoteShipments,
        shippingAddress,
      });
    } catch (quoteErr) {
      const classified = classifyNimbusQuoteError(quoteErr?.message || '');
      const statusCode = classified.retryable ? 503 : 422;

      console.warn(
        `[ORDERS][ESTIMATE_SHIPPING][NIMBUS] Quote failed (${classified.code}):`,
        quoteErr?.message || quoteErr
      );

      return res.status(statusCode).json({
        message: classified.userMessage,
        code: classified.code,
        retryable: Boolean(classified.retryable),
      });
    }

    const shippingCost = roundCurrency(shippingQuote.shippingCost);
    const tax = calculateTax(subtotal);
    const totalAmount = roundCurrency(subtotal + shippingCost + tax);

    return res.json({
      subtotal: roundCurrency(subtotal),
      shippingCost,
      tax,
      totalAmount,
      currency: String(env?.razorpay?.currency || 'INR').toUpperCase(),
      shippingQuote,
    });
  } catch (err) {
    const message = err?.message || 'Failed to estimate shipping';
    console.error('[ORDERS][ESTIMATE_SHIPPING] Error:', message, err);
    return res.status(500).json({ message });
  }
});

// POST /api/orders - Create a new order from cart
router.post('/', auth, async (req, res) => {
  try {
    console.log('[CREATE_ORDER] Starting order creation for user:', req.user);
    const user = await User.findById(req.user._id);
    if (!user) {
      console.log('[CREATE_ORDER] User not found:', req.user);
      return res.status(404).json({ message: 'User not found' });
    }
    console.log('[CREATE_ORDER] Found user, cart items:', user.cartItems?.length || 0);

    if (!user.cartItems || user.cartItems.length === 0) {
      console.log('[CREATE_ORDER] Cart is empty for user:', req.user);
      return res.status(400).json({ message: 'Cart is empty' });
    }

    const { shippingAddress, notes, selectedShippingQuotes } = req.body;
    console.log('[CREATE_ORDER] Shipping address provided:', shippingAddress ? 'yes' : 'no');

    // Validate shipping address
    if (!shippingAddress || !shippingAddress.fullName || !shippingAddress.phoneNumber 
        || !shippingAddress.email || !shippingAddress.street || !shippingAddress.city 
        || !shippingAddress.postalCode || !shippingAddress.country) {
      console.log('[CREATE_ORDER] Incomplete shipping address:', shippingAddress);
      return res.status(400).json({ message: 'Incomplete shipping address' });
    }

    // Build order items and calculate subtotal
    console.log('[CREATE_ORDER] Building order items...');
    const orderItems = [];
    let subtotal = 0;
    const sellerCache = new Map();

    for (const cartItem of user.cartItems) {
      console.log('[CREATE_ORDER] Processing cart item:', cartItem.product, 'qty:', cartItem.quantity);
      const product = await Product.findById(cartItem.product);
      if (!product) {
        console.log('[CREATE_ORDER] Product not found:', cartItem.product);
        return res.status(404).json({ message: `Product ${cartItem.product} not found` });
      }

      if (product.stock < cartItem.quantity) {
        console.log('[CREATE_ORDER] Insufficient stock for', product._id, '- available:', product.stock, 'requested:', cartItem.quantity);
        return res.status(400).json({ message: `Insufficient stock for ${product.title}` });
      }

      const unitPrice = roundCurrency(resolveEffectiveUnitPrice(product));
      const itemTotal = unitPrice * cartItem.quantity;
      subtotal += itemTotal;

      let sellerId = null;
      const rawSeller = product?.seller ? String(product.seller) : '';
      if (rawSeller && mongoose.Types.ObjectId.isValid(rawSeller)) {
        sellerId = new mongoose.Types.ObjectId(rawSeller);
      } else {
        const sellerNameKey = String(product?.sellerName || '').trim().toLowerCase();
        if (sellerNameKey) {
          if (sellerCache.has(sellerNameKey)) {
            sellerId = sellerCache.get(sellerNameKey);
          } else {
            const sellerRegex = new RegExp(`^${escapeRegex(product.sellerName)}$`, 'i');
            const sellerUser = await User.findOne({ name: { $regex: sellerRegex } }).select('_id');
            const resolved = sellerUser ? String(sellerUser._id) : null;
            sellerCache.set(sellerNameKey, resolved);
            sellerId = resolved;
          }
        }
      }

      orderItems.push({
        product: product._id,
        seller: sellerId,
        quantity: cartItem.quantity,
        price: unitPrice,
        title: product.title,
        image: product.images?.[0] || product.media?.[0]?.url || '',
        packageWeightGrams: Number(product?.packageWeightGrams || 0),
        packageLengthCm: Number(product?.packageLengthCm || 0),
        packageBreadthCm: Number(product?.packageBreadthCm || 0),
        packageHeightCm: Number(product?.packageHeightCm || 0),
        fulfillmentStatus: 'new',
        trackingEvents: [
          {
            status: 'new',
            note: 'Order placed by buyer',
            updatedBy: null,
            at: new Date(),
          },
        ],
      });
    }

    // Calculate costs strictly from Nimbus live quotes.
    const quoteShipments = buildSellerShipmentSkeletons(orderItems, 'ESTIMATE');
    const preferredCouriers = buildPreferredCourierMap(selectedShippingQuotes);

    let shippingQuote;
    try {
      shippingQuote = await estimateOrderShippingFromNimbus({
        orderItems,
        sellerShipments: quoteShipments,
        shippingAddress,
        preferredCouriers,
      });
    } catch (quoteErr) {
      const classified = classifyNimbusQuoteError(quoteErr?.message || '');
      const statusCode = classified.retryable ? 503 : 422;

      console.warn(
        `[CREATE_ORDER][NIMBUS] Quote failed (${classified.code}):`,
        quoteErr?.message || quoteErr
      );

      return res.status(statusCode).json({
        message: classified.userMessage,
        code: classified.code,
        retryable: Boolean(classified.retryable),
      });
    }

    const shippingCost = roundCurrency(shippingQuote.shippingCost);
    const tax = calculateTax(subtotal);
    const totalAmount = subtotal + shippingCost + tax;
    console.log('[CREATE_ORDER] Calculated totals - subtotal:', subtotal, 'shipping:', shippingCost, 'tax:', tax, 'total:', totalAmount);

    // Create order
    console.log('[CREATE_ORDER] Creating order document...');
    const order = new Order({
      user: user._id,
      items: orderItems,
      sellerShipments: [],
      shippingAddress,
      subtotal: Number(subtotal.toFixed(2)),
      shippingCost,
      tax,
      totalAmount: Number(totalAmount.toFixed(2)),
      status: 'pending',
      paymentStatus: 'pending',
      notes: notes || '',
    });

    // Pre-build one shipment mapping per seller so carrier IDs can be attached later.
    order.sellerShipments = buildSellerShipmentSkeletons(orderItems, order._id);

    const quoteBySeller = new Map(
      (shippingQuote?.details || [])
        .map((detail) => [String(detail?.sellerId || ''), detail])
        .filter(([sellerId]) => Boolean(sellerId))
    );

    order.sellerShipments = (order.sellerShipments || []).map((shipment) => {
      const sellerId = String(shipment?.seller || '');
      const matched = quoteBySeller.get(sellerId);
      if (!matched) {
        return shipment;
      }

      return {
        ...shipment,
        preferredCourierId: String(matched?.selectedCourierId || ''),
        preferredCourierName: String(matched?.selectedCourierName || ''),
        quotedShippingCost: Number(matched?.selectedTotalCharges || 0),
      };
    });

    console.log('[CREATE_ORDER] Saving order...');
    await order.save();
    console.log('[CREATE_ORDER] Order saved successfully:', order._id);

    res.status(201).json({
      message: 'Order created successfully',
      order: order,
      shippingQuote,
    });
  } catch (err) {
    const errorMsg = typeof err === 'string' ? err : (err?.message || String(err) || 'Unknown error');
    console.error('\n================================');
    console.error('[CREATE_ORDER] CAUGHT ERROR');
    console.error('Message:', errorMsg);
    console.error('Type:', typeof err);
    console.error('Full stack:', err?.stack || 'No stack');
    console.error('================================\n');
    res.status(500).json({ message: errorMsg });
  }
});

// POST /api/orders/:id/pay/razorpay-order - Create Razorpay gateway order for checkout
router.post('/:id/pay/razorpay-order', auth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid order id' });
    }

    if (!isRazorpayEnabled()) {
      return res.status(503).json({ message: 'Razorpay is not configured on server.' });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (!order.items || order.items.length === 0) {
      return res.status(400).json({ message: 'Order has no items' });
    }

    assertOrderOwnership(order, req.user._id);

    if (order.paymentStatus === 'completed') {
      return res.json({
        message: 'Order already paid',
        order,
        transactionId: String(order.transactionId || ''),
      });
    }

    const amountInPaise = toAmountInPaise(order.totalAmount);
    if (!amountInPaise) {
      return res.status(400).json({ message: 'Order total must be greater than 0 for Razorpay payment.' });
    }

    const razorpay = getRazorpayClient();
    const currency = getRazorpayCurrency();
    const gatewayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency,
      receipt: createRazorpayReceipt(order._id),
      notes: {
        handkraft_order_id: String(order._id),
        user_id: String(req.user._id),
      },
    });

    order.paymentGateway = Object.assign({}, order.paymentGateway || {}, {
      provider: 'razorpay',
      gatewayOrderId: String(gatewayOrder?.id || ''),
      amount: Number(order.totalAmount || 0),
      currency: String(gatewayOrder?.currency || currency || 'INR').toUpperCase(),
      status: String(gatewayOrder?.status || 'created'),
      captured: false,
      raw: {
        orderId: String(gatewayOrder?.id || ''),
        receipt: String(gatewayOrder?.receipt || ''),
        createdAt: new Date().toISOString(),
      },
    });
    await order.save();

    const shippingAddress = order.shippingAddress || {};
    const shortOrderId = String(order._id).slice(-8).toUpperCase();
    const descriptionPrefix = String(env.razorpay?.descriptionPrefix || 'HANDKRAFT Order').trim();

    return res.json({
      message: 'Razorpay order created',
      paymentOrder: {
        keyId: String(env.razorpay?.keyId || ''),
        gatewayOrderId: String(gatewayOrder?.id || ''),
        amount: Number(gatewayOrder?.amount || amountInPaise),
        currency: String(gatewayOrder?.currency || currency || 'INR').toUpperCase(),
        name: String(env.razorpay?.brandName || 'HANDKRAFT'),
        description: `${descriptionPrefix} #${shortOrderId}`,
        prefill: {
          name: String(shippingAddress.fullName || ''),
          email: String(shippingAddress.email || ''),
          contact: normalizePhoneForNimbus(shippingAddress.phoneNumber),
        },
      },
    });
  } catch (err) {
    const errorMsg = typeof err === 'string' ? err : (err?.message || String(err) || 'Unknown error');
    const status = Number(err?.status || 500);
    console.error('[PAYMENT][RAZORPAY_ORDER] Error:', errorMsg, err);
    return res.status(status >= 400 && status < 600 ? status : 500).json({ message: errorMsg });
  }
});

// POST /api/orders/:id/pay - Verify payment and mark order as paid
router.post('/:id/pay', auth, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('[PAYMENT] Starting payment process for order:', id, 'user:', req.user);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid order id' });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (!order.items || order.items.length === 0) {
      return res.status(400).json({ message: 'Order has no items' });
    }

    assertOrderOwnership(order, req.user._id);

    if (order.paymentStatus === 'completed') {
      return res.json({
        message: 'Order already paid',
        order,
        transactionId: String(order.transactionId || ''),
      });
    }

    const paymentProvider = String(req.body?.paymentProvider || '').trim().toLowerCase();
    const razorpayOrderId = String(req.body?.razorpayOrderId || '').trim();
    const razorpayPaymentId = String(req.body?.razorpayPaymentId || '').trim();
    const razorpaySignature = String(req.body?.razorpaySignature || '').trim();

    const hasRazorpayPayload = Boolean(razorpayOrderId && razorpayPaymentId && razorpaySignature);
    const isRazorpayFlow = paymentProvider === 'razorpay' || hasRazorpayPayload;

    if (isRazorpayFlow) {
      if (!isRazorpayEnabled()) {
        return res.status(503).json({ message: 'Razorpay is not configured on server.' });
      }

      if (!hasRazorpayPayload) {
        return res.status(400).json({
          message: 'razorpayOrderId, razorpayPaymentId, and razorpaySignature are required.',
        });
      }

      if (!verifyRazorpaySignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature })) {
        return res.status(400).json({ message: 'Invalid Razorpay signature.' });
      }

      const razorpay = getRazorpayClient();
      const [gatewayOrder, gatewayPayment] = await Promise.all([
        razorpay.orders.fetch(razorpayOrderId),
        razorpay.payments.fetch(razorpayPaymentId),
      ]);

      const expectedAmountInPaise = toAmountInPaise(order.totalAmount);
      const gatewayAmount = Number(gatewayOrder?.amount || 0);
      if (gatewayAmount !== expectedAmountInPaise) {
        return res.status(400).json({ message: 'Gateway order amount does not match order total.' });
      }

      const expectedCurrency = getRazorpayCurrency();
      const gatewayCurrency = String(gatewayOrder?.currency || '').trim().toUpperCase();
      if (gatewayCurrency && gatewayCurrency !== expectedCurrency) {
        return res.status(400).json({ message: 'Gateway currency does not match configured currency.' });
      }

      const notedOrderId = pickFirstNonEmpty([
        gatewayOrder?.notes?.handkraft_order_id,
        gatewayOrder?.notes?.handkraftOrderId,
      ]);
      if (notedOrderId && String(notedOrderId) !== String(order._id)) {
        return res.status(400).json({ message: 'Gateway order does not belong to this HANDKRAFT order.' });
      }

      if (String(gatewayPayment?.order_id || '') !== razorpayOrderId) {
        return res.status(400).json({ message: 'Payment does not belong to the provided Razorpay order.' });
      }

      const gatewayPaymentAmount = Number(gatewayPayment?.amount || 0);
      if (gatewayPaymentAmount !== expectedAmountInPaise) {
        return res.status(400).json({ message: 'Gateway payment amount mismatch.' });
      }

      const paymentStatus = String(gatewayPayment?.status || '').trim().toLowerCase();
      if (!['authorized', 'captured'].includes(paymentStatus)) {
        return res.status(400).json({
          message: `Razorpay payment is not successful yet. Current status: ${paymentStatus || 'unknown'}`,
        });
      }

      await applySuccessfulPaymentEffects(order, {
        transactionId: razorpayPaymentId,
        paymentMethod: 'razorpay',
        paymentGateway: {
          provider: 'razorpay',
          gatewayOrderId: razorpayOrderId,
          gatewayPaymentId: razorpayPaymentId,
          signature: razorpaySignature,
          amount: Number((expectedAmountInPaise / 100).toFixed(2)),
          currency: expectedCurrency,
          status: paymentStatus,
          captured: paymentStatus === 'captured',
          paidAt: new Date(),
          raw: {
            orderStatus: String(gatewayOrder?.status || ''),
            paymentMethod: String(gatewayPayment?.method || ''),
            paymentEmail: String(gatewayPayment?.email || ''),
            paymentContact: String(gatewayPayment?.contact || ''),
          },
        },
      });

      return res.json({
        message: 'Payment successful',
        order,
        transactionId: razorpayPaymentId,
      });
    }

    // Backward-compatible fallback for existing demo clients.
    const stripeToken = String(req.body?.stripeToken || '').trim();
    if (!stripeToken) {
      return res.status(400).json({ message: 'Payment payload is required' });
    }

    const transactionId = `txn_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    await applySuccessfulPaymentEffects(order, {
      transactionId,
      paymentMethod: 'card',
    });

    return res.json({
      message: 'Payment successful',
      order,
      transactionId,
    });
  } catch (err) {
    const errorMsg = typeof err === 'string' ? err : (err?.message || String(err) || 'Unknown error');
    const status = Number(err?.status || 500);
    console.error('[PAYMENT] Error during payment processing:', errorMsg, err);
    return res.status(status >= 400 && status < 600 ? status : 500).json({ message: errorMsg });
  }
});

// POST /api/orders/webhooks/razorpay - Reconcile Razorpay payment events server-side
router.post('/webhooks/razorpay', async (req, res) => {
  try {
    if (!isRazorpayEnabled()) {
      return res.status(503).json({ message: 'Razorpay is not enabled on server.' });
    }

    const webhookSecret = String(env.razorpay?.webhookSecret || '').trim();
    if (!webhookSecret) {
      return res.status(503).json({ message: 'RAZORPAY_WEBHOOK_SECRET is not configured.' });
    }

    const signature = String(req.headers['x-razorpay-signature'] || '').trim();
    if (!signature) {
      return res.status(401).json({ message: 'Missing x-razorpay-signature header.' });
    }

    const rawPayload = req.rawBody && String(req.rawBody).length > 0
      ? String(req.rawBody)
      : JSON.stringify(req.body || {});

    if (!verifyRazorpayWebhookSignature({ payload: rawPayload, signature })) {
      return res.status(401).json({ message: 'Invalid Razorpay webhook signature.' });
    }

    const payload = req.body || {};
    const event = String(payload?.event || '').trim().toLowerCase();
    const paymentEntity = payload?.payload?.payment?.entity || {};
    const orderEntity = payload?.payload?.order?.entity || {};

    const gatewayOrderId = String(paymentEntity?.order_id || orderEntity?.id || '').trim();
    const gatewayPaymentId = String(paymentEntity?.id || '').trim();

    const notedOrderId = pickFirstNonEmpty([
      paymentEntity?.notes?.handkraft_order_id,
      paymentEntity?.notes?.handkraftOrderId,
      orderEntity?.notes?.handkraft_order_id,
      orderEntity?.notes?.handkraftOrderId,
    ]);

    let order = null;
    if (notedOrderId && mongoose.Types.ObjectId.isValid(notedOrderId)) {
      order = await Order.findById(notedOrderId);
    }

    if (!order && gatewayOrderId) {
      order = await Order.findOne({ 'paymentGateway.gatewayOrderId': gatewayOrderId });
    }

    if (!order) {
      return res.status(200).json({ message: 'Webhook acknowledged. Order mapping not found.' });
    }

    const successEvents = new Set(['payment.captured', 'payment.authorized', 'order.paid']);
    const failureEvents = new Set(['payment.failed']);

    if (successEvents.has(event)) {
      const expectedAmountInPaise = toAmountInPaise(order.totalAmount);
      const gatewayAmountInPaise = Number(paymentEntity?.amount || orderEntity?.amount || 0);
      if (gatewayAmountInPaise && gatewayAmountInPaise !== expectedAmountInPaise) {
        return res.status(400).json({ message: 'Webhook payment amount mismatch.' });
      }

      const expectedCurrency = getRazorpayCurrency();
      const gatewayCurrency = String(paymentEntity?.currency || orderEntity?.currency || '').trim().toUpperCase();
      if (gatewayCurrency && gatewayCurrency !== expectedCurrency) {
        return res.status(400).json({ message: 'Webhook payment currency mismatch.' });
      }

      const paymentStatus = String(paymentEntity?.status || '').trim().toLowerCase()
        || (event === 'payment.captured' ? 'captured' : 'authorized');

      if (order.paymentStatus !== 'completed') {
        await applySuccessfulPaymentEffects(order, {
          transactionId: gatewayPaymentId || `rzp_wh_${Date.now()}`,
          paymentMethod: 'razorpay',
          paymentGateway: {
            provider: 'razorpay',
            gatewayOrderId: gatewayOrderId || String(order.paymentGateway?.gatewayOrderId || ''),
            gatewayPaymentId: gatewayPaymentId || String(order.paymentGateway?.gatewayPaymentId || ''),
            amount: Number((expectedAmountInPaise / 100).toFixed(2)),
            currency: expectedCurrency,
            status: paymentStatus,
            captured: paymentStatus === 'captured' || event === 'payment.captured' || event === 'order.paid',
            paidAt: new Date(),
            raw: {
              webhookEvent: event,
              webhookReceivedAt: new Date().toISOString(),
              paymentMethod: String(paymentEntity?.method || ''),
              paymentEmail: String(paymentEntity?.email || ''),
              paymentContact: String(paymentEntity?.contact || ''),
              orderStatus: String(orderEntity?.status || ''),
            },
          },
        });
      }

      return res.status(200).json({ message: 'Razorpay webhook processed.' });
    }

    if (failureEvents.has(event)) {
      if (order.paymentStatus !== 'completed') {
        order.paymentStatus = 'failed';
        order.paymentGateway = Object.assign({}, order.paymentGateway || {}, {
          provider: 'razorpay',
          gatewayOrderId: gatewayOrderId || String(order.paymentGateway?.gatewayOrderId || ''),
          gatewayPaymentId: gatewayPaymentId || String(order.paymentGateway?.gatewayPaymentId || ''),
          status: String(paymentEntity?.status || 'failed').trim().toLowerCase() || 'failed',
          captured: false,
          raw: Object.assign({}, order.paymentGateway?.raw || {}, {
            webhookEvent: event,
            webhookReceivedAt: new Date().toISOString(),
            errorCode: String(paymentEntity?.error_code || ''),
            errorDescription: String(paymentEntity?.error_description || ''),
          }),
        });
        await order.save();
      }

      return res.status(200).json({ message: 'Razorpay failure webhook processed.' });
    }

    return res.status(200).json({ message: 'Razorpay webhook ignored.' });
  } catch (err) {
    const errorMsg = typeof err === 'string' ? err : (err?.message || String(err) || 'Unknown error');
    console.error('[RAZORPAY_WEBHOOK] Error:', errorMsg, err);
    return res.status(500).json({ message: errorMsg });
  }
});

// GET /api/orders/user/me - Get all orders for logged-in user
router.get('/user/me', auth, async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user._id })
      .populate('items.product', 'title price')
      .sort({ createdAt: -1 });

    res.json({ orders });
  } catch (err) {
    const errorMsg = typeof err === 'string' ? err : (err?.message || String(err) || 'Unknown error');
    console.error('Get user orders error:', errorMsg, err);
    res.status(500).json({ message: errorMsg });
  }
});

// GET /api/orders/seller/me - Get seller orders containing seller-owned items
router.get('/seller/me', auth, async (req, res) => {
  try {
    const sellerId = String(req.user._id);
    console.log('[SELLER_ORDERS][DEBUG] sellerId:', sellerId, 'typeof:', typeof sellerId);
    console.log('[SELLER_ORDERS][DEBUG] sellerId:', sellerId, 'typeof:', typeof sellerId);

    // Defensive check: if sellerId is not a 24-char hex string something went wrong upstream.
    const isHex24 = /^[0-9a-fA-F]{24}$/.test(sellerId);
    if (!isHex24) {
      console.error('[SELLER_ORDERS][ERROR] Computed sellerId is not a valid ObjectId hex string', { sellerId, type: typeof sellerId });
      const sampleUser = (() => {
        try {
          return req.user && (typeof req.user.toObject === 'function' ? req.user.toObject() : req.user);
        } catch (e) {
          return { error: 'failed to serialize req.user' };
        }
      })();
      return res.status(500).json({ message: 'Invalid seller id computed', debug: { sellerId, sellerIdType: typeof sellerId, sampleUser } });
    }
    try {
      console.log('[SELLER_ORDERS][DEBUG] req.user (truncated):', {
        id: req.user?._id,
        name: req.user?.name,
        email: req.user?.email,
      });
    } catch (e) {
      console.log('[SELLER_ORDERS][DEBUG] failed to log req.user:', e?.message || e);
    }

    // Build safe match: match either real ObjectId equality OR string fields containing the hex id
    const sellerHex = sellerId;
    const matchOr = [];
    if (mongoose.Types.ObjectId.isValid(sellerHex)) {
      matchOr.push({ 'items.seller': new mongoose.Types.ObjectId(sellerHex) });
    }
    // Match stringified seller fields that contain the hex id (covers malformed stringified user objects)
    matchOr.push({ 'items.seller': new RegExp(escapeRegex(sellerHex)) });

    console.log('[SELLER_ORDERS][DEBUG] Aggregation matchOr (raw):', matchOr);

    // Use the raw MongoDB collection aggregation to avoid Mongoose casting of schema paths
    const agg = await mongoose.connection.db
      .collection('orders')
      .aggregate([
        { $unwind: '$items' },
        { $match: { $or: matchOr } },
        { $group: { _id: '$_id' } },
        { $sort: { _id: -1 } },
      ])
      .toArray();

    const orderIds = (agg || []).map((a) => a._id).filter(Boolean);
    console.log('[SELLER_ORDERS][DEBUG] Matched order ids count (raw):', orderIds.length);

    let orders = [];
    if (orderIds.length > 0) {
      // Fetch raw documents directly from MongoDB to avoid Mongoose schema casting
      const rawOrders = await mongoose.connection.db.collection('orders').find({ _id: { $in: orderIds } }).toArray();

      // Collect user and product ids for lightweight lookups
      const userIdSet = new Set();
      const productIdSet = new Set();
      for (const ro of rawOrders) {
        try {
          const u = ro && ro.user ? (typeof ro.user === 'object' && ro.user._id ? String(ro.user._id) : String(ro.user)) : null;
          if (u) userIdSet.add(u);
        } catch (e) {
          // ignore
        }
        for (const it of (ro.items || [])) {
          try {
            const p = it && it.product ? (typeof it.product === 'object' && it.product._id ? String(it.product._id) : String(it.product)) : null;
            if (p) productIdSet.add(p);
          } catch (e) {}
        }
      }

      const userIds = Array.from(userIdSet);
      const productIds = Array.from(productIdSet);

      const users = userIds.length > 0 ? await User.find({ _id: { $in: userIds } }).lean().select('_id name email') : [];
      const products = productIds.length > 0 ? await Product.find({ _id: { $in: productIds } }).lean().select('_id title') : [];

      const userMap = new Map((users || []).map((u) => [String(u._id), u]));
      const productMap = new Map((products || []).map((p) => [String(p._id), p]));

      // Normalize raw orders into objects compatible with toSellerOrderView
      orders = rawOrders.map((ro) => {
        const uidRaw = ro && ro.user ? (typeof ro.user === 'object' && ro.user._id ? String(ro.user._id) : String(ro.user)) : '';
        const buyer = userMap.get(uidRaw) || (typeof ro.user === 'object' ? ro.user : { _id: uidRaw, name: ro.user?.name || '', email: ro.user?.email || '' });

        const items = (ro.items || []).map((it) => {
          let sellerVal = it.seller;
          if (sellerVal && typeof sellerVal === 'object') {
            if (sellerVal._id) sellerVal = String(sellerVal._id);
            else {
              try {
                sellerVal = JSON.stringify(sellerVal);
              } catch (e) {
                sellerVal = String(sellerVal);
              }
            }
          } else {
            sellerVal = String(sellerVal || '');
          }

          const prodRaw = it.product;
          const prodId = prodRaw && typeof prodRaw === 'object' && prodRaw._id ? String(prodRaw._id) : String(prodRaw || '');
          const prodDoc = productMap.get(prodId) || (typeof prodRaw === 'object' ? prodRaw : null);

          return Object.assign({}, it, { seller: sellerVal, product: prodDoc });
        });

        return Object.assign({}, ro, { user: buyer, items });
      });
    }

    const sellerOrders = orders
      .map((order) => toSellerOrderView(order, sellerId))
      .filter(Boolean);

    const newOrdersCount = sellerOrders.reduce(
      (sum, order) => sum + order.items.filter((item) => item.fulfillmentStatus === 'new').length,
      0
    );

    res.json({ orders: sellerOrders, newOrdersCount });
  } catch (err) {
    const errorMsg = typeof err === 'string' ? err : (err?.message || String(err) || 'Unknown error');
    console.error('Get seller orders error:', errorMsg, err);
    res.status(500).json({ message: errorMsg });
  }
});

// PATCH /api/orders/seller/:orderId/items/:itemIndex/status - Update seller item shipment status
router.patch('/seller/:orderId/items/:itemIndex/status', auth, async (req, res) => {
  try {
    const sellerId = String(req.user._id);
    const orderId = String(req.params.orderId || '');
    const itemIndex = Number.parseInt(String(req.params.itemIndex || ''), 10);
    const nextStatus = String(req.body?.status || '').trim().toLowerCase();
    const note = String(req.body?.note || '').trim();

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: 'Invalid order id' });
    }

    if (!Number.isInteger(itemIndex) || itemIndex < 0) {
      return res.status(400).json({ message: 'Invalid item index' });
    }

    if (!SELLER_STATUS_ORDER.includes(nextStatus)) {
      return res.status(400).json({ message: 'Invalid shipment status' });
    }

    const order = await Order.findById(orderId).populate('user', 'name email').populate('items.product', 'title');
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (!Array.isArray(order.items) || itemIndex >= order.items.length) {
      return res.status(400).json({ message: 'Invalid item index' });
    }

    const item = order.items[itemIndex];
    if (String(item.seller || '') !== sellerId) {
      return res.status(403).json({ message: 'Unauthorized to update this item' });
    }

    item.fulfillmentStatus = nextStatus;
    item.trackingEvents = Array.isArray(item.trackingEvents) ? item.trackingEvents : [];
    item.trackingEvents.push({
      status: nextStatus,
      note: note || `Marked as ${nextStatus}`,
      updatedBy: sellerId,
      at: new Date(),
    });

    order.status = buildOrderStatusFromItems(order.items || []);

    const sellerItemIndexes = (order.items || [])
      .map((entry, idx) => ({ entry, idx }))
      .filter(({ entry }) => String(entry?.seller || '') === sellerId)
      .map(({ idx }) => idx);
    const sellerItemStatuses = sellerItemIndexes.map((idx) => String(order.items[idx]?.fulfillmentStatus || 'new').toLowerCase());
    const derivedShipmentStatus = buildSellerShipmentStatusFromItems(sellerItemStatuses);

    order.sellerShipments = Array.isArray(order.sellerShipments) ? order.sellerShipments : [];
    let sellerShipment = order.sellerShipments.find((entry) => String(entry?.seller || '') === sellerId);

    if (!sellerShipment && sellerItemIndexes.length > 0) {
      const fallbackShipment = {
        seller: sellerId,
        itemIndexes: sellerItemIndexes,
        localShipmentRef: `HK-${String(order._id).slice(-8).toUpperCase()}-MIG`,
        status: derivedShipmentStatus,
        lastError: '',
        timeline: [],
      };
      order.sellerShipments.push(fallbackShipment);
      sellerShipment = order.sellerShipments[order.sellerShipments.length - 1];
    }

    if (sellerShipment) {
      if (SELLER_SHIPMENT_STATUS_ORDER.includes(derivedShipmentStatus)) {
        sellerShipment.status = derivedShipmentStatus;
      }
      sellerShipment.itemIndexes = sellerItemIndexes;
      sellerShipment.timeline = Array.isArray(sellerShipment.timeline) ? sellerShipment.timeline : [];
      sellerShipment.timeline.push({
        status: sellerShipment.status,
        note: note || `Seller updated item status to ${nextStatus}.`,
        source: 'seller',
        at: new Date(),
      });
    }

    await order.save();

    try {
      await syncSellerPayoutAfterFulfillment(order, sellerId, 'seller');
    } catch (payoutErr) {
      console.warn('[SELLER_STATUS][PAYOUT] Failed to sync payout state:', payoutErr?.message || payoutErr);
    }

    const sellerOrder = toSellerOrderView(order, sellerId);
    res.json({ message: 'Shipment status updated', order: sellerOrder });
  } catch (err) {
    const errorMsg = typeof err === 'string' ? err : (err?.message || String(err) || 'Unknown error');
    console.error('Update shipment status error:', errorMsg, err);
    res.status(500).json({ message: errorMsg });
  }
});

// POST /api/orders/carrier/nimbuspost/webhook - Receive NimbusPost tracking updates
router.post('/carrier/nimbuspost/webhook', async (req, res) => {
  try {
    const secret = String(env.nimbuspost?.webhookSecret || '').trim();
    if (!isNimbusWebhookAuthorized(req, secret)) {
      return res.status(401).json({ message: 'Invalid webhook signature/secret' });
    }

    const payload = req.body || {};
    const awbNumber = extractNimbusWebhookAwb(payload);

    if (!awbNumber) {
      return res.status(400).json({ message: 'AWB number is required in webhook payload.' });
    }

    const order = await Order.findOne({ 'sellerShipments.carrier.awbNumber': awbNumber });
    if (!order) {
      return res.status(200).json({ message: 'No shipment found for AWB.' });
    }

    const shipment = (order.sellerShipments || []).find(
      (entry) => String(entry?.carrier?.awbNumber || '').trim() === awbNumber
    );

    if (!shipment) {
      return res.status(200).json({ message: 'Shipment entry not found for AWB.' });
    }

    const remoteStatus = extractNimbusWebhookStatus(payload);
    const mappedStatus = mapNimbusStatusToShipmentStatus(remoteStatus);

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

    const shipmentSellerId = String(shipment?.seller || '');
    if (shipmentSellerId && mongoose.Types.ObjectId.isValid(shipmentSellerId)) {
      try {
        await syncSellerPayoutAfterFulfillment(order, shipmentSellerId, 'system');
      } catch (payoutErr) {
        console.warn('[NIMBUS_WEBHOOK][PAYOUT] Failed to sync payout state:', payoutErr?.message || payoutErr);
      }
    }

    return res.status(200).json({ message: 'NimbusPost webhook processed.' });
  } catch (err) {
    const errorMsg = typeof err === 'string' ? err : (err?.message || String(err) || 'Unknown error');
    console.error('[NIMBUS_WEBHOOK] Error:', errorMsg, err);
    return res.status(500).json({ message: errorMsg });
  }
});

// POST /api/orders/seller/:orderId/shipments/:shipmentRef/sync-tracking - Pull latest NimbusPost status by AWB
router.post('/seller/:orderId/shipments/:shipmentRef/sync-tracking', auth, async (req, res) => {
  try {
    const sellerId = String(req.user._id);
    const orderId = String(req.params.orderId || '');
    const shipmentRef = String(req.params.shipmentRef || '').trim();

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: 'Invalid order id' });
    }

    if (!shipmentRef) {
      return res.status(400).json({ message: 'Shipment reference is required' });
    }

    const order = await Order.findById(orderId).populate('user', 'name email').populate('items.product', 'title');
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const shipment = (order.sellerShipments || []).find(
      (entry) => String(entry?.seller || '') === sellerId && String(entry?.localShipmentRef || '') === shipmentRef
    );

    if (!shipment) {
      return res.status(404).json({ message: 'Shipment not found for this seller' });
    }

    const provider = String(shipment?.carrier?.provider || '').toLowerCase();
    const awbNumber = String(shipment?.carrier?.awbNumber || '').trim();

    if (provider !== 'nimbuspost' || !awbNumber) {
      return res.status(400).json({ message: 'NimbusPost AWB is not available for this shipment yet.' });
    }

    const tracking = await trackShipmentByAwb(awbNumber);
    const remoteStatus = String(tracking.remoteStatus || '').trim();
    const mappedStatus = mapNimbusStatusToShipmentStatus(remoteStatus);

    if (SELLER_SHIPMENT_STATUS_ORDER.includes(mappedStatus)) {
      shipment.status = mappedStatus;
    }

    shipment.lastError = mappedStatus === 'failed'
      ? (shipment.lastError || `NimbusPost reported status: ${remoteStatus || 'failed'}`)
      : '';
    shipment.carrier.remoteStatus = remoteStatus || shipment.carrier.remoteStatus || '';

    appendShipmentTimelineEntry(shipment, {
      status: shipment.status,
      note: remoteStatus
        ? `NimbusPost sync: ${remoteStatus}`
        : 'NimbusPost sync completed.',
      source: 'system',
    });

    syncOrderItemsFromShipment(order, shipment, {
      note: remoteStatus
        ? `NimbusPost sync: ${remoteStatus}`
        : 'NimbusPost sync completed.',
      updatedBy: null,
    });

    await order.save();

    try {
      await syncSellerPayoutAfterFulfillment(order, sellerId, 'system');
    } catch (payoutErr) {
      console.warn('[SYNC_TRACKING][PAYOUT] Failed to sync payout state:', payoutErr?.message || payoutErr);
    }

    const sellerOrder = toSellerOrderView(order, sellerId);
    return res.json({ message: 'Tracking synced', order: sellerOrder });
  } catch (err) {
    const errorMsg = typeof err === 'string' ? err : (err?.message || String(err) || 'Unknown error');
    console.error('Sync Nimbus tracking error:', errorMsg, err);
    return res.status(500).json({ message: errorMsg });
  }
});

// GET /api/orders/:id - Get order details
router.get('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid order id' });
    }

    const order = await Order.findById(id).populate('items.product');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Verify order belongs to user
    if (String(order.user) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    res.json(order);
  } catch (err) {
    const errorMsg = typeof err === 'string' ? err : (err?.message || String(err) || 'Unknown error');
    console.error('Get order details error:', errorMsg, err);
    res.status(500).json({ message: errorMsg });
  }
});

// DELETE /api/orders/:id - Cancel order (only if pending)
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid order id' });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Verify order belongs to user
    if (String(order.user) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    // Only allow cancellation if pending
    if (order.status !== 'pending' || order.paymentStatus === 'completed') {
      return res.status(400).json({ message: 'Cannot cancel this order' });
    }

    // Stock is now reduced only after successful payment.
    // Pending unpaid orders do not hold stock, so no stock restore is needed here.

    order.status = 'cancelled';

    if (Array.isArray(order.sellerShipments)) {
      order.sellerShipments.forEach((shipment) => {
        shipment.status = 'cancelled';
        shipment.timeline = Array.isArray(shipment.timeline) ? shipment.timeline : [];
        shipment.timeline.push({
          status: 'cancelled',
          note: 'Order cancelled by buyer before shipment dispatch.',
          source: 'system',
          at: new Date(),
        });
      });
    }

    await order.save();

    res.json({ message: 'Order cancelled', order });
  } catch (err) {
    const errorMsg = typeof err === 'string' ? err : (err?.message || String(err) || 'Unknown error');
    console.error('Cancel order error:', errorMsg, err);
    res.status(500).json({ message: errorMsg });
  }
});

module.exports = router;
