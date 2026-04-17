const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

require('dotenv').config({ path: __dirname + '/.env' });

const User = require('./models/User');
const Product = require('./models/Product');
const Order = require('./models/Order');

function getEffectiveUnitPrice(product) {
  const realPrice = Math.max(0, Number(product?.realPrice ?? product?.price) || 0);
  const discountedPrice = Number(product?.discountedPrice);
  const hasDiscount = Number.isFinite(discountedPrice)
    && discountedPrice >= 0
    && discountedPrice < realPrice;

  return hasDiscount ? discountedPrice : realPrice;
}

async function requestJson(path, { method = 'GET', body, token } = {}) {
  const port = Number(process.env.PORT || 5000);
  const headers = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`http://localhost:${port}${path}`, {
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

async function testPaymentFlow() {
  let exitCode = 0;

  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/handkraft';
    await mongoose.connect(mongoUri, { family: 4 });
    console.log('[TEST] Connected to MongoDB');

    let user = await User.findOne({ email: 'qa-payment-smoke@handkraft.local' });
    if (!user) {
      user = await User.create({
        name: 'QA Payment Smoke',
        email: 'qa-payment-smoke@handkraft.local',
        password: '',
        cartItems: [],
      });
      console.log('[TEST] Created QA user:', String(user._id));
    } else {
      console.log('[TEST] Using QA user:', String(user._id));
    }

    const product = await Product.findOne({ isActive: true, stock: { $gt: 0 } }).sort({ updatedAt: -1 });
    if (!product) {
      throw new Error('No in-stock active product found for payment smoke test.');
    }

    user.cartItems = [{ product: product._id, quantity: 1 }];
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
          fullName: 'QA Payment Smoke',
          phoneNumber: '9876543210',
          email: 'qa-payment-smoke@handkraft.local',
          street: '12 Smoke Test Lane',
          city: 'Bengaluru',
          postalCode: '560001',
          country: 'India',
        },
      },
    });

    console.log('[TEST] Create order status:', createOrderRes.status);
    if (!createOrderRes.ok || !createOrderRes.json?.order?._id) {
      throw new Error(`Create order failed: ${JSON.stringify(createOrderRes.json)}`);
    }

    const createdOrder = createOrderRes.json.order;
    const orderId = String(createdOrder._id);
    const expectedSubtotal = Number(getEffectiveUnitPrice(product).toFixed(2));
    const actualSubtotal = Number(createdOrder.subtotal || 0);
    if (Math.abs(expectedSubtotal - actualSubtotal) > 0.01) {
      throw new Error(`Subtotal mismatch. Expected ${expectedSubtotal}, got ${actualSubtotal}`);
    }

    const payRes = await requestJson(`/api/orders/${orderId}/pay`, {
      method: 'POST',
      token,
      body: {
        stripeToken: 'tok_checkout_smoke',
      },
    });

    console.log('[TEST] Pay order status:', payRes.status);
    if (!payRes.ok) {
      throw new Error(`Payment failed: ${JSON.stringify(payRes.json)}`);
    }

    const paidOrder = await Order.findById(orderId)
      .select('paymentStatus status transactionId paymentMethod')
      .lean();

    if (!paidOrder) {
      throw new Error('Paid order not found in DB verification step.');
    }

    if (String(paidOrder.paymentStatus) !== 'completed') {
      throw new Error(`Expected paymentStatus=completed, got ${String(paidOrder.paymentStatus)}`);
    }

    if (String(paidOrder.status) !== 'confirmed') {
      throw new Error(`Expected status=confirmed, got ${String(paidOrder.status)}`);
    }

    console.log('[TEST] PASS: payment flow succeeded end-to-end');
  } catch (err) {
    exitCode = 1;
    console.error('[TEST] FAIL:', err?.message || err);
    if (err?.stack) {
      console.error(err.stack);
    }
  } finally {
    try {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close();
      }
    } catch {
      // Ignore close failures in test cleanup.
    }
    process.exit(exitCode);
  }
}

testPaymentFlow();
