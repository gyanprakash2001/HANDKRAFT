import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  Share,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';

import LocalAvatar from '@/components/LocalAvatar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  ensureChatConversation,
  getSellerPublicProfile,
  ProductItem,
  SellerPublicProfileResponse,
} from '@/utils/api';
import { recordFeedInteraction } from '@/utils/feed-behavior';

type Params = {
  id?: string;
  sellerName?: string;
  productId?: string;
};

function SellerStoryVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.loop = false;
  });

  return (
    <VideoView
      style={styles.storyVideo}
      player={player}
      nativeControls
      contentFit="cover"
    />
  );
}

function normalizeInstagramLink(value: string) {
  const cleaned = String(value || '').trim();
  if (!cleaned) return '';
  if (/^https?:\/\//i.test(cleaned)) return cleaned;
  const handle = cleaned.replace(/^@/, '');
  return `https://instagram.com/${encodeURIComponent(handle)}`;
}

function resolveAvatarSource(value: string) {
  if (!value) {
    return { uri: 'https://placehold.co/200x200?text=Seller' };
  }
  if (value.startsWith('http') || value.startsWith('data:') || value.startsWith('/')) {
    return { uri: value };
  }
  return { uri: `https://avatars.dicebear.com/api/identicon/${encodeURIComponent(value)}.png?background=%23dbe7ff` };
}

export default function SellerPublicProfileScreen() {
  const { id, sellerName, productId } = useLocalSearchParams<Params>();
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openingChat, setOpeningChat] = useState(false);
  const [payload, setPayload] = useState<SellerPublicProfileResponse | null>(null);

  const sellerIdParam = typeof id === 'string' && id !== 'lookup' ? id : undefined;
  const sellerNameParam = typeof sellerName === 'string' ? sellerName : undefined;
  const productIdParam = typeof productId === 'string' ? productId : undefined;

  const loadSellerProfile = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      setError(null);

      const profile = await getSellerPublicProfile({
        sellerId: sellerIdParam,
        sellerName: sellerNameParam,
        productId: productIdParam,
      });
      setPayload(profile);
    } catch (err: any) {
      setError(err?.message || 'Failed to load seller profile');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [productIdParam, sellerIdParam, sellerNameParam]);

  useEffect(() => {
    loadSellerProfile();
  }, [loadSellerProfile]);

  const cardWidth = useMemo(() => (screenWidth - 32 - 8) / 2, [screenWidth]);

  const items = useMemo(() => payload?.items || [], [payload?.items]);

  const columns = useMemo(() => {
    const left: ProductItem[] = [];
    const right: ProductItem[] = [];

    items.forEach((entry, index) => {
      if (index % 2 === 0) {
        left.push(entry);
      } else {
        right.push(entry);
      }
    });

    return { left, right };
  }, [items]);

  const openListing = (entry: ProductItem) => {
    recordFeedInteraction(entry._id, 'clicked').catch(() => {
      // Non-blocking behavior metric.
    });
    router.push({ pathname: '/product/[id]', params: { id: entry._id } });
  };

  const openExternal = async (url: string, fallbackError: string) => {
    if (!url) {
      Alert.alert('Not available', fallbackError);
      return;
    }

    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      // If the URL is a mailto: link, show the email address and allow a fallback action
      if (typeof url === 'string' && url.toLowerCase().startsWith('mailto:')) {
        const email = url.replace(/^mailto:/i, '');
        Alert.alert(
          'Email',
          email || fallbackError,
          [
            { text: 'Share', onPress: async () => { try { await Share.share({ message: email || '' }); } catch {} } },
            { text: 'OK', style: 'cancel' },
          ],
        );
        return;
      }

      Alert.alert('Unavailable', fallbackError);
      return;
    }

    await Linking.openURL(url);
  };

  const handleMessageSeller = async () => {
    if (!payload?.seller?.id || openingChat) return;

    try {
      setOpeningChat(true);
      const firstItem = payload.items?.[0];
      const conversation = await ensureChatConversation({
        sellerId: payload.seller.id,
        sellerName: payload.seller.displayName || payload.seller.name,
        productId: firstItem?._id,
        productTitle: firstItem?.title,
      });

      router.push({
        pathname: '/messages/[id]',
        params: {
          id: conversation.id,
          sellerName: conversation.otherUser?.name || payload.seller.displayName || payload.seller.name,
          productTitle: firstItem?.title || 'Seller chat',
        },
      });
    } catch (err: any) {
      Alert.alert('Chat unavailable', err?.message || 'Could not open chat right now.');
    } finally {
      setOpeningChat(false);
    }
  };

  const handleShareSeller = async () => {
    if (!payload?.seller) return;

    const sellerNameText = payload.seller.displayName || payload.seller.name || 'this maker';
    const website = String(payload.seller.website || '').trim();
    const firstListing = payload.items?.[0]?.title ? ` Popular item: ${payload.items[0].title}.` : '';
    const message = `Check out ${sellerNameText} on HANDKRAFT.${firstListing}${website ? ` ${website}` : ''}`;

    try {
      await Share.share({ message });
    } catch {
      // Ignore share cancellation errors.
    }
  };

  if (loading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator size="large" color="#9df0a2" />
      </ThemedView>
    );
  }

  if (error || !payload) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText style={styles.errorText}>{error || 'Seller profile not found'}</ThemedText>
        <Pressable style={styles.retryButton} onPress={() => loadSellerProfile()}>
          <ThemedText style={styles.retryText}>Retry</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  const instagramUrl = normalizeInstagramLink(payload.seller.instagram || '');
  const websiteUrl = String(payload.seller.website || '').trim();
  const sellerEmail = String(payload.seller.contactEmail || '').trim();
  const reviewLabel = payload.stats.totalReviews === 1
    ? '1 review'
    : `${payload.stats.totalReviews} reviews`;

  return (
    <ThemedView style={styles.container}>
      <View style={styles.headerRow}>
        <Pressable style={styles.iconBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={18} color="#e8f0ff" />
        </Pressable>
        <ThemedText style={styles.headerTitle}>Seller Profile</ThemedText>
        <View style={styles.iconBtnGhost} />
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadSellerProfile(true)} tintColor="#8cc4ff" />}
        contentContainerStyle={styles.content}>
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View style={styles.avatarWrap}>
              {String(payload.seller.avatarUrl || '').startsWith('local:') ? (
                <LocalAvatar id={payload.seller.avatarUrl || 'local:avatar01'} size={84} style={styles.avatar} />
              ) : (
                <Image source={resolveAvatarSource(payload.seller.avatarUrl || '')} style={styles.avatar} contentFit="cover" />
              )}
            </View>

            <View style={styles.heroIdentity}>
              <ThemedText style={styles.nameText}>{payload.seller.displayName || payload.seller.name}</ThemedText>
              <ThemedText style={styles.subtleText}>{payload.seller.tagline || 'Handmade creations crafted with care'}</ThemedText>
            </View>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <ThemedText style={styles.statValue}>{payload.stats.totalListings}</ThemedText>
              <ThemedText style={styles.statLabel}>Listings</ThemedText>
            </View>
            <View style={styles.statCard}>
              <ThemedText style={styles.statValue}>{payload.stats.totalSold}</ThemedText>
              <ThemedText style={styles.statLabel}>Sold</ThemedText>
            </View>
            <View style={styles.statCard}>
              <ThemedText style={styles.statValue}>{payload.stats.averageRating.toFixed(1)}</ThemedText>
              <ThemedText style={styles.statLabel}>{reviewLabel}</ThemedText>
            </View>
          </View>

          <View style={styles.actionsRow}>
            <Pressable
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
              onPress={handleMessageSeller}
              disabled={openingChat}>
              {openingChat ? (
                <ActivityIndicator size="small" color="#111" />
              ) : (
                <Ionicons name="chatbubble-ellipses-outline" size={16} color="#111" />
              )}
              <ThemedText style={styles.primaryBtnText}>Message</ThemedText>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.secondaryBtn, pressed && styles.btnPressed]}
              onPress={() => openExternal(instagramUrl, 'Instagram link is not available.')}>
              <Ionicons name="logo-instagram" size={16} color="#d8e7ff" />
              <ThemedText style={styles.secondaryBtnText}>Instagram</ThemedText>
            </Pressable>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <ThemedText style={styles.sectionTitle}>Growth Story</ThemedText>
          <ThemedText style={styles.storyText}>
            {payload.seller.story || 'This seller has not added a story yet.'}
          </ThemedText>
          {payload.seller.storyVideoUrl ? <SellerStoryVideo uri={payload.seller.storyVideoUrl} /> : null}
        </View>

        <View style={styles.sectionCard}>
          <ThemedText style={styles.sectionTitle}>Connect</ThemedText>
          <View style={styles.connectList}>
            <Pressable
              style={({ pressed }) => [styles.connectItem, pressed && styles.btnPressed]}
              onPress={() => openExternal(websiteUrl, 'Website link is not available.')}>
              <View style={styles.connectItemLeft}>
                <View style={styles.connectIconBadge}>
                  <Ionicons name="globe-outline" size={14} color="#d8e7ff" />
                </View>
                <View style={styles.connectTextWrap}>
                  <ThemedText style={styles.connectTitle}>Website</ThemedText>
                  <ThemedText numberOfLines={1} style={styles.connectValue}>
                    {websiteUrl ? websiteUrl.replace(/^https?:\/\//i, '') : 'Not available'}
                  </ThemedText>
                </View>
              </View>
              <Ionicons name="open-outline" size={14} color="#93a8c2" />
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.connectItem, pressed && styles.btnPressed]}
              onPress={() => openExternal(sellerEmail ? `mailto:${sellerEmail}` : '', 'Email is not available.')}>
              <View style={styles.connectItemLeft}>
                <View style={styles.connectIconBadge}>
                  <Ionicons name="mail-outline" size={14} color="#d8e7ff" />
                </View>
                <View style={styles.connectTextWrap}>
                  <ThemedText style={styles.connectTitle}>Email</ThemedText>
                  <ThemedText numberOfLines={1} style={styles.connectValue}>{sellerEmail || 'Not available'}</ThemedText>
                </View>
              </View>
              <Ionicons name="open-outline" size={14} color="#93a8c2" />
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.connectItem, pressed && styles.btnPressed]}
              onPress={handleShareSeller}>
              <View style={styles.connectItemLeft}>
                <View style={styles.connectIconBadge}>
                  <Ionicons name="share-social-outline" size={14} color="#d8e7ff" />
                </View>
                <View style={styles.connectTextWrap}>
                  <ThemedText style={styles.connectTitle}>Share</ThemedText>
                  <ThemedText numberOfLines={1} style={styles.connectValue}>Share this storefront</ThemedText>
                </View>
              </View>
              <Ionicons name="open-outline" size={14} color="#93a8c2" />
            </Pressable>
          </View>
          {payload.seller.location ? (
            <ThemedText style={styles.locationText}>Based in {payload.seller.location}</ThemedText>
          ) : null}
        </View>

        <View style={styles.listingHeaderRow}>
          <ThemedText style={styles.sectionTitle}>Shop From This Maker</ThemedText>
          <ThemedText style={styles.listingCountText}>{items.length} listings</ThemedText>
        </View>

        {items.length === 0 ? (
          <View style={styles.emptyWrap}>
            <ThemedText style={styles.emptyText}>No active listings yet.</ThemedText>
          </View>
        ) : (
          <View style={styles.gridWrap}>
            <View style={styles.column}>{columns.left.map((entry) => (
              <Pressable
                key={entry._id}
                style={[styles.productCard, { width: cardWidth }]}
                onPress={() => openListing(entry)}>
                <Image
                  source={{ uri: entry.images?.[0] || 'https://placehold.co/600x600?text=Handmade' }}
                  style={styles.productImage}
                  contentFit="cover"
                />
                <View style={styles.productBody}>
                  <ThemedText numberOfLines={2} style={styles.productTitle}>{entry.title}</ThemedText>
                  <ThemedText style={styles.productPrice}>₹{Number(entry.price || 0).toLocaleString('en-IN')}</ThemedText>
                </View>
              </Pressable>
            ))}</View>
            <View style={styles.column}>{columns.right.map((entry) => (
              <Pressable
                key={entry._id}
                style={[styles.productCard, { width: cardWidth }]}
                onPress={() => openListing(entry)}>
                <Image
                  source={{ uri: entry.images?.[0] || 'https://placehold.co/600x600?text=Handmade' }}
                  style={styles.productImage}
                  contentFit="cover"
                />
                <View style={styles.productBody}>
                  <ThemedText numberOfLines={2} style={styles.productTitle}>{entry.title}</ThemedText>
                  <ThemedText style={styles.productPrice}>₹{Number(entry.price || 0).toLocaleString('en-IN')}</ThemedText>
                </View>
              </Pressable>
            ))}</View>
          </View>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#090e14',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#090e14',
    paddingHorizontal: 20,
  },
  headerRow: {
    paddingTop: 56,
    paddingBottom: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#1a2430',
  },
  headerTitle: {
    color: '#f1f5fb',
    fontSize: 19,
    fontWeight: '700',
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#253445',
    backgroundColor: '#101924',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnGhost: {
    width: 34,
    height: 34,
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 30,
    gap: 12,
  },
  heroCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#233143',
    backgroundColor: '#0f1823',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  heroIdentity: {
    flex: 1,
    gap: 4,
  },
  avatarWrap: {
    alignSelf: 'flex-start',
  },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 2,
    borderColor: '#2f435f',
  },
  nameText: {
    color: '#f5f8fd',
    fontSize: 21,
    fontWeight: '800',
  },
  subtleText: {
    color: '#9fb1c6',
    fontSize: 13,
    lineHeight: 18,
  },
  statsRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 8,
  },
  statCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#29384a',
    backgroundColor: '#142131',
    alignItems: 'center',
    paddingVertical: 10,
  },
  statValue: {
    color: '#f3f7fe',
    fontSize: 17,
    fontWeight: '800',
  },
  statLabel: {
    marginTop: 2,
    color: '#9caec3',
    fontSize: 11,
    fontWeight: '600',
  },
  actionsRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 8,
  },
  primaryBtn: {
    flex: 1,
    borderRadius: 11,
    backgroundColor: '#8cc4ff',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 10,
  },
  primaryBtnText: {
    color: '#08111a',
    fontSize: 13,
    fontWeight: '800',
  },
  secondaryBtn: {
    flex: 1,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#2e4259',
    backgroundColor: '#132031',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 10,
  },
  secondaryBtnText: {
    color: '#d5e2f2',
    fontSize: 13,
    fontWeight: '700',
  },
  sectionCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#223243',
    backgroundColor: '#0f1823',
    paddingHorizontal: 13,
    paddingVertical: 13,
  },
  sectionTitle: {
    color: '#ecf3fd',
    fontSize: 14,
    fontWeight: '700',
  },
  storyText: {
    marginTop: 8,
    color: '#b6c5d8',
    fontSize: 13,
    lineHeight: 19,
  },
  storyVideo: {
    marginTop: 10,
    width: '100%',
    height: 210,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#0b121c',
  },
  connectList: {
    marginTop: 10,
    gap: 8,
  },
  connectItem: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27384a',
    backgroundColor: '#132131',
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  connectItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    flex: 1,
  },
  connectIconBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#30455d',
    backgroundColor: '#1a2a3e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectTextWrap: {
    flex: 1,
    gap: 1,
  },
  connectTitle: {
    color: '#dce8f8',
    fontSize: 12,
    fontWeight: '700',
  },
  connectValue: {
    color: '#91a6be',
    fontSize: 11,
    fontWeight: '500',
  },
  locationText: {
    marginTop: 11,
    color: '#93a7be',
    fontSize: 12,
  },
  listingHeaderRow: {
    marginTop: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  listingCountText: {
    color: '#97abc2',
    fontSize: 12,
    fontWeight: '600',
  },
  gridWrap: {
    flexDirection: 'row',
    gap: 10,
  },
  column: {
    flex: 1,
    gap: 10,
  },
  productCard: {
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#223345',
    backgroundColor: '#111c2a',
    overflow: 'hidden',
  },
  productImage: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#0c141f',
  },
  productBody: {
    padding: 10,
  },
  productTitle: {
    color: '#eef4fc',
    fontSize: 13,
    fontWeight: '600',
  },
  productPrice: {
    marginTop: 5,
    color: '#9fd7b0',
    fontSize: 14,
    fontWeight: '800',
  },
  emptyWrap: {
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#223243',
    backgroundColor: '#0f1823',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  emptyText: {
    color: '#9ab0c8',
    fontSize: 13,
    fontWeight: '600',
  },
  btnPressed: {
    opacity: 0.85,
  },
  errorText: {
    color: '#ffbaba',
    fontSize: 14,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#29405a',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: '#122033',
  },
  retryText: {
    color: '#d6e4f7',
    fontSize: 13,
    fontWeight: '700',
  },
});
