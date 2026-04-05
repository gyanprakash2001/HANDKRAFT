import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, Pressable, FlatList, RefreshControl, ActivityIndicator, Animated } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { ChatConversation, getChatConversations } from '@/utils/api';

type MessageSection = 'seller_inbox' | 'buyer_orders';

const AVATAR_GRADIENTS = [
  ['#53d7af', '#1f8f8a'],
  ['#78d7ff', '#2b67f8'],
  ['#ffd17b', '#ff8a4c'],
  ['#c8b6ff', '#7a77ff'],
  ['#ff9fcf', '#ff4d8b'],
  ['#b8ff9f', '#4eb86f'],
] as const;

function getInitials(name?: string) {
  if (!name) return 'SC';
  const pieces = name.trim().split(/\s+/).filter(Boolean);
  if (pieces.length === 0) return 'SC';
  const first = pieces[0]?.charAt(0) || '';
  const second = pieces.length > 1 ? pieces[1]?.charAt(0) || '' : pieces[0]?.charAt(1) || '';
  return `${first}${second}`.toUpperCase();
}

function getAvatarGradient(name?: string) {
  const seed = (name || 'seller-chat').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AVATAR_GRADIENTS[seed % AVATAR_GRADIENTS.length];
}

function ConversationRow({
  item,
  index,
  formatTimestamp,
  onPress,
}: {
  item: ChatConversation;
  index: number;
  formatTimestamp: (value?: string) => string;
  onPress: () => void;
}) {
  const entry = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    Animated.timing(entry, {
      toValue: 1,
      duration: 340,
      delay: Math.min(index, 8) * 50,
      useNativeDriver: true,
    }).start();
  }, [entry, index]);

  return (
    <Animated.View
      style={[
        styles.threadCardAnimated,
        {
          opacity: entry,
          transform: [
            {
              translateY: entry.interpolate({
                inputRange: [0, 1],
                outputRange: [14, 0],
              }),
            },
          ],
        },
      ]}>
      <Pressable
        style={({ pressed }) => [styles.threadCard, pressed && styles.threadCardPressed]}
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onPress();
        }}>
        <LinearGradient colors={getAvatarGradient(item.otherUser?.name)} style={styles.threadAvatar}>
          <ThemedText style={styles.threadAvatarText}>{getInitials(item.otherUser?.name)}</ThemedText>
        </LinearGradient>
        <View style={styles.threadBody}>
          <View style={styles.titleRow}>
            <ThemedText numberOfLines={1} style={styles.threadTitle}>{item.otherUser?.name || 'Seller chat'}</ThemedText>
            {item.product?.title ? (
              <View style={styles.productChip}>
                <ThemedText numberOfLines={1} style={styles.productChipText}>{item.product.title}</ThemedText>
              </View>
            ) : null}
          </View>
          <ThemedText numberOfLines={1} style={styles.threadSubtitle}>{item.lastMessage || 'Start your chat'}</ThemedText>
        </View>
        <View style={styles.threadMetaWrap}>
          <ThemedText style={styles.threadTimeText}>{formatTimestamp(item.lastMessageAt || item.updatedAt)}</ThemedText>
          {(item.unreadCount || 0) > 0 ? (
            <View style={styles.unreadBadge}>
              <ThemedText style={styles.unreadBadgeText}>{item.unreadCount! > 99 ? '99+' : String(item.unreadCount)}</ThemedText>
            </View>
          ) : (
            <Ionicons name="chevron-forward" size={18} color="#7b8799" />
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

export default function MessagesScreen() {
  const router = useRouter();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeSection, setActiveSection] = useState<MessageSection>('seller_inbox');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formatTimestamp = (value?: string) => {
    if (!value) return '';
    const date = new Date(value);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    return isToday
      ? date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  const unreadTotal = useMemo(
    () => conversations.reduce((total, item) => total + (item.unreadCount || 0), 0),
    [conversations]
  );

  const sectionedConversations = useMemo(() => {
    const sellerInbox = conversations.filter((item) => item.role === 'seller_inbox');
    const buyerOrders = conversations.filter((item) => item.role !== 'seller_inbox');
    return { sellerInbox, buyerOrders };
  }, [conversations]);

  const visibleConversations = activeSection === 'seller_inbox'
    ? sectionedConversations.sellerInbox
    : sectionedConversations.buyerOrders;

  const sellerUnread = useMemo(
    () => sectionedConversations.sellerInbox.reduce((sum, item) => sum + (item.unreadCount || 0), 0),
    [sectionedConversations.sellerInbox]
  );

  const buyerUnread = useMemo(
    () => sectionedConversations.buyerOrders.reduce((sum, item) => sum + (item.unreadCount || 0), 0),
    [sectionedConversations.buyerOrders]
  );

  const loadConversations = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      setError(null);
      const data = await getChatConversations();
      setConversations(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load conversations');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadConversations();
    }, [loadConversations])
  );

  return (
    <ThemedView style={styles.container}>
      <LinearGradient colors={['#0f1726', '#0a0a0a']} style={styles.headerGradient} />
      <View style={styles.header}>
        <View>
          <ThemedText type="title" style={styles.headerTitle}>Messages</ThemedText>
          <ThemedText style={styles.headerSubtitle}>Requests from buyers and your custom order chats</ThemedText>
        </View>
        <View style={styles.headerPill}>
          <Ionicons name="mail-unread-outline" size={13} color="#9df0a2" />
          <ThemedText style={styles.headerPillText}>{unreadTotal} unread</ThemedText>
        </View>
      </View>

      <View style={styles.segmentWrap}>
        <Pressable
          style={({ pressed }) => [
            styles.segmentButton,
            activeSection === 'seller_inbox' && styles.segmentButtonActive,
            pressed && styles.segmentButtonPressed,
          ]}
          onPress={() => setActiveSection('seller_inbox')}>
          <Ionicons name="construct-outline" size={14} color={activeSection === 'seller_inbox' ? '#082612' : '#9fb3cf'} />
          <ThemedText style={[styles.segmentText, activeSection === 'seller_inbox' && styles.segmentTextActive]}>
            Customer Requests
          </ThemedText>
          {sellerUnread > 0 ? (
            <View style={[styles.segmentCountBadge, activeSection === 'seller_inbox' && styles.segmentCountBadgeActive]}>
              <ThemedText style={[styles.segmentCountText, activeSection === 'seller_inbox' && styles.segmentCountTextActive]}>
                {sellerUnread > 99 ? '99+' : String(sellerUnread)}
              </ThemedText>
            </View>
          ) : null}
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.segmentButton,
            activeSection === 'buyer_orders' && styles.segmentButtonActive,
            pressed && styles.segmentButtonPressed,
          ]}
          onPress={() => setActiveSection('buyer_orders')}>
          <Ionicons name="bag-handle-outline" size={14} color={activeSection === 'buyer_orders' ? '#082612' : '#9fb3cf'} />
          <ThemedText style={[styles.segmentText, activeSection === 'buyer_orders' && styles.segmentTextActive]}>
            Custom Orders
          </ThemedText>
          {buyerUnread > 0 ? (
            <View style={[styles.segmentCountBadge, activeSection === 'buyer_orders' && styles.segmentCountBadgeActive]}>
              <ThemedText style={[styles.segmentCountText, activeSection === 'buyer_orders' && styles.segmentCountTextActive]}>
                {buyerUnread > 99 ? '99+' : String(buyerUnread)}
              </ThemedText>
            </View>
          ) : null}
        </Pressable>
      </View>

      <FlatList
        data={visibleConversations}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadConversations(true)} tintColor="#fff" />}
        renderItem={({ item, index }) => (
          <ConversationRow
            item={item}
            index={index}
            formatTimestamp={formatTimestamp}
            onPress={() =>
              router.push({
                pathname: '/messages/[id]',
                params: {
                  id: item.id,
                  sellerName: item.otherUser?.name || 'Seller chat',
                  productTitle: item.product?.title || '',
                },
              })
            }
          />
        )}
        ListEmptyComponent={
          loading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator size="small" color="#9df0a2" />
              <ThemedText style={styles.loadingText}>Loading conversations...</ThemedText>
              <View style={styles.skeletonCard} />
              <View style={styles.skeletonCard} />
              <View style={styles.skeletonCard} />
            </View>
          ) : (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconWrap}>
                <Ionicons name="chatbubble-ellipses-outline" size={30} color="#9df0a2" />
              </View>
              <ThemedText style={styles.placeholderTitle}>No chats yet</ThemedText>
              <ThemedText style={styles.placeholderText}>
                {error || (activeSection === 'seller_inbox'
                  ? 'Customization requests from customers will appear here.'
                  : 'Chats related to your custom purchases will appear here.')}
              </ThemedText>
              {error ? (
                <Pressable style={({ pressed }) => [styles.retryBtn, pressed && styles.retryBtnPressed]} onPress={() => loadConversations(true)}>
                  <Ionicons name="refresh" size={14} color="#0b111b" />
                  <ThemedText style={styles.retryBtnText}>Retry</ThemedText>
                </Pressable>
              ) : null}
            </View>
          )
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  headerGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 190,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 58,
    paddingBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 34,
    fontWeight: '700',
    color: '#fff',
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: '#9aadc7',
  },
  headerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#28384f',
    backgroundColor: '#101a28',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  headerPillText: {
    color: '#d3e3f7',
    fontSize: 11,
    fontWeight: '700',
  },
  listContent: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 24,
    flexGrow: 1,
  },
  segmentWrap: {
    marginHorizontal: 14,
    marginBottom: 8,
    flexDirection: 'row',
    gap: 8,
  },
  segmentButton: {
    flex: 1,
    minHeight: 38,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2b3d56',
    backgroundColor: '#101a28',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    gap: 5,
  },
  segmentButtonActive: {
    backgroundColor: '#9df0a2',
    borderColor: '#9df0a2',
  },
  segmentButtonPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.98 }],
  },
  segmentText: {
    color: '#9fb3cf',
    fontSize: 11,
    fontWeight: '700',
  },
  segmentTextActive: {
    color: '#082612',
  },
  segmentCountBadge: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#21344b',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  segmentCountBadgeActive: {
    backgroundColor: '#14311f',
  },
  segmentCountText: {
    color: '#dce9fb',
    fontSize: 9,
    fontWeight: '800',
  },
  segmentCountTextActive: {
    color: '#d5ffe2',
  },
  threadCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderWidth: 1,
    borderColor: '#27364b',
    backgroundColor: '#101926',
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 12,
    marginBottom: 0,
  },
  threadCardAnimated: {
    marginBottom: 10,
  },
  threadCardPressed: {
    transform: [{ scale: 0.985 }],
    opacity: 0.95,
  },
  threadAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  threadAvatarText: {
    color: '#041017',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  threadBody: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  productChip: {
    maxWidth: 116,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2e4159',
    backgroundColor: '#162334',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  productChipText: {
    color: '#b8cce7',
    fontSize: 10,
    fontWeight: '700',
  },
  threadMetaWrap: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    minWidth: 56,
    gap: 6,
  },
  threadTimeText: {
    color: '#91a4bf',
    fontSize: 11,
    fontWeight: '600',
  },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#9df0a2',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  unreadBadgeText: {
    color: '#0a0a0a',
    fontSize: 10,
    fontWeight: '800',
  },
  threadTitle: {
    color: '#fff',
    fontSize: 14.5,
    fontWeight: '700',
    maxWidth: '62%',
  },
  threadSubtitle: {
    color: '#9fb3cf',
    marginTop: 3,
    fontSize: 12,
  },
  loadingState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  loadingText: {
    marginTop: 10,
    color: '#b8c7db',
    fontSize: 12,
    marginBottom: 16,
  },
  skeletonCard: {
    width: '100%',
    height: 68,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#1f2a3c',
    backgroundColor: '#101825',
    marginBottom: 10,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  emptyIconWrap: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 1,
    borderColor: '#2b3950',
    backgroundColor: '#121d2c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderTitle: {
    color: '#fff',
    marginTop: 12,
    fontSize: 18,
    fontWeight: '700',
  },
  placeholderText: {
    color: '#adb9c8',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 290,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    borderRadius: 999,
    backgroundColor: '#9df0a2',
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  retryBtnPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
  retryBtnText: {
    color: '#0b111b',
    fontSize: 12,
    fontWeight: '800',
  },
});
