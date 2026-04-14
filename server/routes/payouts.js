const express = require('express');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const {
  getSellerPayoutDashboard,
  processDuePayouts,
  claimSellerWallet,
  getAdminPayoutDashboard,
  claimAdminReadyPayouts,
  getPayoutPolicy,
} = require('../services/payouts');

const router = express.Router();

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function toIdList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => String(entry || '').trim()).filter(Boolean);
}

// GET /api/payouts/seller/me
router.get('/seller/me', auth, async (req, res) => {
  try {
    const page = toPositiveInt(req.query.page, 1);
    const limit = toPositiveInt(req.query.limit, 20);
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';

    const payload = await getSellerPayoutDashboard(req.user?._id, {
      page,
      limit,
      status: status || undefined,
    });

    return res.json(payload);
  } catch (err) {
    const message = err?.message || 'Failed to fetch seller payouts';
    console.error('[PAYOUT][SELLER_DASHBOARD] Error:', message, err);
    return res.status(500).json({ message });
  }
});

// GET /api/payouts/policy
router.get('/policy', auth, async (req, res) => {
  try {
    return res.json({ policy: getPayoutPolicy() });
  } catch (err) {
    const message = err?.message || 'Failed to fetch payout policy';
    return res.status(500).json({ message });
  }
});

// POST /api/payouts/seller/me/process-due
router.post('/seller/me/process-due', auth, async (req, res) => {
  try {
    const limit = toPositiveInt(req.body?.limit, 25);
    const result = await processDuePayouts({ limit });
    const dashboard = await getSellerPayoutDashboard(req.user?._id, { page: 1, limit: 20 });

    return res.json({
      message: 'Hold release processing completed',
      schedulerResult: result,
      dashboard,
    });
  } catch (err) {
    const message = err?.message || 'Failed to process due payouts';
    console.error('[PAYOUT][SELLER_PROCESS_DUE] Error:', message, err);
    return res.status(500).json({ message });
  }
});

// POST /api/payouts/seller/me/claim
router.post('/seller/me/claim', auth, async (req, res) => {
  try {
    const limit = toPositiveInt(req.body?.limit, 50);
    const payoutIds = toIdList(req.body?.payoutIds);
    const claimAll = req.body?.claimAll !== false;

    const result = await claimSellerWallet(req.user?._id, {
      payoutIds,
      limit,
      claimAll,
    });

    return res.json({
      message: 'Wallet claim processed',
      ...result,
    });
  } catch (err) {
    const message = err?.message || 'Failed to claim wallet payouts';
    console.error('[PAYOUT][SELLER_CLAIM] Error:', message, err);
    return res.status(500).json({ message });
  }
});

// GET /api/payouts/admin/dashboard
router.get('/admin/dashboard', auth, admin, async (req, res) => {
  try {
    const page = toPositiveInt(req.query.page, 1);
    const limit = toPositiveInt(req.query.limit, 20);
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const sellerId = typeof req.query.sellerId === 'string' ? req.query.sellerId.trim() : '';

    const payload = await getAdminPayoutDashboard({
      page,
      limit,
      status: status || undefined,
      sellerId: sellerId || undefined,
    });

    return res.json(payload);
  } catch (err) {
    const message = err?.message || 'Failed to fetch admin payout dashboard';
    console.error('[PAYOUT][ADMIN_DASHBOARD] Error:', message, err);
    return res.status(500).json({ message });
  }
});

// POST /api/payouts/admin/process-due
router.post('/admin/process-due', auth, admin, async (req, res) => {
  try {
    const limit = toPositiveInt(req.body?.limit, 100);
    const result = await processDuePayouts({ limit });
    return res.json({ message: 'Admin hold release processing completed', result });
  } catch (err) {
    const message = err?.message || 'Failed to process payouts as admin';
    console.error('[PAYOUT][ADMIN_PROCESS_DUE] Error:', message, err);
    return res.status(500).json({ message });
  }
});

// POST /api/payouts/admin/claim
router.post('/admin/claim', auth, admin, async (req, res) => {
  try {
    const limit = toPositiveInt(req.body?.limit, 100);
    const payoutIds = toIdList(req.body?.payoutIds);
    const sellerId = typeof req.body?.sellerId === 'string' ? req.body.sellerId.trim() : '';
    const claimAll = req.body?.claimAll === true;

    const result = await claimAdminReadyPayouts({
      sellerId: sellerId || undefined,
      payoutIds,
      limit,
      claimAll,
    });

    return res.json({
      message: 'Admin claim processed',
      ...result,
    });
  } catch (err) {
    const message = err?.message || 'Failed to claim payouts as admin';
    console.error('[PAYOUT][ADMIN_CLAIM] Error:', message, err);
    return res.status(500).json({ message });
  }
});

module.exports = router;
