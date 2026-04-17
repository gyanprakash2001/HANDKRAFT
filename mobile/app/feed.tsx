import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, View, Pressable, ScrollView, RefreshControl, Dimensions, NativeSyntheticEvent, NativeScrollEvent, Platform } from 'react-native';
import { Image } from 'expo-image';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as Haptics from 'expo-haptics';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import LocalAvatar from '@/components/LocalAvatar';
import currentUser from '@/utils/currentUser';
import { useCartNotification } from '@/contexts/cart-notification-context';
import { getProfile, getProducts, ProductItem, ProductMediaItem, getChatConversations, getProfileDashboard } from '@/utils/api';
import { removeToken } from '@/utils/auth';
import { recordFeedInteraction } from '@/utils/feed-behavior';

type ProfileMode = 'buyer' | 'seller';
const PROFILE_MODE_KEY = 'HANDKRAFT_PROFILE_MODE';
const LOCAL_PRICE_OVERRIDES_KEY = 'HANDKRAFT_PRICE_OVERRIDES';
const CUSTOMIZABLE_MARKER = '[CUSTOMIZABLE]';
const FALLBACK_ASPECT_RATIOS = [1, 0.8, 0.75, 0.67, 1.25];
const SCREEN_WIDTH = Dimensions.get('window').width;
const FEED_SIDE_PADDING = 10;
const COLUMN_GAP = 6;
const COLUMN_WIDTH = (SCREEN_WIDTH - FEED_SIDE_PADDING * 2 - COLUMN_GAP) / 2;
const BUYER_FEED_CATEGORIES = ['All', 'Jewelry', 'Home Decor', 'Kitchen', 'Textiles', 'Pottery', 'Woodwork', 'Accessories', 'Art', 'Others'];
const PRIMARY_FEED_CATEGORIES_LOWER = BUYER_FEED_CATEGORIES
  .filter((category) => category !== 'All' && category !== 'Others')
  .map((category) => category.toLowerCase());
const SKELETON_LEFT_RATIOS = [1, 0.8, 1.25];
const SKELETON_RIGHT_RATIOS = [0.75, 1, 0.67];
const ENV_BASE_URL = process.env.EXPO_PUBLIC_API_URL;
const FEED_LIMIT_DEFAULT = 40;
const UNREAD_POLL_MS_DEFAULT = 12000;
const CART_SYNC_THROTTLE_MS = 60000;

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

function FeedVideoSlide({ uri, height }: { uri: string; height: number }) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.loop = true;
    videoPlayer.muted = true;
    videoPlayer.play();
  });

  return (
    <VideoView
      style={{ width: '100%', height }}
      player={player}
      allowsFullscreen={false}
      allowsPictureInPicture={false}
      nativeControls={false}
      // Feed should not crop videos. Fit video inside the image-based frame.
      contentFit="contain"
    />
  );
}

function resolveAspectRatio(item: ProductItem) {
  const explicitRatio = Number(item.imageAspectRatio);
  if (!Number.isNaN(explicitRatio) && explicitRatio >= 0.5 && explicitRatio <= 2) {
    return explicitRatio;
  }

  const hash = hashFromId(item._id);
  return FALLBACK_ASPECT_RATIOS[hash % FALLBACK_ASPECT_RATIOS.length];
}

function clampAspectRatio(value: number) {
  return Math.max(0.5, Math.min(2, Number(value) || 1));
}

function resolveFeedCardRatio(item: ProductItem, media: ProductMediaItem[]) {
  const itemRatio = Number(item.imageAspectRatio);
  if (!Number.isNaN(itemRatio) && itemRatio >= 0.5 && itemRatio <= 2) {
    return itemRatio;
  }

  const firstImage = media.find((entry) => entry.type === 'image' && entry.url);
  const firstImageRatio = Number(firstImage?.aspectRatio);
  if (!Number.isNaN(firstImageRatio) && firstImageRatio > 0) {
    return clampAspectRatio(firstImageRatio);
  }

  const firstMediaRatio = Number(media[0]?.aspectRatio);
  if (!Number.isNaN(firstMediaRatio) && firstMediaRatio > 0) {
    return clampAspectRatio(firstMediaRatio);
  }

  return resolveAspectRatio(item);
}

function formatPrice(price: number) {
  return `₹${Number(price || 0).toLocaleString('en-IN')}`;
}

type LocalPriceOverride = {
  realPrice?: number;
  discountedPrice?: number;
  discountPercentage?: number;
};

function getProductPricing(item: ProductItem, localOverride?: LocalPriceOverride) {
  const overrideReal = Number(localOverride?.realPrice);
  const overrideDiscounted = Number(localOverride?.discountedPrice);
  const overridePercent = Number(localOverride?.discountPercentage);

  const realPrice = Math.max(
    0,
    Number(
      Number.isFinite(overrideReal)
        ? overrideReal
        : (item.realPrice ?? item.price)
    ) || 0
  );

  const discountedPrice = Number(
    Number.isFinite(overrideDiscounted)
      ? overrideDiscounted
      : item.discountedPrice
  );

  const hasDiscount = Number.isFinite(discountedPrice) && discountedPrice >= 0 && realPrice > 0 && discountedPrice < realPrice;
  const effectivePrice = hasDiscount ? discountedPrice : realPrice;
  const computedDiscount = hasDiscount
    ? Number(
      Number.isFinite(overridePercent)
        ? overridePercent
        : (item.discountPercentage ?? (((realPrice - discountedPrice) / realPrice) * 100))
    )
    : 0;

  return {
    realPrice,
    effectivePrice,
    hasDiscount,
    discountPercentage: Math.max(0, Number.isFinite(computedDiscount) ? Math.round(computedDiscount) : 0),
  };
}

function hashFromId(id: string) {
  return (id || '').split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function getSocialProof(item: ProductItem) {
  const sold = Math.max(0, Number(item.monthlySold) || 0);
  return `${sold} sold this month`;
}

function getPostMedia(item: ProductItem): ProductMediaItem[] {
  if (Array.isArray(item.media) && item.media.length) {
    return item.media
      .filter((entry) => entry?.url)
      .map((entry) => ({
        type: entry.type === 'video' ? 'video' : 'image',
        url: entry.url,
        // Use explicit entry aspectRatio when available, otherwise fall back
        // to the product's imageAspectRatio so videos match image sizing in the feed.
        aspectRatio: entry.aspectRatio || item.imageAspectRatio,
      }));
  }

  if (Array.isArray(item.images) && item.images.length) {
    return item.images.map((url) => ({ type: 'image', url, aspectRatio: item.imageAspectRatio }));
  }

  return [{ type: 'image', url: 'https://placehold.co/600x400?text=Handmade', aspectRatio: item.imageAspectRatio }];
}

export default function FeedScreen() {
  const [mode, setMode] = useState<ProfileMode>('buyer');
  const [buyerName, setBuyerName] = useState('Buyer');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [hideFeedTopFilters, setHideFeedTopFilters] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [priceOverridesById, setPriceOverridesById] = useState<Record<string, LocalPriceOverride>>({});
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [activeMediaByPost, setActiveMediaByPost] = useState<Record<string, number>>({});
  const [mediaSlideWidthByPost, setMediaSlideWidthByPost] = useState<Record<string, number>>({});
  const lastScrollYRef = useRef(0);
  const firstFocusRef = useRef(true);
  const lastCartSyncAtRef = useRef(0);
  const seenProductIdsRef = useRef<Set<string>>(new Set());
  const topFiltersAnim = useRef(new Animated.Value(1)).current;
  const router = useRouter();
  const { totalCartItems, hydrateCartFromBackend } = useCartNotification();

  const handleMediaLayout = useCallback((postId: string, width: number) => {
    const normalized = Number(width) || 0;
    if (normalized <= 0) return;

    setMediaSlideWidthByPost((prev) => {
      if (prev[postId] === normalized) return prev;
      return { ...prev, [postId]: normalized };
    });
  }, []);

  const handleMediaScrollEnd = (postId: string, event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const fallbackWidth = mediaSlideWidthByPost[postId] || COLUMN_WIDTH;
    const viewportWidth = Math.max(
      1,
      Number(event.nativeEvent.layoutMeasurement?.width) || fallbackWidth
    );
    const index = Math.max(0, Math.round(event.nativeEvent.contentOffset.x / viewportWidth));
    setActiveMediaByPost((prev) => {
      if (prev[postId] === index) return prev;
      return { ...prev, [postId]: index };
    });
  };

  const loadUnreadMessageCount = useCallback(async () => {
    try {
      const conversations = await getChatConversations();
      const unreadTotal = conversations.reduce((sum, item) => sum + (item.unreadCount || 0), 0);
      setUnreadMessageCount(unreadTotal);
    } catch {
      // Keep previous count if unread fetch fails.
    }
  }, []);

  const syncCartBadgeFromBackend = useCallback(async () => {
    const now = Date.now();
    if (now - lastCartSyncAtRef.current < CART_SYNC_THROTTLE_MS) {
      return;
    }

    lastCartSyncAtRef.current = now;

    try {
      const dashboard = await getProfileDashboard();
      hydrateCartFromBackend(dashboard.cartItems || []);
    } catch {
      // Keep current badge value if cart sync fails.
    }
  }, [hydrateCartFromBackend]);

  const loadFeed = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      setError(null);
      const productLimit = FEED_LIMIT_DEFAULT;

      const profilePromise = getProfile();
      const productsPromise = getProducts({ page: 1, limit: productLimit, sort: 'newest' });

      try {
        const profile = await profilePromise;
        const firstName = String(profile?.name || 'Buyer').trim().split(' ')[0];
        setBuyerName(firstName || 'Buyer');
        setUserAvatar(profile?.avatarUrl || null);
        currentUser.setProfile(profile || null);
      } catch {
        // If user was deleted from DB but token exists on device, force fresh login.
        await removeToken();
        router.replace('/login');
        return;
      }

      const productsRes = await productsPromise;

      setProducts(productsRes.items || []);
      loadUnreadMessageCount();
    } catch (err: any) {
      const message = err?.message || 'Failed to load feed';
      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadUnreadMessageCount, router]);

  useEffect(() => {
    let mounted = true;

    const readMode = async () => {
      try {
        const savedMode = await AsyncStorage.getItem(PROFILE_MODE_KEY);
        if (mounted && (savedMode === 'buyer' || savedMode === 'seller')) {
          setMode(savedMode);
        }
      } catch {
        // Keep buyer default if storage read fails.
      }
    };

    const readPriceOverrides = async () => {
      try {
        const raw = await AsyncStorage.getItem(LOCAL_PRICE_OVERRIDES_KEY);
        if (!mounted || !raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          setPriceOverridesById(parsed);
        }
      } catch {
        // Keep overrides empty if local cache read fails.
      }
    };

    readMode();
    readPriceOverrides();

    return () => {
      mounted = false;
    };
  }, [loadFeed]);

  useFocusEffect(
    useCallback(() => {
      const isFirstFocus = firstFocusRef.current;
      firstFocusRef.current = false;

      loadFeed(!isFirstFocus);
      loadUnreadMessageCount();
      syncCartBadgeFromBackend();
      const pollerId = setInterval(() => {
        loadUnreadMessageCount();
      }, UNREAD_POLL_MS_DEFAULT);

      return () => {
        clearInterval(pollerId);
      };
    }, [loadFeed, loadUnreadMessageCount, syncCartBadgeFromBackend])
  );

  const handleFeedScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = Math.max(0, event.nativeEvent.contentOffset.y);
    const delta = y - lastScrollYRef.current;

    if (y <= 0) {
      setHideFeedTopFilters(false);
      lastScrollYRef.current = 0;
      return;
    }

    if (delta > 6 && y > 24) {
      setHideFeedTopFilters(true);
    }

    lastScrollYRef.current = y;
  }, []);

  const handleRefresh = useCallback(() => {
    setHideFeedTopFilters(false);
    loadFeed(true);
  }, [loadFeed]);

  useEffect(() => {
    const unsub = currentUser.subscribe((p) => {
      try { setUserAvatar(p?.avatarUrl || null); } catch { /* ignore */ }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    topFiltersAnim.stopAnimation();
    Animated.spring(topFiltersAnim, {
      toValue: hideFeedTopFilters ? 0 : 1,
      damping: 20,
      stiffness: 220,
      mass: 0.8,
      overshootClamping: true,
      useNativeDriver: false,
    }).start();
  }, [hideFeedTopFilters, topFiltersAnim]);

  const filteredProducts = useMemo(() => {
    if (selectedCategory === 'All') {
      return products;
    }

    if (selectedCategory === 'Others') {
      return products.filter((item) => {
        const category = String(item.category || '').toLowerCase();
        return !PRIMARY_FEED_CATEGORIES_LOWER.includes(category);
      });
    }

    const target = selectedCategory.toLowerCase();
    return products.filter((item) => {
      const category = String(item.category || '').toLowerCase();
      return category === target;
    });
  }, [products, selectedCategory]);

  const openProductDetail = useCallback((productId: string) => {
    recordFeedInteraction(productId, 'clicked').catch(() => {
      // Keep navigation responsive if behavior tracking fails.
    });
    router.push({ pathname: '/product/[id]', params: { id: productId } });
  }, [router]);

  const isLocalTabAvatar = useMemo(() => Boolean(userAvatar && String(userAvatar).startsWith('local:')), [userAvatar]);
  const tabAvatarSource = useMemo(() => (isLocalTabAvatar ? null : resolveAvatarSource(userAvatar)), [userAvatar, isLocalTabAvatar]);

  // Compute two-column masonry layout. Use measured media widths when
  // available so the height estimates match the actual reserved media heights
  // and avoid gaps. Recompute when measurements arrive.
  const columns = useMemo(() => {
    const left: ProductItem[] = [];
    const right: ProductItem[] = [];
    let leftHeight = 0;
    let rightHeight = 0;

    for (const item of filteredProducts) {
      const media = getPostMedia(item);
      const ratio = resolveFeedCardRatio(item, media);
      const slideWidth = mediaSlideWidthByPost[item._id] || COLUMN_WIDTH;
      // Match the same math we use when rendering slides: height = width / ratio
      const estimatedCardHeight = (slideWidth / Math.max(0.0001, ratio)) + 88;

      if (leftHeight <= rightHeight) {
        left.push(item);
        leftHeight += estimatedCardHeight;
      } else {
        right.push(item);
        rightHeight += estimatedCardHeight;
      }
    }

    return { left, right };
  }, [filteredProducts, mediaSlideWidthByPost]);

  const renderCard = (item: ProductItem) => {
    if (!seenProductIdsRef.current.has(item._id)) {
      seenProductIdsRef.current.add(item._id);
      recordFeedInteraction(item._id, 'seen').catch(() => {
        // Non-blocking behavior signal.
      });
    }

    const supportsCustomization = Boolean(item.customizable ?? item.isCustomizable)
      || (item.description || '').toUpperCase().includes(CUSTOMIZABLE_MARKER);
    const socialProof = getSocialProof(item);
    const pricing = getProductPricing(item, priceOverridesById[item._id]);
    const media = getPostMedia(item);
    const feedRatio = resolveFeedCardRatio(item, media);
    const mediaSlideWidth = mediaSlideWidthByPost[item._id] || COLUMN_WIDTH;
    const activeIndex = Math.max(0, Math.min(media.length - 1, activeMediaByPost[item._id] || 0));

    const estimatedCardHeight = Math.max(1, Math.round((mediaSlideWidth / Math.max(0.0001, feedRatio)) + 88));

    return (
      <View
        key={item._id}
        style={[styles.card, { minHeight: estimatedCardHeight }]}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}>
        <View
          style={styles.cardImageContainer}
          onLayout={(event) => handleMediaLayout(item._id, event.nativeEvent.layout.width)}>
          <ScrollView
            horizontal
            pagingEnabled
            scrollEnabled={media.length > 1}
            nestedScrollEnabled
            snapToInterval={mediaSlideWidth}
            snapToAlignment="start"
            disableIntervalMomentum
            directionalLockEnabled={false}
            decelerationRate="fast"
            bounces={false}
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(event) => handleMediaScrollEnd(item._id, event)}
            style={styles.mediaSlider}>
            {media.map((entry, index) => {
              const imageFitMode = 'cover';
              const slideWidth = mediaSlideWidth || COLUMN_WIDTH;
              // Feed cards use one fixed ratio per post (from image ratio), so
              // mixed portrait videos do not create large vertical gaps.
              const mediaHeightPx = Math.max(1, Math.round(slideWidth / feedRatio));

              return entry.type === 'video' ? (
                <Pressable
                  key={`${entry.url}-${index}`}
                  style={[styles.mediaSlideWrap, { width: slideWidth, height: mediaHeightPx }]}
                  onPress={() => openProductDetail(item._id)}>
                  <FeedVideoSlide uri={entry.url} height={mediaHeightPx} />
                </Pressable>
              ) : (
                <Pressable
                  key={`${entry.url}-${index}`}
                  style={[styles.mediaSlideWrap, { width: slideWidth, height: mediaHeightPx }]}
                  onPress={() => openProductDetail(item._id)}>
                  <Image
                    source={{ uri: entry.url }}
                    style={{ width: slideWidth, height: mediaHeightPx, backgroundColor: '#181818' }}
                    contentFit={imageFitMode}
                  />
                </Pressable>
              );
            })}
          </ScrollView>
          {media.length > 1 ? (
            <View style={styles.mediaDotsRow}>
              {media.map((_, index) => (
                <View
                  key={`${item._id}-dot-${index}`}
                  style={[styles.mediaDot, index === activeIndex && styles.mediaDotActive]}
                />
              ))}
            </View>
          ) : null}
          {pricing.hasDiscount ? (
            <View style={styles.discountBadge}>
              <ThemedText style={styles.discountBadgeText}>{pricing.discountPercentage}% OFF</ThemedText>
            </View>
          ) : null}
        </View>

        <Pressable
          style={styles.cardTextWrap}
          onPress={() => openProductDetail(item._id)}>
          <View style={styles.titleRow}>
            <ThemedText numberOfLines={1} style={styles.cardTitle}>{item.title}</ThemedText>
            {supportsCustomization ? <ThemedText style={styles.customBadge}>CUSTOMIZABLE</ThemedText> : null}
          </View>
          <View style={styles.priceRow}>
            <ThemedText style={styles.priceText}>{formatPrice(pricing.effectivePrice)}</ThemedText>
            {pricing.hasDiscount ? (
              <>
                <ThemedText style={styles.originalPriceText}>{formatPrice(pricing.realPrice)}</ThemedText>
              </>
            ) : null}
          </View>
          <ThemedText numberOfLines={1} style={styles.socialProofText}>{socialProof}</ThemedText>
        </Pressable>
      </View>
    );
  };

  return (
    <ThemedView style={styles.container}>
      {/* Header with brand left and quick actions right */}
      <View style={styles.header}>
        <View style={styles.brandWrap}>
          <Image
            source={require('../assets/feed_logo.png')}
            style={styles.brandLogo}
            contentFit="cover"
            accessibilityLabel="Handkraft logo"
            accessibilityRole="image"
          />
        </View>
        <View style={styles.headerActions}>
          <Pressable
            style={({ pressed }) => [styles.headerActionButton, styles.headerActionCart, pressed && styles.headerActionPressed]}
            onPress={() => router.push('/checkout')}>
            <Ionicons name="cart-outline" size={24} color="#dce9fb" />
            {totalCartItems > 0 ? (
              <View style={styles.cartBadge}>
                <ThemedText style={styles.cartBadgeText}>{totalCartItems > 99 ? '99+' : String(totalCartItems)}</ThemedText>
              </View>
            ) : null}
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.headerActionButton, styles.headerActionChat, pressed && styles.headerActionPressed]}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              router.push('/messages');
            }}>
            <Ionicons name="chatbubble-ellipses-outline" size={30} color="#fff" />
            {unreadMessageCount > 0 ? (
              <View style={styles.messageBadge}>
                <ThemedText style={styles.messageBadgeText}>{unreadMessageCount > 99 ? '99+' : String(unreadMessageCount)}</ThemedText>
              </View>
            ) : null}
          </Pressable>
        </View>
      </View>

      {/* Error message if any */}
      {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}

      <Animated.View
        style={[
          styles.discoveryAnimatedWrap,
          {
            height: topFiltersAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 82],
            }),
            opacity: topFiltersAnim.interpolate({
              inputRange: [0, 0.1, 1],
              outputRange: [0, 0, 1],
            }),
            transform: [
              {
                translateY: topFiltersAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-14, 0],
                }),
              },
            ],
          },
        ]}>
        <Animated.View
          style={[
            styles.discoveryStrip,
            {
              transform: [
                {
                  scale: topFiltersAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.98, 1],
                  }),
                },
              ],
            },
          ]}>
          {loading ? (
            <>
              <View>
                <View style={[styles.skeletonLine, styles.skeletonDiscoveryTitle]} />
                <View style={[styles.skeletonLine, styles.skeletonDiscoverySubtitle]} />
              </View>
              <View style={styles.skeletonBadge} />
            </>
          ) : (
            <>
              <View>
                <ThemedText style={styles.discoveryTitle}>For you, {buyerName}</ThemedText>
                <ThemedText style={styles.discoverySubtitle}>Fresh handmade drops from local creators</ThemedText>
              </View>
              <Pressable style={styles.discoveryBadge} onPress={() => router.push('/daily-picks')}>
                <Ionicons name="pricetags-outline" size={14} color="#0a0a0a" />
                <ThemedText style={styles.discoveryBadgeText}>Daily picks</ThemedText>
              </Pressable>
            </>
          )}
        </Animated.View>
      </Animated.View>

      {loading ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryRow}
          style={styles.categoryScroller}>
          {Array.from({ length: 6 }).map((_, index) => (
            <View key={`skeleton-chip-${index}`} style={styles.skeletonCategoryChip} />
          ))}
        </ScrollView>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryRow}
          style={styles.categoryScroller}>
          {BUYER_FEED_CATEGORIES.map((category) => (
            <Pressable
              key={category}
              style={({ pressed }) => [
                styles.categoryChip,
                selectedCategory === category && styles.categoryChipActive,
                pressed && styles.categoryChipPressed,
              ]}
              onPress={() => setSelectedCategory(category)}>
              <ThemedText style={[styles.categoryChipText, selectedCategory === category && styles.categoryChipTextActive]}>
                {category}
              </ThemedText>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <ScrollView
        style={styles.feedScroll}
        onScroll={handleFeedScroll}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#fff" />}
        contentContainerStyle={styles.feedContent}>
        {loading ? (
          <View style={styles.masonryWrap}>
            <View style={styles.column}>
              {SKELETON_LEFT_RATIOS.map((ratio, index) => (
                <View key={`skeleton-left-${index}`} style={styles.skeletonCard}>
                  <View style={[styles.skeletonImage, { aspectRatio: ratio }]} />
                  <View style={styles.skeletonTextWrap}>
                    <View style={[styles.skeletonLine, styles.skeletonTitleLine]} />
                    <View style={[styles.skeletonLine, styles.skeletonPriceLine]} />
                  </View>
                </View>
              ))}
            </View>
            <View style={styles.column}>
              {SKELETON_RIGHT_RATIOS.map((ratio, index) => (
                <View key={`skeleton-right-${index}`} style={styles.skeletonCard}>
                  <View style={[styles.skeletonImage, { aspectRatio: ratio }]} />
                  <View style={styles.skeletonTextWrap}>
                    <View style={[styles.skeletonLine, styles.skeletonTitleLine]} />
                    <View style={[styles.skeletonLine, styles.skeletonPriceLine]} />
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : filteredProducts.length === 0 ? (
          <View style={styles.emptyState}>
            <ThemedText style={styles.emptyText}>
              {selectedCategory === 'All'
                ? 'No handmade items found yet.'
                : `No ${selectedCategory} items right now.`}
            </ThemedText>
            {selectedCategory !== 'All' ? (
              <Pressable onPress={() => setSelectedCategory('All')} style={styles.emptyResetBtn}>
                <ThemedText style={styles.emptyResetText}>Show all categories</ThemedText>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <>
            <View style={styles.masonryWrap}>
              <View style={styles.column}>{columns.left.map(renderCard)}</View>
              <View style={styles.column}>{columns.right.map(renderCard)}</View>
            </View>
          </>
        )}
      </ScrollView>

      {/* Bottom Tab Navigation */}
      <View style={styles.tabBar}>
        <Pressable style={styles.tabItem} onPress={() => router.push('/feed')}>
          <Ionicons name="home" size={26} color="#fff" />
        </Pressable>
        <Pressable style={styles.tabItem} onPress={() => router.push(mode === 'seller' ? '/upload' : '/explore')}>
          <Ionicons name={mode === 'seller' ? 'add' : 'search-outline'} size={mode === 'seller' ? 30 : 26} color="#fff" />
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brandWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandLogo: {
    width: 150,
    height: 48,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerActionButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#28374b',
    backgroundColor: '#101926',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  headerActionCart: {
    backgroundColor: '#101a27',
  },
  headerActionChat: {
    backgroundColor: '#101a27',
  },
  headerActionPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.95 }],
  },
  cartBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#444',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  cartBadgeText: {
    color: '#000',
    fontSize: 9,
    fontWeight: '800',
  },
  messageBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  messageBadgeText: {
    color: '#000',
    fontSize: 9,
    fontWeight: '800',
  },
  discoveryAnimatedWrap: {
    overflow: 'hidden',
  },
  skeletonLine: {
    backgroundColor: '#202a35',
    borderRadius: 8,
  },
  skeletonDiscoveryTitle: {
    width: 130,
    height: 14,
  },
  skeletonDiscoverySubtitle: {
    width: 190,
    height: 10,
    marginTop: 8,
  },
  skeletonBadge: {
    width: 74,
    height: 24,
    borderRadius: 99,
    backgroundColor: '#2a3643',
  },
  skeletonCategoryChip: {
    width: 74,
    height: 30,
    borderRadius: 99,
    backgroundColor: '#1f2934',
    borderWidth: 1,
    borderColor: '#2b3743',
  },
  discoveryStrip: {
    marginHorizontal: 10,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27323d',
    backgroundColor: '#121a24',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  discoveryTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  discoverySubtitle: {
    color: '#9fb0c1',
    fontSize: 12,
    marginTop: 2,
  },
  discoveryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  discoveryBadgeText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 11,
  },
  categoryScroller: {
    maxHeight: 42,
  },
  categoryRow: {
    paddingHorizontal: 10,
    paddingBottom: 8,
    gap: 8,
  },
  categoryChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#444',
    backgroundColor: '#181818',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  categoryChipActive: {
    backgroundColor: '#fff',
    borderColor: '#fff',
  },
  categoryChipPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.97 }],
  },
  categoryChipText: {
    color: '#ccc',
    fontSize: 12,
    fontWeight: '600',
  },
  categoryChipTextActive: {
    color: '#000',
  },
  feedContent: {
    paddingHorizontal: FEED_SIDE_PADDING,
    paddingBottom: 80,
    paddingTop: 2,
  },
  feedScroll: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
  },
  errorText: {
    marginHorizontal: 12,
    marginBottom: 8,
    color: '#ff6b6b',
  },
  emptyState: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyText: {
    color: '#b4b4b4',
    fontSize: 13,
  },
  emptyResetBtn: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#2f724b',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#122a1b',
  },
  emptyResetText: {
    color: '#b9f7c5',
    fontSize: 12,
    fontWeight: '600',
  },
  masonryWrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: COLUMN_GAP,
  },
  column: {
    flex: 1,
    gap: 6,
  },
  card: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    overflow: 'hidden',
  },
  cardImageContainer: {
    position: 'relative',
    backgroundColor: '#111',
  },
  skeletonCard: {
    backgroundColor: '#111823',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#232f3d',
    overflow: 'hidden',
  },
  skeletonImage: {
    width: '100%',
    backgroundColor: '#1c2733',
  },
  skeletonTextWrap: {
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 12,
  },
  skeletonTitleLine: {
    width: '85%',
    height: 11,
  },
  skeletonPriceLine: {
    width: '45%',
    height: 10,
    marginTop: 8,
  },
  cardImage: {
    width: '100%',
    backgroundColor: '#181818',
  },
  mediaSlider: {
    width: '100%',
  },
  mediaSlideWrap: {
    overflow: 'hidden',
  },
  mediaDotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingTop: 8,
  },
  mediaDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#3e4a58',
  },
  mediaDotActive: {
    width: 14,
    borderRadius: 99,
    backgroundColor: '#cfe6ff',
  },
  cardTextWrap: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  customBadge: {
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
  cardTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  priceText: {
    color: '#e7efe9',
    fontSize: 13,
    fontWeight: '700',
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
    backgroundColor: '#ffebee', // light red background
    borderColor: '#e53935', // strong red border
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  discountBadgeText: {
    color: '#e53935', // strong red text
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  socialProofText: {
    marginTop: 4,
    color: '#7d8fa6',
    fontSize: 12,
    fontWeight: '600',
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
