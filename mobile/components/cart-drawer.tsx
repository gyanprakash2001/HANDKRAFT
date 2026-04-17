import { StyleSheet, View, Pressable, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { CartItem } from '@/utils/api';

function getEffectiveProductPrice(product: CartItem['product']) {
  const realPrice = Math.max(0, Number(product?.realPrice ?? product?.price) || 0);
  const discountedPrice = Number(product?.discountedPrice);
  const hasDiscount = Number.isFinite(discountedPrice)
    && discountedPrice >= 0
    && discountedPrice < realPrice;

  return hasDiscount ? discountedPrice : realPrice;
}

interface CartDrawerProps {
  isVisible: boolean;
  cartItems: CartItem[];
  onClose: () => void;
  onQuantityChange: (productId: string, quantity: number) => void;
  onRemoveItem: (productId: string) => void;
  onProceedCheckout: () => void;
}

export function CartDrawer({
  isVisible,
  cartItems,
  onClose,
  onQuantityChange,
  onRemoveItem,
  onProceedCheckout,
}: CartDrawerProps) {
  if (!isVisible) return null;

  const subtotal = cartItems.reduce((sum, item) => sum + getEffectiveProductPrice(item.product) * item.quantity, 0);
  const shippingCost = subtotal > 500 ? 0 : 50;
  const tax = Number((subtotal * 0.05).toFixed(2));
  const total = subtotal + shippingCost + tax;

  return (
    <>
      {/* Overlay */}
      <Pressable style={styles.overlay} onPress={onClose} />

      {/* Drawer */}
      <View style={styles.drawer}>
        {/* Header */}
        <View style={styles.drawerHeader}>
          <ThemedText type="title" style={styles.drawerTitle}>Shopping Cart</ThemedText>
          <Pressable onPress={onClose}>
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
        </View>

        {cartItems.length === 0 ? (
          <View style={styles.emptyCart}>
            <Ionicons name="bag-outline" size={48} color="#666" />
            <ThemedText style={styles.emptyText}>Your cart is empty</ThemedText>
          </View>
        ) : (
          <>
            {/* Cart Items */}
            <ScrollView style={styles.itemsList} contentContainerStyle={styles.itemsContent}>
              {cartItems.map((item) => (
                <View key={item.product._id} style={styles.cartItem}>
                  <Image
                    source={{ uri: item.product.images?.[0] || 'https://placehold.co/80x60' }}
                    style={styles.itemThumbnail}
                    contentFit="cover"
                  />

                  <View style={styles.itemInfo}>
                    <ThemedText numberOfLines={2} style={styles.itemName}>{item.product.title}</ThemedText>
                    <View style={styles.itemPriceRow}>
                      <ThemedText style={styles.itemPrice}>INR {getEffectiveProductPrice(item.product).toFixed(2)}</ThemedText>
                      {getEffectiveProductPrice(item.product) < Math.max(0, Number(item.product.realPrice ?? item.product.price) || 0) ? (
                        <ThemedText style={styles.itemOriginalPrice}>INR {Math.max(0, Number(item.product.realPrice ?? item.product.price) || 0).toFixed(2)}</ThemedText>
                      ) : null}
                    </View>
                  </View>

                  <View style={styles.quantityControl}>
                    <Pressable
                      style={styles.qtyButton}
                      onPress={() => onQuantityChange(item.product._id, Math.max(1, item.quantity - 1))}>
                      <Ionicons name="remove" size={16} color="#fff" />
                    </Pressable>

                    <ThemedText style={styles.qtyText}>{item.quantity}</ThemedText>

                    <Pressable
                      style={styles.qtyButton}
                      onPress={() => onQuantityChange(item.product._id, item.quantity + 1)}>
                      <Ionicons name="add" size={16} color="#fff" />
                    </Pressable>
                  </View>

                  <View style={styles.itemTotal}>
                    <ThemedText style={styles.itemTotalPrice}>INR {(getEffectiveProductPrice(item.product) * item.quantity).toFixed(2)}</ThemedText>
                    <Pressable onPress={() => onRemoveItem(item.product._id)}>
                      <Ionicons name="trash-outline" size={16} color="#ff6b6b" />
                    </Pressable>
                  </View>
                </View>
              ))}
            </ScrollView>

            {/* Cost Summary */}
            <View style={styles.costSummary}>
              <View style={styles.costRow}>
                <ThemedText style={styles.costLabel}>Subtotal:</ThemedText>
                <ThemedText style={styles.costValue}>INR {subtotal.toFixed(2)}</ThemedText>
              </View>
              <View style={styles.costRow}>
                <ThemedText style={styles.costLabel}>Shipping:</ThemedText>
                <ThemedText style={styles.costValue}>
                  {shippingCost === 0 ? 'Free' : `INR ${shippingCost}`}
                </ThemedText>
              </View>
              <View style={styles.costRow}>
                <ThemedText style={styles.costLabel}>Tax (5%):</ThemedText>
                <ThemedText style={styles.costValue}>INR {tax.toFixed(2)}</ThemedText>
              </View>
              <View style={[styles.costRow, styles.costRowTotal]}>
                <ThemedText style={styles.totalLabel}>Total:</ThemedText>
                <ThemedText style={styles.totalPrice}>INR {total.toFixed(2)}</ThemedText>
              </View>
            </View>

            {/* Action Buttons */}
            <View style={styles.actions}>
              <Pressable style={styles.continueShopping} onPress={onClose}>
                <ThemedText style={styles.continueText}>Continue Shopping</ThemedText>
              </Pressable>
              <Pressable style={styles.checkoutButton} onPress={onProceedCheckout}>
                <Ionicons name="arrow-forward" size={18} color="#000" />
                <ThemedText style={styles.checkoutText}>Proceed to Checkout</ThemedText>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  drawer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#0a0a0a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
  },
  drawerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  drawerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
  },
  emptyCart: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  emptyText: {
    color: '#666',
    fontSize: 14,
  },
  itemsList: {
    maxHeight: 300,
  },
  itemsContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  cartItem: {
    flexDirection: 'row',
    backgroundColor: '#111',
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    gap: 10,
  },
  itemThumbnail: {
    width: 60,
    height: 60,
    borderRadius: 6,
    backgroundColor: '#1a1a1a',
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 12,
    fontWeight: '500',
    color: '#fff',
    marginBottom: 4,
  },
  itemPrice: {
    fontSize: 11,
    color: '#888',
  },
  itemPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  itemOriginalPrice: {
    fontSize: 10,
    color: '#6f7782',
    textDecorationLine: 'line-through',
  },
  quantityControl: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
    gap: 4,
  },
  qtyButton: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qtyText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    minWidth: 20,
    textAlign: 'center',
  },
  itemTotal: {
    alignItems: 'flex-end',
    gap: 4,
  },
  itemTotalPrice: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4caf50',
  },
  costSummary: {
    marginHorizontal: 16,
    backgroundColor: '#111',
    borderRadius: 10,
    padding: 12,
    gap: 8,
    marginBottom: 12,
  },
  costRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  costLabel: {
    fontSize: 12,
    color: '#888',
  },
  costValue: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '500',
  },
  costRowTotal: {
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
    paddingTop: 8,
    marginTop: 2,
  },
  totalLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  totalPrice: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4caf50',
  },
  actions: {
    paddingHorizontal: 16,
    gap: 10,
  },
  continueShopping: {
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2d3d4f',
    alignItems: 'center',
  },
  continueText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  checkoutButton: {
    backgroundColor: '#4caf50',
    paddingVertical: 14,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  checkoutText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 14,
  },
});
