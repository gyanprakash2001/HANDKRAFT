const fetch = global.fetch || require('node-fetch');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

(async () => {
  try {
    const rand = Math.floor(Math.random() * 1000000);
    const email = `test${Date.now()}${rand}@example.com`;
    const signupRes = await fetch('http://localhost:5000/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `TestUser${rand}`, email, password: 'password123' }),
    });

    let signupBody;
    try {
      signupBody = await signupRes.json();
    } catch (e) {
      signupBody = { raw: await signupRes.text() };
    }

    console.log('Signup status:', signupRes.status);
    console.log('Signup response:', signupBody);

    if (!signupRes.ok) {
      console.error('Signup request failed');
      process.exit(1);
    }

    const { token, user } = signupBody;
    if (!user || !user.avatarUrl) {
      console.error('No avatarUrl returned in signup response');
      process.exit(1);
    }

    const avatar = String(user.avatarUrl);
    const poolRe = /^local:avatar(0[1-9]|1[0-9]|2[0-9]|30)$/;
    if (!poolRe.test(avatar)) {
      console.error('Assigned avatar is not from local pool:', avatar);
      process.exit(1);
    }

    console.log('Assigned avatar:', avatar);

    // Verify via authenticated profile fetch
    const profileRes = await fetch('http://localhost:5000/api/auth/profile', {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });

    let profileBody;
    try {
      profileBody = await profileRes.json();
    } catch (e) {
      profileBody = { raw: await profileRes.text() };
    }

    console.log('Profile status:', profileRes.status);
    console.log('Profile response:', profileBody);

    const profileAvatar = profileBody?.user?.avatarUrl;
    if (!profileAvatar || String(profileAvatar) !== avatar) {
      console.error('Profile avatar does not match signup avatar:', profileAvatar, avatar);
      process.exit(1);
    }

    console.log('PASS: Signup assigned a local avatar and profile reflects it.');
    process.exit(0);
  } catch (err) {
    console.error('ERROR', err);
    process.exit(1);
  }
})();
