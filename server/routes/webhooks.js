const express = require('express');
const router = express.Router();
const { processNimbuspostWebhook } = require('../services/nimbuspost-webhook');
const { logWebhookAudit, nowMs } = require('../services/audit');

router.post('/nimbuspost', async (req, res) => {
  const _start = nowMs();
  try {
    const result = await processNimbuspostWebhook({
      headers: req.headers,
      rawBody: req.rawBody,
      body: req.body || {},
    });

    // Audit: NimbusPost webhook via /api/webhooks route
    const awb = String(
      req.body?.awb || req.body?.awb_number || req.body?.data?.awb
      || req.body?.data?.awb_number || ''
    ).trim();
    const nimbusStatus = String(
      req.body?.current_status || req.body?.shipment_status
      || req.body?.status || ''
    ).trim();
    logWebhookAudit({
      provider: 'nimbuspost',
      event: nimbusStatus || 'tracking_update',
      idempotencyKey: awb ? `nimbus_wh_${awb}_${nimbusStatus}_${Date.now()}` : undefined,
      signature: String(req.headers['x-webhook-secret'] || req.headers['x-hmac-sha256'] || ''),
      signatureValid: result.statusCode !== 401,
      payload: req.body,
      headers: req.headers,
      processingResult: result.body,
      awbNumber: awb,
      httpStatusCode: result.statusCode || 200,
      processingMs: nowMs() - _start,
      ip: req.ip || req.headers['x-forwarded-for'] || '',
    });

    return res.status(result.statusCode || 200).json(result.body || {});
  } catch (err) {
    const errorMsg = typeof err === 'string' ? err : (err?.message || String(err) || 'Unknown error');
    console.error('[NIMBUS_WEBHOOK] Error:', errorMsg, err);
    logWebhookAudit({
      provider: 'nimbuspost',
      signatureValid: null,
      payload: req.body,
      headers: req.headers,
      httpStatusCode: 500,
      error: errorMsg,
      processingMs: nowMs() - _start,
      ip: req.ip || req.headers['x-forwarded-for'] || '',
    });
    return res.status(500).json({ message: errorMsg });
  }
});

module.exports = router;