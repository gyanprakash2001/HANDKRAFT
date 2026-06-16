import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
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
  getAdminPayoutDashboard,
  getProfile,
  releaseAdminDuePayouts,
  SellerPayoutStatus,
} from '@/utils/api';

const SUPPORT_PHONE = '7619189174';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(v: string | null | undefined) {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusColor(status: string) {
  const m: Record<string, { text: string; border: string; bg: string }> = {
    paid:              { text: '#7ef5a0', border: '#2a6a3f', bg: '#0e2218' },
    on_hold:           { text: '#f5d16e', border: '#5c4e00', bg: '#1a1500' },
    ready_for_payout:  { text: '#78c8ff', border: '#2a5580', bg: '#0a1a2e' },
    processing:        { text: '#c4b0ff', border: '#483a90', bg: '#100c2a' },
    awaiting_delivery: { text: '#9ab8d4', border: '#2e4460', bg: '#111820' },
    failed:            { text: '#ff8fa0', border: '#6a2838', bg: '#200a10' },
  };
  return m[status] ?? { text: '#8a96a8', border: '#303a50', bg: '#111620' };
}

// ─── Processing Request Card (full-detail) ────────────────────────────────────

function PayoutRequestCard({
  entry,
  onMarkPaid,
  loading,
}: {
  entry: AdminPayoutEntry;
  onMarkPaid: (id: string) => void;
  loading: boolean;
}) {
  const bank = entry.seller.bankDetails;
  const [showDetails, setShowDetails] = useState(true);

  return (
    <LinearGradient colors={['#0e0b28', '#130f30']} style={styles.requestCard}>
      {/* Header */}
      <View style={styles.requestHead}>
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <View style={styles.urgentDot} />
          <ThemedText style={styles.requestOrderId}>Order #{entry.orderId.slice(-8).toUpperCase()}</ThemedText>
        </View>
        <ThemedText style={styles.requestAmount}>{fmt(entry.split.netPayoutAmount)}</ThemedText>
      </View>

      {/* Seller info */}
      <View style={styles.sellerInfo}>
        <ThemedText style={styles.sellerName}>{entry.seller.name || 'Unknown Seller'}</ThemedText>
        <ThemedText style={styles.sellerEmail}>{entry.seller.email || '—'}</ThemedText>
        <ThemedText style={styles.sellerKyc}>
          KYC: {String(entry.seller.kycStatus || 'pending').toUpperCase()}
        </ThemedText>
        {entry.payout.initiatedAt ? (
          <ThemedText style={styles.requestedAt}>Requested: {fmtDate(entry.payout.initiatedAt)}</ThemedText>
        ) : null}
      </View>

      {/* Bank / UPI payment details */}
      <Pressable onPress={() => setShowDetails(p => !p)} style={styles.bankToggle}>
        <Ionicons name={showDetails ? 'chevron-up' : 'card'} size={12} color="#9090e0" />
        <ThemedText style={styles.bankToggleText}>
          {showDetails ? 'Hide Payment Details' : 'Show Payment Details'}
        </ThemedText>
      </Pressable>

      {showDetails ? (
        bank ? (
          <View style={styles.bankBox}>
            <ThemedText style={styles.bankBoxTitle}>💳 Where to Send Money</ThemedText>
            {bank.accountType?.toLowerCase() === 'upi' && bank.upiId ? (
              <BankLine icon="phone-portrait-outline" label="UPI ID" value={bank.upiId} />
            ) : null}
            {bank.accountNumberMasked ? (
              <BankLine icon="card-outline" label="Account No." value={bank.accountNumberMasked} />
            ) : null}
            {bank.ifsc ? (
              <BankLine icon="business-outline" label="IFSC" value={bank.ifsc} />
            ) : null}
            {bank.bankName ? (
              <BankLine icon="library-outline" label="Bank" value={`${bank.bankName}${bank.branch ? ` – ${bank.branch}` : ''}`} />
            ) : null}
            {bank.accountHolderName ? (
              <BankLine icon="person-outline" label="Name" value={bank.accountHolderName} />
            ) : null}
            {bank.razorpayLinkedAccountId ? (
              <BankLine icon="link-outline" label="Razorpay" value={bank.razorpayLinkedAccountId} />
            ) : null}
          </View>
        ) : (
          <View style={styles.noBankBox}>
            <Ionicons name="warning-outline" size={13} color="#f5d16e" />
            <ThemedText style={styles.noBankText}>
              Seller has no bank/UPI details on file. Contact them before paying.
            </ThemedText>
            <Pressable onPress={() => Linking.openURL(`tel:${SUPPORT_PHONE}`)}>
              <ThemedText style={styles.noBankCall}>Call {SUPPORT_PHONE}</ThemedText>
            </Pressable>
          </View>
        )
      ) : null}

      {/* Amount breakdown */}
      <View style={styles.breakdownBox}>
        <BdRow label="Seller's sale amount" value={fmt(entry.split.itemSubtotal)} />
        <BdRow label="Shipping deducted" value={`−${fmt(entry.split.shippingDeduction)}`} neg />
        <BdRow
          label={`Platform fee (₹${(entry.split.platformFeeFlat ?? entry.split.platformFeeAmount ?? 8).toFixed(0)} incl. ₹${(entry.split.csrAmount ?? 1).toFixed(0)} CSR)`}
          value={`−${fmt(entry.split.platformFeeAmount)}`}
          neg
        />
        <View style={styles.breakdownLine} />
        <BdRow label="PAY THIS AMOUNT" value={fmt(entry.split.netPayoutAmount)} bold />
      </View>

      {/* Mark as Paid CTA */}
      <Pressable
        onPress={() => onMarkPaid(entry.id)}
        disabled={loading}
        style={({ pressed }) => [styles.markPaidBtn, (pressed || loading) && { opacity: 0.8 }]}
      >
        {loading
          ? <ActivityIndicator color="#0a1e12" size="small" />
          : <Ionicons name="checkmark-circle" size={18} color="#0a1e12" />
        }
        <ThemedText style={styles.markPaidText}>
          {loading ? 'Processing…' : `Mark as Paid — ${fmt(entry.split.netPayoutAmount)}`}
        </ThemedText>
      </Pressable>
      <ThemedText style={styles.markPaidHint}>
        Click this AFTER you've transferred the money to the seller
      </ThemedText>
    </LinearGradient>
  );
}

function BankLine({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.bankLine}>
      <Ionicons name={icon as any} size={11} color="#6060c0" />
      <ThemedText style={styles.bankLineLabel}>{label}:</ThemedText>
      <ThemedText style={styles.bankLineValue}>{value}</ThemedText>
    </View>
  );
}

function BdRow({ label, value, neg, bold }: { label: string; value: string; neg?: boolean; bold?: boolean }) {
  return (
    <View style={styles.bdRow}>
      <ThemedText style={[styles.bdLabel, bold && styles.bdLabelBold]}>{label}</ThemedText>
      <ThemedText style={[styles.bdValue, neg && styles.bdNeg, bold && styles.bdBold]}>{value}</ThemedText>
    </View>
  );
}

// ─── Standard row (non-processing) ───────────────────────────────────────────

function StandardRow({ entry, isLast }: { entry: AdminPayoutEntry; isLast: boolean }) {
  const sc = statusColor(entry.status);
  return (
    <View style={[styles.stdRow, isLast && { borderBottomWidth: 0 }]}>
      <View style={styles.stdRowHead}>
        <View>
          <ThemedText style={styles.stdOrderId}>#{entry.orderId.slice(-8).toUpperCase()}</ThemedText>
          <ThemedText style={styles.stdSeller}>{entry.seller.name || 'Unknown'}</ThemedText>
          <ThemedText style={styles.stdEmail}>{entry.seller.email || '—'}</ThemedText>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <ThemedText style={styles.stdNet}>{fmt(entry.split.netPayoutAmount)}</ThemedText>
          <View style={[styles.pill, { backgroundColor: sc.bg, borderColor: sc.border }]}>
            <ThemedText style={[styles.pillText, { color: sc.text }]}>{entry.status.replace(/_/g, ' ').toUpperCase()}</ThemedText>
          </View>
        </View>
      </View>
      {entry.payout.paidAt ? <ThemedText style={styles.paidAtText}>Paid: {fmtDate(entry.payout.paidAt)}</ThemedText> : null}
      {entry.payout.referenceId ? <ThemedText style={styles.refText}>Ref: {entry.payout.referenceId}</ThemedText> : null}
      {entry.payout.failureReason ? <ThemedText style={styles.failText}>{entry.payout.failureReason}</ThemedText> : null}
    </View>
  );
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

const FILTERS: { key: string; label: string; color: string }[] = [
  { key: 'processing',        label: '⚡ Pay Requests', color: '#c4b0ff' },
  { key: 'all',               label: 'All',             color: '#8ab4d8' },
  { key: 'ready_for_payout',  label: 'Ready',           color: '#78c8ff' },
  { key: 'on_hold',           label: 'On Hold',         color: '#f5d16e' },
  { key: 'awaiting_delivery', label: 'Incoming',        color: '#9ab8d4' },
  { key: 'paid',              label: 'Paid',            color: '#7ef5a0' },
  { key: 'failed',            label: 'Failed',          color: '#ff8fa0' },
];

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
  const [filter, setFilter] = useState('processing');

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      setError(null);
      const me = await getProfile();
      const adminFlag = Boolean(me?.isAdmin);
      setIsAdmin(adminFlag);
      if (!adminFlag) { setDashboard(null); return; }
      const data = await getAdminPayoutDashboard({ page: 1, limit: 120 });
      setDashboard(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load admin dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Filter
  const filteredRows = useMemo(() => {
    const rows = dashboard?.payouts || [];
    return filter === 'all' ? rows : rows.filter(e => e.status === filter);
  }, [filter, dashboard?.payouts]);

  const processingRows = useMemo(() => (dashboard?.payouts || []).filter(e => e.status === 'processing'), [dashboard?.payouts]);

  // Release holds
  const handleRelease = useCallback(async () => {
    try {
      setReleasing(true);
      const result = await releaseAdminDuePayouts(200);
      const count = Number((result as any)?.result?.releasedCount || 0);
      await load(true);
      Alert.alert('Done', `Released ${count} payout(s) from hold.`);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not release holds.');
    } finally {
      setReleasing(false);
    }
  }, [load]);

  // Admin marks one payout as paid
  const handleMarkPaid = useCallback((payoutId: string) => {
    const entry = (dashboard?.payouts || []).find(e => e.id === payoutId);
    if (!entry) return;

    Alert.alert(
      '✅ Confirm Payment Settled',
      `Confirm you have transferred ${fmt(entry.split.netPayoutAmount)} to ${entry.seller.name || 'the seller'}?\n\nThis cannot be undone.`,
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
                `${fmt(result.settledAmount)} marked as paid. The seller's wallet has been updated.`
              );
            } catch (e: any) {
              Alert.alert('Failed', e?.message || 'Could not mark as paid.');
            } finally {
              setPayingId(null);
            }
          },
        },
      ]
    );
  }, [dashboard?.payouts]);

  const s = dashboard?.summary;
  const policy = (dashboard as any)?.policy;

  if (loading) {
    return (
      <ThemedView style={styles.screen}>
        <Header onBack={() => router.back()} onRefresh={() => {}} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#7ef5a0" />
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.screen}>
      <Header onBack={() => router.back()} onRefresh={() => load(true)} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor="#7ef5a0" />}
      >
        {error ? (
          <View style={styles.errorCard}>
            <Ionicons name="alert-circle-outline" size={13} color="#ff8fa0" />
            <ThemedText style={styles.errorText}>{error}</ThemedText>
          </View>
        ) : null}

        {!isAdmin ? (
          <View style={styles.guardCard}>
            <Ionicons name="lock-closed-outline" size={24} color="#ff8fa0" />
            <ThemedText style={styles.guardTitle}>Admin Access Required</ThemedText>
            <ThemedText style={styles.guardSub}>This page is only for admins.</ThemedText>
          </View>
        ) : (
          <>
            {/* Policy bar */}
            {policy ? (
              <View style={styles.policyBar}>
                <Ionicons name="settings-outline" size={11} color="#4a6a8a" />
                <ThemedText style={styles.policyText}>
                  Hold: {policy.holdDaysAfterDelivery}d · Fee: ₹{policy.platformFeeFlat} (incl. ₹{policy.csrAmount} CSR) · Manual payouts
                </ThemedText>
              </View>
            ) : null}

            {/* Alert banner for pending requests */}
            {processingRows.length > 0 ? (
              <LinearGradient colors={['#100c2a', '#160e34']} style={styles.alertBanner}>
                <View style={styles.urgentDot} />
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.alertTitle}>
                    {processingRows.length} Payout Request{processingRows.length !== 1 ? 's' : ''} Pending
                  </ThemedText>
                  <ThemedText style={styles.alertSub}>
                    Total: {fmt(processingRows.reduce((sum, e) => sum + e.split.netPayoutAmount, 0))} — Action needed ↓
                  </ThemedText>
                </View>
                <Ionicons name="flash" size={18} color="#c4b0ff" />
              </LinearGradient>
            ) : null}

            {/* Summary grid */}
            <View style={styles.summaryGrid}>
              <SummaryCard label="Payout Requests" value={fmt(Number(s?.processingAmount ?? 0))} color="#c4b0ff" />
              <SummaryCard label="Ready (not claimed)" value={fmt(Number(s?.claimableAmount ?? 0))} color="#78c8ff" />
              <SummaryCard label="On Hold" value={fmt(Number(s?.onHoldAmount ?? 0))} color="#f5d16e" />
              <SummaryCard label="Total Paid Out" value={fmt(Number(s?.paidAmount ?? 0))} color="#7ef5a0" />
            </View>

            {/* Action button */}
            <Pressable onPress={handleRelease} disabled={releasing}
              style={({ pressed }) => [styles.releaseBtn, (pressed || releasing) && { opacity: 0.8 }]}>
              {releasing ? <ActivityIndicator color="#0f1a12" size="small" /> : <Ionicons name="time-outline" size={14} color="#0f1a12" />}
              <ThemedText style={styles.releaseBtnText}>Release Funds from Hold</ThemedText>
            </Pressable>

            {/* Filters */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {FILTERS.map(f => {
                const count = f.key === 'all'
                  ? (dashboard?.payouts || []).length
                  : (dashboard?.payouts || []).filter(e => e.status === f.key).length;
                const active = filter === f.key;
                return (
                  <Pressable key={f.key}
                    onPress={() => setFilter(f.key)}
                    style={[styles.filterChip, active && { borderColor: f.color, backgroundColor: f.color + '15' }]}>
                    <ThemedText style={[styles.filterText, active && { color: f.color }]}>
                      {f.label}{count > 0 ? ` (${count})` : ''}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Processing request cards */}
            {filteredRows.filter(e => e.status === 'processing').length > 0 ? (
              <View style={{ gap: 10 }}>
                <ThemedText style={styles.sectionTitle}>⚡ Pending Payout Requests</ThemedText>
                {filteredRows
                  .filter(e => e.status === 'processing')
                  .map(entry => (
                    <PayoutRequestCard
                      key={entry.id}
                      entry={entry}
                      onMarkPaid={handleMarkPaid}
                      loading={payingId === entry.id}
                    />
                  ))}
              </View>
            ) : filter === 'processing' ? (
              <View style={styles.emptyCard}>
                <Ionicons name="checkmark-done-circle-outline" size={32} color="#1a4a2a" />
                <ThemedText style={styles.emptyTitle}>All caught up! 🎉</ThemedText>
                <ThemedText style={styles.emptySub}>No pending payout requests right now.</ThemedText>
              </View>
            ) : null}

            {/* Other entries (non-processing when on processing tab, or all others) */}
            {filteredRows.filter(e => e.status !== 'processing').length > 0 ? (
              <View style={styles.listCard}>
                <ThemedText style={styles.listTitle}>
                  {filter === 'processing' ? 'Other Payouts' : `${filter === 'all' ? 'All Payouts' : filter.replace(/_/g, ' ')} (${filteredRows.filter(e => e.status !== 'processing').length})`}
                </ThemedText>
                {filteredRows
                  .filter(e => e.status !== 'processing')
                  .map((entry, i, arr) => (
                    <StandardRow key={entry.id} entry={entry} isLast={i === arr.length - 1} />
                  ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

// ─── Small components ─────────────────────────────────────────────────────────

function Header({ onBack, onRefresh }: { onBack: () => void; onRefresh: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.iconBtn}>
        <Ionicons name="chevron-back" size={22} color="#f0f6ff" />
      </Pressable>
      <ThemedText style={styles.headerTitle}>Admin Wallet Ops</ThemedText>
      <Pressable onPress={onRefresh} style={styles.iconBtn}>
        <Ionicons name="refresh" size={18} color="#7ef5a0" />
      </Pressable>
    </View>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.summaryCard}>
      <ThemedText style={[styles.summaryValue, { color }]}>{value}</ThemedText>
      <ThemedText style={styles.summaryLabel}>{label}</ThemedText>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#050a0e' },
  header: { paddingTop: 62, paddingHorizontal: 14, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#0e1520', borderWidth: 1, borderColor: '#1e3048', alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 14, paddingBottom: 40, gap: 10 },

  errorCard: { flexDirection: 'row', gap: 8, alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#5a2030', backgroundColor: '#1a0810', paddingHorizontal: 12, paddingVertical: 10 },
  errorText: { color: '#ff8fa0', fontSize: 12, fontWeight: '700', flex: 1 },

  guardCard: { borderRadius: 14, borderWidth: 1, borderColor: '#3a2230', backgroundColor: '#160e12', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 28, paddingHorizontal: 14 },
  guardTitle: { color: '#ffdadf', fontSize: 15, fontWeight: '800' },
  guardSub: { color: '#c0a0a8', fontSize: 12, textAlign: 'center' },

  policyBar: { flexDirection: 'row', gap: 6, alignItems: 'center', borderRadius: 8, borderWidth: 1, borderColor: '#1a2a3a', backgroundColor: '#090f18', paddingHorizontal: 10, paddingVertical: 7 },
  policyText: { color: '#3a5a7a', fontSize: 10, flex: 1 },

  alertBanner: { flexDirection: 'row', gap: 10, alignItems: 'center', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14, borderWidth: 1, borderColor: '#3a2a70' },
  alertTitle: { color: '#c4b0ff', fontSize: 13, fontWeight: '800' },
  alertSub: { color: '#7a6ab0', fontSize: 10, marginTop: 2 },

  urgentDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#c4b0ff' },

  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  summaryCard: { width: '48%', borderRadius: 12, borderWidth: 1, borderColor: '#1a2a3a', backgroundColor: '#090f18', paddingHorizontal: 12, paddingVertical: 10 },
  summaryValue: { fontSize: 14, fontWeight: '800' },
  summaryLabel: { color: '#2a4a6a', fontSize: 9, fontWeight: '700', marginTop: 3 },

  releaseBtn: { borderRadius: 12, backgroundColor: '#7ef5a0', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11 },
  releaseBtnText: { color: '#0f1a12', fontSize: 11, fontWeight: '800' },

  filterRow: { gap: 8 },
  filterChip: { borderRadius: 999, borderWidth: 1, borderColor: '#1e3048', backgroundColor: '#0a1520', paddingHorizontal: 12, paddingVertical: 8 },
  filterText: { color: '#4a6a8a', fontSize: 10, fontWeight: '700' },

  sectionTitle: { color: '#c4b0ff', fontSize: 12, fontWeight: '800' },

  // Request card
  requestCard: { borderRadius: 16, borderWidth: 1, borderColor: '#3a2a70', padding: 14, gap: 10 },
  requestHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  requestOrderId: { color: '#e0d8ff', fontSize: 13, fontWeight: '800' },
  requestAmount: { color: '#c4b0ff', fontSize: 18, fontWeight: '900' },
  sellerInfo: { gap: 2 },
  sellerName: { color: '#d0c8ff', fontSize: 13, fontWeight: '700' },
  sellerEmail: { color: '#7060a8', fontSize: 11 },
  sellerKyc: { color: '#5a4a90', fontSize: 10 },
  requestedAt: { color: '#4a3a78', fontSize: 9, marginTop: 2 },

  bankToggle: { flexDirection: 'row', gap: 5, alignItems: 'center', paddingVertical: 2 },
  bankToggleText: { color: '#7070c0', fontSize: 10, fontWeight: '700' },

  bankBox: { borderRadius: 10, borderWidth: 1, borderColor: '#2a1e5a', backgroundColor: '#0a0620', padding: 10, gap: 5 },
  bankBoxTitle: { color: '#9090e0', fontSize: 10, fontWeight: '800', marginBottom: 2 },
  bankLine: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  bankLineLabel: { color: '#5050a0', fontSize: 10, width: 70 },
  bankLineValue: { color: '#a0a0e0', fontSize: 10, fontWeight: '700', flex: 1 },

  noBankBox: { borderRadius: 8, borderWidth: 1, borderColor: '#4a3500', backgroundColor: '#1a1000', padding: 10, gap: 4 },
  noBankText: { color: '#a08020', fontSize: 10, flex: 1 },
  noBankCall: { color: '#f5d16e', fontSize: 10, fontWeight: '700' },

  breakdownBox: { borderRadius: 8, borderWidth: 1, borderColor: '#2a1e50', backgroundColor: '#080616', padding: 10, gap: 3 },
  breakdownLine: { height: 1, backgroundColor: '#2a1e50', marginVertical: 3 },
  bdRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bdLabel: { color: '#4a3a7a', fontSize: 10, flex: 1 },
  bdLabelBold: { color: '#d0c0ff', fontWeight: '800', fontSize: 11 },
  bdValue: { color: '#7060a0', fontSize: 10, fontWeight: '700' },
  bdNeg: { color: '#c06060' },
  bdBold: { color: '#c4b0ff', fontSize: 13, fontWeight: '900' },

  markPaidBtn: { borderRadius: 12, backgroundColor: '#7ef5a0', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13 },
  markPaidText: { color: '#0a1e12', fontSize: 13, fontWeight: '800' },
  markPaidHint: { textAlign: 'center', color: '#3a5a3e', fontSize: 9 },

  // Standard row
  listCard: { borderRadius: 12, borderWidth: 1, borderColor: '#1a2a3a', backgroundColor: '#090f18', paddingHorizontal: 12, paddingVertical: 10 },
  listTitle: { color: '#d0e8ff', fontSize: 11, fontWeight: '800', marginBottom: 8 },
  stdRow: { borderBottomWidth: 1, borderBottomColor: '#111e2c', paddingVertical: 10, gap: 3 },
  stdRowHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  stdOrderId: { color: '#c0d8f0', fontSize: 12, fontWeight: '800' },
  stdSeller: { color: '#a0b8d0', fontSize: 11, fontWeight: '700' },
  stdEmail: { color: '#4a6a8a', fontSize: 10 },
  stdNet: { color: '#7ef5a0', fontSize: 13, fontWeight: '900' },
  pill: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontSize: 8, fontWeight: '800' },
  paidAtText: { color: '#2a5a3e', fontSize: 9 },
  refText: { color: '#2a4a6a', fontSize: 9 },
  failText: { color: '#c06060', fontSize: 9, fontWeight: '700' },

  emptyCard: { borderRadius: 14, borderWidth: 1, borderColor: '#1a2a3a', backgroundColor: '#090f18', alignItems: 'center', paddingVertical: 28, gap: 8 },
  emptyTitle: { color: '#2a5a3e', fontSize: 14, fontWeight: '800' },
  emptySub: { color: '#1a3a2e', fontSize: 11, textAlign: 'center' },
});
