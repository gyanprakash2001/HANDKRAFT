const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const User = require('../models/User');

const ADMIN_EMAIL = 'gyanprakashhh2001@gmail.com';
const ADMIN_PASSWORD = 'Multimedia8147';
const ADMIN_NAME = 'Gyan Prakash';

async function seedAdmin() {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/handkraft';
    console.log(`Connecting to MongoDB: ${mongoUri}`);
    
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    // Check if admin already exists
    const existing = await User.findOne({ email: ADMIN_EMAIL });
    if (existing) {
      if (existing.isAdmin) {
        console.log(`✓ Admin account already exists: ${ADMIN_EMAIL}`);
        process.exit(0);
      } else {
        console.log(`Account exists but not admin. Promoting to admin...`);
        existing.isAdmin = true;
        existing.adminRole = 'superadmin';
        await existing.save();
        console.log(`✓ Promoted ${ADMIN_EMAIL} to admin`);
        process.exit(0);
      }
    }

    // Create new admin user
    const hashed = await bcrypt.hash(ADMIN_PASSWORD, 10);
    const admin = new User({
      name: ADMIN_NAME,
      firstName: 'Gyan',
      lastName: 'Prakash',
      email: ADMIN_EMAIL,
      password: hashed,
      authProvider: 'local',
      isAdmin: true,
      adminRole: 'superadmin',
      emailVerified: true,
      avatarUrl: 'local:avatar01',
    });

    await admin.save();
    console.log(`✓ Admin account created successfully: ${ADMIN_EMAIL}`);
    process.exit(0);
  } catch (err) {
    console.error('Error seeding admin:', err.message);
    process.exit(1);
  }
}

seedAdmin();
