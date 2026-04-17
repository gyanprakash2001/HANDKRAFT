const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { env } = require('../config/env');
const {
  rawRequest,
  createShipment,
  trackShipmentByAwb,
} = require('../services/nimbuspost');

function hasValue(value) {
  return String(value || '').trim().length > 0;
}

function getRazorpayReadiness() {
  const enabled = Boolean(env.razorpay?.enabled);
  const checks = {
    keyId: hasValue(env.razorpay?.keyId),
    keySecret: hasValue(env.razorpay?.keySecret),
    webhookSecret: hasValue(env.razorpay?.webhookSecret),
  };

  const missing = [];
  if (enabled) {
    if (!checks.keyId) missing.push('RAZORPAY_KEY_ID');
    if (!checks.keySecret) missing.push('RAZORPAY_KEY_SECRET');
    if (!checks.webhookSecret) missing.push('RAZORPAY_WEBHOOK_SECRET');
  }

  return {
    enabled,
    checks,
    missing,
    ready: enabled && missing.length === 0,
  };
}

function getNimbuspostReadiness() {
  const enabled = Boolean(env.nimbuspost?.enabled);
  const configuredMode = String(env.nimbuspost?.mode || 'auto').toLowerCase();
  const apiKeyPresent = hasValue(env.nimbuspost?.apiKey);
  const effectiveMode = configuredMode === 'v1' || configuredMode === 'v2'
    ? configuredMode
    : (apiKeyPresent ? 'v1' : 'v2');

  const missing = [];
  const checks = {
    webhookSecret: hasValue(env.nimbuspost?.webhookSecret),
    mode: effectiveMode,
  };

  if (enabled && effectiveMode === 'v1') {
    checks.apiKey = hasValue(env.nimbuspost?.apiKey);
    checks.warehouseId = hasValue(env.nimbuspost?.warehouseId);

    if (!checks.apiKey) missing.push('NIMBUSPOST_API_KEY');
    if (!checks.warehouseId) missing.push('NIMBUSPOST_WAREHOUSE_ID');
  }

  if (enabled && effectiveMode === 'v2') {
    checks.apiEmail = hasValue(env.nimbuspost?.apiEmail);
    checks.apiPassword = hasValue(env.nimbuspost?.apiPassword);

    const pickup = env.nimbuspost?.pickup || {};
    const pickupChecks = {
      warehouseName: hasValue(pickup.warehouseName),
      name: hasValue(pickup.name),
      address1: hasValue(pickup.address1),
      city: hasValue(pickup.city),
      state: hasValue(pickup.state),
      pincode: hasValue(pickup.pincode),
      phone: hasValue(pickup.phone),
    };
    checks.pickupDefaults = pickupChecks;

    if (!checks.apiEmail) missing.push('NIMBUSPOST_API_EMAIL');
    if (!checks.apiPassword) missing.push('NIMBUSPOST_API_PASSWORD');
  }

  if (enabled && !checks.webhookSecret) {
    missing.push('NIMBUSPOST_WEBHOOK_SECRET');
  }

  return {
    enabled,
    configuredMode,
    effectiveMode,
    checks,
    missing,
    ready: enabled && missing.length === 0,
  };
}

router.get('/integrations/readiness', auth, async (req, res) => {
  try {
    const razorpay = getRazorpayReadiness();
    const nimbuspost = getNimbuspostReadiness();

    const inferredBaseUrl = `${req.protocol}://${req.get('host')}`.replace(/\/+$/, '');
    const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || inferredBaseUrl).replace(/\/+$/, '');

    const nextActions = [];
    if (!razorpay.enabled) nextActions.push('Set RAZORPAY_ENABLED=true on deployed server.');
    if (razorpay.missing.length > 0) nextActions.push(`Fill Razorpay env vars: ${razorpay.missing.join(', ')}`);
    if (!nimbuspost.enabled) nextActions.push('Set NIMBUSPOST_ENABLED=true after Nimbus dashboard is fully configured.');
    if (nimbuspost.missing.length > 0) nextActions.push(`Fill NimbusPost env vars: ${nimbuspost.missing.join(', ')}`);

    if (nextActions.length === 0) {
      nextActions.push('Configure Razorpay/Nimbus webhooks in provider dashboards with the URLs below.');
      nextActions.push('Run `npm run verify:checkout-flow` from `server` while backend is running.');
    }

    return res.json({
      ok: razorpay.ready && nimbuspost.ready,
      generatedAt: new Date().toISOString(),
      readiness: {
        razorpay,
        nimbuspost,
      },
      webhookUrls: {
        razorpay: `${publicBaseUrl}/api/orders/webhooks/razorpay`,
        nimbuspost: `${publicBaseUrl}/api/orders/carrier/nimbuspost/webhook`,
      },
      nextActions,
    });
  } catch (err) {
    console.error('[DEBUG][INTEGRATIONS] Readiness check error:', err?.message || err);
    return res.status(500).json({ ok: false, message: err?.message || String(err) });
  }
});

router.get('/integrations/public-readiness', async (req, res) => {
  try {
    const razorpay = getRazorpayReadiness();
    const nimbuspost = getNimbuspostReadiness();

    return res.json({
      ok: razorpay.ready && nimbuspost.ready,
      generatedAt: new Date().toISOString(),
      readiness: {
        razorpay: {
          enabled: razorpay.enabled,
          ready: razorpay.ready,
        },
        nimbuspost: {
          enabled: nimbuspost.enabled,
          ready: nimbuspost.ready,
          mode: nimbuspost.effectiveMode,
        },
      },
    });
  } catch (err) {
    console.error('[DEBUG][INTEGRATIONS][PUBLIC] Readiness check error:', err?.message || err);
    return res.status(500).json({ ok: false, message: err?.message || String(err) });
  }
});

// Protected debug endpoint to run dry-runs against NimbusPost.
// Body: { type: 'createShipment' | 'trackAwb' | 'raw', payload: {...} }
router.post('/nimbus/dry-run', auth, async (req, res) => {
  try {
    const type = String(req.body?.type || '').trim();
    const payload = req.body?.payload || {};

    if (type === 'createShipment') {
      // payload: high-level createShipment input expected by service
      const result = await createShipment(payload);
      return res.json({ ok: true, result });
    }

    if (type === 'trackAwb') {
      const awb = String(payload?.awb || '').trim();
      if (!awb) return res.status(400).json({ ok: false, message: 'awb is required for trackAwb' });
      const result = await trackShipmentByAwb(awb);
      return res.json({ ok: true, result });
    }

    if (type === 'raw') {
      // payload: { path, method, headers, body }
      const method = String(payload.method || 'GET').toUpperCase();
      const path = String(payload.path || '').replace(/^\/+/, '');
      const headers = payload.headers || {};
      const body = payload.body;

      const result = await rawRequest({ path, method, headers, body, bypassEnabled: true });
      return res.json({ ok: true, result });
    }

    return res.status(400).json({ ok: false, message: 'Invalid type. Use createShipment|trackAwb|raw' });
  } catch (err) {
    console.error('[DEBUG][NIMBUS] Error:', err?.message || err);
    return res.status(500).json({ ok: false, message: err?.message || String(err) });
  }
});

module.exports = router;
