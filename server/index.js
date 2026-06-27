// Sentry must be initialized before all other requires for auto-instrumentation
require('./instrument');
const Sentry = require('@sentry/node');

const express = require('express');
const http = require('http');
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
const server = http.createServer(app);

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

const corsOptions = env.cors?.allowAnyOrigin
  ? {
      origin(origin, callback) {
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
    req.rawBody = buf && buf.length ? buf.toString('utf8') : '';
  },
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  immutable: env.nodeEnv === 'production',
  maxAge: env.nodeEnv === 'production' ? '7d' : 0,
}));

// ─── Socket.IO Setup ───────────────────────────────────────────────────────
let io;
try {
  const { Server } = require('socket.io');
  const jwt = require('jsonwebtoken');

  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Map: userId (string) → socketId (string)
  const onlineUsers = new Map();

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Authentication required'));
      const decoded = jwt.verify(token, env.jwtSecret || process.env.JWT_SECRET);
      socket.userId = String(decoded.id || decoded._id || decoded.userId || '');
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;
    if (!userId) return;

    onlineUsers.set(userId, socket.id);
    socket.broadcast.emit('user-online', { userId });
    console.log(`[Socket] ${userId} connected`);

    // Join a conversation room
    socket.on('join-conversation', ({ conversationId }) => {
      if (conversationId) {
        socket.join(`conv:${conversationId}`);
      }
    });

    // Leave a conversation room
    socket.on('leave-conversation', ({ conversationId }) => {
      if (conversationId) {
        socket.leave(`conv:${conversationId}`);
      }
    });

    // Typing events
    socket.on('typing', ({ conversationId }) => {
      socket.to(`conv:${conversationId}`).emit('typing', { userId, conversationId });
    });

    socket.on('stop-typing', ({ conversationId }) => {
      socket.to(`conv:${conversationId}`).emit('stop-typing', { userId, conversationId });
    });

    // Mark messages as read
    socket.on('messages-read', ({ conversationId }) => {
      socket.to(`conv:${conversationId}`).emit('messages-read', { userId, conversationId });
    });

    socket.on('disconnect', () => {
      onlineUsers.delete(userId);
      socket.broadcast.emit('user-offline', { userId });
      console.log(`[Socket] ${userId} disconnected`);
    });
  });

  // Export so routes can emit events
  app.set('io', io);
  app.set('onlineUsers', onlineUsers);
  console.log('[Socket.IO] Initialized successfully');
} catch (e) {
  console.warn('[Socket.IO] socket.io not installed — real-time features disabled. Run: npm install socket.io');
}
// ──────────────────────────────────────────────────────────────────────────

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
safeRequireRoute('./routes/debug', '/api/debug', 'debug');
safeRequireRoute('./routes/chat', '/api/chat', 'chat');
safeRequireRoute('./routes/admin', '/api/admin', 'admin');

Sentry.setupExpressErrorHandler(app);

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Image is too large. Please choose a smaller image.' });
  }
  return next(err);
});

app.use((err, req, res, next) => {
  const errorMsg = typeof err === 'string' ? err : (err?.message || String(err) || 'Unknown server error');
  const status = err?.status || err?.statusCode || 500;

  console.error(`\n[ERROR] ${new Date().toISOString()} ${req.method} ${req.path}`);
  console.error('  Status:', status);
  console.error('  Message:', errorMsg);
  console.error('  Stack:', err?.stack?.split('\n').slice(0, 5).join('\n'));

  const responseMessage = env.nodeEnv === 'production' && status >= 500
    ? 'Internal server error'
    : errorMsg;
  res.status(status).json({ message: responseMessage });
});

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
server.listen(port, '0.0.0.0', () => console.log(`Server running on ${port}`));

