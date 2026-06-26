import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';

export type OrderTimelineStep = {
  label: string;
  timestamp?: string;
  completed: boolean;
  active?: boolean;
};

const DEFAULT_STEPS: { key: string; label: string; icon: string }[] = [
  { key: 'placed', label: 'Order Placed', icon: 'receipt-outline' },
  { key: 'confirmed', label: 'Confirmed', icon: 'checkmark-circle-outline' },
  { key: 'shipped', label: 'Shipped', icon: 'cube-outline' },
  { key: 'out_for_delivery', label: 'Out for Delivery', icon: 'bicycle-outline' },
  { key: 'delivered', label: 'Delivered', icon: 'home-outline' },
];

const STATUS_TO_STEP_INDEX: Record<string, number> = {
  pending: 0,
  placed: 0,
  confirmed: 1,
  processing: 1,
  shipped: 2,
  in_transit: 2,
  out_for_delivery: 3,
  delivered: 4,
  completed: 4,
};

function formatTimelineDate(value?: string) {
  if (!value) return '';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
}

interface OrderTimelineProps {
  /** Current order status string (e.g. "shipped", "delivered") */
  status: string;
  /** Optional timestamps keyed by step key */
  timestamps?: Record<string, string>;
  /** Carrier name (e.g. "Delhivery") */
  carrierName?: string;
  /** AWB tracking number */
  awbNumber?: string;
  /** Estimated delivery date */
  estimatedDelivery?: string;
}

export default function OrderTimeline({
  status,
  timestamps,
  carrierName,
  awbNumber,
  estimatedDelivery,
}: OrderTimelineProps) {
  const currentStepIndex = useMemo(() => {
    const normalized = String(status || '').toLowerCase().replace(/[\s-]+/g, '_');
    return STATUS_TO_STEP_INDEX[normalized] ?? 0;
  }, [status]);

  const isCancelled = /cancel/i.test(status || '');

  return (
    <View style={styles.container}>
      <ThemedText style={styles.sectionLabel}>Order Progress</ThemedText>

      {isCancelled ? (
        <View style={styles.cancelledCard}>
          <Ionicons name="close-circle" size={20} color="#ff6b6b" />
          <ThemedText style={styles.cancelledText}>This order has been cancelled</ThemedText>
        </View>
      ) : (
        <View style={styles.stepsContainer}>
          {DEFAULT_STEPS.map((step, index) => {
            const isCompleted = index <= currentStepIndex;
            const isActive = index === currentStepIndex;
            const isLast = index === DEFAULT_STEPS.length - 1;
            const stepTimestamp = timestamps?.[step.key];

            return (
              <View key={step.key} style={styles.stepRow}>
                {/* Left: dot/line */}
                <View style={styles.stepIndicatorColumn}>
                  <View
                    style={[
                      styles.stepDot,
                      isCompleted && styles.stepDotCompleted,
                      isActive && styles.stepDotActive,
                    ]}>
                    <Ionicons
                      name={step.icon as any}
                      size={12}
                      color={isCompleted ? '#0a0a0a' : '#5a7a9e'}
                    />
                  </View>
                  {!isLast ? (
                    <View
                      style={[
                        styles.stepLine,
                        isCompleted && index < currentStepIndex && styles.stepLineCompleted,
                      ]}
                    />
                  ) : null}
                </View>

                {/* Right: label + timestamp */}
                <View style={styles.stepContent}>
                  <ThemedText
                    style={[
                      styles.stepLabel,
                      isCompleted && styles.stepLabelCompleted,
                      isActive && styles.stepLabelActive,
                    ]}>
                    {step.label}
                  </ThemedText>
                  {stepTimestamp ? (
                    <ThemedText style={styles.stepTimestamp}>
                      {formatTimelineDate(stepTimestamp)}
                    </ThemedText>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Carrier info strip */}
      {(carrierName || awbNumber || estimatedDelivery) && !isCancelled ? (
        <View style={styles.carrierStrip}>
          {carrierName ? (
            <View style={styles.carrierRow}>
              <Ionicons name="airplane-outline" size={13} color="#7fb8ff" />
              <ThemedText style={styles.carrierText}>Shipped via {carrierName}</ThemedText>
            </View>
          ) : null}
          {awbNumber ? (
            <View style={styles.carrierRow}>
              <Ionicons name="barcode-outline" size={13} color="#7fb8ff" />
              <ThemedText style={styles.carrierText}>AWB: {awbNumber}</ThemedText>
            </View>
          ) : null}
          {estimatedDelivery ? (
            <View style={styles.carrierRow}>
              <Ionicons name="calendar-outline" size={13} color="#9df0a2" />
              <ThemedText style={styles.carrierEstimate}>
                Est. delivery: {formatTimelineDate(estimatedDelivery)}
              </ThemedText>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 16,
    gap: 10,
  },
  sectionLabel: {
    color: '#8ca2bf',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  stepsContainer: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e3148',
    backgroundColor: '#0e1a28',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  stepIndicatorColumn: {
    width: 28,
    alignItems: 'center',
  },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#2d4560',
    backgroundColor: '#0e1a28',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotCompleted: {
    backgroundColor: '#9df0a2',
    borderColor: '#6dd873',
  },
  stepDotActive: {
    backgroundColor: '#7fb8ff',
    borderColor: '#5a9ae0',
    shadowColor: '#7fb8ff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 4,
  },
  stepLine: {
    width: 2,
    height: 24,
    backgroundColor: '#2d4560',
  },
  stepLineCompleted: {
    backgroundColor: '#9df0a2',
  },
  stepContent: {
    flex: 1,
    paddingLeft: 10,
    paddingBottom: 18,
  },
  stepLabel: {
    color: '#5a7a9e',
    fontSize: 13,
    fontWeight: '600',
  },
  stepLabelCompleted: {
    color: '#c9f8ce',
  },
  stepLabelActive: {
    color: '#dce9fb',
    fontWeight: '700',
  },
  stepTimestamp: {
    color: '#6b8db5',
    fontSize: 11,
    marginTop: 1,
  },
  cancelledCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#4a2020',
    backgroundColor: '#1a0e0e',
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cancelledText: {
    color: '#ff9b9b',
    fontSize: 13,
    fontWeight: '600',
  },
  carrierStrip: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e3148',
    backgroundColor: '#0c1520',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  carrierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  carrierText: {
    color: '#b9d4f0',
    fontSize: 12,
  },
  carrierEstimate: {
    color: '#9df0a2',
    fontSize: 12,
    fontWeight: '600',
  },
});
