const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const { env } = require('./config/env');
const { startPayoutScheduler } = require('./services/payoutScheduler');
const { startShipmentTrackingScheduler } = require('./services/shipmentTrackingScheduler');

console.log('\n' + '='.repeat(60));
console.log('BACKEND STARTING - NEW CODE WITH IMPROVED ERROR HANDLING');
console.log('='.repeat(60) + '\n');
console.log(`[ENV] Razorpay enabled: ${env.razorpay?.enabled ? 'yes' : 'no'}`);
console.log(`[ENV] NimbusPost enabled: ${env.nimbuspost?.enabled ? 'yes' : 'no'} (mode: ${env.nimbuspost?.mode || 'auto'})`);
console.log(`[ENV] CORS allowlist: ${env.cors?.allowAnyOrigin ? '*' : env.cors?.origins?.join(', ') || '(none)'}`);

const app = express();
const corsOptions = env.cors?.allowAnyOrigin
  ? {}
  : {
      origin(origin, callback) {
        if (!origin) {
          return callback(null, true);
        }

        if (env.cors.origins.includes(origin)) {
          return callback(null, true);
        }

        return callback(new Error(`CORS blocked for origin: ${origin}`));
      },
      optionsSuccessStatus: 204,
    };

app.use(cors(corsOptions));
app.use(compression());
app.use(express.json({
  limit: '12mb',
  verify: (req, res, buf) => {
    // Preserve raw JSON body for webhook signature verification.
    req.rawBody = buf && buf.length ? buf.toString('utf8') : '';
  },
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// health check
app.get('/health', (req, res) => res.send('OK'));

// routes
const authRouter = require('./routes/auth');
app.use('/api/auth', authRouter);
const usersRouter = require('./routes/users');
app.use('/api/users', usersRouter);
const productsRouter = require('./routes/products');
app.use('/api/products', productsRouter);
const ordersRouter = require('./routes/orders');
app.use('/api/orders', ordersRouter);
const payoutsRouter = require('./routes/payouts');
app.use('/api/payouts', payoutsRouter);

// Debug routes (protected) for dry-run Nimbus calls
const debugRouter = require('./routes/debug');
app.use('/api/debug', debugRouter);

const chatRouter = require('./routes/chat');
app.use('/api/chat', chatRouter);

// Admin routes
const adminRouter = require('./routes/admin');
app.use('/api/admin', adminRouter);

// Return readable JSON when request body is too large (e.g. base64 image uploads).
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Image is too large. Please choose a smaller image.' });
  }
  return next(err);
});

// Global error handler middleware
app.use((err, req, res, next) => {
  const errorMsg = typeof err === 'string' ? err : (err?.message || String(err) || 'Unknown server error');
  const status = err?.status || err?.statusCode || 500;
  
  // Log all errors with full details
  console.error(`\n[ERROR] ${new Date().toISOString()} ${req.method} ${req.path}`);
  console.error('  Status:', status);
  console.error('  Message:', errorMsg);
  console.error('  Stack:', err?.stack?.split('\n').slice(0, 5).join('\n'));
  
  // ALWAYS return actual error message for debugging
  res.status(status).json({ message: errorMsg });
});

// connect to mongo
const mongoUri = env.mongoUri;
mongoose
  .connect(mongoUri, {
    family: 4,
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 15000,
  })
  .then(() => {
    console.log('MongoDB connected');
    startPayoutScheduler();
    startShipmentTrackingScheduler();
  })
  .catch(err => console.error('MongoDB connection error', err));

const port = env.port;
app.listen(port, '0.0.0.0', () => console.log(`Server running on ${port}`));
