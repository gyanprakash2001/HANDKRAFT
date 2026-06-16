const nodemailer = require('nodemailer');

/**
 * Sends a 6-digit OTP code to the user's email.
 * Falls back to console log if SMTP settings are missing.
 */
async function sendEmailOtp(email, otp) {
  const apiKey = process.env.EMAIL_SMTP_PASS;
  const from = process.env.EMAIL_FROM || '"HANDKRAFT" <noreply@handkraft.studio>';

  const messageText = `Your HANDKRAFT verification code is: ${otp}. It will expire in 5 minutes.`;
  const messageHtml = `
    <div style="font-family: sans-serif; padding: 20px; background-color: #0b1118; color: #f5fbff; border-radius: 10px; max-width: 500px; margin: auto;">
      <h2 style="color: #9df0a2; text-align: center;">HANDKRAFT</h2>
      <p style="font-size: 16px; text-align: center;">Verify your email address</p>
      <div style="font-size: 32px; font-weight: bold; text-align: center; padding: 15px; background-color: #1e2b38; border-radius: 5px; color: #9df0a2; letter-spacing: 5px; margin: 20px 0;">
        ${otp}
      </div>
      <p style="font-size: 13px; color: #9fb0c1; text-align: center;">This code will expire in 5 minutes. If you did not request this code, you can safely ignore this email.</p>
    </div>
  `;

  if (!apiKey) {
    console.log('\n[MOCK EMAIL SENT] --------------------');
    console.log(`To:      ${email}`);
    console.log(`Subject: HANDKRAFT Verification Code`);
    console.log(`Code:    ${otp}`);
    console.log('-------------------------------------\n');
    return true;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: 'HANDKRAFT Verification Code',
        text: messageText,
        html: messageHtml
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      let errMsg = errText;
      try {
        const parsed = JSON.parse(errText);
        errMsg = parsed.message || parsed.description || errText;
      } catch (e) {}
      throw new Error(`Resend API error: ${errMsg}`);
    }

    return true;
  } catch (error) {
    console.error('Failed to send verification email:', error);
    throw new Error(error.message || 'Could not send verification email. Please try again.');
  }
}

/**
 * Sends a 6-digit OTP code to the user's WhatsApp number.
 * Falls back to console log if Twilio credentials are missing.
 */
async function sendWhatsAppOtp(phoneNumber, otp) {
  const metaAccessToken = process.env.META_WHATSAPP_ACCESS_TOKEN;
  const metaPhoneId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  const metaTemplateName = process.env.META_WHATSAPP_TEMPLATE_NAME;
  const metaTemplateLang = process.env.META_WHATSAPP_TEMPLATE_LANGUAGE || 'en';

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromWhatsApp = process.env.TWILIO_WHATSAPP_FROM; // e.g. 'whatsapp:+14155238886'

  // Ensure format: should start with plus sign or add country code
  let formattedPhone = phoneNumber.trim().replace(/\s+/g, '');
  if (!formattedPhone.startsWith('+')) {
    // Default to adding Indian country code (+91) if not specified and length is 10 digits
    if (formattedPhone.length === 10) {
      formattedPhone = `+91${formattedPhone}`;
    } else {
      formattedPhone = `+${formattedPhone}`;
    }
  }

  const messageText = `Your HANDKRAFT verification code is: ${otp}. It will expire in 5 minutes.`;

  // 1. Check if Meta Cloud API is configured
  if (metaAccessToken && metaPhoneId && metaTemplateName) {
    // Meta expects recipient phone to be ONLY digits with country code (e.g. 919876543210)
    const metaFormattedPhone = formattedPhone.replace('+', '');
    try {
      const res = await fetch(`https://graph.facebook.com/v20.0/${metaPhoneId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${metaAccessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: metaFormattedPhone,
          type: 'template',
          template: {
            name: metaTemplateName,
            language: {
              code: metaTemplateLang
            },
            components: metaTemplateName === 'hello_world' ? [] : [
              {
                type: 'body',
                parameters: [
                  {
                    type: 'text',
                    text: otp
                  }
                ]
              }
            ]
          }
        })
      });

      if (!res.ok) {
        const responseText = await res.text();
        throw new Error(`Meta API error: ${res.status} - ${responseText}`);
      }

      return true;
    } catch (error) {
      console.error('Failed to send WhatsApp message via Meta Cloud API:', error);
      throw new Error('Could not send WhatsApp verification code. Please check settings and try again.');
    }
  }

  // 2. Fallback to Twilio if Twilio is configured
  if (accountSid && authToken && fromWhatsApp) {
    try {
      const twilioFrom = fromWhatsApp.startsWith('whatsapp:') ? fromWhatsApp : `whatsapp:${fromWhatsApp}`;
      const twilioTo = `whatsapp:${formattedPhone}`;

      const params = new URLSearchParams();
      params.append('To', twilioTo);
      params.append('From', twilioFrom);
      params.append('Body', messageText);

      const authHeader = 'Basic ' + Buffer.from(accountSid + ':' + authToken).toString('base64');

      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': authHeader
        },
        body: params.toString()
      });

      if (!res.ok) {
        const responseText = await res.text();
        throw new Error(`Twilio error: ${res.status} - ${responseText}`);
      }

      return true;
    } catch (error) {
      console.error('Failed to send WhatsApp message via Twilio:', error);
      throw new Error('Could not send WhatsApp verification code. Please check settings and try again.');
    }
  }

  // 3. Fallback to Mock console log in development mode
  console.log('\n[MOCK WHATSAPP SENT] ----------------');
  console.log(`To:      whatsapp:${formattedPhone}`);
  console.log(`Body:    ${messageText}`);
  console.log('-------------------------------------\n');
  return true;
}

module.exports = {
  sendEmailOtp,
  sendWhatsAppOtp
};
