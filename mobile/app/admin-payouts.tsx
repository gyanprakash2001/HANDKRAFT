import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import {
  AdminPayoutDashboardResponse,
  AdminPayoutEntry,
  adminMarkPayoutsPaid,
  claimAdminReadyPayouts,
  getAdminPayoutDashboard,
  getProfile,
  releaseAdminDuePayouts,
  SellerPayoutStatus,
} from '@/utils/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type AdminFilter = 'all' | 'processing' | SellerPayoutStatus;

const FILTERS: { key: AdminFilter; label: string; color: string }[] = [
  { key: 'all', label: 'All', color: '#8ab4d8' },
  { key: 'processing', label: '⚡ Pay Requests', color: '#c4b0ff' },
  { key: 'ready_for_payout', label: 'Ready', color: '#78c8ff' },
  { key: 'on_hold', label: 'On Hold', color: '#f5d16e' },
  { key: 'awaiting_delivery', label: 'Incoming', color: '#9ab8d4' },
  { key: 'paid', label: 'Paid', color: '#7ef5a0' },
  { key: 'failed', label: 'Failed', color: '#ff8fa0' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(amount: number) {
  return `₹${Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function statusMeta(status: string) {
  switch (status) {
    case 'paid':             return { bg: '#0e2218', border: '#2a6a3f', text: '#7ef5a0', label: 'PAID' };
    case 'on_hold':          return { bg: '#1a1500', border: '#5c4e00', text: '#f5d16e', label: 'ON HOLD' };
    case 'ready_for_payout': return { bg: '#0a1a2e', border: '#2a5580', text: '#78c8ff', label: 'READY' };
    case 'processing':       return { bg: '#100c2a', border: '#483a90', text: '#c4b0ff', label: 'PAYOUT REQUESTED' };
    case 'awaiting_delivery':return { bg: '#111820', border: '#2e4460', text: '#9ab8d4', label: 'AWAITING' };
    case 'failed':           return { bg: '#200a10', border: '#6a2838', text: '#ff8fa0', label: 'FAILED' };
    default:                 return { bg: '#111620', border: '#303a50', text: '#8a96a8', label: String(status).toUpperCase() };
  }
}

// ─── Processing payout row (prominent, with "Mark as Paid" CTA) ───────────────

function ProcessingPayoutRow({
  entry,
  onMarkPaid,
  paying,
}: {
  entry: AdminPayoutEntry;
  onMarkPaid: (id: string) => void;
  paying: boolean;
}) {
  const bank = (entry.seller as any).bankDetails;
  return (
    <LinearGradient
      colors={['#100c2a', '#14102e']}
      style={styles.processingRow}
    >
      {/* Header */}
      <View style={styles.processingRowHead}>
        <View style={styles.processingOrderWrap}>
          <Ionicons name="flash" size={12} color="#c4b0ff" />
          <ThemedText style={styles.processingOrderId}>
            #{entry.orderId.slice(-8).toUpperCase()}
          </ThemedText>
        </View>
        <ThemedText style={styles.processingNet}>
          {formatCurrency(entry.split.netPayoutAmount)}
        </ThemedText>
      </View>

      {/* Seller info */}
      <View style={styles.processingSellerBlock}>
        <ThemedText style={styles.processingSellerName}>{entry.seller.name || 'Unknown seller'}</ThemedText>
        <ThemedText style={styles.processingSellerEmail}>{entry.seller.email || '—'}</ThemedText>
        <ThemedText style={styles.processingKyc}>
          KYC: {String(entry.seller.kycStatus || 'pending').toUpperCase()}
        </ThemedText>
      </View>

      {/* Bank/UPI details for admin */}
      {bank ? (
        <View style={styles.bankBox}>
          <ThemedText style={styles.bankBoxTitle}>💳 Payment Details</ThemedText>
          {bank.upiId ? (
            <ThemedText style={styles.bankLine}>UPI: {bank.upiId}</ThemedText>
          ) : null}
          {bank.accountNumberMasked ? (
            <ThemedText style={styles.bankLine}>A/C: {bank.accountNumberMasked}  IFSC: {bank.ifsc || '—'}</ThemedText>
          ) : null}
          {bank.bankName ? (
            <ThemedText style={styles.bankLine}>{bank.bankName}{bank.branch ? ` · ${bank.branch}` : ''}</ThemedText>
          ) : null}
          {bank.accountHolderName ? (
            <ThemedText style={styles.bankLine}>Name: {bank.accountHolderName}</ThemedText>
          ) : null}
          {bank.razorpayLinkedAccountId ? (
            <ThemedText style={styles.bankLine}>Razorpay: {bank.razorpayLinkedAccountId}</ThemedText>
          ) : null}
        </View>
      ) : (
        <View style={styles.bankBoxMissing}>
          <Ionicons name="warning-outline" size={12} color="#f5d16e" />
          <ThemedText style={styles.bankMissingText}>Seller has no bank/UPI on file — contact them before paying.</ThemedText>
        </View>
      )}

      {/* Breakdown */}
      <View style={styles.processingBreakdown}>
        <ThemedText style={styles.bdLabel}>Sale amount:</ThemedText>
        <ThemedText style={styles.bdValue}>{formatCurrency(entry.split.itemSubtotal)}</ThemedText>
        <ThemedText style={styles.bdLabel}>Shipping deducted:</ThemedText>
        <ThemedText style={[styles.bdValue, styles.bdNeg]}>−{formatCurrency(entry.split.shippingDeduction)}</ThemedText>
        <ThemedText style={styles.bdLabel}>
          Platform fee (₹{entry.split.platformFeeFlat ?? entry.split.platformFeeAmount} incl. ₹{entry.split.csrAmount ?? 1} CSR):
        </ThemedText>
        <ThemedText style={[styles.bdValue, styles.bdNeg]}>−{formatCurrency(entry.split.platformFeeAmount)}</ThemedText>
        <View style={styles.bdDivider} />
        <ThemedText style={[styles.bdLabel, styles.bdLabelBold]}>Pay this to seller:</ThemedText>
        <ThemedText style={[styles.bdValue, styles.bdHighlight]}>{formatCurrency(entry.split.netPayoutAmount)}</ThemedText>
      </View>

      {/* Requested at */}
      {entry.payout.initiatedAt ? (
        <ThemedText style={styles.requestedAt}>
          Requested: {formatDate(entry.payout.initiatedAt)}
        </ThemedText>
      ) : null}

      {/* Mark as Paid CTA */}
      <Pressable
        style={({ pressed }) => [styles.markPaidBtn, (pressed || paying) && { opacity: 0.8 }]}
        onPress={() => onMarkPaid(entry.id)}
        disabled={paying}
      >
        {paying
          ? <ActivityIndicator color="#0a1e12" size="small" />
          : <Ionicons name="checkmark-circle" size={16} color="#0a1e12" />
        }
        <ThemedText style={styles.markPaidText}>{paying ? 'Settling…' : 'Mark as Paid'}</ThemedText>
      </Pressable>
    </LinearGradient>
  );
}

// ─── Standard payout row ──────────────────────────────────────────────────────

function PayoutRow({ entry, isLast }: { entry: AdminPayoutEntry; isLast: boolean }) {
  const meta = statusMeta(entry.status);
  return (
    <View style={[styles.row, isLast && styles.rowLast]}>
      <View style={styles.rowHead}>
        <ThemedText style={styles.orderId}>#{entry.orderId.slice(-8).toUpperCase()}</ThemedText>
        <View style={[styles.statusPill, { backgroundColor: meta.bg, borderColor: meta.border }]}>
          <ThemedText style={[styles.statusText, { color: meta.text }]}>{meta.label}</ThemedText>
        </View>
      </View>
      <ThemedText style={styles.sellerName}>{entry.seller.name || 'Unknown seller'}</ThemedText>
      <ThemedText style={styles.sellerEmail}>{entry.seller.email || '—'}</ThemedText>
      <View style={styles.rowMetaLine}>
        <ThemedText style={styles.metaLabel}>Net payout</ThemedText>
        <ThemedText style={styles.metaValue}>{formatCurrency(entry.split.netPayoutAmount)}</ThemedText>
      </View>
      <View style={styles.rowMetaLine}>
        <ThemedText style={styles.metaLabel}>Hold release</ThemedText>
        <ThemedText style={styles.metaValue}>{formatDate(entry.holdUntil)}</ThemedText>
      </View>
      <View style={styles.rowMetaLine}>
        <ThemedText style={styles.metaLabel}>KYC</ThemedText>
        <ThemedText style={styles.metaValue}>{String(entry.seller.kycStatus || 'pending').toUpperCase()}</ThemedText>
      </View>
      {entry.payout.failureReason ? (
        <ThemedText style={styles.failureReason}>{entry.payout.failureReason}</ThemedText>
      ) : null}
      {entry.payout.paidAt ? (
        <ThemedText style={styles.paidAt}>Paid: {formatDate(entry.payout.paidAt)}</ThemedText>
      ) : null}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function AdminPayoutsScreen() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<AdminPayoutDashboardResponse | null>(null);
  const [activeFilter, setActiveFilter] = useState<AdminFilter>('processing');

  const loadDashboard = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      setError(null);
      const me = await getProfile();
      const adminFlag = Boolean(me?.isAdmin);
      setIsAdmin(adminFlag);
      if (!adminFlag) { setDashboard(null); return; }
      const payload = await getAdminPayoutDashboard({ page: 1, limit: 120 });
      setDashboard(payload);
    } catch (err: any) {
      setError(err?.message || 'Failed to load admin payout dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  const filteredRows = useMemo(() => {
    const rows = dashboard?.payouts || [];
    if (activeFilter === 'all') return rows;
    return rows.filter(e => e.status === activeFilter);
  }, [activeFilter, dashboard?.payouts]);

  const processingRows = useMemo(
    () => (dashboard?.payouts || []).filter(e => e.status === 'processing'),
    [dashboard?.payouts]
  );

  // Release due payouts from hold
  const handleRelease = useCallback(async () => {
    try {
      setReleasing(true);
      const result = await releaseAdminDuePayouts(200);
      const released = Number(result?.result?.releasedCount || result?.result?.pendingActionCount || 0);
      await loadDashboard(true);
      Alert.alert('Released', `Released ${released} payout(s) from hold.`);
    } catch (err: any) {
      Alert.alert('Release failed', err?.message || 'Unable to run release.');
    } finally {
      setReleasing(false);
    }
  }, [loadDashboard]);

  // Admin marks a single processing payout as paid
  const handleMarkPaid = useCallback((payoutId: string) => {
    const entry = (dashboard?.payouts || []).find(e => e.id === payoutId);
    if (!entry) return;

    Alert.alert(
      'Confirm Payment',
      `Mark ${formatCurrency(entry.split.netPayoutAmount)} payout for ${entry.seller.name || 'seller'} as PAID?\n\nThis confirms you've manually transferred the funds to them.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, Mark as Paid',
          onPress: async () => {
            try {
              setPayingId(payoutId);
              const result = await adminMarkPayoutsPaid({ payoutIds: [payoutId] });
              setDashboard(result.dashboard);
              Alert.alert(
                '✅ Payment Settled',
                `${formatCurrency(result.settledAmount)} marked as paid successfully.`
              );
            } catch (err: any) {
              Alert.alert('Failed', err?.message || 'Unable to mark as paid.');
            } finally {
              setPayingId(null);
            }
          },
        },
      ]
    );
  }, [dashboard?.payouts]);

  const summary = dashboard?.summary;
  const policy = (dashboard as any)?.policy;

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.headerIconBtn}>
            <Ionicons name="chevron-back" size={22} color="#f0f6ff" />
          </Pressable>
          <ThemedText style={styles.headerTitle}>Admin Wallet Ops</ThemedText>
          <View style={styles.headerIconBtn} />
        </View>
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color="#7ef5a0" />
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerIconBtn}>
          <Ionicons name="chevron-back" size={22} color="#f0f6ff" />
        </Pressable>
        <ThemedText style={styles.headerTitle}>Admin Wallet Ops</ThemedText>
        <Pressable onPress={() => loadDashboard(true)} style={styles.headerIconBtn}>
          <Ionicons name="refresh" size={18} color="#7ef5a0" />
        </Pressable>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadDashboard(true)} tintColor="#7ef5a0" />}
      >
        {error ? (
          <View style={styles.errorCard}>
            <ThemedText style={styles.errorText}>{error}</ThemedText>
          </View>
        ) : null}

        {!isAdmin ? (
          <View style={styles.guardCard}>
            <Ionicons name="lock-closed-outline" size={22} color="#ff8fa0" />
            <ThemedText style={styles.guardTitle}>Admin Access Required</ThemedText>
            <ThemedText style={styles.guardText}>This screen is for admin users only.</ThemedText>
          </View>
        ) : (
          <>
            {/* ── Policy banner ─────────────────────────────────── */}
            {policy ? (
              <View style={styles.policyBar}>
                <Ionicons name="information-circle-outline" size={12} color="#5a7a9a" />
                <ThemedText style={styles.policyText}>
                  Hold: {policy.holdDaysAfterDelivery}d · Platform fee: ₹{policy.platformFeeFlat} (incl. ₹{policy.csrAmount} CSR)
                </ThemedText>
              </View>
            ) : null}

            {/* ── Payout request alert (if any) ────────────────── */}
            {processingRows.length > 0 ? (
              <LinearGradient colors={['#100c2a', '#140e30']} style={styles.alertBanner}>
                <Ionicons name="flash" size={14} color="#c4b0ff" />
                <ThemedText style={styles.alertBannerText}>
                  {processingRows.length} seller{processingRows.length !== 1 ? 's' : ''} requesting payout — action needed
                </ThemedText>
              </LinearGradient>
            ) : null}

            {/* ── Summary grid ──────────────────────────────────── */}
            <View style={styles.summaryGrid}>
              <View style={styles.summaryCard}>
                <ThemedText style={[styles.summaryValue, { color: '#c4b0ff' }]}>{formatCurrency((summary as any)?.processingAmount || 0)}</ThemedText>
                <ThemedText style={styles.summaryLabel}>Pay Requests</ThemedText>
              </View>
              <View style={styles.summaryCard}>
                <ThemedText style={styles.summaryValue}>{formatCurrency(summary?.claimableAmount || 0)}</ThemedText>
                <ThemedText style={styles.summaryLabel}>Ready (unrequested)</ThemedText>
              </View>
              <View style={styles.summaryCard}>
                <ThemedText style={[styles.summaryValue, { color: '#f5d16e' }]}>{formatCurrency(summary?.onHoldAmount || 0)}</ThemedText>
                <ThemedText style={styles.summaryLabel}>On Hold</ThemedText>
              </View>
              <View style={styles.summaryCard}>
                <ThemedText style={[styles.summaryValue, { color: '#7ef5a0' }]}>{formatCurrency(summary?.paidAmount || 0)}</ThemedText>
                <ThemedText style={styles.summaryLabel}>Total Paid Out</ThemedText>
              </View>
            </View>

            {/* ── Action buttons ────────────────────────────────── */}
            <View style={styles.actionRow}>
              <Pressable style={styles.actionBtn} onPress={handleRelease} disabled={releasing}>
                {releasing ? <ActivityIndicator color="#0f1a12" size="small" /> : <Ionicons name="time-outline" size={14} color="#0f1a12" />}
                <ThemedText style={styles.actionBtnText}>Release Held Funds</ThemedText>
              </Pressable>
            </View>

            {/* ── Filter tabs ───────────────────────────────────── */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {FILTERS.map(f => {
                const active = activeFilter === f.key;
                const count = f.key === 'all'
                  ? (dashboard?.payouts || []).length
                  : (dashboard?.payouts || []).filter(e => e.status === f.key).length;
                return (
                  <Pressable
                    key={f.key}
                    style={[styles.filterChip, active && { borderColor: f.color, backgroundColor: f.color + '18' }]}
                    onPress={() => setActiveFilter(f.key)}
                  >
                    <ThemedText style={[styles.filterText, active && { color: f.color }]}>
                      {f.label} {count > 0 ? `(${count})` : ''}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* ── Processing payouts: full-detail cards ─────────── */}
            {activeFilter === 'processing' || activeFilter === 'all' ? (
              filteredRows.filter(e => e.status === 'processing').length > 0 ? (
                <View style={styles.processingSection}>
                  <ThemedText style={styles.processingSectionTitle}>⚡ Pending Payout Requests</ThemedText>
                  {filteredRows
                    .filter(e => e.status === 'processing')
                    .map(entry => (
                      <ProcessingPayoutRow
                        key={entry.id}
                        entry={entry}
                        onMarkPaid={handleMarkPaid}
                        paying={payingId === entry.id}
                      />
                    ))}
                </View>
              ) : activeFilter === 'processing' ? (
                <View style={styles.emptyWrap}>
                  <Ionicons name="checkmark-done-circle-outline" size={28} color="#2a4a2e" />
                  <ThemedText style={styles.emptyText}>No pending payout requests 🎉</ThemedText>
                </View>
              ) : null
            ) : null}

            {/* ── Other rows ────────────────────────────────────── */}
            {filteredRows.filter(e => activeFilter !== 'processing' || e.status !== 'processing').length > 0 ? (
              <View style={styles.listCard}>
                <ThemedText style={styles.listTitle}>All Operations ({filteredRows.filter(e => activeFilter !== 'processing' || e.status !== 'processing').length})</ThemedText>
                {filteredRows
                  .filter(e => activeFilter !== 'processing' || e.status !== 'processing')
                  .map((entry, idx, arr) => (
                    <PayoutRow key={entry.id} entry={entry} isLast={idx === arr.length - 1} />
                  ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050a0e' },
  header: {
    paddingTop: 62, paddingHorizontal: 14, paddingBottom: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  headerIconBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#0e1520', borderWidth: 1, borderColor: '#1e3048',
    alignItems: 'center', justifyContent: 'center',
  },
  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1 },
  contentInner: { paddingHorizontal: 14, paddingBottom: 30, gap: 10 },

  errorCard: {
    borderRadius: 10, borderWidth: 1, borderColor: '#5a2030',
    backgroundColor: '#1a0810', paddingHorizontal: 12, paddingVertical: 10,
  },
  errorText: { color: '#ff8fa0', fontSize: 12, fontWeight: '700' },

  guardCard: {
    borderRadius: 12, borderWidth: 1, borderColor: '#3a2230',
    backgroundColor: '#160e12', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 18, paddingHorizontal: 14,
  },
  guardTitle: { color: '#ffdadf', fontSize: 14, fontWeight: '800' },
  guardText: { color: '#c0a0a8', fontSize: 12, textAlign: 'center' },

  // Policy bar
  policyBar: {
    flexDirection: 'row', gap: 6, alignItems: 'center',
    borderRadius: 8, borderWidth: 1, borderColor: '#1a2a3a',
    backgroundColor: '#090f18', paddingHorizontal: 10, paddingVertical: 7,
  },
  policyText: { color: '#4a6a8a', fontSize: 10 },

  // Alert banner
  alertBanner: {
    flexDirection: 'row', gap: 8, alignItems: 'center',
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: '#3a2a70',
  },
  alertBannerText: { color: '#c4b0ff', fontSize: 12, fontWeight: '800' },

  // Summary grid
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  summaryCard: {
    width: '48%', borderRadius: 12, borderWidth: 1, borderColor: '#1a2a3a',
    backgroundColor: '#090f18', paddingHorizontal: 12, paddingVertical: 10,
  },
  summaryValue: { color: '#7ef5a0', fontSize: 15, fontWeight: '800' },
  summaryLabel: { marginTop: 3, color: '#3a5a7a', fontSize: 10, fontWeight: '700' },

  // Action row
  actionRow: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    flex: 1, borderRadius: 12, backgroundColor: '#7ef5a0',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 11,
  },
  actionBtnText: { color: '#0f1a12', fontSize: 11, fontWeight: '800' },

  // Filter chips
  filterRow: { gap: 8 },
  filterChip: {
    borderRadius: 999, borderWidth: 1, borderColor: '#1e3048',
    backgroundColor: '#0a1520', paddingHorizontal: 12, paddingVertical: 8,
  },
  filterText: { color: '#5a7a9a', fontSize: 10, fontWeight: '700' },

  // Processing section
  processingSection: { gap: 8 },
  processingSectionTitle: { color: '#c4b0ff', fontSize: 12, fontWeight: '800' },

  processingRow: {
    borderRadius: 14, borderWidth: 1, borderColor: '#3a2a70',
    padding: 14, gap: 8,
  },
  processingRowHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  processingOrderWrap: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  processingOrderId: { color: '#e0d8ff', fontSize: 13, fontWeight: '800' },
  processingNet: { color: '#c4b0ff', fontSize: 16, fontWeight: '900' },

  processingSellerBlock: { gap: 2 },
  processingSellerName: { color: '#d0c8ff', fontSize: 12, fontWeight: '700' },
  processingSellerEmail: { color: '#7a6aaa', fontSize: 10 },
  processingKyc: { color: '#6a5a9a', fontSize: 9 },

  bankBox: {
    borderRadius: 10, borderWidth: 1, borderColor: '#2a1e5a',
    backgroundColor: '#0c0820', padding: 10, gap: 3,
  },
  bankBoxTitle: { color: '#a0a0ff', fontSize: 10, fontWeight: '800', marginBottom: 4 },
  bankLine: { color: '#8080c0', fontSize: 10 },

  bankBoxMissing: {
    flexDirection: 'row', gap: 6, alignItems: 'center',
    borderRadius: 8, borderWidth: 1, borderColor: '#4a3500',
    backgroundColor: '#1a1000', padding: 8,
  },
  bankMissingText: { color: '#b09030', fontSize: 10, flex: 1 },

  processingBreakdown: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 2,
    borderRadius: 8, borderWidth: 1, borderColor: '#2a1e50',
    backgroundColor: '#080616', padding: 8,
  },
  bdLabel: { color: '#5a4a8a', fontSize: 9, width: '60%' },
  bdLabelBold: { color: '#c0b0e8', fontWeight: '800' },
  bdValue: { color: '#9080c8', fontSize: 9, fontWeight: '700', width: '40%', textAlign: 'right' },
  bdNeg: { color: '#e07070' },
  bdHighlight: { color: '#c4b0ff', fontSize: 11, fontWeight: '900' },
  bdDivider: { width: '100%', height: 1, backgroundColor: '#2a1e50', marginVertical: 2 },

  requestedAt: { color: '#4a3a7a', fontSize: 9 },

  markPaidBtn: {
    borderRadius: 12, backgroundColor: '#7ef5a0',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12, marginTop: 4,
  },
  markPaidText: { color: '#0a1e12', fontSize: 13, fontWeight: '800' },

  // Standard list
  listCard: {
    borderRadius: 12, borderWidth: 1, borderColor: '#1a2a3a',
    backgroundColor: '#090f18', paddingHorizontal: 12, paddingVertical: 10,
  },
  listTitle: { color: '#d0e8ff', fontSize: 11, fontWeight: '800', marginBottom: 8 },

  emptyWrap: { alignItems: 'center', paddingVertical: 20, gap: 6 },
  emptyText: { color: '#3a5a3e', fontSize: 13, fontWeight: '700' },

  // Standard row
  row: {
    borderBottomWidth: 1, borderBottomColor: '#121e2c',
    paddingVertical: 10, gap: 3,
  },
  rowLast: { borderBottomWidth: 0 },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  orderId: { color: '#c0d8f0', fontSize: 12, fontWeight: '800' },
  sellerName: { color: '#a0c0e0', fontSize: 12, fontWeight: '700' },
  sellerEmail: { color: '#5a7a9a', fontSize: 10, marginBottom: 2 },
  statusPill: {
    borderRadius: 999, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3,
  },
  statusText: { fontSize: 8, fontWeight: '800' },
  rowMetaLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  metaLabel: { color: '#4a6a8a', fontSize: 10 },
  metaValue: { color: '#c0d8f0', fontSize: 10, fontWeight: '700' },
  failureReason: { color: '#ff8fa0', fontSize: 10, fontWeight: '700', marginTop: 2 },
  paidAt: { color: '#3a6a4e', fontSize: 9, marginTop: 2 },
});
