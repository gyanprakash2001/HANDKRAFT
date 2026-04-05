import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, Pressable, TextInput, ActivityIndicator, ScrollView, Text, RefreshControl, Dimensions, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import LocalAvatar from '@/components/LocalAvatar';
import { getProducts, ProductItem, getProfile } from '@/utils/api';
import currentUser from '@/utils/currentUser';
import { recordFeedInteraction } from '@/utils/feed-behavior';

const RECENT_SEARCHES_KEY = 'HANDKRAFT_RECENT_SEARCHES';
const CUSTOMIZABLE_MARKER = '[CUSTOMIZABLE]';
const FALLBACK_ASPECT_RATIOS = [1, 0.8, 0.75, 0.67, 1.25];
const SCREEN_WIDTH = Dimensions.get('window').width;
const FEED_SIDE_PADDING = 16;
const COLUMN_GAP = 8;
const COLUMN_WIDTH = (SCREEN_WIDTH - FEED_SIDE_PADDING * 2 - COLUMN_GAP) / 2;
const SORT_OPTIONS = [
  { key: 'relevant', label: 'Relevant' },
  { key: 'newest', label: 'Newest' },
  { key: 'price_asc', label: 'Price Low-High' },
  { key: 'price_desc', label: 'Price High-Low' },
] as const;
type SearchSortMode = typeof SORT_OPTIONS[number]['key'];
const ENV_BASE_URL = process.env.EXPO_PUBLIC_API_URL;

function resolveFileBaseUrl() {
  if (ENV_BASE_URL) return ENV_BASE_URL.replace(/\/api\/?$/, '');
  const hostUri = Constants.expoConfig?.hostUri || (Constants as any)?.manifest2?.extra?.expoClient?.hostUri;
  const host = hostUri ? hostUri.split(':')[0] : null;
  const isIpv4 = host ? /^\d{1,3}(\.\d{1,3}){3}$/.test(host) : false;
  if (host && isIpv4) return `http://${host}:5000`;
  if (Platform.OS === 'android') return 'http://10.0.2.2:5000';
  return 'http://localhost:5000';
}

function resolveAvatarSource(avatarUrl?: string | null) {
  if (!avatarUrl) return null;
  const asStr = String(avatarUrl || '');
  if (asStr.startsWith('/')) return { uri: `${resolveFileBaseUrl()}${asStr}` };
  if (asStr.startsWith('http') || asStr.startsWith('data:')) return { uri: asStr };
  const match = asStr.match(/avatar(\d+)/i);
  const seed = match ? `handkraft-${match[1].padStart(2, '0')}` : asStr;
  return { uri: `https://avatars.dicebear.com/api/identicon/${encodeURIComponent(seed)}.png?background=%23eaf6ff` };
}

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

function normalizeText(value: string) {
  return String(value || '').toLowerCase().trim();
}

function tokenize(value: string) {
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildHighlightRegex(query: string) {
  const terms = Array.from(new Set(tokenize(query)))
    .filter((entry) => entry.length >= 2)
    .slice(0, 6);

  if (!terms.length) {
    return null;
  }

  return new RegExp(`(${terms.map((entry) => escapeRegExp(entry)).join('|')})`, 'ig');
}

function HighlightedText({
  text,
  query,
  textStyle,
  highlightStyle,
  numberOfLines,
}: {
  text: string;
  query: string;
  textStyle: any;
  highlightStyle: any;
  numberOfLines?: number;
}) {
  const regex = buildHighlightRegex(query);
  if (!regex || !text) {
    return <Text style={textStyle} numberOfLines={numberOfLines}>{text}</Text>;
  }

  const parts = text.split(regex);
  return (
    <Text style={textStyle} numberOfLines={numberOfLines}>
      {parts.map((part, index) => {
        const matched = part && regex.test(part);
        regex.lastIndex = 0;
        return (
          <Text key={`${part}-${index}`} style={matched ? highlightStyle : undefined}>
            {part}
          </Text>
        );
      })}
    </Text>
  );
}

function boundedLevenshtein(a: string, b: string, maxDistance = 2) {
  const left = normalizeText(a);
  const right = normalizeText(b);

  if (left === right) return 0;
  if (!left || !right) return Math.max(left.length, right.length);
  if (Math.abs(left.length - right.length) > maxDistance) return maxDistance + 1;

  const previous = new Array(right.length + 1);
  const current = new Array(right.length + 1);

  for (let j = 0; j <= right.length; j += 1) {
    previous[j] = j;
  }

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    let minInRow = current[0];

    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
      if (current[j] < minInRow) minInRow = current[j];
    }

    if (minInRow > maxDistance) return maxDistance + 1;

    for (let j = 0; j <= right.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[right.length];
}

function fuzzyTokenMatchScore(queryToken: string, candidateToken: string) {
  const q = normalizeText(queryToken);
  const c = normalizeText(candidateToken);
  if (!q || !c) return 0;

  if (c.startsWith(q)) return 1;
  if (c.includes(q)) return 0.8;

  if (q.length >= 4 && c.length >= 4) {
    const distance = boundedLevenshtein(q, c, 2);
    if (distance <= 2) {
      if (distance === 0) return 1;
      if (distance === 1) return 0.72;
      return 0.52;
    }
  }

  return 0;
}

function scoreItem(item: ProductItem, rawQuery: string) {
  const query = normalizeText(rawQuery);
  if (!query) return 0;

  const title = normalizeText(item.title);
  const category = normalizeText(item.category);
  const description = normalizeText(item.description || '');
  const material = normalizeText(item.material || '');
  const sellerName = normalizeText(item.sellerName || '');

  let score = 0;

  if (title === query) score += 160;
  if (title.startsWith(query)) score += 130;
  if (title.includes(query)) score += 100;

  if (category === query) score += 95;
  if (category.startsWith(query)) score += 70;
  if (category.includes(query)) score += 55;

  if (material.includes(query)) score += 38;
  if (sellerName.includes(query)) score += 26;
  if (description.includes(query)) score += 30;

  const queryTokens = tokenize(query);
  if (queryTokens.length) {
    const titleTokens = tokenize(title);
    const categoryTokens = tokenize(category);
    const materialTokens = tokenize(material);
    const descTokens = tokenize(description);

    for (const token of queryTokens) {
      if (titleTokens.some((entry) => entry.startsWith(token))) score += 24;
      if (categoryTokens.some((entry) => entry.startsWith(token))) score += 18;
      if (descTokens.some((entry) => entry.startsWith(token))) score += 8;

      let bestTitleFuzzy = 0;
      let bestCategoryFuzzy = 0;
      let bestMaterialFuzzy = 0;

      for (const entry of titleTokens) {
        bestTitleFuzzy = Math.max(bestTitleFuzzy, fuzzyTokenMatchScore(token, entry));
      }
      for (const entry of categoryTokens) {
        bestCategoryFuzzy = Math.max(bestCategoryFuzzy, fuzzyTokenMatchScore(token, entry));
      }
      for (const entry of materialTokens) {
        bestMaterialFuzzy = Math.max(bestMaterialFuzzy, fuzzyTokenMatchScore(token, entry));
      }

      score += bestTitleFuzzy * 26;
      score += bestCategoryFuzzy * 18;
      score += bestMaterialFuzzy * 14;
    }
  }

  // Keep commercially successful items slightly higher among similar textual matches.
  score += (Number(item.monthlySold) || 0) * 0.15;
  score += (Number(item.monthlySaves) || 0) * 0.08;

  return score;
}

export default function ExploreScreen() {
  const router = useRouter();
  const inputRef = useRef<TextInput | null>(null);

  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allItems, setAllItems] = useState<ProductItem[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [sortMode, setSortMode] = useState<SearchSortMode>('relevant');
  const [userAvatar, setUserAvatar] = useState<string | null>(null);

  const loadRecentSearches = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(RECENT_SEARCHES_KEY);
      if (!raw) {
        setRecentSearches([]);
        return;
      }

      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setRecentSearches(parsed.filter((entry) => typeof entry === 'string').slice(0, 8));
      }
    } catch {
      setRecentSearches([]);
    }
  }, []);

  const persistRecentSearch = useCallback(async (value: string) => {
    const normalized = value.trim();
    if (!normalized) return;

    const next = [
      normalized,
      ...recentSearches.filter((entry) => normalizeText(entry) !== normalizeText(normalized)),
    ].slice(0, 8);

    setRecentSearches(next);
    try {
      await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
    } catch {
      // Non-blocking persistence.
    }
  }, [recentSearches]);

  const loadProducts = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      setError(null);
      const res = await getProducts({ page: 1, limit: 120, sort: 'newest' });
      setAllItems(res.items || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load products for search');
      setAllItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadAvatar = useCallback(async () => {
    try {
      const profile = await getProfile();
      setUserAvatar(profile?.avatarUrl || null);
      currentUser.setProfile(profile || null);
    } catch {
      // Avatar is non-blocking for explore.
    }
  }, []);

  // subscribe to global avatar changes so the tab updates immediately
  useEffect(() => {
    const unsub = currentUser.subscribe((p) => {
      try { setUserAvatar(p?.avatarUrl || null); } catch (e) { /* ignore */ }
    });
    return () => unsub();
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadProducts();
      loadRecentSearches();
      loadAvatar();
    }, [loadProducts, loadRecentSearches, loadAvatar])
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 180);

    return () => clearTimeout(timer);
  }, []);

  const topCategories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of allItems) {
      const category = String(item.category || '').trim();
      if (!category) continue;
      counts.set(category, (counts.get(category) || 0) + 1);
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map((entry) => entry[0]);
  }, [allItems]);

  const trimmedQuery = query.trim();

  const liveSuggestions = useMemo(() => {
    const target = normalizeText(trimmedQuery);
    if (!target) return [];

    const suggestionMap = new Map<string, { label: string; score: number }>();

    const upsertSuggestion = (rawLabel: string, baseScore: number) => {
      const label = String(rawLabel || '').trim();
      const normalized = normalizeText(label);
      if (!label || normalized.length < 2) return;

      const tokenScore = Math.max(
        fuzzyTokenMatchScore(target, normalized),
        ...tokenize(normalized).map((token) => fuzzyTokenMatchScore(target, token))
      );

      if (tokenScore <= 0 && !normalized.includes(target)) return;

      let score = baseScore + tokenScore * 80;
      if (normalized.startsWith(target)) score += 24;
      if (normalized === target) score += 40;

      const existing = suggestionMap.get(normalized);
      if (!existing || score > existing.score) {
        suggestionMap.set(normalized, { label, score });
      }
    };

    for (const recent of recentSearches) {
      upsertSuggestion(recent, 70);
    }

    for (const item of allItems) {
      const soldWeight = Math.min(12, (Number(item.monthlySold) || 0) * 0.35);
      upsertSuggestion(item.category, 65 + soldWeight);
      upsertSuggestion(item.material, 52 + soldWeight * 0.7);
      upsertSuggestion(item.title, 46 + soldWeight * 0.6);
    }

    return Array.from(suggestionMap.values())
      .filter((entry) => normalizeText(entry.label) !== target)
      .sort((a, b) => b.score - a.score)
      .slice(0, 7)
      .map((entry) => entry.label);
  }, [allItems, recentSearches, trimmedQuery]);

  const results = useMemo(() => {
    const withScore = (trimmedQuery
      ? allItems.map((item) => ({ item, score: scoreItem(item, trimmedQuery) })).filter((entry) => entry.score > 0)
      : allItems.map((item) => ({ item, score: 0 }))
    );

    if (sortMode === 'relevant' && trimmedQuery) {
      return withScore
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.item)
        .slice(0, 40);
    }

    const itemsOnly = withScore.map((entry) => entry.item);

    if (sortMode === 'price_asc') {
      return itemsOnly
        .slice()
        .sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0))
        .slice(0, 40);
    }

    if (sortMode === 'price_desc') {
      return itemsOnly
        .slice()
        .sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0))
        .slice(0, 40);
    }

    return itemsOnly
      .slice()
      .sort((a, b) => {
        const aTime = Date.parse(a.createdAt || '') || 0;
        const bTime = Date.parse(b.createdAt || '') || 0;
        return bTime - aTime;
      })
      .slice(0, 40);
  }, [allItems, sortMode, trimmedQuery]);

  const columns = useMemo(() => {
    const left: ProductItem[] = [];
    const right: ProductItem[] = [];
    let leftHeight = 0;
    let rightHeight = 0;

    for (const item of results) {
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
  }, [results]);

  const isLocalTabAvatar = useMemo(() => Boolean(userAvatar && String(userAvatar).startsWith('local:')), [userAvatar]);
  const tabAvatarSource = useMemo(() => (isLocalTabAvatar ? null : resolveAvatarSource(userAvatar)), [userAvatar, isLocalTabAvatar]);

  const openProduct = useCallback((item: ProductItem) => {
    if (trimmedQuery) {
      persistRecentSearch(trimmedQuery);
    }
    recordFeedInteraction(item._id, 'clicked').catch(() => {});
    router.push({ pathname: '/product/[id]', params: { id: item._id } });
  }, [persistRecentSearch, router, trimmedQuery]);

  const clearRecents = useCallback(async () => {
    setRecentSearches([]);
    try {
      await AsyncStorage.removeItem(RECENT_SEARCHES_KEY);
    } catch {
      // Non-blocking clear failure.
    }
  }, []);

  const renderSearchFeedCard = useCallback((item: ProductItem) => {
    const ratio = resolveAspectRatio(item);
    const supportsCustomization = Boolean(item.customizable ?? item.isCustomizable)
      || (item.description || '').toUpperCase().includes(CUSTOMIZABLE_MARKER);
    const pricing = getProductPricing(item);

    return (
      <View key={item._id} style={styles.feedCard}>
        <Pressable onPress={() => openProduct(item)}>
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

        <Pressable style={styles.feedCardTextWrap} onPress={() => openProduct(item)}>
          <View style={styles.feedTitleRow}>
            <HighlightedText
              text={item.title}
              query={trimmedQuery}
              textStyle={styles.feedCardTitle}
              highlightStyle={styles.resultHighlightStrong}
              numberOfLines={1}
            />
            {supportsCustomization ? <ThemedText style={styles.feedCustomBadge}>CUSTOMIZABLE</ThemedText> : null}
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
  }, [openProduct, trimmedQuery]);

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title" style={styles.headerTitle}>Search</ThemedText>
      </View>

      <View style={styles.searchBarWrap}>
        <Ionicons name="search" size={18} color="#96a6bb" />
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={setQuery}
          placeholder="Search by item, category, material, description"
          placeholderTextColor="#71839a"
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          onSubmitEditing={() => persistRecentSearch(trimmedQuery)}
        />
        {query.length > 0 ? (
          <Pressable onPress={() => setQuery('')} style={styles.clearIconBtn}>
            <Ionicons name="close-circle" size={18} color="#8ea0b5" />
          </Pressable>
        ) : null}
      </View>

      {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}

      {trimmedQuery.length > 0 && liveSuggestions.length > 0 ? (
        <View style={styles.suggestionsWrap}>
          {liveSuggestions.map((entry) => (
            <Pressable
              key={`suggestion-${entry}`}
              style={styles.suggestionRow}
              onPress={() => {
                setQuery(entry);
                persistRecentSearch(entry);
              }}>
              <Ionicons name="search-outline" size={14} color="#9fb8d3" />
              <ThemedText style={styles.suggestionText}>{entry}</ThemedText>
            </Pressable>
          ))}
        </View>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.sortScroller}
        contentContainerStyle={styles.sortRow}
        keyboardShouldPersistTaps="handled">
        {SORT_OPTIONS.map((option) => {
          const selected = sortMode === option.key;
          return (
            <Pressable
              key={option.key}
              style={[styles.sortChip, selected && styles.sortChipActive]}
              onPress={() => setSortMode(option.key)}>
              <ThemedText style={[styles.sortChipText, selected && styles.sortChipTextActive]}>{option.label}</ThemedText>
            </Pressable>
          );
        })}
      </ScrollView>

      {!trimmedQuery && recentSearches.length > 0 ? (
        <View style={styles.sectionRow}>
          <ThemedText style={styles.sectionTitle}>Recent</ThemedText>
          <Pressable onPress={clearRecents}>
            <ThemedText style={styles.clearText}>Clear</ThemedText>
          </Pressable>
        </View>
      ) : null}

      {!trimmedQuery && recentSearches.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsScroller}
          contentContainerStyle={styles.chipsRow}
          keyboardShouldPersistTaps="handled">
          {recentSearches.map((entry) => (
            <Pressable
              key={`recent-${entry}`}
              style={styles.recentChip}
              onPress={() => setQuery(entry)}>
              <Ionicons name="time-outline" size={13} color="#acc7e0" />
              <ThemedText style={styles.recentChipText}>{entry}</ThemedText>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {!trimmedQuery && topCategories.length > 0 ? (
        <>
          <View style={styles.sectionRow}>
            <ThemedText style={styles.sectionTitle}>Popular categories</ThemedText>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipsScroller}
            contentContainerStyle={styles.chipsRow}
            keyboardShouldPersistTaps="handled">
            {topCategories.map((entry) => (
              <Pressable key={`category-${entry}`} style={styles.categoryChip} onPress={() => setQuery(entry)}>
                <ThemedText style={styles.categoryChipText}>{entry}</ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        </>
      ) : null}

      {loading ? (
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color="#fff" />
        </View>
      ) : (
        <ScrollView
          style={styles.resultsScroll}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadProducts(true)} tintColor="#fff" />}
          contentContainerStyle={styles.resultsContent}>
          {results.length === 0 ? (
            <View style={styles.emptyWrap}>
              <ThemedText style={styles.emptyTitle}>No matching items</ThemedText>
              <ThemedText style={styles.emptyText}>Try product names, categories, materials, or broader keywords.</ThemedText>
            </View>
          ) : (
            <View style={styles.masonryWrap}>
              <View style={styles.masonryColumn}>{columns.left.map(renderSearchFeedCard)}</View>
              <View style={styles.masonryColumn}>{columns.right.map(renderSearchFeedCard)}</View>
            </View>
          )}
        </ScrollView>
      )}

      <View style={styles.tabBar}>
        <Pressable style={styles.tabItem} onPress={() => router.push('/feed')}>
          <Ionicons name="home-outline" size={26} color="#fff" />
        </Pressable>
        <Pressable style={styles.tabItem} onPress={() => {}}>
          <Ionicons name="search" size={26} color="#fff" />
        </Pressable>
        <Pressable style={styles.tabItem} onPress={() => router.push('/profile')}>
          {isLocalTabAvatar ? (
            <LocalAvatar id={userAvatar || 'local:avatar01'} size={36} style={styles.tabAvatar} />
          ) : tabAvatarSource ? (
            <Image source={tabAvatarSource} style={styles.tabAvatar} contentFit="cover" />
          ) : (
            <Ionicons name="person-outline" size={26} color="#fff" />
          )}
        </Pressable>
      </View>
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
    paddingTop: 64,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 34,
    fontWeight: '700',
    color: '#fff',
  },
  searchBarWrap: {
    marginHorizontal: 16,
    marginTop: 2,
    backgroundColor: '#101c2a',
    borderColor: '#27374a',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: '#eef4ff',
    fontSize: 14,
    paddingVertical: 0,
  },
  clearIconBtn: {
    padding: 2,
  },
  errorText: {
    color: '#ff9f9f',
    marginTop: 8,
    paddingHorizontal: 16,
    fontSize: 12,
  },
  suggestionsWrap: {
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27384b',
    backgroundColor: '#0f1a27',
    overflow: 'hidden',
  },
  suggestionRow: {
    paddingHorizontal: 12,
    height: 40,
    borderBottomWidth: 1,
    borderBottomColor: '#223144',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  suggestionText: {
    color: '#d6e8fa',
    fontSize: 13,
    flex: 1,
  },
  sortRow: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 2,
    alignItems: 'center',
    gap: 8,
  },
  sortScroller: {
    maxHeight: 46,
  },
  sortChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2d3f54',
    backgroundColor: '#142030',
    paddingHorizontal: 12,
    paddingVertical: 6,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sortChipActive: {
    borderColor: '#6da7de',
    backgroundColor: '#1d3651',
  },
  sortChipText: {
    color: '#b7cce4',
    fontSize: 12,
    fontWeight: '600',
  },
  sortChipTextActive: {
    color: '#e8f4ff',
  },
  sectionRow: {
    marginTop: 12,
    marginBottom: 6,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: '#bfd5ee',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  clearText: {
    color: '#8eb4df',
    fontSize: 12,
    fontWeight: '600',
  },
  chipsRow: {
    paddingHorizontal: 16,
    paddingBottom: 2,
    alignItems: 'center',
    gap: 8,
  },
  chipsScroller: {
    maxHeight: 42,
  },
  recentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#132033',
    borderColor: '#2b3d52',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
    minHeight: 32,
  },
  recentChipText: {
    color: '#d7e7f9',
    fontSize: 12,
  },
  categoryChip: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    borderWidth: 0,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryChipText: {
    color: '#dcecff',
    fontSize: 13,
    fontWeight: '600',
  },
  loaderWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultsList: {
    flex: 1,
  },
  resultsScroll: {
    flex: 1,
  },
  resultsContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 86,
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
    backgroundColor: '#0f1724',
    borderColor: '#243449',
    borderWidth: 1,
  },
  feedCardImage: {
    width: '100%',
    backgroundColor: '#0a0f18',
  },
  feedCardTextWrap: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
  },
  feedTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  feedCustomBadge: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: '#c7fbd2',
    backgroundColor: '#122a1b',
    borderColor: '#2f724b',
    borderWidth: 1,
    borderRadius: 99,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  feedCardTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  feedPriceText: {
    color: '#e7efe9',
    fontSize: 20,
    fontWeight: '800',
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
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  feedSocialProofText: {
    marginTop: 4,
    color: '#7d8fa6',
    fontSize: 12,
    fontWeight: '600',
  },
  resultHighlightStrong: {
    backgroundColor: '#29486d',
    color: '#eef7ff',
    fontWeight: '800',
  },
  emptyWrap: {
    marginTop: 24,
    borderRadius: 12,
    borderColor: '#27384c',
    borderWidth: 1,
    backgroundColor: '#101b2a',
    padding: 14,
    alignItems: 'center',
    gap: 4,
  },
  emptyTitle: {
    color: '#e2efff',
    fontWeight: '700',
  },
  emptyText: {
    color: '#adc0d6',
    textAlign: 'center',
    fontSize: 12,
  },
  tabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 70,
    backgroundColor: '#111',
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
  },
  tabItem: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    height: '100%',
  },
  tabAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#2b3750',
  },
});
