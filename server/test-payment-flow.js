const mongoose = require('mongoose');
const User = require('./models/User');
const Product = require('./models/Product');
const Order = require('./models/Order');
const jwt = require('jsonwebtoken');

async function testPaymentFlow() {
  try {
    // Connect to DB
    await mongoose.connect('mongodb://localhost:27017/handkraft', { family: 4 });
    console.log('Connected to MongoDB');

    // Create or get a test user
    let user = await User.findOne({ email: 'test@example.com' });
    if (!user) {
      user = new User({
        name: 'Test User',
        email: 'test@example.com',
        password: 'test',
        cartItems: [],
      });
      await user.save();
      console.log('Created test user:', user._id);
    } else {
      console.log('Using existing user:', user._id);
    }

    // Get a product and add to cart
    let product = await Product.findOne({ stock: { $gt: 0 } });
    if (!product) {
      console.log('No products with stock found');
      process.exit(1);
    }
    console.log('Found product:', product._id, 'stock:', product.stock);

    // Add to cart
    user.cartItems = [{
      product: product._id,
      quantity: 1,
    }];
    await user.save();
    console.log('Added product to cart');

    // Create JWT token
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'secret', {
      expiresIn: '7d',
    });
    console.log('Generated token');

    // Now test the payment flow via HTTP
    const http = require('http');

    // Step 1: Create order
    return new Promise((resolve) => {
      const orderData = JSON.stringify({
        shippingAddress: {
          fullName: 'Test User',
          phoneNumber: '9876543210',
          email: 'test@example.com',
          street: '123 Test Street',
          city: 'Test City',
          postalCode: '12345',
          country: 'India',
        },
      });

      const createOrderReq = http.request(
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
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              console.log('\n[CREATE ORDER] Status:', res.statusCode);
              console.log('[CREATE ORDER] Response:', JSON.stringify(parsed, null, 2));

              if (res.statusCode === 201 && parsed.order) {
                const orderId = parsed.order._id;

                // Step 2: Process payment
                const paymentData = JSON.stringify({
                  stripeToken: 'tok_49484_demo',
                });

                const paymentReq = http.request(
                  {
                    hostname: 'localhost',
                    port: 5000,
                    path: `/api/orders/${orderId}/pay`,
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Content-Length': Buffer.byteLength(paymentData),
                      'Authorization': `Bearer ${token}`,
                    },
                  },
                  (payRes) => {
                    let payData = '';
                    payRes.on('data', (chunk) => (payData += chunk));
                    payRes.on('end', () => {
                      try {
                        const payParsed = JSON.parse(payData);
                        console.log('\n[PAY ORDER] Status:', payRes.statusCode);
                        console.log('[PAY ORDER] Response:', JSON.stringify(payParsed, null, 2));

                        if (payRes.statusCode === 200) {
                          console.log('\n✓ Payment successful!');
                        } else {
                          console.log('\n✗ Payment failed');
                        }
                      } catch (e) {
                        console.log('[PAY ORDER] Parse error:', e.message);
                      }
                      resolve();
                    });
                  }
                );

                paymentReq.on('error', (e) => {
                  console.error('[PAY ORDER] Request error:', e.message);
                  resolve();
                });
                paymentReq.write(paymentData);
                paymentReq.end();
              } else {
                console.log('\n✗ Order creation failed');
                resolve();
              }
            } catch (e) {
              console.log('[CREATE ORDER] Parse error:', e.message);
              resolve();
            }
          });
        }
      );

      createOrderReq.on('error', (e) => {
        console.error('[CREATE ORDER] Request error:', e.message);
        resolve();
      });
      createOrderReq.write(orderData);
      createOrderReq.end();
    });
  } catch (err) {
    console.error('Test error:', err.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

testPaymentFlow();
