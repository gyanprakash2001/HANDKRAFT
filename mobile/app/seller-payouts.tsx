import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Linking,
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
  getSellerPayoutDashboard,
  requestSellerPayout,
  updateSellerPayoutProfile,
  SellerPayoutDashboardResponse,
  SellerPayoutEntry,
  SellerPayoutStatus,
} from '@/utils/api';

const SUPPORT_PHONE = '7619189174';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(amount: number) {
  return '₹' + Number(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(v: string | null | undefined) {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function holdCountdown(holdUntil: string | null | undefined) {
  if (!holdUntil) return '';
  const diff = new Date(holdUntil).getTime() - Date.now();
  if (diff <= 0) return 'Releasing…';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h >= 48) return `${Math.floor(h / 24)}d left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

function statusStyle(status: SellerPayoutStatus) {
  const s: Record<string, { bg: string; border: string; text: string; icon: string; label: string }> = {
    paid:             { bg: '#0e2218', border: '#2a6a3f', text: '#7ef5a0', icon: 'checkmark-circle',   label: 'PAID' },
    on_hold:          { bg: '#1a1500', border: '#5c4e00', text: '#f5d16e', icon: 'time',               label: 'ON HOLD' },
    ready_for_payout: { bg: '#0a1a2e', border: '#2a5580', text: '#78c8ff', icon: 'flash',              label: 'READY TO CLAIM' },
    processing:       { bg: '#100c2a', border: '#483a90', text: '#c4b0ff', icon: 'sync',               label: 'PROCESSING (~2h)' },
    awaiting_delivery:{ bg: '#111820', border: '#2e4460', text: '#9ab8d4', icon: 'hourglass',          label: 'INCOMING' },
    failed:           { bg: '#200a10', border: '#6a2838', text: '#ff8fa0', icon: 'warning',            label: 'FAILED' },
    cancelled:        { bg: '#1a1c20', border: '#4a5060', text: '#8a96a8', icon: 'close-circle',       label: 'CANCELLED' },
    reversed:         { bg: '#1a1c20', border: '#4a5060', text: '#8a96a8', icon: 'refresh-circle',     label: 'REVERSED' },
  };
  return s[status] ?? { bg: '#161a20', border: '#3a4050', text: '#9aa8bc', icon: 'ellipse', label: status.toUpperCase() };
}

// ─── Animated Counter ─────────────────────────────────────────────────────────

function AnimatedBalance({ to }: { to: number }) {
  const anim = useRef(new Animated.Value(0)).current;
  const [display, setDisplay] = useState('0.00');
  useEffect(() => {
    anim.setValue(0);
    const listener = anim.addListener(({ value: v }) =>
      setDisplay(v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
    );
    const run = Animated.timing(anim, { toValue: to, duration: 1000, useNativeDriver: false });
    run.start();
    return () => { run.stop(); anim.removeListener(listener); };
  }, [to, anim]);
  return <ThemedText style={styles.heroAmount}>₹{display}</ThemedText>;
}

// ─── Payout Card ──────────────────────────────────────────────────────────────

function PayoutCard({ entry, isLast }: { entry: SellerPayoutEntry; isLast: boolean }) {
  const [open, setOpen] = useState(false);
  const st = statusStyle(entry.status);
  const countdown = holdCountdown(entry.holdUntil);

  return (
    <Pressable onPress={() => setOpen(p => !p)} style={[styles.payoutCard, isLast && { borderBottomWidth: 0 }]}>
      <View style={styles.payoutRow}>
        <View style={{ flex: 1, gap: 3 }}>
          <ThemedText style={styles.payoutOrderId}>#{entry.orderId.slice(-8).toUpperCase()}</ThemedText>
          <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
            {entry.status === 'on_hold' && countdown ? (
              <View style={styles.chip}>
                <Ionicons name="time-outline" size={9} color="#f5d16e" />
                <ThemedText style={[styles.chipText, { color: '#f5d16e' }]}>{countdown}</ThemedText>
              </View>
            ) : null}
            {entry.status === 'processing' ? (
              <View style={[styles.chip, { backgroundColor: '#12083a' }]}>
                <Ionicons name="sync-outline" size={9} color="#c4b0ff" />
                <ThemedText style={[styles.chipText, { color: '#c4b0ff' }]}>~2 hrs</ThemedText>
              </View>
            ) : null}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <ThemedText style={styles.payoutNet}>{fmt(entry.split.netPayoutAmount)}</ThemedText>
          <View style={[styles.statusPill, { backgroundColor: st.bg, borderColor: st.border }]}>
            <ThemedText style={[styles.statusPillText, { color: st.text }]}>{st.label}</ThemedText>
          </View>
        </View>
      </View>
      <ThemedText style={styles.expandHint}>{open ? 'Hide breakdown ▲' : 'Show breakdown ▼'}</ThemedText>

      {open ? (
        <View style={styles.breakdown}>
          <BdRow label="Your sale price" value={fmt(entry.split.itemSubtotal)} />
          <BdRow label="Shipping deducted" value={`−${fmt(entry.split.shippingDeduction)}`} neg />
          <BdRow
            label={`Platform fee (₹${(entry.split.platformFeeFlat ?? entry.split.platformFeeAmount ?? 8).toFixed(0)} incl. ₹${(entry.split.csrAmount ?? 1).toFixed(0)} CSR)`}
            value={`−${fmt(entry.split.platformFeeAmount)}`}
            neg
          />
          <View style={styles.bdDivider} />
          <BdRow label="Your net payout" value={fmt(entry.split.netPayoutAmount)} bold />
          {entry.payout.referenceId ? <ThemedText style={styles.refText}>Ref: {entry.payout.referenceId}</ThemedText> : null}
          {entry.payout.paidAt ? <ThemedText style={styles.refText}>Paid: {fmtDate(entry.payout.paidAt)}</ThemedText> : null}
          {entry.payout.failureReason ? <ThemedText style={styles.failText}>{entry.payout.failureReason}</ThemedText> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

function BdRow({ label, value, neg, bold }: { label: string; value: string; neg?: boolean; bold?: boolean }) {
  return (
    <View style={styles.bdRow}>
      <ThemedText style={[styles.bdLabel, bold && styles.bdLabelBold]}>{label}</ThemedText>
      <ThemedText style={[styles.bdValue, neg && styles.bdNeg, bold && styles.bdHighlight]}>{value}</ThemedText>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function SellerPayoutsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [savingBank, setSavingBank] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<SellerPayoutDashboardResponse | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Bank form state
  const [acType, setAcType] = useState<'bank' | 'upi'>('bank');
  const [holderName, setHolderName] = useState('');
  const [acNumber, setAcNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [bankName, setBankName] = useState('');
  const [branch, setBranch] = useState('');
  const [upiId, setUpiId] = useState('');
  const [linkedId, setLinkedId] = useState('');
  const [minPayout, setMinPayout] = useState('0');

  const hydrateForm = (data: SellerPayoutDashboardResponse) => {
    const b = data.seller.payoutProfile.bankDetails;
    setAcType((b.accountType || 'bank') as 'bank' | 'upi');
    setHolderName(b.accountHolderName || '');
    setAcNumber('');
    setIfsc(b.ifsc || '');
    setBankName(b.bankName || '');
    setBranch(b.branch || '');
    setUpiId(b.upiId || '');
    setLinkedId(b.razorpayLinkedAccountId || '');
    setMinPayout(String(data.seller.payoutSettings.minimumPayoutAmount ?? 0));
  };

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      setError(null);
      const data = await getSellerPayoutDashboard({ page: 1, limit: 50 });
      setDashboard(data);
      hydrateForm(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load wallet');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => (dashboard?.payouts || []).slice(0, 30), [dashboard]);

  // ── Claim payout ────────────────────────────────────────────────────────────
  const handleClaim = useCallback(async () => {
    const kycOk = dashboard?.seller?.payoutProfile?.kycStatus === 'verified';
    const bank = dashboard?.seller?.payoutProfile?.bankDetails;
    const hasBank = acType === 'upi'
      ? Boolean(bank?.upiId)
      : Boolean(bank?.accountNumberMasked && bank?.ifsc);
    const claimable = Number(dashboard?.summary?.claimableAmount ?? 0);

    if (!kycOk) {
      Alert.alert(
        'KYC Not Verified',
        'Please complete your KYC first. Add your bank or UPI details in "Bank/UPI Settings" below.',
        [{ text: 'OK' }, { text: 'Open Settings', onPress: () => setShowSettings(true) }]
      );
      return;
    }
    if (!hasBank) {
      Alert.alert(
        'Bank Details Missing',
        'Add your bank account or UPI ID in "Bank/UPI Settings" before claiming.',
        [{ text: 'OK' }, { text: 'Open Settings', onPress: () => setShowSettings(true) }]
      );
      return;
    }
    if (claimable <= 0) {
      Alert.alert('No Balance', 'You have no balance ready to claim right now.');
      return;
    }

    Alert.alert(
      'Claim Payout?',
      `Claim ${fmt(claimable)} to your ${acType === 'upi' ? 'UPI ID' : 'bank account'}?\n\nYou will receive the payment within 2 hours. If not, call ${SUPPORT_PHONE}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, Claim Now',
          onPress: async () => {
            try {
              setRequesting(true);
              const result = await requestSellerPayout({ requestAll: true });
              setDashboard(result.dashboard);
              setSuccessMsg(
                `✅ ${fmt(result.requestedAmount)} claim submitted!\nYou'll receive it within 2 hours.\nIf not, call ${SUPPORT_PHONE}.`
              );
              setTimeout(() => setSuccessMsg(null), 10000);
            } catch (e: any) {
              Alert.alert('Claim Failed', e?.message || 'Unable to submit claim. Try again.');
            } finally {
              setRequesting(false);
            }
          },
        },
      ]
    );
  }, [dashboard, acType]);

  // ── Save bank settings ──────────────────────────────────────────────────────
  const handleSaveBank = useCallback(async () => {
    try {
      setSavingBank(true);
      const bankPayload: Record<string, string> = {
        accountType: acType,
        accountHolderName: holderName.trim(),
        ifsc: ifsc.trim().toUpperCase(),
        bankName: bankName.trim(),
        branch: branch.trim(),
        upiId: upiId.trim(),
        razorpayLinkedAccountId: linkedId.trim(),
      };
      if (acNumber.trim()) bankPayload.accountNumber = acNumber.trim();

      await updateSellerPayoutProfile({
        bankDetails: bankPayload,
        payoutSettings: { minimumPayoutAmount: Math.max(0, Number(minPayout) || 0) },
      });
      await load(true);
      Alert.alert('Saved', 'Your bank/UPI details have been updated.');
    } catch (e: any) {
      Alert.alert('Save Failed', e?.message || 'Could not save settings.');
    } finally {
      setSavingBank(false);
    }
  }, [acType, holderName, acNumber, ifsc, bankName, branch, upiId, linkedId, minPayout, load]);

  // ── Derived values ──────────────────────────────────────────────────────────
  const s = dashboard?.summary;
  const seller = dashboard?.seller;
  const claimable = Number(s?.claimableAmount ?? 0);
  const onHold = Number(s?.onHoldAmount ?? 0);
  const processing = Number(s?.processingAmount ?? 0);
  const incoming = Number(s?.incomingAmount ?? 0);
  const paid = Number(s?.paidAmount ?? 0);
  const nextRelease = s?.nextReleaseAt ?? null;
  const holdDays = Number(seller?.policy?.holdDaysAfterDelivery ?? 2);
  const feeFlat = Number(seller?.policy?.platformFeeFlat ?? 8);
  const csr = Number(seller?.policy?.csrAmount ?? 1);
  const kycVerified = seller?.payoutProfile?.kycStatus === 'verified';
  const bankDetails = seller?.payoutProfile?.bankDetails;

  if (loading) {
    return (
      <ThemedView style={styles.screen}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={22} color="#f0f6ff" />
          </Pressable>
          <ThemedText style={styles.headerTitle}>My Wallet</ThemedText>
          <View style={styles.iconBtn} />
        </View>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#7ef5a0" />
          <ThemedText style={styles.loadingText}>Loading your wallet…</ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color="#f0f6ff" />
        </Pressable>
        <ThemedText style={styles.headerTitle}>My Wallet</ThemedText>
        <Pressable onPress={() => load(true)} style={styles.iconBtn}>
          <Ionicons name="refresh" size={18} color="#7ef5a0" />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor="#7ef5a0" />}
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
            <View style={{ flex: 1 }}>
              {successMsg.split('\n').map((line, i) => (
                <ThemedText key={i} style={styles.successText}>{line}</ThemedText>
              ))}
              <Pressable onPress={() => Linking.openURL(`tel:${SUPPORT_PHONE}`)}>
                <ThemedText style={styles.callLink}>📞 Tap to call {SUPPORT_PHONE}</ThemedText>
              </Pressable>
            </View>
          </LinearGradient>
        ) : null}

        {/* ── Hero card ──────────────────────────────────────────────── */}
        <LinearGradient colors={['#0a1a0e', '#0d2215', '#091810']} style={styles.heroCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
          <View style={styles.heroGlow} />
          <ThemedText style={styles.heroLabel}>AVAILABLE TO CLAIM</ThemedText>
          <AnimatedBalance to={claimable} />

          {processing > 0 ? (
            <LinearGradient colors={['#1c1240', '#14103a']} style={styles.processingBanner}>
              <Ionicons name="sync-outline" size={12} color="#c4b0ff" />
              <View style={{ flex: 1 }}>
                <ThemedText style={styles.processingText}>{fmt(processing)} is being processed — arrives ~2 hrs</ThemedText>
                <Pressable onPress={() => Linking.openURL(`tel:${SUPPORT_PHONE}`)}>
                  <ThemedText style={styles.processingCallText}>Issues? Call {SUPPORT_PHONE}</ThemedText>
                </Pressable>
              </View>
            </LinearGradient>
          ) : null}

          {/* Stats row */}
          <View style={styles.statsRow}>
            <StatPill label="On Hold" value={fmt(onHold)} color="#f5d16e" />
            <StatPill label="Incoming" value={fmt(incoming)} color="#9ab8d4" />
            <StatPill label="Total Paid" value={fmt(paid)} color="#7ef5a0" />
          </View>
        </LinearGradient>

        {/* ── Policy info ────────────────────────────────────────────── */}
        <View style={styles.policyBar}>
          <Ionicons name="information-circle-outline" size={12} color="#5a7a9a" />
          <ThemedText style={styles.policyText}>
            {holdDays}-day hold after delivery · ₹{feeFlat} platform fee (₹{csr} CSR) per order
            {nextRelease ? ` · Next release: ${fmtDate(nextRelease)}` : ''}
          </ThemedText>
        </View>

        {/* ── KYC Banner ─────────────────────────────────────────────── */}
        {!kycVerified ? (
          <View style={styles.kycBanner}>
            <Ionicons name="shield-outline" size={16} color="#f5d16e" />
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.kycTitle}>Complete KYC to Withdraw</ThemedText>
              <ThemedText style={styles.kycSub}>Add bank/UPI details to start receiving payouts.</ThemedText>
            </View>
            <Pressable onPress={() => setShowSettings(true)} style={styles.kycBtn}>
              <ThemedText style={styles.kycBtnText}>Setup →</ThemedText>
            </Pressable>
          </View>
        ) : null}

        {/* ── CLAIM BUTTON ───────────────────────────────────────────── */}
        <Pressable
          onPress={handleClaim}
          disabled={requesting}
          style={({ pressed }) => [styles.claimBtn, (pressed || requesting) && { opacity: 0.8 }]}
        >
          <LinearGradient
            colors={claimable > 0 ? ['#1a4d2e', '#1f6e3a'] : ['#181818', '#1e1e1e']}
            style={styles.claimBtnInner}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            {requesting
              ? <ActivityIndicator color="#7ef5a0" size="small" />
              : <Ionicons name="arrow-up-circle" size={20} color={claimable > 0 ? '#7ef5a0' : '#3a4a56'} />
            }
            <ThemedText style={[styles.claimBtnText, claimable <= 0 && { color: '#3a4a56' }]}>
              {requesting ? 'Submitting Claim…' : claimable > 0 ? `Claim ${fmt(claimable)}` : 'No Balance to Claim'}
            </ThemedText>
          </LinearGradient>
        </Pressable>

        {claimable > 0 ? (
          <ThemedText style={styles.claimHint}>
            Payment within 2 hrs · Need help? Call {SUPPORT_PHONE}
          </ThemedText>
        ) : null}

        {/* ── Settlement Account Summary ─────────────────────────────── */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <ThemedText style={styles.cardTitle}>Settlement Account</ThemedText>
            <Pressable onPress={() => setShowSettings(p => !p)} style={styles.editBtn}>
              <Ionicons name={showSettings ? 'chevron-up' : 'pencil'} size={12} color="#7ef5a0" />
              <ThemedText style={styles.editBtnText}>{showSettings ? 'Close' : 'Edit'}</ThemedText>
            </Pressable>
          </View>

          <DetailRow label="KYC Status" value={String(seller?.payoutProfile?.kycStatus || 'pending').toUpperCase()} />
          <DetailRow
            label="Account Type"
            value={String(bankDetails?.accountType || 'bank').toUpperCase()}
          />
          <DetailRow
            label={bankDetails?.accountType === 'upi' ? 'UPI ID' : 'Account'}
            value={
              bankDetails?.accountType === 'upi'
                ? bankDetails?.upiId || 'Not set'
                : bankDetails?.accountNumberMasked || 'Not set'
            }
          />
          <DetailRow label="Name" value={bankDetails?.accountHolderName || 'Not set'} isLast />
        </View>

        {/* Bank Settings Form */}
        {showSettings ? (
          <View style={styles.card}>
            <ThemedText style={styles.cardTitle}>Edit Bank / UPI Settings</ThemedText>

            <ThemedText style={styles.fieldLabel}>Account type</ThemedText>
            <View style={styles.segRow}>
              <Pressable style={[styles.seg, acType === 'bank' && styles.segActive]} onPress={() => setAcType('bank')}>
                <ThemedText style={[styles.segText, acType === 'bank' && styles.segTextActive]}>Bank Account</ThemedText>
              </Pressable>
              <Pressable style={[styles.seg, acType === 'upi' && styles.segActive]} onPress={() => setAcType('upi')}>
                <ThemedText style={[styles.segText, acType === 'upi' && styles.segTextActive]}>UPI</ThemedText>
              </Pressable>
            </View>

            <ThemedText style={styles.fieldLabel}>Account holder name</ThemedText>
            <TextInput style={styles.input} value={holderName} onChangeText={setHolderName} placeholder="Full legal name" placeholderTextColor="#4a5a70" />

            {acType === 'bank' ? (
              <>
                <ThemedText style={styles.fieldLabel}>Account number (leave blank to keep existing)</ThemedText>
                <TextInput style={styles.input} value={acNumber} onChangeText={setAcNumber} keyboardType="number-pad" placeholder="Bank account number" placeholderTextColor="#4a5a70" />
                <ThemedText style={styles.fieldLabel}>IFSC code</ThemedText>
                <TextInput style={styles.input} value={ifsc} onChangeText={setIfsc} autoCapitalize="characters" placeholder="e.g. HDFC0001234" placeholderTextColor="#4a5a70" />
                <ThemedText style={styles.fieldLabel}>Bank name</ThemedText>
                <TextInput style={styles.input} value={bankName} onChangeText={setBankName} placeholder="e.g. HDFC Bank" placeholderTextColor="#4a5a70" />
                <ThemedText style={styles.fieldLabel}>Branch</ThemedText>
                <TextInput style={styles.input} value={branch} onChangeText={setBranch} placeholder="Branch name" placeholderTextColor="#4a5a70" />
              </>
            ) : (
              <>
                <ThemedText style={styles.fieldLabel}>UPI ID</ThemedText>
                <TextInput style={styles.input} value={upiId} onChangeText={setUpiId} placeholder="yourname@upi" placeholderTextColor="#4a5a70" />
              </>
            )}

            <ThemedText style={styles.fieldLabel}>Razorpay linked account ID (optional)</ThemedText>
            <TextInput style={styles.input} value={linkedId} onChangeText={setLinkedId} placeholder="acc_xxxxxx" placeholderTextColor="#4a5a70" />

            <ThemedText style={styles.fieldLabel}>Minimum payout amount (₹)</ThemedText>
            <TextInput style={styles.input} value={minPayout} onChangeText={setMinPayout} keyboardType="decimal-pad" placeholder="0" placeholderTextColor="#4a5a70" />

            <Pressable
              onPress={handleSaveBank}
              disabled={savingBank}
              style={({ pressed }) => [styles.saveBtn, (pressed || savingBank) && { opacity: 0.8 }]}
            >
              {savingBank ? <ActivityIndicator color="#0a1e12" /> : null}
              <ThemedText style={styles.saveBtnText}>{savingBank ? 'Saving…' : 'Save Settings'}</ThemedText>
            </Pressable>
          </View>
        ) : null}

        {/* ── Payout History ─────────────────────────────────────────── */}
        <View style={styles.card}>
          <ThemedText style={styles.cardTitle}>Payout History</ThemedText>
          <ThemedText style={styles.cardSub}>Tap any order to see full breakdown</ThemedText>

          {rows.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="wallet-outline" size={36} color="#1a2e40" />
              <ThemedText style={styles.emptyTitle}>No payouts yet</ThemedText>
              <ThemedText style={styles.emptySub}>Make a sale and deliver it to see earnings here.</ThemedText>
            </View>
          ) : (
            rows.map((entry, i) => (
              <PayoutCard key={entry.id} entry={entry} isLast={i === rows.length - 1} />
            ))
          )}
        </View>

        {/* Support footer */}
        <Pressable onPress={() => Linking.openURL(`tel:${SUPPORT_PHONE}`)} style={styles.supportFooter}>
          <Ionicons name="call-outline" size={14} color="#4a7a9a" />
          <ThemedText style={styles.supportText}>Payout issues? Call {SUPPORT_PHONE}</ThemedText>
        </Pressable>
      </ScrollView>
    </ThemedView>
  );
}

// ─── Small components ─────────────────────────────────────────────────────────

function StatPill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.statPill}>
      <ThemedText style={[styles.statValue, { color }]}>{value}</ThemedText>
      <ThemedText style={styles.statLabel}>{label}</ThemedText>
    </View>
  );
}

function DetailRow({ label, value, isLast }: { label: string; value: string; isLast?: boolean }) {
  return (
    <View style={[styles.detailRow, isLast && { borderBottomWidth: 0 }]}>
      <ThemedText style={styles.detailLabel}>{label}</ThemedText>
      <ThemedText style={styles.detailValue}>{value}</ThemedText>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#050a0d' },
  header: { paddingTop: 62, paddingHorizontal: 14, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { color: '#f0f8ff', fontSize: 20, fontWeight: '800' },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#0d1520', borderWidth: 1, borderColor: '#1e3048', alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#4a6a88', fontSize: 13 },
  scroll: { paddingHorizontal: 14, paddingBottom: 40, gap: 10 },

  errorCard: { flexDirection: 'row', gap: 8, alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#5a2030', backgroundColor: '#1a0810', paddingHorizontal: 12, paddingVertical: 10 },
  errorText: { color: '#ff8fa0', fontSize: 12, fontWeight: '700', flex: 1 },

  successBanner: { borderRadius: 14, padding: 14, gap: 8, flexDirection: 'row', alignItems: 'flex-start', borderWidth: 1, borderColor: '#1e5c32' },
  successText: { color: '#7ef5a0', fontSize: 12, fontWeight: '700' },
  callLink: { color: '#5ab87a', fontSize: 11, marginTop: 4 },

  heroCard: { borderRadius: 20, padding: 20, overflow: 'hidden', borderWidth: 1, borderColor: '#1a3d28' },
  heroGlow: { position: 'absolute', top: -40, right: -40, width: 140, height: 140, borderRadius: 70, backgroundColor: '#7ef5a020' },
  heroLabel: { color: '#4a7a5a', fontSize: 10, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 },
  heroAmount: { color: '#7ef5a0', fontSize: 38, fontWeight: '900', marginBottom: 8 },

  processingBanner: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 12, borderWidth: 1, borderColor: '#3a2a70' },
  processingText: { color: '#c4b0ff', fontSize: 10, fontWeight: '700' },
  processingCallText: { color: '#7a6aaa', fontSize: 9, marginTop: 2 },

  statsRow: { flexDirection: 'row', gap: 6, marginTop: 4 },
  statPill: { flex: 1, borderRadius: 10, backgroundColor: '#0a1e12', borderWidth: 1, borderColor: '#183424', paddingHorizontal: 8, paddingVertical: 8, alignItems: 'center' },
  statValue: { fontSize: 11, fontWeight: '800' },
  statLabel: { color: '#3a5a4a', fontSize: 9, fontWeight: '700', marginTop: 2 },

  policyBar: { flexDirection: 'row', gap: 6, alignItems: 'center', borderRadius: 8, borderWidth: 1, borderColor: '#1a2a3a', backgroundColor: '#090f18', paddingHorizontal: 10, paddingVertical: 7 },
  policyText: { color: '#4a6a8a', fontSize: 10, flex: 1 },

  kycBanner: { flexDirection: 'row', gap: 10, alignItems: 'center', borderRadius: 12, padding: 12, backgroundColor: '#1a1500', borderWidth: 1, borderColor: '#4a3d00' },
  kycTitle: { color: '#f5d16e', fontSize: 12, fontWeight: '800' },
  kycSub: { color: '#806a30', fontSize: 10, marginTop: 2 },
  kycBtn: { backgroundColor: '#2a2000', borderRadius: 8, borderWidth: 1, borderColor: '#6a5000', paddingHorizontal: 10, paddingVertical: 6 },
  kycBtnText: { color: '#f5d16e', fontSize: 10, fontWeight: '800' },

  claimBtn: { borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#2a5c3a' },
  claimBtnInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15 },
  claimBtnText: { color: '#7ef5a0', fontSize: 15, fontWeight: '800' },
  claimHint: { textAlign: 'center', color: '#3a5a4a', fontSize: 10, marginTop: -4 },

  card: { borderRadius: 14, borderWidth: 1, borderColor: '#1a2a3a', backgroundColor: '#090f18', paddingHorizontal: 14, paddingVertical: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  cardTitle: { color: '#d0e8ff', fontSize: 12, fontWeight: '800' },
  cardSub: { color: '#3a5a78', fontSize: 10, marginTop: -8, marginBottom: 10 },
  editBtn: { flexDirection: 'row', gap: 4, alignItems: 'center', backgroundColor: '#0d2a1c', borderRadius: 999, borderWidth: 1, borderColor: '#2a5c3a', paddingHorizontal: 8, paddingVertical: 4 },
  editBtnText: { color: '#7ef5a0', fontSize: 10, fontWeight: '700' },

  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#111e2c' },
  detailLabel: { color: '#4a6a8a', fontSize: 11 },
  detailValue: { color: '#c0d8f0', fontSize: 11, fontWeight: '700', textAlign: 'right', flex: 1, paddingLeft: 8 },

  fieldLabel: { color: '#5a7a9a', fontSize: 10, fontWeight: '700', marginTop: 10, marginBottom: 3 },
  input: { borderRadius: 10, borderWidth: 1, borderColor: '#1e3048', backgroundColor: '#0a1520', color: '#c0d8f0', fontSize: 12, paddingHorizontal: 12, paddingVertical: 10 },
  segRow: { flexDirection: 'row', gap: 8 },
  seg: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: '#1e3048', backgroundColor: '#0a1520', alignItems: 'center', paddingVertical: 9 },
  segActive: { borderColor: '#7ef5a0', backgroundColor: '#102a1c' },
  segText: { color: '#4a6a8a', fontSize: 11, fontWeight: '700' },
  segTextActive: { color: '#7ef5a0' },
  saveBtn: { marginTop: 14, borderRadius: 12, backgroundColor: '#7ef5a0', paddingVertical: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  saveBtnText: { color: '#0a1e12', fontSize: 13, fontWeight: '800' },

  payoutCard: { borderBottomWidth: 1, borderBottomColor: '#111e2c', paddingVertical: 12, gap: 4 },
  payoutRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  payoutOrderId: { color: '#c0d8f0', fontSize: 12, fontWeight: '800' },
  payoutNet: { color: '#7ef5a0', fontSize: 14, fontWeight: '900' },
  chip: { flexDirection: 'row', gap: 3, alignItems: 'center', backgroundColor: '#1a1400', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  chipText: { fontSize: 9, fontWeight: '700' },
  statusPill: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  statusPillText: { fontSize: 8, fontWeight: '800' },
  expandHint: { color: '#2a4a6a', fontSize: 9, fontWeight: '600' },

  breakdown: { marginTop: 8, backgroundColor: '#060d15', borderRadius: 10, padding: 10, gap: 3 },
  bdRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bdLabel: { color: '#4a6a8a', fontSize: 9, flex: 1 },
  bdLabelBold: { color: '#c0d8f0', fontWeight: '800' },
  bdValue: { color: '#8aaaca', fontSize: 9, fontWeight: '700' },
  bdNeg: { color: '#e07070' },
  bdHighlight: { color: '#7ef5a0', fontSize: 11, fontWeight: '900' },
  bdDivider: { height: 1, backgroundColor: '#1a2c3c', marginVertical: 3 },
  refText: { color: '#2a4a6a', fontSize: 9, marginTop: 2 },
  failText: { color: '#e07070', fontSize: 9, fontWeight: '700', marginTop: 4 },

  empty: { alignItems: 'center', paddingVertical: 24, gap: 6 },
  emptyTitle: { color: '#2a4a62', fontSize: 14, fontWeight: '800' },
  emptySub: { color: '#1a3050', fontSize: 11, textAlign: 'center' },

  supportFooter: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  supportText: { color: '#3a5a70', fontSize: 11 },
});
