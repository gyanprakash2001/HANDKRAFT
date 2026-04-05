import api from '../api';

export async function fetchProducts() {
  const res = await api.get('/admin/products');
  return res.data;
}

export async function fetchOrders() {
  const res = await api.get('/admin/orders');
  return res.data;
}
