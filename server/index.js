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
app.set('trust proxy', 1);
const corsOptions = env.cors?.allowAnyOrigin
  ? {
      origin(origin, callback) {
        // Allow any origin when allowAnyOrigin is true
        callback(null, true);
      },
      credentials: true,
      optionsSuccessStatus: 204,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }
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
      credentials: true,
      optionsSuccessStatus: 204,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      allowedHeaders: ['Content-Type', 'Authorization'],
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

const mongoStatus = {
  state: 'disconnected',
  readyState: mongoose.connection.readyState,
  lastError: null,
  lastErrorAt: null,
  lastConnectedAt: null,
};

function updateMongoStatus(state, err) {
  mongoStatus.state = state;
  mongoStatus.readyState = mongoose.connection.readyState;

  if (state === 'connected' || state === 'reconnected') {
    mongoStatus.lastConnectedAt = new Date().toISOString();
  }

  if (err) {
    mongoStatus.lastError = err?.message || String(err);
    mongoStatus.lastErrorAt = new Date().toISOString();
  }
}

mongoose.connection.on('connected', () => updateMongoStatus('connected'));
mongoose.connection.on('reconnected', () => updateMongoStatus('reconnected'));
mongoose.connection.on('disconnected', () => updateMongoStatus('disconnected'));
mongoose.connection.on('error', (err) => updateMongoStatus('error', err));

// health check
app.get('/health', (req, res) => res.send('OK'));
app.get('/health/db', (req, res) => {
  res.json({
    ...mongoStatus,
    readyState: mongoose.connection.readyState,
  });
});

// routes
function safeRequireRoute(modulePath, mountPath, routerName) {
  try {
    const routerModule = require(modulePath);
    app.use(mountPath, routerModule);
    console.log(`[ROUTES] Mounted ${routerName} at ${mountPath}`);
  } catch (err) {
    console.error(`[ROUTES] Failed to load ${routerName} from ${modulePath}:`, err.message);
    // Mount a fallback that returns 503 for this route
    app.use(mountPath, (req, res) => {
      res.status(503).json({ message: `${routerName} is temporarily unavailable: ${err.message}` });
    });
  }
}

safeRequireRoute('./routes/auth', '/api/auth', 'auth');
safeRequireRoute('./routes/users', '/api/users', 'users');
safeRequireRoute('./routes/products', '/api/products', 'products');
safeRequireRoute('./routes/orders', '/api/orders', 'orders');
safeRequireRoute('./routes/payouts', '/api/payouts', 'payouts');
safeRequireRoute('./routes/csr', '/api/csr', 'csr');
safeRequireRoute('./routes/webhooks', '/api/webhooks', 'webhooks');

// Debug routes (protected) for dry-run Nimbus calls
safeRequireRoute('./routes/debug', '/api/debug', 'debug');
safeRequireRoute('./routes/chat', '/api/chat', 'chat');

// Admin routes
safeRequireRoute('./routes/admin', '/api/admin', 'admin');

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
