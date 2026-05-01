import api from '../api';

function toParams(filters = {}) {
  const params = {};
  Object.keys(filters).forEach((key) => {
    const value = filters[key];
    if (value === undefined || value === null || value === '') {
      return;
    }
    params[key] = value;
  });
  return params;
}

export async function fetchAdminOverview() {
  const res = await api.get('/admin/overview');
  return res.data;
}

export async function fetchSystemHealth() {
  const [healthRes, readinessRes] = await Promise.allSettled([
    api.get('/admin/system/health'),
    api.get('/debug/integrations/public-readiness'),
  ]);

  if (healthRes.status !== 'fulfilled') {
    throw healthRes.reason;
  }

  return {
    health: healthRes.value.data,
    readiness: readinessRes.status === 'fulfilled'
      ? readinessRes.value.data
      : {
          ok: false,
          message: readinessRes.reason?.response?.data?.message || readinessRes.reason?.message || 'Readiness check unavailable',
        },
  };
}

export async function fetchUsers(filters = {}) {
  const res = await api.get('/admin/users', { params: toParams(filters) });
  return res.data;
}

export async function fetchUserDetail(id) {
  const res = await api.get(`/admin/users/${id}`);
  return res.data;
}

export async function updateUser(id, payload) {
  const res = await api.patch(`/admin/users/${id}`, payload);
  return res.data;
}

export async function deleteUser(id, payload = {}) {
  const res = await api.delete(`/admin/users/${id}`, { data: payload });
  return res.data;
}

export async function fetchProducts(filters = {}) {
  const res = await api.get('/admin/products', { params: toParams(filters) });
  return res.data;
}

export async function updateProduct(id, payload) {
  const res = await api.patch(`/admin/products/${id}`, payload);
  return res.data;
}

export async function deleteProduct(id, payload = {}) {
  const res = await api.delete(`/admin/products/${id}`, { data: payload });
  return res.data;
}

export async function fetchOrders(filters = {}) {
  const res = await api.get('/admin/orders', { params: toParams(filters) });
  return res.data;
}

export async function fetchOrderDetail(id) {
  const res = await api.get(`/admin/orders/${id}`);
  return res.data;
}

export async function updateOrder(id, payload) {
  const res = await api.patch(`/admin/orders/${id}`, payload);
  return res.data;
}

export async function updateOrderItem(id, itemIndex, payload) {
  const res = await api.patch(`/admin/orders/${id}/items/${itemIndex}`, payload);
  return res.data;
}

export async function deleteOrder(id, payload = {}) {
  const res = await api.delete(`/admin/orders/${id}`, { data: payload });
  return res.data;
}

export async function fetchPayouts(filters = {}) {
  const res = await api.get('/admin/payouts', { params: toParams(filters) });
  return res.data;
}

export async function fetchPayoutDetail(id) {
  const res = await api.get(`/admin/payouts/${id}`);
  return res.data;
}

export async function updatePayout(id, payload) {
  const res = await api.patch(`/admin/payouts/${id}`, payload);
  return res.data;
}

export async function processDuePayouts(payload = {}) {
  const res = await api.post('/admin/payouts/process-due', payload);
  return res.data;
}

export async function claimPayouts(payload = {}) {
  const res = await api.post('/admin/payouts/claim', payload);
  return res.data;
}

export async function fetchReviews(filters = {}) {
  const res = await api.get('/admin/reviews', { params: toParams(filters) });
  return res.data;
}

export async function updateReview(id, payload) {
  const res = await api.patch(`/admin/reviews/${id}`, payload);
  return res.data;
}

export async function deleteReview(id, payload = {}) {
  const res = await api.delete(`/admin/reviews/${id}`, { data: payload });
  return res.data;
}

export async function fetchConversations(filters = {}) {
  const res = await api.get('/admin/chats/conversations', { params: toParams(filters) });
  return res.data;
}

export async function fetchConversationMessages(id) {
  const res = await api.get(`/admin/chats/conversations/${id}/messages`);
  return res.data;
}

export async function deleteMessage(id, payload = {}) {
  const res = await api.delete(`/admin/chats/messages/${id}`, { data: payload });
  return res.data;
}

export async function deleteConversation(id, payload = {}) {
  const res = await api.delete(`/admin/chats/conversations/${id}`, { data: payload });
  return res.data;
}

export async function fetchAuditLogs(filters = {}) {
  const res = await api.get('/admin/audit-logs', { params: toParams(filters) });
  return res.data;
}

export async function fetchCsrSummary() {
  const res = await api.get('/admin/csr/summary');
  return res.data;
}

export async function fetchCsrActivities(filters = {}) {
  const res = await api.get('/admin/csr/activities', { params: toParams(filters) });
  return res.data;
}

export async function createCsrActivity(payload) {
  const res = await api.post('/admin/csr/activities', payload);
  return res.data;
}

export async function updateCsrActivity(id, payload) {
  const res = await api.patch(`/admin/csr/activities/${id}`, payload);
  return res.data;
}

export async function setCsrActivityPublishState(id, published) {
  const res = await api.patch(`/admin/csr/activities/${id}/publish`, { published });
  return res.data;
}
