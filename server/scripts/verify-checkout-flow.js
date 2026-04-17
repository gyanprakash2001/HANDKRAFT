'use strict';

const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

function hasValue(value) {
  return String(value || '').trim().length > 0;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const raw = String(argv[index] || '');
    if (!raw.startsWith('--')) continue;

    const withoutPrefix = raw.slice(2);
    if (!withoutPrefix) continue;

    const eqIndex = withoutPrefix.indexOf('=');
    if (eqIndex >= 0) {
      const key = withoutPrefix.slice(0, eqIndex);
      const value = withoutPrefix.slice(eqIndex + 1);
      args[key] = value;
      continue;
    }

    const nextValue = argv[index + 1];
    if (nextValue && !String(nextValue).startsWith('--')) {
      args[withoutPrefix] = String(nextValue);
      index += 1;
      continue;
    }

    args[withoutPrefix] = 'true';
  }

  return args;
}

function normalizeBaseUrl(value) {
  return String(value || 'http://127.0.0.1:5000').replace(/\/+$/, '');
}

function summarizeStatus(ok) {
  return ok ? 'PASS' : 'FAIL';
}

async function postJson(url, { headers = {}, body }) {
  const response = await fetch(url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
    body: JSON.stringify(body || {}),
  });

  const text = await response.text().catch(() => '');
  let parsed = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  return {
    ok: response.ok,
    status: response.status,
    body: parsed,
  };
}

function getNimbusMode() {
  const configured = String(process.env.NIMBUSPOST_MODE || 'auto').trim().toLowerCase();
  if (configured === 'v1' || configured === 'v2') {
    return configured;
  }

  return hasValue(process.env.NIMBUSPOST_API_KEY) ? 'v1' : 'v2';
}

function getMissingRazorpayEnv(razorpayEnabled) {
  const missing = [];
  if (!razorpayEnabled) return missing;

  if (!hasValue(process.env.RAZORPAY_KEY_ID)) missing.push('RAZORPAY_KEY_ID');
  if (!hasValue(process.env.RAZORPAY_KEY_SECRET)) missing.push('RAZORPAY_KEY_SECRET');
  if (!hasValue(process.env.RAZORPAY_WEBHOOK_SECRET)) missing.push('RAZORPAY_WEBHOOK_SECRET');
  return missing;
}

function getMissingNimbusEnv(nimbusEnabled, mode) {
  const missing = [];
  if (!nimbusEnabled) return missing;

  if (!hasValue(process.env.NIMBUSPOST_WEBHOOK_SECRET)) {
    missing.push('NIMBUSPOST_WEBHOOK_SECRET');
  }

  if (mode === 'v1') {
    if (!hasValue(process.env.NIMBUSPOST_API_KEY)) missing.push('NIMBUSPOST_API_KEY');
    if (!hasValue(process.env.NIMBUSPOST_WAREHOUSE_ID)) missing.push('NIMBUSPOST_WAREHOUSE_ID');
    return missing;
  }

  if (!hasValue(process.env.NIMBUSPOST_API_EMAIL)) missing.push('NIMBUSPOST_API_EMAIL');
  if (!hasValue(process.env.NIMBUSPOST_API_PASSWORD)) missing.push('NIMBUSPOST_API_PASSWORD');
  return missing;
}

async function run() {
  if (typeof fetch !== 'function') {
    console.error('FAIL Node runtime does not expose fetch(). Use Node 18+ to run this script.');
    return 1;
  }

  const args = parseArgs(process.argv.slice(2));
  const baseUrl = normalizeBaseUrl(args.baseUrl || process.env.API_BASE_URL || 'http://127.0.0.1:5000');
  const awb = String(args.awb || process.env.SMOKE_AWB || 'HK-SMOKE-AWB').trim();

  const hasRazorpayCreds = hasValue(process.env.RAZORPAY_KEY_ID) && hasValue(process.env.RAZORPAY_KEY_SECRET);
  const razorpayEnabled = parseBoolean(process.env.RAZORPAY_ENABLED, hasRazorpayCreds);
  const nimbusEnabled = parseBoolean(process.env.NIMBUSPOST_ENABLED, false);
  const nimbusMode = getNimbusMode();

  const missingRazorpay = getMissingRazorpayEnv(razorpayEnabled);
  const missingNimbus = getMissingNimbusEnv(nimbusEnabled, nimbusMode);

  let healthOk = false;
  let healthStatus = 0;
  let healthBody = '';

  try {
    const healthResponse = await fetch(`${baseUrl}/health`);
    healthStatus = healthResponse.status;
    healthBody = await healthResponse.text().catch(() => '');
    healthOk = healthResponse.ok;
  } catch (error) {
    healthBody = error && error.message ? error.message : String(error);
  }

  const results = [];

  results.push({
    name: 'Server health',
    ok: healthOk,
    detail: healthOk
      ? `GET ${baseUrl}/health -> ${healthStatus}`
      : `Could not reach backend at ${baseUrl}. Detail: ${healthBody}`,
  });

  if (!healthOk) {
    console.log('\n=== Checkout Flow Verification ===');
    results.forEach((item) => {
      console.log(`${summarizeStatus(item.ok)}  ${item.name}`);
      console.log(`      ${item.detail}`);
    });

    console.log('\nNext step: start backend (`cd server && npm run dev`) and run this script again.');
    return 1;
  }

  const razorpayReady = razorpayEnabled && missingRazorpay.length === 0;
  const nimbusReady = nimbusEnabled && missingNimbus.length === 0;

  results.push({
    name: 'Razorpay env readiness',
    ok: razorpayReady,
    detail: razorpayReady
      ? 'Razorpay enabled with key, secret, and webhook secret.'
      : `Incomplete Razorpay setup. Missing: ${missingRazorpay.join(', ') || 'set RAZORPAY_ENABLED=true'}`,
  });

  results.push({
    name: 'NimbusPost env readiness',
    ok: nimbusReady,
    detail: nimbusReady
      ? `NimbusPost enabled (${nimbusMode}) with webhook secret and required credentials.`
      : `Incomplete Nimbus setup. Missing: ${missingNimbus.join(', ') || 'set NIMBUSPOST_ENABLED=true'}`,
  });

  // Razorpay webhook smoke test (signature-verified request)
  const razorpayWebhookSecret = String(process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();
  if (razorpayWebhookSecret) {
    const stamp = Date.now();
    const razorpayPayload = {
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: `pay_smoke_${stamp}`,
            order_id: `order_smoke_${stamp}`,
            status: 'failed',
            amount: 12345,
            currency: 'INR',
            error_code: 'SMOKE_TEST',
            error_description: 'Checkout flow smoke test',
            notes: {},
          },
        },
        order: {
          entity: {
            id: `order_smoke_${stamp}`,
            amount: 12345,
            currency: 'INR',
            notes: {},
          },
        },
      },
    };

    const rawPayload = JSON.stringify(razorpayPayload);
    const razorpaySignature = crypto
      .createHmac('sha256', razorpayWebhookSecret)
      .update(rawPayload, 'utf8')
      .digest('hex');

    const razorpayResponse = await postJson(`${baseUrl}/api/orders/webhooks/razorpay`, {
      headers: { 'x-razorpay-signature': razorpaySignature },
      body: razorpayPayload,
    });

    results.push({
      name: 'Razorpay webhook endpoint',
      ok: razorpayResponse.ok,
      detail: `POST /api/orders/webhooks/razorpay -> ${razorpayResponse.status} (${JSON.stringify(razorpayResponse.body)})`,
    });
  } else {
    results.push({
      name: 'Razorpay webhook endpoint',
      ok: false,
      detail: 'Skipped request because RAZORPAY_WEBHOOK_SECRET is empty.',
    });
  }

  // Nimbus webhook smoke test
  const nimbusHeaders = {};
  const nimbusWebhookSecret = String(process.env.NIMBUSPOST_WEBHOOK_SECRET || '').trim();
  if (nimbusWebhookSecret) {
    nimbusHeaders['x-webhook-secret'] = nimbusWebhookSecret;
  }

  const nimbusResponse = await postJson(`${baseUrl}/api/orders/carrier/nimbuspost/webhook`, {
    headers: nimbusHeaders,
    body: {
      awb,
      shipment_status: 'in transit',
      message: 'Checkout flow smoke test',
    },
  });

  results.push({
    name: 'NimbusPost webhook endpoint',
    ok: nimbusResponse.ok,
    detail: `POST /api/orders/carrier/nimbuspost/webhook -> ${nimbusResponse.status} (${JSON.stringify(nimbusResponse.body)})`,
  });

  const allPassed = results.every((item) => item.ok);

  console.log('\n=== Checkout Flow Verification ===');
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Nimbus mode: ${nimbusMode}`);
  results.forEach((item) => {
    console.log(`${summarizeStatus(item.ok)}  ${item.name}`);
    console.log(`      ${item.detail}`);
  });

  if (allPassed) {
    console.log('\nAll checks passed. Checkout + delivery webhooks are wired correctly for this environment.');
    return 0;
  }

  console.log('\nOne or more checks failed. Fix the missing env/dashboard items and run again.');
  return 1;
}

run().catch((error) => {
  console.error('FAIL Unexpected verification error:', error && error.message ? error.message : error);
  return 1;
}).then((exitCode) => {
  process.exitCode = Number.isInteger(exitCode) ? exitCode : 1;
});
