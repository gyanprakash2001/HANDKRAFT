const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const nodemailer = require('nodemailer');

async function testConnection() {
  const host = process.env.EMAIL_SMTP_HOST;
  const port = process.env.EMAIL_SMTP_PORT || 587;
  const user = process.env.EMAIL_SMTP_USER;
  const pass = process.env.EMAIL_SMTP_PASS;
  const from = process.env.EMAIL_FROM || '"HANDKRAFT" <noreply@handkraft.com>';

  console.log('--- Email Config ---');
  console.log('Host:', host);
  console.log('Port:', port);
  console.log('User:', user);
  console.log('From:', from);
  console.log('Password length:', pass ? pass.length : 0);
  console.log('--------------------');

  if (!host || !user || !pass) {
    console.error('SMTP credentials missing from environment!');
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    host,
    port: Number(port),
    secure: Number(port) === 465,
    auth: { user, pass },
    debug: true,      // show debug logs
    logger: true,     // log connection communication
  });

  try {
    console.log('Verifying SMTP connection...');
    await transporter.verify();
    console.log('SMTP connection verified successfully!');

    console.log('Attempting to send a test email to gps27sept@gmail.com...');
    const info = await transporter.sendMail({
      from,
      to: 'gps27sept@gmail.com',
      subject: 'HANDKRAFT Test Email',
      text: 'This is a test email to verify SMTP configuration.',
    });
    console.log('Email sent successfully!', info);
  } catch (error) {
    console.error('Error occurred during SMTP operations:', error);
  }
}

testConnection();
