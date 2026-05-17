const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/handkraft';
  await mongoose.connect(uri, { family: 4 });
  const db = mongoose.connection.db;

  // Remove idempotencyKey field entirely from docs where it's null or empty
  const r1 = await db.collection('webhookaudits').updateMany(
    { $or: [{ idempotencyKey: null }, { idempotencyKey: '' }] },
    { $unset: { idempotencyKey: '' } }
  );
  console.log('Unset idempotencyKey from', r1.modifiedCount, 'docs');

  // Drop any existing idempotencyKey index
  try {
    await db.collection('webhookaudits').dropIndex('idempotencyKey_1');
    console.log('Dropped old idempotencyKey_1 index');
  } catch (e) {
    console.log('No idempotencyKey_1 to drop:', e.message);
  }

  await mongoose.disconnect();
  console.log('Done');
}

main().catch(e => { console.error(e); process.exit(1); });
