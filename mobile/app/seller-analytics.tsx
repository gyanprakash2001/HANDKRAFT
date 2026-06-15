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

// ── Animated counter ──────────────────────────────────────────────────────────
function AnimatedNumber({ value, prefix = '', suffix = '', decimals = 0, style }: {
  value: number; prefix?: string; suffix?: string; decimals?: number; style?: any;
}) {
  const animVal = useRef(new Animated.Value(0)).current;
  const [display, setDisplay] = useState('0');

  useEffect(() => {
    animVal.setValue(0);
    const anim = Animated.timing(animVal, {
      toValue: value,
      duration: 1100,
      useNativeDriver: false,
    });
    const id = animVal.addListener(({ value: v }) => setDisplay(v.toFixed(decimals)));
    anim.start();
    return () => {
      anim.stop();
      animVal.removeListener(id);
    };
  }, [value, decimals, animVal]);

  return (
    <ThemedText style={style}>{prefix}{display}{suffix}</ThemedText>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, prefix, suffix, decimals, icon, color }: {
  label: string; value: number; prefix?: string; suffix?: string;
  decimals?: number; icon: string; color: string;
}) {
  const scale = useRef(new Animated.Value(0.9)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }).start();
  }, [scale]);

  return (
    <Animated.View style={[styles.kpiCard, { transform: [{ scale }] }]}>
      <LinearGradient colors={['#111d12', '#0c1510']} style={styles.kpiGradient}>
        <View style={[styles.kpiIconWrap, { backgroundColor: color + '22', borderColor: color + '44' }]}>
          <Ionicons name={icon as any} size={16} color={color} />
        </View>
        <AnimatedNumber value={value} prefix={prefix} suffix={suffix} decimals={decimals} style={[styles.kpiValue, { color }]} />
        <ThemedText style={styles.kpiLabel}>{label}</ThemedText>
      </LinearGradient>
    </Animated.View>
  );
}

// ── Animated horizontal bar ───────────────────────────────────────────────────
function AnimatedBar({ pct, color, delay = 0 }: { pct: number; color: string; delay?: number }) {
  const width = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const t = setTimeout(() => {
      Animated.timing(width, {
        toValue: Math.max(pct, 0),
        duration: 900,
        useNativeDriver: false,
      }).start();
    }, delay);
    return () => clearTimeout(t);
  }, [pct, delay, width]);

  const barWidth = width.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });
  return (
    <View style={styles.barTrack}>
      <Animated.View style={[styles.barFill, { width: barWidth, backgroundColor: color }]} />
    </View>
  );
}

// ── Segment bar (for pie-like breakdown) ─────────────────────────────────────
// Each slice rendered as a sub-component so hooks work correctly
function SegmentSlice({ pct, color, isFirst, isLast, delay }: {
  pct: number; color: string; isFirst: boolean; isLast: boolean; delay: number;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: pct,
      duration: 900,
      delay,
      useNativeDriver: false,
    }).start();
  }, [pct, delay, anim]);
  const w = anim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });
  return (
    <Animated.View style={[
      styles.segmentBarSlice,
      { backgroundColor: color, width: w },
      isFirst && { borderTopLeftRadius: 8, borderBottomLeftRadius: 8 },
      isLast && { borderTopRightRadius: 8, borderBottomRightRadius: 8 },
    ]} />
  );
}

function SegmentBar({ segments }: { segments: { value: number; color: string; label: string }[] }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return null;
  return (
    <View style={styles.segmentBarWrap}>
      {segments.map((seg, i) => (
        <SegmentSlice
          key={seg.label}
          pct={(seg.value / total) * 100}
          color={seg.color}
          isFirst={i === 0}
          isLast={i === segments.length - 1}
          delay={i * 80}
        />
      ))}
    </View>
  );
}

// ── Ring progress (pure RN border trick) ─────────────────────────────────────
function RingProgress({ pct, color, size = 100, label }: {
  pct: number; color: string; size?: number; label: string;
}) {
  const strokeWidth = size * 0.13;
  const clamped = Math.min(Math.max(pct, 0), 100);
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{
          position: 'absolute', width: size, height: size,
          borderRadius: size / 2, borderWidth: strokeWidth, borderColor: '#1a2e1c',
        }} />
        <View style={{
          position: 'absolute', width: size, height: size,
          borderRadius: size / 2, borderWidth: strokeWidth,
          borderTopColor: color,
          borderRightColor: clamped > 25 ? color : 'transparent',
          borderBottomColor: clamped > 50 ? color : 'transparent',
          borderLeftColor: clamped > 75 ? color : 'transparent',
          transform: [{ rotate: '-90deg' }],
        }} />
        <View style={{ alignItems: 'center' }}>
          <ThemedText style={{ color, fontSize: size * 0.2, fontWeight: '800' }}>
            {Math.round(clamped)}%
          </ThemedText>
          <ThemedText style={{ color: '#4a6e4c', fontSize: size * 0.1, fontWeight: '600' }}>
            health
          </ThemedText>
        </View>
      </View>
      <ThemedText style={styles.ringLabel}>{label}</ThemedText>
    </View>
  );
}

// ── Chart legend row ──────────────────────────────────────────────────────────
function LegendRow({ label, value, total, color }: {
  label: string; value: number; total: number; color: string;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <View style={styles.legendItem}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <View style={[styles.legendDot, { backgroundColor: color }]} />
        <ThemedText style={styles.legendLabel} numberOfLines={1}>{label}</ThemedText>
        <ThemedText style={styles.legendValue}>{value}</ThemedText>
        <ThemedText style={styles.legendPct}>{Math.round(pct)}%</ThemedText>
      </View>
      <AnimatedBar pct={pct} color={color} />
    </View>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; text: string }> = {
    completed: { label: 'Paid', bg: '#0d2e1a', text: '#4ade80' },
    pending:   { label: 'Pending', bg: '#2d2000', text: '#facc15' },
    failed:    { label: 'Failed', bg: '#2d0a0a', text: '#f87171' },
    refunded:  { label: 'Refunded', bg: '#1a1a2d', text: '#a78bfa' },
    delivered: { label: 'Delivered', bg: '#0a1e2d', text: '#60a5fa' },
    shipped:   { label: 'Shipped', bg: '#12102d', text: '#818cf8' },
    processing:{ label: 'Processing', bg: '#141e0a', text: '#a3e635' },
    packed:    { label: 'Packed', bg: '#1a1e0a', text: '#d9f99d' },
    new:       { label: 'New', bg: '#1a1a1a', text: '#e2e8f0' },
    cancelled: { label: 'Cancelled', bg: '#2d0a0a', text: '#fb7185' },
  };
  const c = map[status] || { label: status, bg: '#1a1a1a', text: '#e2e8f0' };
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <ThemedText style={[styles.badgeText, { color: c.text }]}>{c.label}</ThemedText>
    </View>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({ icon, message }: { icon: string; message: string }) {
  return (
    <View style={styles.emptyWrap}>
      <View style={styles.emptyIconWrap}>
        <Ionicons name={icon as any} size={32} color="#2e4530" />
      </View>
      <ThemedText style={styles.emptyMsg}>{message}</ThemedText>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function SellerAnalyticsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sellerOrders, setSellerOrders] = useState<SellerOrder[]>([]);
  const [sellerItems, setSellerItems] = useState<ProductItem[]>([]);
  const [activeTab, setActiveTab] = useState<AnalyticsTabKey>('fulfillment');
  const tabOpacity = useRef(new Animated.Value(1)).current;

  const switchTab = (key: AnalyticsTabKey) => {
    if (key === activeTab) return;
    Animated.sequence([
      Animated.timing(tabOpacity, { toValue: 0, duration: 100, useNativeDriver: true }),
      Animated.timing(tabOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
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
      setError(err?.message || 'Failed to load analytics');
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

    const newOrders  = allItems.filter((i) => i.fulfillmentStatus === 'new').length;
    const inProgress = allItems.filter((i) => ['processing', 'packed', 'shipped'].includes(i.fulfillmentStatus)).length;
    const delivered  = allItems.filter((i) => i.fulfillmentStatus === 'delivered').length;
    const cancelled  = allItems.filter((i) => i.fulfillmentStatus === 'cancelled').length;

    const paidOrders = sellerOrders.filter((o) => o.paymentStatus === 'completed').length;
    const pendingPay = sellerOrders.filter((o) => o.paymentStatus === 'pending').length;
    const failedPay  = sellerOrders.filter((o) => o.paymentStatus === 'failed').length;

    const avgOrderValue    = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const avgItemsPerOrder = totalOrders > 0 ? totalItems / totalOrders : 0;
    const deliveryRate     = totalItems > 0 ? Math.round((delivered / totalItems) * 100) : 0;

    const lowStock     = sellerItems.filter((i) => Number(i.stock) > 0 && Number(i.stock) <= 3).length;
    const outOfStock   = sellerItems.filter((i) => Number(i.stock) <= 0).length;
    const inStockUnits = sellerItems.reduce((s, i) => s + Math.max(0, Number(i.stock) || 0), 0);
    const healthyStock = Math.max(0, sellerItems.length - lowStock - outOfStock);
    const stockHealthPct = sellerItems.length > 0
      ? Math.round((healthyStock / sellerItems.length) * 100) : 0;

    const itemSoldMap = new Map<string, number>();
    for (const oi of allItems) {
      itemSoldMap.set(oi.title, (itemSoldMap.get(oi.title) || 0) + oi.quantity);
    }
    const topProducts = Array.from(itemSoldMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([title, sold]) => ({ title, sold }));

    const maxSold = topProducts.length > 0 ? topProducts[0].sold : 1;

    const recentOrders = sellerOrders
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 8);

    return {
      totalOrders, totalItems, totalRevenue, newOrders, inProgress,
      delivered, cancelled, paidOrders, pendingPay, failedPay,
      avgOrderValue, avgItemsPerOrder, deliveryRate,
      lowStock, outOfStock, inStockUnits, healthyStock, stockHealthPct,
      totalListings: sellerItems.length, topProducts, maxSold, recentOrders,
    };
  }, [sellerItems, sellerOrders]);

  const BAR_COLORS = ['#9df0a2', '#60a5fa', '#facc15', '#f472b6', '#a78bfa'];

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <LinearGradient colors={['#0d1a0e', '#0a0a0a']} style={styles.headerGradient}>
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="chevron-back" size={24} color="#fff" />
            </Pressable>
            <View>
              <ThemedText style={styles.headerTitle}>Analytics</ThemedText>
              <ThemedText style={styles.headerSub}>Seller Dashboard</ThemedText>
            </View>
            <View style={styles.headerSpacer} />
          </View>
        </LinearGradient>
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color="#9df0a2" />
          <ThemedText style={styles.loadingText}>Loading dashboard…</ThemedText>
        </View>
      </ThemedView>
    );
  }

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
            <ThemedText style={styles.headerSub}>Seller Dashboard</ThemedText>
          </View>
          <Pressable onPress={() => loadAnalytics(true)} style={styles.refreshBtn}>
            <Ionicons name="refresh" size={18} color="#9df0a2" />
          </Pressable>
        </View>
      </LinearGradient>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => loadAnalytics(true)} tintColor="#9df0a2" />
        }>

        {/* Error */}
        {error ? (
          <View style={styles.errorCard}>
            <Ionicons name="alert-circle-outline" size={16} color="#ffadb9" />
            <ThemedText style={styles.errorText}>{error}</ThemedText>
          </View>
        ) : null}

        {/* ── KPI cards ── */}
        <View style={styles.kpiGrid}>
          <KpiCard label="Total Revenue"   value={analytics.totalRevenue}  prefix="₹" decimals={0} icon="trending-up-outline"     color="#9df0a2" />
          <KpiCard label="Total Orders"    value={analytics.totalOrders}   decimals={0} icon="bag-handle-outline"         color="#60a5fa" />
          <KpiCard label="Delivery Rate"   value={analytics.deliveryRate}  suffix="%" decimals={0} icon="checkmark-circle-outline" color="#4ade80" />
          <KpiCard label="Avg Order Value" value={analytics.avgOrderValue} prefix="₹" decimals={0} icon="analytics-outline"        color="#facc15" />
        </View>

        {/* ── Tabs ── */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
          {ANALYTICS_TABS.map((tab) => {
            const active = tab.key === activeTab;
            return (
              <Pressable key={tab.key} onPress={() => switchTab(tab.key)}
                style={[styles.tabChip, active && styles.tabChipActive]}>
                <Ionicons name={tab.icon as any} size={12}
                  color={active ? '#9df0a2' : '#4a6e4c'} style={{ marginRight: 4 }} />
                <ThemedText style={[styles.tabText, active && styles.tabTextActive]}>
                  {tab.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* ── Tab content ── */}
        <Animated.View style={{ opacity: tabOpacity }}>

          {/* ── FULFILLMENT ── */}
          {activeTab === 'fulfillment' && (
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="layers-outline" size={14} color="#9df0a2" />
                <ThemedText style={styles.cardTitle}>Fulfillment Overview</ThemedText>
              </View>

              {analytics.totalItems === 0 ? (
                <EmptyState icon="bag-outline" message="No orders yet. Fulfillment data will appear here." />
              ) : (
                <>
                  {/* Segment visual */}
                  <View style={styles.segmentWrap}>
                    <SegmentBar segments={[
                      { value: analytics.newOrders,  color: '#4ade80', label: 'New' },
                      { value: analytics.inProgress, color: '#60a5fa', label: 'In Progress' },
                      { value: analytics.delivered,  color: '#facc15', label: 'Delivered' },
                      { value: analytics.cancelled,  color: '#f87171', label: 'Cancelled' },
                    ]} />
                  </View>

                  {/* Legend with bars */}
                  <View style={styles.legendWrap}>
                    <LegendRow label="New"         value={analytics.newOrders}  total={analytics.totalItems} color="#4ade80" />
                    <LegendRow label="In Progress" value={analytics.inProgress} total={analytics.totalItems} color="#60a5fa" />
                    <LegendRow label="Delivered"   value={analytics.delivered}  total={analytics.totalItems} color="#facc15" />
                    <LegendRow label="Cancelled"   value={analytics.cancelled}  total={analytics.totalItems} color="#f87171" />
                  </View>

                  {/* Stats pills */}
                  <View style={styles.pillRow}>
                    <View style={styles.pill}>
                      <ThemedText style={styles.pillVal}>{analytics.deliveryRate}%</ThemedText>
                      <ThemedText style={styles.pillLbl}>Delivery Rate</ThemedText>
                    </View>
                    <View style={styles.pill}>
                      <ThemedText style={styles.pillVal}>{analytics.avgItemsPerOrder.toFixed(1)}</ThemedText>
                      <ThemedText style={styles.pillLbl}>Avg Items/Order</ThemedText>
                    </View>
                    <View style={styles.pill}>
                      <ThemedText style={styles.pillVal}>{analytics.totalItems}</ThemedText>
                      <ThemedText style={styles.pillLbl}>Total Items</ThemedText>
                    </View>
                  </View>
                </>
              )}
            </View>
          )}

          {/* ── PAYMENT ── */}
          {activeTab === 'payment' && (
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="card-outline" size={14} color="#60a5fa" />
                <ThemedText style={styles.cardTitle}>Payment Summary</ThemedText>
              </View>

              {analytics.totalOrders === 0 ? (
                <EmptyState icon="card-outline" message="No payments yet." />
              ) : (
                <>
                  <View style={styles.segmentWrap}>
                    <SegmentBar segments={[
                      { value: analytics.paidOrders, color: '#34d399', label: 'Paid' },
                      { value: analytics.pendingPay,  color: '#fb923c', label: 'Pending' },
                      { value: analytics.failedPay,   color: '#f43f5e', label: 'Failed' },
                    ]} />
                  </View>

                  <View style={styles.legendWrap}>
                    <LegendRow label="Paid"    value={analytics.paidOrders} total={analytics.totalOrders} color="#34d399" />
                    <LegendRow label="Pending" value={analytics.pendingPay}  total={analytics.totalOrders} color="#fb923c" />
                    <LegendRow label="Failed"  value={analytics.failedPay}   total={analytics.totalOrders} color="#f43f5e" />
                  </View>

                  <View style={styles.pillRow}>
                    <View style={styles.pill}>
                      <ThemedText style={[styles.pillVal, { color: '#9df0a2' }]}>
                        ₹{analytics.totalRevenue.toFixed(0)}
                      </ThemedText>
                      <ThemedText style={styles.pillLbl}>Total Earned</ThemedText>
                    </View>
                    <View style={styles.pill}>
                      <ThemedText style={styles.pillVal}>₹{analytics.avgOrderValue.toFixed(0)}</ThemedText>
                      <ThemedText style={styles.pillLbl}>Avg Order</ThemedText>
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

          {/* ── INVENTORY ── */}
          {activeTab === 'inventory' && (
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="cube-outline" size={14} color="#facc15" />
                <ThemedText style={styles.cardTitle}>Inventory Health</ThemedText>
              </View>

              {analytics.totalListings === 0 ? (
                <EmptyState icon="cube-outline" message="No listings yet. Add products to see inventory data." />
              ) : (
                <>
                  {/* Ring + stats side by side */}
                  <View style={styles.ringRow}>
                    <RingProgress
                      pct={analytics.stockHealthPct}
                      color={analytics.stockHealthPct > 70 ? '#4ade80' : analytics.stockHealthPct > 40 ? '#facc15' : '#f87171'}
                      size={108}
                      label="Stock Health"
                    />
                    <View style={styles.ringStats}>
                      {[
                        { label: 'Healthy listings', value: analytics.healthyStock, color: '#4ade80' },
                        { label: 'Low stock (≤3)', value: analytics.lowStock, color: '#facc15' },
                        { label: 'Out of stock', value: analytics.outOfStock, color: '#f87171' },
                        { label: 'Total units', value: analytics.inStockUnits, color: '#9df0a2' },
                      ].map((r) => (
                        <View key={r.label} style={styles.ringStatRow}>
                          <View style={[styles.ringStatDot, { backgroundColor: r.color }]} />
                          <ThemedText style={styles.ringStatLabel}>{r.label}</ThemedText>
                          <ThemedText style={[styles.ringStatVal, { color: r.color }]}>{r.value}</ThemedText>
                        </View>
                      ))}
                    </View>
                  </View>

                  {/* Stacked inventory bars */}
                  <View style={styles.inventoryBarsWrap}>
                    <ThemedText style={styles.barSectionTitle}>Listings by status</ThemedText>
                    {[
                      { label: 'Healthy', value: analytics.healthyStock, max: analytics.totalListings, color: '#4ade80' },
                      { label: 'Low stock', value: analytics.lowStock, max: analytics.totalListings, color: '#facc15' },
                      { label: 'Out of stock', value: analytics.outOfStock, max: analytics.totalListings, color: '#f87171' },
                    ].map((bar, i) => (
                      <View key={bar.label} style={styles.namedBarRow}>
                        <ThemedText style={styles.namedBarLabel}>{bar.label}</ThemedText>
                        <View style={styles.namedBarTrack}>
                          <AnimatedBar
                            pct={bar.max > 0 ? (bar.value / bar.max) * 100 : 0}
                            color={bar.color}
                            delay={i * 100}
                          />
                        </View>
                        <ThemedText style={[styles.namedBarVal, { color: bar.color }]}>{bar.value}</ThemedText>
                      </View>
                    ))}
                  </View>
                </>
              )}
            </View>
          )}

          {/* ── TOP PRODUCTS ── */}
          {activeTab === 'top-products' && (
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="trophy-outline" size={14} color="#facc15" />
                <ThemedText style={styles.cardTitle}>Top Selling Products</ThemedText>
              </View>

              {analytics.topProducts.length === 0 ? (
                <EmptyState icon="trophy-outline" message="No sales data yet. Top products appear after your first sale!" />
              ) : (
                <View style={styles.topProductsList}>
                  {analytics.topProducts.map((p, i) => (
                    <View key={`${p.title}-${i}`} style={styles.topProductRow}>
                      {/* Rank + title */}
                      <View style={[styles.rankBadge, { backgroundColor: BAR_COLORS[i % BAR_COLORS.length] + '22' }]}>
                        <ThemedText style={[styles.rankText, { color: BAR_COLORS[i % BAR_COLORS.length] }]}>
                          #{i + 1}
                        </ThemedText>
                      </View>
                      <View style={styles.topProductInfo}>
                        <ThemedText numberOfLines={1} style={styles.topProductTitle}>{p.title}</ThemedText>
                        <AnimatedBar
                          pct={analytics.maxSold > 0 ? (p.sold / analytics.maxSold) * 100 : 0}
                          color={BAR_COLORS[i % BAR_COLORS.length]}
                          delay={i * 80}
                        />
                      </View>
                      <View style={styles.soldBadge}>
                        <ThemedText style={[styles.soldText, { color: BAR_COLORS[i % BAR_COLORS.length] }]}>
                          {p.sold}
                        </ThemedText>
                        <ThemedText style={styles.soldUnit}>sold</ThemedText>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* ── RECENT ORDERS ── */}
          {activeTab === 'recent-orders' && (
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="time-outline" size={14} color="#a78bfa" />
                <ThemedText style={styles.cardTitle}>Recent Orders</ThemedText>
              </View>

              {analytics.recentOrders.length === 0 ? (
                <EmptyState icon="receipt-outline" message="No recent orders yet." />
              ) : (
                analytics.recentOrders.map((order, i) => (
                  <LinearGradient
                    key={order.id}
                    colors={['#101e12', '#0c1510']}
                    style={[styles.orderCard, i < analytics.recentOrders.length - 1 && { marginBottom: 10 }]}>
                    {/* Top row */}
                    <View style={styles.orderTop}>
                      <View>
                        <ThemedText style={styles.orderId}>#{order.orderId.slice(-8).toUpperCase()}</ThemedText>
                        <ThemedText style={styles.orderDate}>
                          {new Date(order.createdAt).toLocaleDateString('en-IN', {
                            day: 'numeric', month: 'short', year: 'numeric',
                          })}
                        </ThemedText>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 4 }}>
                        <ThemedText style={styles.orderAmount}>₹{order.sellerSubtotal.toFixed(0)}</ThemedText>
                        <StatusBadge status={order.paymentStatus} />
                      </View>
                    </View>
                    {/* Items */}
                    {(order.items || []).length > 0 && (
                      <View style={styles.orderItems}>
                        {(order.items || []).slice(0, 3).map((item, j) => (
                          <View key={j} style={styles.orderItemRow}>
                            <StatusBadge status={item.fulfillmentStatus} />
                            <ThemedText numberOfLines={1} style={styles.orderItemTitle}>{item.title}</ThemedText>
                          </View>
                        ))}
                        {(order.items || []).length > 3 && (
                          <ThemedText style={styles.moreItems}>
                            +{(order.items || []).length - 3} more item(s)
                          </ThemedText>
                        )}
                      </View>
                    )}
                  </LinearGradient>
                ))
              )}
            </View>
          )}

        </Animated.View>

      </ScrollView>
    </ThemedView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#07100a' },
  headerGradient: { paddingTop: 58, paddingBottom: 10 },
  header: {
    paddingHorizontal: 14, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-between',
  },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  headerSub: { color: '#3a6040', fontSize: 11, fontWeight: '600', marginTop: 1 },
  backButton: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#0f1e10', borderWidth: 1, borderColor: '#1e3320',
    alignItems: 'center', justifyContent: 'center',
  },
  refreshBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#0f1e10', borderWidth: 1, borderColor: '#1e3320',
    alignItems: 'center', justifyContent: 'center',
  },
  headerSpacer: { width: 38 },
  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#3a6040', fontSize: 13, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 32, gap: 12 },

  // Error
  errorCard: {
    borderRadius: 10, borderWidth: 1, borderColor: '#6d2d36',
    backgroundColor: '#180810', paddingHorizontal: 12, paddingVertical: 10,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  errorText: { color: '#ffadb9', fontSize: 12, fontWeight: '600', flex: 1 },

  // KPI
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kpiCard: {
    width: '48.5%', borderRadius: 14, overflow: 'hidden',
    borderWidth: 1, borderColor: '#1a3020',
  },
  kpiGradient: { paddingHorizontal: 12, paddingVertical: 14, gap: 6 },
  kpiIconWrap: {
    width: 30, height: 30, borderRadius: 8, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', marginBottom: 2,
  },
  kpiValue: { fontSize: 20, fontWeight: '800' },
  kpiLabel: { color: '#3a6040', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },

  // Tabs
  tabsRow: { paddingVertical: 2, gap: 8 },
  tabChip: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 999, borderWidth: 1, borderColor: '#1a2e1c',
    backgroundColor: '#0d160e', paddingHorizontal: 12, paddingVertical: 8,
  },
  tabChipActive: { borderColor: '#9df0a2', backgroundColor: '#13271a' },
  tabText: { color: '#3a5a3c', fontSize: 11, fontWeight: '700' },
  tabTextActive: { color: '#9df0a2' },

  // Card
  card: {
    borderRadius: 16, borderWidth: 1, borderColor: '#1a3020',
    backgroundColor: '#0b1610', paddingHorizontal: 14, paddingVertical: 16,
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  cardTitle: { color: '#c8f0cc', fontSize: 14, fontWeight: '800' },

  // Segment bar
  segmentWrap: { marginBottom: 16 },
  segmentBarWrap: { flexDirection: 'row', height: 10, borderRadius: 8, overflow: 'hidden', backgroundColor: '#1a2e1c', gap: 2 },
  segmentBarSlice: { height: '100%' },

  // Legend
  legendWrap: { gap: 10, marginBottom: 14 },
  legendItem: { gap: 4 },
  legendDot: { width: 9, height: 9, borderRadius: 4.5 },
  legendLabel: { flex: 1, color: '#7aaa80', fontSize: 12 },
  legendValue: { color: '#c8f0cc', fontSize: 12, fontWeight: '700', minWidth: 24, textAlign: 'right' },
  legendPct: { color: '#3a6040', fontSize: 11, minWidth: 34, textAlign: 'right' },

  // Bar
  barTrack: { height: 6, borderRadius: 3, backgroundColor: '#1a2e1c', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3 },

  // Pills
  pillRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  pill: {
    flex: 1, backgroundColor: '#0f1e10', borderRadius: 10,
    borderWidth: 1, borderColor: '#1a3020', alignItems: 'center', paddingVertical: 10,
  },
  pillVal: { color: '#9df0a2', fontSize: 15, fontWeight: '800' },
  pillLbl: { color: '#3a6040', fontSize: 10, fontWeight: '600', marginTop: 2, textAlign: 'center' },

  // Wallet
  walletBtn: {
    marginTop: 14, borderRadius: 12, backgroundColor: '#9df0a2',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12,
  },
  walletBtnText: { color: '#0f1a12', fontSize: 13, fontWeight: '800' },

  // Ring
  ringRow: { flexDirection: 'row', alignItems: 'center', gap: 18, marginBottom: 20 },
  ringLabel: { color: '#3a6040', fontSize: 11, fontWeight: '600', marginTop: 6, textAlign: 'center' },
  ringStats: { flex: 1, gap: 8 },
  ringStatRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ringStatDot: { width: 8, height: 8, borderRadius: 4 },
  ringStatLabel: { flex: 1, color: '#7aaa80', fontSize: 11 },
  ringStatVal: { fontSize: 12, fontWeight: '700' },

  // Inventory bars
  inventoryBarsWrap: { gap: 10 },
  barSectionTitle: { color: '#3a6040', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  namedBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  namedBarLabel: { color: '#7aaa80', fontSize: 11, width: 72 },
  namedBarTrack: { flex: 1 },
  namedBarVal: { fontSize: 12, fontWeight: '700', width: 24, textAlign: 'right' },

  // Top products
  topProductsList: { gap: 12 },
  topProductRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rankBadge: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rankText: { fontSize: 11, fontWeight: '800' },
  topProductInfo: { flex: 1, gap: 6 },
  topProductTitle: { color: '#a8d0ac', fontSize: 12 },
  soldBadge: { alignItems: 'center', minWidth: 36 },
  soldText: { fontSize: 14, fontWeight: '800' },
  soldUnit: { color: '#3a6040', fontSize: 9, fontWeight: '600' },

  // Orders
  orderCard: { borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#1a3020' },
  orderTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  orderId: { color: '#a8d0ac', fontSize: 13, fontWeight: '800', letterSpacing: 0.4 },
  orderDate: { color: '#3a6040', fontSize: 11, marginTop: 2 },
  orderAmount: { color: '#9df0a2', fontSize: 15, fontWeight: '800' },
  orderItems: { marginTop: 10, gap: 6 },
  orderItemRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#0d1810', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 4 },
  orderItemTitle: { color: '#7aaa80', fontSize: 10, flex: 1 },
  moreItems: { color: '#3a6040', fontSize: 10, fontWeight: '600' },

  // Badge
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: '700' },

  // Empty
  emptyWrap: { alignItems: 'center', paddingVertical: 28, gap: 10 },
  emptyIconWrap: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#0f1e10', borderWidth: 1, borderColor: '#1a3020',
    alignItems: 'center', justifyContent: 'center',
  },
  emptyMsg: { color: '#2e4a30', fontSize: 12, textAlign: 'center', lineHeight: 18, paddingHorizontal: 20 },
});
