const DEFAULT_API_BASE_URL = 'http://localhost:5000/api';

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

export const API_BASE_URL = trimTrailingSlash(
  import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL,
);

function buildApiUrl(path, query = {}) {
  const normalizedPath = String(path || '').startsWith('/') ? path : `/${path || ''}`;
  const url = new URL(`${API_BASE_URL}${normalizedPath}`);

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    url.searchParams.set(key, String(value));
  });

  return url.toString();
}

async function apiRequest(path, { method = 'GET', query, body, signal } = {}) {
  const response = await fetch(buildApiUrl(path, query), {
    method,
    signal,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const contentType = response.headers.get('content-type') || '';
  let payload = null;

  if (contentType.includes('application/json')) {
    payload = await response.json().catch(() => null);
  } else {
    const text = await response.text().catch(() => '');
    payload = text ? { message: text } : null;
  }

  if (!response.ok) {
    const message = payload?.message || `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

export function getProducts({
  page = 1,
  limit = 12,
  search = '',
  category = '',
  sort = 'newest',
  minPrice,
  maxPrice,
  signal,
} = {}) {
  return apiRequest('/products', {
    query: {
      page,
      limit,
      search,
      category,
      sort,
      minPrice,
      maxPrice,
    },
    signal,
  });
}

export function getProductById(productId, { signal } = {}) {
  return apiRequest(`/products/${productId}`, { signal });
}
