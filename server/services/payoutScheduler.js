const { env } = require('../config/env');
const { processDuePayouts } = require('./payouts');

let schedulerHandle = null;
let schedulerRunning = false;

function getSchedulerConfig() {
  const payouts = env?.payouts || {};
  return {
    enabled: payouts.enabled !== false,
    schedulerEnabled: payouts.schedulerEnabled !== false,
    intervalMs: Number(payouts.schedulerIntervalMs || 60000),
    batchLimit: Number(payouts.schedulerBatchLimit || 50),
  };
}

async function runPayoutSchedulerTick() {
  if (schedulerRunning) {
    return;
  }

  schedulerRunning = true;
  try {
    const config = getSchedulerConfig();
    const result = await processDuePayouts({ limit: config.batchLimit });

    if (result.scanned > 0) {
      const releasedCount = Number(result.releasedCount || 0);
      console.log(
        `[PAYOUT][SCHEDULER] scanned=${result.scanned} released_to_wallet=${releasedCount} failed=${result.failedCount}`
      );
    }
  } catch (err) {
    console.error('[PAYOUT][SCHEDULER] Tick failed:', err?.message || err);
  } finally {
    schedulerRunning = false;
  }
}

function startPayoutScheduler() {
  const config = getSchedulerConfig();

  if (!config.enabled || !config.schedulerEnabled) {
    console.log('[PAYOUT][SCHEDULER] Disabled by configuration.');
    return;
  }

  if (schedulerHandle) {
    return;
  }

  const intervalMs = Math.max(config.intervalMs, 10000);
  schedulerHandle = setInterval(() => {
    void runPayoutSchedulerTick();
  }, intervalMs);

  if (typeof schedulerHandle.unref === 'function') {
    schedulerHandle.unref();
  }

  console.log(`[PAYOUT][SCHEDULER] Started. interval=${intervalMs}ms batchLimit=${config.batchLimit}`);
  void runPayoutSchedulerTick();
}

function stopPayoutScheduler() {
  if (!schedulerHandle) {
    return;
  }

  clearInterval(schedulerHandle);
  schedulerHandle = null;
  schedulerRunning = false;
  console.log('[PAYOUT][SCHEDULER] Stopped.');
}

module.exports = {
  startPayoutScheduler,
  stopPayoutScheduler,
  runPayoutSchedulerTick,
};
