import { StyleSheet, View, Pressable, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ProductItem } from '@/utils/api';

export interface CartNotificationItem {
  product: ProductItem;
  quantity: number;
}

interface CartNotificationProps {
  isVisible: boolean;
  items: CartNotificationItem[];
  isSyncing?: boolean;
  onQuantityChange: (productId: string, newQuantity: number) => void;
  onRemoveItem: (productId: string) => void;
  onViewCart: () => void;
  onClose: () => void;
}

export function CartNotification({
  isVisible,
  items,
  isSyncing = false,
  onQuantityChange,
  onRemoveItem,
  onViewCart,
  onClose,
}: CartNotificationProps) {
  if (!isVisible || items.length === 0) return null;

  const totalItems = items.reduce((sum, entry) => sum + entry.quantity, 0);
  const totalAmount = items.reduce((sum, entry) => sum + entry.product.price * entry.quantity, 0);

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Pressable style={styles.closeButton} onPress={onClose}>
          <Ionicons name="close" size={20} color="#fff" />
        </Pressable>

        <View style={styles.headerRow}>
          <ThemedText style={styles.headerText}>Cart Preview ({totalItems})</ThemedText>
          <ThemedText style={styles.summaryPrice}>INR {totalAmount.toFixed(2)}</ThemedText>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.itemsList}
          contentContainerStyle={styles.itemsListContent}>
          {items.map((entry) => (
            <View key={entry.product._id} style={styles.itemRow}>
              <Pressable style={styles.removeItemButton} onPress={() => onRemoveItem(entry.product._id)}>
                <Ionicons name="close" size={14} color="#fff" />
              </Pressable>
              <Image
                source={{ uri: entry.product.images?.[0] || 'https://placehold.co/60x60' }}
                style={styles.itemImage}
                contentFit="cover"
              />

              <View style={styles.infoSection}>
                <ThemedText numberOfLines={1} style={styles.itemName}>{entry.product.title}</ThemedText>

                <View style={styles.quantityControl}>
                  <Pressable
                    style={styles.qtyButton}
                    onPress={() => onQuantityChange(entry.product._id, Math.max(1, entry.quantity - 1))}>
                    <Ionicons name="remove" size={14} color="#fff" />
                  </Pressable>
                  <ThemedText style={styles.qtyText}>{entry.quantity}</ThemedText>
                  <Pressable
                    style={styles.qtyButton}
                    onPress={() => onQuantityChange(entry.product._id, entry.quantity + 1)}>
                    <Ionicons name="add" size={14} color="#fff" />
                  </Pressable>
                </View>

                <ThemedText style={styles.price}>INR {(entry.product.price * entry.quantity).toFixed(2)}</ThemedText>
              </View>
            </View>
          ))}
        </ScrollView>

        <Pressable style={[styles.viewCartButton, isSyncing && styles.viewCartButtonDisabled]} onPress={onViewCart} disabled={isSyncing}>
          <ThemedText style={styles.viewCartText}>{isSyncing ? 'Syncing...' : 'View Cart'}</ThemedText>
          <Ionicons name="arrow-forward" size={14} color="#000" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 14,
    left: 16,
    right: 16,
    zIndex: 999,
  },
  content: {
    backgroundColor: '#111',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
    paddingRight: 34,
  },
  headerText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  summaryPrice: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4caf50',
  },
  itemsList: {
    maxHeight: 108,
  },
  itemsListContent: {
    gap: 8,
    paddingRight: 2,
  },
  itemRow: {
    width: 150,
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#252525',
    borderRadius: 8,
    padding: 6,
  },
  removeItemButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#2c2c2c',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  closeButton: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  itemImage: {
    width: '100%',
    height: 44,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
  },
  infoSection: {
    width: '100%',
    gap: 4,
  },
  itemName: {
    fontSize: 10,
    fontWeight: '600',
    color: '#fff',
  },
  quantityControl: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 2,
    gap: 4,
    alignSelf: 'flex-start',
  },
  qtyButton: {
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qtyText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
    minWidth: 16,
    textAlign: 'center',
  },
  price: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4caf50',
  },
  viewCartButton: {
    backgroundColor: '#4caf50',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    gap: 4,
  },
  viewCartButtonDisabled: {
    opacity: 0.7,
  },
  viewCartText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 10,
  },
});
