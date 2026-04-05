const http = require('http');

// Simulate the checkout flow

async function getAuthToken() {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      email: 'jm@test.com',
      password: 'testpass'
    });

    const options = {
      hostname: 'localhost',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.token);
        } catch (e) {
          reject(new Error(`Auth parse error: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function createOrder(token) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      shippingAddress: {
        fullName: 'Test User',
        phoneNumber: '1234567890',
        email: 'test@example.com',
        street: '123 Main St',
        city: 'Test City',
        postalCode: '12345',
        country: 'Test Country'
      }
    });

    const options = {
      hostname: 'localhost',
      port: 5000,
      path: '/api/orders',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization': `Bearer ${token}`
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          console.log(`[CREATE_ORDER] Status: ${res.statusCode}`);
          console.log(`[CREATE_ORDER] Response:`, JSON.stringify(parsed, null, 2));
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed.order._id);
          } else {
            reject(new Error(parsed.message || 'Failed to create order'));
          }
        } catch (e) {
          reject(new Error(`Order parse error: ${e.message}, body: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function processPayment(token, orderId) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      stripeToken: 'tok_5555_demo'
    });

    const options = {
      hostname: 'localhost',
      port: 5000,
      path: `/api/orders/${orderId}/pay`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization': `Bearer ${token}`
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          console.log(`[PROCESS_PAYMENT] Status: ${res.statusCode}`);
          console.log(`[PROCESS_PAYMENT] Response:`, JSON.stringify(parsed, null, 2));
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(parsed.message || 'Failed to process payment'));
          }
        } catch (e) {
          reject(new Error(`Payment parse error: ${e.message}, body: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  try {
    console.log('[TEST] Starting checkout flow test\n');
    
    console.log('[TEST] Step 1: Getting auth token...');
    const token = await getAuthToken();
    console.log(`[TEST] Got token: ${token.substring(0, 20)}...\n`);
    
    console.log('[TEST] Step 2: Creating order...');
    const orderId = await createOrder(token);
    console.log(`[TEST] Created order: ${orderId}\n`);
    
    console.log('[TEST] Step 3: Processing payment...');
    const payment = await processPayment(token, orderId);
    console.log(`[TEST] Payment successful\n`);
    
    console.log('[TEST] ✓ Checkout flow completed successfully');
    process.exit(0);
  } catch (err) {
    console.error('[TEST] ✗ Error:', err.message);
    process.exit(1);
  }
}

main();
