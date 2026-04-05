import api from '../api';

export async function loginAdmin(email, password) {
  const res = await api.post('/auth/login', { email, password });
  return res.data;
}

export async function fetchProfile() {
  const res = await api.get('/auth/profile');
  return res.data;
}
