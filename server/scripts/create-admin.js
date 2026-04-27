const path = require('path');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../models/User');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const ADMIN_ROLES = new Set(['support', 'ops', 'finance', 'superadmin']);

function normalizeEmail(input) {
  return String(input || '').trim().toLowerCase();
}

function normalizeRole(input) {
  const role = String(input || 'superadmin').trim().toLowerCase();
  if (!ADMIN_ROLES.has(role)) {
    return '';
  }
  return role;
}

async function run() {
  const email = normalizeEmail(process.argv[2]);
  const password = String(process.argv[3] || '').trim();
  const name = String(process.argv[4] || 'Admin User').trim();
  const role = normalizeRole(process.argv[5] || 'superadmin');

  if (!email || !password) {
    console.log('Usage: node server/scripts/create-admin.js user@email.com "StrongPassword123!" [name] [support|ops|finance|superadmin]');
    process.exit(1);
  }

  if (!role) {
    console.log('Invalid role. Use one of: support, ops, finance, superadmin');
    process.exit(1);
  }

  if (password.length < 8) {
    console.log('Password must be at least 8 characters long.');
    process.exit(1);
  }

  const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/handkraft';

  try {
    await mongoose.connect(mongoUri);
    const hashedPassword = await bcrypt.hash(password, 10);

    const existing = await User.findOne({ email });
    if (existing) {
      existing.name = name || existing.name;
      existing.password = hashedPassword;
      existing.authProvider = 'local';
      existing.isAdmin = true;
      existing.adminRole = role;
      existing.accountStatus = 'active';
      existing.suspensionReason = '';
      existing.suspendedAt = null;
      await existing.save();

      console.log(`Updated existing account as admin: ${email} (role: ${role})`);
    } else {
      const user = new User({
        name,
        email,
        password: hashedPassword,
        authProvider: 'local',
        isAdmin: true,
        adminRole: role,
        accountStatus: 'active',
      });
      await user.save();

      console.log(`Created new admin account: ${email} (role: ${role})`);
    }
  } catch (err) {
    console.error('Failed to create admin user:', err?.message || err);
    process.exitCode = 1;
  } finally {
    try {
      await mongoose.disconnect();
    } catch (disconnectErr) {
      console.error('Failed to disconnect cleanly:', disconnectErr?.message || disconnectErr);
    }
  }
}

run();