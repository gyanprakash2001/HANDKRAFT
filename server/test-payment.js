const mongoose = require('mongoose');
const User = require('./models/User');
const Product = require('./models/Product');
const Order = require('./models/Order');

mongoose.connect('mongodb://localhost:27017/handkraft', { family: 4 }).then(async () => {
  try {
    // Find a test user
    const user = await User.findOne().select('_id cartItems');
    if (!user) {
      console.log('NO_USER');
      process.exit(1);
    }
    console.log('USER_ID:', user._id.toString());
    console.log('CART_ITEMS:', user.cartItems ? user.cartItems.length : 0);
    
    // If no cart items, add one
    if (!user.cartItems || user.cartItems.length === 0) {
      const product = await Product.findOne({ stock: { $gt: 0 } });
      if (!product) {
        console.log('NO_PRODUCT_WITH_STOCK');
        process.exit(1);
      }
      user.cartItems = [{
        product: product._id,
        quantity: 1,
      }];
      await user.save();
      console.log('ADDED_PRODUCT_TO_CART:', product._id.toString());
    }
    
    process.exit(0);
  } catch (e) {
    console.log('ERROR:', e.message);
    console.log('STACK:', e.stack);
    process.exit(1);
  }
}).catch(e => {
  console.log('MONGO_ERROR:', e.message);
  process.exit(1);
});
