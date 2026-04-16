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

export default api;