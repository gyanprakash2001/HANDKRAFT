import { useState, useEffect } from 'react';
import { StyleSheet, View, Pressable, ActivityIndicator, ScrollView, FlatList, Linking } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { getUserOrderDetails, Order } from '@/utils/api';

export default function OrderDetailsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const orderId = params.orderId as string;

  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadOrder = async () => {
      try {
        setError(null);
        const data = await getUserOrderDetails(orderId);
        setOrder(data);
      } catch (err: any) {
        setError(err?.message || 'Failed to load order');
      } finally {
        setLoading(false);
      }
    };

    loadOrder();
  }, [orderId]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'delivered':
        return '#1a4d2e';
      case 'shipped':
        return '#2d3d5c';
      case 'confirmed':
        return '#3d4d5c';
      default:
        return '#4d3d1a';
    }
  };

  const getStatusTextColor = (status: string) => {
    switch (status) {
      case 'delivered':
        return '#7cff6f';
      case 'shipped':
        return '#7fb8ff';
      case 'confirmed':
        return '#a8b4d4';
      default:
        return '#ffb366';
    }
  };

  const getShipmentStatusLabel = (status: string) => {
    const map: Record<string, string> = {
      pending: 'Awaiting Payment',
      ready_for_booking: 'Ready to Ship',
      booked: 'Booked',
      awb_assigned: 'AWB Assigned',
      pickup_scheduled: 'Pickup Scheduled',
      in_transit: 'In Transit',
      delivered: 'Delivered',
      cancelled: 'Cancelled',
      failed: 'Failed',
    };
    return map[status] || status;
  };

  const renderOrderItem = ({ item }: any) => (
    <View style={styles.itemCard}>
      <Image
        source={{ uri: item.image || 'https://placehold.co/100x100?text=Product' }}
        style={styles.itemImage}
        contentFit="cover"
      />
      <View style={styles.itemDetails}>
        <ThemedText numberOfLines={2} style={styles.itemTitle}>
          {item.title}
        </ThemedText>
        <ThemedText style={styles.itemQty}>Qty: {item.quantity}</ThemedText>
        <ThemedText style={styles.itemPrice}>₹{item.price.toFixed(2)}</ThemedText>
      </View>
      <ThemedText style={styles.itemTotal}>₹{(item.price * item.quantity).toFixed(2)}</ThemedText>
    </View>
  );

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color="#fff" />
        </View>
      </ThemedView>
    );
  }

  if (error || !order) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={28} color="#fff" />
          </Pressable>
          <ThemedText style={styles.headerTitle}>Order Details</ThemedText>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.errorContainer}>
          <ThemedText style={styles.errorText}>{error || 'Order not found'}</ThemedText>
        </View>
      </ThemedView>
    );
  }

  const firstItemTitle = order.items?.[0]?.title || 'Order';
  const shipments = (order as any).sellerShipments || [];
  const platformFee = (order as any).platformFee ?? order.tax ?? 8;

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </Pressable>
        <ThemedText numberOfLines={1} style={styles.headerTitle}>{firstItemTitle}</ThemedText>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        {/* Status Card */}
        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <ThemedText style={styles.statusLabel}>Order Status</ThemedText>
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: getStatusColor(order.status) },
              ]}>
              <ThemedText style={[styles.statusText, { color: getStatusTextColor(order.status) }]}>
                {order.status.toUpperCase()}
              </ThemedText>
            </View>
          </View>
          <ThemedText style={styles.statusDate}>
            Ordered on{' '}
            {new Date(order.createdAt).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </ThemedText>
        </View>

        {/* Tracking / Shipment Info */}
        {shipments.length > 0 && (
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>Tracking Information</ThemedText>
            {shipments.map((shipment: any, index: number) => (
              <View key={`shipment-${index}`} style={styles.trackingCard}>
                <View style={styles.trackingHeaderRow}>
                  <Ionicons name="cube-outline" size={16} color="#9df0a2" />
                  <ThemedText style={styles.trackingStatus}>
                    {getShipmentStatusLabel(shipment.status)}
                  </ThemedText>
                </View>
                {shipment.courierName ? (
                  <ThemedText style={styles.trackingCourier}>
                    Courier: {shipment.courierName}
                  </ThemedText>
                ) : null}
                {shipment.awbNumber ? (
                  <View style={styles.trackingAwbRow}>
                    <Ionicons name="locate-outline" size={13} color="#7fb8ff" />
                    <ThemedText style={styles.trackingAwbLabel}>AWB / Tracking ID:</ThemedText>
                    <ThemedText style={styles.trackingAwbValue} selectable>{shipment.awbNumber}</ThemedText>
                  </View>
                ) : (
                  <ThemedText style={styles.trackingPending}>
                    Tracking ID will be available once shipment is booked
                  </ThemedText>
                )}
                {shipment.trackingUrl ? (
                  <Pressable
                    style={styles.trackBtn}
                    onPress={() => {
                      Linking.openURL(shipment.trackingUrl).catch(() => {});
                    }}>
                    <Ionicons name="open-outline" size={14} color="#071b0e" />
                    <ThemedText style={styles.trackBtnText}>Track Shipment</ThemedText>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        )}

        {/* Order Items */}
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Order Items</ThemedText>
          <FlatList
            data={order.items}
            keyExtractor={(_, index) => `item-${index}`}
            renderItem={renderOrderItem}
            scrollEnabled={false}
            ItemSeparatorComponent={() => <View style={styles.itemSeparator} />}
            contentContainerStyle={styles.itemsList}
          />
        </View>

        {/* Order Summary */}
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Order Summary</ThemedText>
          <View style={styles.summaryBox}>
            <View style={styles.summaryRow}>
              <ThemedText style={styles.summaryLabel}>Subtotal</ThemedText>
              <ThemedText style={styles.summaryValue}>₹{order.subtotal.toFixed(2)}</ThemedText>
            </View>
            <View style={styles.summaryRow}>
              <ThemedText style={styles.summaryLabel}>Shipping</ThemedText>
              <ThemedText style={styles.summaryValue}>₹{order.shippingCost.toFixed(2)}</ThemedText>
            </View>
            <View style={styles.summaryRow}>
              <ThemedText style={styles.summaryLabel}>Platform Fee</ThemedText>
              <ThemedText style={styles.summaryValue}>₹{Number(platformFee).toFixed(2)}</ThemedText>
            </View>
            <ThemedText style={styles.csrNote}>
              Includes ₹1 CSR contribution per order
            </ThemedText>
            <View style={[styles.summaryRow, styles.summaryRowTotal]}>
              <ThemedText style={styles.summaryLabelTotal}>Total Amount</ThemedText>
              <ThemedText style={styles.summaryValueTotal}>₹{order.totalAmount.toFixed(2)}</ThemedText>
            </View>
          </View>
        </View>

        {/* Shipping Address */}
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Shipping Address</ThemedText>
          <View style={styles.addressBox}>
            <ThemedText style={styles.addressName}>{order.shippingAddress.fullName}</ThemedText>
            <ThemedText style={styles.addressText}>
              {order.shippingAddress.street}
            </ThemedText>
            <ThemedText style={styles.addressText}>
              {order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.postalCode}
            </ThemedText>
            <ThemedText style={styles.addressText}>{order.shippingAddress.country}</ThemedText>
            <ThemedText style={[styles.addressText, styles.marginTop]}>
              📱 {order.shippingAddress.phoneNumber}
            </ThemedText>
            <ThemedText style={styles.addressText}>📧 {order.shippingAddress.email}</ThemedText>
          </View>
        </View>

        {/* Payment Details */}
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Payment Information</ThemedText>
          <View style={styles.paymentBox}>
            <View style={styles.paymentRow}>
              <ThemedText style={styles.paymentLabel}>Payment Method</ThemedText>
              <ThemedText style={styles.paymentValue}>{order.paymentMethod || 'Card'}</ThemedText>
            </View>
            <View style={styles.paymentRow}>
              <ThemedText style={styles.paymentLabel}>Payment Status</ThemedText>
              <View
                style={[
                  styles.paymentStatusBadge,
                  order.paymentStatus === 'completed' && styles.paymentStatusCompleted,
                  order.paymentStatus === 'pending' && styles.paymentStatusPending,
                  order.paymentStatus === 'failed' && styles.paymentStatusFailed,
                ]}>
                <ThemedText style={styles.paymentStatusText}>
                  {order.paymentStatus.toUpperCase()}
                </ThemedText>
              </View>
            </View>
            {order.transactionId && (
              <View style={styles.paymentRow}>
                <ThemedText style={styles.paymentLabel}>Transaction ID</ThemedText>
                <ThemedText style={styles.transactionId}>{order.transactionId}</ThemedText>
              </View>
            )}
          </View>
        </View>

        {order.notes && (
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>Notes</ThemedText>
            <View style={styles.notesBox}>
              <ThemedText style={styles.notesText}>{order.notes}</ThemedText>
            </View>
          </View>
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
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 8,
  },
  headerSpacer: {
    width: 44,
  },
  loaderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 16,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  contentInner: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 12,
  },
  statusCard: {
    padding: 14,
    backgroundColor: '#141922',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#272f3d',
    marginBottom: 20,
  },
  statusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8e9bb2',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
  },
  statusDate: {
    fontSize: 12,
    color: '#b4b4b4',
  },
  // Tracking styles
  trackingCard: {
    padding: 14,
    backgroundColor: '#141922',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#272f3d',
    marginBottom: 8,
  },
  trackingHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  trackingStatus: {
    fontSize: 14,
    fontWeight: '700',
    color: '#9df0a2',
  },
  trackingCourier: {
    fontSize: 12,
    color: '#b4b4b4',
    marginBottom: 6,
  },
  trackingAwbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  trackingAwbLabel: {
    fontSize: 12,
    color: '#8e9bb2',
  },
  trackingAwbValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7fb8ff',
    fontFamily: 'Courier',
  },
  trackingPending: {
    fontSize: 11,
    color: '#8e9bb2',
    fontStyle: 'italic',
  },
  trackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#9df0a2',
    alignSelf: 'flex-start',
  },
  trackBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#071b0e',
  },
  // Item styles
  itemsList: {
    backgroundColor: '#141922',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#272f3d',
    overflow: 'hidden',
  },
  itemCard: {
    flexDirection: 'row',
    padding: 12,
    alignItems: 'center',
    gap: 10,
  },
  itemImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
  },
  itemDetails: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  itemQty: {
    fontSize: 11,
    color: '#8e9bb2',
    marginBottom: 2,
  },
  itemPrice: {
    fontSize: 11,
    color: '#9df0a2',
    fontWeight: '600',
  },
  itemTotal: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  itemSeparator: {
    height: 1,
    backgroundColor: '#272f3d',
  },
  // Summary styles
  summaryBox: {
    padding: 12,
    backgroundColor: '#141922',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#272f3d',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  summaryRowTotal: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#272f3d',
  },
  summaryLabel: {
    fontSize: 13,
    color: '#b4b4b4',
  },
  summaryLabelTotal: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  summaryValue: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
  },
  summaryValueTotal: {
    fontSize: 16,
    fontWeight: '700',
    color: '#9df0a2',
  },
  csrNote: {
    fontSize: 10,
    color: '#8e9bb2',
    fontStyle: 'italic',
    paddingBottom: 4,
  },
  // Address styles
  addressBox: {
    padding: 12,
    backgroundColor: '#141922',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#272f3d',
  },
  addressName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 6,
  },
  addressText: {
    fontSize: 12,
    color: '#b4b4b4',
    marginBottom: 2,
  },
  marginTop: {
    marginTop: 6,
  },
  // Payment styles
  paymentBox: {
    padding: 12,
    backgroundColor: '#141922',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#272f3d',
  },
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  paymentLabel: {
    fontSize: 13,
    color: '#b4b4b4',
  },
  paymentValue: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
  },
  paymentStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#4d3d1a',
  },
  paymentStatusCompleted: {
    backgroundColor: '#1a4d2e',
  },
  paymentStatusPending: {
    backgroundColor: '#4d3d1a',
  },
  paymentStatusFailed: {
    backgroundColor: '#4d1a1a',
  },
  paymentStatusText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9df0a2',
  },
  transactionId: {
    fontSize: 11,
    color: '#8e9bb2',
    fontFamily: 'Courier',
  },
  notesBox: {
    padding: 12,
    backgroundColor: '#141922',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#272f3d',
  },
  notesText: {
    fontSize: 12,
    color: '#b4b4b4',
    lineHeight: 18,
  },
});
