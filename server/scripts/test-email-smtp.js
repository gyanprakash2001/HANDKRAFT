const axios = require('axios'); // Wait, let's use standard fetch in Node 18+ to avoid adding dependencies

async function testAzureApi() {
  const url = 'https://handkraft-api-gyan-akgwc4bwesczdage.centralindia-01.azurewebsites.net/api/auth/send-otp';
  const payload = {
    email: 'gps27sept@gmail.com',
    phoneNumber: ''
  };

  console.log('Sending request to Azure App Service...');
  console.log('URL:', url);
  console.log('Payload:', payload);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    console.log('Response Status:', res.status);
    console.log('Response StatusText:', res.statusText);
    const bodyText = await res.text();
    console.log('Response Body:', bodyText);
  } catch (error) {
    console.error('Request failed:', error);
  }
}

testAzureApi();
