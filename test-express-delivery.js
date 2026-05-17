require('dotenv').config({path:'server/.env'});

const np = require('./server/services/nimbuspost');

const daysToDeliver = (eddStr) => {
  try {
    const parts = eddStr.trim().split('-');
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const year = parseInt(parts[2], 10);
    const eddDate = new Date(year, month - 1, day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffMs = eddDate.getTime() - today.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  } catch {
    return 0;
  }
};

(async () => {
  try {
    console.log('Checking multiple routes for Express vs Normal delivery...\n');
    
    // Test 1: Same city (should have fastest delivery)
    console.log('📍 ROUTE 1: Bangalore 560001 → 560042 (same city, ~10km)');
    const result1 = await np.getCourierServiceabilityQuote({
      origin: '560001',
      destination: '560042',
      paymentType: 'prepaid',
      weight: 500
    });
    
    console.log('Total couriers:', result1.quotes.length, '\n');
    
    result1.quotes.forEach(q => {
      const days = daysToDeliver(q.etd);
      const tag = days <= 2 ? '⚡ EXPRESS' : '🚚 NORMAL';
      console.log(`${tag}  ${q.courierName}: ${q.etd} (${days}d) - ₹${q.totalCharges}`);
    });
    
    console.log('\n---\n');
    
    // Test 2: Different cities (should show standard delivery)
    console.log('📍 ROUTE 2: Bangalore 560001 → Mumbai 400001 (inter-city, ~1500km)');
    const result2 = await np.getCourierServiceabilityQuote({
      origin: '560001',
      destination: '400001',
      paymentType: 'prepaid',
      weight: 500
    });
    
    console.log('Total couriers:', result2.quotes.length, '\n');
    result2.quotes.forEach(q => {
      const days = daysToDeliver(q.etd);
      const tag = days <= 2 ? '⚡ EXPRESS' : '🚚 NORMAL';
      console.log(`${tag}  ${q.courierName}: ${q.etd} (${days}d) - ₹${q.totalCharges}`);
    });
    
    console.log('\n' + '='.repeat(60));
    console.log('ANALYSIS');
    console.log('='.repeat(60));
    
    const allDays1 = result1.quotes.map(q => daysToDeliver(q.etd));
    const allDays2 = result2.quotes.map(q => daysToDeliver(q.etd));
    const minDays1 = Math.min(...allDays1);
    const minDays2 = Math.min(...allDays2);
    
    console.log(`Fastest same-city delivery: ${minDays1} days`);
    console.log(`Fastest inter-city delivery: ${minDays2} days`);
    
    const expressAvailable = minDays1 <= 2 || minDays2 <= 2;
    
    console.log('\n' + '='.repeat(60));
    if (expressAvailable) {
      console.log('✓ EXPRESS DELIVERY (1-2 days) IS AVAILABLE');
    } else {
      console.log('✗ EXPRESS DELIVERY NOT AVAILABLE');
      console.log(`  → Minimum delivery time is ${Math.min(minDays1, minDays2)} days`);
      console.log('  → All available options are STANDARD (3+ days) delivery');
    }
    console.log('='.repeat(60));
    
  } catch(e) {
    console.error('Error:', e.message);
  }
})()
