import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { Alert } from 'react-native';

import { CartNotification, CartNotificationItem } from '@/components/cart-notification';
import { CartItem, ProductItem, replaceCart } from '@/utils/api';

type CartNotificationContextValue = {
  cartItems: CartNotificationItem[];
  showNotificationForItem: (item: ProductItem, quantity?: number) => void;
  closeNotification: () => void;
  changeNotificationQuantity: (productId: string, quantity: number) => void;
  removeNotificationItem: (productId: string) => void;
  hydrateCartFromBackend: (items: CartItem[]) => void;
  syncCartToBackend: () => Promise<void>;
  totalCartItems: number;
};

const CartNotificationContext = createContext<CartNotificationContextValue | null>(null);

export function CartNotificationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isVisible, setIsVisible] = useState(false);
  const [notificationItems, setNotificationItems] = useState<CartNotificationItem[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  const showNotificationForItem = useCallback((item: ProductItem, quantity = 1) => {
    const safeQuantity = Math.max(1, quantity);
    setNotificationItems((prev) => {
      const existing = prev.find((entry) => entry.product._id === item._id);
      if (existing) {
        return prev.map((entry) =>
          entry.product._id === item._id
            ? { ...entry, quantity: entry.quantity + safeQuantity }
            : entry
        );
      }
      return [...prev, { product: item, quantity: safeQuantity }];
    });
    setIsVisible(true);
  }, []);

  const closeNotification = useCallback(() => {
    setIsVisible(false);
  }, []);

  const changeNotificationQuantity = useCallback((productId: string, quantity: number) => {
    const safeQuantity = Math.max(0, quantity);
    setNotificationItems((prev) => {
      if (safeQuantity === 0) {
        return prev.filter((entry) => entry.product._id !== productId);
      }
      return prev.map((entry) =>
        entry.product._id === productId
          ? { ...entry, quantity: safeQuantity }
          : entry
      );
    });
  }, []);

  const removeNotificationItem = useCallback((productId: string) => {
    setNotificationItems((prev) => {
      const next = prev.filter((entry) => entry.product._id !== productId);
      if (next.length === 0) {
        setIsVisible(false);
      }
      return next;
    });
  }, []);

  const hydrateCartFromBackend = useCallback((items: CartItem[]) => {
    const normalized = (items || [])
      .filter((entry) => entry?.product?._id)
      .map((entry) => ({ product: entry.product, quantity: Math.max(1, Number(entry.quantity) || 1) }));
    setNotificationItems(normalized);
  }, []);

  const syncCartToBackend = useCallback(async () => {
    await replaceCart(
      notificationItems.map((entry) => ({
        productId: entry.product._id,
        quantity: entry.quantity,
      }))
    );
  }, [notificationItems]);

  const handleViewCart = useCallback(async () => {
    if (isSyncing) return;
    try {
      setIsSyncing(true);
      await syncCartToBackend();
      setIsVisible(false);
      router.push('/checkout');
    } catch (err: any) {
      console.error('Failed to sync cart before checkout', err);
      Alert.alert('Cart Sync Failed', err?.message || 'Unable to sync cart. Please try again.');
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, router, syncCartToBackend]);

  const value = useMemo<CartNotificationContextValue>(
    () => ({
      cartItems: notificationItems,
      showNotificationForItem,
      closeNotification,
      changeNotificationQuantity,
      removeNotificationItem,
      hydrateCartFromBackend,
      syncCartToBackend,
      totalCartItems: notificationItems.reduce((sum, entry) => sum + entry.quantity, 0),
    }),
    [notificationItems, showNotificationForItem, closeNotification, changeNotificationQuantity, removeNotificationItem, hydrateCartFromBackend, syncCartToBackend]
  );

  return (
    <CartNotificationContext.Provider value={value}>
      {children}
      <CartNotification
        isVisible={isVisible}
        items={notificationItems}
        isSyncing={isSyncing}
        onQuantityChange={changeNotificationQuantity}
        onRemoveItem={removeNotificationItem}
        onViewCart={handleViewCart}
        onClose={closeNotification}
      />
    </CartNotificationContext.Provider>
  );
}

export function useCartNotification() {
  const context = useContext(CartNotificationContext);
  if (!context) {
    throw new Error('useCartNotification must be used within CartNotificationProvider');
  }
  return context;
}
