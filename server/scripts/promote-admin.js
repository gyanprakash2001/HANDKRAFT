// scripts/promote-admin.js
const mongoose = require('mongoose');
const User = require('../models/User');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/handkraft';

async function promoteAdmin(email) {
  await mongoose.connect(MONGO_URI);
  const user = await User.findOne({ email });
  if (!user) {
    console.log('User not found:', email);
    process.exit(1);
  }
  user.isAdmin = true;
  await user.save();
  console.log('User promoted to admin:', email);
  process.exit(0);
}

const email = process.argv[2];
if (!email) {
  console.log('Usage: node scripts/promote-admin.js user@email.com');
  process.exit(1);
}
promoteAdmin(email);
