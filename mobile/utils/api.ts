import Constants from 'expo-constants';
import { Platform } from 'react-native';
// Use legacy API to preserve `uploadAsync` and `FileSystemUploadType` enums
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ENV_BASE_URL = process.env.EXPO_PUBLIC_API_URL;

function isIpv4Host(host: string) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function resolveBaseUrl() {
  if (ENV_BASE_URL) {
    return ENV_BASE_URL;
  }

  // Expo hostUri is usually like 192.168.1.10:8081 on a physical device.
  const hostUri = Constants.expoConfig?.hostUri || (Constants as any)?.manifest2?.extra?.expoClient?.hostUri;
  const host = hostUri ? hostUri.split(':')[0] : null;

  // Only use direct LAN IPv4 host. Tunnel hosts are not valid for local backend calls.
  if (host && isIpv4Host(host)) {
    return `http://${host}:5000/api`;
  }

  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:5000/api';
  }

  return 'http://localhost:5000/api';
}

const BASE_URL = resolveBaseUrl();

function normalizeUrl(url: string) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function isNgrokHost(baseUrl: string) {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host.includes('ngrok');
  } catch {
    return false;
  }
}

const API_BASE_URL = normalizeUrl(BASE_URL);

console.log(`[API] Default base URL: ${API_BASE_URL}`);

async function safeFetch(path: string, opts: RequestInit = {}) {
  try {
    // Runtime overrides (dev): 'auto' | 'adb' | 'tunnel' | 'custom'
    const mode = (await AsyncStorage.getItem('API_DEV_MODE')) || 'auto';
    let base = API_BASE_URL;

    if (mode === 'adb') {
      base = 'http://localhost:5000/api';
    } else if (mode === 'tunnel') {
      const tunnel = (await AsyncStorage.getItem('API_TUNNEL_URL')) || '';
      if (tunnel) {
        const normalized = normalizeUrl(String(tunnel || '').replace(/\/api\/?$/i, '')) + '/api';
        base = normalized;
      }
    } else if (mode === 'custom') {
      const custom = (await AsyncStorage.getItem('API_CUSTOM_URL')) || '';
      if (custom) base = normalizeUrl(custom);
    } else {
      // allow one-off override
      const override = (await AsyncStorage.getItem('API_OVERRIDE_URL')) || '';
      if (override) base = normalizeUrl(override as string);
    }

    const headers = new Headers(opts.headers || {});

    // Free ngrok shows a browser warning page unless this header is present.
    if (isNgrokHost(base) && !headers.has('ngrok-skip-browser-warning')) {
      headers.set('ngrok-skip-browser-warning', '1');
    }

    return await fetch(`${base}${path}`, { ...opts, headers });
  } catch (err: any) {
    const original = err?.message ? ` Original: ${err.message}` : '';
    throw new Error(
      `Network request failed. Verify backend is running and reachable. ${original}`
    );
  }
}

export interface AppUser {
  id: string;
  name: string;
  firstName?: string;
  lastName?: string;
  email: string;
  emailVerified?: boolean;
  googleId?: string | null;
  authProvider?: 'local' | 'google';
  avatarUrl?: string;
  phoneNumber?: string;
  locale?: string;
}

interface AuthResponse {
  token: string;
  user: AppUser;
}

export interface ProductMediaItem {
  type: 'image' | 'video';
  url: string;
  thumbnailUrl?: string;
  aspectRatio?: number;
}

export interface ProductItem {
  _id: string;
  title: string;
  description: string;
  price: number;
  realPrice?: number;
  discountedPrice?: number;
  discountPercentage?: number;
  images: string[];
  category: string;
  material: string;
  stock: number;
  imageAspectRatio?: number;
  media?: ProductMediaItem[];
  customizable?: boolean;
  isCustomizable?: boolean;
  sellerName: string;
  seller?: string;
  isActive?: boolean;
  monthlySaves?: number;
  monthlySold?: number;
  createdAt?: string;
}

export interface SellerProductInsights {
  unitsSold: number;
  grossRevenue: number;
  monthlySold: number;
  monthlySaves: number;
  lifetimeSaves: number;
  conversionRate: number;
  stock: number;
  stockStatus: 'healthy' | 'low' | 'out_of_stock';
  lastOrderAt: string | null;
  categoryLeaders: { category: string; count: number }[];
}

export interface SellerProductInsightsResponse {
  item: ProductItem;
  insights: SellerProductInsights;
  suggestions: string[];
}

export interface CartItem {
  product: ProductItem;
  quantity: number;
}

export interface ProfileDashboardResponse {
  user: AppUser & {
    avatarUrl: string;
    createdAt: string;
    stats: {
      listedCount: number;
      likedCount: number;
      cartCount: number;
    };
  };
  listedItems: ProductItem[];
  likedItems: ProductItem[];
  cartItems: CartItem[];
}

export interface CreateProductPayload {
  title: string;
  description?: string;
  price: number;
  realPrice?: number;
  discountedPrice?: number;
  category: string;
  customCategory?: string;
  material?: string;
  stock?: number;
  imageAspectRatio?: number;
  media?: ProductMediaItem[];
  customizable?: boolean;
  isCustomizable?: boolean;
  images?: string[];
}

interface ProductsResponse {
  items: ProductItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export async function registerUser(name: string, email: string, password: string): Promise<AuthResponse> {
  const res = await safeFetch('/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.message || 'Signup failed');
  }
  return res.json();
}

export async function loginUser(email: string, password: string): Promise<AuthResponse> {
  const res = await safeFetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.message || 'Login failed');
  }
  return res.json();
}

export async function signInWithGoogle(idToken?: string, accessToken?: string): Promise<AuthResponse> {
  if (!idToken && !accessToken) {
    throw new Error('Google sign-in requires at least one token (idToken or accessToken).');
  }

  const body: { idToken?: string; accessToken?: string } = {};
  if (idToken) body.idToken = idToken;
  if (accessToken) body.accessToken = accessToken;

  const res = await safeFetch('/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.message || 'Google sign-in failed');
  }

  return res.json();
}

// helper: call protected endpoints with stored token
import { authHeaders } from './auth';

export async function fetchWithAuth(path: string, opts: RequestInit = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}, await authHeaders());
  return safeFetch(path, { ...opts, headers });
}

export async function getProfile() {
  const res = await fetchWithAuth('/users/me');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch profile');
  }
  return res.json();
}

export async function getProfileDashboard(): Promise<ProfileDashboardResponse> {
  const res = await fetchWithAuth('/users/me/profile-dashboard');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch profile dashboard');
  }
  return res.json();
}

export async function getSellerListedItems(): Promise<ProductItem[]> {
  const res = await fetchWithAuth('/users/me/listed-items');
  if (res.status === 404 || res.status === 405) {
    const dashboard = await getProfileDashboard();
    return Array.isArray(dashboard?.listedItems) ? dashboard.listedItems : [];
  }

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    let message = 'Failed to fetch listed items';
    try {
      const parsed = raw ? JSON.parse(raw) : {};
      message = parsed.message || message;
    } catch {
      if (raw) {
        message = raw;
      }
    }
    throw new Error(message);
  }

  const data = await res.json();
  return Array.isArray(data?.items) ? data.items : [];
}

export async function toggleLikedProduct(productId: string): Promise<{ liked: boolean; message: string }> {
  const res = await fetchWithAuth(`/users/me/liked/${productId}`, {
    method: 'POST',
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to update liked item');
  }

  return res.json();
}

export async function addProductToCart(productId: string, quantity = 1): Promise<{ message: string }> {
  const res = await fetchWithAuth(`/users/me/cart/${productId}`, {
    method: 'POST',
    body: JSON.stringify({ quantity }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to add to cart');
  }

  return res.json();
}

export async function removeProductFromCart(productId: string): Promise<{ message: string }> {
  const res = await fetchWithAuth(`/users/me/cart/${productId}`, {
    method: 'DELETE',
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to remove from cart');
  }

  return res.json();
}

export async function replaceCart(items: { productId: string; quantity: number }[]): Promise<{ message: string }> {
  const res = await fetchWithAuth('/users/me/cart', {
    method: 'PUT',
    body: JSON.stringify({ items }),
  });

  if (res.ok) {
    return res.json();
  }

  // Fallback for environments where PUT /users/me/cart is not available yet.
  if (res.status === 404 || res.status === 405) {
    const dashboard = await getProfileDashboard();
    for (const existing of dashboard.cartItems) {
      await removeProductFromCart(existing.product._id);
    }
    for (const item of items) {
      const safeQty = Math.max(1, Number(item.quantity) || 1);
      await addProductToCart(item.productId, safeQty);
    }
    return { message: 'Cart synchronized successfully' };
  }

  const err = await res.json().catch(() => ({}));
  throw new Error(err.message || 'Failed to sync cart');
}

export async function getProducts(params: {
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
  sort?: 'newest' | 'price_asc' | 'price_desc';
} = {}): Promise<ProductsResponse> {
  const query = new URLSearchParams();

  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  if (params.search) query.set('search', params.search);
  if (params.category) query.set('category', params.category);
  if (params.sort) query.set('sort', params.sort);

  const qs = query.toString();
  const path = qs ? `/products?${qs}` : '/products';
  const res = await safeFetch(path);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch products');
  }

  return res.json();
}

export async function getProductById(productId: string): Promise<ProductItem> {
  const res = await safeFetch(`/products/${productId}`);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch product details');
  }

  return res.json();
}

export async function getSellerProductInsights(productId: string): Promise<SellerProductInsightsResponse> {
  const res = await fetchWithAuth(`/products/${productId}/seller-insights`);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch seller insights');
  }

  return res.json();
}

export async function createProduct(payload: CreateProductPayload): Promise<ProductItem> {
  const res = await fetchWithAuth('/products', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const raw = await res.text();
    let message = 'Failed to post item';
    try {
      const parsed = JSON.parse(raw);
      message = parsed.message || message;
    } catch {
      if (res.status === 413) {
        message = 'Image is too large. Please choose a smaller image.';
      } else if (raw) {
        message = raw;
      }
    }
    throw new Error(message);
  }

  const data = await res.json();
  return data.item;
}

export async function uploadProductMedia(media: ProductMediaItem[]): Promise<{ media: ProductMediaItem[]; images: string[] }> {
  if (!Array.isArray(media) || media.length === 0) {
    return { media: [], images: [] };
  }

  const res = await fetchWithAuth('/products/media/upload', {
    method: 'POST',
    body: JSON.stringify({ media }),
  });

  // Backward compatibility for older server builds without media upload route.
  if (res.status === 404 || res.status === 405) {
    return {
      media,
      images: media.filter((item) => item.type === 'image').map((item) => item.url),
    };
  }

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    let message = 'Failed to upload media';
    try {
      const parsed = raw ? JSON.parse(raw) : {};
      message = parsed.message || message;
    } catch {
      if (raw) {
        message = raw;
      }
    }
    throw new Error(message);
  }

  const data = await res.json();
  return {
    media: Array.isArray(data?.media) ? data.media : [],
    images: Array.isArray(data?.images) ? data.images : [],
  };
}

export async function addProductStock(productId: string, addBy = 1): Promise<ProductItem> {
  const endpoint = `/products/${productId}/stock`;

  const patchRes = await fetchWithAuth(endpoint, {
    method: 'PATCH',
    body: JSON.stringify({ addBy }),
  });

  // Fallback to POST for compatibility with older server builds / restricted PATCH setups.
  const res = (patchRes.status === 404 || patchRes.status === 405)
    ? await fetchWithAuth(endpoint, {
        method: 'POST',
        body: JSON.stringify({ addBy }),
      })
    : patchRes;

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    let message = 'Failed to update stock';

    try {
      const parsed = raw ? JSON.parse(raw) : {};
      message = parsed.message || message;
    } catch {
      if (raw) {
        message = `${message} (HTTP ${res.status})`;
      }
    }

    throw new Error(message);
  }

  const data = await res.json();
  return data.item;
}

export async function deleteProduct(productId: string): Promise<{ message: string }> {
  const deleteRes = await fetchWithAuth(`/products/${productId}`, {
    method: 'DELETE',
  });

  const res = (deleteRes.status === 404 || deleteRes.status === 405)
    ? await fetchWithAuth(`/products/${productId}/delete`, {
        method: 'POST',
      })
    : deleteRes;

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    let message = 'Failed to delete post';

    try {
      const parsed = raw ? JSON.parse(raw) : {};
      message = parsed.message || message;
    } catch {
      if (raw) {
        const htmlMatch = raw.match(/<pre>(.*?)<\/pre>/is);
        const extracted = htmlMatch?.[1]?.trim();
        message = extracted || raw;
      }
    }

    throw new Error(message);
  }

  return res.json();
}

// Order interfaces and functions
export interface ShippingAddress {
  fullName: string;
  phoneNumber: string;
  email: string;
  street: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
  isDefaultAddress?: boolean;
}

export interface OrderItem {
  product: string;
  quantity: number;
  price: number;
  title: string;
  image: string;
}

export interface Order {
  _id: string;
  user: string;
  items: OrderItem[];
  shippingAddress: ShippingAddress;
  subtotal: number;
  shippingCost: number;
  tax: number;
  totalAmount: number;
  status: 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
  paymentStatus: 'pending' | 'completed' | 'failed' | 'refunded';
  paymentMethod: string;
  transactionId: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type SellerFulfillmentStatus = 'new' | 'processing' | 'packed' | 'shipped' | 'delivered' | 'cancelled';

export interface SellerOrderTrackingEvent {
  status: SellerFulfillmentStatus;
  note: string;
  at: string;
}

export interface SellerOrderItem {
  itemIndex: number;
  productId: string;
  title: string;
  image: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  fulfillmentStatus: SellerFulfillmentStatus;
  trackingEvents: SellerOrderTrackingEvent[];
}

export interface SellerOrder {
  id: string;
  orderId: string;
  buyer: {
    id: string;
    name: string;
    email: string;
  };
  shippingAddress: ShippingAddress;
  paymentStatus: 'pending' | 'completed' | 'failed' | 'refunded';
  overallStatus: 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
  sellerSubtotal: number;
  items: SellerOrderItem[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateOrderPayload {
  shippingAddress: ShippingAddress;
  notes?: string;
}

export async function createOrder(payload: CreateOrderPayload): Promise<Order> {
  const res = await fetchWithAuth('/orders', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to create order');
  }

  const data = await res.json();
  return data.order;
}

export async function processOrderPayment(orderId: string, stripeToken: string): Promise<{ order: Order; transactionId: string }> {
  const res = await fetchWithAuth(`/orders/${orderId}/pay`, {
    method: 'POST',
    body: JSON.stringify({ stripeToken }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Payment failed');
  }

  return res.json();
}

export async function getSellerOrders(): Promise<{ orders: SellerOrder[]; newOrdersCount: number }> {
  const res = await fetchWithAuth('/orders/seller/me');

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch seller orders');
  }

  const data = await res.json();
  return {
    orders: data.orders || [],
    newOrdersCount: Number(data.newOrdersCount || 0),
  };
}

export async function updateSellerOrderItemStatus(
  orderId: string,
  itemIndex: number,
  status: SellerFulfillmentStatus,
  note?: string
): Promise<SellerOrder> {
  const res = await fetchWithAuth(`/orders/seller/${orderId}/items/${itemIndex}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, note }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to update shipment status');
  }

  const data = await res.json();
  return data.order;
}

export async function getOrder(orderId: string): Promise<Order> {
  const res = await fetchWithAuth(`/orders/${orderId}`);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch order');
  }

  return res.json();
}

export async function getUserOrders(): Promise<Order[]> {
  const res = await fetchWithAuth('/orders/user/me');

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch orders');
  }

  const data = await res.json();
  return data.orders || [];
}

export async function cancelOrder(orderId: string): Promise<{ message: string; order: Order }> {
  const res = await fetchWithAuth(`/orders/${orderId}`, {
    method: 'DELETE',
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to cancel order');
  }

  return res.json();
}

// Profile Management
export interface UserProfile {
  _id: string;
  name: string;
  firstName?: string;
  lastName?: string;
  email: string;
  emailVerified?: boolean;
  googleId?: string | null;
  authProvider?: 'local' | 'google';
  avatarUrl: string;
  phoneNumber: string;
  locale?: string;
  bio: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserAddress {
  label: string;
  fullName: string;
  phoneNumber: string;
  email: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
}

export interface UpdateProfilePayload {
  name?: string;
  phoneNumber?: string;
  bio?: string;
  avatarUrl?: string;
}

export async function updateUserProfile(payload: UpdateProfilePayload): Promise<UserProfile> {
  const res = await fetchWithAuth('/users/me', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to update profile');
  }

  return res.json();
}

// Upload avatar as data URI to server and get back updated user
export type UploadAvatarResponse = { message: string; user?: UserProfile; url?: string; thumbnailUrl?: string };

export async function uploadAvatar(dataUri: string, setOnProfile = true): Promise<UploadAvatarResponse> {
  const res = await fetchWithAuth('/users/me/avatar', {
    method: 'POST',
    body: JSON.stringify({ dataUri, setOnProfile }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to upload avatar');
  }

  return res.json();
}

export async function getDefaultAvatars(): Promise<string[]> {
  const res = await safeFetch('/users/avatars');
  if (!res.ok) {
    return [];
  }
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data?.avatars) ? data.avatars : [];
}

export async function getUserAddresses(): Promise<UserAddress[]> {
  const res = await fetchWithAuth('/users/me/addresses');

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch addresses');
  }

  const data = await res.json();
  return data.addresses || [];
}

export interface AddAddressPayload {
  label?: string;
  fullName: string;
  phoneNumber: string;
  email: string;
  street: string;
  city: string;
  state?: string;
  postalCode: string;
  country?: string;
  isDefault?: boolean;
}

export async function addUserAddress(payload: AddAddressPayload): Promise<{ message: string; addresses: UserAddress[] }> {
  const res = await fetchWithAuth('/users/me/addresses', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to add address');
  }

  return res.json();
}

export async function updateUserAddress(
  addressIndex: number,
  payload: AddAddressPayload
): Promise<{ message: string; addresses: UserAddress[] }> {
  const res = await fetchWithAuth(`/users/me/addresses/${addressIndex}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to update address');
  }

  return res.json();
}

export async function deleteUserAddress(addressIndex: number): Promise<{ message: string; addresses: UserAddress[] }> {
  const res = await fetchWithAuth(`/users/me/addresses/${addressIndex}`, {
    method: 'DELETE',
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to delete address');
  }

  return res.json();
}

export async function getUserOrderHistory(): Promise<Order[]> {
  const res = await fetchWithAuth('/users/me/orders');

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch order history');
  }

  const data = await res.json();
  return data.orders || [];
}

export async function getUserOrderDetails(orderId: string): Promise<Order> {
  const res = await fetchWithAuth(`/users/me/orders/${orderId}`);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to fetch order details');
  }

  return res.json();
}

export interface ChatConversation {
  id: string;
  otherUser: {
    id: string;
    name: string;
    avatarUrl?: string;
  };
  role?: 'seller_inbox' | 'buyer_orders';
  product?: {
    id: string;
    title: string;
  } | null;
  lastMessage: string;
  lastMessageAt?: string;
  unreadCount?: number;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  text: string;
  senderId: string;
  isMine: boolean;
  isImage?: boolean;
  createdAt: string;
}

export async function ensureChatConversation(payload: {
  sellerId?: string;
  sellerName?: string;
  productId?: string;
  productTitle?: string;
}): Promise<ChatConversation> {
  const res = await fetchWithAuth('/chat/conversations/ensure', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    let message = 'Failed to start conversation';

    try {
      const err = raw ? JSON.parse(raw) : {};
      message = err.message || message;
    } catch {
      if (res.status === 404) {
        message = 'Chat service unavailable on server. Please restart backend and try again.';
      } else if (res.status === 401) {
        message = 'Session expired. Please login again.';
      } else if (raw) {
        message = `${message} (HTTP ${res.status})`;
      }
    }

    throw new Error(message);
  }

  const data = await res.json();
  return data.conversation;
}

export async function getChatConversations(): Promise<ChatConversation[]> {
  const res = await fetchWithAuth('/chat/conversations');

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to load conversations');
  }

  const data = await res.json();
  return data.conversations || [];
}

export async function getChatMessages(conversationId: string): Promise<ChatMessage[]> {
  const res = await fetchWithAuth(`/chat/conversations/${conversationId}/messages`);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to load messages');
  }

  const data = await res.json();
  return data.messages || [];
}

export async function sendChatMessage(conversationId: string, text: string, dataUri?: string): Promise<ChatMessage> {
  const body: any = {};
  if (dataUri) body.dataUri = dataUri;
  else body.text = text;

  const res = await fetchWithAuth(`/chat/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to send message');
  }

  const data = await res.json();
  return data.message;
}

export async function prepareLocalUploadUri(originalUri: string) {
  // Ensure uploadAsync can read the file. On Android content:// URIs may not be directly readable
  // by the uploader; copy to a cache file and return that path. Caller should delete returned
  // temp path when done if it differs from the original.
  try {
    if (!originalUri) return { uri: originalUri, tempPath: null };
    if (Platform.OS === 'android' && originalUri.startsWith('content://')) {
      const extMatch = String(originalUri).match(/\.([a-z0-9]+)(?:\?.*)?$/i);
      const ext = extMatch ? `.${extMatch[1]}` : '.mp4';
      const tmp = `${(FileSystem as any).cacheDirectory || FileSystem.cacheDirectory}upload-${Date.now()}${ext}`;
      try {
        await FileSystem.copyAsync({ from: originalUri, to: tmp });
        return { uri: tmp, tempPath: tmp };
      } catch (e) {
        try {
          const downloaded = await FileSystem.downloadAsync(originalUri, tmp);
          return { uri: downloaded.uri || tmp, tempPath: tmp };
        } catch (e2) {
          return { uri: originalUri, tempPath: null };
        }
      }
    }
    return { uri: originalUri, tempPath: null };
  } catch (e) {
    return { uri: originalUri, tempPath: null };
  }
}

function guessMimeTypeFromName(name: string) {
  const ext = String(name || '').split('?')[0].split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'mov':
      return 'video/quicktime';
    case 'm4v':
      return 'video/x-m4v';
    case 'mp4':
      return 'video/mp4';
    case 'avi':
      return 'video/x-msvideo';
    default:
      return 'application/octet-stream';
  }
}

async function fetchFormUpload(url: string, uploadTarget: string, fieldName: string, headers: Record<string, string>) {
  try {
    const filename = String(uploadTarget).split('/').pop() || `upload-${Date.now()}`;
    const mimeType = guessMimeTypeFromName(filename);
    const form = new FormData();
    form.append(fieldName, { uri: uploadTarget, name: filename, type: mimeType } as any);

    const fetchHeaders: Record<string, string> = { ...(headers || {}) };
    // Let fetch set Content-Type and boundary for multipart form data
    if (fetchHeaders['Content-Type']) delete fetchHeaders['Content-Type'];

    console.log('[fetchFormUpload] attempting fetch fallback', { url, uploadTarget, fieldName, filename, mimeType });

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: fetchHeaders,
        body: form as any,
      });

      const raw = await res.text().catch(() => '');
      if (res.ok) {
        try {
          return raw ? JSON.parse(raw) : {};
        } catch {
          return {};
        }
      }

      // If multipart failed (non-2xx), attempt JSON base64 fallback below.
      let message = `Upload failed (HTTP ${res.status})`;
      try {
        const parsed = raw ? JSON.parse(raw) : {};
        message = parsed.message || message;
      } catch {
        if (raw) message = raw;
      }
      console.warn('[fetchFormUpload] multipart FormData upload responded with non-OK, will try JSON base64 fallback', { status: res.status, message });
    } catch (e) {
      console.warn('[fetchFormUpload] multipart FormData upload failed', String(e));
    }

    // JSON Base64 fallback: some runtimes can't send multipart correctly. Read file as base64 and POST JSON.
    try {
      const filename = String(uploadTarget).split('/').pop() || `upload-${Date.now()}`;
      const mimeType = guessMimeTypeFromName(filename);
      const encodingOption = (FileSystem as any).EncodingType?.Base64 ?? 'base64';
      console.log('[fetchFormUpload] attempting JSON base64 fallback', { url, uploadTarget, filename, mimeType });
      const base64 = await (FileSystem as any).readAsStringAsync?.(uploadTarget, { encoding: encodingOption } as any);
      if (!base64) throw new Error('Could not read file as base64');

      const jsonHeaders: Record<string, string> = { 'Content-Type': 'application/json', ...(headers || {}) };
      const jsonBody = JSON.stringify({ filename, mimeType, base64 });
      const jsonRes = await fetch(url, { method: 'POST', headers: jsonHeaders, body: jsonBody });
      const raw2 = await jsonRes.text().catch(() => '');
      if (!jsonRes.ok) {
        let message = `Upload failed (HTTP ${jsonRes.status})`;
        try {
          const parsed = raw2 ? JSON.parse(raw2) : {};
          message = parsed.message || message;
        } catch {
          if (raw2) message = raw2;
        }
        throw new Error(message);
      }

      try {
        return raw2 ? JSON.parse(raw2) : {};
      } catch {
        return {};
      }
    } catch (jsonErr) {
      console.warn('[fetchFormUpload] fallback failed', String(jsonErr));
      throw jsonErr;
    }
  } catch (e) {
    console.warn('[fetchFormUpload] fallback failed', String(e));
    throw e;
  }
}

export async function uploadChatImage(conversationId: string, fileUri: string): Promise<ChatMessage> {
  const headersObj = await authHeaders();
  const headers: Record<string, string> = {};
  if (headersObj && headersObj.Authorization) headers.Authorization = headersObj.Authorization;

  const url = `${API_BASE_URL}/chat/conversations/${conversationId}/messages`;

  const prepared = await prepareLocalUploadUri(fileUri);
  const uploadTarget = prepared.uri;

  const uploadOpts: any = {
    headers,
    httpMethod: 'POST',
    fieldName: 'image',
  };
  const uploadType =
    (FileSystem as any).FileSystemUploadType?.MULTIPART ??
    (FileSystem as any).UploadType?.MULTIPART;
  if (uploadType) uploadOpts.uploadType = uploadType;

  try {
    console.log('[uploadChatImage] uploading', { url, uploadTarget, tempPath: prepared.tempPath });
    try {
      const info = await (FileSystem as any).getInfoAsync?.(uploadTarget) ;
      console.log('[uploadChatImage] file info', info);
    } catch (e) {
      console.log('[uploadChatImage] getInfoAsync failed', String(e));
    }

    try {
      const res = await FileSystem.uploadAsync(url, uploadTarget, uploadOpts);
      if (res.status >= 200 && res.status < 300) {
        const data = res.body ? JSON.parse(res.body) : {};
        console.log('[uploadChatImage] upload response', { status: res.status, body: data });
        return data.message;
      }

      let body = res.body || '';
      try {
        const parsed = body ? JSON.parse(body) : {};
        console.warn('[uploadChatImage] primary upload failed, falling back', { status: res.status, body: parsed });
      } catch (err) {
        console.warn('[uploadChatImage] primary upload failed, falling back', { status: res.status, body });
      }
    } catch (e) {
      console.warn('[uploadChatImage] uploadAsync failed, attempting fetch fallback', String(e));
    }

    const fallback = await fetchFormUpload(url, uploadTarget, 'image', headers);
    // Chat endpoint returns { message: {...} }
    if (fallback && fallback.message) return fallback.message;
    throw new Error('Upload failed');
  } finally {
    if (prepared.tempPath) {
      try {
        await FileSystem.deleteAsync(prepared.tempPath, { idempotent: true });
      } catch (e) {
        // ignore cleanup errors
      }
    }
  }
}

export async function uploadProductFile(fileUri: string): Promise<{ url: string }> {
  const headersObj = await authHeaders();
  const headers: Record<string, string> = {};
  if (headersObj && headersObj.Authorization) headers.Authorization = headersObj.Authorization;

  const url = `${API_BASE_URL}/products/media/upload-file`;
  const prepared = await prepareLocalUploadUri(fileUri);
  const uploadTarget = prepared.uri;

  const uploadOpts: any = {
    headers,
    httpMethod: 'POST',
    fieldName: 'file',
  };
  const uploadType =
    (FileSystem as any).FileSystemUploadType?.MULTIPART ??
    (FileSystem as any).UploadType?.MULTIPART;
  if (uploadType) uploadOpts.uploadType = uploadType;

  try {
    console.log('[uploadProductFile] uploading', { url, uploadTarget, tempPath: prepared.tempPath });
    try {
      const info = await (FileSystem as any).getInfoAsync?.(uploadTarget);
      console.log('[uploadProductFile] file info', info);
    } catch (e) {
      console.log('[uploadProductFile] getInfoAsync failed', String(e));
    }

    try {
      const res = await FileSystem.uploadAsync(url, uploadTarget, uploadOpts);

      if (res.status >= 200 && res.status < 300) {
        const data = res.body ? JSON.parse(res.body) : {};
        console.log('[uploadProductFile] upload response', { status: res.status, body: data });
        return { url: data.url };
      }

      // Primary upload returned non-2xx — try fetch fallback
      let body = res.body || '';
      try {
        const parsed = body ? JSON.parse(body) : {};
        console.warn('[uploadProductFile] primary upload failed, falling back', { status: res.status, body: parsed });
      } catch (err) {
        console.warn('[uploadProductFile] primary upload failed, falling back', { status: res.status, body });
      }
    } catch (err) {
      console.warn('[uploadProductFile] uploadAsync failed, attempting fetch fallback', String(err));
    }

    // Fallback: try fetch + FormData
    const fallback = await fetchFormUpload(url, uploadTarget, 'file', headers);
    if (fallback && typeof fallback.url === 'string') {
      return { url: fallback.url };
    }
    throw new Error('Upload failed');
  } finally {
    if (prepared.tempPath) {
      try {
        await FileSystem.deleteAsync(prepared.tempPath, { idempotent: true });
      } catch (e) {
        // ignore cleanup errors
      }
    }
  }
}
