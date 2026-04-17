'use strict';

const path = require('path');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const User = require('../models/User');
const Order = require('../models/Order');

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}

function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const raw = String(argv[i] || '');
    if (!raw.startsWith('--')) continue;

    const token = raw.slice(2);
    if (!token) continue;

    const eq = token.indexOf('=');
    if (eq >= 0) {
      args[token.slice(0, eq)] = token.slice(eq + 1);
      continue;
    }

    const next = argv[i + 1];
    if (next && !String(next).startsWith('--')) {
      args[token] = String(next);
      i += 1;
      continue;
    }

    args[token] = 'true';
  }

  return args;
}

function normalizeBaseUrl(value) {
  return String(value || 'http://127.0.0.1:5000').replace(/\/+$/, '');
}

function makeToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET || 'secret', { expiresIn: '2h' });
}

async function requestJson(baseUrl, routePath, { method = 'GET', token = '', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${baseUrl}${routePath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const rawText = await response.text().catch(() => '');
  let json;
  try {
    json = rawText ? JSON.parse(rawText) : {};
  } catch {
    json = { raw: rawText };
  }

  return {
    ok: response.ok,
    status: response.status,
    json,
  };
}

function assertOk(result, stepName) {
  if (!result.ok) {
    throw new Error(`${stepName} failed (${result.status}): ${JSON.stringify(result.json)}`);
  }
}

function supportedNimbusStatuses() {
  return new Set([
    'booked',
    'awb_assigned',
    'picked_up',
    'in_transit',
    'out_for_delivery',
    'delivered',
  ]);
}

async function ensureQaUser({ email, name }) {
  let user = await User.findOne({ email });
  if (!user) {
    user = await User.create({
      name,
      email,
      password: '',
      cartItems: [],
      addresses: [],
    });
  }

  return user;
}

async function ensureSellerPickupAddress(seller) {
  const existing = (seller.addresses || []).find((entry) => String(entry.label || '').toLowerCase() === 'warehouse qa');
  if (existing) {
    return String(existing._id);
  }

  seller.addresses.push({
    label: 'Warehouse QA',
    fullName: seller.name || 'QA Seller',
    phoneNumber: '9876543210',
    email: seller.email,
    street: '14 Artisan Street',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560001',
    country: 'India',
    isDefault: true,
  });
  await seller.save();

  const created = (seller.addresses || []).find((entry) => String(entry.label || '').toLowerCase() === 'warehouse qa');
  if (!created?._id) {
    throw new Error('Failed to create seller pickup address fixture.');
  }

  return String(created._id);
}

async function run() {
  if (typeof fetch !== 'function') {
    throw new Error('Node runtime must support fetch (Node 18+).');
  }

  const args = parseArgs(process.argv.slice(2));
  const baseUrl = normalizeBaseUrl(args.baseUrl || process.env.API_BASE_URL || 'http://127.0.0.1:5000');
  const expectNimbus = parseBoolean(args.expectNimbus, true);
  const strictCarrierBooking = parseBoolean(args.strictCarrierBooking, false);

  const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/handkraft';
  await mongoose.connect(mongoUri, { family: 4 });

  try {
    const seller = await ensureQaUser({
      email: 'qa-seller-pickup@handkraft.local',
      name: 'QA Pickup Seller',
    });

    const buyer = await ensureQaUser({
      email: 'qa-buyer-checkout@handkraft.local',
      name: 'QA Checkout Buyer',
    });

    const pickupAddressId = await ensureSellerPickupAddress(seller);
    const sellerToken = makeToken(String(seller._id));
    const buyerToken = makeToken(String(buyer._id));

    const sellerProfileRes = await requestJson(baseUrl, '/api/users/me/seller-profile', {
      method: 'PUT',
      token: sellerToken,
      body: {
        sellerDisplayName: 'QA Pickup Seller',
        sellerTagline: 'Automated QA storefront',
        sellerLocation: 'Bengaluru, Karnataka',
        sellerPickupAddressId: pickupAddressId,
      },
    });
    assertOk(sellerProfileRes, 'seller profile pickup update');

    const persistedPickup = sellerProfileRes.json?.sellerProfile?.sellerPickupAddress || {};
    if (!String(persistedPickup.state || '').trim()) {
      throw new Error('Seller pickup address did not persist correctly (state missing).');
    }

    const skuSuffix = Date.now();
    const createProductRes = await requestJson(baseUrl, '/api/products', {
      method: 'POST',
      token: sellerToken,
      body: {
        title: `QA Pickup Product ${skuSuffix}`,
        description: 'Automated runtime QA listing',
        category: 'Jewelry',
        material: 'Brass',
        price: 899,
        stock: 3,
        images: ['https://placehold.co/800x800/png'],
        pickupAddressId,
      },
    });
    assertOk(createProductRes, 'product create with pickup address');

    const createdProduct = createProductRes.json?.item;
    if (!createdProduct?._id) {
      throw new Error('Product create response is missing item id.');
    }

    buyer.cartItems = [{ product: createdProduct._id, quantity: 1 }];
    await buyer.save();

    const shippingAddress = {
      fullName: 'QA Checkout Buyer',
      phoneNumber: '9876543211',
      email: 'qa-buyer-checkout@handkraft.local',
      street: '22 Buyer Lane',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560002',
      country: 'India',
    };

    const estimateRes = await requestJson(baseUrl, '/api/orders/estimate-shipping', {
      method: 'POST',
      token: buyerToken,
      body: { shippingAddress },
    });
    assertOk(estimateRes, 'checkout estimate-shipping');

    const estimateSource = String(estimateRes.json?.shippingQuote?.source || '');
    if (expectNimbus && estimateSource !== 'nimbus_serviceability') {
      const reason = String(estimateRes.json?.shippingQuote?.reason || 'unknown reason');
      throw new Error(`Expected Nimbus quote source but got '${estimateSource || 'none'}' (${reason}).`);
    }

    const createOrderRes = await requestJson(baseUrl, '/api/orders', {
      method: 'POST',
      token: buyerToken,
      body: { shippingAddress },
    });
    assertOk(createOrderRes, 'order create');

    const order = createOrderRes.json?.order;
    if (!order?._id) {
      throw new Error('Order creation response is missing order id.');
    }

    const orderId = String(order._id);

    const razorpayOrderRes = await requestJson(baseUrl, `/api/orders/${orderId}/pay/razorpay-order`, {
      method: 'POST',
      token: buyerToken,
    });
    assertOk(razorpayOrderRes, 'razorpay order creation');

    const fallbackPayRes = await requestJson(baseUrl, `/api/orders/${orderId}/pay`, {
      method: 'POST',
      token: buyerToken,
      body: {
        stripeToken: `tok_runtime_${Date.now()}`,
      },
    });
    assertOk(fallbackPayRes, 'payment completion fallback path');

    const paidOrder = await Order.findById(orderId).lean();
    if (!paidOrder) {
      throw new Error('Paid order was not found in database.');
    }

    if (String(paidOrder.paymentStatus) !== 'completed') {
      throw new Error(`Expected paymentStatus=completed but got ${String(paidOrder.paymentStatus)}.`);
    }

    if (String(paidOrder.status) !== 'confirmed') {
      throw new Error(`Expected status=confirmed but got ${String(paidOrder.status)}.`);
    }

    const shipment = Array.isArray(paidOrder.sellerShipments) ? paidOrder.sellerShipments[0] : null;
    if (!shipment) {
      throw new Error('Expected at least one seller shipment on paid order.');
    }

    const shipmentStatus = String(shipment?.status || '').toLowerCase();

    if (expectNimbus) {
      const allowed = supportedNimbusStatuses();
      if (!allowed.has(shipmentStatus)) {
        const shipmentError = String(shipment?.lastError || 'No carrier error returned.');
        if (strictCarrierBooking) {
          throw new Error(`Expected Nimbus shipment booking success but got status='${shipmentStatus}' (${shipmentError}).`);
        }

        console.warn('[RUNTIME_QA] WARN carrier booking not completed:', {
          shipmentStatus,
          shipmentError,
        });
      }
    }

    console.log('[RUNTIME_QA] PASS seller pickup -> product create -> estimate shipping -> order -> payment path');
    console.log('[RUNTIME_QA] Summary:', {
      orderId,
      estimateSource,
      shipmentStatus,
      awbNumber: String(shipment?.carrier?.awbNumber || ''),
      strictCarrierBooking,
    });
  } finally {
    await mongoose.connection.close();
  }
}

run().catch((err) => {
  console.error('[RUNTIME_QA] FAIL:', err?.message || err);
  process.exit(1);
});
