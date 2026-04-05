const http = require('http');
const mongoose = require('mongoose');

require('dotenv').config({ path: __dirname + '/.env' });

async function runTest() {
  // Connect to DB to ensure user exists
  try {
    await mongoose.connect('mongodb://localhost:27017/handkraft', { family: 4 });
    console.log('[DB] Connected');
  } catch (e) {
    console.error('[DB] Connection error:', e.message);
    process.exit(1);
  }

  try {
    const User = require('./models/User');
    const jwt = require('jsonwebtoken');

    // Find or create a test user
    let user = await User.findOne({ email: 'paymenttest@example.com' });
    if (!user) {
      const bcrypt = require('bcryptjs');
      const hashed = await bcrypt.hash('testpass', 10);
      user = new User({
        name: 'Payment Test',
        email: 'paymenttest@example.com',
        password: hashed,
        cartItems: [],
      });
      await user.save();
      console.log('[DB] Created test user');
    } else {
      console.log('[DB] Using existing test user');
    }

    // Check if user has cart items
    const Product = require('./models/Product');
    if (!user.cartItems || user.cartItems.length === 0) {
      const product = await Product.findOne({ stock: { $gt: 0 } });
      if (product) {
        user.cartItems = [{ product: product._id, quantity: 1 }];
        await user.save();
        console.log('[DB] Added product to cart');
      } else {
        console.log('[DB] No products with stock available');
        process.exit(1);
      }
    }

    // Create a valid JWT
    const secret = process.env.JWT_SECRET || 'secret';
    const token = jwt.sign({ id: user._id }, secret, { expiresIn: '7d' });
    console.log('[AUTH] Generated token for user:', user._id);
    console.log('[AUTH] Using JWT secret:', secret);

    // Test create order
    await new Promise(r => setTimeout(r, 1000));

    const orderData = JSON.stringify({
      shippingAddress: {
        fullName: 'Test User',
        phoneNumber: '9876543210',
        email: 'paymenttest@example.com',
        street: '123 Test St',
        city: 'Test City',
        postalCode: '12345',
        country: 'India',
      },
    });

    console.log('\n[TESTING] POST /api/orders');
    const createOrder = await new Promise((resolve) => {
      const req = http.request(
        {
          hostname: 'localhost',
          port: 5000,
          path: '/api/orders',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(orderData),
            'Authorization': `Bearer ${token}`,
          },
        },
        (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            console.log('[API] Status:', res.statusCode);
            try {
              const parsed = JSON.parse(data);
              console.log('[API] Response:', JSON.stringify(parsed, null, 2));
              resolve(res.statusCode === 201 ? parsed.order : null);
            } catch (e) {
              console.log('[API] Response (raw):', data);
              resolve(null);
            }
          });
        }
      );
      req.on('error', e => {
        console.error('[API] Error:', e.message);
        resolve(null);
      });
      req.write(orderData);
      req.end();
    });

    if (createOrder) {
      console.log('\n✓ Order created successfully, ID:', createOrder._id);
    } else {
      console.log('\n✗ Order creation failed');
    }
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

runTest();
