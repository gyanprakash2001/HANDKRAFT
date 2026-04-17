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

function parsePositiveNumber(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parseNonNegativeNumber(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function parseCsv(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return [];
  }

  const seen = new Set();
  const values = [];

  String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      if (!seen.has(item)) {
        seen.add(item);
        values.push(item);
      }
    });

  return values;
}

function requireEnv(name, value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`[ENV] Missing required environment variable: ${name}`);
  }
  return value;
}

const hasRazorpayCredentials = Boolean(
  String(process.env.RAZORPAY_KEY_ID || '').trim()
  && String(process.env.RAZORPAY_KEY_SECRET || '').trim()
);

const hasNimbusV1Credentials = Boolean(
  String(process.env.NIMBUSPOST_API_KEY || '').trim()
  && String(process.env.NIMBUSPOST_WAREHOUSE_ID || '').trim()
);

const hasNimbusV2Credentials = Boolean(
  String(process.env.NIMBUSPOST_API_EMAIL || '').trim()
  && String(process.env.NIMBUSPOST_API_PASSWORD || '').trim()
);

const hasNimbusCredentials = hasNimbusV1Credentials || hasNimbusV2Credentials;

const configuredCorsOrigins = parseCsv(process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '');

const env = {
  port: Number(process.env.PORT || 5000),
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/handkraft',
  cors: {
    allowAnyOrigin: configuredCorsOrigins.length === 0 || configuredCorsOrigins.includes('*'),
    origins: configuredCorsOrigins.filter((origin) => origin !== '*'),
  },
  razorpay: {
    enabled: parseBoolean(process.env.RAZORPAY_ENABLED, hasRazorpayCredentials),
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
    currency: String(process.env.RAZORPAY_CURRENCY || 'INR').trim().toUpperCase(),
    brandName: String(process.env.RAZORPAY_BRAND_NAME || 'HANDKRAFT').trim(),
    descriptionPrefix: String(process.env.RAZORPAY_DESCRIPTION_PREFIX || 'HANDKRAFT Order').trim(),
  },
  nimbuspost: {
    enabled: parseBoolean(process.env.NIMBUSPOST_ENABLED, hasNimbusCredentials),
    mode: String(process.env.NIMBUSPOST_MODE || 'auto').trim().toLowerCase(),
    apiKey: process.env.NIMBUSPOST_API_KEY || '',
    apiEmail: process.env.NIMBUSPOST_API_EMAIL || '',
    apiPassword: process.env.NIMBUSPOST_API_PASSWORD || '',
    v1BaseUrl: String(process.env.NIMBUSPOST_V1_BASE_URL || 'https://ship.nimbuspost.com/api').replace(/\/+$/, ''),
    v2BaseUrl: String(process.env.NIMBUSPOST_V2_BASE_URL || 'https://api.nimbuspost.com/v1').replace(/\/+$/, ''),
    timeoutMs: parsePositiveNumber(process.env.NIMBUSPOST_TIMEOUT_MS, 25000),
    warehouseId: process.env.NIMBUSPOST_WAREHOUSE_ID || '',
    rtoWarehouseId: process.env.NIMBUSPOST_RTO_WAREHOUSE_ID || '',
    defaultCourierId: process.env.NIMBUSPOST_DEFAULT_COURIER_ID || '',
    requestAutoPickup: parseBoolean(process.env.NIMBUSPOST_REQUEST_AUTO_PICKUP, true),
    isInsurance: parseBoolean(process.env.NIMBUSPOST_IS_INSURANCE, false),
    tags: process.env.NIMBUSPOST_TAGS || '',
    packageWeightGrams: parsePositiveNumber(process.env.NIMBUSPOST_PACKAGE_WEIGHT_GRAMS, 500),
    weightPerItemGrams: parsePositiveNumber(process.env.NIMBUSPOST_WEIGHT_PER_ITEM_GRAMS, 0),
    packageLengthCm: parsePositiveNumber(process.env.NIMBUSPOST_PACKAGE_LENGTH_CM, 10),
    packageBreadthCm: parsePositiveNumber(process.env.NIMBUSPOST_PACKAGE_BREADTH_CM, 10),
    packageHeightCm: parsePositiveNumber(process.env.NIMBUSPOST_PACKAGE_HEIGHT_CM, 10),
    webhookSecret: process.env.NIMBUSPOST_WEBHOOK_SECRET || '',
    trackingSchedulerEnabled: parseBoolean(process.env.NIMBUSPOST_TRACKING_SCHEDULER_ENABLED, true),
    trackingSchedulerIntervalMs: parsePositiveNumber(process.env.NIMBUSPOST_TRACKING_SCHEDULER_INTERVAL_MS, 120000),
    trackingSchedulerBatchLimit: parsePositiveNumber(process.env.NIMBUSPOST_TRACKING_SCHEDULER_BATCH_LIMIT, 25),
    pickup: {
      warehouseName: process.env.NIMBUSPOST_PICKUP_WAREHOUSE_NAME || '',
      name: process.env.NIMBUSPOST_PICKUP_NAME || '',
      address1: process.env.NIMBUSPOST_PICKUP_ADDRESS_1 || '',
      address2: process.env.NIMBUSPOST_PICKUP_ADDRESS_2 || '',
      city: process.env.NIMBUSPOST_PICKUP_CITY || '',
      state: process.env.NIMBUSPOST_PICKUP_STATE || '',
      pincode: process.env.NIMBUSPOST_PICKUP_PINCODE || '',
      phone: process.env.NIMBUSPOST_PICKUP_PHONE || '',
    },
  },
  payouts: {
    enabled: parseBoolean(process.env.PAYOUTS_ENABLED, true),
    schedulerEnabled: parseBoolean(process.env.PAYOUTS_SCHEDULER_ENABLED, true),
    schedulerIntervalMs: parsePositiveNumber(process.env.PAYOUTS_SCHEDULER_INTERVAL_MS, 60000),
    schedulerBatchLimit: parsePositiveNumber(process.env.PAYOUTS_SCHEDULER_BATCH_LIMIT, 50),
    holdDaysAfterDelivery: parseNonNegativeNumber(process.env.PAYOUTS_HOLD_DAYS_AFTER_DELIVERY, 0),
    platformFeePercent: parseNonNegativeNumber(process.env.PAYOUTS_PLATFORM_FEE_PERCENT, 0),
    defaultReservePercent: parseNonNegativeNumber(process.env.PAYOUTS_DEFAULT_RESERVE_PERCENT, 10),
    defaultMinimumPayoutAmount: parseNonNegativeNumber(process.env.PAYOUTS_DEFAULT_MIN_PAYOUT_AMOUNT, 0),
  },
};

if (env.razorpay.enabled) {
  requireEnv('RAZORPAY_KEY_ID', env.razorpay.keyId);
  requireEnv('RAZORPAY_KEY_SECRET', env.razorpay.keySecret);
}

const nimbusMode = env.nimbuspost.mode;
if (!['auto', 'v1', 'v2'].includes(nimbusMode)) {
  throw new Error(`[ENV] Invalid NIMBUSPOST_MODE: ${nimbusMode}. Allowed values: auto, v1, v2.`);
}

if (env.nimbuspost.enabled) {
  const useV1 = nimbusMode === 'v1' || (nimbusMode === 'auto' && Boolean(env.nimbuspost.apiKey));
  const useV2 = nimbusMode === 'v2' || (nimbusMode === 'auto' && !env.nimbuspost.apiKey);

  if (useV1) {
    requireEnv('NIMBUSPOST_API_KEY', env.nimbuspost.apiKey);
    requireEnv('NIMBUSPOST_WAREHOUSE_ID', env.nimbuspost.warehouseId);
  }

  if (useV2) {
    requireEnv('NIMBUSPOST_API_EMAIL', env.nimbuspost.apiEmail);
    requireEnv('NIMBUSPOST_API_PASSWORD', env.nimbuspost.apiPassword);
  }
}

module.exports = {
  env,
  parseBoolean,
};
