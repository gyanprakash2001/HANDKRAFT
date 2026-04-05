const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error('MONGO_URI missing in server/.env');
  process.exit(1);
}

async function run() {
  try {
    console.log('Connecting to MongoDB Atlas...');
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 20000,
    });
    console.log('CONNECTED_OK');
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('CONNECT_FAIL:', err.message);
    if (err && err.reason && err.reason.servers) {
      console.error('\nPer-host details:');
      for (const [host, desc] of err.reason.servers) {
        const e = desc && desc.error ? (desc.error.message || String(desc.error)) : 'No host error message';
        console.error(`- ${host}: ${e}`);
      }
    }
    process.exit(1);
  }
}

run();
