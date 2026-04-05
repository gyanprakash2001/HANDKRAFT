import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  getSellerOrders,
  SellerFulfillmentStatus,
  SellerOrder,
  SellerOrderItem,
  updateSellerOrderItemStatus,
} from '@/utils/api';

type SellerStage = 'new' | 'shipment' | 'delivered';

type GroupedSellerOrderItem = {
  groupKey: string;
  productId: string;
  title: string;
  image: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  fulfillmentStatus: SellerFulfillmentStatus;
  trackingEvents: SellerOrderItem['trackingEvents'];
  itemIndexes: number[];
};

function groupSellerOrderItems(items: SellerOrderItem[]): GroupedSellerOrderItem[] {
  const groups = new Map<string, GroupedSellerOrderItem>();

  for (const item of items) {
    const key = `${item.productId}::${item.fulfillmentStatus}::${item.unitPrice}`;
    const existing = groups.get(key);

    if (existing) {
      existing.quantity += Number(item.quantity) || 0;
      existing.lineTotal += Number(item.lineTotal) || 0;
      existing.itemIndexes.push(item.itemIndex);
      existing.trackingEvents = [...existing.trackingEvents, ...(item.trackingEvents || [])]
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
      continue;
    }

    groups.set(key, {
      groupKey: key,
      productId: item.productId,
      title: item.title,
      image: item.image,
      quantity: Number(item.quantity) || 0,
      unitPrice: Number(item.unitPrice) || 0,
      lineTotal: Number(item.lineTotal) || 0,
      fulfillmentStatus: item.fulfillmentStatus,
      trackingEvents: [...(item.trackingEvents || [])],
      itemIndexes: [item.itemIndex],
    });
  }

  return Array.from(groups.values());
}

function parseStage(value: unknown): SellerStage {
  if (value === 'shipment' || value === 'delivered') return value;
  return 'new';
}

export default function SellerStageOrdersScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ stage?: string }>();
  const stage = parseStage(params.stage);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<SellerOrder[]>([]);
  const [expandedOrderIds, setExpandedOrderIds] = useState<string[]>([]);
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);

  const loadOrders = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      setError(null);
      const data = await getSellerOrders();
      setOrders(data.orders || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load seller orders');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const statusLabelMap: Record<SellerFulfillmentStatus, string> = {
    new: 'New',
    processing: 'Processing',
    packed: 'Packed',
    shipped: 'Shipped',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
  };

  const stageTitle = stage === 'new' ? 'New Orders' : stage === 'shipment' ? 'In Shipment' : 'Delivered';

  const stageDescription = stage === 'new'
    ? 'Move ready orders into shipment.'
    : stage === 'shipment'
      ? 'Mark shipped items as delivered.'
      : 'Completed delivered orders.';

  const filteredOrders = useMemo(() => {
    return orders
      .map((order) => {
        const items = (order.items || []).filter((item) => {
          if (stage === 'new') return ['new', 'processing', 'packed'].includes(item.fulfillmentStatus);
          if (stage === 'shipment') return item.fulfillmentStatus === 'shipped';
          return item.fulfillmentStatus === 'delivered';
        });

        return {
          ...order,
          items,
        };
      })
      .filter((order) => order.items.length > 0);
  }, [orders, stage]);

  const handleUpdateGroupedStatus = async (orderId: string, item: GroupedSellerOrderItem, nextStatus: SellerFulfillmentStatus) => {
    const key = `${orderId}-${item.groupKey}`;

    try {
      setUpdatingKey(key);

      let updatedOrder: SellerOrder | null = null;
      for (const itemIndex of item.itemIndexes) {
        updatedOrder = await updateSellerOrderItemStatus(orderId, itemIndex, nextStatus);
      }

      if (updatedOrder) {
        setOrders((prev) => prev.map((entry) => (entry.id === updatedOrder.id ? updatedOrder : entry)));
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (err: any) {
      setError(err?.message || 'Failed to update order status');
    } finally {
      setUpdatingKey(null);
    }
  };

  const renderOrder = ({ item }: { item: SellerOrder }) => {
    const totalUnits = item.items.reduce((sum, orderItem) => sum + (Number(orderItem.quantity) || 0), 0);

    return (
      <Pressable
        style={styles.orderCard}
        onPress={() => {
          setExpandedOrderIds((prev) => (
            prev.includes(item.id) ? prev.filter((entry) => entry !== item.id) : [...prev, item.id]
          ));
        }}>
        <View style={styles.orderHeader}>
          <View style={styles.orderHeaderMeta}>
            <ThemedText style={styles.orderTitle}>Order #{item.orderId.slice(-8).toUpperCase()}</ThemedText>
            <ThemedText style={styles.orderBuyer}>Buyer: {item.buyer?.name || 'Buyer'} • {totalUnits} unit(s)</ThemedText>
          </View>
          <Ionicons name={expandedOrderIds.includes(item.id) ? 'chevron-up' : 'chevron-down'} size={18} color="#9cb0cc" />
        </View>

        <ThemedText style={styles.orderSubtext}>
          {new Date(item.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} • Payment: {item.paymentStatus}
        </ThemedText>

        {expandedOrderIds.includes(item.id) ? (
          <View style={styles.expandedWrap}>
          <View style={styles.addressCard}>
            <ThemedText style={styles.addressTitle}>Ship To</ThemedText>
            <ThemedText style={styles.addressText}>{item.shippingAddress?.fullName}</ThemedText>
            <ThemedText style={styles.addressText}>{item.shippingAddress?.phoneNumber}</ThemedText>
            <ThemedText style={styles.addressText}>{item.shippingAddress?.street}</ThemedText>
            <ThemedText style={styles.addressText}>
              {item.shippingAddress?.city}, {item.shippingAddress?.state} {item.shippingAddress?.postalCode}
            </ThemedText>
          </View>

            {groupSellerOrderItems(item.items).map((orderItem) => {
              const key = `${item.id}-${orderItem.groupKey}`;
              const latestEvent = orderItem.trackingEvents?.[orderItem.trackingEvents.length - 1];
              const isUpdating = updatingKey === key;

              const action = stage === 'new'
                ? { label: 'Move to In Shipment', next: 'shipped' as SellerFulfillmentStatus }
                : stage === 'shipment'
                  ? { label: 'Mark Delivered', next: 'delivered' as SellerFulfillmentStatus }
                  : null;

              return (
                <View key={key} style={styles.itemCard}>
                <View style={styles.itemTopRow}>
                  <View style={styles.itemTextWrap}>
                    <ThemedText numberOfLines={1} style={styles.itemTitle}>{orderItem.title}</ThemedText>
                    <ThemedText style={styles.itemMeta}>Qty {orderItem.quantity} • ₹{orderItem.lineTotal.toFixed(2)}</ThemedText>
                  </View>
                  <View style={styles.statusBadge}>
                    <ThemedText style={styles.statusBadgeText}>{statusLabelMap[orderItem.fulfillmentStatus]}</ThemedText>
                  </View>
                </View>

                <ThemedText style={styles.trackingText}>
                  {latestEvent
                    ? `Latest: ${statusLabelMap[latestEvent.status]} • ${new Date(latestEvent.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                    : 'No tracking update yet'}
                </ThemedText>

                {action ? (
                  <Pressable
                    style={[styles.actionBtn, isUpdating && styles.actionBtnDisabled]}
                    onPress={() => handleUpdateGroupedStatus(item.id, orderItem, action.next)}
                    disabled={isUpdating}>
                    {isUpdating ? (
                      <ActivityIndicator size="small" color="#071b0e" />
                    ) : (
                      <ThemedText style={styles.actionBtnText}>{action.label}</ThemedText>
                    )}
                  </Pressable>
                ) : (
                  <ThemedText style={styles.readOnlyText}>Delivered item, no further action needed.</ThemedText>
                )}
                </View>
              );
            })}
          </View>
        ) : null}
      </Pressable>
    );
  };

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#9df0a2" />
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </Pressable>
        <View style={styles.headerTextWrap}>
          <ThemedText style={styles.headerTitle}>{stageTitle}</ThemedText>
          <ThemedText style={styles.headerSubtitle}>{stageDescription}</ThemedText>
        </View>
        <Pressable onPress={() => loadOrders(true)} style={styles.refreshBtn}>
          <Ionicons name="refresh" size={18} color="#9df0a2" />
        </Pressable>
      </View>

      {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}

      <FlatList
        data={filteredOrders}
        keyExtractor={(item) => item.id}
        renderItem={renderOrder}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadOrders(true)} tintColor="#9df0a2" />}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="cube-outline" size={46} color="#68788d" />
            <ThemedText style={styles.emptyTitle}>No Orders In {stageTitle}</ThemedText>
            <ThemedText style={styles.emptyText}>Orders in this stage will show up here once available.</ThemedText>
          </View>
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    paddingTop: 62,
    paddingBottom: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#2f3a48',
    backgroundColor: '#1a2029',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#2f3a48',
    backgroundColor: '#1a2029',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextWrap: {
    flex: 1,
  },
  headerTitle: {
    color: '#f0f6ff',
    fontSize: 18,
    fontWeight: '800',
  },
  headerSubtitle: {
    marginTop: 2,
    color: '#93a7c1',
    fontSize: 11,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 10,
    paddingBottom: 90,
  },
  orderCard: {
    marginHorizontal: 2,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a3850',
    backgroundColor: '#111a28',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  orderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  orderHeaderMeta: {
    flex: 1,
  },
  orderTitle: {
    color: '#f3f8ff',
    fontSize: 13,
    fontWeight: '700',
  },
  orderBuyer: {
    marginTop: 2,
    color: '#9cb0cc',
    fontSize: 11,
  },
  orderSubtext: {
    marginTop: 6,
    color: '#a4bad5',
    fontSize: 11,
  },
  expandedWrap: {
    marginTop: 8,
  },
  addressCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334963',
    backgroundColor: '#152234',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  addressTitle: {
    color: '#eef6ff',
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 3,
  },
  addressText: {
    color: '#bcd0e8',
    fontSize: 11,
    marginTop: 2,
  },
  itemCard: {
    marginTop: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334963',
    backgroundColor: '#152234',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  itemTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  itemTextWrap: {
    flex: 1,
  },
  itemTitle: {
    color: '#f4f8ff',
    fontSize: 12,
    fontWeight: '700',
  },
  itemMeta: {
    color: '#a8bad3',
    fontSize: 11,
    marginTop: 2,
  },
  statusBadge: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#506d8f',
    backgroundColor: '#24364e',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusBadgeText: {
    color: '#dde9fb',
    fontSize: 10,
    fontWeight: '700',
  },
  trackingText: {
    marginTop: 6,
    color: '#8fa6c4',
    fontSize: 10.5,
  },
  actionBtn: {
    marginTop: 8,
    height: 34,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#6bcf88',
    backgroundColor: '#9df0a2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnDisabled: {
    opacity: 0.7,
  },
  actionBtnText: {
    color: '#071b0e',
    fontSize: 11.5,
    fontWeight: '800',
  },
  readOnlyText: {
    marginTop: 8,
    color: '#8fa6c4',
    fontSize: 10.5,
    fontWeight: '600',
  },
  emptyState: {
    marginTop: 38,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  emptyTitle: {
    marginTop: 10,
    color: '#f2f7ff',
    fontSize: 15,
    fontWeight: '700',
  },
  emptyText: {
    marginTop: 4,
    color: '#96abc7',
    fontSize: 12,
    textAlign: 'center',
  },
  errorText: {
    marginHorizontal: 12,
    marginBottom: 8,
    color: '#ff9090',
  },
});
