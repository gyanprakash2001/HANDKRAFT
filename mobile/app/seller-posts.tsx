import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { deleteProduct, getSellerListedItems, ProductItem } from '@/utils/api';

export default function SellerPostsScreen() {
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posts, setPosts] = useState<ProductItem[]>([]);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);

  const loadPosts = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      setError(null);
      const items = await getSellerListedItems();
      setPosts(items || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load seller posts');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  const cardWidth = useMemo(() => (screenWidth - 32) / 2, [screenWidth]);

  const postColumns = useMemo(() => {
    if (posts.length === 0) {
      return { left: [], right: [] };
    }

    const left: ProductItem[] = [];
    const right: ProductItem[] = [];

    posts.forEach((item, index) => {
      if (index % 2 === 0) {
        left.push(item);
      } else {
        right.push(item);
      }
    });

    return { left, right };
  }, [posts]);

  const handleDeletePost = useCallback((item: ProductItem) => {
    if (deletingPostId) return;

    Alert.alert(
      'Delete post',
      `Delete "${item.title}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeletingPostId(item._id);
              await deleteProduct(item._id);
              setPosts((prev) => prev.filter((entry) => entry._id !== item._id));
            } catch (err: any) {
              Alert.alert('Delete failed', err?.message || 'Could not delete this post right now.');
            } finally {
              setDeletingPostId(null);
            }
          },
        },
      ]
    );
  }, [deletingPostId]);

  const renderPostCard = useCallback((item: ProductItem) => {
    const supportsCustomization = Boolean(item.customizable ?? item.isCustomizable)
      || (item.description || '').toUpperCase().includes('CUSTOMIZABLE');
    const sold = Math.max(0, Number(item.monthlySold) || 0);
    const socialProof = sold > 0 ? `${sold} sold` : '';
    const isDeleting = deletingPostId === item._id;

    return (
      <View key={item._id} style={[styles.postCard, { width: cardWidth }]}>
        <View style={styles.postImageWrap}>
          <Image
            source={{ uri: item.images?.[0] || 'https://placehold.co/600x600?text=Handmade' }}
            style={styles.postImage}
            contentFit="cover"
          />
        </View>
        <View style={styles.postBody}>
          <View style={styles.postTitleRow}>
            <ThemedText numberOfLines={1} style={[styles.postTitle, { flex: 1 }]}>{item.title}</ThemedText>
            {supportsCustomization ? <ThemedText style={styles.postBadge}>CUSTOM</ThemedText> : null}
          </View>
          <ThemedText style={styles.postPrice}>₹{(item.price || 0).toLocaleString('en-IN')}</ThemedText>
          {!!socialProof && (
            <ThemedText numberOfLines={1} style={styles.postMeta}>{socialProof}</ThemedText>
          )}

          <View style={styles.postActionsRow}>
            <Pressable
              style={({ pressed }) => [styles.viewBtn, pressed && styles.actionBtnPressed]}
              onPress={() =>
                router.push({
                  pathname: '/seller-product/[id]',
                  params: { id: item._id },
                })
              }>
              <Ionicons name="open-outline" size={14} color="#a7d5ff" />
              <ThemedText style={styles.viewBtnText}>View</ThemedText>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.deleteBtn,
                pressed && styles.actionBtnPressed,
                isDeleting && styles.deleteBtnDisabled,
              ]}
              onPress={() => handleDeletePost(item)}
              disabled={isDeleting || Boolean(deletingPostId)}>
              {isDeleting ? (
                <ActivityIndicator size="small" color="#ffb6b6" />
              ) : (
                <>
                  <Ionicons name="trash-outline" size={14} color="#ff9b9b" />
                  <ThemedText style={styles.deleteBtnText}>Delete</ThemedText>
                </>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    );
  }, [cardWidth, deletingPostId, handleDeletePost, router]);

  if (loading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator size="large" color="#9df0a2" />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={18} color="#d9e6f8" />
        </Pressable>
        <ThemedText style={styles.headerTitle}>My Posts</ThemedText>
        <Pressable style={styles.refreshBtn} onPress={() => loadPosts(true)}>
          <Ionicons name="refresh" size={18} color="#9df0a2" />
        </Pressable>
      </View>

      {error ? (
        <View style={styles.errorWrap}>
          <ThemedText style={styles.errorText}>{error}</ThemedText>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadPosts(true)} tintColor="#9df0a2" />}>
          <View style={styles.summaryRow}>
            <ThemedText style={styles.summaryTitle}>Total Listings</ThemedText>
            <ThemedText style={styles.summaryCount}>{posts.length}</ThemedText>
          </View>

          {posts.length === 0 ? (
            <View style={styles.emptyWrap}>
              <ThemedText style={styles.emptyTitle}>No posts yet</ThemedText>
              <ThemedText style={styles.emptySub}>Add listings from Upload to see them here.</ThemedText>
            </View>
          ) : (
            <View style={styles.postsGrid}>
              <View style={styles.postsColumn}>{postColumns.left.map((item) => renderPostCard(item))}</View>
              <View style={styles.postsColumn}>{postColumns.right.map((item) => renderPostCard(item))}</View>
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
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a0a0a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 54,
    paddingBottom: 12,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a3a4f',
    backgroundColor: '#141f2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#284036',
    backgroundColor: '#15271e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 12,
    paddingBottom: 24,
    gap: 10,
  },
  summaryRow: {
    marginTop: 4,
    marginBottom: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#233247',
    backgroundColor: '#111a27',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  summaryTitle: {
    color: '#a9b5c4',
    fontSize: 12,
    fontWeight: '600',
  },
  summaryCount: {
    color: '#9df0a2',
    fontSize: 16,
    fontWeight: '800',
  },
  postsGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  postsColumn: {
    flex: 1,
    gap: 8,
  },
  postCard: {
    borderRadius: 10,
    backgroundColor: '#141922',
    borderWidth: 1,
    borderColor: '#2a3a4f',
    overflow: 'hidden',
  },
  postImageWrap: {
    backgroundColor: '#0a0f18',
    overflow: 'hidden',
  },
  postImage: {
    width: '100%',
    aspectRatio: 1,
  },
  postBody: {
    padding: 10,
  },
  postTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  postTitle: {
    color: '#d9e6f8',
    fontSize: 13,
    fontWeight: '600',
  },
  postBadge: {
    fontSize: 9,
    fontWeight: '700',
    color: '#ffcf85',
    backgroundColor: 'rgba(255, 207, 133, 0.1)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  postPrice: {
    color: '#9df0a2',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  postMeta: {
    color: '#a9b5c4',
    fontSize: 11,
    fontWeight: '500',
  },
  postActionsRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8,
  },
  viewBtn: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2c425c',
    backgroundColor: '#152235',
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  viewBtnText: {
    color: '#a7d5ff',
    fontSize: 11,
    fontWeight: '700',
  },
  deleteBtn: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#5a2d2d',
    backgroundColor: '#2a1717',
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  deleteBtnDisabled: {
    opacity: 0.65,
  },
  deleteBtnText: {
    color: '#ff9b9b',
    fontSize: 11,
    fontWeight: '700',
  },
  actionBtnPressed: {
    opacity: 0.82,
  },
  emptyWrap: {
    marginTop: 32,
    marginHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#223347',
    backgroundColor: '#111a27',
    paddingHorizontal: 14,
    paddingVertical: 18,
    alignItems: 'center',
  },
  emptyTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  emptySub: {
    marginTop: 6,
    color: '#8fa0b8',
    fontSize: 12,
    textAlign: 'center',
  },
  errorWrap: {
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#5a2f2f',
    backgroundColor: '#2a1515',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorText: {
    color: '#ffc9c9',
    fontSize: 13,
    fontWeight: '600',
  },
});
