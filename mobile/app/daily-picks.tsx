import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Dimensions, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { getProducts, getProfileDashboard, getUserOrderHistory, Order, ProductItem } from '@/utils/api';
import { getFeedBehavior, recordFeedInteraction } from '@/utils/feed-behavior';

const FALLBACK_ASPECT_RATIOS = [1, 0.8, 0.75, 0.67, 1.25];
const SCREEN_WIDTH = Dimensions.get('window').width;
const FEED_SIDE_PADDING = 14;
const COLUMN_GAP = 8;
const COLUMN_WIDTH = (SCREEN_WIDTH - FEED_SIDE_PADDING * 2 - COLUMN_GAP) / 2;
const DAILY_PICKS_LIMIT_DEFAULT = 60;
const DAILY_PICKS_LIMIT_TUNNEL = 24;

function formatPriceINR(price: number) {
  return `₹${Number(price || 0).toLocaleString('en-IN')}`;
}

function getProductPricing(item: ProductItem) {
  const realPrice = Math.max(0, Number(item.realPrice ?? item.price) || 0);
  const discountedPrice = Number(item.discountedPrice);
  const hasDiscount = Number.isFinite(discountedPrice) && discountedPrice > 0 && discountedPrice < realPrice;
  const effectivePrice = hasDiscount ? discountedPrice : realPrice;
  const computedDiscount = hasDiscount
    ? Number(item.discountPercentage ?? (((realPrice - discountedPrice) / realPrice) * 100))
    : 0;

  return {
    realPrice,
    effectivePrice,
    hasDiscount,
    discountPercentage: Math.max(0, Number.isFinite(computedDiscount) ? Number(computedDiscount.toFixed(1)) : 0),
  };
}

function normalizeTokens(text: string) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

function hashFromId(id: string) {
  return (id || '').split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function resolveAspectRatio(item: ProductItem) {
  const explicitRatio = Number(item.imageAspectRatio);
  if (!Number.isNaN(explicitRatio) && explicitRatio >= 0.5 && explicitRatio <= 2) {
    return explicitRatio;
  }

  const hash = hashFromId(item._id);
  return FALLBACK_ASPECT_RATIOS[hash % FALLBACK_ASPECT_RATIOS.length];
}

function getSocialProof(item: ProductItem) {
  const sold = Math.max(0, Number(item.monthlySold) || 0);
  return `${sold} sold this month`;
}

type PickContext = {
  products: ProductItem[];
  likedItems: ProductItem[];
  orders: Order[];
  seenCounts: Record<string, number>;
  clickedCounts: Record<string, number>;
  visitedCounts: Record<string, number>;
  lastSeenAt: Record<string, string>;
  lastClickedAt: Record<string, string>;
  lastVisitedAt: Record<string, string>;
};

function getDaysSince(timestamp: string | undefined) {
  if (!timestamp) return 999;
  const ms = Date.parse(timestamp);
  if (Number.isNaN(ms)) return 999;
  return Math.max(0, (Date.now() - ms) / 86400000);
}

function recencyWeight(daysSince: number, halfLifeDays: number) {
  if (!Number.isFinite(daysSince) || daysSince < 0) return 0;
  return Math.pow(0.5, daysSince / Math.max(0.25, halfLifeDays));
}

function buildDailyPicks(context: PickContext) {
  const {
    products,
    likedItems,
    orders,
    seenCounts,
    clickedCounts,
    visitedCounts,
    lastSeenAt,
    lastClickedAt,
    lastVisitedAt,
  } = context;
  if (!products.length) return [];

  const productById = new Map(products.map((item) => [item._id, item]));
  const categoryWeights = new Map<string, number>();
  const materialWeights = new Map<string, number>();
  const tokenWeights = new Map<string, number>();
  const likedIds = new Set<string>();
  const purchasedIds = new Set<string>();
  const clickedIds = new Set<string>(Object.keys(clickedCounts || {}));

  const addWeight = (map: Map<string, number>, key: string, amount: number) => {
    const normalized = String(key || '').trim().toLowerCase();
    if (!normalized) return;
    map.set(normalized, (map.get(normalized) || 0) + amount);
  };

  const addInterestFromProduct = (product: ProductItem | undefined, intensity: number) => {
    if (!product) return;
    addWeight(categoryWeights, product.category, 3 * intensity);
    addWeight(materialWeights, product.material, 2 * intensity);
    normalizeTokens(product.title).forEach((token) => addWeight(tokenWeights, token, 1.8 * intensity));
    normalizeTokens(product.description || '').forEach((token) => addWeight(tokenWeights, token, 0.6 * intensity));
  };

  for (const liked of likedItems) {
    likedIds.add(liked._id);
    addInterestFromProduct(liked, 2.2);
  }

  for (const order of orders) {
    for (const orderItem of order.items || []) {
      const purchasedId = String(orderItem.product || '').trim();
      if (purchasedId) {
        purchasedIds.add(purchasedId);
        addInterestFromProduct(productById.get(purchasedId), 2);
      }

      normalizeTokens(orderItem.title || '').forEach((token) => addWeight(tokenWeights, token, 1.2));
    }
  }

  const allBehaviorIds = new Set<string>([
    ...Object.keys(seenCounts || {}),
    ...Object.keys(clickedCounts || {}),
    ...Object.keys(visitedCounts || {}),
  ]);

  for (const productId of allBehaviorIds) {
    const product = productById.get(productId);
    const seen = Number(seenCounts?.[productId] || 0);
    const clicked = Number(clickedCounts?.[productId] || 0);
    const visited = Number(visitedCounts?.[productId] || 0);
    const seenRecency = recencyWeight(getDaysSince(lastSeenAt?.[productId]), 5);
    const clickedRecency = recencyWeight(getDaysSince(lastClickedAt?.[productId]), 2.5);
    const visitedRecency = recencyWeight(getDaysSince(lastVisitedAt?.[productId]), 3);

    const intensity = Math.min(
      6,
      clicked * 1.6 * clickedRecency
      + visited * 1.1 * visitedRecency
      + seen * 0.25 * seenRecency
    );

    if (intensity > 0) {
      addInterestFromProduct(product, intensity);
    }
  }

  const hasSignals =
    likedIds.size > 0
    || purchasedIds.size > 0
    || allBehaviorIds.size > 0;

  if (!hasSignals) {
    return [...products]
      .sort((a, b) => (Number(b.monthlySold) || 0) - (Number(a.monthlySold) || 0))
      .slice(0, 28);
  }

  const scored = products
    .filter((product) => !likedIds.has(product._id) && !purchasedIds.has(product._id) && !clickedIds.has(product._id))
    .map((product) => {
      const category = String(product.category || '').toLowerCase();
      const material = String(product.material || '').toLowerCase();
      let score = 0;

      score += (categoryWeights.get(category) || 0) * 2;
      score += (materialWeights.get(material) || 0) * 1.8;

      normalizeTokens(product.title).forEach((token) => {
        score += tokenWeights.get(token) || 0;
      });

      if (product.customizable || product.isCustomizable) {
        score += 0.8;
      }

      score += (Number(product.monthlySold) || 0) * 0.18;
      score += (Number(product.monthlySaves) || 0) * 0.1;

      return { product, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.product)
    .slice(0, 28);

  if (scored.length) return scored;

  return [...products]
    .sort((a, b) => (Number(b.monthlySold) || 0) - (Number(a.monthlySold) || 0))
    .slice(0, 28);
}

export default function DailyPicksScreen() {
  const router = useRouter();
  const seenRef = useRef<Set<string>>(new Set());

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<ProductItem[]>([]);

  const loadDailyPicks = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      setError(null);
      const apiMode = (await AsyncStorage.getItem('API_DEV_MODE')) || 'auto';
      const productLimit = apiMode === 'tunnel' ? DAILY_PICKS_LIMIT_TUNNEL : DAILY_PICKS_LIMIT_DEFAULT;

      const [productsRes, dashboardRes, ordersRes, behavior] = await Promise.all([
        getProducts({ page: 1, limit: productLimit, sort: 'newest' }),
        getProfileDashboard().catch(() => null),
        getUserOrderHistory().catch(() => [] as Order[]),
        getFeedBehavior(),
      ]);

      const ranked = buildDailyPicks({
        products: productsRes.items || [],
        likedItems: dashboardRes?.likedItems || [],
        orders: ordersRes || [],
        seenCounts: behavior.seen || {},
        clickedCounts: behavior.clicked || {},
        visitedCounts: behavior.visited || {},
        lastSeenAt: behavior.lastSeenAt || {},
        lastClickedAt: behavior.lastClickedAt || {},
        lastVisitedAt: behavior.lastVisitedAt || {},
      });

      setPicks(ranked);
      seenRef.current.clear();
    } catch (err: any) {
      setError(err?.message || 'Failed to load Daily Picks');
      setPicks([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadDailyPicks();
    }, [loadDailyPicks])
  );

  const openProduct = useCallback((productId: string) => {
    recordFeedInteraction(productId, 'clicked').catch(() => {});
    router.push({ pathname: '/product/[id]', params: { id: productId } });
  }, [router]);

  const refreshControl = useMemo(
    () => <RefreshControl refreshing={refreshing} onRefresh={() => loadDailyPicks(true)} tintColor="#ffffff" />,
    [loadDailyPicks, refreshing]
  );

  const columns = useMemo(() => {
    const left: ProductItem[] = [];
    const right: ProductItem[] = [];
    let leftHeight = 0;
    let rightHeight = 0;

    for (const item of picks) {
      const ratio = resolveAspectRatio(item);
      const estimatedCardHeight = COLUMN_WIDTH / ratio + 88;

      if (leftHeight <= rightHeight) {
        left.push(item);
        leftHeight += estimatedCardHeight;
      } else {
        right.push(item);
        rightHeight += estimatedCardHeight;
      }
    }

    return { left, right };
  }, [picks]);

  const renderFeedLikeCard = useCallback((item: ProductItem) => {
    if (!seenRef.current.has(item._id)) {
      seenRef.current.add(item._id);
      recordFeedInteraction(item._id, 'seen').catch(() => {});
    }

    const ratio = resolveAspectRatio(item);
    const isCustomizable = Boolean(item.customizable ?? item.isCustomizable);
    const pricing = getProductPricing(item);

    return (
      <View key={item._id} style={styles.feedCard}>
        <Pressable onPress={() => openProduct(item._id)}>
          <Image
            source={{ uri: item.images?.[0] || 'https://placehold.co/600x400?text=Handmade' }}
            style={[styles.feedCardImage, { aspectRatio: ratio }]}
            contentFit="cover"
          />
        </Pressable>
        {pricing.hasDiscount ? (
          <View style={styles.discountBadge}>
            <ThemedText style={styles.discountBadgeText}>{pricing.discountPercentage}% OFF</ThemedText>
          </View>
        ) : null}

        <Pressable style={styles.feedCardTextWrap} onPress={() => openProduct(item._id)}>
          <View style={styles.titleRow}>
            <ThemedText style={styles.cardTitle} numberOfLines={1}>{item.title}</ThemedText>
            {isCustomizable ? <ThemedText style={styles.customBadge}>CUSTOMIZABLE</ThemedText> : null}
          </View>
          <View style={styles.priceRow}>
            <ThemedText style={styles.feedPriceText}>{formatPriceINR(pricing.effectivePrice)}</ThemedText>
            {pricing.hasDiscount ? (
              <>
                <ThemedText style={styles.originalPriceText}>{formatPriceINR(pricing.realPrice)}</ThemedText>
              </>
            ) : null}
          </View>
          <ThemedText numberOfLines={1} style={styles.feedSocialProofText}>{getSocialProof(item)}</ThemedText>
        </Pressable>
      </View>
    );
  }, [openProduct]);

  return (
    <ThemedView style={styles.container}>
      <View style={styles.headerRow}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={20} color="#ffffff" />
        </Pressable>
        <View style={styles.headerTextWrap}>
          <ThemedText style={styles.headerTitle}>Daily Picks</ThemedText>
        </View>
      </View>

      {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}

      {loading ? (
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color="#ffffff" />
        </View>
      ) : (
        <ScrollView
          style={styles.resultsScroll}
          refreshControl={refreshControl}
          contentContainerStyle={styles.listContent}>
          {picks.length === 0 ? (
            <View style={styles.emptyWrap}>
              <ThemedText style={styles.emptyText}>No personalized picks yet. Explore and interact with posts to train your feed.</ThemedText>
            </View>
          ) : (
            <View style={styles.masonryWrap}>
              <View style={styles.masonryColumn}>{columns.left.map(renderFeedLikeCard)}</View>
              <View style={styles.masonryColumn}>{columns.right.map(renderFeedLikeCard)}</View>
            </View>
          )}
        </ScrollView>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    paddingTop: 60,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 10,
    marginBottom: 12,
  },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#27384c',
    backgroundColor: '#101a28',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextWrap: {
    flex: 1,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  errorText: {
    color: '#ff8b8b',
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  loaderWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultsScroll: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 14,
    paddingBottom: 30,
  },
  masonryWrap: {
    flexDirection: 'row',
    gap: COLUMN_GAP,
    alignItems: 'flex-start',
  },
  masonryColumn: {
    flex: 1,
    gap: 10,
  },
  feedCard: {
    position: 'relative',
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#27384c',
    backgroundColor: '#101b2a',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  feedCardImage: {
    width: '100%',
    backgroundColor: '#181818',
  },
  feedCardTextWrap: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  customBadge: {
    color: '#c7fbd2',
    backgroundColor: '#122a1b',
    borderColor: '#2f724b',
    borderWidth: 1,
    borderRadius: 99,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  feedPriceText: {
    color: '#e7efe9',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  priceRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  originalPriceText: {
    color: '#8ea1b6',
    fontSize: 11,
    fontWeight: '700',
    textDecorationLine: 'line-through',
    textDecorationStyle: 'solid',
  },
  discountBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 5,
    backgroundColor: '#2a1d08',
    borderColor: '#d89a2b',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  discountBadgeText: {
    color: '#ffd88a',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  feedSocialProofText: {
    marginTop: 4,
    color: '#7d8fa6',
    fontSize: 12,
    fontWeight: '600',
  },
  emptyWrap: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27384c',
    backgroundColor: '#101b2a',
    padding: 14,
    marginTop: 24,
  },
  emptyText: {
    color: '#b4b4b4',
    textAlign: 'center',
    fontWeight: '700',
  },
});
