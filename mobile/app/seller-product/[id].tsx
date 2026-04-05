import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  addProductStock,
  getSellerProductInsights,
  ProductItem,
  SellerProductInsights,
} from '@/utils/api';

type Params = {
  id?: string;
};

function formatCurrency(value: number) {
  return `₹${Number(value || 0).toLocaleString('en-IN')}`;
}

export default function SellerProductInsightsScreen() {
  const { id } = useLocalSearchParams<Params>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [item, setItem] = useState<ProductItem | null>(null);
  const [insights, setInsights] = useState<SellerProductInsights | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [updatingStock, setUpdatingStock] = useState(false);
  const [customAddQty, setCustomAddQty] = useState('1');

  const loadInsights = useCallback(async () => {
    if (!id) {
      setError('Missing product id');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await getSellerProductInsights(id);
      setItem(data.item);
      setInsights(data.insights);
      setSuggestions(data.suggestions || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load seller insights');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadInsights();
  }, [loadInsights]);

  const stockBadgeStyle = useMemo(() => {
    if (!insights) return styles.stockBadgeHealthy;
    if (insights.stockStatus === 'out_of_stock') return styles.stockBadgeOut;
    if (insights.stockStatus === 'low') return styles.stockBadgeLow;
    return styles.stockBadgeHealthy;
  }, [insights]);

  const stockBadgeText = useMemo(() => {
    if (!insights) return 'HEALTHY';
    if (insights.stockStatus === 'out_of_stock') return 'OUT OF STOCK';
    if (insights.stockStatus === 'low') return 'LOW STOCK';
    return 'HEALTHY STOCK';
  }, [insights]);

  const handleAddStock = async (qty: number) => {
    if (!item || updatingStock) return;
    if (!Number.isInteger(qty) || qty <= 0) {
      setError('Enter a valid stock quantity');
      return;
    }

    try {
      setUpdatingStock(true);
      const updated = await addProductStock(item._id, qty);
      setItem((prev) => (prev ? { ...prev, stock: updated.stock } : prev));
      setInsights((prev) => {
        if (!prev) return prev;
        const nextStock = Math.max(0, Number(updated.stock) || 0);
        return {
          ...prev,
          stock: nextStock,
          stockStatus: nextStock <= 0 ? 'out_of_stock' : nextStock <= 3 ? 'low' : 'healthy',
        };
      });
      setError(null);
      setCustomAddQty('0');
    } catch (err: any) {
      setError(err?.message || 'Failed to update stock');
    } finally {
      setUpdatingStock(false);
    }
  };

  if (loading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator size="large" color="#9df0a2" />
      </ThemedView>
    );
  }

  if (error && !item) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText style={styles.errorText}>{error}</ThemedText>
        <Pressable style={styles.retryButton} onPress={loadInsights}>
          <ThemedText style={styles.retryText}>Retry</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable style={styles.iconBtn} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <ThemedText style={styles.headerTitle}>Listing Insights</ThemedText>
          <Pressable style={styles.iconBtn} onPress={() => id && router.push({ pathname: '/product/[id]', params: { id } })}>
            <Ionicons name="eye-outline" size={20} color="#fff" />
          </Pressable>
        </View>

        {item ? (
          <View style={styles.heroCard}>
            <Image
              source={{ uri: item.images?.[0] || 'https://placehold.co/900x600?text=Handmade+Item' }}
              style={styles.heroImage}
              contentFit="cover"
            />
            <View style={styles.heroBody}>
              <ThemedText numberOfLines={2} style={styles.titleText}>{item.title}</ThemedText>
              <View style={styles.titleMetaRow}>
                <ThemedText style={styles.priceText}>{formatCurrency(item.price)}</ThemedText>
                <View style={[styles.stockBadge, stockBadgeStyle]}>
                  <ThemedText style={styles.stockBadgeText}>{stockBadgeText}</ThemedText>
                </View>
              </View>
              <ThemedText style={styles.metaText}>{item.category} • Stock: {item.stock}</ThemedText>
            </View>
          </View>
        ) : null}

        <View style={styles.metricsGrid}>
          <View style={styles.metricCard}>
            <ThemedText style={styles.metricValue}>{insights?.unitsSold || 0}</ThemedText>
            <ThemedText style={styles.metricLabel}>Units Sold</ThemedText>
          </View>
          <View style={styles.metricCard}>
            <ThemedText style={styles.metricValue}>{formatCurrency(insights?.grossRevenue || 0)}</ThemedText>
            <ThemedText style={styles.metricLabel}>Revenue</ThemedText>
          </View>
          <View style={styles.metricCard}>
            <ThemedText style={styles.metricValue}>{insights?.monthlySaves || 0}</ThemedText>
            <ThemedText style={styles.metricLabel}>Monthly Saves</ThemedText>
          </View>
          <View style={styles.metricCard}>
            <ThemedText style={styles.metricValue}>{insights?.conversionRate || 0}%</ThemedText>
            <ThemedText style={styles.metricLabel}>Save→Sale</ThemedText>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <ThemedText style={styles.sectionTitle}>Restock</ThemedText>
          <View style={styles.quickAddRow}>
            {[1, 5, 10].map((qty) => (
              <Pressable
                key={qty}
                style={styles.quickAddBtn}
                onPress={() => setCustomAddQty(String(qty))}
                disabled={updatingStock}>
                <ThemedText style={styles.quickAddText}>+{qty}</ThemedText>
              </Pressable>
            ))}
          </View>

          <View style={styles.customAddRow}>
            <TextInput
              value={customAddQty}
              onChangeText={(text) => setCustomAddQty(text.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder="Custom qty"
              placeholderTextColor="#8e9bb2"
              style={styles.customAddInput}
            />
            <Pressable
              style={styles.customAddBtn}
              onPress={() => handleAddStock(Number(customAddQty || 0))}
              disabled={updatingStock}>
              {updatingStock ? (
                <ActivityIndicator color="#0a0a0a" />
              ) : (
                <ThemedText style={styles.customAddBtnText}>Update</ThemedText>
              )}
            </Pressable>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <ThemedText style={styles.sectionTitle}>Action Tips</ThemedText>
          {suggestions.length > 0 ? (
            suggestions.map((tip, index) => (
              <View key={`tip-${index}`} style={styles.tipRow}>
                <Ionicons name="bulb-outline" size={16} color="#ffd88a" />
                <ThemedText style={styles.tipText}>{tip}</ThemedText>
              </View>
            ))
          ) : (
            <ThemedText style={styles.metaText}>No tips yet.</ThemedText>
          )}
        </View>

        <View style={styles.sectionCard}>
          <ThemedText style={styles.sectionTitle}>Category Mix</ThemedText>
          {(insights?.categoryLeaders || []).map((entry) => (
            <View key={`${entry.category}-${entry.count}`} style={styles.categoryRow}>
              <ThemedText style={styles.categoryName}>{entry.category}</ThemedText>
              <ThemedText style={styles.categoryCount}>{entry.count} listing(s)</ThemedText>
            </View>
          ))}
        </View>

        {error ? <ThemedText style={styles.inlineError}>{error}</ThemedText> : null}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a0a0a',
    paddingHorizontal: 20,
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 54,
    paddingBottom: 24,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#151b24',
    borderWidth: 1,
    borderColor: '#2b3545',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
  },
  heroCard: {
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2b3545',
    backgroundColor: '#121822',
  },
  heroImage: {
    width: '100%',
    height: 200,
  },
  heroBody: {
    padding: 12,
  },
  titleText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  titleMetaRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  priceText: {
    color: '#9df0a2',
    fontWeight: '700',
    fontSize: 16,
  },
  stockBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  stockBadgeHealthy: {
    backgroundColor: '#1c3820',
    borderColor: '#3f8f4a',
  },
  stockBadgeLow: {
    backgroundColor: '#3b3217',
    borderColor: '#7f6a2c',
  },
  stockBadgeOut: {
    backgroundColor: '#3f1b1b',
    borderColor: '#864242',
  },
  stockBadgeText: {
    color: '#f8f8f8',
    fontSize: 10,
    fontWeight: '700',
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metricCard: {
    width: '48.8%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#293446',
    backgroundColor: '#121b29',
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  metricValue: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  metricLabel: {
    color: '#8fa0b8',
    fontSize: 11,
    marginTop: 2,
    fontWeight: '600',
  },
  sectionCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#273245',
    backgroundColor: '#131a25',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 10,
  },
  quickAddRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  quickAddBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#375a3d',
    backgroundColor: '#1d4124',
    paddingVertical: 10,
    alignItems: 'center',
  },
  quickAddText: {
    color: '#d5f6da',
    fontWeight: '700',
  },
  customAddRow: {
    flexDirection: 'row',
    gap: 8,
  },
  customAddInput: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2c394f',
    backgroundColor: '#0f141d',
    color: '#fff',
    paddingHorizontal: 12,
  },
  customAddBtn: {
    minWidth: 92,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#78cf84',
    backgroundColor: '#9df0a2',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  customAddBtnText: {
    color: '#0a0a0a',
    fontWeight: '700',
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 8,
  },
  tipText: {
    flex: 1,
    color: '#d7deea',
    fontSize: 12,
    lineHeight: 18,
  },
  categoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1e2633',
  },
  categoryName: {
    color: '#d9e5f6',
    fontSize: 12,
  },
  categoryCount: {
    color: '#9df0a2',
    fontSize: 12,
    fontWeight: '700',
  },
  metaText: {
    color: '#8e9bb2',
    fontSize: 12,
    marginTop: 6,
  },
  inlineError: {
    color: '#ff8f8f',
    fontSize: 12,
    marginTop: 4,
  },
  errorText: {
    color: '#ff8f8f',
    marginBottom: 12,
    textAlign: 'center',
  },
  retryButton: {
    borderWidth: 1,
    borderColor: '#2b3545',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#141b24',
  },
  retryText: {
    color: '#fff',
    fontWeight: '700',
  },
});