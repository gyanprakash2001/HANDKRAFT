/**
 * MongoDB Sync: Local → Cloud
 * 
 * Exports all collections from local MongoDB and imports them to MongoDB Atlas.
 * Usage: node scripts/sync-to-cloud.js <ATLAS_URI>
 * 
 * Example:
 *   node scripts/sync-to-cloud.js "mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/handkraft"
 */

const { MongoClient } = require('mongodb');

const LOCAL_URI = process.env.LOCAL_MONGO_URI || 'mongodb://127.0.0.1:27017/handkraft';
const CLOUD_URI = process.argv[2] || process.env.CLOUD_MONGO_URI;

if (!CLOUD_URI) {
  console.error('Usage: node scripts/sync-to-cloud.js <ATLAS_URI>');
  console.error('  or set CLOUD_MONGO_URI environment variable');
  process.exit(1);
}

async function syncCollection(localDb, cloudDb, collectionName) {
  const localCol = localDb.collection(collectionName);
  const cloudCol = cloudDb.collection(collectionName);

  const count = await localCol.countDocuments();
  if (count === 0) {
    console.log(`  [SKIP] ${collectionName}: empty (0 documents)`);
    return { name: collectionName, localCount: 0, cloudCount: 0, status: 'skipped' };
  }

  // Read all documents from local
  const docs = await localCol.find({}).toArray();
  console.log(`  [SYNC] ${collectionName}: ${docs.length} documents`);

  // Drop the cloud collection and re-insert
  try {
    await cloudCol.drop();
  } catch (e) {
    // Collection may not exist yet, that's fine
  }

  if (docs.length > 0) {
    // Insert in batches of 500 to avoid timeout
    const batchSize = 500;
    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = docs.slice(i, i + batchSize);
      await cloudCol.insertMany(batch, { ordered: false });
      if (docs.length > batchSize) {
        console.log(`    Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(docs.length / batchSize)} done`);
      }
    }
  }

  const cloudCount = await cloudCol.countDocuments();
  const match = cloudCount === docs.length;
  console.log(`  [${match ? 'OK' : 'WARN'}] ${collectionName}: local=${docs.length}, cloud=${cloudCount}`);

  // Copy indexes (skip _id index)
  try {
    const indexes = await localCol.indexes();
    for (const idx of indexes) {
      if (idx.name === '_id_') continue;
      try {
        const { key, ...options } = idx;
        delete options.v;
        delete options.ns;
        await cloudCol.createIndex(key, options);
      } catch (idxErr) {
        console.log(`    [IDX_WARN] ${collectionName}.${idx.name}: ${idxErr.message}`);
      }
    }
  } catch (e) {
    // Index copy is best-effort
  }

  return { name: collectionName, localCount: docs.length, cloudCount, status: match ? 'ok' : 'mismatch' };
}

async function main() {
  console.log('=== MongoDB Local → Cloud Sync ===');
  console.log(`Local:  ${LOCAL_URI}`);
  console.log(`Cloud:  ${CLOUD_URI.replace(/:[^:@]+@/, ':***@')}`);
  console.log('');

  let localClient, cloudClient;

  try {
    console.log('Connecting to local MongoDB...');
    localClient = new MongoClient(LOCAL_URI);
    await localClient.connect();
    const localDb = localClient.db();

    console.log('Connecting to MongoDB Atlas...');
    cloudClient = new MongoClient(CLOUD_URI);
    await cloudClient.connect();
    const cloudDb = cloudClient.db();

    // Get all collection names from local
    const collections = await localDb.listCollections().toArray();
    const collectionNames = collections
      .map(c => c.name)
      .filter(name => !name.startsWith('system.'))
      .sort();

    console.log(`\nFound ${collectionNames.length} collections to sync:\n`);

    const results = [];
    for (const name of collectionNames) {
      const result = await syncCollection(localDb, cloudDb, name);
      results.push(result);
    }

    console.log('\n=== Sync Summary ===');
    console.log('Collection'.padEnd(35) + 'Local'.padEnd(10) + 'Cloud'.padEnd(10) + 'Status');
    console.log('-'.repeat(65));
    for (const r of results) {
      console.log(
        r.name.padEnd(35) +
        String(r.localCount).padEnd(10) +
        String(r.cloudCount).padEnd(10) +
        r.status
      );
    }

    const totalLocal = results.reduce((s, r) => s + r.localCount, 0);
    const totalCloud = results.reduce((s, r) => s + r.cloudCount, 0);
    console.log('-'.repeat(65));
    console.log(
      'TOTAL'.padEnd(35) +
      String(totalLocal).padEnd(10) +
      String(totalCloud).padEnd(10) +
      (totalLocal === totalCloud ? 'OK' : 'MISMATCH')
    );
    console.log('\n✅ Sync complete!');

  } catch (err) {
    console.error('\n❌ Sync failed:', err.message);
    process.exit(1);
  } finally {
    if (localClient) await localClient.close();
    if (cloudClient) await cloudClient.close();
  }
}

main();
