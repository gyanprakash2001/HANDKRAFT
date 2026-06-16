import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  requestSellerPayout,
  getSellerPayoutDashboard,
  SellerPayoutDashboardResponse,
  SellerPayoutEntry,
  SellerPayoutStatus,
  updateSellerPayoutProfile,
} from '@/utils/api';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(amount: number) {
  return `₹${Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function holdCountdown(holdUntil: string | null): string {
  if (!holdUntil) return '';
  const diff = new Date(holdUntil).getTime() - Date.now();
  if (diff <= 0) return 'Unlocking soon…';
  const hrs = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hrs >= 48) return `${Math.floor(hrs / 24)}d left`;
  if (hrs > 0) return `${hrs}h ${mins}m left`;
  return `${mins}m left`;
}

function statusMeta(status: SellerPayoutStatus) {
  switch (status) {
    case 'paid':          return { label: 'PAID',             bg: '#112a1c', border: '#2f7c53', text: '#7ef5a0', icon: 'checkmark-circle' };
    case 'on_hold':       return { label: 'IN HOLD',          bg: '#231c06', border: '#6f5f20', text: '#f5d16e', icon: 'time' };
    case 'ready_for_payout': return { label: 'READY',         bg: '#0d1f35', border: '#2d5a8e', text: '#78c8ff', icon: 'flash' };
    case 'processing':    return { label: 'PROCESSING (~2h)', bg: '#1a1035', border: '#5a3fa0', text: '#c4b0ff', icon: 'sync' };
    case 'awaiting_delivery': return { label: 'INCOMING',     bg: '#17202a', border: '#3a4f62', text: '#9ab8d4', icon: 'hourglass' };
    case 'failed':        return { label: 'FAILED',           bg: '#2a0e12', border: '#7a3f4d', text: '#ff8fa0', icon: 'warning' };
    case 'cancelled':     return { label: 'CANCELLED',        bg: '#1a1c20', border: '#4a5060', text: '#8a96a8', icon: 'close-circle' };
    default:              return { label: status.toUpperCase(), bg: '#161a20', border: '#3a4050', text: '#9aa8bc', icon: 'ellipse' };
  }
}

// ─── Animated Balance Counter ─────────────────────────────────────────────────

function BalanceCounter({ to }: { to: number }) {
  const val = useRef(new Animated.Value(0)).current;
  const [txt, setTxt] = useState('0.00');
  useEffect(() => {
    val.setValue(0);
    const anim = Animated.timing(val, { toValue: to, duration: 900, useNativeDriver: false });
    const id = val.addListener(({ value: v }) =>
      setTxt(v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
    );
    anim.start();
    return () => { anim.stop(); val.removeListener(id); };
  }, [to, val]);
  return (
    <ThemedText style={styles.heroAmount}>₹{txt}</ThemedText>
  );
}

// ─── Mini Bar Sparkline ───────────────────────────────────────────────────────

function EarningsSparkline({ payouts }: { payouts: SellerPayoutEntry[] }) {
  const bars = useMemo(() => {
    const paid = payouts
      .filter(p => p.status === 'paid' || p.status === 'processing')
      .slice(0, 7)
      .reverse();
    if (paid.length === 0) return [];
    const max = Math.max(...paid.map(p => p.split.netPayoutAmount), 1);
    return paid.map(p => ({ h: Math.max(4, (p.split.netPayoutAmount / max) * 48), amt: p.split.netPayoutAmount }));
  }, [payouts]);

  if (bars.length === 0) return null;

  return (
    <View style={styles.sparkWrap}>
      <ThemedText style={styles.sparkLabel}>Recent earnings</ThemedText>
      <View style={styles.sparkBars}>
        {bars.map((b, i) => (
          <View key={i} style={styles.sparkBarWrap}>
            <View style={[styles.sparkBar, { height: b.h }]} />
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Payout Row Card ──────────────────────────────────────────────────────────

function PayoutCard({ entry, isLast }: { entry: SellerPayoutEntry; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const meta = statusMeta(entry.status);
  const countdown = holdCountdown(entry.holdUntil);

  return (
    <Pressable
      onPress={() => setExpanded(e => !e)}
      style={[styles.payoutCard, isLast && styles.payoutCardLast]}
    >
      {/* Header row */}
      <View style={styles.payoutHead}>
        <View style={styles.payoutOrderWrap}>
          <ThemedText style={styles.payoutOrderId}>
            #{entry.orderId.slice(-8).toUpperCase()}
          </ThemedText>
          {entry.status === 'on_hold' && countdown ? (
            <View style={styles.countdownChip}>
              <Ionicons name="time-outline" size={10} color="#f5d16e" />
              <ThemedText style={styles.countdownText}>{countdown}</ThemedText>
            </View>
          ) : null}
          {entry.status === 'processing' ? (
            <View style={styles.processingChip}>
              <Ionicons name="sync-outline" size={10} color="#c4b0ff" />
              <ThemedText style={styles.processingChipText}>~2 hrs</ThemedText>
            </View>
          ) : null}
        </View>
        <View style={styles.payoutRight}>
          <ThemedText style={styles.payoutNet}>{formatCurrency(entry.split.netPayoutAmount)}</ThemedText>
          <View style={[styles.statusPill, { backgroundColor: meta.bg, borderColor: meta.border }]}>
            <ThemedText style={[styles.statusPillText, { color: meta.text }]}>{meta.label}</ThemedText>
          </View>
        </View>
      </View>

      {/* Expand toggle hint */}
      <View style={styles.expandHint}>
        <ThemedText style={styles.expandHintText}>
          {expanded ? 'Hide breakdown ▲' : 'Show breakdown ▼'}
        </ThemedText>
      </View>

      {/* Expanded breakdown */}
      {expanded ? (
        <View style={styles.breakdownBox}>
          <BreakdownRow label="Sale amount (your price)" value={formatCurrency(entry.split.itemSubtotal)} />
          <BreakdownRow label="Shipping cost share" value={`−${formatCurrency(entry.split.shippingDeduction)}`} negative />
          <BreakdownRow
            label={`Platform fee (₹${(entry.split.platformFeeFlat ?? entry.split.platformFeeAmount ?? 8).toFixed(0)} incl. ₹${(entry.split.csrAmount ?? 1).toFixed(0)} CSR)`}
            value={`−${formatCurrency(entry.split.platformFeeAmount)}`}
            negative
          />
          <View style={styles.breakdownDivider} />
          <BreakdownRow label="Your net payout" value={formatCurrency(entry.split.netPayoutAmount)} highlight />
          {entry.payout.referenceId ? (
            <ThemedText style={styles.refText}>Ref: {entry.payout.referenceId}</ThemedText>
          ) : null}
          {entry.payout.paidAt ? (
            <ThemedText style={styles.refText}>Settled on {formatDate(entry.payout.paidAt)}</ThemedText>
          ) : null}
          {entry.payout.failureReason ? (
            <ThemedText style={styles.failureText}>{entry.payout.failureReason}</ThemedText>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

function BreakdownRow({ label, value, negative, highlight }: {
  label: string; value: string; negative?: boolean; highlight?: boolean;
}) {
  return (
    <View style={styles.breakdownRow}>
      <ThemedText style={[styles.breakdownLabel, highlight && styles.breakdownLabelBold]}>{label}</ThemedText>
      <ThemedText style={[
        styles.breakdownValue,
        negative && styles.breakdownNeg,
        highlight && styles.breakdownHighlight,
      ]}>{value}</ThemedText>
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function SellerPayoutsScreen() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<SellerPayoutDashboardResponse | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Bank / UPI settings form
  const [accountType, setAccountType] = useState<'bank' | 'upi'>('bank');
  const [accountHolderName, setAccountHolderName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [bankName, setBankName] = useState('');
  const [branch, setBranch] = useState('');
  const [upiId, setUpiId] = useState('');
  const [linkedAccountId, setLinkedAccountId] = useState('');
  const [minimumPayoutAmount, setMinimumPayoutAmount] = useState('0');

  const hydrateForm = useCallback((payload: SellerPayoutDashboardResponse | null) => {
    if (!payload) return;
    const bank = payload.seller.payoutProfile.bankDetails;
    setAccountType((bank.accountType || 'bank') as 'bank' | 'upi');
    setAccountHolderName(bank.accountHolderName || '');
    setAccountNumber('');
    setIfsc(bank.ifsc || '');
    setBankName(bank.bankName || '');
    setBranch(bank.branch || '');
    setUpiId(bank.upiId || '');
    setLinkedAccountId(bank.razorpayLinkedAccountId || '');
    setMinimumPayoutAmount(String(payload.seller.payoutSettings.minimumPayoutAmount ?? 0));
  }, []);

  const loadDashboard = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      setError(null);
      const payload = await getSellerPayoutDashboard({ page: 1, limit: 50 });
      setDashboard(payload);
      hydrateForm(payload);
    } catch (err: any) {
      setError(err?.message || 'Failed to load wallet');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hydrateForm]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  const payoutRows = useMemo(() => (dashboard?.payouts || []).slice(0, 20), [dashboard?.payouts]);

  // ── Request Payout ──────────────────────────────────────────────────────────
  const handleRequestPayout = useCallback(async () => {
    const kycStatus = dashboard?.seller?.payoutProfile?.kycStatus || 'pending';
    const bank = dashboard?.seller?.payoutProfile?.bankDetails;
    const hasBank = accountType === 'upi'
      ? Boolean(bank?.upiId)
      : Boolean(bank?.accountNumberMasked && bank?.ifsc);

    if (kycStatus !== 'verified') {
      Alert.alert(
        'KYC Required',
        'Your KYC is not verified yet. Please complete KYC before requesting a payout.\n\nOpen "Edit Settlement Settings" to add your bank details.',
        [{ text: 'OK' }]
      );
      return;
    }

    if (!hasBank) {
      Alert.alert(
        'Bank Details Missing',
        'Add your bank account or UPI ID in "Settlement Settings" before requesting a payout.',
        [{ text: 'OK' }, { text: 'Open Settings', onPress: () => setShowSettings(true) }]
      );
      return;
    }

    const claimable = Number(dashboard?.summary?.claimableAmount || 0);
    if (claimable <= 0) {
      Alert.alert('Nothing to withdraw', 'You have no balance available to withdraw right now.');
      return;
    }

    Alert.alert(
      'Request Payout?',
      `Request ${formatCurrency(claimable)} to your ${accountType === 'upi' ? 'UPI' : 'bank account'}?\n\nPayment will be processed within 2 hours.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, Request',
          onPress: async () => {
            try {
              setRequesting(true);
              const result = await requestSellerPayout({ requestAll: true });
              setDashboard(result.dashboard);
              setSuccessMsg(`₹${result.requestedAmount.toLocaleString('en-IN')} payout requested! You'll receive it within 2 hours.`);
              setTimeout(() => setSuccessMsg(null), 6000);
            } catch (err: any) {
              Alert.alert('Request failed', err?.message || 'Unable to request payout');
            } finally {
              setRequesting(false);
            }
          },
        },
      ]
    );
  }, [dashboard, accountType]);

  // ── Save bank settings ──────────────────────────────────────────────────────
  const handleSaveSettings = useCallback(async () => {
    const minimum = Number(minimumPayoutAmount);
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
    if (accountNumber.trim()) bankPayload.accountNumber = accountNumber.trim();

    try {
      setSavingSettings(true);
      await updateSellerPayoutProfile({
        bankDetails: bankPayload,
        payoutSettings: { minimumPayoutAmount: minimum },
      });
      await loadDashboard(true);
      Alert.alert('Saved', 'Settlement settings updated.');
    } catch (err: any) {
      Alert.alert('Save failed', err?.message || 'Unable to save settings');
    } finally {
      setSavingSettings(false);
    }
  }, [accountHolderName, accountNumber, accountType, bankName, branch, ifsc, linkedAccountId, loadDashboard, minimumPayoutAmount, upiId]);

  const summary = dashboard?.summary;
  const seller = dashboard?.seller;
  const claimable = Number(summary?.claimableAmount ?? 0);
  const onHold = Number(summary?.onHoldAmount ?? 0);
  const processing = Number((summary as any)?.processingAmount ?? 0);
  const totalPaid = Number(summary?.paidAmount ?? 0);
  const incoming = Number(summary?.incomingAmount ?? 0);
  const nextRelease = summary?.nextReleaseAt || null;
  const holdDays = Number(seller?.policy?.holdDaysAfterDelivery ?? 2);
  const platformFeeFlat = Number(seller?.policy?.platformFeeFlat ?? 8);
  const csrAmount = Number(seller?.policy?.csrAmount ?? 1);
  const kycVerified = seller?.payoutProfile?.kycStatus === 'verified';

  // ── Loading state ───────────────────────────────────────────────────────────
  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.headerIconBtn}>
            <Ionicons name="chevron-back" size={22} color="#f0f6ff" />
          </Pressable>
          <ThemedText style={styles.headerTitle}>My Wallet</ThemedText>
          <View style={styles.headerIconBtn} />
        </View>
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color="#7ef5a0" />
          <ThemedText style={styles.loaderText}>Loading wallet…</ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerIconBtn}>
          <Ionicons name="chevron-back" size={22} color="#f0f6ff" />
        </Pressable>
        <ThemedText style={styles.headerTitle}>My Wallet</ThemedText>
        <Pressable onPress={() => loadDashboard(true)} style={styles.headerIconBtn}>
          <Ionicons name="refresh" size={18} color="#7ef5a0" />
        </Pressable>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadDashboard(true)} tintColor="#7ef5a0" />}
      >
        {/* Error */}
        {error ? (
          <View style={styles.errorCard}>
            <Ionicons name="alert-circle-outline" size={14} color="#ff8fa0" />
            <ThemedText style={styles.errorText}>{error}</ThemedText>
          </View>
        ) : null}

        {/* Success banner */}
        {successMsg ? (
          <LinearGradient colors={['#0d2b1a', '#0f3320']} style={styles.successBanner}>
            <Ionicons name="checkmark-circle" size={16} color="#7ef5a0" />
            <ThemedText style={styles.successText}>{successMsg}</ThemedText>
          </LinearGradient>
        ) : null}

        {/* ── Hero wallet card ──────────────────────────────────────────── */}
        <LinearGradient
          colors={['#0a1a0e', '#0d2215', '#091810']}
          style={styles.heroCard}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <View style={styles.heroGlow} />
          <ThemedText style={styles.heroLabel}>Available to Withdraw</ThemedText>
          <BalanceCounter to={claimable} />
          {processing > 0 ? (
            <View style={styles.processingBadge}>
              <Ionicons name="sync-outline" size={11} color="#c4b0ff" />
              <ThemedText style={styles.processingBadgeText}>
                {formatCurrency(processing)} processing · arrives in ~2 hrs
              </ThemedText>
            </View>
          ) : null}

          {/* 3 stat pills */}
          <View style={styles.statRow}>
            <View style={styles.statPill}>
              <ThemedText style={styles.statValue}>{formatCurrency(onHold)}</ThemedText>
              <ThemedText style={styles.statLabel}>On Hold</ThemedText>
            </View>
            <View style={[styles.statPill, styles.statPillMid]}>
              <ThemedText style={styles.statValue}>{formatCurrency(incoming)}</ThemedText>
              <ThemedText style={styles.statLabel}>Incoming</ThemedText>
            </View>
            <View style={styles.statPill}>
              <ThemedText style={styles.statValue}>{formatCurrency(totalPaid)}</ThemedText>
              <ThemedText style={styles.statLabel}>Total Paid</ThemedText>
            </View>
          </View>

          {/* Sparkline */}
          <EarningsSparkline payouts={payoutRows} />
        </LinearGradient>

        {/* ── KYC Banner ───────────────────────────────────────────────── */}
        {!kycVerified ? (
          <View style={styles.kycBanner}>
            <Ionicons name="shield-outline" size={16} color="#f5d16e" />
            <View style={styles.kycTextWrap}>
              <ThemedText style={styles.kycTitle}>Complete KYC to Withdraw</ThemedText>
              <ThemedText style={styles.kycSub}>
                Add your bank or UPI details and get verified to start receiving payouts.
              </ThemedText>
            </View>
            <Pressable onPress={() => setShowSettings(true)} style={styles.kycBtn}>
              <ThemedText style={styles.kycBtnText}>Setup</ThemedText>
            </Pressable>
          </View>
        ) : null}

        {/* ── Wallet Status ─────────────────────────────────────────────── */}
        <View style={styles.infoCard}>
          <Ionicons name="information-circle-outline" size={14} color="#9ab8d4" />
          <ThemedText style={styles.infoText}>
            Funds are held for {holdDays} day{holdDays !== 1 ? 's' : ''} after delivery. Platform fee is ₹{platformFeeFlat}/order (includes ₹{csrAmount} CSR).
            {nextRelease ? `  Next release: ${formatDate(nextRelease)}.` : ''}
          </ThemedText>
        </View>

        {/* ── Request Payout Button ─────────────────────────────────────── */}
        <Pressable
          style={({ pressed }) => [styles.withdrawBtn, (pressed || requesting) && styles.withdrawBtnPressed]}
          onPress={handleRequestPayout}
          disabled={requesting}
        >
          <LinearGradient
            colors={claimable > 0 ? ['#1a4d2e', '#1f6e3a'] : ['#1a1a1a', '#222222']}
            style={styles.withdrawBtnInner}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            {requesting
              ? <ActivityIndicator color="#7ef5a0" size="small" />
              : <Ionicons name="arrow-up-circle" size={18} color={claimable > 0 ? '#7ef5a0' : '#4a5566'} />
            }
            <ThemedText style={[styles.withdrawBtnText, claimable <= 0 && styles.withdrawBtnTextDim]}>
              {requesting ? 'Requesting…' : claimable > 0 ? `Request ${formatCurrency(claimable)} Payout` : 'No balance to withdraw'}
            </ThemedText>
          </LinearGradient>
        </Pressable>

        {/* ── Settlement Settings ───────────────────────────────────────── */}
        <Pressable
          style={styles.settingsToggle}
          onPress={() => setShowSettings(prev => !prev)}
        >
          <Ionicons name={showSettings ? 'chevron-up' : 'settings-outline'} size={14} color="#8ab4d8" />
          <ThemedText style={styles.settingsToggleText}>
            {showSettings ? 'Hide Settlement Settings' : 'Edit Settlement Settings'}
          </ThemedText>
        </Pressable>

        {/* Settlement Account Summary (always visible) */}
        <View style={styles.sectionCard}>
          <ThemedText style={styles.sectionTitle}>Settlement Account</ThemedText>
          <DetailRow label="KYC Status" value={String(seller?.payoutProfile?.kycStatus || 'pending').toUpperCase()} />
          <DetailRow label="Account type" value={String(seller?.payoutProfile?.bankDetails?.accountType || 'bank').toUpperCase()} />
          <DetailRow
            label={seller?.payoutProfile?.bankDetails?.accountType === 'upi' ? 'UPI ID' : 'Account'}
            value={
              seller?.payoutProfile?.bankDetails?.accountType === 'upi'
                ? seller?.payoutProfile?.bankDetails?.upiId || 'Not set'
                : seller?.payoutProfile?.bankDetails?.accountNumberMasked || 'Not set'
            }
          />
          <DetailRow label="Account holder" value={seller?.payoutProfile?.bankDetails?.accountHolderName || 'Not set'} isLast />
        </View>

        {/* Edit Settings Form */}
        {showSettings ? (
          <View style={styles.sectionCard}>
            <ThemedText style={styles.sectionTitle}>Edit Settlement Settings</ThemedText>

            <ThemedText style={styles.fieldLabel}>Account type</ThemedText>
            <View style={styles.segmentRow}>
              <Pressable style={[styles.segBtn, accountType === 'bank' && styles.segBtnActive]} onPress={() => setAccountType('bank')}>
                <ThemedText style={[styles.segText, accountType === 'bank' && styles.segTextActive]}>Bank</ThemedText>
              </Pressable>
              <Pressable style={[styles.segBtn, accountType === 'upi' && styles.segBtnActive]} onPress={() => setAccountType('upi')}>
                <ThemedText style={[styles.segText, accountType === 'upi' && styles.segTextActive]}>UPI</ThemedText>
              </Pressable>
            </View>

            <ThemedText style={styles.fieldLabel}>Account holder name</ThemedText>
            <TextInput value={accountHolderName} onChangeText={setAccountHolderName} style={styles.input} placeholder="Full name" placeholderTextColor="#5a6a80" />

            {accountType === 'bank' ? (
              <>
                <ThemedText style={styles.fieldLabel}>Account number</ThemedText>
                <TextInput value={accountNumber} onChangeText={setAccountNumber} style={styles.input} keyboardType="number-pad" placeholder="Leave blank to keep existing" placeholderTextColor="#5a6a80" />
                <ThemedText style={styles.fieldLabel}>IFSC code</ThemedText>
                <TextInput value={ifsc} onChangeText={setIfsc} style={styles.input} autoCapitalize="characters" placeholder="e.g. HDFC0001234" placeholderTextColor="#5a6a80" />
                <ThemedText style={styles.fieldLabel}>Bank name</ThemedText>
                <TextInput value={bankName} onChangeText={setBankName} style={styles.input} placeholder="e.g. HDFC Bank" placeholderTextColor="#5a6a80" />
                <ThemedText style={styles.fieldLabel}>Branch</ThemedText>
                <TextInput value={branch} onChangeText={setBranch} style={styles.input} placeholder="Branch name" placeholderTextColor="#5a6a80" />
              </>
            ) : (
              <>
                <ThemedText style={styles.fieldLabel}>UPI ID</ThemedText>
                <TextInput value={upiId} onChangeText={setUpiId} style={styles.input} placeholder="yourname@bank" placeholderTextColor="#5a6a80" />
              </>
            )}

            <ThemedText style={styles.fieldLabel}>Razorpay linked account ID (optional)</ThemedText>
            <TextInput value={linkedAccountId} onChangeText={setLinkedAccountId} style={styles.input} placeholder="acc_xxxxx" placeholderTextColor="#5a6a80" />

            <ThemedText style={styles.fieldLabel}>Minimum payout amount (₹)</ThemedText>
            <TextInput value={minimumPayoutAmount} onChangeText={setMinimumPayoutAmount} style={styles.input} keyboardType="decimal-pad" placeholder="0" placeholderTextColor="#5a6a80" />

            <Pressable
              style={({ pressed }) => [styles.saveBtn, (pressed || savingSettings) && styles.saveBtnPressed]}
              onPress={handleSaveSettings}
              disabled={savingSettings}
            >
              {savingSettings ? <ActivityIndicator color="#0f1a12" /> : null}
              <ThemedText style={styles.saveBtnText}>{savingSettings ? 'Saving…' : 'Save Settings'}</ThemedText>
            </Pressable>
          </View>
        ) : null}

        {/* ── Payout History ────────────────────────────────────────────── */}
        <View style={styles.sectionCard}>
          <ThemedText style={styles.sectionTitle}>Payout History</ThemedText>
          <ThemedText style={styles.sectionSub}>Tap any order to see the full earnings breakdown.</ThemedText>

          {payoutRows.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="wallet-outline" size={32} color="#2a3a4a" />
              <ThemedText style={styles.emptyTitle}>No payouts yet</ThemedText>
              <ThemedText style={styles.emptySub}>Make your first sale to see earnings here.</ThemedText>
            </View>
          ) : (
            payoutRows.map((entry, idx) => (
              <PayoutCard key={entry.id} entry={entry} isLast={idx === payoutRows.length - 1} />
            ))
          )}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

// ─── Reusable detail row ──────────────────────────────────────────────────────

function DetailRow({ label, value, isLast }: { label: string; value: string; isLast?: boolean }) {
  return (
    <View style={[styles.detailRow, isLast && styles.detailRowLast]}>
      <ThemedText style={styles.detailLabel}>{label}</ThemedText>
      <ThemedText style={styles.detailValue}>{value}</ThemedText>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050a0d' },
  header: {
    paddingTop: 62, paddingHorizontal: 14, paddingBottom: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  headerTitle: { color: '#f0f8ff', fontSize: 20, fontWeight: '800' },
  headerIconBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#0d1520', borderWidth: 1, borderColor: '#1e3048',
    alignItems: 'center', justifyContent: 'center',
  },
  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loaderText: { color: '#5a7a94', fontSize: 13 },
  content: { flex: 1 },
  contentInner: { paddingHorizontal: 14, paddingBottom: 32, gap: 10 },

  errorCard: {
    flexDirection: 'row', gap: 8, alignItems: 'center',
    borderRadius: 10, borderWidth: 1, borderColor: '#5a2030',
    backgroundColor: '#1a0810', paddingHorizontal: 12, paddingVertical: 10,
  },
  errorText: { color: '#ff8fa0', fontSize: 12, fontWeight: '700', flex: 1 },

  successBanner: {
    flexDirection: 'row', gap: 8, alignItems: 'center',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: '#1e5c32',
  },
  successText: { color: '#7ef5a0', fontSize: 12, fontWeight: '700', flex: 1 },

  // Hero card
  heroCard: {
    borderRadius: 20, padding: 20, overflow: 'hidden',
    borderWidth: 1, borderColor: '#1a3d28',
  },
  heroGlow: {
    position: 'absolute', top: -40, right: -40,
    width: 140, height: 140, borderRadius: 70,
    backgroundColor: '#7ef5a020',
  },
  heroLabel: { color: '#5a9470', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  heroAmount: { color: '#7ef5a0', fontSize: 36, fontWeight: '900', marginTop: 4, marginBottom: 8 },

  processingBadge: {
    flexDirection: 'row', gap: 5, alignItems: 'center',
    backgroundColor: '#1c1240', borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start', marginBottom: 12,
  },
  processingBadgeText: { color: '#c4b0ff', fontSize: 10, fontWeight: '700' },

  statRow: { flexDirection: 'row', gap: 6, marginTop: 4 },
  statPill: {
    flex: 1, borderRadius: 10,
    backgroundColor: '#0a1e12', borderWidth: 1, borderColor: '#183424',
    paddingHorizontal: 8, paddingVertical: 8, alignItems: 'center',
  },
  statPillMid: { borderColor: '#1e3424' },
  statValue: { color: '#d0f0dc', fontSize: 12, fontWeight: '800' },
  statLabel: { color: '#4a7a5c', fontSize: 9, fontWeight: '700', marginTop: 2 },

  // Sparkline
  sparkWrap: { marginTop: 14 },
  sparkLabel: { color: '#3a6a4e', fontSize: 9, fontWeight: '700', letterSpacing: 0.5, marginBottom: 6 },
  sparkBars: { flexDirection: 'row', alignItems: 'flex-end', height: 52, gap: 4 },
  sparkBarWrap: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  sparkBar: { width: '70%', borderRadius: 4, backgroundColor: '#2a6c42' },

  // KYC Banner
  kycBanner: {
    flexDirection: 'row', gap: 10, alignItems: 'center',
    borderRadius: 12, padding: 12,
    backgroundColor: '#1a1500', borderWidth: 1, borderColor: '#4a3d00',
  },
  kycTextWrap: { flex: 1 },
  kycTitle: { color: '#f5d16e', fontSize: 12, fontWeight: '800' },
  kycSub: { color: '#a08a3a', fontSize: 10, marginTop: 2 },
  kycBtn: {
    backgroundColor: '#2a2000', borderRadius: 8,
    borderWidth: 1, borderColor: '#6a5000',
    paddingHorizontal: 10, paddingVertical: 6,
  },
  kycBtnText: { color: '#f5d16e', fontSize: 10, fontWeight: '800' },

  // Info bar
  infoCard: {
    flexDirection: 'row', gap: 6, alignItems: 'flex-start',
    borderRadius: 10, backgroundColor: '#0a1520',
    borderWidth: 1, borderColor: '#1a2e42',
    paddingHorizontal: 10, paddingVertical: 8,
  },
  infoText: { color: '#6a8aaa', fontSize: 10, flex: 1, lineHeight: 15 },

  // Withdraw button
  withdrawBtn: { borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#2a5c3a' },
  withdrawBtnPressed: { opacity: 0.85 },
  withdrawBtnInner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14,
  },
  withdrawBtnText: { color: '#7ef5a0', fontSize: 14, fontWeight: '800' },
  withdrawBtnTextDim: { color: '#3a4a56' },

  // Settings toggle
  settingsToggle: {
    flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    borderRadius: 10, borderWidth: 1, borderColor: '#1a2e42',
    backgroundColor: '#0a1520', paddingVertical: 10,
  },
  settingsToggleText: { color: '#8ab4d8', fontSize: 11, fontWeight: '700' },

  // Section cards
  sectionCard: {
    borderRadius: 14, borderWidth: 1, borderColor: '#1a2a3a',
    backgroundColor: '#090f18', paddingHorizontal: 14, paddingVertical: 12,
  },
  sectionTitle: { color: '#d0e8ff', fontSize: 12, fontWeight: '800', marginBottom: 10 },
  sectionSub: { color: '#4a6880', fontSize: 10, marginBottom: 10, marginTop: -6 },

  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#121e2c',
  },
  detailRowLast: { borderBottomWidth: 0 },
  detailLabel: { color: '#5a7a9a', fontSize: 11 },
  detailValue: { color: '#c0d8f0', fontSize: 11, fontWeight: '700', textAlign: 'right', flexShrink: 1 },

  // Settings form
  fieldLabel: { color: '#6a8aaa', fontSize: 10, fontWeight: '700', marginTop: 8, marginBottom: 4 },
  input: {
    borderRadius: 10, borderWidth: 1, borderColor: '#1e3048',
    backgroundColor: '#0a1520', color: '#c0d8f0', fontSize: 12,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  segmentRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  segBtn: {
    flex: 1, borderRadius: 10, borderWidth: 1, borderColor: '#1e3048',
    backgroundColor: '#0a1520', alignItems: 'center', justifyContent: 'center', paddingVertical: 9,
  },
  segBtnActive: { borderColor: '#7ef5a0', backgroundColor: '#102a1c' },
  segText: { color: '#6a8aaa', fontSize: 11, fontWeight: '700' },
  segTextActive: { color: '#7ef5a0' },

  saveBtn: {
    marginTop: 14, borderRadius: 12, backgroundColor: '#7ef5a0',
    paddingVertical: 12, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 6,
  },
  saveBtnPressed: { opacity: 0.85 },
  saveBtnText: { color: '#0a1e12', fontSize: 13, fontWeight: '800' },

  // Payout cards
  payoutCard: {
    borderBottomWidth: 1, borderBottomColor: '#121e2c', paddingVertical: 12, gap: 4,
  },
  payoutCardLast: { borderBottomWidth: 0 },
  payoutHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  payoutOrderWrap: { flex: 1, gap: 4 },
  payoutOrderId: { color: '#c0d8f0', fontSize: 12, fontWeight: '800' },
  payoutRight: { alignItems: 'flex-end', gap: 4 },
  payoutNet: { color: '#7ef5a0', fontSize: 14, fontWeight: '900' },

  statusPill: {
    borderRadius: 999, borderWidth: 1,
    paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start',
  },
  statusPillText: { fontSize: 8, fontWeight: '800' },

  countdownChip: {
    flexDirection: 'row', gap: 3, alignItems: 'center',
    backgroundColor: '#1a1400', borderRadius: 999,
    paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start',
  },
  countdownText: { color: '#f5d16e', fontSize: 9, fontWeight: '700' },

  processingChip: {
    flexDirection: 'row', gap: 3, alignItems: 'center',
    backgroundColor: '#12083a', borderRadius: 999,
    paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start',
  },
  processingChipText: { color: '#c4b0ff', fontSize: 9, fontWeight: '700' },

  expandHint: { marginTop: 2 },
  expandHintText: { color: '#2a4a6a', fontSize: 9, fontWeight: '600' },

  // Breakdown
  breakdownBox: {
    marginTop: 8, backgroundColor: '#060d15',
    borderRadius: 10, padding: 10, gap: 4,
  },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  breakdownLabel: { color: '#5a7a9a', fontSize: 10, flex: 1 },
  breakdownLabelBold: { color: '#c0d8f0', fontWeight: '800' },
  breakdownValue: { color: '#8aaaca', fontSize: 10, fontWeight: '700' },
  breakdownNeg: { color: '#e07070' },
  breakdownHighlight: { color: '#7ef5a0', fontSize: 12, fontWeight: '900' },
  breakdownDivider: { height: 1, backgroundColor: '#1a2c3c', marginVertical: 4 },
  refText: { color: '#3a5a7a', fontSize: 9, marginTop: 2 },
  failureText: { color: '#e07070', fontSize: 9, fontWeight: '700', marginTop: 4 },

  // Empty state
  emptyWrap: { alignItems: 'center', paddingVertical: 20, gap: 6 },
  emptyTitle: { color: '#3a5a7a', fontSize: 14, fontWeight: '800' },
  emptySub: { color: '#2a3a4a', fontSize: 11, textAlign: 'center' },
});
