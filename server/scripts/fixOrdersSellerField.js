const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const Order = require('../models/Order');

(async () => {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/handkraft';
    await mongoose.connect(mongoUri, { family: 4 });

    console.log('Connected to MongoDB, scanning orders for string seller fields...');

    // Find orders where any item.seller is a string
    const cursor = Order.find({ 'items.seller': { $type: 'string' } }).lean().cursor();
    let processed = 0;
    let modifiedOrders = 0;
    for await (const o of cursor) {
      processed++;
      const origItems = o.items || [];
      const newItems = JSON.parse(JSON.stringify(origItems));
      let changed = false;

      for (let i = 0; i < newItems.length; i++) {
        const it = newItems[i];
        const sellerVal = it.seller;
        if (typeof sellerVal === 'string') {
          // Find first 24-hex substring
          const m = sellerVal.match(/([0-9a-fA-F]{24})/);
          if (m) {
            const hex = m[1];
            // Only create ObjectId if not already
            if (!it.seller || typeof it.seller !== 'object' || !it.seller._bsontype) {
              it.seller = new mongoose.Types.ObjectId(hex);
              changed = true;
              console.log(`[FIX] Order ${o._id} item[${i}] seller string -> ObjectId(${hex})`);
            }
          } else {
            it.seller = null;
            changed = true;
            console.log(`[FIX] Order ${o._id} item[${i}] seller string -> null`);
          }
        }
      }

      if (changed) {
        await Order.updateOne({ _id: o._id }, { $set: { items: newItems } });
        modifiedOrders++;
      }
    }

    console.log('Scan complete. Processed orders:', processed, 'Modified orders:', modifiedOrders);

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('ERR', err);
    process.exit(1);
  }
})();
