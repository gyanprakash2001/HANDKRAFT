import api from '../api';
import { setStoredToken } from '../api';

export async function loginAdmin(email, password) {
  const res = await api.post('/auth/login', { email, password });
  setStoredToken(res?.data?.token || '');
  return res.data;
}

export async function fetchProfile() {
  const res = await api.get('/auth/profile');
  return res.data;
}

export function logoutAdmin() {
  setStoredToken('');
}
