// scripts/promote-admin.js
const mongoose = require('mongoose');
const User = require('../models/User');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/handkraft';
const ADMIN_ROLES = new Set(['support', 'ops', 'finance', 'superadmin']);

async function promoteAdmin(email, roleInput) {
  const role = String(roleInput || 'superadmin').trim().toLowerCase();
  if (!ADMIN_ROLES.has(role)) {
    console.log('Invalid role. Use one of: support, ops, finance, superadmin');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  const user = await User.findOne({ email });
  if (!user) {
    console.log('User not found:', email);
    process.exit(1);
  }
  user.isAdmin = true;
  user.adminRole = role;
  await user.save();
  console.log(`User promoted to admin: ${email} (role: ${role})`);
  process.exit(0);
}

const email = process.argv[2];
const roleArg = process.argv[3];
if (!email) {
  console.log('Usage: node scripts/promote-admin.js user@email.com [support|ops|finance|superadmin]');
  process.exit(1);
}
promoteAdmin(email, roleArg);
