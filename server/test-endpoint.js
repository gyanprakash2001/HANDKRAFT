const http = require('http');

// Make a simple GET request to health first
const testHealth = () => {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: 5000,
        path: '/health',
        method: 'GET',
      },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          console.log('[HEALTH] Status:', res.statusCode, 'Response:', data);
          resolve(res.statusCode === 200);
        });
      }
    );
    req.on('error', (e) => {
      console.error('[HEALTH] Request error:', e.message);
      resolve(false);
    });
    req.end();
  });
};

const fs = require('fs');
const jwt = require('jsonwebtoken');

// Read the test order JSON that was created
const testPayment = async () => {
  // Wait a moment
  await new Promise(r => setTimeout(r, 1000));
  
  // Get token for test user
  const testToken = jwt.sign({ id: '69c1852dbc700ca3ef05d854' }, 'secret', { expiresIn: '7d' });
  console.log('\n[TEST] Using token for user: 69c1852dbc700ca3ef05d854');
  
  // Create an order first
  return new Promise((resolve) => {
    const orderData = JSON.stringify({
      shippingAddress: {
        fullName: 'Test User',
        phoneNumber: '9876543210',
        email: 'test@example.com',
        street: '123 Test St',
        city: 'Test City',
        postalCode: '12345',
        country: 'India',
      },
    });

    const createReq = http.request(
      {
        hostname: 'localhost',
        port: 5000,
        path: '/api/orders',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(orderData),
          'Authorization': `Bearer ${testToken}`,
        },
      },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            console.log('\n[CREATE_ORDER] Status:', res.statusCode);
            console.log('[CREATE_ORDER] Response:', JSON.stringify(parsed, null, 2));
            resolve({ success: res.statusCode === 201, order: parsed.order });
          } catch (e) {
            console.log('[CREATE_ORDER] Parse error:', e.message, 'Body:', data);
            resolve({ success: false });
          }
        });
      }
    );

    createReq.on('error', (e) => {
      console.error('[CREATE_ORDER] Request error:', e.message);
      resolve({ success: false });
    });
    
    createReq.write(orderData);
    createReq.end();
  });
};

(async () => {
  console.log('Starting backend communication test...\n');
  
  const healthOk = await testHealth();
  if (!healthOk) {
    console.error('\n✗ Backend not responding to health check');
    process.exit(1);
  }
  
  const { success, order } = await testPayment();
  if (success && order) {
    console.log('\n✓ Order created successfully');
    console.log('Order ID:', order._id);
    console.log('Order status:', order.status);
    console.log('Payment status:', order.paymentStatus);
  } else {
    console.log('\n✗ Order creation failed');
  }
  
  process.exit(0);
})();
