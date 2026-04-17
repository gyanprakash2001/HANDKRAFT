import React, { useEffect, useState } from 'react';
import { Modal, View, StyleSheet, FlatList, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { getUserAddresses } from '@/utils/api';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSelect: (addr: any) => void;
  returnTo?: string;
};

export default function AddressPickerModal({ visible, onClose, onSelect, returnTo = '/upload' }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [addresses, setAddresses] = useState<any[]>([]);

  useEffect(() => {
    if (!visible) return;
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const list = await getUserAddresses();
        if (mounted) setAddresses(list || []);
      } catch {
        if (mounted) setAddresses([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [visible]);

  const handleAddNew = () => {
    onClose();
    router.push({ pathname: '/add-address', params: { returnTo } } as any);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <ThemedView style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <ThemedText style={styles.title}>Select pickup address</ThemedText>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color="#b6c2cf" />
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.loadingWrap}><ActivityIndicator size="small" color="#9df0a2" /></View>
          ) : (
            <FlatList
              data={addresses}
              keyExtractor={(it) => String(it._id || `${it.street}-${it.postalCode}`)}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.addrRow}
                  onPress={() => {
                    onSelect(item);
                  }}>
                  <View style={styles.addrTextWrap}>
                    <ThemedText style={styles.addrLabel}>{item.label || 'Home'}</ThemedText>
                    <ThemedText style={styles.addrLine} numberOfLines={2}>{`${item.street || ''}${item.city ? ', ' + item.city : ''}${item.postalCode ? ' - ' + item.postalCode : ''}`}</ThemedText>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#9aa7b8" />
                </Pressable>
              )}
            />
          )}

          <View style={styles.actionsRow}>
            <Pressable style={styles.addBtn} onPress={handleAddNew}>
              <ThemedText style={styles.addBtnText}>+ Add new address</ThemedText>
            </Pressable>
          </View>
        </View>
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  card: { backgroundColor: '#0a0a0a', borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 12, maxHeight: '70%' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { fontSize: 16, fontWeight: '700', color: '#fff' },
  closeBtn: { padding: 6 },
  loadingWrap: { padding: 24, alignItems: 'center' },
  addrRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#131820' },
  addrTextWrap: { flex: 1, paddingRight: 8 },
  addrLabel: { color: '#cbe8d0', fontSize: 13, fontWeight: '700' },
  addrLine: { color: '#9aa7b8', fontSize: 12, marginTop: 2 },
  actionsRow: { paddingTop: 8 },
  addBtn: { paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: '#163925' },
  addBtnText: { color: '#9df0a2', fontWeight: '700' },
});
