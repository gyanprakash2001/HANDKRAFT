/**
 * Shipping Quote Service (Phase 3)
 * 
 * Integrates Phase 1 (seller validation) and Phase 2 (shipment grouping)
 * to calculate shipping quotes from NimbusPost for multi-seller orders.
 * 
 * Flow:
 * 1. Validate all sellers have complete pickup addresses (Phase 1)
 * 2. Group items by seller and build shipment skeletons (Phase 2)
 * 3. Call NimbusPost API for each shipment to get shipping quotes
 * 4. Aggregate and return total shipping cost + delivery estimates
 */

const mongoose = require('mongoose');
const User = require('../models/User');
const {
  getCourierServiceabilityQuote,
  isNimbuspostEnabled,
} = require('./nimbuspost');
const {
  validateOrderSellers,
  isSellerReadyForShipping,
} = require('./shipment-validation');
const {
  buildShipmentSkeletons,
  validateOrderAndBuildShipments,
  validateItemsSellers,
  validateSellersExist,
} = require('./shipment-grouping');

/**
 * Get unique seller IDs from order items
 * @param {Array} items - Order items with seller field
 * @returns {Array} Array of unique seller IDs
 */
function getUniqueSellersFromItems(items = []) {
  const sellerSet = new Set();
  for (const item of items) {
    const sellerId = item?.seller;
    if (sellerId && mongoose.Types.ObjectId.isValid(String(sellerId))) {
      sellerSet.add(String(sellerId));
    }
  }
  return Array.from(sellerSet);
}

/**
 * Validate all sellers have complete pickup addresses before shipping quote
 * @param {Array} items - Order items with seller field
 * @returns {Promise<{isReady: boolean, unreadySellers: Array, message: string}>}
 */
async function validateSellersForShipping(items = []) {
  try {
    const sellerIds = getUniqueSellersFromItems(items);
    
    if (sellerIds.length === 0) {
      return {
        isReady: false,
        unreadySellers: [],
        message: 'No sellers found in order items',
      };
    }

    // Use Phase 1 validation to check seller pickup addresses
    const { allReady, unreadySellers, message } = await validateOrderSellers(sellerIds);

    return {
      isReady: allReady,
      unreadySellers,
      message,
    };
  } catch (err) {
    return {
      isReady: false,
      unreadySellers: [],
      message: `Seller validation error: ${err?.message || 'Unknown error'}`,
    };
  }
}

/**
 * Calculate shipping quotes for multi-seller order
 * 
 * Integrates:
 * - Phase 1: Validates all sellers have complete pickup addresses
 * - Phase 2: Groups items by seller and creates shipment skeletons
 * - NimbusPost API: Gets shipping quotes for each shipment
 * 
 * @param {Object} options
 * @param {Array} options.items - Cart/order items with seller, quantity, price, etc.
 * @param {Object} options.shippingAddress - Buyer's delivery address with postalCode
 * @param {Map} options.preferredCouriers - Optional: map of shipment ref -> courier ID
 * @returns {Promise<{success: boolean, shippingCost: number, details: Array, message?: string}>}
 */
async function calculateShippingQuotes({ items = [], shippingAddress = {}, preferredCouriers = null }) {
  try {
    if (!isNimbuspostEnabled()) {
      return {
        success: false,
        shippingCost: 0,
        details: [],
        message: 'Shipping quotes are unavailable (NimbusPost disabled)',
      };
    }

    // Validate destination pincode
    if (!shippingAddress?.postalCode) {
      return {
        success: false,
        shippingCost: 0,
        details: [],
        message: 'Destination pincode is required',
      };
    }

    if (items.length === 0) {
      return {
        success: false,
        shippingCost: 0,
        details: [],
        message: 'No items to ship',
      };
    }

    // PHASE 1: Validate sellers have complete pickup addresses
    const sellerValidation = await validateSellersForShipping(items);
    if (!sellerValidation.isReady) {
      return {
        success: false,
        shippingCost: 0,
        details: [],
        message: sellerValidation.message,
        unreadySellers: sellerValidation.unreadySellers,
      };
    }

    // PHASE 2: Validate items and build shipment skeletons
    const itemValidation = validateItemsSellers(items);
    if (!itemValidation.isValid) {
      return {
        success: false,
        shippingCost: 0,
        details: [],
        message: `Items validation failed: ${itemValidation.message || 'Unknown error'}`,
      };
    }

    const sellerExistenceCheck = await validateSellersExist(items);
    if (!sellerExistenceCheck.isValid) {
      return {
        success: false,
        shippingCost: 0,
        details: [],
        message: `Seller validation failed: ${sellerExistenceCheck.message || 'Unknown error'}`,
      };
    }

    // Build shipment skeletons for multi-seller order
    const shipments = buildShipmentSkeletons(items, 'QUOTE_ESTIMATE');
    if (!shipments?.length) {
      return {
        success: false,
        shippingCost: 0,
        details: [],
        message: 'Failed to build shipments from items',
      };
    }

    // NimbusPost API: Get quotes for each shipment
    const quoteDetails = await getShippingQuotesFromNimbus({
      items,
      shipments,
      shippingAddress,
      preferredCouriers: preferredCouriers || new Map(),
    });

    // Aggregate total shipping cost
    const totalShipping = quoteDetails.reduce((sum, detail) => {
      return sum + (detail.selectedTotalCharges || 0);
    }, 0);

    return {
      success: true,
      shippingCost: totalShipping,
      details: quoteDetails,
      message: `Calculated shipping for ${shipments.length} seller(s)`,
    };
  } catch (err) {
    console.error('[SHIPPING_QUOTES] Error in calculateShippingQuotes:', err?.message || err);
    return {
      success: false,
      shippingCost: 0,
      details: [],
      message: `Failed to calculate shipping quotes: ${err?.message || 'Unknown error'}`,
    };
  }
}

/**
 * Get shipping quotes from NimbusPost API for each shipment
 * @private
 * @param {Object} options
 * @param {Array} options.items - Order items
 * @param {Array} options.shipments - Shipment skeletons with seller and itemIndexes
 * @param {Object} options.shippingAddress - Buyer's address
 * @param {Map} options.preferredCouriers - Preferred courier per shipment
 * @returns {Promise<Array>} Array of quote details per shipment
 */
async function getShippingQuotesFromNimbus({
  items = [],
  shipments = [],
  shippingAddress = {},
  preferredCouriers = new Map(),
}) {
  const destination = String(shippingAddress?.postalCode || '').trim();
  
  const sellerIds = Array.from(new Set(
    shipments
      .map((s) => String(s?.seller || '').trim())
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
  ));

  const sellers = sellerIds.length > 0
    ? await User.find({ _id: { $in: sellerIds } })
      .select('name sellerDisplayName sellerPickupAddress')
      .lean()
    : [];
  
  const sellerMap = new Map(sellers.map((s) => [String(s._id), s]));

  const quoteDetails = [];

  for (const shipment of shipments) {
    const itemIndexes = Array.isArray(shipment?.itemIndexes)
      ? shipment.itemIndexes.filter((i) => Number.isInteger(i) && i >= 0)
      : [];

    if (itemIndexes.length === 0) {
      continue;
    }

    const shipmentItems = itemIndexes
      .map((idx) => items[idx])
      .filter(Boolean);

    if (shipmentItems.length === 0) {
      continue;
    }

    const seller = sellerMap.get(String(shipment?.seller || '')) || null;
    const origin = seller?.sellerPickupAddress?.postalCode
      ? String(seller.sellerPickupAddress.postalCode).trim()
      : null;

    if (!origin) {
      const sellerName = String(seller?.sellerDisplayName || seller?.name || 'Unknown');
      throw new Error(`Seller ${sellerName} has incomplete pickup address`);
    }

    // Calculate weight for this shipment
    const weight = estimateShipmentWeightGrams(shipmentItems);

    // Get shipping options from NimbusPost
    try {
      const quote = await getCourierServiceabilityQuote({
        origin,
        destination,
        paymentType: 'prepaid',
        weight,
      });

      // Get COD options if available
      let codOptionsByShipment = new Map();
      try {
        const codQuote = await getCourierServiceabilityQuote({
          origin,
          destination,
          paymentType: 'cod',
          weight,
        });
        if (codQuote?.quotes) {
          codOptionsByShipment = new Map(
            codQuote.quotes.map((q) => [String(q.courier_id || ''), q])
          );
        }
      } catch (codErr) {
        console.warn(`[SHIPPING_QUOTES] COD probe failed: ${origin}->${destination}`, codErr?.message);
      }

      // Normalize and filter options
      const options = (quote?.quotes || [])
        .map((q) => normalizeNimbusQuoteOption(q))
        .map((normalized) => {
          const codOption = codOptionsByShipment.get(String(normalized.courierId || '')) || null;
          return {
            ...normalized,
            codAvailable: Boolean(codOption),
            codCharges: codOption ? Number(codOption.cod_charges || 0) : null,
          };
        })
        .filter((o) => o.totalCharges > 0);

      if (options.length === 0) {
        throw new Error(`No courier options available for shipment ${shipment.localShipmentRef}`);
      }

      // Select best option based on preference or default
      const selectedOption = getSelectedQuoteOption(options, preferredCouriers, shipment);

      quoteDetails.push({
        sellerId: String(shipment?.seller || ''),
        shipmentRef: String(shipment?.localShipmentRef || ''),
        origin,
        destination,
        weight,
        options,
        selectedCourierId: String(selectedOption.courierId || ''),
        selectedCourierName: String(selectedOption.courierName || ''),
        selectedTotalCharges: selectedOption.totalCharges || 0,
        selectedEtd: String(selectedOption.etd || ''),
        selectedCodAvailable: Boolean(selectedOption?.codAvailable),
      });
    } catch (quoteErr) {
      console.error(`[SHIPPING_QUOTES] Quote failed for shipment ${shipment.localShipmentRef}:`, quoteErr?.message);
      throw quoteErr;
    }
  }

  if (quoteDetails.length === 0) {
    throw new Error('No quotable shipments found');
  }

  return quoteDetails;
}

/**
 * Normalize NimbusPost quote option to standard format
 * @private
 */
function normalizeNimbusQuoteOption(raw = {}) {
  return {
    courierId: String(raw?.courier_id || raw?.courierId || '').trim(),
    courierName: String(raw?.courier_name || raw?.courierName || '').trim(),
    totalCharges: Number(raw?.total_charges ?? raw?.totalCharges ?? 0),
    etd: String(raw?.etd || '').trim(),
    codCharges: Number(raw?.cod_charges ?? raw?.codCharges ?? 0),
  };
}

/**
 * Get selected quote option based on preference or default to first
 * @private
 */
function getSelectedQuoteOption(options = [], preferredCouriers = new Map(), shipment = {}) {
  const preferredId = preferredCouriers.get(String(shipment?.localShipmentRef || ''));
  
  if (preferredId) {
    const preferred = options.find((o) => String(o.courierId || '') === preferredId);
    if (preferred) {
      return preferred;
    }
  }

  return options[0] || {};
}

/**
 * Estimate weight of shipment in grams
 * @private
 */
function estimateShipmentWeightGrams(items = []) {
  return items.reduce((total, item) => {
    return total + (Number(item?.packageWeightGrams) || 500);
  }, 0);
}

module.exports = {
  calculateShippingQuotes,
  validateSellersForShipping,
  getUniqueSellersFromItems,
};
