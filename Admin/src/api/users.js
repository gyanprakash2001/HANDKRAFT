import api from '../api';

export async function fetchUsers() {
  const res = await api.get('/admin/users');
  return res.data;
}

// Add more admin API calls as needed
