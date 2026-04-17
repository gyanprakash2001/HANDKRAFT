#!/usr/bin/env node
/**
 * Backend server with live console logging
 * All [PAYMENT], [CREATE_ORDER], and errors will be visible
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '12mb' }));

// IMMEDIATE LOG: Server starting
console.log('\n========== BACKEND STARTING ==========');
console.log(`[${new Date().toISOString()}] Server initialization...`);

// health check
app.get('/health', (req, res) => {
  console.log('[HEALTH] Ping received');
  res.send('OK');
});

// routes
const authRouter = require('./routes/auth');
app.use('/api/auth', authRouter);
const usersRouter = require('./routes/users');
app.use('/api/users', usersRouter);
const productsRouter = require('./routes/products');
app.use('/api/products', productsRouter);
const ordersRouter = require('./routes/orders');
app.use('/api/orders', ordersRouter);
const chatRouter = require('./routes/chat');
app.use('/api/chat', chatRouter);

// Payload size error handler
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
  
  console.error(`\n[ERROR] ${req.method} ${req.path}`, {
    status,
    message: errorMsg,
    timestamp: new Date().toISOString(),
  });
  
  const isProduction = process.env.NODE_ENV === 'production';
  const responseMsg = isProduction ? 'Server error' : errorMsg;
  
  res.status(status).json({ message: responseMsg });
});

// MongoDB connection
const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/handkraft';
console.log(`[DB] Connecting to: ${mongoUri}`);

mongoose
  .connect(mongoUri, {
    family: 4,
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 15000,
  })
  .then(() => {
    console.log('[DB] ✓ MongoDB connected');
  })
  .catch(err => {
    console.error('[DB] ✗ Connection failed:', err.message);
    process.exit(1);
  });

const port = process.env.PORT || 5000;
app.listen(port, '0.0.0.0', () => {
  console.log(`\n[SERVER] ✓ Running on port ${port}`);
  console.log('========== READY FOR REQUESTS ==========\n');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[SERVER] Shutting down...');
  process.exit(0);
});
