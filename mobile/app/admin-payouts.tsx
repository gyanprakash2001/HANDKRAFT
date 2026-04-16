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
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  AdminPayoutDashboardResponse,
  claimAdminReadyPayouts,
  getAdminPayoutDashboard,
  getProfile,
  releaseAdminDuePayouts,
  SellerPayoutStatus,
} from '@/utils/api';

type AdminFilter = 'all' | SellerPayoutStatus;

const FILTERS: { key: AdminFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'awaiting_delivery', label: 'Awaiting' },
  { key: 'on_hold', label: 'On Hold' },
  { key: 'ready_for_payout', label: 'Claimable' },
  { key: 'paid', label: 'Paid' },
  { key: 'failed', label: 'Failed' },
];

function formatCurrency(amount: number) {
  return `Rs ${Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function formatDate(value: string | null) {
  if (!value) {
    return '-';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '-';
  }
  return parsed.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function statusMeta(status: SellerPayoutStatus | string) {
  if (status === 'paid') return { bg: '#1b4731', border: '#2f7c53', text: '#cbf6dc', label: 'PAID' };
  if (status === 'on_hold') return { bg: '#3a3215', border: '#6f5f20', text: '#faefc7', label: 'ON HOLD' };
  if (status === 'ready_for_payout') return { bg: '#1f2f44', border: '#3f5f88', text: '#d8ebff', label: 'CLAIMABLE' };
  if (status === 'awaiting_delivery') return { bg: '#28303e', border: '#4f6179', text: '#dce6f5', label: 'AWAITING' };
  if (status === 'failed') return { bg: '#49252d', border: '#7a3f4d', text: '#ffd4dc', label: 'FAILED' };
  return { bg: '#2a3040', border: '#4e5a73', text: '#d9e2f2', label: String(status || 'UNKNOWN').toUpperCase() };
}

export default function AdminPayoutsScreen() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<AdminPayoutDashboardResponse | null>(null);
  const [activeFilter, setActiveFilter] = useState<AdminFilter>('all');

  const loadDashboard = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      setError(null);
      const me = await getProfile();
      const adminFlag = Boolean(me?.isAdmin);
      setIsAdmin(adminFlag);

      if (!adminFlag) {
        setDashboard(null);
        return;
      }

      const payload = await getAdminPayoutDashboard({ page: 1, limit: 120 });
      setDashboard(payload);
    } catch (err: any) {
      setError(err?.message || 'Failed to load admin payout dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const filteredRows = useMemo(() => {
    const rows = dashboard?.payouts || [];
    if (activeFilter === 'all') {
      return rows;
    }
    return rows.filter((entry) => entry.status === activeFilter);
  }, [activeFilter, dashboard?.payouts]);

  const handleRelease = useCallback(async () => {
    try {
      setReleasing(true);
      const result = await releaseAdminDuePayouts(200);
      const released = Number(result?.result?.releasedCount || result?.result?.pendingActionCount || 0);
      await loadDashboard(true);
      Alert.alert('Admin release complete', `Released ${released} payout(s) to claimable state.`);
    } catch (err: any) {
      Alert.alert('Release failed', err?.message || 'Unable to run admin release.');
    } finally {
      setReleasing(false);
    }
  }, [loadDashboard]);

  const handleClaim = useCallback(async () => {
    try {
      setClaiming(true);
      const result = await claimAdminReadyPayouts({ claimAll: true, limit: 200 });
      setDashboard(result.dashboard);
      Alert.alert(
        'Admin claim complete',
        `Claimed ${result.claimResult.claimedCount} payout(s) for ${formatCurrency(result.claimResult.claimedAmount)}.`
      );
    } catch (err: any) {
      Alert.alert('Claim failed', err?.message || 'Unable to process admin claim.');
    } finally {
      setClaiming(false);
    }
  }, []);

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
          <ActivityIndicator size="large" color="#9df0a2" />
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
          <Ionicons name="refresh" size={18} color="#9df0a2" />
        </Pressable>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadDashboard(true)} tintColor="#9df0a2" />}>
        {error ? (
          <View style={styles.errorCard}>
            <ThemedText style={styles.errorText}>{error}</ThemedText>
          </View>
        ) : null}

        {!isAdmin ? (
          <View style={styles.guardCard}>
            <Ionicons name="lock-closed-outline" size={22} color="#ffb8b8" />
            <ThemedText style={styles.guardTitle}>Admin Access Required</ThemedText>
            <ThemedText style={styles.guardText}>This screen is available only for admin users.</ThemedText>
          </View>
        ) : (
          <>
            <View style={styles.summaryGrid}>
              <View style={styles.summaryCard}>
                <ThemedText style={styles.summaryValue}>{formatCurrency(dashboard?.summary?.claimableAmount || 0)}</ThemedText>
                <ThemedText style={styles.summaryLabel}>Claimable</ThemedText>
              </View>
              <View style={styles.summaryCard}>
                <ThemedText style={styles.summaryValue}>{formatCurrency(dashboard?.summary?.onHoldAmount || 0)}</ThemedText>
                <ThemedText style={styles.summaryLabel}>On Hold</ThemedText>
              </View>
              <View style={styles.summaryCard}>
                <ThemedText style={styles.summaryValue}>{formatCurrency(dashboard?.summary?.paidAmount || 0)}</ThemedText>
                <ThemedText style={styles.summaryLabel}>Paid</ThemedText>
              </View>
              <View style={styles.summaryCard}>
                <ThemedText style={styles.summaryValue}>{formatCurrency(dashboard?.summary?.awaitingDeliveryAmount || 0)}</ThemedText>
                <ThemedText style={styles.summaryLabel}>Awaiting Delivery</ThemedText>
              </View>
            </View>

            <View style={styles.actionRow}>
              <Pressable style={styles.actionBtn} onPress={handleRelease} disabled={releasing}>
                {releasing ? <ActivityIndicator color="#0f1a12" /> : <Ionicons name="time-outline" size={15} color="#0f1a12" />}
                <ThemedText style={styles.actionBtnText}>Release Due</ThemedText>
              </Pressable>
              <Pressable style={styles.claimBtn} onPress={handleClaim} disabled={claiming}>
                {claiming ? <ActivityIndicator color="#dbffe2" /> : <Ionicons name="wallet-outline" size={15} color="#dbffe2" />}
                <ThemedText style={styles.claimBtnText}>Claim All Ready</ThemedText>
              </Pressable>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {FILTERS.map((filter) => {
                const active = activeFilter === filter.key;
                return (
                  <Pressable
                    key={filter.key}
                    style={[styles.filterChip, active && styles.filterChipActive]}
                    onPress={() => setActiveFilter(filter.key)}>
                    <ThemedText style={[styles.filterText, active && styles.filterTextActive]}>{filter.label}</ThemedText>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={styles.listCard}>
              <ThemedText style={styles.listTitle}>Payout Operations Queue</ThemedText>
              {filteredRows.length === 0 ? (
                <ThemedText style={styles.emptyText}>No payouts for selected filter.</ThemedText>
              ) : (
                filteredRows.map((entry, idx) => (
                  <View key={entry.id} style={[styles.row, idx === filteredRows.length - 1 && styles.rowLast]}>
                    <View style={styles.rowHead}>
                      <ThemedText style={styles.orderId}>Order #{entry.orderId.slice(-8).toUpperCase()}</ThemedText>
                      <View style={[styles.statusPill, { backgroundColor: statusMeta(entry.status).bg, borderColor: statusMeta(entry.status).border }]}>
                        <ThemedText style={[styles.statusText, { color: statusMeta(entry.status).text }]}>{statusMeta(entry.status).label}</ThemedText>
                      </View>
                    </View>

                    <ThemedText style={styles.sellerName}>{entry.seller.name || 'Unknown seller'}</ThemedText>
                    <ThemedText style={styles.sellerEmail}>{entry.seller.email || '-'}</ThemedText>

                    <View style={styles.rowMetaLine}>
                      <ThemedText style={styles.metaLabel}>Net</ThemedText>
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
                  </View>
                ))
              )}
            </View>
          </>
        )}
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
    fontSize: 20,
    fontWeight: '800',
  },
  headerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#1a1f28',
    borderWidth: 1,
    borderColor: '#2e3847',
    alignItems: 'center',
    justifyContent: 'center',
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
    paddingBottom: 26,
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
  guardCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#593236',
    backgroundColor: '#2c171a',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 18,
    paddingHorizontal: 14,
  },
  guardTitle: {
    color: '#ffdadf',
    fontSize: 14,
    fontWeight: '800',
  },
  guardText: {
    color: '#ffc0c8',
    fontSize: 12,
    textAlign: 'center',
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  summaryCard: {
    width: '48.5%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2f445f',
    backgroundColor: '#132131',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  summaryValue: {
    color: '#9df0a2',
    fontSize: 16,
    fontWeight: '800',
  },
  summaryLabel: {
    marginTop: 4,
    color: '#a5bbd7',
    fontSize: 11,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#9df0a2',
    borderWidth: 1,
    borderColor: '#9df0a2',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  actionBtnText: {
    color: '#0f1a12',
    fontSize: 11,
    fontWeight: '800',
  },
  claimBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#4e7099',
    backgroundColor: '#1a2a3f',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  claimBtnText: {
    color: '#dbffe2',
    fontSize: 11,
    fontWeight: '800',
  },
  filterRow: {
    gap: 8,
  },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2f4056',
    backgroundColor: '#162334',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  filterChipActive: {
    borderColor: '#9df0a2',
    backgroundColor: '#224129',
  },
  filterText: {
    color: '#bdd0e6',
    fontSize: 11,
    fontWeight: '700',
  },
  filterTextActive: {
    color: '#d9ffe0',
  },
  listCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a3950',
    backgroundColor: '#131f2f',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  listTitle: {
    color: '#f0f6ff',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 8,
  },
  emptyText: {
    color: '#9ab1cb',
    fontSize: 11,
    fontWeight: '600',
    paddingVertical: 4,
  },
  row: {
    borderBottomWidth: 1,
    borderBottomColor: '#203249',
    paddingVertical: 10,
    gap: 3,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  orderId: {
    color: '#ecf5ff',
    fontSize: 12,
    fontWeight: '800',
  },
  sellerName: {
    color: '#dce9fb',
    fontSize: 12,
    fontWeight: '700',
  },
  sellerEmail: {
    color: '#93abc6',
    fontSize: 10,
    marginBottom: 4,
  },
  statusPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusText: {
    fontSize: 9,
    fontWeight: '800',
  },
  rowMetaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metaLabel: {
    color: '#93abc6',
    fontSize: 10,
  },
  metaValue: {
    color: '#dce9fb',
    fontSize: 10,
    fontWeight: '700',
  },
  failureReason: {
    color: '#ffbcc8',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 4,
  },
});
