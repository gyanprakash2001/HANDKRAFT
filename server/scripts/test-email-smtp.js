require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { sendEmailOtp } = require('../services/messaging');

async function testEmailApi() {
  const apiKey = process.env.EMAIL_SMTP_PASS;
  const from = process.env.EMAIL_FROM || '"HANDKRAFT" <noreply@handkraft.studio>';
  const to = 'gps27sept@gmail.com';

  console.log('--- Resend API Config ---');
  console.log('API Key (last 5 chars):', apiKey ? apiKey.slice(-5) : 'not defined');
  console.log('From:', from);
  console.log('To:', to);
  console.log('-------------------------');

  try {
    console.log('Sending test email via Resend HTTP REST API...');
    const result = await sendEmailOtp(to, '123456');
    console.log('Success! Result:', result);
  } catch (error) {
    console.error('Failed to send email:', error);
  }
}

testEmailApi();
