import AsyncStorage from '@react-native-async-storage/async-storage';

export const TOKEN_KEY = 'handkraft_token';

export async function saveToken(token: string) {
  try {
    await AsyncStorage.setItem(TOKEN_KEY, token);
  } catch (err) {
    console.error('Failed to save token', err);
  }
}

export async function getToken() {
  try {
    return await AsyncStorage.getItem(TOKEN_KEY);
  } catch (err) {
    console.error('Failed to read token', err);
    return null;
  }
}

export async function removeToken() {
  try {
    await AsyncStorage.removeItem(TOKEN_KEY);
  } catch (err) {
    console.error('Failed to remove token', err);
  }
}

export async function authHeaders() {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
