const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');

// Helper: Calculate tax (assumed 5% for demo)
function calculateTax(subtotal) {
  return Number((subtotal * 0.05).toFixed(2));
}

// Helper: Calculate shipping (free for orders > 500, else 50)
function calculateShipping(subtotal) {
  return subtotal > 500 ? 0 : 50;
}

function escapeRegex(input) {
  return String(input || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SELLER_STATUS_ORDER = ['new', 'processing', 'packed', 'shipped', 'delivered', 'cancelled'];

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

function toSellerOrderView(order, sellerId) {
  const items = (order.items || [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => String(item.seller || '') === String(sellerId));

  if (items.length === 0) {
    return null;
  }
  const sellerSubtotal = items.reduce((sum, { item }) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0), 0);

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

    const { shippingAddress, notes } = req.body;
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

      const itemTotal = product.price * cartItem.quantity;
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
        price: product.price,
        title: product.title,
        image: product.images?.[0] || product.media?.[0]?.url || '',
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

    // Calculate costs
    const shippingCost = calculateShipping(subtotal);
    const tax = calculateTax(subtotal);
    const totalAmount = subtotal + shippingCost + tax;
    console.log('[CREATE_ORDER] Calculated totals - subtotal:', subtotal, 'shipping:', shippingCost, 'tax:', tax, 'total:', totalAmount);

    // Create order
    console.log('[CREATE_ORDER] Creating order document...');
    const order = new Order({
      user: user._id,
      items: orderItems,
      shippingAddress,
      subtotal: Number(subtotal.toFixed(2)),
      shippingCost,
      tax,
      totalAmount: Number(totalAmount.toFixed(2)),
      status: 'pending',
      paymentStatus: 'pending',
      notes: notes || '',
    });

    console.log('[CREATE_ORDER] Saving order...');
    await order.save();
    console.log('[CREATE_ORDER] Order saved successfully:', order._id);

    res.status(201).json({
      message: 'Order created successfully',
      order: order,
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

// POST /api/orders/:id/pay - Process payment for an order
router.post('/:id/pay', auth, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('[PAYMENT] Starting payment process for order:', id, 'user:', req.user);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      console.log('[PAYMENT] Invalid order ID format:', id);
      return res.status(400).json({ message: 'Invalid order id' });
    }

    const order = await Order.findById(id);
    if (!order) {
      console.log('[PAYMENT] Order not found:', id);
      return res.status(404).json({ message: 'Order not found' });
    }

    if (!order.items || order.items.length === 0) {
      console.log('[PAYMENT] Order has no items:', id);
      return res.status(400).json({ message: 'Order has no items' });
    }

    // Verify order belongs to user
    console.log('[PAYMENT][DEBUG] Comparing order.user and req.user._id:', {
      orderUser: order.user,
      authUserId: req.user._id,
      authUser: req.user
    });
    if (String(order.user) !== String(req.user._id)) {
      console.log('[PAYMENT] Unauthorized - order user:', order.user, 'auth user id:', req.user._id);
      return res.status(403).json({ message: 'Unauthorized', debug: { orderUser: order.user, authUserId: req.user._id, authUser: req.user } });
    }

    // Check if already paid
    if (order.paymentStatus === 'completed') {
      console.log('[PAYMENT] Order already paid:', id);
      return res.status(400).json({ message: 'Order already paid' });
    }

    const { stripeToken } = req.body;
    console.log('[PAYMENT] Received stripe token:', stripeToken ? 'yes' : 'no');

    // Validate payment token
    if (!stripeToken) {
      console.log('[PAYMENT] No stripe token provided');
      return res.status(400).json({ message: 'Payment token is required' });
    }

    // TODO: In production, integrate with Stripe API here
    // For now, we'll simulate a successful payment
    const simulatePaymentSuccess = true;

    if (simulatePaymentSuccess) {
      // Generate mock transaction ID early
      const transactionId = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      console.log('[PAYMENT] Simulating successful payment, txn:', transactionId);

      // Update order status and save first
      order.paymentStatus = 'completed';
      order.status = 'confirmed';
      order.transactionId = transactionId;
      order.paymentMethod = 'card';
      await order.save();
      console.log('[PAYMENT] Order saved with completed status');

      // Then handle stock and cart updates (non-blocking)
      if (order.items && order.items.length > 0) {
        console.log('[PAYMENT] Starting stock updates for', order.items.length, 'items');
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
        console.log('[PAYMENT] Stock updates completed');
      }

      // Update buyer cart
      try {
        const buyer = await User.findById(order.user);
        if (buyer && buyer.cartItems && buyer.cartItems.length > 0) {
          const orderedProductIds = new Set(
            (order.items || []).map((item) => String(item.product || ''))
          );
          buyer.cartItems = buyer.cartItems.filter(
            (entry) => !orderedProductIds.has(String(entry.product || ''))
          );
          await buyer.save();
          console.log('[PAYMENT] Cart updated for user');
        }
      } catch (cartErr) {
        console.warn('[PAYMENT] Cart update warning:', cartErr?.message);
      }

      console.log('[PAYMENT] Payment process completed successfully');
      res.json({
        message: 'Payment successful',
        order,
        transactionId,
      });
    } else {
      order.paymentStatus = 'failed';
      await order.save();
      console.log('[PAYMENT] Payment simulation failed');

      res.status(400).json({
        message: 'Payment failed',
        order,
      });
    }
  } catch (err) {
    const errorMsg = typeof err === 'string' ? err : (err?.message || String(err) || 'Unknown error');
    console.error('[PAYMENT] Error during payment processing:', errorMsg, err);
    res.status(500).json({ message: errorMsg });
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
    await order.save();

    const sellerOrder = toSellerOrderView(order, sellerId);
    res.json({ message: 'Shipment status updated', order: sellerOrder });
  } catch (err) {
    const errorMsg = typeof err === 'string' ? err : (err?.message || String(err) || 'Unknown error');
    console.error('Update shipment status error:', errorMsg, err);
    res.status(500).json({ message: errorMsg });
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
    await order.save();

    res.json({ message: 'Order cancelled', order });
  } catch (err) {
    const errorMsg = typeof err === 'string' ? err : (err?.message || String(err) || 'Unknown error');
    console.error('Cancel order error:', errorMsg, err);
    res.status(500).json({ message: errorMsg });
  }
});

module.exports = router;
