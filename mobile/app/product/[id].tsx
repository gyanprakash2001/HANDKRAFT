import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, View, ScrollView, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { VideoView, useVideoPlayer } from 'expo-video';

import { useCartNotification } from '@/contexts/cart-notification-context';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { addProductToCart, ensureChatConversation, getProductById, getProducts, getProfileDashboard, ProductItem, ProductMediaItem, toggleLikedProduct } from '@/utils/api';
import { recordFeedInteraction } from '@/utils/feed-behavior';

type Params = {
  id?: string;
};

const CUSTOMIZABLE_MARKER = '[CUSTOMIZABLE]';
const SCREEN_WIDTH = Dimensions.get('window').width;
const PROFILE_MODE_KEY = 'HANDKRAFT_PROFILE_MODE';

function formatPriceINR(price: number) {
  return `₹${Number(price || 0).toLocaleString('en-IN')}`;
}

function ProductVideoSlide({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.loop = true;
    videoPlayer.muted = true;
    videoPlayer.play();
  });

  return (
    <VideoView
      style={styles.heroImage}
      player={player}
      nativeControls
      contentFit="contain"
    />
  );
}

function getPostMedia(product: ProductItem | null): ProductMediaItem[] {
  if (!product) return [];
  if (Array.isArray(product.media) && product.media.length) {
    return product.media
      .filter((entry) => entry?.url)
      .map((entry) => ({
        type: entry.type === 'video' ? 'video' : 'image',
        url: entry.url,
        // Keep video ratio as provided (original), while images can fall back
        // to product.imageAspectRatio.
        aspectRatio: entry.type === 'video' ? entry.aspectRatio : (entry.aspectRatio || product.imageAspectRatio),
      }));
  }
  if (Array.isArray(product.images) && product.images.length) {
    return product.images.map((url) => ({ type: 'image', url, aspectRatio: product.imageAspectRatio }));
  }
  return [{ type: 'image', url: 'https://placehold.co/900x600?text=Handmade+Item', aspectRatio: product.imageAspectRatio }];
}

function clampAspectRatio(value: number) {
  return Math.max(0.5, Math.min(2, Number(value) || 1));
}

function resolveMediaAspectRatio(entry: ProductMediaItem | undefined, fallbackRatio: number) {
  const entryRatio = Number(entry?.aspectRatio);
  if (!Number.isNaN(entryRatio) && entryRatio > 0) {
    return clampAspectRatio(entryRatio);
  }
  return clampAspectRatio(fallbackRatio);
}

function resolveImageDisplayRatio(media: ProductMediaItem[], fallbackRatio: number) {
  const firstImage = media.find((entry) => entry.type === 'image' && entry.url);
  const imageRatio = Number(firstImage?.aspectRatio);
  if (!Number.isNaN(imageRatio) && imageRatio > 0) {
    return clampAspectRatio(imageRatio);
  }
  return clampAspectRatio(fallbackRatio);
}

export default function ProductDetailsScreen() {
  const { id } = useLocalSearchParams<Params>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [autoModeToastVisible, setAutoModeToastVisible] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [openingChat, setOpeningChat] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);
  const [product, setProduct] = useState<ProductItem | null>(null);
  const [relatedProducts, setRelatedProducts] = useState<ProductItem[]>([]);
  const addToCartInFlightRef = useRef(false);
  const autoModeToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { showNotificationForItem } = useCartNotification();
  const productMedia = getPostMedia(product);
  const fallbackRatio = clampAspectRatio(Number(product?.imageAspectRatio || 1));
  // Images on detail should match feed ratio; videos keep original ratio.
  const imageDisplayRatio = resolveImageDisplayRatio(productMedia, fallbackRatio);
  const safeActiveIndex = Math.max(0, Math.min(productMedia.length - 1, activeMediaIndex));
  const activeEntry = productMedia[safeActiveIndex];
  const activeMediaRatio = activeEntry?.type === 'video'
    ? resolveMediaAspectRatio(activeEntry, imageDisplayRatio)
    : imageDisplayRatio;
  const heroMediaHeight = Math.max(1, Math.round(SCREEN_WIDTH / activeMediaRatio));
  const hasCustomizableMarker = (product?.description || '').toUpperCase().includes(CUSTOMIZABLE_MARKER);
  const isCustomizable = Boolean(product?.customizable ?? product?.isCustomizable) || hasCustomizableMarker;
  const cleanedDescription = (product?.description || '').replace(/\[CUSTOMIZABLE\]/gi, '').trim();

  const switchToBuyerModeIfNeeded = useCallback(async () => {
    try {
      const currentMode = await AsyncStorage.getItem(PROFILE_MODE_KEY);
      if (currentMode === 'buyer') {
        return false;
      }
      await AsyncStorage.setItem(PROFILE_MODE_KEY, 'buyer');
      return true;
    } catch {
      // Non-blocking storage failure.
      return false;
    }
  }, []);

  const showAutoModeToast = useCallback(() => {
    setAutoModeToastVisible(true);
    if (autoModeToastTimerRef.current) {
      clearTimeout(autoModeToastTimerRef.current);
    }
    autoModeToastTimerRef.current = setTimeout(() => {
      setAutoModeToastVisible(false);
      autoModeToastTimerRef.current = null;
    }, 3600);
  }, []);

  const loadProductDetails = useCallback(async () => {
    if (!id) {
      setError('Missing product id');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const currentProduct = await getProductById(id);
      setProduct(currentProduct);
      setActiveMediaIndex(0);

      try {
        const dashboard = await getProfileDashboard();
        const liked = dashboard.likedItems.some((item) => item._id === currentProduct._id);
        setIsLiked(liked);
      } catch {
        setIsLiked(false);
      }

      const related = await getProducts({
        category: currentProduct.category,
        limit: 8,
        sort: 'newest',
      });

      const filtered = related.items.filter((item) => item._id !== currentProduct._id).slice(0, 4);
      setRelatedProducts(filtered);
    } catch (err: any) {
      setError(err?.message || 'Failed to load product details');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const handleToggleLike = async () => {
    if (!product || actionBusy) return;
    try {
      setActionBusy(true);
      setActionMessage(null);
      const res = await toggleLikedProduct(product._id);
      setIsLiked(res.liked);
      let switchedToBuyer = false;
      if (res.liked) {
        switchedToBuyer = await switchToBuyerModeIfNeeded();
        if (switchedToBuyer) {
          showAutoModeToast();
        }
      }
      const baseMessage = res.message || (res.liked ? 'Added to liked items' : 'Removed from liked items');
      setActionMessage(baseMessage);
    } catch (err: any) {
      setActionMessage(err?.message || 'Failed to update liked item');
    } finally {
      setActionBusy(false);
    }
  };

  const handleAddToCart = async () => {
    if (!product || actionBusy || addToCartInFlightRef.current) return;
    try {
      addToCartInFlightRef.current = true;
      setActionBusy(true);
      setActionMessage(null);
      await addProductToCart(product._id, 1);
      const switchedToBuyer = await switchToBuyerModeIfNeeded();
      if (switchedToBuyer) {
        showAutoModeToast();
      }
      showNotificationForItem(product, 1);
      setActionMessage('Added to cart');
    } catch (err: any) {
      setActionMessage(err?.message || 'Failed to add to cart');
    } finally {
      addToCartInFlightRef.current = false;
      setActionBusy(false);
    }
  };

  const handleMessageSeller = async () => {
    if (!product || openingChat) return;
    try {
      setOpeningChat(true);
      setActionMessage(null);
      const rawSeller = product.seller as unknown;
      let sellerId: string | undefined;

      if (typeof rawSeller === 'string') {
        sellerId = rawSeller;
      } else if (rawSeller && typeof rawSeller === 'object' && '_id' in rawSeller) {
        const maybeId = (rawSeller as { _id?: unknown })._id;
        if (typeof maybeId === 'string') {
          sellerId = maybeId;
        }
      }

      const conversation = await ensureChatConversation({
        sellerId,
        sellerName: product.sellerName,
        productId: product._id,
        productTitle: product.title,
      });

      router.push({
        pathname: '/messages/[id]',
        params: {
          id: conversation.id,
          sellerName: conversation.otherUser?.name || product.sellerName || 'Seller',
          productTitle: product.title,
        },
      });
    } catch (err: any) {
      const msg = err?.message || 'Could not open chat right now';
      setActionMessage(msg);
      Alert.alert('Chat unavailable', msg);
    } finally {
      setOpeningChat(false);
    }
  };

  useEffect(() => {
    loadProductDetails();
  }, [loadProductDetails]);

  useEffect(() => {
    if (!id) return;
    recordFeedInteraction(id, 'visited').catch(() => {
      // Non-blocking analytics signal.
    });
  }, [id]);

  useEffect(() => {
    return () => {
      if (autoModeToastTimerRef.current) {
        clearTimeout(autoModeToastTimerRef.current);
      }
    };
  }, []);

  if (loading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator size="large" color="#fff" />
      </ThemedView>
    );
  }

  if (error || !product) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText style={styles.errorText}>{error || 'Product not found'}</ThemedText>
        <Pressable style={styles.retryButton} onPress={loadProductDetails}>
          <ThemedText>Retry</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  const openRelatedProduct = (productId: string) => {
    recordFeedInteraction(productId, 'clicked').catch(() => {
      // Keep navigation responsive if behavior tracking fails.
    });
    router.push({ pathname: '/product/[id]', params: { id: productId } });
  };

  return (
    <ThemedView style={styles.container}>
      {autoModeToastVisible ? (
        <View pointerEvents="none" style={styles.autoModeToastWrap}>
          <ThemedText style={styles.autoModeToastText}>Switched to Buyer mode</ThemedText>
        </View>
      ) : null}
      <FlatList
        data={relatedProducts}
        keyExtractor={(item) => item._id}
        ListHeaderComponent={
          <View>
            <ScrollView
              horizontal
              pagingEnabled
              scrollEventThrottle={16}
              showsHorizontalScrollIndicator={false}
              style={[styles.heroSlider, { height: heroMediaHeight }]}
              onScroll={(event) => {
                const nextIndex = Math.max(
                  0,
                  Math.min(productMedia.length - 1, Math.round(event.nativeEvent.contentOffset.x / SCREEN_WIDTH))
                );
                if (nextIndex !== activeMediaIndex) {
                  setActiveMediaIndex(nextIndex);
                }
              }}
              onMomentumScrollEnd={(event) => {
                const nextIndex = Math.max(
                  0,
                  Math.min(productMedia.length - 1, Math.round(event.nativeEvent.contentOffset.x / SCREEN_WIDTH))
                );
                setActiveMediaIndex(nextIndex);
              }}>
              {productMedia.map((entry, index) => {
                return entry.type === 'video' ? (
                  <View key={`${entry.url}-${index}`} style={[styles.heroSlide, { height: heroMediaHeight }]}>
                    <ProductVideoSlide uri={entry.url} />
                  </View>
                ) : (
                  <View key={`${entry.url}-${index}`} style={[styles.heroSlide, { height: heroMediaHeight }]}>
                    <Image
                      source={{ uri: entry.url }}
                      style={styles.heroImage}
                      // Keep image look consistent with feed.
                      contentFit="cover"
                    />
                  </View>
                );
              })}
            </ScrollView>
            {productMedia.length > 1 ? (
              <View style={styles.heroDotsRow}>
                {productMedia.map((_, index) => (
                  <View
                    key={`hero-dot-${index}`}
                    style={[styles.heroDot, index === activeMediaIndex && styles.heroDotActive]}
                  />
                ))}
              </View>
            ) : null}

            <View style={styles.contentBlock}>
              <ThemedText type="title" style={styles.titleText}>{product.title}</ThemedText>
              <ThemedText style={styles.priceText}>{formatPriceINR(product.price)}</ThemedText>
              <ThemedText style={styles.descriptionText}>{cleanedDescription || 'No description provided.'}</ThemedText>

              {isCustomizable ? (
                <Pressable
                  style={[styles.customizeButton, openingChat && styles.disabledButton]}
                  disabled={openingChat}
                  onPress={handleMessageSeller}>
                  {openingChat ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="chatbubble-ellipses-outline" size={18} color="#fff" />
                  )}
                  <ThemedText style={styles.actionText}>{openingChat ? 'Opening chat...' : 'Message seller for customization'}</ThemedText>
                </Pressable>
              ) : null}

              <View style={styles.metaBlock}>
                <ThemedText style={styles.metaText}>Seller: {product.sellerName}</ThemedText>
                <ThemedText style={styles.metaText}>Material: {product.material || 'Not specified'}</ThemedText>
                <ThemedText style={styles.metaText}>Category: {product.category}</ThemedText>
                {isCustomizable ? <ThemedText style={styles.metaText}>Customizable item</ThemedText> : null}
                <ThemedText style={styles.metaText}>
                  Availability: {product.stock > 0 ? `${product.stock} left` : 'Out of stock'}
                </ThemedText>
              </View>

              <View style={styles.actionRow}>
                <Pressable style={[styles.actionButton, styles.likeButton]} onPress={handleToggleLike} disabled={actionBusy}>
                  <Ionicons name={isLiked ? 'heart' : 'heart-outline'} size={18} color={isLiked ? '#ff6b81' : '#fff'} />
                  <ThemedText style={styles.actionText}>{isLiked ? 'Liked' : 'Like'}</ThemedText>
                </Pressable>
                <Pressable
                  style={[styles.actionButton, styles.cartButton, product.stock <= 0 && styles.disabledButton]}
                  onPress={handleAddToCart}
                  disabled={actionBusy || product.stock <= 0}>
                  <Ionicons name="bag-handle-outline" size={18} color="#fff" />
                  <ThemedText style={styles.actionText}>{product.stock > 0 ? 'Add to Cart' : 'Out of stock'}</ThemedText>
                </Pressable>
              </View>

              {actionMessage ? <ThemedText style={styles.actionMessage}>{actionMessage}</ThemedText> : null}

              <ThemedText type="subtitle" style={styles.sectionTitle}>Related Handmade Picks</ThemedText>
            </View>
          </View>
        }
        ListEmptyComponent={<ThemedText style={styles.subtleText}>No related products yet.</ThemedText>}
        renderItem={({ item }) => (
          <Pressable
            style={styles.relatedCard}
            onPress={() => openRelatedProduct(item._id)}>
            <Image
              source={{ uri: item.images?.[0] || 'https://placehold.co/400x260?text=Handmade' }}
              style={styles.relatedImage}
              contentFit="cover"
            />
            <View style={styles.relatedContent}>
              <ThemedText numberOfLines={2}>{item.title}</ThemedText>
              <ThemedText style={styles.relatedPriceText}>{formatPriceINR(item.price)}</ThemedText>
            </View>
          </Pressable>
        )}
        contentContainerStyle={styles.listContent}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050505',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    color: '#ff6b6b',
    marginBottom: 14,
  },
  retryButton: {
    borderColor: '#666',
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  heroImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#0f0f0f',
  },
  heroSlider: {
    width: '100%',
  },
  heroSlide: {
    width: SCREEN_WIDTH,
    overflow: 'hidden',
  },
  heroDotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 8,
    marginBottom: 2,
  },
  heroDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#394757',
  },
  heroDotActive: {
    width: 14,
    borderRadius: 99,
    backgroundColor: '#d8ebff',
  },
  contentBlock: {
    paddingHorizontal: 14,
    paddingTop: 14,
  },
  titleText: {
    fontSize: 28,
    lineHeight: 32,
  },
  priceText: {
    marginTop: 8,
    fontSize: 20,
    fontWeight: '700',
  },
  descriptionText: {
    marginTop: 10,
    color: '#d4d4d4',
  },
  metaBlock: {
    marginTop: 14,
    borderColor: '#2f2f2f',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  metaText: {
    color: '#cfcfcf',
  },
  sectionTitle: {
    marginTop: 18,
    marginBottom: 10,
  },
  actionRow: {
    flexDirection: 'row',
    marginTop: 14,
    gap: 8,
  },
  customizeButton: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2f5f8c',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#14324d',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2f2f2f',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#151515',
  },
  likeButton: {
    minWidth: 96,
  },
  cartButton: {
    flex: 1,
  },
  disabledButton: {
    opacity: 0.5,
  },
  actionText: {
    color: '#fff',
    fontWeight: '600',
  },
  actionMessage: {
    marginTop: 10,
    color: '#b9b9b9',
    fontSize: 13,
  },
  autoModeToastWrap: {
    position: 'absolute',
    top: 74,
    left: 12,
    right: 12,
    zIndex: 20,
    alignItems: 'center',
  },
  autoModeToastText: {
    backgroundColor: '#1f3522',
    color: '#c9f8ce',
    borderColor: '#2e6b34',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
  },
  subtleText: {
    color: '#9b9b9b',
    paddingHorizontal: 14,
    marginBottom: 18,
  },
  listContent: {
    paddingBottom: 24,
  },
  relatedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 14,
    marginBottom: 10,
    borderColor: '#2f2f2f',
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#101010',
  },
  relatedImage: {
    width: 110,
    height: 90,
  },
  relatedContent: {
    flex: 1,
    padding: 10,
  },
  relatedPriceText: {
    marginTop: 6,
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
});

