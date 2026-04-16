import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, StyleSheet, View, ScrollView, Dimensions, TextInput } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { VideoView, useVideoPlayer } from 'expo-video';

import { useCartNotification } from '@/contexts/cart-notification-context';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  addProductToCart,
  ensureChatConversation,
  getProductById,
  getProductReviewEligibility,
  getProductReviews,
  getProducts,
  getProfileDashboard,
  ProductItem,
  ProductMediaItem,
  ProductReviewGalleryItem,
  ProductReviewItem,
  ProductReviewMediaItem,
  ProductReviewSort,
  ProductReviewSummary,
  submitProductReview,
  toggleLikedProduct,
  toggleProductReviewHelpful,
  uploadProductFile,
} from '@/utils/api';
import { recordFeedInteraction } from '@/utils/feed-behavior';

type Params = {
  id?: string;
};

const CUSTOMIZABLE_MARKER = '[CUSTOMIZABLE]';
const SCREEN_WIDTH = Dimensions.get('window').width;
const PROFILE_MODE_KEY = 'HANDKRAFT_PROFILE_MODE';
const REVIEW_MEDIA_MAX_ATTACHMENTS = 10;

const EMPTY_REVIEW_SUMMARY: ProductReviewSummary = {
  averageRating: 0,
  totalReviews: 0,
  mediaCount: 0,
  verifiedCount: 0,
  ratingBreakdown: {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  },
};

type ReviewMediaDraft = {
  type: 'image' | 'video';
  url: string;
  thumbnailUrl?: string;
};

type ReviewRatingFilter = 1 | 2 | 3 | 4 | 5 | null;

type ReviewViewerMediaItem = {
  type: 'image' | 'video';
  url: string;
  thumbnailUrl?: string;
};

function formatPriceINR(price: number) {
  return `₹${Number(price || 0).toLocaleString('en-IN')}`;
}

function formatReviewDate(value: string) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function resolveReviewMediaType(rawAsset: any): 'image' | 'video' {
  const hint = String(rawAsset?.type || rawAsset?.mimeType || '').toLowerCase();
  return hint.includes('video') ? 'video' : 'image';
}

function resolveSellerId(item: ProductItem | null): string | undefined {
  if (!item?.seller) return undefined;
  if (typeof item.seller === 'string') return item.seller;
  if (item.seller && typeof item.seller === 'object' && typeof item.seller._id === 'string') {
    return item.seller._id;
  }
  return undefined;
}

function getProductPricing(item: ProductItem) {
  const realPrice = Math.max(0, Number(item.realPrice ?? item.price) || 0);
  const discountedPrice = Number(item.discountedPrice);
  const hasDiscount = Number.isFinite(discountedPrice)
    && discountedPrice >= 0
    && discountedPrice < realPrice;

  return {
    realPrice,
    effectivePrice: hasDiscount ? discountedPrice : realPrice,
    hasDiscount,
  };
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

function ReviewVideoViewer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.loop = false;
    videoPlayer.play();
  });

  return (
    <VideoView
      style={styles.mediaViewerVideo}
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
  const [reviewSort, setReviewSort] = useState<ProductReviewSort>('top');
  const [selectedReviewRatingFilter, setSelectedReviewRatingFilter] = useState<ReviewRatingFilter>(null);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviews, setReviews] = useState<ProductReviewItem[]>([]);
  const [reviewMediaGallery, setReviewMediaGallery] = useState<ProductReviewGalleryItem[]>([]);
  const [reviewSummary, setReviewSummary] = useState<ProductReviewSummary>(EMPTY_REVIEW_SUMMARY);
  const [canReview, setCanReview] = useState(true);
  const [reviewEligibilityMessage, setReviewEligibilityMessage] = useState('');
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewTitle, setReviewTitle] = useState('');
  const [reviewComment, setReviewComment] = useState('');
  const [reviewMedia, setReviewMedia] = useState<ReviewMediaDraft[]>([]);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewMediaUploading, setReviewMediaUploading] = useState(false);
  const [helpfulUpdatingReviewId, setHelpfulUpdatingReviewId] = useState<string | null>(null);
  const [reviewViewerVisible, setReviewViewerVisible] = useState(false);
  const [reviewViewerItems, setReviewViewerItems] = useState<ReviewViewerMediaItem[]>([]);
  const [reviewViewerIndex, setReviewViewerIndex] = useState(0);
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

  const loadReviews = useCallback(async (
    productId: string,
    selectedSort: ProductReviewSort,
    ratingFilter: ReviewRatingFilter
  ) => {
    try {
      setReviewsLoading(true);
      const data = await getProductReviews(productId, {
        page: 1,
        limit: 20,
        sort: selectedSort,
        rating: ratingFilter || undefined,
      });
      setReviews(Array.isArray(data?.reviews) ? data.reviews : []);
      setReviewMediaGallery(Array.isArray(data?.mediaGallery) ? data.mediaGallery : []);
      setReviewSummary(data?.summary || EMPTY_REVIEW_SUMMARY);
    } catch {
      setReviews([]);
      setReviewMediaGallery([]);
      setReviewSummary(EMPTY_REVIEW_SUMMARY);
    } finally {
      setReviewsLoading(false);
    }
  }, []);

  const loadReviewEligibility = useCallback(async (productId: string) => {
    try {
      const eligibility = await getProductReviewEligibility(productId);
      setCanReview(Boolean(eligibility?.canReview));
      setReviewEligibilityMessage(String(eligibility?.message || ''));
    } catch {
      // Fallback to permissive UI if eligibility endpoint is unavailable.
      setCanReview(true);
      setReviewEligibilityMessage('');
    }
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

  const handleOpenSellerProfile = () => {
    if (!product) return;

    const sellerId = resolveSellerId(product);
    router.push({
      pathname: '/seller/[id]',
      params: {
        id: sellerId || 'lookup',
        sellerName: product.sellerName || '',
        productId: product._id,
      },
    });
  };

  const handlePickReviewMedia = async () => {
    if (reviewMedia.length >= REVIEW_MEDIA_MAX_ATTACHMENTS || reviewMediaUploading) {
      return;
    }

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission required', 'Allow photo access to attach review media.');
        return;
      }

      const remainingSlots = REVIEW_MEDIA_MAX_ATTACHMENTS - reviewMedia.length;

      const result = await (ImagePicker as any).launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        quality: 0.8,
        allowsMultipleSelection: true,
        selectionLimit: remainingSlots,
      });

      const anyResult = result as any;
      if (anyResult?.canceled) {
        return;
      }

      const pickedAssets = Array.isArray(anyResult?.assets) && anyResult.assets.length > 0
        ? anyResult.assets.slice(0, remainingSlots)
        : (anyResult?.uri
          ? [{ uri: anyResult.uri, type: anyResult.type, mimeType: anyResult.mimeType }]
          : []);

      if (!pickedAssets.length) {
        return;
      }

      const uploadedEntries: ReviewMediaDraft[] = [];
      let failedUploads = 0;

      setReviewMediaUploading(true);

      for (const asset of pickedAssets) {
        const uri = String(asset?.uri || '').trim();
        if (!uri) {
          failedUploads += 1;
          continue;
        }

        try {
          const uploaded = await uploadProductFile(uri);
          const uploadedUrl = String(uploaded?.url || '').trim();
          if (!uploadedUrl) {
            throw new Error('Upload did not return a media URL');
          }

          const mediaType = resolveReviewMediaType(asset);
          uploadedEntries.push({
            type: mediaType,
            url: uploadedUrl,
            thumbnailUrl: mediaType === 'image' ? uploadedUrl : '',
          });
        } catch {
          failedUploads += 1;
        }
      }

      if (uploadedEntries.length > 0) {
        setReviewMedia((prev) => (
          [...prev, ...uploadedEntries].slice(0, REVIEW_MEDIA_MAX_ATTACHMENTS)
        ));
      }

      if (failedUploads > 0) {
        Alert.alert(
          'Some uploads failed',
          `${failedUploads} file${failedUploads > 1 ? 's were' : ' was'} not uploaded. Please retry if needed.`
        );
      }
    } catch (err: any) {
      Alert.alert('Upload failed', err?.message || 'Could not upload review media.');
    } finally {
      setReviewMediaUploading(false);
    }
  };

  const handleSubmitReview = async () => {
    if (!product || reviewSubmitting) return;

    if (!canReview) {
      Alert.alert('Review unavailable', reviewEligibilityMessage || 'You can review only after purchasing this product.');
      return;
    }

    if (reviewRating < 1 || reviewRating > 5) {
      Alert.alert('Rating required', 'Please select a rating between 1 and 5 stars.');
      return;
    }

    try {
      setReviewSubmitting(true);
      const response = await submitProductReview(product._id, {
        rating: reviewRating,
        title: reviewTitle.trim(),
        comment: reviewComment.trim(),
        media: reviewMedia,
      });

      setReviewTitle('');
      setReviewComment('');
      setReviewMedia([]);
      setReviewRating(5);
      setReviewSummary(response?.summary || EMPTY_REVIEW_SUMMARY);

      await Promise.all([
        loadReviews(product._id, reviewSort, selectedReviewRatingFilter),
        loadReviewEligibility(product._id),
      ]);

      Alert.alert('Thank you', response?.message || 'Review submitted successfully.');
    } catch (err: any) {
      Alert.alert('Could not submit review', err?.message || 'Please try again in a moment.');
    } finally {
      setReviewSubmitting(false);
    }
  };

  const handleToggleHelpful = async (reviewId: string, isMine: boolean) => {
    if (!product || !reviewId || isMine || helpfulUpdatingReviewId) return;

    try {
      setHelpfulUpdatingReviewId(reviewId);
      const result = await toggleProductReviewHelpful(product._id, reviewId);
      setReviews((prev) => prev.map((entry) => (
        entry.id === reviewId
          ? {
              ...entry,
              helpfulCount: Number(result.helpfulCount || 0),
              isHelpfulByMe: Boolean(result.isHelpfulByMe),
            }
          : entry
      )));
    } catch (err: any) {
      Alert.alert('Action failed', err?.message || 'Could not update helpful vote.');
    } finally {
      setHelpfulUpdatingReviewId(null);
    }
  };

  const openReviewMediaViewer = useCallback((items: ReviewViewerMediaItem[], startIndex: number) => {
    if (!Array.isArray(items) || items.length === 0) {
      return;
    }

    const safeStartIndex = Math.max(0, Math.min(items.length - 1, Number(startIndex) || 0));
    setReviewViewerItems(items);
    setReviewViewerIndex(safeStartIndex);
    setReviewViewerVisible(true);
  }, []);

  const closeReviewMediaViewer = useCallback(() => {
    setReviewViewerVisible(false);
  }, []);

  const goToPreviousReviewMedia = useCallback(() => {
    setReviewViewerIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const goToNextReviewMedia = useCallback(() => {
    setReviewViewerIndex((prev) => Math.min(reviewViewerItems.length - 1, prev + 1));
  }, [reviewViewerItems.length]);

  const handleToggleRatingFilter = useCallback((rating: 1 | 2 | 3 | 4 | 5) => {
    setSelectedReviewRatingFilter((prev) => (prev === rating ? null : rating));
  }, []);

  useEffect(() => {
    loadProductDetails();
  }, [loadProductDetails]);

  useEffect(() => {
    if (!product?._id) return;
    loadReviews(product._id, reviewSort, selectedReviewRatingFilter);
  }, [loadReviews, product?._id, reviewSort, selectedReviewRatingFilter]);

  useEffect(() => {
    if (!product?._id) return;
    loadReviewEligibility(product._id);
  }, [loadReviewEligibility, product?._id]);

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

  const productPricing = getProductPricing(product);
  const reviewSortOptions: { key: ProductReviewSort; label: string }[] = [
    { key: 'top', label: 'Top' },
    { key: 'latest', label: 'Latest' },
    { key: 'media', label: 'Media' },
  ];
  const reviewGalleryViewerItems: ReviewViewerMediaItem[] = reviewMediaGallery.map((entry) => ({
    type: entry.type === 'video' ? 'video' : 'image',
    url: entry.url,
    thumbnailUrl: entry.thumbnailUrl,
  }));
  const reviewViewerCurrentItem = reviewViewerItems[reviewViewerIndex] || null;
  const canNavigateReviewViewerBack = reviewViewerIndex > 0;
  const canNavigateReviewViewerForward = reviewViewerIndex < reviewViewerItems.length - 1;
  const reviewMediaLimitReached = reviewMedia.length >= REVIEW_MEDIA_MAX_ATTACHMENTS;
  const maxBreakdownCount = Math.max(
    1,
    reviewSummary.ratingBreakdown[1],
    reviewSummary.ratingBreakdown[2],
    reviewSummary.ratingBreakdown[3],
    reviewSummary.ratingBreakdown[4],
    reviewSummary.ratingBreakdown[5]
  );

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
              <View style={styles.priceRow}>
                <ThemedText style={styles.priceText}>{formatPriceINR(productPricing.effectivePrice)}</ThemedText>
                {productPricing.hasDiscount ? (
                  <ThemedText style={styles.originalPriceText}>{formatPriceINR(productPricing.realPrice)}</ThemedText>
                ) : null}
              </View>
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
                <Pressable style={styles.metaSellerRow} onPress={handleOpenSellerProfile}>
                  <ThemedText style={[styles.metaText, styles.metaLinkText]}>Seller: {product.sellerName}</ThemedText>
                  <Ionicons name="chevron-forward" size={14} color="#9fc8ff" />
                </Pressable>
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

              <View style={styles.reviewsSection}>
                <View style={styles.reviewsHeaderRow}>
                  <ThemedText type="subtitle" style={styles.reviewSectionTitle}>Buyer Reviews</ThemedText>
                  <ThemedText style={styles.reviewCountText}>{reviewSummary.totalReviews} ratings</ThemedText>
                </View>

                <View style={styles.reviewSummaryCard}>
                  <View style={styles.reviewSummaryLeft}>
                    <ThemedText style={styles.reviewAverageText}>{reviewSummary.averageRating.toFixed(1)}</ThemedText>
                    <View style={styles.reviewStarRow}>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Ionicons
                          key={`summary-star-${star}`}
                          name={star <= Math.round(reviewSummary.averageRating) ? 'star' : 'star-outline'}
                          size={12}
                          color="#ffd27d"
                        />
                      ))}
                    </View>
                  </View>
                  <View style={styles.reviewBreakdownWrap}>
                    {([5, 4, 3, 2, 1] as const).map((star) => {
                      const count = reviewSummary.ratingBreakdown[star];
                      const widthPercent = Math.max(0, Math.min(100, (count / maxBreakdownCount) * 100));
                      const isSelectedStar = selectedReviewRatingFilter === star;
                      return (
                        <Pressable
                          key={`rating-row-${star}`}
                          style={[styles.reviewBreakdownRow, isSelectedStar && styles.reviewBreakdownRowActive]}
                          onPress={() => handleToggleRatingFilter(star)}>
                          <ThemedText style={styles.reviewBreakdownLabel}>{star}★</ThemedText>
                          <View style={styles.reviewBreakdownTrack}>
                            <View style={[styles.reviewBreakdownFill, isSelectedStar && styles.reviewBreakdownFillActive, { width: `${widthPercent}%` }]} />
                          </View>
                          <ThemedText style={styles.reviewBreakdownCount}>{count}</ThemedText>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                {reviewMediaGallery.length > 0 ? (
                  <View style={styles.reviewGallerySection}>
                    <View style={styles.reviewGalleryHeader}>
                      <ThemedText style={styles.reviewGalleryTitle}>Buyer Photos & Videos</ThemedText>
                      <ThemedText style={styles.reviewGalleryCount}>{reviewMediaGallery.length}</ThemedText>
                    </View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.reviewGalleryRow}>
                      {reviewMediaGallery.map((entry, index) => (
                        <Pressable
                          key={entry.id || `${entry.reviewId}-${index}`}
                          style={styles.reviewGalleryThumbWrap}
                          onPress={() => openReviewMediaViewer(reviewGalleryViewerItems, index)}>
                          <Image
                            source={{ uri: entry.thumbnailUrl || entry.url }}
                            style={styles.reviewGalleryThumb}
                            contentFit="cover"
                          />
                          {entry.type === 'video' ? (
                            <View style={styles.reviewMediaVideoTag}>
                              <Ionicons name="videocam" size={10} color="#fff" />
                            </View>
                          ) : null}
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                ) : null}

                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.reviewSortRow}>
                  {reviewSortOptions.map((option) => (
                    <Pressable
                      key={option.key}
                      style={[styles.reviewSortChip, reviewSort === option.key && styles.reviewSortChipActive]}
                      onPress={() => setReviewSort(option.key)}>
                      <ThemedText style={[styles.reviewSortText, reviewSort === option.key && styles.reviewSortTextActive]}>
                        {option.label}
                      </ThemedText>
                    </Pressable>
                  ))}
                </ScrollView>

                {selectedReviewRatingFilter ? (
                  <View style={styles.reviewFilterNoticeRow}>
                    <ThemedText style={styles.reviewFilterNoticeText}>Showing {selectedReviewRatingFilter}★ reviews</ThemedText>
                    <Pressable style={styles.reviewFilterClearBtn} onPress={() => setSelectedReviewRatingFilter(null)}>
                      <ThemedText style={styles.reviewFilterClearText}>Clear</ThemedText>
                    </Pressable>
                  </View>
                ) : null}

                {canReview ? (
                  <View style={styles.reviewComposerCard}>
                    <ThemedText style={styles.reviewComposerTitle}>Share your experience</ThemedText>
                    <View style={styles.reviewComposerStarsRow}>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Pressable key={`composer-star-${star}`} onPress={() => setReviewRating(star)}>
                          <Ionicons
                            name={star <= reviewRating ? 'star' : 'star-outline'}
                            size={21}
                            color={star <= reviewRating ? '#ffd27d' : '#6f7c8f'}
                          />
                        </Pressable>
                      ))}
                    </View>

                    <TextInput
                      style={styles.reviewTitleInput}
                      placeholder="Review title (optional)"
                      placeholderTextColor="#738299"
                      value={reviewTitle}
                      onChangeText={setReviewTitle}
                    />
                    <TextInput
                      style={styles.reviewCommentInput}
                      placeholder="Tell others what you loved (or what can improve)..."
                      placeholderTextColor="#738299"
                      multiline
                      value={reviewComment}
                      onChangeText={setReviewComment}
                    />

                    {reviewMedia.length > 0 ? (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.reviewMediaRow}>
                        {reviewMedia.map((entry, index) => (
                          <View key={`draft-media-${entry.url}-${index}`} style={styles.reviewMediaThumbWrap}>
                            <Image source={{ uri: entry.thumbnailUrl || entry.url }} style={styles.reviewMediaThumb} contentFit="cover" />
                            {entry.type === 'video' ? (
                              <View style={styles.reviewMediaVideoTag}>
                                <Ionicons name="videocam" size={10} color="#fff" />
                              </View>
                            ) : null}
                            <Pressable
                              style={styles.reviewMediaRemoveBtn}
                              onPress={() => setReviewMedia((prev) => prev.filter((_, mediaIndex) => mediaIndex !== index))}>
                              <Ionicons name="close" size={10} color="#fff" />
                            </Pressable>
                          </View>
                        ))}
                      </ScrollView>
                    ) : null}

                    <View style={styles.reviewComposerActionsRow}>
                      <Pressable
                        style={[styles.reviewMediaAddBtn, (reviewMediaUploading || reviewMediaLimitReached) && styles.disabledButton]}
                        onPress={handlePickReviewMedia}
                        disabled={reviewMediaUploading || reviewMediaLimitReached}>
                        {reviewMediaUploading ? (
                          <ActivityIndicator size="small" color="#0a0a0a" />
                        ) : (
                          <Ionicons name="images-outline" size={14} color="#0a0a0a" />
                        )}
                        <ThemedText style={styles.reviewMediaAddText}>
                          {reviewMediaUploading ? 'Uploading...' : `Add photo/video (${reviewMedia.length}/${REVIEW_MEDIA_MAX_ATTACHMENTS})`}
                        </ThemedText>
                      </Pressable>
                      <Pressable
                        style={[styles.reviewSubmitBtn, reviewSubmitting && styles.disabledButton]}
                        onPress={handleSubmitReview}
                        disabled={reviewSubmitting || reviewMediaUploading}>
                        {reviewSubmitting ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <ThemedText style={styles.reviewSubmitText}>Post</ThemedText>
                        )}
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <View style={styles.reviewEligibilityCard}>
                    <Ionicons name="shield-checkmark-outline" size={16} color="#a6b8d4" />
                    <ThemedText style={styles.reviewEligibilityText}>
                      {reviewEligibilityMessage || 'Only buyers who purchased this product can post reviews.'}
                    </ThemedText>
                  </View>
                )}

                {reviewsLoading ? (
                  <View style={styles.reviewLoadingWrap}>
                    <ActivityIndicator size="small" color="#9fc8ff" />
                  </View>
                ) : reviews.length === 0 ? (
                  <View style={styles.reviewEmptyWrap}>
                    <ThemedText style={styles.reviewEmptyText}>No reviews yet. Be the first to share feedback.</ThemedText>
                  </View>
                ) : (
                  reviews.map((review) => {
                    const isHelpfulBusy = helpfulUpdatingReviewId === review.id;
                    const reviewViewerMediaItems: ReviewViewerMediaItem[] = Array.isArray(review.media)
                      ? review.media.map((entry: ProductReviewMediaItem) => ({
                          type: entry.type === 'video' ? 'video' : 'image',
                          url: entry.url,
                          thumbnailUrl: entry.thumbnailUrl,
                        }))
                      : [];
                    return (
                      <View key={review.id} style={styles.reviewCard}>
                        <View style={styles.reviewCardHeader}>
                          <View style={styles.reviewCardHeaderTextWrap}>
                            <ThemedText style={styles.reviewAuthorText}>{review.user?.name || 'Buyer'}</ThemedText>
                            <ThemedText style={styles.reviewDateText}>{formatReviewDate(review.createdAt)}</ThemedText>
                          </View>
                          {review.verifiedPurchase ? (
                            <View style={styles.verifiedChip}>
                              <Ionicons name="checkmark-circle" size={12} color="#9df0a2" />
                              <ThemedText style={styles.verifiedChipText}>Verified</ThemedText>
                            </View>
                          ) : null}
                        </View>

                        <View style={styles.reviewStarRow}>
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Ionicons
                              key={`review-${review.id}-star-${star}`}
                              name={star <= review.rating ? 'star' : 'star-outline'}
                              size={13}
                              color="#ffd27d"
                            />
                          ))}
                        </View>

                        {review.title ? <ThemedText style={styles.reviewTitleText}>{review.title}</ThemedText> : null}
                        {review.comment ? <ThemedText style={styles.reviewCommentText}>{review.comment}</ThemedText> : null}

                        {Array.isArray(review.media) && review.media.length > 0 ? (
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.reviewMediaRow}>
                            {review.media.map((entry, index) => (
                              <Pressable
                                key={`${review.id}-media-${index}`}
                                style={styles.reviewMediaThumbWrap}
                                onPress={() => openReviewMediaViewer(reviewViewerMediaItems, index)}>
                                <Image
                                  source={{ uri: entry.thumbnailUrl || entry.url }}
                                  style={styles.reviewMediaThumb}
                                  contentFit="cover"
                                />
                                {entry.type === 'video' ? (
                                  <View style={styles.reviewMediaVideoTag}>
                                    <Ionicons name="videocam" size={10} color="#fff" />
                                  </View>
                                ) : null}
                              </Pressable>
                            ))}
                          </ScrollView>
                        ) : null}

                        <View style={styles.reviewHelpfulRow}>
                          <Pressable
                            style={[styles.reviewHelpfulBtn, (review.isMine || isHelpfulBusy) && styles.disabledButton]}
                            onPress={() => handleToggleHelpful(review.id, Boolean(review.isMine))}
                            disabled={Boolean(review.isMine) || isHelpfulBusy}>
                            {isHelpfulBusy ? (
                              <ActivityIndicator size="small" color="#8da9cc" />
                            ) : (
                              <Ionicons
                                name={review.isHelpfulByMe ? 'thumbs-up' : 'thumbs-up-outline'}
                                size={14}
                                color={review.isHelpfulByMe ? '#9fc8ff' : '#8da9cc'}
                              />
                            )}
                            <ThemedText style={[styles.reviewHelpfulText, review.isHelpfulByMe && styles.reviewHelpfulTextActive]}>
                              Helpful {review.helpfulCount > 0 ? `(${review.helpfulCount})` : ''}
                            </ThemedText>
                          </Pressable>
                        </View>
                      </View>
                    );
                  })
                )}
              </View>

              <ThemedText type="subtitle" style={styles.sectionTitle}>Related Handmade Picks</ThemedText>
            </View>
          </View>
        }
        ListEmptyComponent={<ThemedText style={styles.subtleText}>No related products yet.</ThemedText>}
        renderItem={({ item }) => {
          const relatedPricing = getProductPricing(item);

          return (
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
                <View style={styles.relatedPriceRow}>
                  <ThemedText style={styles.relatedPriceText}>{formatPriceINR(relatedPricing.effectivePrice)}</ThemedText>
                  {relatedPricing.hasDiscount ? (
                    <ThemedText style={styles.relatedOriginalPriceText}>{formatPriceINR(relatedPricing.realPrice)}</ThemedText>
                  ) : null}
                </View>
              </View>
            </Pressable>
          );
        }}
        contentContainerStyle={styles.listContent}
      />

      <Modal
        visible={reviewViewerVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeReviewMediaViewer}>
        <View style={styles.mediaViewerOverlay}>
          <View style={styles.mediaViewerTopBar}>
            <Pressable style={styles.mediaViewerCloseBtn} onPress={closeReviewMediaViewer}>
              <Ionicons name="close" size={20} color="#edf4ff" />
            </Pressable>
            <ThemedText style={styles.mediaViewerCountText}>
              {reviewViewerItems.length > 0 ? `${reviewViewerIndex + 1}/${reviewViewerItems.length}` : '0/0'}
            </ThemedText>
          </View>

          <View style={styles.mediaViewerContent}>
            {reviewViewerCurrentItem ? (
              reviewViewerCurrentItem.type === 'video' ? (
                <ReviewVideoViewer uri={reviewViewerCurrentItem.url} />
              ) : (
                <Image
                  source={{ uri: reviewViewerCurrentItem.url }}
                  style={styles.mediaViewerImage}
                  contentFit="contain"
                />
              )
            ) : null}
          </View>

          <View style={styles.mediaViewerBottomBar}>
            <Pressable
              style={[styles.mediaViewerNavBtn, !canNavigateReviewViewerBack && styles.disabledButton]}
              onPress={goToPreviousReviewMedia}
              disabled={!canNavigateReviewViewerBack}>
              <Ionicons name="chevron-back" size={15} color="#d7e7ff" />
              <ThemedText style={styles.mediaViewerNavText}>Prev</ThemedText>
            </Pressable>
            <Pressable
              style={[styles.mediaViewerNavBtn, !canNavigateReviewViewerForward && styles.disabledButton]}
              onPress={goToNextReviewMedia}
              disabled={!canNavigateReviewViewerForward}>
              <ThemedText style={styles.mediaViewerNavText}>Next</ThemedText>
              <Ionicons name="chevron-forward" size={15} color="#d7e7ff" />
            </Pressable>
          </View>
        </View>
      </Modal>
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
    fontSize: 20,
    fontWeight: '700',
  },
  priceRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  originalPriceText: {
    color: '#92a0b2',
    fontSize: 14,
    textDecorationLine: 'line-through',
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
  metaSellerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metaLinkText: {
    color: '#a4cdff',
    fontWeight: '700',
  },
  reviewsSection: {
    marginTop: 16,
    gap: 10,
  },
  reviewsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reviewSectionTitle: {
    marginTop: 0,
    marginBottom: 0,
  },
  reviewCountText: {
    color: '#8ca2bf',
    fontSize: 12,
    fontWeight: '600',
  },
  reviewSummaryCard: {
    borderWidth: 1,
    borderColor: '#2a3a4f',
    borderRadius: 12,
    backgroundColor: '#111826',
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    gap: 10,
  },
  reviewSummaryLeft: {
    width: 62,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewAverageText: {
    color: '#f7fbff',
    fontSize: 23,
    fontWeight: '800',
  },
  reviewStarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 3,
  },
  reviewBreakdownWrap: {
    flex: 1,
    gap: 5,
  },
  reviewBreakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  reviewBreakdownRowActive: {
    borderRadius: 6,
    backgroundColor: '#162435',
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  reviewBreakdownLabel: {
    width: 22,
    color: '#b9c9de',
    fontSize: 11,
  },
  reviewBreakdownTrack: {
    flex: 1,
    height: 6,
    borderRadius: 999,
    backgroundColor: '#243349',
    overflow: 'hidden',
  },
  reviewBreakdownFill: {
    height: '100%',
    backgroundColor: '#9fc8ff',
  },
  reviewBreakdownFillActive: {
    backgroundColor: '#bfd8ff',
  },
  reviewBreakdownCount: {
    minWidth: 18,
    textAlign: 'right',
    color: '#8ca2bf',
    fontSize: 11,
  },
  reviewSortRow: {
    gap: 8,
  },
  reviewGallerySection: {
    gap: 8,
  },
  reviewGalleryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reviewGalleryTitle: {
    color: '#dce9fb',
    fontSize: 12,
    fontWeight: '700',
  },
  reviewGalleryCount: {
    color: '#8ca2bf',
    fontSize: 11,
    fontWeight: '700',
  },
  reviewGalleryRow: {
    gap: 8,
    paddingRight: 4,
  },
  reviewGalleryThumbWrap: {
    width: 72,
    height: 72,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2f425a',
  },
  reviewGalleryThumb: {
    width: '100%',
    height: '100%',
    backgroundColor: '#0f141c',
  },
  reviewSortChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2d3f56',
    backgroundColor: '#141e2d',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  reviewSortChipActive: {
    borderColor: '#3b5f86',
    backgroundColor: '#1a2b3f',
  },
  reviewSortText: {
    color: '#9eb1cb',
    fontSize: 12,
    fontWeight: '600',
  },
  reviewSortTextActive: {
    color: '#d8e9ff',
    fontWeight: '700',
  },
  reviewFilterNoticeRow: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#35506f',
    backgroundColor: '#132235',
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  reviewFilterNoticeText: {
    color: '#bad1ee',
    fontSize: 12,
    fontWeight: '600',
  },
  reviewFilterClearBtn: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#47658a',
    backgroundColor: '#1a2d45',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  reviewFilterClearText: {
    color: '#dce9fb',
    fontSize: 11,
    fontWeight: '700',
  },
  reviewComposerCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a3a4f',
    backgroundColor: '#111826',
    padding: 10,
    gap: 8,
  },
  reviewComposerTitle: {
    color: '#e6f0ff',
    fontSize: 13,
    fontWeight: '700',
  },
  reviewComposerStarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  reviewTitleInput: {
    borderWidth: 1,
    borderColor: '#2a3a50',
    borderRadius: 8,
    backgroundColor: '#0e1521',
    color: '#e8f0ff',
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 13,
  },
  reviewCommentInput: {
    borderWidth: 1,
    borderColor: '#2a3a50',
    borderRadius: 8,
    backgroundColor: '#0e1521',
    color: '#e8f0ff',
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 13,
    minHeight: 78,
    textAlignVertical: 'top',
  },
  reviewMediaRow: {
    gap: 8,
  },
  reviewMediaThumbWrap: {
    width: 72,
    height: 72,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: '#2f425a',
  },
  reviewMediaThumb: {
    width: '100%',
    height: '100%',
    backgroundColor: '#0f141c',
  },
  reviewMediaVideoTag: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    borderRadius: 999,
    paddingHorizontal: 5,
    paddingVertical: 2,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  reviewMediaRemoveBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  reviewComposerActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  reviewMediaAddBtn: {
    flex: 1,
    borderRadius: 8,
    backgroundColor: '#9df0a2',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 9,
  },
  reviewMediaAddText: {
    color: '#0a0a0a',
    fontSize: 12,
    fontWeight: '700',
  },
  reviewSubmitBtn: {
    minWidth: 76,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#36557a',
    backgroundColor: '#1a2e47',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 10,
  },
  reviewSubmitText: {
    color: '#e6f0ff',
    fontSize: 12,
    fontWeight: '700',
  },
  reviewEligibilityCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2f3f54',
    backgroundColor: '#101723',
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  reviewEligibilityText: {
    color: '#9eb1cb',
    fontSize: 12,
    flex: 1,
  },
  reviewLoadingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  reviewEmptyWrap: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2b3b50',
    backgroundColor: '#101723',
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  reviewEmptyText: {
    color: '#9eb1cb',
    fontSize: 12,
  },
  reviewCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a3a4f',
    backgroundColor: '#111826',
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 6,
  },
  reviewCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  reviewCardHeaderTextWrap: {
    flex: 1,
  },
  reviewAuthorText: {
    color: '#eef5ff',
    fontSize: 13,
    fontWeight: '700',
  },
  reviewDateText: {
    marginTop: 2,
    color: '#8ea2bd',
    fontSize: 11,
  },
  verifiedChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#385745',
    backgroundColor: '#17271f',
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  verifiedChipText: {
    color: '#9df0a2',
    fontSize: 10,
    fontWeight: '700',
  },
  reviewTitleText: {
    color: '#dce9fb',
    fontSize: 13,
    fontWeight: '700',
  },
  reviewCommentText: {
    color: '#b9c7d9',
    fontSize: 12,
    lineHeight: 17,
  },
  reviewHelpfulRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  reviewHelpfulBtn: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#31445e',
    backgroundColor: '#142132',
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  reviewHelpfulText: {
    color: '#8da9cc',
    fontSize: 11,
    fontWeight: '700',
  },
  reviewHelpfulTextActive: {
    color: '#9fc8ff',
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
  relatedPriceRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  relatedOriginalPriceText: {
    fontSize: 11,
    color: '#92a0b2',
    textDecorationLine: 'line-through',
  },
  mediaViewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(4, 8, 12, 0.96)',
    paddingTop: 54,
    paddingBottom: 26,
  },
  mediaViewerTopBar: {
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mediaViewerCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#2b3c52',
    backgroundColor: '#101a26',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaViewerCountText: {
    color: '#dce9fb',
    fontSize: 12,
    fontWeight: '700',
  },
  mediaViewerContent: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaViewerImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#0f141c',
  },
  mediaViewerVideo: {
    width: '100%',
    height: '100%',
    backgroundColor: '#0f141c',
  },
  mediaViewerBottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 12,
  },
  mediaViewerNavBtn: {
    minWidth: 92,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#34516f',
    backgroundColor: '#16263a',
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  mediaViewerNavText: {
    color: '#dce9fb',
    fontSize: 12,
    fontWeight: '700',
  },
});

