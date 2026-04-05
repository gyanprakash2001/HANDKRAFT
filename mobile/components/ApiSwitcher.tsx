import React, { useEffect, useState } from 'react';
import { View, TextInput, Pressable, StyleSheet, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemedText } from '@/components/themed-text';

const API_MODE_KEY = 'API_DEV_MODE';
const API_TUNNEL_URL_KEY = 'API_TUNNEL_URL';
const API_CUSTOM_URL_KEY = 'API_CUSTOM_URL';
const API_OVERRIDE_URL_KEY = 'API_OVERRIDE_URL';

export default function ApiSwitcher() {
  const [mode, setMode] = useState<'auto' | 'adb' | 'tunnel' | 'custom'>('auto');
  const [tunnelUrl, setTunnelUrl] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [overrideUrl, setOverrideUrl] = useState('');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const m = (await AsyncStorage.getItem(API_MODE_KEY)) || 'auto';
    const t = (await AsyncStorage.getItem(API_TUNNEL_URL_KEY)) || '';
    const c = (await AsyncStorage.getItem(API_CUSTOM_URL_KEY)) || '';
    const o = (await AsyncStorage.getItem(API_OVERRIDE_URL_KEY)) || '';
    setMode(m as any);
    setTunnelUrl(t);
    setCustomUrl(c);
    setOverrideUrl(o);
  }

  async function save() {
    await AsyncStorage.setItem(API_MODE_KEY, mode);
    await AsyncStorage.setItem(API_TUNNEL_URL_KEY, tunnelUrl || '');
    await AsyncStorage.setItem(API_CUSTOM_URL_KEY, customUrl || '');
    await AsyncStorage.setItem(API_OVERRIDE_URL_KEY, overrideUrl || '');
    Alert.alert('Saved', 'API dev settings saved. Reload the app to apply.');
  }

  async function clear() {
    await AsyncStorage.removeItem(API_MODE_KEY);
    await AsyncStorage.removeItem(API_TUNNEL_URL_KEY);
    await AsyncStorage.removeItem(API_CUSTOM_URL_KEY);
    await AsyncStorage.removeItem(API_OVERRIDE_URL_KEY);
    setMode('auto');
    setTunnelUrl('');
    setCustomUrl('');
    setOverrideUrl('');
    Alert.alert('Cleared', 'Dev overrides cleared. Reload the app.');
  }

  async function switchToWifiMode() {
    await AsyncStorage.setItem(API_MODE_KEY, 'auto');
    await AsyncStorage.removeItem(API_OVERRIDE_URL_KEY);
    setMode('auto');
    setOverrideUrl('');
    Alert.alert('Wi-Fi Mode Enabled', 'Using auto mode for same-network laptop + phone. Reload app.');
  }

  async function switchToMobileDataMode() {
    if (!tunnelUrl.trim()) {
      Alert.alert('Tunnel URL Missing', 'Paste your ngrok/cloudflared URL first, then tap Mobile Data Mode.');
      return;
    }

    await AsyncStorage.setItem(API_TUNNEL_URL_KEY, tunnelUrl.trim());
    await AsyncStorage.setItem(API_MODE_KEY, 'tunnel');
    await AsyncStorage.removeItem(API_OVERRIDE_URL_KEY);
    setMode('tunnel');
    setOverrideUrl('');
    Alert.alert('Mobile Data Mode Enabled', 'Using tunnel mode for phone on mobile data. Reload app.');
  }

  return (
    <View style={styles.card}>
      <ThemedText style={styles.title}>API Dev Switcher</ThemedText>

      <ThemedText style={styles.label}>Quick Mode</ThemedText>
      <View style={styles.rowActions}>
        <Pressable style={styles.quickBtn} onPress={switchToWifiMode}>
          <ThemedText style={styles.quickBtnText}>Same Wi-Fi</ThemedText>
        </Pressable>
        <Pressable style={styles.quickBtn} onPress={switchToMobileDataMode}>
          <ThemedText style={styles.quickBtnText}>Mobile Data</ThemedText>
        </Pressable>
      </View>

      <ThemedText style={styles.label}>Mode</ThemedText>
      <View style={styles.row}>
        <Pressable style={[styles.modeBtn, mode === 'auto' && styles.modeBtnActive]} onPress={() => setMode('auto')}>
          <ThemedText>Auto</ThemedText>
        </Pressable>
        <Pressable style={[styles.modeBtn, mode === 'adb' && styles.modeBtnActive]} onPress={() => setMode('adb')}>
          <ThemedText>ADB</ThemedText>
        </Pressable>
        <Pressable style={[styles.modeBtn, mode === 'tunnel' && styles.modeBtnActive]} onPress={() => setMode('tunnel')}>
          <ThemedText>Tunnel</ThemedText>
        </Pressable>
        <Pressable style={[styles.modeBtn, mode === 'custom' && styles.modeBtnActive]} onPress={() => setMode('custom')}>
          <ThemedText>Custom</ThemedText>
        </Pressable>
      </View>

      {mode === 'tunnel' ? (
        <>
          <ThemedText style={styles.label}>Tunnel URL (ngrok / cloudflared)</ThemedText>
          <TextInput style={styles.input} placeholder="https://xxxxx.ngrok.io" value={tunnelUrl} onChangeText={setTunnelUrl} />
        </>
      ) : null}

      {mode === 'custom' ? (
        <>
          <ThemedText style={styles.label}>Custom API Base URL</ThemedText>
          <TextInput style={styles.input} placeholder="https://myserver.com/api" value={customUrl} onChangeText={setCustomUrl} />
        </>
      ) : null}

      <ThemedText style={styles.label}>One-off override</ThemedText>
      <TextInput style={styles.input} placeholder="https://override.example.com" value={overrideUrl} onChangeText={setOverrideUrl} />

      <View style={styles.rowActions}>
        <Pressable style={styles.saveBtn} onPress={save}><ThemedText>Save</ThemedText></Pressable>
        <Pressable style={styles.clearBtn} onPress={clear}><ThemedText>Clear</ThemedText></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  label: { marginTop: 12, marginBottom: 6, color: '#9eb0c8' },
  row: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  modeBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: '#333' },
  modeBtnActive: { backgroundColor: '#203040' },
  input: { backgroundColor: '#141922', borderWidth: 1, borderColor: '#272f3d', borderRadius: 8, padding: 10, color: '#fff' },
  rowActions: { flexDirection: 'row', marginTop: 16, gap: 8 },
  quickBtn: { flex: 1, alignItems: 'center', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#364860', backgroundColor: '#172131' },
  quickBtnText: { color: '#d9ebff', fontWeight: '600' },
  saveBtn: { flex: 1, alignItems: 'center', padding: 12, backgroundColor: '#9df0a2', borderRadius: 8 },
  clearBtn: { flex: 1, alignItems: 'center', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#444' },
});
