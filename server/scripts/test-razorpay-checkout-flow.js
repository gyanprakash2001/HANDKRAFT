const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

require('dotenv').config({ path: __dirname + '/../.env' });

const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');

function getEffectiveUnitPrice(product) {
  const realPrice = Math.max(0, Number(product?.realPrice ?? product?.price) || 0);
  const discountedPrice = Number(product?.discountedPrice);
  const hasDiscount = Number.isFinite(discountedPrice)
    && discountedPrice >= 0
    && discountedPrice < realPrice;

  return hasDiscount ? discountedPrice : realPrice;
}

async function requestJson(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`http://localhost:5000${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const raw = await response.text().catch(() => '');
  let json;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    json = { raw };
  }

  return {
    status: response.status,
    ok: response.ok,
    json,
  };
}

async function main() {
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/handkraft';
  await mongoose.connect(mongoUri, { family: 4 });

  try {
    let user = await User.findOne({ email: 'qa-checkout-flow@handkraft.local' });
    if (!user) {
      user = await User.create({
        name: 'QA Checkout User',
        email: 'qa-checkout-flow@handkraft.local',
        password: '',
        cartItems: [],
      });
      console.log('[TEST] Created QA user:', String(user._id));
    } else {
      console.log('[TEST] Using QA user:', String(user._id));
    }

    let product = await Product.findOne({
      isActive: true,
      stock: { $gt: 0 },
      discountedPrice: { $type: 'number' },
    }).sort({ updatedAt: -1 });

    if (!product) {
      product = await Product.findOne({ isActive: true, stock: { $gt: 0 } }).sort({ updatedAt: -1 });
    }

    if (!product) {
      throw new Error('No in-stock active products found for test flow.');
    }

    const quantity = 2;
    user.cartItems = [{ product: product._id, quantity }];
    await user.save();

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '2h' }
    );

    const createOrderRes = await requestJson('/api/orders', {
      method: 'POST',
      token,
      body: {
        shippingAddress: {
          fullName: 'QA Checkout User',
          phoneNumber: '9876543210',
          email: 'qa-checkout-flow@handkraft.local',
          street: '12 Test Lane',
          city: 'Test City',
          postalCode: '560001',
          country: 'India',
        },
      },
    });

    console.log('[TEST] Create order status:', createOrderRes.status);
    if (!createOrderRes.ok || !createOrderRes.json?.order?._id) {
      throw new Error(`Order creation failed: ${JSON.stringify(createOrderRes.json)}`);
    }

    const createdOrder = createOrderRes.json.order;
    const orderId = String(createdOrder._id);

    const expectedUnitPrice = Number(getEffectiveUnitPrice(product).toFixed(2));
    const expectedSubtotal = Number((expectedUnitPrice * quantity).toFixed(2));
    const actualSubtotal = Number(createdOrder.subtotal || 0);

    if (Math.abs(actualSubtotal - expectedSubtotal) > 0.01) {
      throw new Error(`Subtotal mismatch. Expected ${expectedSubtotal}, got ${actualSubtotal}`);
    }

    console.log('[TEST] Subtotal check passed:', {
      expectedUnitPrice,
      expectedSubtotal,
      actualSubtotal,
    });

    const razorpayOrderRes = await requestJson(`/api/orders/${orderId}/pay/razorpay-order`, {
      method: 'POST',
      token,
    });

    console.log('[TEST] Razorpay order status:', razorpayOrderRes.status);
    if (razorpayOrderRes.status === 503) {
      console.log('[TEST] Razorpay not enabled on server, skipping gateway checks.');
    } else {
      if (!razorpayOrderRes.ok) {
        throw new Error(`Razorpay order creation failed: ${JSON.stringify(razorpayOrderRes.json)}`);
      }

      const paymentOrder = razorpayOrderRes.json?.paymentOrder || {};
      const expectedAmountPaise = Math.round(Number(createdOrder.totalAmount || 0) * 100);
      const actualAmountPaise = Number(paymentOrder.amount || 0);
      if (expectedAmountPaise !== actualAmountPaise) {
        throw new Error(`Razorpay amount mismatch. Expected ${expectedAmountPaise}, got ${actualAmountPaise}`);
      }

      const invalidSignatureRes = await requestJson(`/api/orders/${orderId}/pay`, {
        method: 'POST',
        token,
        body: {
          paymentProvider: 'razorpay',
          razorpayOrderId: String(paymentOrder.gatewayOrderId || 'order_fake'),
          razorpayPaymentId: 'pay_fake',
          razorpaySignature: 'bad_signature',
        },
      });

      console.log('[TEST] Invalid signature status:', invalidSignatureRes.status);
      if (invalidSignatureRes.status !== 400) {
        throw new Error(`Expected invalid signature to return 400, got ${invalidSignatureRes.status}`);
      }
    }

    const fallbackPaymentRes = await requestJson(`/api/orders/${orderId}/pay`, {
      method: 'POST',
      token,
      body: {
        stripeToken: 'tok_checkout_regression',
      },
    });

    console.log('[TEST] Fallback payment status:', fallbackPaymentRes.status);
    if (!fallbackPaymentRes.ok) {
      throw new Error(`Fallback payment failed: ${JSON.stringify(fallbackPaymentRes.json)}`);
    }

    const paidOrder = await Order.findById(orderId).select('paymentStatus status transactionId').lean();
    if (!paidOrder) {
      throw new Error('Paid order not found during final verification.');
    }

    if (String(paidOrder.paymentStatus) !== 'completed') {
      throw new Error(`Expected paymentStatus=completed, got ${String(paidOrder.paymentStatus)}`);
    }

    if (String(paidOrder.status) !== 'confirmed') {
      throw new Error(`Expected status=confirmed, got ${String(paidOrder.status)}`);
    }

    console.log('[TEST] PASS: order pricing + razorpay checks + payment completion passed');
  } finally {
    await mongoose.connection.close();
  }
}

main().catch((err) => {
  console.error('[TEST] FAIL:', err?.message || err);
  process.exit(1);
});
