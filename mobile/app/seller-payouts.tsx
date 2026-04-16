import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  claimSellerWallet,
  getSellerPayoutDashboard,
  SellerPayoutDashboardResponse,
  SellerPayoutEntry,
  SellerPayoutStatus,
  updateSellerPayoutProfile,
} from '@/utils/api';

function formatCurrency(amount: number) {
  return `₹${Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function formatDate(value: string | null) {
  if (!value) {
    return '—';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '—';
  }

  return parsed.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function statusMeta(status: SellerPayoutStatus) {
  if (status === 'paid') {
    return { label: 'PAID', bg: '#1b4731', border: '#2f7c53', text: '#cbf6dc' };
  }

  if (status === 'on_hold') {
    return { label: 'ON HOLD', bg: '#3a3215', border: '#6f5f20', text: '#faefc7' };
  }

  if (status === 'ready_for_payout') {
    return { label: 'CLAIMABLE', bg: '#1f2f44', border: '#3f5f88', text: '#d8ebff' };
  }

  if (status === 'awaiting_delivery') {
    return { label: 'AWAITING DELIVERY', bg: '#28303e', border: '#4f6179', text: '#dce6f5' };
  }

  if (status === 'failed') {
    return { label: 'FAILED', bg: '#49252d', border: '#7a3f4d', text: '#ffd4dc' };
  }

  if (status === 'cancelled') {
    return { label: 'CANCELLED', bg: '#2e3338', border: '#545c66', text: '#d9dee6' };
  }

  return { label: status.toUpperCase(), bg: '#2a3040', border: '#4e5a73', text: '#d9e2f2' };
}

export default function SellerPayoutsScreen() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<SellerPayoutDashboardResponse | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const [accountType, setAccountType] = useState<'bank' | 'upi'>('bank');
  const [accountHolderName, setAccountHolderName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [bankName, setBankName] = useState('');
  const [branch, setBranch] = useState('');
  const [upiId, setUpiId] = useState('');
  const [linkedAccountId, setLinkedAccountId] = useState('');
  const [reservePercent, setReservePercent] = useState('10');
  const [minimumPayoutAmount, setMinimumPayoutAmount] = useState('0');

  const hydrateFormFromDashboard = useCallback((payload: SellerPayoutDashboardResponse | null) => {
    if (!payload) {
      return;
    }

    const bank = payload.seller.payoutProfile.bankDetails;
    const settings = payload.seller.payoutSettings;

    setAccountType((bank.accountType || 'bank') as 'bank' | 'upi');
    setAccountHolderName(bank.accountHolderName || '');
    setAccountNumber('');
    setIfsc(bank.ifsc || '');
    setBankName(bank.bankName || '');
    setBranch(bank.branch || '');
    setUpiId(bank.upiId || '');
    setLinkedAccountId(bank.razorpayLinkedAccountId || '');

    setReservePercent(String(settings.reservePercent ?? 10));
    setMinimumPayoutAmount(String(settings.minimumPayoutAmount ?? 0));
  }, []);

  const loadDashboard = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      setError(null);
      const payload = await getSellerPayoutDashboard({ page: 1, limit: 50 });
      setDashboard(payload);
      hydrateFormFromDashboard(payload);
    } catch (err: any) {
      setError(err?.message || 'Failed to load seller payouts');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hydrateFormFromDashboard]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const payoutRows = useMemo(() => (dashboard?.payouts || []).slice(0, 20), [dashboard?.payouts]);

  const handleClaimAll = useCallback(async () => {
    try {
      setClaiming(true);
      const result = await claimSellerWallet({ claimAll: true, limit: 100 });
      setDashboard(result.dashboard);

      const blocked = Number(result.claimResult.blockedCount || 0);
      const claimed = Number(result.claimResult.claimedCount || 0);
      const claimedAmount = Number(result.claimResult.claimedAmount || 0);
      const blockedSuffix = blocked > 0 ? `\nBlocked ${blocked} payout(s).` : '';

      Alert.alert(
        'Wallet claim complete',
        `Claimed ${claimed} payout(s) for ${formatCurrency(claimedAmount)}.${blockedSuffix}`
      );
    } catch (err: any) {
      Alert.alert('Claim failed', err?.message || 'Unable to claim wallet balance');
    } finally {
      setClaiming(false);
    }
  }, []);

  const handleSaveSettings = useCallback(async () => {
    const reserve = Number(reservePercent);
    const minimum = Number(minimumPayoutAmount);

    if (!Number.isFinite(reserve) || reserve < 0 || reserve > 100) {
      Alert.alert('Invalid reserve', 'Reserve percentage must be between 0 and 100.');
      return;
    }

    if (!Number.isFinite(minimum) || minimum < 0) {
      Alert.alert('Invalid minimum', 'Minimum payout amount must be zero or more.');
      return;
    }

    const bankPayload: Record<string, any> = {
      accountType,
      accountHolderName: accountHolderName.trim(),
      ifsc: ifsc.trim().toUpperCase(),
      bankName: bankName.trim(),
      branch: branch.trim(),
      upiId: upiId.trim(),
      razorpayLinkedAccountId: linkedAccountId.trim(),
    };

    if (accountNumber.trim()) {
      bankPayload.accountNumber = accountNumber.trim();
    }

    try {
      setSavingSettings(true);
      await updateSellerPayoutProfile({
        bankDetails: bankPayload,
        payoutSettings: {
          reservePercent: reserve,
          minimumPayoutAmount: minimum,
        },
      });
      await loadDashboard(true);
      Alert.alert('Saved', 'Wallet payout settings updated successfully.');
    } catch (err: any) {
      Alert.alert('Save failed', err?.message || 'Unable to save wallet payout settings');
    } finally {
      setSavingSettings(false);
    }
  }, [
    accountHolderName,
    accountNumber,
    accountType,
    bankName,
    branch,
    ifsc,
    linkedAccountId,
    loadDashboard,
    minimumPayoutAmount,
    reservePercent,
    upiId,
  ]);

  const holdDays = Number(dashboard?.seller?.policy?.holdDaysAfterDelivery || 1);
  const claimableAmount = Number(dashboard?.summary?.claimableAmount ?? dashboard?.summary?.readyAmount ?? 0);

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.headerIconBtn}>
            <Ionicons name="chevron-back" size={22} color="#f0f6ff" />
          </Pressable>
          <ThemedText style={styles.headerTitle}>Seller Wallet</ThemedText>
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
        <ThemedText style={styles.headerTitle}>Seller Wallet</ThemedText>
        <Pressable onPress={() => loadDashboard(true)} style={styles.headerIconBtn}>
          <Ionicons name="refresh" size={18} color="#9df0a2" />
        </Pressable>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => loadDashboard(true)} tintColor="#9df0a2" />
        }>
        {error ? (
          <View style={styles.errorCard}>
            <ThemedText style={styles.errorText}>{error}</ThemedText>
          </View>
        ) : null}

        <View style={styles.summaryGrid}>
          <View style={styles.summaryCard}>
            <ThemedText style={styles.summaryValue}>{formatCurrency(claimableAmount)}</ThemedText>
            <ThemedText style={styles.summaryLabel}>Available To Claim</ThemedText>
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
            <ThemedText style={styles.summaryValue}>{formatCurrency(dashboard?.summary?.reserveHeldAmount || 0)}</ThemedText>
            <ThemedText style={styles.summaryLabel}>Reserve Held</ThemedText>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <ThemedText style={styles.sectionTitle}>Wallet Status</ThemedText>
          <ThemedText style={styles.sectionSubtle}>Payout unlock rule: Delivered + {holdDays} day hold period.</ThemedText>
          <ThemedText style={styles.sectionSubtle}>Next wallet release: {formatDate(dashboard?.summary?.nextReleaseAt || null)}</ThemedText>
        </View>

        <View style={styles.actionStack}>
          <Pressable
            style={({ pressed }) => [styles.claimButton, pressed && styles.secondaryButtonPressed, claiming && styles.saveBtnDisabled]}
            onPress={handleClaimAll}
            disabled={claiming}>
            {claiming ? <ActivityIndicator color="#dbffe2" /> : <Ionicons name="wallet-outline" size={15} color="#dbffe2" />}
            <ThemedText style={styles.claimButtonText}>{claiming ? 'Claiming...' : 'Claim Available Balance'}</ThemedText>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryButtonPressed]}
            onPress={() => setShowSettings((prev) => !prev)}>
            <Ionicons name={showSettings ? 'chevron-up-outline' : 'settings-outline'} size={14} color="#dce9fb" />
            <ThemedText style={styles.secondaryButtonText}>{showSettings ? 'Hide Settlement Settings' : 'Edit Settlement Settings'}</ThemedText>
          </Pressable>
        </View>

        <View style={styles.sectionCard}>
          <ThemedText style={styles.sectionTitle}>Settlement Account</ThemedText>
          <View style={styles.detailRow}>
            <ThemedText style={styles.detailLabel}>KYC</ThemedText>
            <ThemedText style={styles.detailValue}>{String(dashboard?.seller?.payoutProfile?.kycStatus || 'pending').toUpperCase()}</ThemedText>
          </View>
          <View style={styles.detailRow}>
            <ThemedText style={styles.detailLabel}>Account type</ThemedText>
            <ThemedText style={styles.detailValue}>{String(dashboard?.seller?.payoutProfile?.bankDetails?.accountType || 'bank').toUpperCase()}</ThemedText>
          </View>
          <View style={styles.detailRow}>
            <ThemedText style={styles.detailLabel}>Account holder</ThemedText>
            <ThemedText style={styles.detailValue}>{dashboard?.seller?.payoutProfile?.bankDetails?.accountHolderName || 'Not set'}</ThemedText>
          </View>
          <View style={styles.detailRow}>
            <ThemedText style={styles.detailLabel}>Account / UPI</ThemedText>
            <ThemedText style={styles.detailValue}>
              {dashboard?.seller?.payoutProfile?.bankDetails?.accountType === 'upi'
                ? dashboard?.seller?.payoutProfile?.bankDetails?.upiId || 'Not set'
                : dashboard?.seller?.payoutProfile?.bankDetails?.accountNumberMasked || 'Not set'}
            </ThemedText>
          </View>
          <View style={[styles.detailRow, styles.detailRowLast]}>
            <ThemedText style={styles.detailLabel}>Claimable now</ThemedText>
            <ThemedText style={styles.detailValue}>{formatCurrency(claimableAmount)}</ThemedText>
          </View>
        </View>

        {showSettings ? (
          <View style={styles.sectionCard}>
            <ThemedText style={styles.sectionTitle}>Edit Wallet Payout Settings</ThemedText>

            <ThemedText style={styles.fieldLabel}>Account type</ThemedText>
            <View style={styles.segmentRow}>
              <Pressable
                style={[styles.segmentBtn, accountType === 'bank' && styles.segmentBtnActive]}
                onPress={() => setAccountType('bank')}>
                <ThemedText style={[styles.segmentText, accountType === 'bank' && styles.segmentTextActive]}>Bank</ThemedText>
              </Pressable>
              <Pressable
                style={[styles.segmentBtn, accountType === 'upi' && styles.segmentBtnActive]}
                onPress={() => setAccountType('upi')}>
                <ThemedText style={[styles.segmentText, accountType === 'upi' && styles.segmentTextActive]}>UPI</ThemedText>
              </Pressable>
            </View>

            <ThemedText style={styles.fieldLabel}>Account holder name</ThemedText>
            <TextInput
              value={accountHolderName}
              onChangeText={setAccountHolderName}
              style={styles.input}
              placeholder="Account holder name"
              placeholderTextColor="#7f93ac"
            />

            {accountType === 'bank' ? (
              <>
                <ThemedText style={styles.fieldLabel}>Account number</ThemedText>
                <TextInput
                  value={accountNumber}
                  onChangeText={setAccountNumber}
                  style={styles.input}
                  keyboardType="number-pad"
                  placeholder="Enter only if adding/updating"
                  placeholderTextColor="#7f93ac"
                />

                <ThemedText style={styles.fieldLabel}>IFSC</ThemedText>
                <TextInput
                  value={ifsc}
                  onChangeText={setIfsc}
                  style={styles.input}
                  autoCapitalize="characters"
                  placeholder="IFSC"
                  placeholderTextColor="#7f93ac"
                />

                <ThemedText style={styles.fieldLabel}>Bank name</ThemedText>
                <TextInput
                  value={bankName}
                  onChangeText={setBankName}
                  style={styles.input}
                  placeholder="Bank name"
                  placeholderTextColor="#7f93ac"
                />

                <ThemedText style={styles.fieldLabel}>Branch</ThemedText>
                <TextInput
                  value={branch}
                  onChangeText={setBranch}
                  style={styles.input}
                  placeholder="Branch"
                  placeholderTextColor="#7f93ac"
                />
              </>
            ) : (
              <>
                <ThemedText style={styles.fieldLabel}>UPI ID</ThemedText>
                <TextInput
                  value={upiId}
                  onChangeText={setUpiId}
                  style={styles.input}
                  placeholder="name@bank"
                  placeholderTextColor="#7f93ac"
                />
              </>
            )}

            <ThemedText style={styles.fieldLabel}>Razorpay linked account id (optional)</ThemedText>
            <TextInput
              value={linkedAccountId}
              onChangeText={setLinkedAccountId}
              style={styles.input}
              placeholder="acc_xxxxx"
              placeholderTextColor="#7f93ac"
            />

            <ThemedText style={styles.fieldLabel}>Reserve %</ThemedText>
            <TextInput
              value={reservePercent}
              onChangeText={setReservePercent}
              style={styles.input}
              keyboardType="decimal-pad"
              placeholder="10"
              placeholderTextColor="#7f93ac"
            />

            <ThemedText style={styles.fieldLabel}>Minimum payout amount</ThemedText>
            <TextInput
              value={minimumPayoutAmount}
              onChangeText={setMinimumPayoutAmount}
              style={styles.input}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor="#7f93ac"
            />

            <Pressable
              style={({ pressed }) => [styles.saveBtn, pressed && styles.saveBtnPressed, savingSettings && styles.saveBtnDisabled]}
              onPress={handleSaveSettings}
              disabled={savingSettings}>
              {savingSettings ? <ActivityIndicator color="#0f1a12" /> : null}
              <ThemedText style={styles.saveBtnText}>{savingSettings ? 'Saving...' : 'Save Settings'}</ThemedText>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.sectionCard}>
          <ThemedText style={styles.sectionTitle}>Recent Payouts</ThemedText>
          {payoutRows.length === 0 ? (
            <ThemedText style={styles.emptyText}>No payout records yet.</ThemedText>
          ) : (
            payoutRows.map((entry, idx) => (
              <PayoutRow key={entry.id} entry={entry} isLast={idx === payoutRows.length - 1} />
            ))
          )}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

function PayoutRow({ entry, isLast }: { entry: SellerPayoutEntry; isLast: boolean }) {
  const meta = statusMeta(entry.status);

  return (
    <View style={[styles.payoutRow, isLast && styles.payoutRowLast]}>
      <View style={styles.payoutHead}>
        <ThemedText style={styles.payoutOrderId}>Order #{entry.orderId.slice(-8).toUpperCase()}</ThemedText>
        <View style={[styles.statusPill, { backgroundColor: meta.bg, borderColor: meta.border }]}>
          <ThemedText style={[styles.statusPillText, { color: meta.text }]}>{meta.label}</ThemedText>
        </View>
      </View>

      <View style={styles.netPayoutCard}>
        <ThemedText style={styles.moneyLabel}>Net payout</ThemedText>
        <ThemedText style={[styles.moneyValue, styles.netPayoutValue]}>{formatCurrency(entry.split.netPayoutAmount)}</ThemedText>
        <ThemedText style={styles.splitMetaText}>
          Gross {formatCurrency(entry.split.itemSubtotal + entry.split.shippingShare)} • Reserve {formatCurrency(entry.split.reserveAmount)}
        </ThemedText>
      </View>

      <View style={styles.dateRow}>
        <ThemedText style={styles.dateLabel}>Hold release</ThemedText>
        <ThemedText style={styles.dateValue}>{formatDate(entry.holdUntil)}</ThemedText>
      </View>
      <View style={styles.dateRow}>
        <ThemedText style={styles.dateLabel}>Paid at</ThemedText>
        <ThemedText style={styles.dateValue}>{formatDate(entry.payout.paidAt)}</ThemedText>
      </View>
      {entry.payout.failureReason ? (
        <ThemedText style={styles.failureReason}>{entry.payout.failureReason}</ThemedText>
      ) : null}
    </View>
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
    fontSize: 21,
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
  sectionCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a3950',
    backgroundColor: '#131f2f',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: '#f0f6ff',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 8,
  },
  sectionSubtle: {
    color: '#a8bfd9',
    fontSize: 11,
    marginTop: 4,
  },
  trustChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#35506f',
    backgroundColor: '#1b2e43',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  trustChipText: {
    color: '#d7ebff',
    fontSize: 10,
    fontWeight: '800',
  },
  progressTrack: {
    marginTop: 8,
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#24384f',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#9df0a2',
  },
  actionStack: {
    gap: 8,
  },
  claimButton: {
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
  claimButtonText: {
    color: '#dbffe2',
    fontSize: 11,
    fontWeight: '800',
  },
  secondaryButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#364861',
    backgroundColor: '#1a2a3f',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  secondaryButtonPressed: {
    opacity: 0.9,
  },
  secondaryButtonText: {
    color: '#dce9fb',
    fontSize: 11,
    fontWeight: '700',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#203249',
    paddingVertical: 7,
    gap: 10,
  },
  detailRowLast: {
    borderBottomWidth: 0,
  },
  detailLabel: {
    color: '#abc0db',
    fontSize: 11,
  },
  detailValue: {
    color: '#e4f1ff',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'right',
    flexShrink: 1,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  fieldLabel: {
    color: '#a8bfd9',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 6,
    marginBottom: 4,
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#365171',
    backgroundColor: '#17273a',
    color: '#ecf5ff',
    fontSize: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 2,
  },
  segmentBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#365171',
    backgroundColor: '#17273a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
  },
  segmentBtnActive: {
    borderColor: '#9df0a2',
    backgroundColor: '#1f3b2b',
  },
  segmentText: {
    color: '#c1d5eb',
    fontSize: 11,
    fontWeight: '700',
  },
  segmentTextActive: {
    color: '#dbffe2',
  },
  saveBtn: {
    marginTop: 12,
    borderRadius: 12,
    backgroundColor: '#9df0a2',
    borderWidth: 1,
    borderColor: '#9df0a2',
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  saveBtnPressed: {
    opacity: 0.9,
  },
  saveBtnDisabled: {
    opacity: 0.7,
  },
  saveBtnText: {
    color: '#0f1a12',
    fontSize: 12,
    fontWeight: '800',
  },
  emptyText: {
    color: '#9ab1cb',
    fontSize: 11,
    fontWeight: '600',
    paddingVertical: 4,
  },
  payoutRow: {
    borderBottomWidth: 1,
    borderBottomColor: '#203249',
    paddingVertical: 10,
    gap: 8,
  },
  payoutRowLast: {
    borderBottomWidth: 0,
  },
  payoutHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  payoutOrderId: {
    color: '#ecf5ff',
    fontSize: 12,
    fontWeight: '800',
  },
  statusPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusPillText: {
    fontSize: 9,
    fontWeight: '800',
  },
  netPayoutCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#294058',
    backgroundColor: '#162738',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  moneyLabel: {
    color: '#abc0db',
    fontSize: 10,
  },
  moneyValue: {
    color: '#e6f3ff',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  netPayoutValue: {
    color: '#bff8cc',
    fontSize: 14,
    marginTop: 3,
  },
  splitMetaText: {
    marginTop: 4,
    color: '#9ab2cd',
    fontSize: 10,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateLabel: {
    color: '#93abc6',
    fontSize: 10,
  },
  dateValue: {
    color: '#dce9fb',
    fontSize: 10,
    fontWeight: '700',
  },
  failureReason: {
    color: '#ffbcc8',
    fontSize: 10,
    fontWeight: '700',
  },
});
