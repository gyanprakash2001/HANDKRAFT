/**
 * Test: Seller Pickup Address Endpoint Helper
 * 
 * Verifies the shared helper behind PUT /api/users/seller/pickup-address.
 */

const assert = require('assert');
const {
  resolveSellerPickupAddressUpdate,
  buildSellerPickupAddressResponse,
} = require('../services/seller-pickup-address');

function run() {
  console.log('\n========== SELLER PICKUP ADDRESS ENDPOINT TESTS ==========' );

  const user = {
    addresses: [
      {
        _id: 'addr-1',
        label: 'Warehouse',
        fullName: 'Seller One',
        phoneNumber: '9876543210',
        email: 'seller@example.com',
        street: '12 Main St',
        city: 'Mumbai',
        state: 'MH',
        postalCode: '400001',
        country: 'India',
      },
    ],
  };

  const fromSaved = resolveSellerPickupAddressUpdate(user, { sellerPickupAddressId: 'addr-1' });
  assert.strictEqual(fromSaved.ok, true);
  assert.strictEqual(fromSaved.sellerPickupAddress.addressId, 'addr-1');
  assert.strictEqual(fromSaved.sellerPickupAddress.state, 'MH');

  const fromPayload = resolveSellerPickupAddressUpdate(user, {
    sellerPickupAddress: {
      label: 'Studio',
      fullName: 'Seller Studio',
      phoneNumber: '9999999999',
      email: 'studio@example.com',
      street: '45 Art Lane',
      city: 'Delhi',
      state: 'DL',
      postalCode: '110001',
      country: 'India',
    },
  });
  assert.strictEqual(fromPayload.ok, true);
  assert.strictEqual(fromPayload.sellerPickupAddress.label, 'Studio');
  assert.strictEqual(fromPayload.sellerPickupAddress.city, 'Delhi');

  const invalid = resolveSellerPickupAddressUpdate(user, {
    sellerPickupAddress: {
      label: 'Broken',
      fullName: '',
      phoneNumber: '',
      email: '',
      street: '',
      city: '',
      state: '',
      postalCode: '',
      country: 'India',
    },
  });
  assert.strictEqual(invalid.ok, false);
  assert.strictEqual(invalid.statusCode, 400);

  const response = buildSellerPickupAddressResponse(fromSaved.sellerPickupAddress);
  assert.strictEqual(response.addressId, 'addr-1');
  assert.strictEqual(response.state, 'MH');

  console.log('✓ PASS: saved-address selection works');
  console.log('✓ PASS: direct payload update works');
  console.log('✓ PASS: invalid pickup payload rejected');
  console.log('✓ PASS: response formatting matches API shape');
  console.log('');
  console.log('========== TEST SUMMARY ==========' );
  console.log('✓ PASSED: 4');
  console.log('✗ FAILED: 0');
  console.log('📈 TOTAL:  4');
}

run();
