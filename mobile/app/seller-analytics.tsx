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

const TABS: { key: AnalyticsTabKey; label: string; icon: string }[] = [
  { key: 'fulfillment',    label: 'Fulfillment',    icon: 'layers-outline' },
  { key: 'payment',        label: 'Payment',         icon: 'card-outline' },
  { key: 'inventory',      label: 'Inventory',       icon: 'cube-outline' },
  { key: 'top-products',   label: 'Top Products',    icon: 'trophy-outline' },
  { key: 'recent-orders',  label: 'Recent Orders',   icon: 'time-outline' },
];

// ─── Animated counter ────────────────────────────────────────────────────────
function Counter({ to, prefix = '', suffix = '', decimals = 0, style }: {
  to: number; prefix?: string; suffix?: string; decimals?: number; style?: any;
}) {
  const val = useRef(new Animated.Value(0)).current;
  const [text, setText] = useState('0');
  useEffect(() => {
    val.setValue(0);
    const a = Animated.timing(val, { toValue: to, duration: 1000, useNativeDriver: false });
    const id = val.addListener(({ value: v }) => setText(v.toFixed(decimals)));
    a.start();
    return () => { a.stop(); val.removeListener(id); };
  }, [to, decimals, val]);
  return <ThemedText style={style}>{prefix}{text}{suffix}</ThemedText>;
}

// ─── KPI Card ────────────────────────────────────────────────────────────────
function KpiCard({ label, value, prefix, suffix, decimals = 0, icon, accent }: {
  label: string; value: number; prefix?: string; suffix?: string;
  decimals?: number; icon: string; accent: string;
}) {
  const scale = useRef(new Animated.Value(0.88)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: 1, tension: 65, friction: 9, useNativeDriver: true }).start();
  }, [scale]);
  return (
    <Animated.View style={[styles.kpiCard, { transform: [{ scale }] }]}>
      <View style={styles.kpiIconRow}>
        <View style={[styles.kpiIcon, { borderColor: accent + '55', backgroundColor: accent + '18' }]}>
          <Ionicons name={icon as any} size={14} color={accent} />
        </View>
      </View>
      <Counter to={value} prefix={prefix} suffix={suffix} decimals={decimals}
        style={[styles.kpiValue, { color: accent }]} />
      <ThemedText style={styles.kpiLabel}>{label}</ThemedText>
    </Animated.View>
  );
}

// ─── Animated bar fill ───────────────────────────────────────────────────────
function AnimBar({ pct, color, delay = 0, height = 6 }: {
  pct: number; color: string; delay?: number; height?: number;
}) {
  const w = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const t = setTimeout(() => {
      Animated.timing(w, { toValue: Math.max(pct, 0), duration: 850, useNativeDriver: false }).start();
    }, delay);
    return () => clearTimeout(t);
  }, [pct, delay, w]);
  const width = w.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });
  return (
    <View style={[styles.barTrack, { height }]}>
      <Animated.View style={[styles.barFill, { width, backgroundColor: color, height }]} />
    </View>
  );
}

// ─── Segment slice (each as its own component → safe hooks) ─────────────────
function SegSlice({ pct, color, isFirst, isLast, delay }: {
  pct: number; color: string; isFirst: boolean; isLast: boolean; delay: number;
}) {
  const w = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(w, { toValue: pct, duration: 900, delay, useNativeDriver: false }).start();
  }, [pct, delay, w]);
  const width = w.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });
  return (
    <Animated.View style={[
      styles.segSlice,
      { backgroundColor: color, width },
      isFirst && { borderTopLeftRadius: 6, borderBottomLeftRadius: 6 },
      isLast && { borderTopRightRadius: 6, borderBottomRightRadius: 6 },
    ]} />
  );
}

function SegBar({ segs }: { segs: { value: number; color: string; label: string }[] }) {
  const total = segs.reduce((s, g) => s + g.value, 0);
  if (total === 0) return (
    <View style={[styles.segTrack, { backgroundColor: '#1a1a1a', borderRadius: 6 }]}>
      <ThemedText style={{ color: '#444', fontSize: 10, alignSelf: 'center', paddingTop: 2 }}>No data</ThemedText>
    </View>
  );
  return (
    <View style={styles.segTrack}>
      {segs.map((s, i) => (
        <SegSlice key={s.label}
          pct={(s.value / total) * 100}
          color={s.color}
          isFirst={i === 0}
          isLast={i === segs.length - 1}
          delay={i * 70}
        />
      ))}
    </View>
  );
}

// ─── Ring (pure RN border trick) ─────────────────────────────────────────────
function Ring({ pct, color, size = 96 }: { pct: number; color: string; size?: number }) {
  const sw = size * 0.12;
  const c = Math.min(Math.max(pct, 0), 100);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: sw, borderColor: '#1c1c1c' }} />
      <View style={{
        position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: sw,
        borderTopColor: color,
        borderRightColor: c > 25 ? color : 'transparent',
        borderBottomColor: c > 50 ? color : 'transparent',
        borderLeftColor: c > 75 ? color : 'transparent',
        transform: [{ rotate: '-90deg' }],
      }} />
      <ThemedText style={{ color, fontSize: size * 0.18, fontWeight: '800' }}>{Math.round(c)}%</ThemedText>
    </View>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────
const BADGE_MAP: Record<string, { label: string; bg: string; text: string; border: string }> = {
  completed:  { label: 'Paid',        bg: '#0c2012', text: '#4ade80', border: '#1e4a2a' },
  pending:    { label: 'Pending',     bg: '#231700', text: '#facc15', border: '#4a3500' },
  failed:     { label: 'Failed',      bg: '#200808', text: '#f87171', border: '#4a1515' },
  refunded:   { label: 'Refunded',    bg: '#15102a', text: '#a78bfa', border: '#2d2060' },
  delivered:  { label: 'Delivered',   bg: '#08182a', text: '#60a5fa', border: '#153456' },
  shipped:    { label: 'Shipped',     bg: '#0e0e2a', text: '#818cf8', border: '#1e1e5a' },
  processing: { label: 'Processing',  bg: '#161a08', text: '#a3e635', border: '#2a3510' },
  packed:     { label: 'Packed',      bg: '#1a1a08', text: '#d9f99d', border: '#343408' },
  new:        { label: 'New',         bg: '#1a1a1a', text: '#e2e8f0', border: '#333' },
  cancelled:  { label: 'Cancelled',   bg: '#200808', text: '#fb7185', border: '#4a1020' },
};
function Badge({ status }: { status: string }) {
  const c = BADGE_MAP[status] || { label: status, bg: '#1a1a1a', text: '#e2e8f0', border: '#333' };
  return (
    <View style={[styles.badge, { backgroundColor: c.bg, borderColor: c.border }]}>
      <ThemedText style={[styles.badgeText, { color: c.text }]}>{c.label}</ThemedText>
    </View>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function Empty({ icon, msg }: { icon: string; msg: string }) {
  return (
    <View style={styles.emptyWrap}>
      <View style={styles.emptyIconBox}>
        <Ionicons name={icon as any} size={28} color="#444" />
      </View>
      <ThemedText style={styles.emptyMsg}>{msg}</ThemedText>
    </View>
  );
}

// ─── Interactive Order Card ───────────────────────────────────────────────────
function OrderCard({ order }: { order: SellerOrder }) {
  const [expanded, setExpanded] = useState(false);
  const height = useRef(new Animated.Value(0)).current;
  const rotate = useRef(new Animated.Value(0)).current;

  const toggle = () => {
    const toH = expanded ? 0 : (order.items || []).length * 38;
    Animated.parallel([
      Animated.timing(height, { toValue: toH, duration: 250, useNativeDriver: false }),
      Animated.timing(rotate, { toValue: expanded ? 0 : 1, duration: 250, useNativeDriver: true }),
    ]).start();
    setExpanded(!expanded);
  };

  const spin = rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

  return (
    <View style={styles.orderCard}>
      <Pressable onPress={toggle} style={({ pressed }) => [styles.orderTop, pressed && { opacity: 0.8 }]}>
        <View style={styles.orderLeft}>
          <ThemedText style={styles.orderId}>#{order.orderId.slice(-8).toUpperCase()}</ThemedText>
          <ThemedText style={styles.orderDate}>
            {new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </ThemedText>
        </View>
        <View style={styles.orderRight}>
          <ThemedText style={styles.orderAmt}>₹{order.sellerSubtotal.toFixed(0)}</ThemedText>
          <Badge status={order.paymentStatus} />
        </View>
        <Animated.View style={{ transform: [{ rotate: spin }], marginLeft: 6 }}>
          <Ionicons name="chevron-down" size={14} color="#666" />
        </Animated.View>
      </Pressable>

      <Animated.View style={{ height, overflow: 'hidden' }}>
        <View style={styles.orderItemsWrap}>
          {(order.items || []).map((item, j) => (
            <View key={j} style={styles.orderItemRow}>
              <Badge status={item.fulfillmentStatus} />
              <ThemedText numberOfLines={1} style={styles.orderItemTitle}>{item.title}</ThemedText>
              <ThemedText style={styles.orderItemQty}>×{item.quantity}</ThemedText>
            </View>
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

// ─── Interactive Legend Row ───────────────────────────────────────────────────
function LegRow({ label, value, total, color, onPress, selected }: {
  label: string; value: number; total: number; color: string;
  onPress: () => void; selected: boolean;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  const scale = useRef(new Animated.Value(1)).current;
  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.96, duration: 80, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 80, useNativeDriver: true }),
    ]).start();
    onPress();
  };
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={handlePress}
        style={[styles.legRow, selected && { backgroundColor: color + '14', borderColor: color + '55' }]}>
        <View style={[styles.legDot, { backgroundColor: color }]} />
        <ThemedText style={[styles.legLabel, selected && { color: '#fff' }]} numberOfLines={1}>{label}</ThemedText>
        <ThemedText style={[styles.legVal, { color }]}>{value}</ThemedText>
        <ThemedText style={styles.legPct}>{Math.round(pct)}%</ThemedText>
        <View style={styles.legBarWrap}>
          <AnimBar pct={pct} color={color} height={5} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function SellerAnalyticsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sellerOrders, setSellerOrders] = useState<SellerOrder[]>([]);
  const [sellerItems, setSellerItems] = useState<ProductItem[]>([]);
  const [activeTab, setActiveTab] = useState<AnalyticsTabKey>('fulfillment');
  const [selectedSeg, setSelectedSeg] = useState<string | null>(null);
  const tabOpacity = useRef(new Animated.Value(1)).current;

  const switchTab = (key: AnalyticsTabKey) => {
    if (key === activeTab) return;
    setSelectedSeg(null);
    Animated.sequence([
      Animated.timing(tabOpacity, { toValue: 0, duration: 100, useNativeDriver: true }),
      Animated.timing(tabOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
    setActiveTab(key);
  };

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      setError(null);
      const [dash, orders] = await Promise.all([getProfileDashboard(), getSellerOrders()]);
      setSellerItems(dash.listedItems || []);
      setSellerOrders(orders.orders || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const A = useMemo(() => {
    const items = sellerOrders.flatMap((o) => o.items || []);
    const totalOrders = sellerOrders.length;
    const totalItems = items.length;
    const revenue = sellerOrders.reduce((s, o) => s + (Number(o.sellerSubtotal) || 0), 0);

    const newI  = items.filter((i) => i.fulfillmentStatus === 'new').length;
    const inProg = items.filter((i) => ['processing', 'packed', 'shipped'].includes(i.fulfillmentStatus)).length;
    const deliv  = items.filter((i) => i.fulfillmentStatus === 'delivered').length;
    const canc   = items.filter((i) => i.fulfillmentStatus === 'cancelled').length;

    const paid    = sellerOrders.filter((o) => o.paymentStatus === 'completed').length;
    const pend    = sellerOrders.filter((o) => o.paymentStatus === 'pending').length;
    const fail    = sellerOrders.filter((o) => o.paymentStatus === 'failed').length;

    const avgVal  = totalOrders > 0 ? revenue / totalOrders : 0;
    const avgIpo  = totalOrders > 0 ? totalItems / totalOrders : 0;
    const delRate = totalItems > 0 ? Math.round((deliv / totalItems) * 100) : 0;

    const lowStock  = sellerItems.filter((i) => Number(i.stock) > 0 && Number(i.stock) <= 3).length;
    const outStock  = sellerItems.filter((i) => Number(i.stock) <= 0).length;
    const totalUnits = sellerItems.reduce((s, i) => s + Math.max(0, Number(i.stock) || 0), 0);
    const healthy   = Math.max(0, sellerItems.length - lowStock - outStock);
    const healthPct = sellerItems.length > 0 ? Math.round((healthy / sellerItems.length) * 100) : 0;

    const soldMap = new Map<string, number>();
    for (const oi of items) soldMap.set(oi.title, (soldMap.get(oi.title) || 0) + oi.quantity);
    const topProducts = Array.from(soldMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([title, sold]) => ({ title, sold }));
    const maxSold = topProducts.length > 0 ? topProducts[0].sold : 1;

    const recentOrders = sellerOrders.slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10);

    return {
      totalOrders, totalItems, revenue, newI, inProg, deliv, canc,
      paid, pend, fail, avgVal, avgIpo, delRate,
      lowStock, outStock, totalUnits, healthy, healthPct,
      totalListings: sellerItems.length, topProducts, maxSold, recentOrders,
    };
  }, [sellerItems, sellerOrders]);

  const PRODUCT_COLORS = ['#9df0a2', '#60a5fa', '#facc15', '#f472b6', '#a78bfa'];

  if (loading) {
    return (
      <ThemedView style={styles.root}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <ThemedText style={styles.headerTitle}>Analytics</ThemedText>
          <View style={styles.headerBtn} />
        </View>
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color="#9df0a2" />
          <ThemedText style={styles.loadingTxt}>Loading dashboard…</ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.root}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <View style={{ alignItems: 'center' }}>
          <ThemedText style={styles.headerTitle}>Analytics</ThemedText>
          <ThemedText style={styles.headerSub}>Seller Dashboard</ThemedText>
        </View>
        <Pressable onPress={() => load(true)} style={styles.headerBtn}>
          <Ionicons name="refresh" size={18} color="#9df0a2" />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor="#9df0a2" />}>

        {error ? (
          <View style={styles.errorCard}>
            <Ionicons name="alert-circle-outline" size={15} color="#f87171" />
            <ThemedText style={styles.errorTxt}>{error}</ThemedText>
          </View>
        ) : null}

        {/* ── KPI Grid ── */}
        <View style={styles.kpiGrid}>
          <KpiCard label="Revenue"     value={A.revenue}     prefix="₹"  icon="trending-up-outline"     accent="#9df0a2" />
          <KpiCard label="Orders"      value={A.totalOrders}              icon="bag-handle-outline"      accent="#60a5fa" />
          <KpiCard label="Delivery %"  value={A.delRate}     suffix="%"  icon="checkmark-circle-outline" accent="#facc15" />
          <KpiCard label="Avg Order"   value={A.avgVal}      prefix="₹"  icon="analytics-outline"       accent="#f472b6" />
        </View>

        {/* ── Tabs ── */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
          {TABS.map((t) => {
            const active = t.key === activeTab;
            return (
              <Pressable key={t.key} onPress={() => switchTab(t.key)}
                style={({ pressed }) => [styles.tab, active && styles.tabActive, pressed && { opacity: 0.8 }]}>
                <Ionicons name={t.icon as any} size={11} color={active ? '#9df0a2' : '#666'} />
                <ThemedText style={[styles.tabTxt, active && styles.tabTxtActive]}>{t.label}</ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* ── Content ── */}
        <Animated.View style={{ opacity: tabOpacity }}>

          {/* ══ FULFILLMENT ══ */}
          {activeTab === 'fulfillment' && (
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Ionicons name="layers-outline" size={13} color="#9df0a2" />
                <ThemedText style={styles.cardTitle}>Fulfillment Overview</ThemedText>
                <View style={styles.totalPill}>
                  <ThemedText style={styles.totalPillTxt}>{A.totalItems} items</ThemedText>
                </View>
              </View>

              {A.totalItems === 0 ? (
                <Empty icon="bag-outline" msg="No order items yet. Data appears after your first sale." />
              ) : (
                <>
                  {/* Interactive segment bar */}
                  <SegBar segs={[
                    { value: A.newI,   color: '#9df0a2', label: 'New' },
                    { value: A.inProg, color: '#60a5fa', label: 'In Progress' },
                    { value: A.deliv,  color: '#facc15', label: 'Delivered' },
                    { value: A.canc,   color: '#f87171', label: 'Cancelled' },
                  ]} />
                  <ThemedText style={styles.tapHint}>Tap a row to highlight</ThemedText>

                  {/* Interactive legend */}
                  <View style={styles.legWrap}>
                    {[
                      { label: 'New items',         value: A.newI,   color: '#9df0a2' },
                      { label: 'In Progress',       value: A.inProg, color: '#60a5fa' },
                      { label: 'Delivered',         value: A.deliv,  color: '#facc15' },
                      { label: 'Cancelled',         value: A.canc,   color: '#f87171' },
                    ].map((row) => (
                      <LegRow
                        key={row.label}
                        label={row.label}
                        value={row.value}
                        total={A.totalItems}
                        color={row.color}
                        selected={selectedSeg === row.label}
                        onPress={() => setSelectedSeg(selectedSeg === row.label ? null : row.label)}
                      />
                    ))}
                  </View>

                  {/* Stats pills */}
                  <View style={styles.pillRow}>
                    <View style={styles.pill}>
                      <ThemedText style={[styles.pillVal, { color: '#facc15' }]}>{A.delRate}%</ThemedText>
                      <ThemedText style={styles.pillLbl}>Delivery Rate</ThemedText>
                    </View>
                    <View style={styles.pill}>
                      <ThemedText style={styles.pillVal}>{A.avgIpo.toFixed(1)}</ThemedText>
                      <ThemedText style={styles.pillLbl}>Avg Items / Order</ThemedText>
                    </View>
                    <View style={styles.pill}>
                      <ThemedText style={[styles.pillVal, { color: '#9df0a2' }]}>{A.totalOrders}</ThemedText>
                      <ThemedText style={styles.pillLbl}>Total Orders</ThemedText>
                    </View>
                  </View>
                </>
              )}
            </View>
          )}

          {/* ══ PAYMENT ══ */}
          {activeTab === 'payment' && (
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Ionicons name="card-outline" size={13} color="#60a5fa" />
                <ThemedText style={styles.cardTitle}>Payment Summary</ThemedText>
                <View style={styles.totalPill}>
                  <ThemedText style={styles.totalPillTxt}>{A.totalOrders} orders</ThemedText>
                </View>
              </View>

              {A.totalOrders === 0 ? (
                <Empty icon="card-outline" msg="No payment data yet." />
              ) : (
                <>
                  <SegBar segs={[
                    { value: A.paid, color: '#4ade80', label: 'Paid' },
                    { value: A.pend, color: '#fb923c', label: 'Pending' },
                    { value: A.fail, color: '#f43f5e', label: 'Failed' },
                  ]} />
                  <ThemedText style={styles.tapHint}>Tap a row to highlight</ThemedText>

                  <View style={styles.legWrap}>
                    {[
                      { label: 'Paid orders',     value: A.paid, color: '#4ade80' },
                      { label: 'Pending payment', value: A.pend, color: '#fb923c' },
                      { label: 'Failed',          value: A.fail, color: '#f43f5e' },
                    ].map((row) => (
                      <LegRow
                        key={row.label}
                        label={row.label}
                        value={row.value}
                        total={A.totalOrders}
                        color={row.color}
                        selected={selectedSeg === row.label}
                        onPress={() => setSelectedSeg(selectedSeg === row.label ? null : row.label)}
                      />
                    ))}
                  </View>

                  <View style={styles.pillRow}>
                    <View style={styles.pill}>
                      <ThemedText style={[styles.pillVal, { color: '#9df0a2' }]}>₹{A.revenue.toFixed(0)}</ThemedText>
                      <ThemedText style={styles.pillLbl}>Total Earned</ThemedText>
                    </View>
                    <View style={styles.pill}>
                      <ThemedText style={styles.pillVal}>₹{A.avgVal.toFixed(0)}</ThemedText>
                      <ThemedText style={styles.pillLbl}>Avg Order</ThemedText>
                    </View>
                  </View>
                </>
              )}

              <Pressable
                style={({ pressed }) => [styles.walletBtn, pressed && { opacity: 0.85 }]}
                onPress={() => router.push('/seller-payouts')}>
                <Ionicons name="wallet-outline" size={15} color="#000" />
                <ThemedText style={styles.walletBtnTxt}>Open Seller Wallet</ThemedText>
              </Pressable>
            </View>
          )}

          {/* ══ INVENTORY ══ */}
          {activeTab === 'inventory' && (
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Ionicons name="cube-outline" size={13} color="#facc15" />
                <ThemedText style={styles.cardTitle}>Inventory Health</ThemedText>
                <View style={styles.totalPill}>
                  <ThemedText style={styles.totalPillTxt}>{A.totalListings} listings</ThemedText>
                </View>
              </View>

              {A.totalListings === 0 ? (
                <Empty icon="cube-outline" msg="No listings yet. Upload products to track inventory." />
              ) : (
                <>
                  {/* Ring + stats */}
                  <View style={styles.ringRow}>
                    <Ring
                      pct={A.healthPct}
                      color={A.healthPct > 70 ? '#4ade80' : A.healthPct > 40 ? '#facc15' : '#f87171'}
                      size={104}
                    />
                    <View style={styles.ringStats}>
                      {[
                        { label: 'Healthy',     value: A.healthy,    color: '#4ade80' },
                        { label: 'Low stock',   value: A.lowStock,   color: '#facc15' },
                        { label: 'Out of stock',value: A.outStock,   color: '#f87171' },
                        { label: 'Total units', value: A.totalUnits, color: '#9df0a2' },
                      ].map((r) => (
                        <View key={r.label} style={styles.rStat}>
                          <View style={[styles.rDot, { backgroundColor: r.color }]} />
                          <ThemedText style={styles.rLbl}>{r.label}</ThemedText>
                          <ThemedText style={[styles.rVal, { color: r.color }]}>{r.value}</ThemedText>
                        </View>
                      ))}
                    </View>
                  </View>

                  {/* Interactive inventory bars */}
                  <ThemedText style={styles.secLbl}>STOCK STATUS BREAKDOWN</ThemedText>
                  {[
                    { label: 'Healthy listings', value: A.healthy,  max: A.totalListings, color: '#4ade80' },
                    { label: 'Low stock (≤3)',   value: A.lowStock, max: A.totalListings, color: '#facc15' },
                    { label: 'Out of stock',     value: A.outStock, max: A.totalListings, color: '#f87171' },
                  ].map((b, i) => (
                    <Pressable
                      key={b.label}
                      style={({ pressed }) => [styles.invRow, pressed && { opacity: 0.8 },
                        selectedSeg === b.label && { backgroundColor: b.color + '12', borderColor: b.color + '44' }]}
                      onPress={() => setSelectedSeg(selectedSeg === b.label ? null : b.label)}>
                      <View style={[styles.invDot, { backgroundColor: b.color }]} />
                      <ThemedText style={styles.invLbl}>{b.label}</ThemedText>
                      <View style={styles.invBarWrap}>
                        <AnimBar pct={b.max > 0 ? (b.value / b.max) * 100 : 0} color={b.color} delay={i * 100} />
                      </View>
                      <ThemedText style={[styles.invVal, { color: b.color }]}>{b.value}</ThemedText>
                    </Pressable>
                  ))}
                </>
              )}
            </View>
          )}

          {/* ══ TOP PRODUCTS ══ */}
          {activeTab === 'top-products' && (
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Ionicons name="trophy-outline" size={13} color="#facc15" />
                <ThemedText style={styles.cardTitle}>Top Selling Products</ThemedText>
              </View>

              {A.topProducts.length === 0 ? (
                <Empty icon="trophy-outline" msg="No sales data yet. Top products appear after your first sale!" />
              ) : (
                <View style={styles.prodList}>
                  {A.topProducts.map((p, i) => (
                    <Pressable
                      key={`${p.title}-${i}`}
                      style={({ pressed }) => [styles.prodRow, pressed && { opacity: 0.85 },
                        selectedSeg === p.title && { backgroundColor: PRODUCT_COLORS[i % PRODUCT_COLORS.length] + '14', borderColor: PRODUCT_COLORS[i % PRODUCT_COLORS.length] + '55' }]}
                      onPress={() => setSelectedSeg(selectedSeg === p.title ? null : p.title)}>
                      {/* Rank */}
                      <View style={[styles.rankBox, { backgroundColor: PRODUCT_COLORS[i % PRODUCT_COLORS.length] + '1a' }]}>
                        <ThemedText style={[styles.rankTxt, { color: PRODUCT_COLORS[i % PRODUCT_COLORS.length] }]}>
                          #{i + 1}
                        </ThemedText>
                      </View>
                      {/* Info + bar */}
                      <View style={styles.prodInfo}>
                        <ThemedText numberOfLines={1} style={styles.prodTitle}>{p.title}</ThemedText>
                        <AnimBar
                          pct={A.maxSold > 0 ? (p.sold / A.maxSold) * 100 : 0}
                          color={PRODUCT_COLORS[i % PRODUCT_COLORS.length]}
                          delay={i * 80}
                          height={5}
                        />
                      </View>
                      {/* Sold count */}
                      <View style={styles.soldBox}>
                        <ThemedText style={[styles.soldNum, { color: PRODUCT_COLORS[i % PRODUCT_COLORS.length] }]}>
                          {p.sold}
                        </ThemedText>
                        <ThemedText style={styles.soldLbl}>sold</ThemedText>
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* ══ RECENT ORDERS ══ */}
          {activeTab === 'recent-orders' && (
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Ionicons name="time-outline" size={13} color="#a78bfa" />
                <ThemedText style={styles.cardTitle}>Recent Orders</ThemedText>
                <View style={styles.totalPill}>
                  <ThemedText style={styles.totalPillTxt}>{A.recentOrders.length} shown</ThemedText>
                </View>
              </View>
              <ThemedText style={styles.tapHint}>Tap an order to expand items</ThemedText>

              {A.recentOrders.length === 0 ? (
                <Empty icon="receipt-outline" msg="No recent orders yet." />
              ) : (
                <View style={styles.ordersList}>
                  {A.recentOrders.map((o) => <OrderCard key={o.id} order={o} />)}
                </View>
              )}
            </View>
          )}

        </Animated.View>
      </ScrollView>
    </ThemedView>
  );
}

// ─── Styles — App theme: #000 bg, #fff borders, #9df0a2 accent ───────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },

  // Header
  header: {
    paddingTop: 60, paddingBottom: 12, paddingHorizontal: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderBottomWidth: 1, borderBottomColor: '#ffffff',
    backgroundColor: '#000000',
  },
  headerBtn: {
    width: 38, height: 38, borderRadius: 19,
    borderWidth: 1, borderColor: '#ffffff', backgroundColor: '#000000',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { color: '#ffffff', fontSize: 18, fontWeight: '800' },
  headerSub: { color: '#666', fontSize: 10, fontWeight: '600', marginTop: 1, textAlign: 'center' },
  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingTxt: { color: '#666', fontSize: 13 },

  scroll: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 40, gap: 12 },

  // Error
  errorCard: {
    borderRadius: 10, borderWidth: 1, borderColor: '#4a1515',
    backgroundColor: '#200808', paddingHorizontal: 12, paddingVertical: 10,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  errorTxt: { color: '#f87171', fontSize: 12, fontWeight: '600', flex: 1 },

  // KPI
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kpiCard: {
    width: '48.5%', borderRadius: 12, borderWidth: 1, borderColor: '#ffffff',
    backgroundColor: '#000000', paddingHorizontal: 12, paddingVertical: 14,
  },
  kpiIconRow: { marginBottom: 8 },
  kpiIcon: {
    width: 28, height: 28, borderRadius: 7, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  kpiValue: { fontSize: 22, fontWeight: '800', letterSpacing: 0.2 },
  kpiLabel: { color: '#666', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 3 },

  // Tabs
  tabsRow: { paddingVertical: 2, gap: 8 },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 999, borderWidth: 1, borderColor: '#333',
    backgroundColor: '#000000', paddingHorizontal: 12, paddingVertical: 8,
  },
  tabActive: { borderColor: '#ffffff', backgroundColor: '#1a1a1a' },
  tabTxt: { color: '#555', fontSize: 11, fontWeight: '700' },
  tabTxtActive: { color: '#ffffff' },

  // Card
  card: {
    borderRadius: 14, borderWidth: 1, borderColor: '#ffffff',
    backgroundColor: '#000000', paddingHorizontal: 14, paddingVertical: 16,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 14 },
  cardTitle: { color: '#ffffff', fontSize: 14, fontWeight: '800', flex: 1 },
  totalPill: {
    borderRadius: 999, borderWidth: 1, borderColor: '#333',
    backgroundColor: '#111', paddingHorizontal: 8, paddingVertical: 3,
  },
  totalPillTxt: { color: '#888', fontSize: 10, fontWeight: '700' },

  tapHint: { color: '#444', fontSize: 10, fontWeight: '600', marginBottom: 10, marginTop: 6 },

  // Segment bar
  segTrack: { flexDirection: 'row', height: 12, backgroundColor: '#1a1a1a', borderRadius: 6, overflow: 'hidden', gap: 1 },
  segSlice: { height: '100%' },

  // Legend rows
  legWrap: { gap: 6, marginTop: 8, marginBottom: 12 },
  legRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 10, borderWidth: 1, borderColor: 'transparent',
    paddingHorizontal: 10, paddingVertical: 9, backgroundColor: '#0a0a0a',
  },
  legDot: { width: 9, height: 9, borderRadius: 4.5, flexShrink: 0 },
  legLabel: { color: '#888', fontSize: 12, width: 88 },
  legVal: { fontSize: 13, fontWeight: '800', minWidth: 22, textAlign: 'right' },
  legPct: { color: '#555', fontSize: 11, minWidth: 34, textAlign: 'right' },
  legBarWrap: { flex: 1 },

  // Stat pills
  pillRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  pill: {
    flex: 1, borderRadius: 10, borderWidth: 1, borderColor: '#222',
    backgroundColor: '#0a0a0a', alignItems: 'center', paddingVertical: 10,
  },
  pillVal: { color: '#e0e0e0', fontSize: 15, fontWeight: '800' },
  pillLbl: { color: '#555', fontSize: 10, fontWeight: '600', marginTop: 2, textAlign: 'center' },

  // Wallet button
  walletBtn: {
    marginTop: 14, borderRadius: 12, borderWidth: 1, borderColor: '#9df0a2',
    backgroundColor: '#9df0a2', flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 7, paddingVertical: 12,
  },
  walletBtnTxt: { color: '#000000', fontSize: 13, fontWeight: '800' },

  // Ring
  ringRow: { flexDirection: 'row', alignItems: 'center', gap: 20, marginBottom: 20 },
  ringStats: { flex: 1, gap: 9 },
  rStat: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rDot: { width: 8, height: 8, borderRadius: 4 },
  rLbl: { flex: 1, color: '#888', fontSize: 11 },
  rVal: { fontSize: 12, fontWeight: '700' },

  // Inventory bars
  secLbl: { color: '#444', fontSize: 10, fontWeight: '700', letterSpacing: 0.8, marginBottom: 8 },
  invRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10,
    borderWidth: 1, borderColor: 'transparent', paddingHorizontal: 10, paddingVertical: 10,
    marginBottom: 6,
  },
  invDot: { width: 8, height: 8, borderRadius: 4 },
  invLbl: { color: '#888', fontSize: 11, width: 86 },
  invBarWrap: { flex: 1 },
  invVal: { fontSize: 13, fontWeight: '800', minWidth: 22, textAlign: 'right' },

  // Bar
  barTrack: { borderRadius: 4, backgroundColor: '#1a1a1a', overflow: 'hidden' },
  barFill: { borderRadius: 4 },

  // Top products
  prodList: { gap: 10 },
  prodRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 10, borderWidth: 1, borderColor: '#222',
    backgroundColor: '#0a0a0a', paddingHorizontal: 10, paddingVertical: 10,
  },
  rankBox: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rankTxt: { fontSize: 11, fontWeight: '800' },
  prodInfo: { flex: 1, gap: 6 },
  prodTitle: { color: '#ccc', fontSize: 12 },
  soldBox: { alignItems: 'center', minWidth: 36 },
  soldNum: { fontSize: 15, fontWeight: '800' },
  soldLbl: { color: '#555', fontSize: 9, fontWeight: '600' },

  // Orders
  ordersList: { gap: 8 },
  orderCard: {
    borderRadius: 12, borderWidth: 1, borderColor: '#ffffff',
    backgroundColor: '#000000', overflow: 'hidden',
  },
  orderTop: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 12,
  },
  orderLeft: { flex: 1 },
  orderId: { color: '#ffffff', fontSize: 13, fontWeight: '800', letterSpacing: 0.4 },
  orderDate: { color: '#666', fontSize: 11, marginTop: 2 },
  orderRight: { alignItems: 'flex-end', gap: 5 },
  orderAmt: { color: '#9df0a2', fontSize: 15, fontWeight: '800' },
  orderItemsWrap: {
    paddingHorizontal: 12, paddingBottom: 10,
    borderTopWidth: 1, borderTopColor: '#1a1a1a',
    paddingTop: 8, gap: 6,
  },
  orderItemRow: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: '#0a0a0a', borderRadius: 7,
    paddingHorizontal: 8, paddingVertical: 6,
  },
  orderItemTitle: { flex: 1, color: '#888', fontSize: 11 },
  orderItemQty: { color: '#555', fontSize: 11, fontWeight: '700' },

  // Badge
  badge: { borderRadius: 6, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: '700' },

  // Empty
  emptyWrap: { alignItems: 'center', paddingVertical: 30, gap: 10 },
  emptyIconBox: {
    width: 52, height: 52, borderRadius: 26,
    borderWidth: 1, borderColor: '#222', backgroundColor: '#0a0a0a',
    alignItems: 'center', justifyContent: 'center',
  },
  emptyMsg: { color: '#444', fontSize: 12, textAlign: 'center', lineHeight: 18, paddingHorizontal: 24 },
});
