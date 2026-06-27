import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  ChatMessage,
  getChatMessages,
  sendChatMessage,
  uploadChatImage,
  addReaction,
  pinMessage,
  unpinMessage,
  getPinnedMessage,
  deleteChatMessage,
} from '@/utils/api';
import MessageBubble from '@/components/MessageBubble';
import MessageComposer from '@/components/MessageComposer';
import MediaViewerModal from '@/components/MediaViewerModal';
import TypingIndicator from '@/components/TypingIndicator';
import { getSocket } from '@/utils/socket';
import { ThemedAlert, AlertButton } from '@/components/ThemedAlert';
import ShareMediaModal from '@/components/ShareMediaModal';
import MessageOptionsModal from '@/components/MessageOptionsModal';

import currentUser from '@/utils/currentUser';

type Params = {
  id?: string;
  sellerName?: string;
  productTitle?: string;
};

export default function MessageThreadScreen() {
  const router = useRouter();
  const { id, sellerName, productTitle } = useLocalSearchParams<Params>();
  const conversationId = String(id || 'general-chat');

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isOtherOnline, setIsOtherOnline] = useState(false);
  const [otherTyping, setOtherTyping] = useState(false);
  const [pinnedMessage, setPinnedMessage] = useState<{ id: string; text: string; senderId: string; createdAt: string } | null>(null);
  
  // Custom Themed Modal States
  const [shareMediaVisible, setShareMediaVisible] = useState(false);
  const [messageOptionsVisible, setMessageOptionsVisible] = useState(false);
  const [activeOptionMessage, setActiveOptionMessage] = useState<ChatMessage | null>(null);
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [alertButtons, setAlertButtons] = useState<AlertButton[]>([]);

  const showThemedAlert = (title: string, message: string, buttons: AlertButton[] = []) => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertButtons(buttons);
    setAlertVisible(true);
  };

  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerUri, setViewerUri] = useState('');
  const [viewerType, setViewerType] = useState<'image' | 'video'>('image');
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);

  const myId = currentUser.getProfile()?.id || 'me';

  const otherUserId = useMemo(() => {
    const firstOtherMsg = messages.find(m => m.senderId !== myId);
    return firstOtherMsg ? firstOtherMsg.senderId : null;
  }, [messages, myId]);

  const headerTitle = useMemo(() => {
    const label = String(sellerName || '').trim();
    if (label) return label;
    return 'Seller chat';
  }, [sellerName]);

  const loadMessages = useCallback(async (silent = false) => {
    if (!conversationId) return;
    try {
      if (!silent) {
        setLoading(true);
      }
      setError(null);
      const data = await getChatMessages(conversationId);
      setMessages(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  const loadPinned = useCallback(async () => {
    try {
      const data = await getPinnedMessage(conversationId);
      if (data && data.pinnedMessage) {
        setPinnedMessage(data.pinnedMessage);
      }
    } catch {}
  }, [conversationId]);

  useEffect(() => {
    loadMessages();
    loadPinned();
  }, [loadMessages, loadPinned]);

  // Real-Time Socket Setup
  useEffect(() => {
    let active = true;
    let currentSocket: any = null;

    const setupSocket = async () => {
      try {
        const socket = await getSocket();
        if (!active) return;
        currentSocket = socket;

        socket.emit('join-conversation', { conversationId });

        socket.on('typing', (data) => {
          if (data.conversationId === conversationId && data.userId !== myId) {
            setOtherTyping(true);
          }
        });

        socket.on('stop-typing', (data) => {
          if (data.conversationId === conversationId && data.userId !== myId) {
            setOtherTyping(false);
          }
        });

        socket.on('user-online', (data) => {
          if (otherUserId && data.userId === otherUserId) {
            setIsOtherOnline(true);
          }
        });

        socket.on('user-offline', (data) => {
          if (otherUserId && data.userId === otherUserId) {
            setIsOtherOnline(false);
          }
        });

        socket.on('messages-read', (data) => {
          if (data.conversationId === conversationId && data.userId !== myId) {
            setMessages(prev => prev.map(m => {
              if (m.senderId === myId && (!m.readBy || !m.readBy.includes(data.userId))) {
                return {
                  ...m,
                  readBy: [...(m.readBy || []), data.userId]
                };
              }
              return m;
            }));
          }
        });

        socket.on('new-message', (msg) => {
          if (msg.senderId !== myId) {
            setMessages(prev => {
              if (prev.some(m => m.id === msg.id)) return prev;
              return [...prev, msg];
            });
            socket.emit('messages-read', { conversationId });
          }
        });

        socket.on('message-reaction', (data) => {
          setMessages(prev => prev.map(m => {
            if (m.id === data.messageId) {
              return {
                ...m,
                reactions: data.reactions
              };
            }
            return m;
          }));
        });

        socket.on('message-pinned', (data) => {
          if (data.conversationId === conversationId) {
            setPinnedMessage(data.pinnedMessage);
          }
        });

        socket.on('message-unpinned', (data) => {
          if (data.conversationId === conversationId) {
            setPinnedMessage(null);
          }
        });

        socket.on('message-deleted', (data) => {
          if (data.conversationId === conversationId) {
            setMessages(prev => prev.filter(m => m.id !== data.messageId));
            setReplyingTo(prev => prev && prev.id === data.messageId ? null : prev);
          }
        });

      } catch (err) {
        console.error('Socket setup error:', err);
      }
    };

    setupSocket();

    return () => {
      active = false;
      if (currentSocket) {
        currentSocket.emit('leave-conversation', { conversationId });
        currentSocket.off('typing');
        currentSocket.off('stop-typing');
        currentSocket.off('user-online');
        currentSocket.off('user-offline');
        currentSocket.off('messages-read');
        currentSocket.off('new-message');
        currentSocket.off('message-reaction');
        currentSocket.off('message-pinned');
        currentSocket.off('message-unpinned');
        currentSocket.off('message-deleted');
      }
    };
  }, [conversationId, otherUserId, myId]);

  // Typing logic
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isTypingRef = useRef(false);

  const handleDraftChange = (text: string) => {
    setDraft(text);
    getSocket().then(socket => {
      if (text.length > 0) {
        if (!isTypingRef.current) {
          isTypingRef.current = true;
          socket.emit('typing', { conversationId });
        }
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
          isTypingRef.current = false;
          socket.emit('stop-typing', { conversationId });
        }, 2000);
      } else {
        if (isTypingRef.current) {
          isTypingRef.current = false;
          socket.emit('stop-typing', { conversationId });
        }
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      }
    }).catch(() => {});
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setSending(true);
      setError(null);
      setDraft('');
      const replyId = replyingTo?.id;
      setReplyingTo(null);

      // Stop typing status instantly
      isTypingRef.current = false;
      const socket = await getSocket();
      socket.emit('stop-typing', { conversationId });

      const newMsg = await sendChatMessage(conversationId, text, undefined, replyId);
      setMessages((prev) => [...prev, newMsg]);
    } catch (err: any) {
      setError(err?.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handlePickImage = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        showThemedAlert('Permission Required', 'Please allow access to your photos to send images.');
        return;
      }
      const mediaTypesOption = ImagePicker.MediaTypeOptions.Images;

      const result = await (ImagePicker as any).launchImageLibraryAsync({
        mediaTypes: mediaTypesOption,
        allowsMultipleSelection: true,
        quality: 0.8,
        copyToCacheDirectory: true
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;

      const replyId = replyingTo?.id;
      setReplyingTo(null);

      for (const asset of result.assets) {
        const uri = asset.uri;
        if (!uri) continue;
        
        const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        const now = new Date().toISOString();
        const localMsg: ChatMessage = {
          id: tempId,
          text: uri,
          senderId: myId,
          isMine: true,
          isImage: true,
          createdAt: now,
        };
        setMessages((prev) => [...prev, localMsg]);

        try {
          const sent = await uploadChatImage(conversationId, uri, replyId);
          setMessages((prev) => prev.map((m) => (m.id === tempId ? sent : m)));
        } catch (err: any) {
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          showThemedAlert('Upload Failed', err?.message || 'Failed to upload image. Please check your network connection.');
        }
      }
    } catch (err) {
      console.error('Pick image failed', err);
    }
  };

  const handleOpenMedia = useCallback((payload: { uri: string; type: 'image' | 'video' }) => {
    if (!payload?.uri) return;
    setViewerUri(payload.uri);
    setViewerType(payload.type);
    setViewerVisible(true);
  }, []);

  const handlePickVideo = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        showThemedAlert('Permission Required', 'Please allow access to your media library to send videos.');
        return;
      }
      const mediaTypesOption = ImagePicker.MediaTypeOptions.Videos;

      const result = await (ImagePicker as any).launchImageLibraryAsync({
        mediaTypes: mediaTypesOption,
        allowsMultipleSelection: true,
        quality: 0.8,
        copyToCacheDirectory: true
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;

      const replyId = replyingTo?.id;
      setReplyingTo(null);

      for (const asset of result.assets) {
        const uri = asset.uri;
        if (!uri) continue;

        const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        const now = new Date().toISOString();
        const localMsg: ChatMessage = {
          id: tempId,
          text: uri,
          senderId: myId,
          isMine: true,
          isVideo: true,
          createdAt: now,
        };
        setMessages((prev) => [...prev, localMsg]);

        try {
          const sent = await uploadChatImage(conversationId, uri, replyId);
          setMessages((prev) => prev.map((m) => (m.id === tempId ? sent : m)));
        } catch (err: any) {
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          showThemedAlert('Upload Failed', err?.message || 'Failed to upload video. Please check your network connection.');
        }
      }
    } catch (err) {
      console.error('Pick video failed', err);
    }
  };

  const handlePressReplyPreview = useCallback((replyToId: string) => {
    const idx = messages.findIndex((m) => m.id === replyToId);
    if (idx !== -1) {
      setHighlightedId(replyToId);
      try {
        flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
      } catch {
        try {
          flatListRef.current?.scrollToOffset({ offset: idx * 85, animated: true });
        } catch {}
      }
      setTimeout(() => {
        setHighlightedId(null);
      }, 1500);
    } else {
      showThemedAlert('Message Not Found', 'The replied-to message is no longer in this conversation window.');
    }
  }, [messages]);

  const handleLongPressBubble = (msg: ChatMessage) => {
    setActiveOptionMessage(msg);
    setMessageOptionsVisible(true);
  };

  const handleSelectEmoji = async (emoji: string) => {
    if (!activeOptionMessage) return;
    const msgId = activeOptionMessage.id;
    try {
      await addReaction(conversationId, msgId, emoji);
      setMessages(prev => prev.map(m => {
        if (m.id === msgId) {
          const newReactions = (m.reactions || []).filter(r => r.userId !== myId);
          newReactions.push({ userId: myId, emoji });
          return { ...m, reactions: newReactions };
        }
        return m;
      }));
    } catch (err: any) {
      showThemedAlert('Error', err?.message || 'Failed to react');
    }
  };

  const handlePinAction = async () => {
    if (!activeOptionMessage) return;
    const isPinned = pinnedMessage && pinnedMessage.id === activeOptionMessage.id;
    try {
      if (isPinned) {
        await unpinMessage(conversationId);
        setPinnedMessage(null);
      } else {
        await pinMessage(conversationId, activeOptionMessage.id);
        setPinnedMessage({
          id: activeOptionMessage.id,
          text: activeOptionMessage.text,
          senderId: activeOptionMessage.senderId,
          createdAt: activeOptionMessage.createdAt
        });
      }
    } catch (err: any) {
      showThemedAlert('Error', err?.message || 'Failed to update pinned state');
    }
  };

  const handleDeleteMessage = async () => {
    if (!activeOptionMessage) return;
    const msgId = activeOptionMessage.id;
    try {
      await deleteChatMessage(conversationId, msgId);
      setMessages(prev => prev.filter(m => m.id !== msgId));
      setReplyingTo(prev => prev && prev.id === msgId ? null : prev);
    } catch (err: any) {
      showThemedAlert('Error', err?.message || 'Failed to delete message');
    }
  };

  return (
    <ThemedView style={styles.container}>
      <LinearGradient colors={['#111b2a', '#0a0a0a']} style={styles.headerGradient} />
      
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={({ pressed }) => [styles.backBtn, pressed && styles.backBtnPressed]} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <View style={styles.headerTextWrap}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <ThemedText style={styles.headerTitle}>{headerTitle}</ThemedText>
            {isOtherOnline && <View style={styles.onlineDot} />}
          </View>
          <ThemedText style={styles.headerSubtitle}>
            {isOtherOnline ? 'Online' : (productTitle ? `About ${String(productTitle)}` : 'Offline')}
          </ThemedText>
        </View>
      </View>

      {/* Pinned Message Sticky Banner */}
      {pinnedMessage && (
        <View style={styles.pinnedBanner}>
          <Ionicons name="pin" size={16} color="#9df0a2" style={{ marginRight: 8 }} />
          <Pressable style={{ flex: 1 }} onPress={() => handlePressReplyPreview(pinnedMessage.id)}>
            <ThemedText style={styles.pinnedTitle}>Pinned Message</ThemedText>
            <ThemedText style={styles.pinnedText} numberOfLines={1}>
              {pinnedMessage.text.startsWith('http') || pinnedMessage.text.startsWith('data:') ? '🎥 Media' : pinnedMessage.text}
            </ThemedText>
          </Pressable>
          <Pressable onPress={async () => {
            try {
              await unpinMessage(conversationId);
              setPinnedMessage(null);
            } catch {}
          }}>
            <Ionicons name="close-circle" size={18} color="#7f93ae" />
          </Pressable>
        </View>
      )}

      {/* KeyboardAvoidingView Wrap */}
      <KeyboardAvoidingView
        style={styles.threadWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 18 : 10}>
        
        {loading && messages.length === 0 ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="small" color="#9df0a2" />
            <ThemedText style={styles.loadingText}>Opening conversation...</ThemedText>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messageListContent}
            keyboardShouldPersistTaps="handled"
            onScrollToIndexFailed={(info) => {
              flatListRef.current?.scrollToOffset({
                offset: info.highestMeasuredFrameIndex * 85,
                animated: true,
              });
            }}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Ionicons name="chatbubble-ellipses-outline" size={28} color="#7f93ae" />
                <ThemedText style={styles.emptyTitle}>Start the conversation</ThemedText>
                <ThemedText style={styles.emptySubtitle}>Share customization details, color, size, and timeline.</ThemedText>
              </View>
            }
            renderItem={({ item, index }) => {
              const prev = messages[index - 1];
              const showAvatar = !item.isMine && (!prev || prev.senderId !== item.senderId || (new Date(item.createdAt).getTime() - new Date(prev.createdAt).getTime()) > 1000 * 60 * 5);
              return (
                <MessageBubble
                  message={item}
                  isOutgoing={Boolean(item.isMine)}
                  showAvatar={showAvatar}
                  onPressMedia={handleOpenMedia}
                  onSwipeToReply={setReplyingTo}
                  onPressReplyPreview={handlePressReplyPreview}
                  onLongPress={handleLongPressBubble}
                  highlighted={highlightedId === item.id}
                />
              );
            }}
          />
        )}

        {error ? (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle" size={14} color="#ff9f9f" />
            <ThemedText style={styles.errorText}>{error}</ThemedText>
            <Pressable style={({ pressed }) => pressed && styles.errorRetryPressed} onPress={() => loadMessages()}>
              <ThemedText style={styles.errorRetryText}>Retry</ThemedText>
            </Pressable>
          </View>
        ) : null}

        {otherTyping ? (
          <View style={{ paddingHorizontal: 12, paddingBottom: 6 }}>
            <TypingIndicator />
          </View>
        ) : null}

        {replyingTo ? (
          <View style={styles.replyPreviewBar}>
            <View style={styles.replyBarBorder} />
            <View style={styles.replyBarContent}>
              <ThemedText style={styles.replyBarSender}>
                Replying to {replyingTo.isMine ? 'yourself' : (sellerName || 'Seller')}
              </ThemedText>
              <ThemedText style={styles.replyBarText} numberOfLines={1}>
                {replyingTo.text.startsWith('data:') || replyingTo.text.startsWith('http') ? (replyingTo.isImage ? '📷 Photo' : '🎥 Video') : replyingTo.text}
              </ThemedText>
            </View>
            <Pressable style={styles.replyBarClose} onPress={() => setReplyingTo(null)}>
              <Ionicons name="close-circle" size={20} color="#7f93ae" />
            </Pressable>
          </View>
        ) : null}

        <MessageComposer
          value={draft}
          onChangeText={handleDraftChange}
          onSend={handleSend}
          sending={sending}
          onPressAttachment={() => setShareMediaVisible(true)}
        />
      </KeyboardAvoidingView>

      <MediaViewerModal
        visible={viewerVisible}
        mediaUri={viewerUri}
        mediaType={viewerType}
        onClose={() => setViewerVisible(false)}
      />

      <ShareMediaModal
        visible={shareMediaVisible}
        onPickPhoto={handlePickImage}
        onPickVideo={handlePickVideo}
        onClose={() => setShareMediaVisible(false)}
      />

      <MessageOptionsModal
        visible={messageOptionsVisible}
        message={activeOptionMessage}
        isPinned={pinnedMessage?.id === activeOptionMessage?.id}
        isMine={activeOptionMessage ? activeOptionMessage.senderId === myId : false}
        onReact={handleSelectEmoji}
        onReply={() => setReplyingTo(activeOptionMessage)}
        onPin={handlePinAction}
        onDelete={handleDeleteMessage}
        onClose={() => setMessageOptionsVisible(false)}
      />

      <ThemedAlert
        visible={alertVisible}
        title={alertTitle}
        message={alertMessage}
        buttons={alertButtons}
        onClose={() => setAlertVisible(false)}
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
    height: 168,
  },
  header: {
    paddingTop: 58,
    paddingBottom: 13,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#1d2734',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111925',
    borderWidth: 1,
    borderColor: '#263246',
    marginRight: 10,
  },
  backBtnPressed: {
    opacity: 0.84,
    transform: [{ scale: 0.96 }],
  },
  headerTextWrap: {
    flex: 1,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: '#8da0bb',
    fontSize: 12,
    marginTop: 2,
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#5fd37e',
  },
  pinnedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#121c2a',
    borderBottomWidth: 1,
    borderBottomColor: '#263244',
    paddingHorizontal: 15,
    paddingVertical: 8,
  },
  pinnedTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9df0a2',
  },
  pinnedText: {
    fontSize: 12,
    color: '#8da0bb',
    marginTop: 2,
  },
  threadWrap: {
    flex: 1,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    color: '#9cb1ce',
    fontSize: 12,
  },
  messageListContent: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 8,
    flexGrow: 1,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    paddingTop: 48,
  },
  emptyTitle: {
    color: '#ebf2ff',
    marginTop: 8,
    fontSize: 15,
    fontWeight: '700',
  },
  emptySubtitle: {
    color: '#8fa2bd',
    marginTop: 5,
    fontSize: 12,
    textAlign: 'center',
  },
  errorBanner: {
    marginHorizontal: 10,
    marginBottom: 70,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#4a2d35',
    backgroundColor: '#2a171d',
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  errorText: {
    flex: 1,
    color: '#ffb6b6',
    fontSize: 12,
  },
  errorRetryText: {
    color: '#ffd4d4',
    fontWeight: '700',
    fontSize: 12,
  },
  errorRetryPressed: {
    opacity: 0.76,
  },
  replyPreviewBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#121c2a',
    borderTopWidth: 1,
    borderTopColor: '#263244',
    paddingHorizontal: 15,
    paddingVertical: 8,
  },
  replyBarBorder: {
    width: 4,
    height: 32,
    backgroundColor: '#9df0a2',
    borderRadius: 2,
  },
  replyBarContent: {
    flex: 1,
    paddingLeft: 10,
  },
  replyBarSender: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9df0a2',
  },
  replyBarText: {
    fontSize: 12,
    color: '#8da0bb',
    marginTop: 2,
  },
  replyBarClose: {
    padding: 4,
  },
});
