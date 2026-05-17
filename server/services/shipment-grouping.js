const mongoose = require('mongoose');
const User = require('../models/User');

/**
 * Group order items by their seller ID
 * Returns Map<sellerKey, { seller, itemIndexes }>
 */
function groupItemsBySeller(items = []) {
  const groupedBySeller = new Map();

  (items || []).forEach((item, index) => {
    const sellerKey = item?.seller ? String(item.seller) : `missing:${index}`;
    if (!groupedBySeller.has(sellerKey)) {
      groupedBySeller.set(sellerKey, {
        seller: item?.seller || null,
        itemIndexes: [],
      });
    }

    groupedBySeller.get(sellerKey).itemIndexes.push(index);
  });

  return groupedBySeller;
}

/**
 * Validate that all items have a valid seller assigned
 * Returns: { isValid, missingSellerIndices, errorMessage }
 */
function validateItemsSellers(items = []) {
  const missingSellerIndices = [];

  (items || []).forEach((item, index) => {
    if (!item?.seller || !String(item.seller || '').trim()) {
      missingSellerIndices.push(index);
    }
  });

  if (missingSellerIndices.length === 0) {
    return {
      isValid: true,
      missingSellerIndices: [],
      errorMessage: '',
    };
  }

  return {
    isValid: false,
    missingSellerIndices,
    errorMessage: `${missingSellerIndices.length} item(s) at index ${missingSellerIndices.join(', ')} have missing or invalid seller assignment. Please remove these items and try again.`,
  };
}

/**
 * Validate that sellers exist and count total sellers
 * Returns: { isValid, totalSellers, sellerIds, errorMessage }
 */
async function validateSellersExist(items = []) {
  const sellerIds = Array.from(new Set(
    (items || [])
      .map((item) => item?.seller)
      .filter(Boolean)
      .map((id) => String(id))
  ));

  if (sellerIds.length === 0) {
    return {
      isValid: false,
      totalSellers: 0,
      sellerIds: [],
      errorMessage: 'No valid sellers found in order items.',
    };
  }

  try {
    const sellers = await User.find(
      { _id: { $in: sellerIds } },
      { _id: 1 }
    );

    if (sellers.length !== sellerIds.length) {
      const foundIds = new Set(sellers.map((s) => String(s._id)));
      const missingIds = sellerIds.filter((id) => !foundIds.has(id));
      return {
        isValid: false,
        totalSellers: sellers.length,
        sellerIds,
        errorMessage: `One or more sellers do not exist: ${missingIds.join(', ')}`,
      };
    }

    return {
      isValid: true,
      totalSellers: sellers.length,
      sellerIds,
      errorMessage: '',
    };
  } catch (err) {
    return {
      isValid: false,
      totalSellers: 0,
      sellerIds,
      errorMessage: `Failed to validate sellers: ${err?.message || 'Unknown error'}`,
    };
  }
}

/**
 * Build seller shipment skeletons with full validation
 * Returns: { shipments, isValid, errors }
 */
function buildShipmentSkeletons(items = [], orderId) {
  // First validate items have sellers
  const itemValidation = validateItemsSellers(items);
  if (!itemValidation.isValid) {
    return {
      shipments: [],
      isValid: false,
      errors: [itemValidation.errorMessage],
      failureReason: 'ITEMS_MISSING_SELLER',
    };
  }

  // Group items by seller
  const groupedBySeller = groupItemsBySeller(items);

  // Build shipment records
  const orderRefPart = String(orderId || '').slice(-8).toUpperCase() || Date.now().toString(36).toUpperCase();
  let sequence = 1;

  const shipments = Array.from(groupedBySeller.values()).map((group) => {
    const hasSeller = Boolean(group.seller);
    const status = hasSeller ? 'pending' : 'failed';

    return {
      seller: group.seller || null,
      itemIndexes: group.itemIndexes,
      localShipmentRef: `HK-${orderRefPart}-${String(sequence++).padStart(2, '0')}`,
      status,
      lastError: hasSeller ? '' : 'Missing seller mapping for one or more order items.',
      preferredCourierId: '',
      preferredCourierName: '',
      quotedShippingCost: 0,
      carrier: {},
      timeline: [
        {
          status,
          note: hasSeller
            ? 'Shipment record initialized and waiting for seller processing.'
            : 'Shipment record initialization failed because seller mapping is missing.',
          source: 'system',
          at: new Date(),
        },
      ],
    };
  });

  // Check if any shipments have failed
  const failedShipments = shipments.filter((s) => s.status === 'failed');
  if (failedShipments.length > 0) {
    const errors = failedShipments.map((s) => s.lastError);
    return {
      shipments,
      isValid: false,
      errors,
      failureReason: 'SELLER_MAPPING_FAILED',
    };
  }

  return {
    shipments,
    isValid: true,
    errors: [],
    failureReason: '',
  };
}

/**
 * Validate entire order before shipment creation
 * Performs all checks: items have sellers, sellers exist, etc.
 * Returns: { isValid, shipments, errors, warnings }
 */
async function validateOrderAndBuildShipments(items = [], orderId) {
  const errors = [];
  const warnings = [];

  // Check 1: Items have sellers
  const itemValidation = validateItemsSellers(items);
  if (!itemValidation.isValid) {
    errors.push(itemValidation.errorMessage);
    return { isValid: false, shipments: [], errors, warnings };
  }

  // Check 2: Sellers exist
  const sellerValidation = await validateSellersExist(items);
  if (!sellerValidation.isValid) {
    errors.push(sellerValidation.errorMessage);
    return { isValid: false, shipments: [], errors, warnings };
  }

  warnings.push(`Order contains items from ${sellerValidation.totalSellers} seller(s)`);

  // Build shipments
  const result = buildShipmentSkeletons(items, orderId);

  return {
    isValid: result.isValid,
    shipments: result.shipments,
    errors: [...errors, ...result.errors],
    warnings,
  };
}

/**
 * Get summary statistics about shipments
 */
function getShipmentsSummary(shipments = []) {
  const total = shipments.length;
  const successful = shipments.filter((s) => s.status !== 'failed').length;
  const failed = shipments.filter((s) => s.status === 'failed').length;
  const totalItems = shipments.reduce((sum, s) => sum + (Array.isArray(s.itemIndexes) ? s.itemIndexes.length : 0), 0);

  return {
    totalShipments: total,
    successfulShipments: successful,
    failedShipments: failed,
    totalItems,
    isReady: failed === 0,
  };
}

module.exports = {
  groupItemsBySeller,
  validateItemsSellers,
  validateSellersExist,
  buildShipmentSkeletons,
  validateOrderAndBuildShipments,
  getShipmentsSummary,
};
