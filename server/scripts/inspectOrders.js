const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const Order = require('../models/Order');

(async () => {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/handkraft';
    await mongoose.connect(mongoUri, { family: 4 });

    const orders = await Order.find({}).limit(50).lean();
    console.log('Found', orders.length, 'orders');
    for (const o of orders) {
      console.log('\nOrder', o._id);
      console.log(' user:', o.user);
      for (const it of (o.items || [])) {
        console.log('  item:', {
          product: String(it.product || ''),
          seller: it.seller,
          sellerType: Object.prototype.toString.call(it.seller),
        });
      }
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('ERR', err);
    process.exit(1);
  }
})();
