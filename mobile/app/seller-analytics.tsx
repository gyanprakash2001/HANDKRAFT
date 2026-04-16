import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { getProfileDashboard, getSellerOrders, ProductItem, SellerOrder } from '@/utils/api';

type AnalyticsTabKey = 'fulfillment' | 'payment' | 'inventory' | 'top-products' | 'recent-orders';

const ANALYTICS_TABS: { key: AnalyticsTabKey; label: string }[] = [
  { key: 'fulfillment', label: 'Fulfillment' },
  { key: 'payment', label: 'Payment' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'top-products', label: 'Top Products' },
  { key: 'recent-orders', label: 'Recent Orders' },
];

export default function SellerAnalyticsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sellerOrders, setSellerOrders] = useState<SellerOrder[]>([]);
  const [sellerItems, setSellerItems] = useState<ProductItem[]>([]);
  const [activeTab, setActiveTab] = useState<AnalyticsTabKey>('fulfillment');

  const loadAnalytics = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      setError(null);
      const [dashboard, sellerOrderData] = await Promise.all([
        getProfileDashboard(),
        getSellerOrders(),
      ]);

      setSellerItems(dashboard.listedItems || []);
      setSellerOrders(sellerOrderData.orders || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load seller analytics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  const analytics = useMemo(() => {
    const allItems = sellerOrders.flatMap((order) => order.items || []);
    const totalOrders = sellerOrders.length;
    const totalItems = allItems.length;
    const totalRevenue = sellerOrders.reduce((sum, order) => sum + (Number(order.sellerSubtotal) || 0), 0);

    const newOrders = allItems.filter((item) => item.fulfillmentStatus === 'new').length;
    const inProgressItems = allItems.filter((item) => ['processing', 'packed', 'shipped'].includes(item.fulfillmentStatus)).length;
    const deliveredItems = allItems.filter((item) => item.fulfillmentStatus === 'delivered').length;
    const cancelledItems = allItems.filter((item) => item.fulfillmentStatus === 'cancelled').length;

    const paidOrders = sellerOrders.filter((order) => order.paymentStatus === 'completed').length;
    const pendingPayments = sellerOrders.filter((order) => order.paymentStatus === 'pending').length;
    const failedPayments = sellerOrders.filter((order) => order.paymentStatus === 'failed').length;

    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const avgItemsPerOrder = totalOrders > 0 ? totalItems / totalOrders : 0;
    const deliveryRate = totalItems > 0 ? Math.round((deliveredItems / totalItems) * 100) : 0;

    const lowStock = sellerItems.filter((item) => Number(item.stock) > 0 && Number(item.stock) <= 3).length;
    const outOfStock = sellerItems.filter((item) => Number(item.stock) <= 0).length;
    const inStockUnits = sellerItems.reduce((sum, item) => sum + Math.max(0, Number(item.stock) || 0), 0);

    const itemSoldMap = new Map<string, number>();
    for (const orderItem of allItems) {
      itemSoldMap.set(orderItem.title, (itemSoldMap.get(orderItem.title) || 0) + orderItem.quantity);
    }

    const topProducts = Array.from(itemSoldMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([title, sold]) => ({ title, sold }));

    const recentOrders = sellerOrders
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);

    return {
      totalOrders,
      totalItems,
      totalRevenue,
      newOrders,
      inProgressItems,
      deliveredItems,
      cancelledItems,
      paidOrders,
      pendingPayments,
      failedPayments,
      avgOrderValue,
      avgItemsPerOrder,
      deliveryRate,
      lowStock,
      outOfStock,
      inStockUnits,
      totalListings: sellerItems.length,
      topProducts,
      recentOrders,
    };
  }, [sellerItems, sellerOrders]);

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </Pressable>
          <ThemedText style={styles.headerTitle}>Analytics</ThemedText>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color="#9df0a2" />
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </Pressable>
        <ThemedText style={styles.headerTitle}>Analytics</ThemedText>
        <Pressable onPress={() => loadAnalytics(true)} style={styles.refreshBtn}>
          <Ionicons name="refresh" size={18} color="#9df0a2" />
        </Pressable>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => loadAnalytics(true)} tintColor="#9df0a2" />
        }>
        {error ? (
          <View style={styles.errorCard}>
            <ThemedText style={styles.errorText}>{error}</ThemedText>
          </View>
        ) : null}

        <View style={styles.grid}>
          <View style={styles.metricCard}>
            <ThemedText style={styles.metricValue}>{analytics.totalOrders}</ThemedText>
            <ThemedText style={styles.metricLabel}>Total Orders</ThemedText>
          </View>
          <View style={styles.metricCard}>
            <ThemedText style={styles.metricValue}>₹{analytics.totalRevenue.toFixed(0)}</ThemedText>
            <ThemedText style={styles.metricLabel}>Total Revenue</ThemedText>
          </View>
          <View style={styles.metricCard}>
            <ThemedText style={styles.metricValue}>{analytics.deliveryRate}%</ThemedText>
            <ThemedText style={styles.metricLabel}>Delivery Rate</ThemedText>
          </View>
          <View style={styles.metricCard}>
            <ThemedText style={styles.metricValue}>₹{analytics.avgOrderValue.toFixed(0)}</ThemedText>
            <ThemedText style={styles.metricLabel}>Avg Order Value</ThemedText>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsRow}>
          {ANALYTICS_TABS.map((tab) => {
            const isActive = tab.key === activeTab;
            return (
              <Pressable
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                style={[styles.tabChip, isActive && styles.tabChipActive]}>
                <ThemedText style={[styles.tabChipText, isActive && styles.tabChipTextActive]}>{tab.label}</ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>

        {activeTab === 'fulfillment' ? (
          <View style={styles.sectionCard}>
            <ThemedText style={styles.sectionTitle}>Fulfillment Overview</ThemedText>
            <View style={styles.detailRow}>
              <ThemedText style={styles.detailLabel}>New items</ThemedText>
              <ThemedText style={styles.detailValue}>{analytics.newOrders}</ThemedText>
            </View>
            <View style={styles.detailRow}>
              <ThemedText style={styles.detailLabel}>In progress items</ThemedText>
              <ThemedText style={styles.detailValue}>{analytics.inProgressItems}</ThemedText>
            </View>
            <View style={styles.detailRow}>
              <ThemedText style={styles.detailLabel}>Delivered items</ThemedText>
              <ThemedText style={styles.detailValue}>{analytics.deliveredItems}</ThemedText>
            </View>
            <View style={styles.detailRow}>
              <ThemedText style={styles.detailLabel}>Cancelled items</ThemedText>
              <ThemedText style={styles.detailValue}>{analytics.cancelledItems}</ThemedText>
            </View>
            <View style={[styles.detailRow, styles.detailRowLast]}>
              <ThemedText style={styles.detailLabel}>Avg items per order</ThemedText>
              <ThemedText style={styles.detailValue}>{analytics.avgItemsPerOrder.toFixed(1)}</ThemedText>
            </View>
          </View>
        ) : null}

        {activeTab === 'payment' ? (
          <View style={styles.sectionCard}>
            <ThemedText style={styles.sectionTitle}>Payment Summary</ThemedText>
            <View style={styles.detailRow}>
              <ThemedText style={styles.detailLabel}>Paid orders</ThemedText>
              <ThemedText style={styles.detailValue}>{analytics.paidOrders}</ThemedText>
            </View>
            <View style={styles.detailRow}>
              <ThemedText style={styles.detailLabel}>Pending payments</ThemedText>
              <ThemedText style={styles.detailValue}>{analytics.pendingPayments}</ThemedText>
            </View>
            <View style={[styles.detailRow, styles.detailRowLast]}>
              <ThemedText style={styles.detailLabel}>Failed payments</ThemedText>
              <ThemedText style={styles.detailValue}>{analytics.failedPayments}</ThemedText>
            </View>
            <Pressable
              style={({ pressed }) => [styles.paymentPayoutBtn, pressed && styles.paymentPayoutBtnPressed]}
              onPress={() => router.push('/seller-payouts')}>
              <Ionicons name="wallet-outline" size={14} color="#0f1a12" />
              <ThemedText style={styles.paymentPayoutBtnText}>Open Seller Wallet</ThemedText>
            </Pressable>
          </View>
        ) : null}

        {activeTab === 'inventory' ? (
          <View style={styles.sectionCard}>
            <ThemedText style={styles.sectionTitle}>Inventory Health</ThemedText>
            <View style={styles.detailRow}>
              <ThemedText style={styles.detailLabel}>Active listings</ThemedText>
              <ThemedText style={styles.detailValue}>{analytics.totalListings}</ThemedText>
            </View>
            <View style={styles.detailRow}>
              <ThemedText style={styles.detailLabel}>Low stock listings</ThemedText>
              <ThemedText style={styles.detailValue}>{analytics.lowStock}</ThemedText>
            </View>
            <View style={styles.detailRow}>
              <ThemedText style={styles.detailLabel}>Out of stock listings</ThemedText>
              <ThemedText style={styles.detailValue}>{analytics.outOfStock}</ThemedText>
            </View>
            <View style={[styles.detailRow, styles.detailRowLast]}>
              <ThemedText style={styles.detailLabel}>Total in-stock units</ThemedText>
              <ThemedText style={styles.detailValue}>{analytics.inStockUnits}</ThemedText>
            </View>
          </View>
        ) : null}

        {activeTab === 'top-products' ? (
          <View style={styles.sectionCard}>
            <ThemedText style={styles.sectionTitle}>Top Selling Products</ThemedText>
            {analytics.topProducts.length === 0 ? (
              <ThemedText style={styles.emptyText}>No sales data yet.</ThemedText>
            ) : (
              analytics.topProducts.map((item, index) => (
                <View key={`${item.title}-${index}`} style={[styles.detailRow, index === analytics.topProducts.length - 1 && styles.detailRowLast]}>
                  <ThemedText numberOfLines={1} style={[styles.detailLabel, styles.flexLabel]}>{item.title}</ThemedText>
                  <ThemedText style={styles.detailValue}>{item.sold} sold</ThemedText>
                </View>
              ))
            )}
          </View>
        ) : null}

        {activeTab === 'recent-orders' ? (
          <View style={styles.sectionCard}>
            <ThemedText style={styles.sectionTitle}>Recent Orders</ThemedText>
            {analytics.recentOrders.length === 0 ? (
              <ThemedText style={styles.emptyText}>No recent orders yet.</ThemedText>
            ) : (
              analytics.recentOrders.map((order, index) => (
                <View key={order.id} style={[styles.detailRow, index === analytics.recentOrders.length - 1 && styles.detailRowLast]}>
                  <View>
                    <ThemedText style={styles.detailLabel}>Order #{order.orderId.slice(-8).toUpperCase()}</ThemedText>
                    <ThemedText style={styles.subtleText}>
                      {new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </ThemedText>
                  </View>
                  <ThemedText style={styles.detailValue}>₹{order.sellerSubtotal.toFixed(0)}</ThemedText>
                </View>
              ))
            )}
          </View>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  header: {
    paddingTop: 62,
    paddingHorizontal: 14,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#1a1f28',
    borderWidth: 1,
    borderColor: '#2e3847',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#1a1f28',
    borderWidth: 1,
    borderColor: '#2e3847',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: {
    width: 38,
    height: 38,
  },
  loaderWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
  },
  contentInner: {
    paddingHorizontal: 14,
    paddingBottom: 24,
    gap: 10,
  },
  errorCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#6d2d36',
    backgroundColor: '#32171e',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  errorText: {
    color: '#ffadb9',
    fontSize: 12,
    fontWeight: '700',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metricCard: {
    width: '48.5%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2f445f',
    backgroundColor: '#132131',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  metricValue: {
    color: '#9df0a2',
    fontSize: 18,
    fontWeight: '800',
  },
  metricLabel: {
    marginTop: 4,
    color: '#a5bbd7',
    fontSize: 11,
    fontWeight: '700',
  },
  tabsRow: {
    paddingTop: 2,
    paddingBottom: 2,
    gap: 8,
  },
  tabChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2f4056',
    backgroundColor: '#162334',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tabChipActive: {
    borderColor: '#9df0a2',
    backgroundColor: '#224129',
  },
  tabChipText: {
    color: '#bdd0e6',
    fontSize: 11,
    fontWeight: '700',
  },
  tabChipTextActive: {
    color: '#d9ffe0',
  },
  sectionCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a3950',
    backgroundColor: '#131f2f',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sectionTitle: {
    color: '#f0f6ff',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#203249',
    gap: 10,
  },
  detailRowLast: {
    borderBottomWidth: 0,
  },
  detailLabel: {
    color: '#abc0db',
    fontSize: 11,
  },
  flexLabel: {
    flex: 1,
  },
  detailValue: {
    color: '#dff0ff',
    fontSize: 11,
    fontWeight: '700',
  },
  subtleText: {
    color: '#8ea4bf',
    fontSize: 10,
    marginTop: 2,
  },
  emptyText: {
    color: '#9ab1cb',
    fontSize: 11,
    fontWeight: '600',
    paddingVertical: 4,
  },
  paymentPayoutBtn: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#9df0a2',
    backgroundColor: '#9df0a2',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 5,
    paddingVertical: 8,
  },
  paymentPayoutBtnPressed: {
    opacity: 0.9,
  },
  paymentPayoutBtnText: {
    color: '#0f1a12',
    fontSize: 11,
    fontWeight: '800',
  },
});
