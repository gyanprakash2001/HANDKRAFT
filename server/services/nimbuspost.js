const { env } = require('../config/env');

const TOKEN_VALIDITY_FALLBACK_MS = 90 * 60 * 1000;
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;
const RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
]);

const tokenState = {
  value: '',
  expiresAtMs: 0,
};

function isNimbuspostEnabled() {
  return Boolean(env.nimbuspost?.enabled);
}

function getNimbuspostMode() {
  const configuredMode = String(env.nimbuspost?.mode || 'auto').toLowerCase();
  if (configuredMode === 'v1' || configuredMode === 'v2') {
    return configuredMode;
  }

  return env.nimbuspost?.apiKey ? 'v1' : 'v2';
}

function getV1BaseUrl() {
  return String(env.nimbuspost?.v1BaseUrl || 'https://ship.nimbuspost.com/api').replace(/\/+$/, '');
}

function getV2BaseUrl() {
  return String(env.nimbuspost?.v2BaseUrl || 'https://api.nimbuspost.com/v1').replace(/\/+$/, '');
}

function parseJsonSafely(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractNimbusErrorMessage(body, fallbackMessage) {
  if (body && typeof body === 'object') {
    if (typeof body.message === 'string' && body.message.trim()) {
      return body.message.trim();
    }

    if (Array.isArray(body.errors) && body.errors.length > 0) {
      return String(body.errors[0] || fallbackMessage);
    }
  }

  if (typeof body === 'string' && body.trim()) {
    return body.trim();
  }

  return fallbackMessage;
}

function assertNimbusResponseSuccess(body, contextLabel) {
  if (body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'status') && body.status === false) {
    const message = extractNimbusErrorMessage(body, `${contextLabel} failed.`);
    throw new Error(`[NimbusPost] ${contextLabel}: ${message}`);
  }
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryNimbusStatus(statusCode) {
  return RETRYABLE_HTTP_STATUSES.has(Number(statusCode || 0));
}

function shouldRetryNimbusNetworkError(error) {
  if (!error) {
    return false;
  }

  if (String(error?.name || '') === 'AbortError') {
    return true;
  }

  const message = String(error?.message || '').toLowerCase();
  if (
    message.includes('fetch failed')
    || message.includes('network error')
    || message.includes('timed out')
    || message.includes('socket hang up')
  ) {
    return true;
  }

  const errorCode = String(error?.cause?.code || error?.code || '').toUpperCase();
  return RETRYABLE_NETWORK_CODES.has(errorCode);
}

async function requestJson({ baseUrl, path, method = 'GET', headers = {}, body }) {
  const timeoutMs = Number(env.nimbuspost?.timeoutMs || 25000);
  const retryCount = Math.max(0, Math.round(Number(env.nimbuspost?.retryCount ?? 2)));
  const normalizedPath = String(path || '').replace(/^\/+/, '');
  const url = `${String(baseUrl || '').replace(/\/+$/, '')}/${normalizedPath}`;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      const rawText = await response.text().catch(() => '');
      const parsedBody = parseJsonSafely(rawText);

      if (!response.ok) {
        if (attempt < retryCount && shouldRetryNimbusStatus(response.status)) {
          await sleepMs(300 * (attempt + 1));
          continue;
        }

        const fallbackMessage = `${method} ${url} failed with status ${response.status}`;
        const message = extractNimbusErrorMessage(parsedBody, fallbackMessage);
        const err = new Error(`[NimbusPost] ${message}`);
        err.status = response.status;
        throw err;
      }

      return parsedBody;
    } catch (error) {
      const retryable = shouldRetryNimbusNetworkError(error)
        || shouldRetryNimbusStatus(error?.status);

      if (attempt < retryCount && retryable) {
        await sleepMs(300 * (attempt + 1));
        continue;
      }

      if (error instanceof Error && String(error.message || '').startsWith('[NimbusPost]')) {
        throw error;
      }

      const fallbackMessage = String(error?.message || 'fetch failed');
      const wrapped = new Error(`[NimbusPost] Network error while calling ${method} ${normalizedPath}: ${fallbackMessage}`);
      wrapped.cause = error;
      throw wrapped;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  throw new Error(`[NimbusPost] ${method} ${normalizedPath} failed after retries.`);
}

function normalizeBase64Url(segment) {
  const normalized = String(segment || '').replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  return normalized + '='.repeat(padLength);
}

function decodeJwtExpiryMs(jwtToken) {
  try {
    const parts = String(jwtToken || '').split('.');
    if (parts.length < 2) {
      return null;
    }

    const payloadRaw = Buffer.from(normalizeBase64Url(parts[1]), 'base64').toString('utf8');
    const payload = JSON.parse(payloadRaw);

    if (!payload || typeof payload.exp !== 'number') {
      return null;
    }

    return payload.exp * 1000;
  } catch {
    return null;
  }
}

function isV2TokenExpiringSoon() {
  if (!tokenState.value || !tokenState.expiresAtMs) {
    return true;
  }

  return Date.now() >= tokenState.expiresAtMs - TOKEN_REFRESH_BUFFER_MS;
}

async function getV2AccessToken({ forceRefresh = false } = {}) {
  if (!forceRefresh && !isV2TokenExpiringSoon()) {
    return tokenState.value;
  }

  const email = String(env.nimbuspost?.apiEmail || '').trim();
  const password = String(env.nimbuspost?.apiPassword || '').trim();

  if (!email || !password) {
    throw new Error('[NimbusPost] Missing V2 credentials. Set NIMBUSPOST_API_EMAIL and NIMBUSPOST_API_PASSWORD.');
  }

  const responseBody = await requestJson({
    baseUrl: getV2BaseUrl(),
    path: 'users/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: {
      email,
      password,
    },
  });

  assertNimbusResponseSuccess(responseBody, 'V2 login');

  const token = responseBody && typeof responseBody.data === 'string' ? responseBody.data : '';
  if (!token) {
    throw new Error('[NimbusPost] V2 login succeeded but token is missing in response.');
  }

  tokenState.value = token;
  tokenState.expiresAtMs = decodeJwtExpiryMs(token) || Date.now() + TOKEN_VALIDITY_FALLBACK_MS;

  return tokenState.value;
}

function hasCompletePickupAddress(pickup = {}) {
  return Boolean(
    String(pickup?.warehouseName || '').trim()
    && String(pickup?.name || '').trim()
    && String(pickup?.address1 || '').trim()
    && String(pickup?.city || '').trim()
    && String(pickup?.state || '').trim()
    && String(pickup?.pincode || '').trim()
    && String(pickup?.phone || '').trim()
  );
}

function assertNimbuspostReady(mode, options = {}) {
  const {
    pickupOverride = null,
    requirePickupAddress = true,
  } = options;

  if (!isNimbuspostEnabled()) {
    throw new Error('[NimbusPost] Integration is disabled. Set NIMBUSPOST_ENABLED=true.');
  }

  if (mode === 'v1') {
    if (!String(env.nimbuspost?.apiKey || '').trim()) {
      throw new Error('[NimbusPost] Missing NIMBUSPOST_API_KEY for V1 mode.');
    }

    if (!String(env.nimbuspost?.warehouseId || '').trim()) {
      throw new Error('[NimbusPost] Missing NIMBUSPOST_WAREHOUSE_ID for V1 mode.');
    }

    return;
  }

  const missingFields = [];
  if (!String(env.nimbuspost?.apiEmail || '').trim()) {
    missingFields.push('NIMBUSPOST_API_EMAIL');
  }
  if (!String(env.nimbuspost?.apiPassword || '').trim()) {
    missingFields.push('NIMBUSPOST_API_PASSWORD');
  }

  if (requirePickupAddress) {
    const overrideHasAll = hasCompletePickupAddress(pickupOverride || {});

    if (!overrideHasAll) {
      missingFields.push('SELLER_PICKUP_ADDRESS_OVERRIDE');
    }
  }

  if (missingFields.length > 0) {
    throw new Error(`[NimbusPost] Missing V2 config: ${missingFields.join(', ')}.`);
  }
}

function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizePhoneNumber(value) {
  const digits = normalizeDigits(value);
  if (!digits) {
    return '';
  }

  if (digits.length <= 10) {
    return digits;
  }

  return digits.slice(-10);
}

function normalizePincode(value) {
  const digits = normalizeDigits(value);
  if (!digits) {
    return '';
  }

  return digits.slice(0, 6);
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatAmount(value, fallback = 0) {
  const amount = toNumber(value, fallback);
  return Number(amount.toFixed(2));
}

function buildOrderItemsPayload(items = []) {
  return (items || []).map((item, index) => {
    const resolvedProductId = item?.product?._id ? String(item.product._id) : String(item?.product || '');
    const qty = Math.max(1, Math.round(toNumber(item?.quantity, 1)));

    return {
      name: String(item?.title || `Item ${index + 1}`).slice(0, 200),
      qty: String(qty),
      price: String(formatAmount(item?.price, 0)),
      sku: String(item?.sku || resolvedProductId || `SKU-${index + 1}`).slice(0, 50),
    };
  });
}

function buildPackageWeight(items = []) {
  const defaultWeight = Math.max(1, Math.round(toNumber(env.nimbuspost?.packageWeightGrams, 500)));
  const perItemWeight = Math.max(0, Math.round(toNumber(env.nimbuspost?.weightPerItemGrams, 0)));

  let calculated = 0;

  (items || []).forEach((item) => {
    const qty = Math.max(1, Math.round(toNumber(item?.quantity, 1)));
    const itemWeight = Math.max(0, Math.round(toNumber(item?.packageWeightGrams, 0)));

    if (itemWeight > 0) {
      calculated += itemWeight * qty;
      return;
    }

    if (perItemWeight > 0) {
      calculated += perItemWeight * qty;
    }
  });

  return calculated > 0 ? Math.max(1, Math.round(calculated)) : defaultWeight;
}

function buildPackageDimensions(items = []) {
  const defaultLengthCm = Math.max(1, Math.round(toNumber(env.nimbuspost?.packageLengthCm, 10)));
  const defaultBreadthCm = Math.max(1, Math.round(toNumber(env.nimbuspost?.packageBreadthCm, 10)));
  const defaultHeightCm = Math.max(1, Math.round(toNumber(env.nimbuspost?.packageHeightCm, 10)));

  let maxLengthCm = 0;
  let maxBreadthCm = 0;
  let maxHeightCm = 0;

  (items || []).forEach((item) => {
    maxLengthCm = Math.max(maxLengthCm, Math.round(toNumber(item?.packageLengthCm, 0)));
    maxBreadthCm = Math.max(maxBreadthCm, Math.round(toNumber(item?.packageBreadthCm, 0)));
    maxHeightCm = Math.max(maxHeightCm, Math.round(toNumber(item?.packageHeightCm, 0)));
  });

  return {
    packageLengthCm: maxLengthCm > 0 ? maxLengthCm : defaultLengthCm,
    packageBreadthCm: maxBreadthCm > 0 ? maxBreadthCm : defaultBreadthCm,
    packageHeightCm: maxHeightCm > 0 ? maxHeightCm : defaultHeightCm,
  };
}

function buildConsigneePayload(shippingAddress = {}) {
  return {
    name: String(shippingAddress.fullName || 'Customer').slice(0, 200),
    address: String(shippingAddress.street || '').slice(0, 200),
    address_2: '',
    city: String(shippingAddress.city || '').slice(0, 40),
    state: String(shippingAddress.state || '').slice(0, 40),
    pincode: normalizePincode(shippingAddress.postalCode),
    phone: normalizePhoneNumber(shippingAddress.phoneNumber),
  };
}

function buildV1CreateShipmentPayload(input) {
  const packageWeight = buildPackageWeight(input.items);
  const { packageLengthCm, packageBreadthCm, packageHeightCm } = buildPackageDimensions(input.items);

  const payload = {
    consignee: buildConsigneePayload(input.shippingAddress),
    order: {
      order_number: String(input.localShipmentRef || ''),
      shipping_charges: formatAmount(input.shippingCharges, 0),
      discount: formatAmount(input.discount, 0),
      cod_charges: formatAmount(input.codCharges, 0),
      payment_type: String(input.paymentType || 'prepaid').toLowerCase(),
      total: formatAmount(input.orderAmount, 0),
      package_weight: packageWeight,
      package_length: packageLengthCm,
      package_height: packageHeightCm,
      package_breadth: packageBreadthCm,
    },
    order_items: buildOrderItemsPayload(input.items),
    pickup_warehouse_id: Number(env.nimbuspost.warehouseId),
  };

  if (String(env.nimbuspost.rtoWarehouseId || '').trim()) {
    payload.rto_warehouse_id = Number(env.nimbuspost.rtoWarehouseId);
  }

  if (String(input?.courierId || '').trim()) {
    payload.courier_id = String(input.courierId).trim();
  } else if (String(env.nimbuspost.defaultCourierId || '').trim()) {
    payload.courier_id = String(env.nimbuspost.defaultCourierId).trim();
  }

  return payload;
}

function buildV2CreateShipmentPayload(input) {
  const packageWeight = buildPackageWeight(input.items);
  const { packageLengthCm, packageBreadthCm, packageHeightCm } = buildPackageDimensions(input.items);

  const pickup = hasCompletePickupAddress(input?.pickupAddress) ? input.pickupAddress : null;
  if (!pickup) {
    throw new Error('[NimbusPost] Seller pickup address is required for shipment booking.');
  }

  const payload = {
    order_number: String(input.localShipmentRef || ''),
    shipping_charges: formatAmount(input.shippingCharges, 0),
    discount: formatAmount(input.discount, 0),
    cod_charges: formatAmount(input.codCharges, 0),
    payment_type: String(input.paymentType || 'prepaid').toLowerCase(),
    order_amount: formatAmount(input.orderAmount, 0),
    package_weight: packageWeight,
    package_length: packageLengthCm,
    package_breadth: packageBreadthCm,
    package_height: packageHeightCm,
    request_auto_pickup: env.nimbuspost.requestAutoPickup ? 'yes' : 'no',
    consignee: buildConsigneePayload(input.shippingAddress),
    pickup: {
      warehouse_name: String(pickup.warehouseName || '').slice(0, 20),
      name: String(pickup.name || '').slice(0, 200),
      address: String(pickup.address1 || '').slice(0, 200),
      address_2: String(pickup.address2 || '').slice(0, 200),
      city: String(pickup.city || '').slice(0, 40),
      state: String(pickup.state || '').slice(0, 40),
      pincode: normalizePincode(pickup.pincode),
      phone: normalizePhoneNumber(pickup.phone),
    },
    order_items: buildOrderItemsPayload(input.items),
    is_insurance: env.nimbuspost.isInsurance ? '1' : '0',
  };

  if (String(input?.courierId || '').trim()) {
    payload.courier_id = String(input.courierId).trim();
  } else if (String(env.nimbuspost.defaultCourierId || '').trim()) {
    payload.courier_id = String(env.nimbuspost.defaultCourierId).trim();
  }

  if (String(env.nimbuspost.tags || '').trim()) {
    payload.tags = String(env.nimbuspost.tags).trim();
  }

  return payload;
}

async function getCourierServiceabilityQuote(input = {}) {
  const mode = getNimbuspostMode();
  if (mode !== 'v2') {
    throw new Error('[NimbusPost] Courier serviceability quotes are currently supported only in V2 mode.');
  }

  assertNimbuspostReady(mode, { requirePickupAddress: false });

  const origin = normalizePincode(input.origin || input.pickupPincode || '');
  const destination = normalizePincode(input.destination || input.deliveryPincode || '');
  const paymentType = String(input.paymentType || 'prepaid').trim().toLowerCase() === 'cod' ? 'cod' : 'prepaid';
  const weight = Math.max(1, Math.round(toNumber(input.weight, 500)));

  if (!origin || !destination) {
    throw new Error('[NimbusPost] origin and destination pincodes are required for serviceability quote.');
  }

  const token = await getV2AccessToken();
  const responseBody = await requestJson({
    baseUrl: getV2BaseUrl(),
    path: 'courier/serviceability',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: {
      origin,
      destination,
      payment_type: paymentType,
      weight,
    },
  });

  assertNimbusResponseSuccess(responseBody, 'Courier serviceability quote (v2)');

  const rawQuotes = Array.isArray(responseBody?.data) ? responseBody.data : [];
  const quotes = rawQuotes
    .map((entry) => {
      const totalCharges = toNumber(entry?.total_charges, NaN);
      const freightCharges = toNumber(entry?.freight_charges, NaN);
      const codCharges = toNumber(entry?.cod_charges, NaN);

      if (!Number.isFinite(totalCharges)) {
        return null;
      }

      return {
        courierId: String(entry?.id || entry?.courier_id || ''),
        courierName: String(entry?.name || entry?.courier_name || ''),
        totalCharges,
        freightCharges: Number.isFinite(freightCharges) ? freightCharges : 0,
        codCharges: Number.isFinite(codCharges) ? codCharges : 0,
        etd: String(entry?.edd || entry?.etd || ''),
        chargeableWeight: toNumber(entry?.chargeable_weight, weight),
        raw: entry,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.totalCharges - b.totalCharges);

  return {
    mode,
    origin,
    destination,
    paymentType,
    weight,
    cheapestQuote: quotes[0] || null,
    quotes,
    raw: responseBody,
  };
}

function normalizeCreateShipmentResult(responseBody, mode) {
  const data = responseBody && typeof responseBody.data === 'object' ? responseBody.data : {};

  return {
    mode,
    remoteStatus: String(data.status || ''),
    orderId: data.order_id !== undefined && data.order_id !== null ? String(data.order_id) : '',
    shipmentId: data.shipment_id !== undefined && data.shipment_id !== null ? String(data.shipment_id) : '',
    awbNumber: data.awb_number !== undefined && data.awb_number !== null ? String(data.awb_number) : '',
    courierId: data.courier_id !== undefined && data.courier_id !== null ? String(data.courier_id) : '',
    courierName: data.courier_name ? String(data.courier_name) : '',
    labelUrl: data.label ? String(data.label) : '',
    manifestUrl: data.manifest ? String(data.manifest) : '',
    paymentType: data.payment_type ? String(data.payment_type) : '',
    additionalInfo: data.additional_info ? String(data.additional_info) : '',
    raw: responseBody,
  };
}

async function createShipment(input = {}) {
  const mode = getNimbuspostMode();
  assertNimbuspostReady(mode, {
    pickupOverride: input?.pickupAddress || null,
    requirePickupAddress: true,
  });

  if (!String(input.localShipmentRef || '').trim()) {
    throw new Error('[NimbusPost] localShipmentRef is required for shipment creation.');
  }

  if (!input.shippingAddress || typeof input.shippingAddress !== 'object') {
    throw new Error('[NimbusPost] shippingAddress is required for shipment creation.');
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error('[NimbusPost] items[] is required for shipment creation.');
  }

  if (mode === 'v1') {
    const body = buildV1CreateShipmentPayload(input);
    const responseBody = await requestJson({
      baseUrl: getV1BaseUrl(),
      path: 'shipments/create',
      method: 'POST',
      headers: {
        'NP-API-KEY': String(env.nimbuspost.apiKey || '').trim(),
        'Content-Type': 'application/json',
      },
      body,
    });

    assertNimbusResponseSuccess(responseBody, 'Create shipment (v1)');
    return normalizeCreateShipmentResult(responseBody, mode);
  }

  const token = await getV2AccessToken();
  const body = buildV2CreateShipmentPayload(input);

  const responseBody = await requestJson({
    baseUrl: getV2BaseUrl(),
    path: 'shipments',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body,
  });

  assertNimbusResponseSuccess(responseBody, 'Create shipment (v2)');
  return normalizeCreateShipmentResult(responseBody, mode);
}

async function trackShipmentByAwb(awbNumber) {
  const awb = String(awbNumber || '').trim();
  if (!awb) {
    throw new Error('[NimbusPost] AWB number is required for tracking.');
  }

  const mode = getNimbuspostMode();
  assertNimbuspostReady(mode, { requirePickupAddress: false });

  if (mode === 'v1') {
    const responseBody = await requestJson({
      baseUrl: getV1BaseUrl(),
      path: `shipments/track_awb/${encodeURIComponent(awb)}`,
      method: 'GET',
      headers: {
        'NP-API-KEY': String(env.nimbuspost.apiKey || '').trim(),
      },
    });

    assertNimbusResponseSuccess(responseBody, 'Track shipment (v1)');

    const data = responseBody && typeof responseBody.data === 'object' ? responseBody.data : {};
    return {
      mode,
      awbNumber: String(data.awb_number || awb),
      remoteStatus: String(data.status || ''),
      history: Array.isArray(data.history) ? data.history : [],
      raw: responseBody,
    };
  }

  const token = await getV2AccessToken();
  const responseBody = await requestJson({
    baseUrl: getV2BaseUrl(),
    path: `shipments/track/${encodeURIComponent(awb)}`,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  assertNimbusResponseSuccess(responseBody, 'Track shipment (v2)');

  const data = responseBody && typeof responseBody.data === 'object' ? responseBody.data : {};
  return {
    mode,
    awbNumber: String(data.awb_number || awb),
    remoteStatus: String(data.status || ''),
    history: Array.isArray(data.history) ? data.history : [],
    raw: responseBody,
  };
}

/**
 * Raw request helper for debug/dry-run usage.
 * - path: relative Nimbus path (no leading slash)
 * - method: HTTP method
 * - headers: optional headers
 * - body: optional body
 * - bypassEnabled: when true, skip `NIMBUSPOST_ENABLED` check so we can test credentials
 */
async function rawRequest({ path = '', method = 'GET', headers = {}, body, bypassEnabled = false } = {}) {
  const mode = getNimbuspostMode();

  if (!bypassEnabled) {
    assertNimbuspostReady(mode, { requirePickupAddress: false });
  }

  const normalizedPath = String(path || '').replace(/^\/+/, '');

  if (mode === 'v1') {
    const mergedHeaders = Object.assign({}, headers, {
      'NP-API-KEY': String(env.nimbuspost.apiKey || '').trim(),
      'Content-Type': 'application/json',
    });

    return await requestJson({ baseUrl: getV1BaseUrl(), path: normalizedPath, method, headers: mergedHeaders, body });
  }

  const token = await getV2AccessToken({ forceRefresh: false });
  const mergedHeaders = Object.assign({}, headers, {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  });

  return await requestJson({ baseUrl: getV2BaseUrl(), path: normalizedPath, method, headers: mergedHeaders, body });
}

module.exports = {
  isNimbuspostEnabled,
  getNimbuspostMode,
  getCourierServiceabilityQuote,
  createShipment,
  trackShipmentByAwb,
  rawRequest,
};
