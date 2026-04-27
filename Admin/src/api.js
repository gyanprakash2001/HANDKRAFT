import axios from 'axios';

const DEFAULT_API_BASE_URL = 'http://localhost:5000/api';

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

const API_BASE_URL = trimTrailingSlash(
  import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL,
);

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

export function getStoredToken() {
  return localStorage.getItem('token') || '';
}

export function setStoredToken(token) {
  if (token) {
    localStorage.setItem('token', token);
  } else {
    localStorage.removeItem('token');
  }
}

api.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      setStoredToken('');
    }
    return Promise.reject(error);
  }
);

export default api;