const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

require('dotenv').config({ path: __dirname + '/.env' });

const User = require('./models/User');
const Product = require('./models/Product');
const Order = require('./models/Order');

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

async function main() {
  let exitCode = 0;

  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/handkraft';
    await mongoose.connect(mongoUri, { family: 4 });
    console.log('[TEST] Connected to MongoDB');

    let seller = await User.findOne({ email: 'qa-draft-seller@handkraft.local' });
    if (!seller) {
      seller = await User.create({
        name: 'QA Draft Seller',
        email: 'qa-draft-seller@handkraft.local',
        password: '',
        cartItems: [],
      });
      console.log('[TEST] Created QA seller:', String(seller._id));
    }

    let buyer = await User.findOne({ email: 'qa-draft-buyer@handkraft.local' });
    if (!buyer) {
      buyer = await User.create({
        name: 'QA Draft Buyer',
        email: 'qa-draft-buyer@handkraft.local',
        password: '',
        cartItems: [],
      });
      console.log('[TEST] Created QA buyer:', String(buyer._id));
    }

    const product = await Product.findOne({ isActive: true, stock: { $gt: 0 } }).sort({ updatedAt: -1 });
    if (!product) {
      throw new Error('No in-stock active product found for draft-order smoke test.');
    }

    product.seller = seller._id;
    product.sellerName = seller.name;
    await product.save();

    buyer.cartItems = [{ product: product._id, quantity: 1 }];
    await buyer.save();

    const buyerToken = jwt.sign(
      { id: buyer._id },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '2h' }
    );

    const sellerToken = jwt.sign(
      { id: seller._id },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '2h' }
    );

    const sellerBefore = await requestJson('/api/orders/seller/me', { token: sellerToken });
    if (!sellerBefore.ok) {
      throw new Error(`Seller order fetch failed before create: ${JSON.stringify(sellerBefore.json)}`);
    }

    const createOrderRes = await requestJson('/api/orders', {
      method: 'POST',
      token: buyerToken,
      body: {
        shippingAddress: {
          fullName: 'QA Draft Buyer',
          phoneNumber: '9876543210',
          email: 'qa-draft-buyer@handkraft.local',
          street: '12 Draft Test Lane',
          city: 'Bengaluru',
          postalCode: '560001',
          country: 'India',
        },
      },
    });

    if (!createOrderRes.ok || !createOrderRes.json?.order?._id) {
      throw new Error(`Create draft order failed: ${JSON.stringify(createOrderRes.json)}`);
    }

    const draftOrder = createOrderRes.json.order;
    const orderId = String(draftOrder._id);

    if (String(draftOrder.isDraft) !== 'true') {
      throw new Error(`Expected draft order to be hidden draft, got isDraft=${String(draftOrder.isDraft)}`);
    }

    const sellerAfterCreate = await requestJson('/api/orders/seller/me', { token: sellerToken });
    if (!sellerAfterCreate.ok) {
      throw new Error(`Seller order fetch failed after create: ${JSON.stringify(sellerAfterCreate.json)}`);
    }

    if (Number(sellerAfterCreate.json.newOrdersCount || 0) !== 0) {
      throw new Error('Draft order leaked into seller new order count.');
    }

    const sellerOrders = Array.isArray(sellerAfterCreate.json.orders) ? sellerAfterCreate.json.orders : [];
    if (sellerOrders.length !== 0) {
      throw new Error('Draft order leaked into seller order list.');
    }

    const discardRes = await requestJson(`/api/orders/${orderId}/draft`, {
      method: 'DELETE',
      token: buyerToken,
    });

    if (!discardRes.ok) {
      throw new Error(`Discard draft failed: ${JSON.stringify(discardRes.json)}`);
    }

    const deletedOrder = await Order.findById(orderId).lean();
    if (deletedOrder) {
      throw new Error('Draft order still exists after discard.');
    }

    const refreshedBuyer = await User.findById(buyer._id).lean();
    if (!refreshedBuyer || !Array.isArray(refreshedBuyer.cartItems) || refreshedBuyer.cartItems.length !== 1) {
      throw new Error('Buyer cart was unexpectedly changed by draft discard.');
    }

    console.log('[TEST] PASS: draft orders stay hidden and can be discarded safely');
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

main();