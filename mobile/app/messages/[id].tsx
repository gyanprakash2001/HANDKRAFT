import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ChatMessage, getChatMessages, sendChatMessage, uploadChatImage } from '@/utils/api';
import MessageBubble from '@/components/MessageBubble';
import MessageComposer from '@/components/MessageComposer';
import TypingIndicator from '@/components/TypingIndicator';

import currentUser from '@/utils/currentUser';

type Params = {
  id?: string;
  sellerName?: string;
  productTitle?: string;
};

// MessageBubble, composer and typing indicator are implemented as separate components

export default function MessageThreadScreen() {
  const router = useRouter();
  const { id, sellerName, productTitle } = useLocalSearchParams<Params>();
  const conversationId = String(id || 'general-chat');

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [otherTyping] = useState(false);

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

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useFocusEffect(
    useCallback(() => {
      const intervalId = setInterval(() => {
        loadMessages(true);
      }, 4000);

      return () => {
        clearInterval(intervalId);
      };
    }, [loadMessages])
  );

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setSending(true);
      setError(null);
      setDraft('');
      await sendChatMessage(conversationId, text);
      const updated = await getChatMessages(conversationId);
      setMessages(updated);
    } catch (err: any) {
      setError(err?.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handlePickImage = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return Alert.alert('Permission required', 'Please allow access to your photos to send images.');
      // Use explicit 'images' media type to avoid touching deprecated enums.
      const mediaTypesOption = ['images'];

      const result = await (ImagePicker as any).launchImageLibraryAsync({ mediaTypes: mediaTypesOption, quality: 0.8, copyToCacheDirectory: true });
      const uri = (result as any)?.assets?.[0]?.uri || (result as any)?.uri;
      if (!uri) return;

      // Optimistic local preview
      const tempId = `temp-${Date.now()}`;
      const now = new Date().toISOString();
      const localMsg: ChatMessage & { local?: boolean } = {
        id: tempId,
        text: uri,
        senderId: currentUser.getProfile()?.id || 'me',
        isMine: true,
        isImage: true,
        createdAt: now,
      };
      setMessages((prev) => [...prev, localMsg]);

      // Read file as base64; if that fails (Android content:// URIs), fallback to multipart upload
      let dataUri: string | undefined;
      try {
        const isPng = String(uri).toLowerCase().endsWith('.png');
        const fileBase64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        dataUri = `data:${isPng ? 'image/png' : 'image/jpeg'};base64,${fileBase64}`;
      } catch {
        // Attempt multipart upload as a fallback for URIs that can't be read as base64
        try {
          const sent = await uploadChatImage(conversationId, uri);
          setMessages((prev) => prev.map((m) => (m.id === tempId ? sent : m)));
          return;
        } catch {
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          return Alert.alert('Image error', 'Could not read or upload the selected image. Please try a different image or grant permission.');
        }
      }

      try {
        const sent = await sendChatMessage(conversationId, '', dataUri);
        // Replace temp message with server message
        setMessages((prev) => prev.map((m) => (m.id === tempId ? sent : m)));
      } catch (sendErr: any) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        Alert.alert('Send failed', sendErr?.message || 'Failed to send image');
      }
    } catch (err) {
      console.error('Pick image failed', err);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <LinearGradient colors={['#111b2a', '#0a0a0a']} style={styles.headerGradient} />
      <View style={styles.header}>
        <Pressable style={({ pressed }) => [styles.backBtn, pressed && styles.backBtnPressed]} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <View style={styles.headerTextWrap}>
          <ThemedText style={styles.headerTitle}>{headerTitle}</ThemedText>
          {productTitle ? <ThemedText style={styles.headerSubtitle}>About {String(productTitle)}</ThemedText> : null}
        </View>
      </View>

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
            data={messages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messageListContent}
            keyboardShouldPersistTaps="handled"
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
              return <MessageBubble message={item} isOutgoing={Boolean(item.isMine)} showAvatar={showAvatar} />;
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

        <MessageComposer value={draft} onChangeText={setDraft} onSend={handleSend} sending={sending} onPickImage={handlePickImage} />
      </KeyboardAvoidingView>
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
  messageRow: {
    flexDirection: 'row',
  },
  messageAnimatedWrap: {
    width: '100%',
  },
  messageRowMine: {
    justifyContent: 'flex-end',
  },
  messageRowOther: {
    justifyContent: 'flex-start',
  },
  messageBubble: {
    maxWidth: '80%',
    borderRadius: 15,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderWidth: 1,
  },
  messageBubbleMine: {
    backgroundColor: '#9df0a2',
    borderColor: '#6ec77a',
    borderBottomRightRadius: 5,
  },
  messageBubbleOther: {
    backgroundColor: '#151e2d',
    borderColor: '#2b3b54',
    borderBottomLeftRadius: 5,
  },
  messageText: {
    fontSize: 13.5,
    lineHeight: 18,
  },
  messageTextMine: {
    color: '#0a0a0a',
  },
  messageTextOther: {
    color: '#e5edf8',
  },
  messageMeta: {
    fontSize: 10,
    marginTop: 5,
    alignSelf: 'flex-end',
  },
  messageMetaMine: {
    color: '#233027',
  },
  messageMetaOther: {
    color: '#7f93ae',
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
  composerWrap: {
    marginHorizontal: 10,
    marginBottom: 10,
    marginTop: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2d3e56',
    backgroundColor: '#121c2a',
    paddingHorizontal: 9,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 7,
  },
  composerInput: {
    flex: 1,
    color: '#fff',
    maxHeight: 90,
    fontSize: 14,
    lineHeight: 18,
    paddingHorizontal: 7,
    paddingTop: 4,
    paddingBottom: 4,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
  },
  sendBtnGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnGlow: {
    shadowColor: '#7fef9d',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 5,
  },
  sendBtnDisabled: {
    opacity: 0.65,
  },
  sendBtnPressed: {
    transform: [{ scale: 0.93 }],
  },
});
