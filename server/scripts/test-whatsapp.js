const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { sendWhatsAppOtp } = require('../services/messaging');

async function runTest() {
  const testNumber = process.argv[2];
  if (!testNumber) {
    console.error('Error: Please specify a phone number to test, e.g.: node scripts/test-whatsapp.js +91XXXXXXXXXX');
    process.exit(1);
  }

  console.log(`Sending test WhatsApp OTP to: ${testNumber}`);
  console.log(`Access Token: ${process.env.META_WHATSAPP_ACCESS_TOKEN ? 'Present (Configured)' : 'Missing'}`);
  console.log(`Phone ID: ${process.env.META_WHATSAPP_PHONE_NUMBER_ID}`);
  console.log(`Template Name: ${process.env.META_WHATSAPP_TEMPLATE_NAME}`);
  console.log(`Template Lang: ${process.env.META_WHATSAPP_TEMPLATE_LANGUAGE || 'en'}`);

  try {
    const success = await sendWhatsAppOtp(testNumber, '123456');
    if (success) {
      console.log('\nSUCCESS! The message was sent successfully.');
    } else {
      console.log('\nFAILED! Could not send message.');
    }
  } catch (error) {
    console.error('\nERROR during sending message:', error.message);
  }
}

runTest();
