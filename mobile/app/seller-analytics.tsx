import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { PieChart, BarChart } from 'react-native-gifted-charts';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { getProfileDashboard, getSellerOrders, ProductItem, SellerOrder } from '@/utils/api';

type AnalyticsTabKey = 'fulfillment' | 'payment' | 'inventory' | 'top-products' | 'recent-orders';

const ANALYTICS_TABS: { key: AnalyticsTabKey; label: string; icon: string }[] = [
  { key: 'fulfillment', label: 'Fulfillment', icon: 'layers-outline' },
  { key: 'payment', label: 'Payment', icon: 'card-outline' },
  { key: 'inventory', label: 'Inventory', icon: 'cube-outline' },
  { key: 'top-products', label: 'Top Products', icon: 'trophy-outline' },
  { key: 'recent-orders', label: 'Recent Orders', icon: 'time-outline' },
];

const FULFILLMENT_COLORS = ['#4ade80', '#60a5fa', '#facc15', '#f87171'];
const PAYMENT_COLORS = ['#34d399', '#fb923c', '#f43f5e'];
const BAR_COLORS = ['#9df0a2', '#7dd3fc', '#fbbf24', '#f472b6', '#a78bfa'];

// ── Animated Number component ────────────────────────────────────────────────
function AnimatedNumber({ value, prefix = '', suffix = '', decimals = 0 }: {
  value: number; prefix?: string; suffix?: string; decimals?: number;
}) {
  const animVal = useRef(new Animated.Value(0)).current;
  const [display, setDisplay] = useState('0');

  useEffect(() => {
    animVal.setValue(0);
    Animated.timing(animVal, {
      toValue: value,
      duration: 1200,
      useNativeDriver: false,
    }).start();

    const listener = animVal.addListener(({ value: v }) => {
      setDisplay(v.toFixed(decimals));
    });
    return () => animVal.removeListener(listener);
  }, [value, decimals, animVal]);

  return (
    <ThemedText style={styles.kpiValue}>
      {prefix}{display}{suffix}
    </ThemedText>
  );
}

// ── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, prefix, suffix, decimals, icon, color }: {
  label: string; value: number; prefix?: string; suffix?: string;
  decimals?: number; icon: string; color: string;
}) {
  const scaleAnim = useRef(new Animated.Value(0.88)).current;

  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      tension: 60,
      friction: 8,
      useNativeDriver: true,
    }).start();
  }, []);

  return (
    <Animated.View style={[styles.kpiCard, { transform: [{ scale: scaleAnim }] }]}>
      <LinearGradient
        colors={['#131c14', '#0d1410']}
        style={styles.kpiGradient}>
        <View style={[styles.kpiIconWrap, { backgroundColor: color + '22', borderColor: color + '55' }]}>
          <Ionicons name={icon as any} size={16} color={color} />
        </View>
        <AnimatedNumber value={value} prefix={prefix} suffix={suffix} decimals={decimals} />
        <ThemedText style={styles.kpiLabel}>{label}</ThemedText>
      </LinearGradient>
    </Animated.View>
  );
}

// ── Donut Chart Legend ────────────────────────────────────────────────────────
function ChartLegend({ items }: { items: { label: string; value: number; color: string }[] }) {
  const total = items.reduce((s, i) => s + i.value, 0);
  return (
    <View style={styles.legendWrap}>
      {items.map((item) => (
        <View key={item.label} style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: item.color }]} />
          <ThemedText style={styles.legendLabel} numberOfLines={1}>{item.label}</ThemedText>
          <ThemedText style={styles.legendValue}>{item.value}</ThemedText>
          <ThemedText style={styles.legendPct}>
            {total > 0 ? `${Math.round((item.value / total) * 100)}%` : '0%'}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

// ── Status Badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; text: string }> = {
    completed: { label: 'Paid', bg: '#14532d', text: '#4ade80' },
    pending:   { label: 'Pending', bg: '#3b2a00', text: '#facc15' },
    failed:    { label: 'Failed', bg: '#3b0c0c', text: '#f87171' },
    delivered: { label: 'Delivered', bg: '#0c2d3b', text: '#60a5fa' },
    shipped:   { label: 'Shipped', bg: '#1e1b4b', text: '#a78bfa' },
    processing: { label: 'Processing', bg: '#1c1f0f', text: '#a3e635' },
    new:       { label: 'New', bg: '#1a1a1a', text: '#e2e8f0' },
    cancelled: { label: 'Cancelled', bg: '#2d0c0c', text: '#fb7185' },
  };
  const cfg = map[status] || { label: status, bg: '#1a1a1a', text: '#e2e8f0' };
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <ThemedText style={[styles.badgeText, { color: cfg.text }]}>{cfg.label}</ThemedText>
    </View>
  );
}

// ── Ring Progress ─────────────────────────────────────────────────────────────
function RingProgress({ pct, color, size = 100, label }: {
  pct: number; color: string; size?: number; label: string;
}) {
  const strokeWidth = size * 0.12;

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        {/* Background ring */}
        <View style={{
          position: 'absolute',
          width: size, height: size,
          borderRadius: size / 2,
          borderWidth: strokeWidth,
          borderColor: '#1e2a1e',
        }} />
        {/* Filled ring using border trick — quadrant-based approximation */}
        <View style={{
          position: 'absolute',
          width: size, height: size,
          borderRadius: size / 2,
          borderWidth: strokeWidth,
          borderColor: color,
          borderRightColor: pct > 75 ? color : 'transparent',
          borderBottomColor: pct > 50 ? color : 'transparent',
          borderLeftColor: pct > 25 ? color : 'transparent',
          transform: [{ rotate: '-90deg' }],
        }} />
        <View style={{ alignItems: 'center' }}>
          <ThemedText style={[styles.ringPct, { color, fontSize: size * 0.2 }]}>
            {Math.round(pct)}%
          </ThemedText>
        </View>
      </View>
      <ThemedText style={styles.ringLabel}>{label}</ThemedText>
    </View>
  );
}

// ── Empty State ───────────────────────────────────────────────────────────────
function EmptyState({ message }: { message: string }) {
  return (
    <View style={styles.emptyWrap}>
      <Ionicons name="bar-chart-outline" size={44} color="#2e4530" />
      <ThemedText style={styles.emptyTitle}>No data yet</ThemedText>
      <ThemedText style={styles.emptyMsg}>{message}</ThemedText>
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function SellerAnalyticsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sellerOrders, setSellerOrders] = useState<SellerOrder[]>([]);
  const [sellerItems, setSellerItems] = useState<ProductItem[]>([]);
  const [activeTab, setActiveTab] = useState<AnalyticsTabKey>('fulfillment');
  const tabFadeAnim = useRef(new Animated.Value(1)).current;

  const switchTab = (key: AnalyticsTabKey) => {
    if (key === activeTab) return;
    Animated.sequence([
      Animated.timing(tabFadeAnim, { toValue: 0, duration: 130, useNativeDriver: true }),
      Animated.timing(tabFadeAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
    setActiveTab(key);
  };

  const loadAnalytics = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
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

  useEffect(() => { loadAnalytics(); }, [loadAnalytics]);

  const analytics = useMemo(() => {
    const allItems = sellerOrders.flatMap((o) => o.items || []);
    const totalOrders = sellerOrders.length;
    const totalItems = allItems.length;
    const totalRevenue = sellerOrders.reduce((s, o) => s + (Number(o.sellerSubtotal) || 0), 0);

    const newOrders    = allItems.filter((i) => i.fulfillmentStatus === 'new').length;
    const inProgress   = allItems.filter((i) => ['processing', 'packed', 'shipped'].includes(i.fulfillmentStatus)).length;
    const delivered    = allItems.filter((i) => i.fulfillmentStatus === 'delivered').length;
    const cancelled    = allItems.filter((i) => i.fulfillmentStatus === 'cancelled').length;

    const paidOrders    = sellerOrders.filter((o) => o.paymentStatus === 'completed').length;
    const pendingPay    = sellerOrders.filter((o) => o.paymentStatus === 'pending').length;
    const failedPay     = sellerOrders.filter((o) => o.paymentStatus === 'failed').length;

    const avgOrderValue    = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const avgItemsPerOrder = totalOrders > 0 ? totalItems / totalOrders : 0;
    const deliveryRate     = totalItems > 0 ? Math.round((delivered / totalItems) * 100) : 0;

    const lowStock    = sellerItems.filter((i) => Number(i.stock) > 0 && Number(i.stock) <= 3).length;
    const outOfStock  = sellerItems.filter((i) => Number(i.stock) <= 0).length;
    const inStockUnits = sellerItems.reduce((s, i) => s + Math.max(0, Number(i.stock) || 0), 0);
    const healthyStock = sellerItems.length - lowStock - outOfStock;
    const stockHealthPct = sellerItems.length > 0
      ? Math.round((healthyStock / sellerItems.length) * 100)
      : 0;

    const itemSoldMap = new Map<string, number>();
    for (const oi of allItems) {
      itemSoldMap.set(oi.title, (itemSoldMap.get(oi.title) || 0) + oi.quantity);
    }
    const topProducts = Array.from(itemSoldMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([title, sold]) => ({ title, sold }));

    const recentOrders = sellerOrders
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 8);

    return {
      totalOrders, totalItems, totalRevenue, newOrders, inProgress,
      delivered, cancelled, paidOrders, pendingPay, failedPay,
      avgOrderValue, avgItemsPerOrder, deliveryRate,
      lowStock, outOfStock, inStockUnits, healthyStock, stockHealthPct,
      totalListings: sellerItems.length, topProducts, recentOrders,
    };
  }, [sellerItems, sellerOrders]);

  // ── Pie / Bar data ──────────────────────────────────────────────────────────
  const fulfillmentPieData = useMemo(() => [
    { value: analytics.newOrders,  color: FULFILLMENT_COLORS[0], text: `${analytics.newOrders}`,  label: 'New' },
    { value: analytics.inProgress, color: FULFILLMENT_COLORS[1], text: `${analytics.inProgress}`, label: 'In Progress' },
    { value: analytics.delivered,  color: FULFILLMENT_COLORS[2], text: `${analytics.delivered}`,  label: 'Delivered' },
    { value: analytics.cancelled,  color: FULFILLMENT_COLORS[3], text: `${analytics.cancelled}`,  label: 'Cancelled' },
  ].filter(d => d.value > 0), [analytics]);

  const paymentPieData = useMemo(() => [
    { value: analytics.paidOrders, color: PAYMENT_COLORS[0], label: 'Paid' },
    { value: analytics.pendingPay, color: PAYMENT_COLORS[1], label: 'Pending' },
    { value: analytics.failedPay,  color: PAYMENT_COLORS[2], label: 'Failed' },
  ].filter(d => d.value > 0), [analytics]);

  const inventoryBarData = useMemo(() => [
    { value: analytics.healthyStock, label: 'Healthy', frontColor: '#4ade80' },
    { value: analytics.lowStock,     label: 'Low',     frontColor: '#facc15' },
    { value: analytics.outOfStock,   label: 'Out',     frontColor: '#f87171' },
  ], [analytics]);

  const topProductsBarData = useMemo(() =>
    analytics.topProducts.map((p, i) => ({
      value: p.sold,
      label: p.title.length > 10 ? p.title.slice(0, 9) + '…' : p.title,
      frontColor: BAR_COLORS[i % BAR_COLORS.length],
      topLabelComponent: () => (
        <ThemedText style={styles.barTopLabel}>{p.sold}</ThemedText>
      ),
    })),
  [analytics.topProducts]);

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
          <ThemedText style={styles.loadingText}>Loading your dashboard…</ThemedText>
        </View>
      </ThemedView>
    );
  }

  const hasNoData = sellerOrders.length === 0 && sellerItems.length === 0;

  return (
    <ThemedView style={styles.container}>
      {/* ── Header ── */}
      <LinearGradient colors={['#0d1a0e', '#0a0a0a']} style={styles.headerGradient}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </Pressable>
          <View>
            <ThemedText style={styles.headerTitle}>Analytics</ThemedText>
            <ThemedText style={styles.headerSubtitle}>Seller Dashboard</ThemedText>
          </View>
          <Pressable onPress={() => loadAnalytics(true)} style={styles.refreshBtn}>
            <Ionicons name="refresh" size={18} color="#9df0a2" />
          </Pressable>
        </View>
      </LinearGradient>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => loadAnalytics(true)} tintColor="#9df0a2" />
        }>

        {error ? (
          <View style={styles.errorCard}>
            <Ionicons name="alert-circle-outline" size={16} color="#ffadb9" />
            <ThemedText style={styles.errorText}>{error}</ThemedText>
          </View>
        ) : null}

        {/* ── KPI Cards ── */}
        <View style={styles.kpiGrid}>
          <KpiCard label="Total Revenue"    value={analytics.totalRevenue}  prefix="₹" decimals={0} icon="trending-up-outline"     color="#9df0a2" />
          <KpiCard label="Total Orders"     value={analytics.totalOrders}   decimals={0} icon="bag-handle-outline"         color="#60a5fa" />
          <KpiCard label="Delivery Rate"    value={analytics.deliveryRate}  suffix="%"  decimals={0} icon="checkmark-circle-outline" color="#4ade80" />
          <KpiCard label="Avg Order Value"  value={analytics.avgOrderValue} prefix="₹" decimals={0} icon="analytics-outline"        color="#facc15" />
        </View>

        {/* ── Tab Selector ── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsRow}>
          {ANALYTICS_TABS.map((tab) => {
            const isActive = tab.key === activeTab;
            return (
              <Pressable
                key={tab.key}
                onPress={() => switchTab(tab.key)}
                style={[styles.tabChip, isActive && styles.tabChipActive]}>
                <Ionicons
                  name={tab.icon as any}
                  size={12}
                  color={isActive ? '#9df0a2' : '#5a7a8a'}
                  style={{ marginRight: 4 }}
                />
                <ThemedText style={[styles.tabChipText, isActive && styles.tabChipTextActive]}>
                  {tab.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* ── Tab Content ── */}
        <Animated.View style={{ opacity: tabFadeAnim }}>

          {/* ────── FULFILLMENT ────── */}
          {activeTab === 'fulfillment' && (
            <View style={styles.sectionCard}>
              <View style={styles.sectionTitleRow}>
                <Ionicons name="layers-outline" size={14} color="#9df0a2" />
                <ThemedText style={styles.sectionTitle}>Fulfillment Overview</ThemedText>
              </View>
              {fulfillmentPieData.length === 0 ? (
                <EmptyState message="No orders to display yet. Start selling to see fulfillment data!" />
              ) : (
                <>
                  <View style={styles.chartCenter}>
                    <PieChart
                      donut
                      data={fulfillmentPieData}
                      radius={90}
                      innerRadius={54}
                      innerCircleColor="#0d130e"
                      centerLabelComponent={() => (
                        <View style={{ alignItems: 'center' }}>
                          <ThemedText style={styles.donutCenter}>{analytics.totalItems}</ThemedText>
                          <ThemedText style={styles.donutCenterLabel}>items</ThemedText>
                        </View>
                      )}
                      showText={false}
                      strokeWidth={2}
                      strokeColor="#0a0a0a"
                    />
                  </View>
                  <ChartLegend items={[
                    { label: 'New',         value: analytics.newOrders,  color: FULFILLMENT_COLORS[0] },
                    { label: 'In Progress', value: analytics.inProgress, color: FULFILLMENT_COLORS[1] },
                    { label: 'Delivered',   value: analytics.delivered,  color: FULFILLMENT_COLORS[2] },
                    { label: 'Cancelled',   value: analytics.cancelled,  color: FULFILLMENT_COLORS[3] },
                  ]} />
                  <View style={styles.statsRow}>
                    <View style={styles.statPill}>
                      <ThemedText style={styles.statPillVal}>{analytics.avgItemsPerOrder.toFixed(1)}</ThemedText>
                      <ThemedText style={styles.statPillLabel}>Avg items/order</ThemedText>
                    </View>
                    <View style={styles.statPill}>
                      <ThemedText style={styles.statPillVal}>{analytics.deliveryRate}%</ThemedText>
                      <ThemedText style={styles.statPillLabel}>Delivery rate</ThemedText>
                    </View>
                  </View>
                </>
              )}
            </View>
          )}

          {/* ────── PAYMENT ────── */}
          {activeTab === 'payment' && (
            <View style={styles.sectionCard}>
              <View style={styles.sectionTitleRow}>
                <Ionicons name="card-outline" size={14} color="#60a5fa" />
                <ThemedText style={styles.sectionTitle}>Payment Summary</ThemedText>
              </View>
              {paymentPieData.length === 0 ? (
                <EmptyState message="No payment data yet." />
              ) : (
                <>
                  <View style={styles.chartCenter}>
                    <PieChart
                      donut
                      data={paymentPieData}
                      radius={90}
                      innerRadius={54}
                      innerCircleColor="#0d130e"
                      centerLabelComponent={() => (
                        <View style={{ alignItems: 'center' }}>
                          <ThemedText style={[styles.donutCenter, { color: '#34d399' }]}>
                            {analytics.paidOrders}
                          </ThemedText>
                          <ThemedText style={styles.donutCenterLabel}>paid</ThemedText>
                        </View>
                      )}
                      showText={false}
                      strokeWidth={2}
                      strokeColor="#0a0a0a"
                    />
                  </View>
                  <ChartLegend items={[
                    { label: 'Paid',    value: analytics.paidOrders, color: PAYMENT_COLORS[0] },
                    { label: 'Pending', value: analytics.pendingPay,  color: PAYMENT_COLORS[1] },
                    { label: 'Failed',  value: analytics.failedPay,   color: PAYMENT_COLORS[2] },
                  ]} />
                  <View style={styles.statsRow}>
                    <View style={styles.statPill}>
                      <ThemedText style={[styles.statPillVal, { color: '#facc15' }]}>
                        ₹{analytics.totalRevenue.toFixed(0)}
                      </ThemedText>
                      <ThemedText style={styles.statPillLabel}>Total Earned</ThemedText>
                    </View>
                    <View style={styles.statPill}>
                      <ThemedText style={styles.statPillVal}>₹{analytics.avgOrderValue.toFixed(0)}</ThemedText>
                      <ThemedText style={styles.statPillLabel}>Avg Order</ThemedText>
                    </View>
                  </View>
                </>
              )}
              <Pressable
                style={({ pressed }) => [styles.walletBtn, pressed && { opacity: 0.85 }]}
                onPress={() => router.push('/seller-payouts')}>
                <Ionicons name="wallet-outline" size={15} color="#0f1a12" />
                <ThemedText style={styles.walletBtnText}>Open Seller Wallet</ThemedText>
              </Pressable>
            </View>
          )}

          {/* ────── INVENTORY ────── */}
          {activeTab === 'inventory' && (
            <View style={styles.sectionCard}>
              <View style={styles.sectionTitleRow}>
                <Ionicons name="cube-outline" size={14} color="#facc15" />
                <ThemedText style={styles.sectionTitle}>Inventory Health</ThemedText>
              </View>
              {analytics.totalListings === 0 ? (
                <EmptyState message="No listings yet. Upload products to track inventory!" />
              ) : (
                <>
                  {/* Stock health ring */}
                  <View style={styles.ringRow}>
                    <RingProgress
                      pct={analytics.stockHealthPct}
                      color={analytics.stockHealthPct > 70 ? '#4ade80' : analytics.stockHealthPct > 40 ? '#facc15' : '#f87171'}
                      size={110}
                      label="Stock Health"
                    />
                    <View style={styles.ringStats}>
                      <View style={styles.ringStatRow}>
                        <View style={[styles.ringStatDot, { backgroundColor: '#4ade80' }]} />
                        <ThemedText style={styles.ringStatLabel}>Healthy</ThemedText>
                        <ThemedText style={styles.ringStatVal}>{analytics.healthyStock}</ThemedText>
                      </View>
                      <View style={styles.ringStatRow}>
                        <View style={[styles.ringStatDot, { backgroundColor: '#facc15' }]} />
                        <ThemedText style={styles.ringStatLabel}>Low (≤3)</ThemedText>
                        <ThemedText style={styles.ringStatVal}>{analytics.lowStock}</ThemedText>
                      </View>
                      <View style={styles.ringStatRow}>
                        <View style={[styles.ringStatDot, { backgroundColor: '#f87171' }]} />
                        <ThemedText style={styles.ringStatLabel}>Out of Stock</ThemedText>
                        <ThemedText style={styles.ringStatVal}>{analytics.outOfStock}</ThemedText>
                      </View>
                      <View style={[styles.ringStatRow, { marginTop: 8, borderTopWidth: 1, borderTopColor: '#1e2a1e', paddingTop: 8 }]}>
                        <ThemedText style={[styles.ringStatLabel, { color: '#9df0a2' }]}>Total Units</ThemedText>
                        <ThemedText style={[styles.ringStatVal, { color: '#9df0a2' }]}>{analytics.inStockUnits}</ThemedText>
                      </View>
                    </View>
                  </View>

                  {/* Bar chart */}
                  <View style={styles.chartLabel}>
                    <ThemedText style={styles.chartLabelText}>Listings by Stock Status</ThemedText>
                  </View>
                  <View style={styles.barWrap}>
                    <BarChart
                      data={inventoryBarData}
                      barWidth={52}
                      spacing={20}
                      roundedTop
                      hideRules
                      xAxisThickness={0}
                      yAxisThickness={0}
                      yAxisTextStyle={{ color: '#5a7a8a', fontSize: 10 }}
                      xAxisLabelTextStyle={{ color: '#8aaec0', fontSize: 10 }}
                      noOfSections={3}
                      maxValue={Math.max(analytics.healthyStock, analytics.lowStock, analytics.outOfStock, 1) + 1}
                      barBorderRadius={4}
                      showValuesAsTopLabel
                      topLabelTextStyle={{ color: '#ffffff', fontSize: 11, fontWeight: '700' }}
                    />
                  </View>
                </>
              )}
            </View>
          )}

          {/* ────── TOP PRODUCTS ────── */}
          {activeTab === 'top-products' && (
            <View style={styles.sectionCard}>
              <View style={styles.sectionTitleRow}>
                <Ionicons name="trophy-outline" size={14} color="#facc15" />
                <ThemedText style={styles.sectionTitle}>Top Selling Products</ThemedText>
              </View>
              {analytics.topProducts.length === 0 ? (
                <EmptyState message="No sales yet. Your top products will appear here once you start selling!" />
              ) : (
                <>
                  <View style={styles.barWrap}>
                    <BarChart
                      data={topProductsBarData}
                      barWidth={40}
                      spacing={14}
                      roundedTop
                      hideRules
                      xAxisThickness={0}
                      yAxisThickness={0}
                      yAxisTextStyle={{ color: '#5a7a8a', fontSize: 10 }}
                      xAxisLabelTextStyle={{ color: '#8aaec0', fontSize: 9 }}
                      noOfSections={4}
                      barBorderRadius={5}
                      maxValue={Math.max(...analytics.topProducts.map(p => p.sold), 1) + 1}
                    />
                  </View>
                  {/* Detail list */}
                  <View style={styles.productList}>
                    {analytics.topProducts.map((p, i) => (
                      <View key={`${p.title}-${i}`} style={styles.productListRow}>
                        <View style={[styles.rankBadge, { backgroundColor: BAR_COLORS[i % BAR_COLORS.length] + '22' }]}>
                          <ThemedText style={[styles.rankText, { color: BAR_COLORS[i % BAR_COLORS.length] }]}>
                            #{i + 1}
                          </ThemedText>
                        </View>
                        <ThemedText numberOfLines={1} style={styles.productTitle}>{p.title}</ThemedText>
                        <View style={styles.soldPill}>
                          <ThemedText style={styles.soldText}>{p.sold} sold</ThemedText>
                        </View>
                      </View>
                    ))}
                  </View>
                </>
              )}
            </View>
          )}

          {/* ────── RECENT ORDERS ────── */}
          {activeTab === 'recent-orders' && (
            <View style={styles.sectionCard}>
              <View style={styles.sectionTitleRow}>
                <Ionicons name="time-outline" size={14} color="#a78bfa" />
                <ThemedText style={styles.sectionTitle}>Recent Orders</ThemedText>
              </View>
              {analytics.recentOrders.length === 0 ? (
                <EmptyState message="No recent orders yet." />
              ) : (
                analytics.recentOrders.map((order, i) => (
                  <View
                    key={order.id}
                    style={[styles.orderCard, i === analytics.recentOrders.length - 1 && { marginBottom: 0 }]}>
                    <LinearGradient
                      colors={['#111a12', '#0d1210']}
                      style={styles.orderCardGradient}>
                      <View style={styles.orderCardTop}>
                        <View>
                          <ThemedText style={styles.orderIdText}>
                            #{order.orderId.slice(-8).toUpperCase()}
                          </ThemedText>
                          <ThemedText style={styles.orderDateText}>
                            {new Date(order.createdAt).toLocaleDateString('en-IN', {
                              day: 'numeric', month: 'short', year: 'numeric',
                            })}
                          </ThemedText>
                        </View>
                        <View style={{ alignItems: 'flex-end', gap: 6 }}>
                          <ThemedText style={styles.orderRevText}>
                            ₹{order.sellerSubtotal.toFixed(0)}
                          </ThemedText>
                          <StatusBadge status={order.paymentStatus} />
                        </View>
                      </View>
                      {/* Items */}
                      <View style={styles.orderItemsRow}>
                        {(order.items || []).slice(0, 3).map((item, j) => (
                          <View key={j} style={styles.orderItemChip}>
                            <StatusBadge status={item.fulfillmentStatus} />
                            <ThemedText numberOfLines={1} style={styles.orderItemTitle}>
                              {item.title}
                            </ThemedText>
                          </View>
                        ))}
                        {(order.items || []).length > 3 && (
                          <ThemedText style={styles.moreItems}>
                            +{(order.items || []).length - 3} more
                          </ThemedText>
                        )}
                      </View>
                    </LinearGradient>
                  </View>
                ))
              )}
            </View>
          )}

        </Animated.View>

        {hasNoData && !error && (
          <View style={styles.globalEmpty}>
            <Ionicons name="storefront-outline" size={56} color="#1e3320" />
            <ThemedText style={styles.globalEmptyTitle}>Your dashboard is empty</ThemedText>
            <ThemedText style={styles.globalEmptyMsg}>
              Start listing products and completing orders to see your analytics come to life!
            </ThemedText>
          </View>
        )}

      </ScrollView>
    </ThemedView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#08100a',
  },
  headerGradient: {
    paddingTop: 58,
    paddingBottom: 10,
  },
  header: {
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  headerSubtitle: {
    color: '#4a7a52',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#131c14',
    borderWidth: 1,
    borderColor: '#2e4530',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#131c14',
    borderWidth: 1,
    borderColor: '#2e4530',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: { width: 38, height: 38 },
  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#4a7a52', fontSize: 13, fontWeight: '600' },
  content: { flex: 1 },
  contentInner: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 32, gap: 12 },

  // Error
  errorCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#6d2d36',
    backgroundColor: '#1a080c',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: { color: '#ffadb9', fontSize: 12, fontWeight: '600', flex: 1 },

  // KPI Grid
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  kpiCard: {
    width: '48.5%',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1e3320',
  },
  kpiGradient: {
    paddingHorizontal: 12,
    paddingVertical: 14,
    gap: 6,
  },
  kpiIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  kpiValue: {
    color: '#e8fce8',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  kpiLabel: {
    color: '#4a7a52',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },

  // Tabs
  tabsRow: { paddingVertical: 2, gap: 8 },
  tabChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1e2e20',
    backgroundColor: '#0e160f',
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tabChipActive: {
    borderColor: '#9df0a2',
    backgroundColor: '#162818',
  },
  tabChipText: { color: '#4a7a52', fontSize: 11, fontWeight: '700' },
  tabChipTextActive: { color: '#9df0a2' },

  // Section Card
  sectionCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1e3320',
    backgroundColor: '#0c1510',
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 16,
  },
  sectionTitle: {
    color: '#d4f5d6',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.2,
  },

  // Chart
  chartCenter: { alignItems: 'center', marginVertical: 8 },
  chartLabel: { marginTop: 16, marginBottom: 8 },
  chartLabelText: { color: '#4a7a52', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  barWrap: { alignItems: 'center', marginVertical: 4 },
  barTopLabel: { color: '#fff', fontSize: 10, fontWeight: '700' },

  // Donut center
  donutCenter: { color: '#9df0a2', fontSize: 22, fontWeight: '800' },
  donutCenterLabel: { color: '#4a7a52', fontSize: 10, fontWeight: '600' },

  // Legend
  legendWrap: { marginTop: 8, gap: 6 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { flex: 1, color: '#8aaec0', fontSize: 12 },
  legendValue: { color: '#d4f5d6', fontSize: 12, fontWeight: '700', minWidth: 24, textAlign: 'right' },
  legendPct: { color: '#4a7a52', fontSize: 11, minWidth: 34, textAlign: 'right' },

  // Stats pills
  statsRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  statPill: {
    flex: 1,
    backgroundColor: '#0f1e10',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e3320',
    alignItems: 'center',
    paddingVertical: 10,
  },
  statPillVal: { color: '#9df0a2', fontSize: 16, fontWeight: '800' },
  statPillLabel: { color: '#4a7a52', fontSize: 10, fontWeight: '600', marginTop: 2 },

  // Wallet button
  walletBtn: {
    marginTop: 14,
    borderRadius: 12,
    backgroundColor: '#9df0a2',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  walletBtnText: { color: '#0f1a12', fontSize: 13, fontWeight: '800' },

  // Ring progress
  ringRow: { flexDirection: 'row', alignItems: 'center', gap: 20, marginVertical: 8 },
  ringPct: { fontWeight: '800' },
  ringLabel: { color: '#4a7a52', fontSize: 11, fontWeight: '600', marginTop: 6, textAlign: 'center' },
  ringStats: { flex: 1, gap: 8 },
  ringStatRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ringStatDot: { width: 8, height: 8, borderRadius: 4 },
  ringStatLabel: { flex: 1, color: '#8aaec0', fontSize: 11 },
  ringStatVal: { color: '#d4f5d6', fontSize: 12, fontWeight: '700' },

  // Products
  productList: { marginTop: 14, gap: 8 },
  productListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0e1810',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  rankBadge: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: { fontSize: 11, fontWeight: '800' },
  productTitle: { flex: 1, color: '#c4e0c6', fontSize: 12 },
  soldPill: {
    backgroundColor: '#162818',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  soldText: { color: '#9df0a2', fontSize: 11, fontWeight: '700' },

  // Order cards
  orderCard: { borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#1e3320', marginBottom: 10 },
  orderCardGradient: { padding: 14 },
  orderCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  orderIdText: { color: '#c4e0c6', fontSize: 13, fontWeight: '800', letterSpacing: 0.4 },
  orderDateText: { color: '#4a7a52', fontSize: 11, marginTop: 2 },
  orderRevText: { color: '#9df0a2', fontSize: 15, fontWeight: '800' },
  orderItemsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  orderItemChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#0e1810', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 4 },
  orderItemTitle: { color: '#8aaec0', fontSize: 10, maxWidth: 90 },
  moreItems: { color: '#4a7a52', fontSize: 10, fontWeight: '600', alignSelf: 'center' },

  // Status badge
  badge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: '700' },

  // Empty states
  emptyWrap: { alignItems: 'center', paddingVertical: 28, gap: 8 },
  emptyTitle: { color: '#4a7a52', fontSize: 14, fontWeight: '700' },
  emptyMsg: { color: '#2e4530', fontSize: 12, textAlign: 'center', lineHeight: 18 },
  globalEmpty: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  globalEmptyTitle: { color: '#3a6040', fontSize: 16, fontWeight: '800' },
  globalEmptyMsg: { color: '#2a4030', fontSize: 12, textAlign: 'center', lineHeight: 18, paddingHorizontal: 20 },
});
