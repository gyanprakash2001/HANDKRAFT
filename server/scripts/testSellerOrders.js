const jwt = require('jsonwebtoken');
const fetch = global.fetch || require('node-fetch');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

(async () => {
  try {
    const userId = process.argv[2] || '69bf0d6c1edbe391d97b0160';
    const secret = process.env.JWT_SECRET || 'secret';
    const token = jwt.sign({ id: userId }, secret, { expiresIn: '7d' });

    console.log('Using token for user:', userId);
    const res = await fetch('http://localhost:5000/api/orders/seller/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log('Status:', res.status);
    const text = await res.text();
    console.log('Body:', text);
  } catch (err) {
    console.error('ERR', err);
    process.exit(1);
  }
})();
