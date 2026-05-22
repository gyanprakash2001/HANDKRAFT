// Sentry must be initialized BEFORE importing any other modules.
// This file is required at the very top of index.js.
const Sentry = require('@sentry/node');

Sentry.init({
  dsn: process.env.SENTRY_DSN || '',
  // Performance Monitoring — capture 20% of transactions in production
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  environment: process.env.NODE_ENV || 'development',
  // Only enable in production (or when DSN is set) to avoid noise during local dev
  enabled: Boolean(process.env.SENTRY_DSN),
});

module.exports = Sentry;
