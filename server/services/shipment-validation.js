const mongoose = require('mongoose');
const User = require('../models/User');

/**
 * Normalize and validate a pincode
 * Should be 6 digits for Indian postal codes
 */
function normalizePincode(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 6 ? digits : null;
}

/**
 * Check if a seller's pickup address is complete and valid
 * Returns: { isReady: boolean, missingFields: string[], seller: {...} }
 */
async function isSellerReadyForShipping(sellerId) {
  const sellerObjectId = String(sellerId || '').trim();
  if (!sellerObjectId || !mongoose.Types.ObjectId.isValid(sellerObjectId)) {
    return {
      isReady: false,
      sellerId: sellerObjectId,
      sellerName: 'Unknown',
      missingFields: ['Invalid seller ID'],
    };
  }

  let seller;
  try {
    seller = await User.findById(sellerObjectId).select(
      'name email sellerDisplayName sellerContactEmail sellerPickupAddress'
    );
  } catch (err) {
    console.error(`[SHIPMENT_VALIDATION] Error fetching seller ${sellerObjectId}:`, err?.message);
    return {
      isReady: false,
      sellerId: sellerObjectId,
      sellerName: 'Unknown',
      missingFields: ['Could not fetch seller details'],
    };
  }

  if (!seller) {
    return {
      isReady: false,
      sellerId: sellerObjectId,
      sellerName: 'Unknown',
      missingFields: ['Seller not found'],
    };
  }

  const sellerName = String(seller.sellerDisplayName || seller.name || 'Seller').trim();
  const pickup = seller.sellerPickupAddress || {};
  const missingFields = [];

  // Check required fields
  if (!String(pickup.fullName || '').trim()) {
    missingFields.push('fullName');
  }

  if (!String(pickup.phoneNumber || '').trim()) {
    missingFields.push('phoneNumber');
  }

  if (!String(pickup.street || '').trim()) {
    missingFields.push('street');
  }

  if (!String(pickup.city || '').trim()) {
    missingFields.push('city');
  }

  if (!String(pickup.state || '').trim()) {
    missingFields.push('state');
  }

  const normalizedPincode = normalizePincode(pickup.postalCode);
  if (!normalizedPincode) {
    missingFields.push('postalCode (must be 6-digit number)');
  }

  return {
    isReady: missingFields.length === 0,
    sellerId: String(seller._id),
    sellerName,
    missingFields,
    seller: missingFields.length === 0 ? {
      id: String(seller._id),
      name: sellerName,
      email: String(seller.sellerContactEmail || seller.email || ''),
      pickup: {
        fullName: String(pickup.fullName || '').trim(),
        phoneNumber: String(pickup.phoneNumber || '').trim(),
        street: String(pickup.street || '').trim(),
        city: String(pickup.city || '').trim(),
        state: String(pickup.state || '').trim(),
        postalCode: normalizedPincode,
      },
    } : null,
  };
}

/**
 * Validate multiple sellers for an order
 * Returns: { allReady: boolean, results: [...], unreadySellers: [...] }
 */
async function validateOrderSellers(sellerIds = []) {
  if (!Array.isArray(sellerIds) || sellerIds.length === 0) {
    return {
      allReady: false,
      results: [],
      unreadySellers: [],
      message: 'No sellers provided for validation',
    };
  }

  const uniqueSellerIds = Array.from(new Set(
    sellerIds.map((id) => String(id || '').trim()).filter(Boolean)
  ));

  const results = [];
  const unreadySellers = [];

  for (const sellerId of uniqueSellerIds) {
    try {
      const validation = await isSellerReadyForShipping(sellerId);
      results.push(validation);

      if (!validation.isReady) {
        unreadySellers.push({
          sellerId: validation.sellerId,
          sellerName: validation.sellerName,
          missingFields: validation.missingFields,
        });
      }
    } catch (err) {
      console.error(`[SHIPMENT_VALIDATION] Error validating seller ${sellerId}:`, err?.message);
      results.push({
        isReady: false,
        sellerId,
        sellerName: 'Unknown',
        missingFields: ['Validation error: Could not process seller'],
      });
      unreadySellers.push({
        sellerId,
        sellerName: 'Unknown',
        missingFields: ['Validation error'],
      });
    }
  }

  const allReady = unreadySellers.length === 0;

  return {
    allReady,
    results,
    unreadySellers,
    message: allReady
      ? 'All sellers ready for shipping'
      : `${unreadySellers.length} seller(s) need to complete pickup address details`,
  };
}

module.exports = {
  isSellerReadyForShipping,
  validateOrderSellers,
  normalizePincode,
};
