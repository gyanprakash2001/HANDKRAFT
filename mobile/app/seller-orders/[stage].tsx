import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Linking, Pressable, RefreshControl, StyleSheet, View, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  getSellerOrders,
  SellerFulfillmentStatus,
  SellerOrder,
  SellerOrderItem,
  updateSellerOrderItemStatus,
} from '@/utils/api';

const ENV_BASE_URL = process.env.EXPO_PUBLIC_API_URL;

function resolveFileBaseUrl() {
  if (ENV_BASE_URL) return ENV_BASE_URL.replace(/\/api\/?$/, '');
  const hostUri = Constants.expoConfig?.hostUri || (Constants as any)?.manifest2?.extra?.expoClient?.hostUri;
  const host = hostUri ? hostUri.split(':')[0] : null;
  const isIpv4 = host ? /^\d{1,3}(\.\d{1,3}){3}$/.test(host) : false;
  if (host && isIpv4) return `http://${host}:5000`;
  if (Platform.OS === 'android') return 'http://10.0.2.2:5000';
  return 'http://localhost:5000';
}

function resolveImageUri(url?: string) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/')) return `${resolveFileBaseUrl()}${raw}`;
  return raw;
}

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
  packageWeightGrams?: number;
  packageLengthCm?: number;
  packageBreadthCm?: number;
  packageHeightCm?: number;
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
      packageWeightGrams: item.packageWeightGrams,
      packageLengthCm: item.packageLengthCm,
      packageBreadthCm: item.packageBreadthCm,
      packageHeightCm: item.packageHeightCm,
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

  const handleShareShop = async () => {
    try {
      const shareUrl = `https://handkraft.com/seller/my-shop`;
      await Share.share({
        message: `Check out my custom handmade items on Handkraft! Support local independent creators:\n${shareUrl}`,
        title: 'Share Shop Link',
      });
    } catch {
      // Ignored
    }
  };

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

  const handleMarkAsPacked = useCallback(async (orderId: string, itemIndexes: number[]) => {
    try {
      setLoading(true);
      for (const idx of itemIndexes) {
        await updateSellerOrderItemStatus(orderId, idx, 'packed', 'Item packed by seller and ready for pickup.');
      }
      Alert.alert('Success', 'Item(s) marked as packed!');
      await loadOrders(true);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to update item status');
      setLoading(false);
    }
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
    ? 'Orders awaiting shipment booking by NimbusPost.'
    : stage === 'shipment'
      ? 'Orders currently being shipped via courier.'
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

  const renderOrder = ({ item }: { item: SellerOrder }) => {
    const totalUnits = item.items.reduce((sum, orderItem) => sum + (Number(orderItem.quantity) || 0), 0);
    const shipment = (item as any).shipment;
    const awbNumber = shipment?.carrier?.awbNumber || '';
    const courierName = shipment?.carrier?.courierName || '';
    const trackingUrl = shipment?.carrier?.trackingUrl || '';
    const shipmentStatus = shipment?.status || '';

    // Get first item image
    const firstItemImage = item.items?.[0]?.image;

    return (
      <Pressable
        style={styles.orderCard}
        onPress={() => {
          setExpandedOrderIds((prev) => (
            prev.includes(item.id) ? prev.filter((entry) => entry !== item.id) : [...prev, item.id]
          ));
        }}>
        <View style={styles.orderHeader}>
          {/* Product image thumbnail */}
          {firstItemImage ? (
            <Image
              source={{ uri: resolveImageUri(firstItemImage) }}
              style={styles.orderThumbnail}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : (
            <View style={[styles.orderThumbnail, styles.orderThumbnailPlaceholder]}>
              <Ionicons name="cube-outline" size={20} color="#68788d" />
            </View>
          )}
          <View style={styles.orderHeaderMeta}>
            <ThemedText numberOfLines={1} style={styles.orderTitle}>
              {item.items?.[0]?.title || `Order #${item.orderId.slice(-8).toUpperCase()}`}
            </ThemedText>
            <ThemedText style={styles.orderBuyer}>
              Buyer: {item.buyer?.name || 'Buyer'} • {totalUnits} unit(s)
            </ThemedText>
            {awbNumber ? (
              <View style={styles.awbRow}>
                <Ionicons name="locate-outline" size={11} color="#9df0a2" />
                <ThemedText numberOfLines={1} style={styles.awbText}>
                  {courierName ? `${courierName} • ` : ''}AWB: {awbNumber}
                </ThemedText>
              </View>
            ) : (
              <ThemedText style={styles.awbPending}>
                {stage === 'new' ? 'Tracking ID will be assigned after booking' : 'No tracking ID'}
              </ThemedText>
            )}
          </View>
          <Ionicons name={expandedOrderIds.includes(item.id) ? 'chevron-up' : 'chevron-down'} size={18} color="#9cb0cc" />
        </View>

        <ThemedText style={styles.orderSubtext}>
          {new Date(item.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} • Payment: {item.paymentStatus}
        </ThemedText>

        {expandedOrderIds.includes(item.id) ? (
          <View style={styles.expandedWrap}>
            {/* Shipping address */}
            <View style={styles.addressCard}>
              <ThemedText style={styles.addressTitle}>Ship To</ThemedText>
              <ThemedText style={styles.addressText}>{item.shippingAddress?.fullName}</ThemedText>
              <ThemedText style={styles.addressText}>{item.shippingAddress?.phoneNumber}</ThemedText>
              <ThemedText style={styles.addressText}>{item.shippingAddress?.street}</ThemedText>
              <ThemedText style={styles.addressText}>
                {item.shippingAddress?.city}, {item.shippingAddress?.state} {item.shippingAddress?.postalCode}
              </ThemedText>
            </View>

            {/* Tracking info card */}
            {(awbNumber || shipmentStatus) ? (
              <View style={styles.trackingInfoCard}>
                <View style={styles.trackingInfoRow}>
                  <Ionicons name="cube-outline" size={14} color="#9df0a2" />
                  <ThemedText style={styles.trackingInfoStatus}>
                    {shipmentStatus ? shipmentStatus.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : 'Pending'}
                  </ThemedText>
                </View>
                {awbNumber ? (
                  <ThemedText style={styles.trackingInfoAwb} selectable>
                    AWB: {awbNumber}
                  </ThemedText>
                ) : null}
                {courierName ? (
                  <ThemedText style={styles.trackingInfoCourier}>
                    Courier: {courierName}
                  </ThemedText>
                ) : null}
                {trackingUrl ? (
                  <Pressable
                    style={styles.trackShipmentBtn}
                    onPress={() => Linking.openURL(trackingUrl).catch(() => {})}>
                    <Ionicons name="open-outline" size={13} color="#071b0e" />
                    <ThemedText style={styles.trackShipmentBtnText}>Track Shipment</ThemedText>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {/* Order items with images */}
            {groupSellerOrderItems(item.items).map((orderItem) => {
              const key = `${item.id}-${orderItem.groupKey}`;
              const latestEvent = orderItem.trackingEvents?.[orderItem.trackingEvents.length - 1];

              return (
                <View key={key} style={styles.itemCard}>
                  <View style={styles.itemTopRow}>
                    {orderItem.image ? (
                      <Image
                        source={{ uri: resolveImageUri(orderItem.image) }}
                        style={styles.itemImage}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                      />
                    ) : (
                      <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
                        <Ionicons name="image-outline" size={16} color="#68788d" />
                      </View>
                    )}
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
                      : 'Status updates automatically via NimbusPost tracking'}
                  </ThemedText>

                  {/* Action or info buttons */}
                  {stage === 'new' ? (
                    <View style={styles.actionBlock}>
                      {['new', 'processing'].includes(orderItem.fulfillmentStatus) ? (
                        <View style={styles.packingWorkflow}>
                          <View style={styles.packingChecklist}>
                            <ThemedText style={styles.checklistTitle}>Packing Checklist:</ThemedText>
                            <ThemedText style={styles.checklistText}>
                              📦 deadweight: {orderItem.packageWeightGrams ?? 500}g · dimensions: {orderItem.packageLengthCm ?? 10}x{orderItem.packageBreadthCm ?? 10}x{orderItem.packageHeightCm ?? 10}cm
                            </ThemedText>
                            <ThemedText style={styles.checklistText}>
                              ✉️ print label & verify buyer name: {item.shippingAddress?.fullName}
                            </ThemedText>
                          </View>
                          <Pressable
                            style={styles.packBtn}
                            onPress={() => handleMarkAsPacked(item.id, orderItem.itemIndexes)}>
                            <Ionicons name="gift-outline" size={14} color="#0a0a0a" />
                            <ThemedText style={styles.packBtnText}>Mark as Packed</ThemedText>
                          </Pressable>
                        </View>
                      ) : (
                        <View style={styles.packedWorkflow}>
                          <View style={styles.packedStatusRow}>
                            <Ionicons name="checkmark-circle" size={16} color="#9df0a2" />
                            <ThemedText style={styles.packedStatusText}>Packed & Awaiting Courier Pickup</ThemedText>
                          </View>
                          
                          <View style={styles.labelBtnsRow}>
                            {shipment?.carrier?.labelUrl ? (
                              <Pressable
                                style={styles.labelBtn}
                                onPress={() => Linking.openURL(shipment.carrier.labelUrl).catch(() => {})}>
                                <Ionicons name="print-outline" size={13} color="#9df0a2" />
                                <ThemedText style={styles.labelBtnText}>Shipping Label</ThemedText>
                              </Pressable>
                            ) : null}

                            {shipment?.carrier?.manifestUrl ? (
                              <Pressable
                                style={styles.labelBtn}
                                onPress={() => Linking.openURL(shipment.carrier.manifestUrl).catch(() => {})}>
                                <Ionicons name="document-text-outline" size={13} color="#9df0a2" />
                                <ThemedText style={styles.labelBtnText}>Manifest</ThemedText>
                              </Pressable>
                            ) : null}
                          </View>
                        </View>
                      )}
                    </View>
                  ) : stage === 'shipment' ? (
                    <View style={styles.infoRow}>
                      <Ionicons name="sync-outline" size={14} color="#7fb8ff" />
                      <ThemedText style={styles.infoText}>
                        Status updates automatically when courier delivers the package.
                      </ThemedText>
                    </View>
                  ) : (
                    <View style={styles.infoRow}>
                      <Ionicons name="checkmark-circle-outline" size={14} color="#9df0a2" />
                      <ThemedText style={styles.infoText}>
                        Delivered successfully. No further action needed.
                      </ThemedText>
                    </View>
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
            <Pressable style={styles.shareShopBtn} onPress={handleShareShop}>
              <Ionicons name="share-social-outline" size={16} color="#0a0a0a" />
              <ThemedText style={styles.shareShopBtnText}>Share Shop Link to Get Orders</ThemedText>
            </Pressable>
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
    gap: 10,
  },
  orderThumbnail: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: '#1a2436',
  },
  orderThumbnailPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
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
  awbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  awbText: {
    fontSize: 10,
    color: '#9df0a2',
    fontWeight: '600',
    flex: 1,
  },
  awbPending: {
    marginTop: 3,
    fontSize: 10,
    color: '#8fa6c4',
    fontStyle: 'italic',
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
  trackingInfoCard: {
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a5e3f',
    backgroundColor: '#0e2318',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  trackingInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  trackingInfoStatus: {
    fontSize: 13,
    fontWeight: '700',
    color: '#9df0a2',
  },
  trackingInfoAwb: {
    fontSize: 12,
    color: '#7fb8ff',
    fontWeight: '700',
    fontFamily: 'Courier',
    marginBottom: 2,
  },
  trackingInfoCourier: {
    fontSize: 11,
    color: '#b4b4b4',
    marginBottom: 4,
  },
  trackShipmentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 4,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#9df0a2',
    alignSelf: 'flex-start',
  },
  trackShipmentBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#071b0e',
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
    gap: 10,
  },
  itemImage: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#1a2436',
  },
  itemImagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
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
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#263a52',
  },
  infoText: {
    flex: 1,
    fontSize: 10.5,
    color: '#8fa6c4',
    fontWeight: '500',
    lineHeight: 15,
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
  actionBlock: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#263a52',
  },
  packingWorkflow: {
    gap: 8,
  },
  packingChecklist: {
    backgroundColor: '#0e1724',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#1e2b3e',
  },
  checklistTitle: {
    color: '#9df0a2',
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 4,
  },
  checklistText: {
    color: '#a8bad3',
    fontSize: 10.5,
    lineHeight: 14,
    marginTop: 2,
  },
  packBtn: {
    height: 36,
    borderRadius: 8,
    backgroundColor: '#9df0a2',
    borderWidth: 1,
    borderColor: '#78cf84',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  packBtnText: {
    color: '#0a0a0a',
    fontSize: 12,
    fontWeight: '800',
  },
  packedWorkflow: {
    gap: 8,
  },
  packedStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  packedStatusText: {
    color: '#9df0a2',
    fontSize: 11,
    fontWeight: '700',
  },
  labelBtnsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  labelBtn: {
    flex: 1,
    height: 32,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#375a3d',
    backgroundColor: '#1d4124',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  labelBtnText: {
    color: '#d5f6da',
    fontSize: 11,
    fontWeight: '700',
  },
  shareShopBtn: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#9df0a2',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  shareShopBtnText: {
    color: '#0a0a0a',
    fontSize: 13,
    fontWeight: '600',
  },
});
