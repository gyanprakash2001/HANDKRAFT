const fetch = global.fetch || require('node-fetch');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

(async () => {
  try {
    const rand = Math.floor(Math.random() * 100000);
    const signupRes = await fetch('http://localhost:5000/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Test${rand}`, email: `test${rand}@example.com`, password: 'password123' }),
    });
    const signup = await signupRes.json();
    console.log('Signup:', signup);
    const token = signup.token;
    const avatarUrl = `local:avatar05`;
    const updateRes = await fetch('http://localhost:5000/api/users/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ avatarUrl }),
    });
    const update = await updateRes.json();
    console.log('Update status:', updateRes.status, 'body:', update);
  } catch (err) {
    console.error('ERR', err);
  }
})();
