const { env } = require('../config/env');

const LOGIN_PATH = '/v1/external/auth/login';
const TOKEN_VALIDITY_FALLBACK_MS = 10 * 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 20000;

const tokenState = {
  value: null,
  expiresAtMs: 0,
  refreshedAtMs: 0,
};

function isShiprocketEnabled() {
  return Boolean(env.shiprocket.enabled);
}

function assertShiprocketEnabled() {
  if (!isShiprocketEnabled()) {
    throw new Error('[Shiprocket] Integration is disabled. Set SHIPROCKET_ENABLED=true to use Shiprocket APIs.');
  }
}

function normalizeBase64Url(segment) {
  const normalized = String(segment || '').replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  return normalized + '='.repeat(padLength);
}

function decodeJwtExpiryMs(jwtToken) {
  try {
    const parts = String(jwtToken || '').split('.');
    if (parts.length < 2) return null;

    const payloadRaw = Buffer.from(normalizeBase64Url(parts[1]), 'base64').toString('utf8');
    const payload = JSON.parse(payloadRaw);
    if (!payload || typeof payload.exp !== 'number') return null;

    return payload.exp * 1000;
  } catch {
    return null;
  }
}

function buildUrl(path, query) {
  const cleanPath = String(path || '');
  const endpoint = cleanPath.startsWith('http')
    ? cleanPath
    : `${env.shiprocket.baseUrl}${cleanPath.startsWith('/') ? '' : '/'}${cleanPath}`;

  const url = new URL(endpoint);

  if (query && typeof query === 'object') {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;

      if (Array.isArray(value)) {
        value.forEach((entry) => {
          if (entry !== undefined && entry !== null && entry !== '') {
            url.searchParams.append(key, String(entry));
          }
        });
      } else {
        url.searchParams.set(key, String(value));
      }
    });
  }

  return url.toString();
}

async function parseResponseBody(response) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const rawText = await response.text().catch(() => '');

  if (!rawText) return null;

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(rawText);
    } catch {
      return rawText;
    }
  }

  try {
    return JSON.parse(rawText);
  } catch {
    return rawText;
  }
}

function createHttpError({ status, method, url, body }) {
  let message = `[Shiprocket] ${method} ${url} failed with status ${status}`;

  if (body && typeof body === 'object' && body.message) {
    message = `${message}: ${body.message}`;
  } else if (typeof body === 'string' && body.trim()) {
    message = `${message}: ${body}`;
  }

  const error = new Error(message);
  error.status = status;
  error.url = url;
  error.method = method;
  error.responseBody = body;
  return error;
}

function isTokenExpiringSoon() {
  if (!tokenState.value || !tokenState.expiresAtMs) {
    return true;
  }

  const refreshBufferMs = Number(env.shiprocket.tokenRefreshBufferMs || 0);
  return Date.now() >= tokenState.expiresAtMs - refreshBufferMs;
}

async function fetchShiprocketAuthToken() {
  const url = buildUrl(LOGIN_PATH);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: env.shiprocket.email,
      password: env.shiprocket.password,
    }),
  });

  const body = await parseResponseBody(response);

  if (!response.ok) {
    const error = createHttpError({
      status: response.status,
      method: 'POST',
      url,
      body,
    });
    error.code = 'SHIPROCKET_AUTH_FAILED';
    throw error;
  }

  const token = body && typeof body.token === 'string' ? body.token : '';
  if (!token) {
    throw new Error('[Shiprocket] Auth succeeded but token is missing in response.');
  }

  const now = Date.now();
  const jwtExpiryMs = decodeJwtExpiryMs(token);
  tokenState.value = token;
  tokenState.refreshedAtMs = now;
  tokenState.expiresAtMs = jwtExpiryMs || now + TOKEN_VALIDITY_FALLBACK_MS;

  return tokenState.value;
}

async function getShiprocketToken({ forceRefresh = false } = {}) {
  assertShiprocketEnabled();

  if (!forceRefresh && !isTokenExpiringSoon()) {
    return tokenState.value;
  }

  return fetchShiprocketAuthToken();
}

async function executeRequest({ path, method = 'GET', query, body, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const token = await getShiprocketToken();
  const url = buildUrl(path, query);
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const responseBody = await parseResponseBody(response);
    return {
      response,
      responseBody,
      url,
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function shiprocketRequest(path, options = {}) {
  assertShiprocketEnabled();

  const requestOptions = {
    method: 'GET',
    retryOnUnauthorized: true,
    ...options,
    path,
  };

  let result = await executeRequest(requestOptions);

  if (result.response.status === 401 && requestOptions.retryOnUnauthorized) {
    await getShiprocketToken({ forceRefresh: true });
    result = await executeRequest({
      ...requestOptions,
      retryOnUnauthorized: false,
    });
  }

  if (!result.response.ok) {
    throw createHttpError({
      status: result.response.status,
      method: requestOptions.method,
      url: result.url,
      body: result.responseBody,
    });
  }

  return result.responseBody;
}

function clearShiprocketTokenCache() {
  tokenState.value = null;
  tokenState.expiresAtMs = 0;
  tokenState.refreshedAtMs = 0;
}

module.exports = {
  isShiprocketEnabled,
  getShiprocketToken,
  shiprocketRequest,
  clearShiprocketTokenCache,
};
