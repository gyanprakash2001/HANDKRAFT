const mongoose = require('mongoose');

require('dotenv').config({ path: __dirname + '/../.env' });

const Order = require('../models/Order');

async function main() {
  const ttlHours = Math.max(1, Number(process.env.ORDER_DRAFT_TTL_HOURS || 24));
  const cutoff = new Date(Date.now() - ttlHours * 60 * 60 * 1000);

  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/handkraft';
  await mongoose.connect(mongoUri, { family: 4 });

  const filter = {
    isDraft: true,
    paymentStatus: { $in: ['pending', 'failed'] },
    createdAt: { $lt: cutoff },
  };

  const dryRun = String(process.env.ORDER_DRAFT_CLEANUP_DRY_RUN || '').trim().toLowerCase() === 'true';
  const draftCount = await Order.countDocuments(filter);

  if (dryRun) {
    console.log(`[CLEANUP] dry-run drafts=${draftCount} ttlHours=${ttlHours} cutoff=${cutoff.toISOString()}`);
    return;
  }

  const result = await Order.deleteMany(filter);
  console.log(
    `[CLEANUP] deleted=${Number(result.deletedCount || 0)} matched=${draftCount} ttlHours=${ttlHours} cutoff=${cutoff.toISOString()}`
  );
}

main()
  .catch((err) => {
    console.error('[CLEANUP] Failed:', err?.message || err);
    process.exit(1);
  })
  .finally(async () => {
    try {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close();
      }
    } catch {
      // Ignore close failures.
    }
  });