const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}

function requireEnv(name, value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`[ENV] Missing required environment variable: ${name}`);
  }
  return value;
}

const env = {
  port: Number(process.env.PORT || 5000),
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/handkraft',
  shiprocket: {
    enabled: parseBoolean(process.env.SHIPROCKET_ENABLED, false),
    baseUrl: String(process.env.SHIPROCKET_BASE_URL || 'https://apiv2.shiprocket.in').replace(/\/+$/, ''),
    email: process.env.SHIPROCKET_EMAIL || '',
    password: process.env.SHIPROCKET_PASSWORD || '',
    webhookSecret: process.env.SHIPROCKET_WEBHOOK_SECRET || '',
    tokenRefreshBufferMs: Number(process.env.SHIPROCKET_TOKEN_REFRESH_BUFFER_MS || 5 * 60 * 1000),
  },
};

if (env.shiprocket.enabled) {
  requireEnv('SHIPROCKET_EMAIL', env.shiprocket.email);
  requireEnv('SHIPROCKET_PASSWORD', env.shiprocket.password);
}

module.exports = {
  env,
  parseBoolean,
};
