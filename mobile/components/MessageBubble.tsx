import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import LocalAvatar from '@/components/LocalAvatar';
import type { ChatMessage } from '@/utils/api';

function getMessageMedia(message: ChatMessage) {
  const raw = String(message.text || '').trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  const isImage = Boolean(
    message.isImage
    || lower.startsWith('data:image/')
    || (lower.startsWith('file:') && /\.(jpg|jpeg|png|webp|gif)(\?|#|$)/i.test(lower))
    || /\/uploads\/messages\/.*\.(jpg|jpeg|png|webp|gif)(\?|#|$)/i.test(lower)
  );
  if (isImage) {
    return { type: 'image' as const, uri: raw };
  }

  const isVideo = Boolean(
    message.isVideo
    || lower.startsWith('data:video/')
    || /\.(mp4|mov|m4v|webm|avi)(\?|#|$)/i.test(lower)
    || /\/uploads\/messages\/.*\.(mp4|mov|m4v|webm|avi)(\?|#|$)/i.test(lower)
  );
  if (isVideo) {
    return { type: 'video' as const, uri: raw };
  }

  return null;
}

export default function MessageBubble({
  message,
  isOutgoing,
  showAvatar,
  onPressMedia,
  onSwipeToReply,
  onPressReplyPreview,
  onLongPress,
  highlighted,
}: {
  message: ChatMessage;
  isOutgoing: boolean;
  showAvatar?: boolean;
  onPressMedia?: (payload: { uri: string; type: 'image' | 'video' }) => void;
  onSwipeToReply?: (message: ChatMessage) => void;
  onPressReplyPreview?: (replyToId: string) => void;
  onLongPress?: (message: ChatMessage) => void;
  highlighted?: boolean;
}) {
  const swipeableRef = useRef<Swipeable>(null);
  const entry = useMemo(() => new Animated.Value(0), []);
  const media = useMemo(() => getMessageMedia(message), [message]);

  useEffect(() => {
    Animated.timing(entry, {
      toValue: 1,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [entry]);

  const time = useMemo(() => {
    try {
      const d = new Date(message.createdAt);
      return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }, [message.createdAt]);

  const handleSwipeOpen = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (onSwipeToReply) {
      onSwipeToReply(message);
    }
    setTimeout(() => {
      swipeableRef.current?.close();
    }, 150);
  };

  const renderLeftActions = (progress: any, dragX: any) => {
    const scale = dragX.interpolate({
      inputRange: [0, 50, 80],
      outputRange: [0.6, 1, 1.2],
      extrapolate: 'clamp',
    });
    const transX = dragX.interpolate({
      inputRange: [0, 50, 80],
      outputRange: [-20, 0, 10],
      extrapolate: 'clamp',
    });
    return (
      <View style={styles.replyIconContainer}>
        <Animated.View style={{ transform: [{ scale }, { translateX: transX }] }}>
          <Ionicons name="arrow-undo-outline" size={20} color="#9df0a2" />
        </Animated.View>
      </View>
    );
  };

  const renderReplyPreview = (reply: any, isMineBubble: boolean) => {
    return (
      <Pressable
        onPress={() => onPressReplyPreview && onPressReplyPreview(reply.id)}
        style={[
          styles.replyPreview,
          isMineBubble ? styles.replyPreviewMine : styles.replyPreviewOther
        ]}
      >
        <View style={[styles.replyBorder, isMineBubble ? styles.replyBorderMine : styles.replyBorderOther]} />
        <View style={styles.replyContent}>
          <Text style={[styles.replySender, isMineBubble ? styles.replySenderMine : styles.replySenderOther]} numberOfLines={1}>
            {reply.senderName}
          </Text>
          <Text style={[styles.replyText, isMineBubble ? styles.replyTextMine : styles.replyTextOther]} numberOfLines={1}>
            {reply.isImage ? '📷 Photo' : (reply.isVideo ? '🎥 Video' : reply.text)}
          </Text>
        </View>
      </Pressable>
    );
  };

  const renderDoubleCheckmarks = (isMine: boolean) => {
    if (!isMine) return null;
    const isRead = message.readBy && message.readBy.some(uid => uid !== message.senderId);
    return (
      <Ionicons
        name="checkmark-done"
        size={14}
        color={isRead ? '#34B7F1' : '#7f93ae'}
        style={{ marginLeft: 4, alignSelf: 'flex-end' }}
      />
    );
  };

  const bubbleContent = (
    <Pressable
      onLongPress={() => onLongPress?.(message)}
      style={[
        styles.bubbleWrap,
        isOutgoing ? styles.bubbleWrapRight : styles.bubbleWrapLeft
      ]}
    >
      <View style={{ position: 'relative' }}>
        {(() => {
          if (media?.type === 'image') {
            return (
              <Pressable
                onPress={() => onPressMedia?.(media)}
                onLongPress={() => onLongPress?.(message)}
                style={({ pressed }) => [styles.bubble, isOutgoing ? styles.bubbleRightImage : styles.bubbleLeftImage, pressed && styles.mediaPressed]}
              >
                {message.replyTo && renderReplyPreview(message.replyTo, isOutgoing)}
                <Image source={{ uri: media.uri }} style={styles.image} contentFit="cover" cachePolicy="memory-disk" />
                <View style={styles.mediaHintBadge}>
                  <Ionicons name="expand-outline" size={12} color="#doc" />
                  <Text style={styles.mediaHintText}>Open</Text>
                </View>
                <View style={styles.metaRow}>
                  <Text style={[styles.meta, isOutgoing ? styles.metaRight : styles.metaLeft, { marginTop: 0 }]}>{time}</Text>
                  {renderDoubleCheckmarks(isOutgoing)}
                </View>
              </Pressable>
            );
          }

          if (media?.type === 'video') {
            return (
              <Pressable
                onPress={() => onPressMedia?.(media)}
                onLongPress={() => onLongPress?.(message)}
                style={({ pressed }) => [styles.bubble, isOutgoing ? styles.bubbleRightVideo : styles.bubbleLeftVideo, pressed && styles.mediaPressed]}
              >
                {message.replyTo && renderReplyPreview(message.replyTo, isOutgoing)}
                <LinearGradient
                  colors={isOutgoing ? ['#b6f6bf', '#70d98d'] : ['#162230', '#101822']}
                  style={styles.videoPreview}
                >
                  <View style={styles.videoIconCircle}>
                    <Ionicons name="play" size={18} color={isOutgoing ? '#0b1c10' : '#f1f6ff'} />
                  </View>
                  <ThemedText style={[styles.videoLabel, isOutgoing ? styles.videoLabelOutgoing : styles.videoLabelIncoming]}>
                    Video
                  </ThemedText>
                  <ThemedText style={[styles.videoSubLabel, isOutgoing ? styles.videoLabelOutgoing : styles.videoLabelIncoming]} numberOfLines={1}>
                    Tap to open fullscreen
                  </ThemedText>
                </LinearGradient>
                <View style={styles.metaRow}>
                  <Text style={[styles.meta, isOutgoing ? styles.metaRight : styles.metaLeft, { marginTop: 0 }]}>{time}</Text>
                  {renderDoubleCheckmarks(isOutgoing)}
                </View>
              </Pressable>
            );
          }

          if (isOutgoing) {
            return (
              <LinearGradient colors={["#9df0a2", "#5fd37e"]} style={[styles.bubble, styles.bubbleRight]}>
                {message.replyTo && renderReplyPreview(message.replyTo, true)}
                <ThemedText style={[styles.text, styles.textRight]}>{message.text}</ThemedText>
                <View style={styles.metaRow}>
                  <Text style={[styles.meta, styles.metaRight, { marginTop: 0 }]}>{time}</Text>
                  {renderDoubleCheckmarks(true)}
                </View>
              </LinearGradient>
            );
          }

          return (
            <View style={[styles.bubble, styles.bubbleLeft]}>
              {message.replyTo && renderReplyPreview(message.replyTo, false)}
              <ThemedText style={[styles.text, styles.textLeft]}>{message.text}</ThemedText>
              <Text style={[styles.meta, styles.metaLeft]}>{time}</Text>
            </View>
          );
        })()}

        {/* Reaction badge pill overlay */}
        {message.reactions && message.reactions.length > 0 && (
          <View style={[styles.reactionsContainer, isOutgoing ? styles.reactionsRight : styles.reactionsLeft]}>
            {Array.from(new Set(message.reactions.map(r => r.emoji))).slice(0, 3).map((emoji, idx) => (
              <Text key={idx} style={styles.reactionEmoji}>{emoji}</Text>
            ))}
            {message.reactions.length > 1 && (
              <Text style={styles.reactionCount}>{message.reactions.length}</Text>
            )}
          </View>
        )}
      </View>
    </Pressable>
  );

  return (
    <Swipeable
      ref={swipeableRef}
      renderLeftActions={onSwipeToReply ? renderLeftActions : undefined}
      onSwipeableWillOpen={handleSwipeOpen}
      friction={1.5}
      leftThreshold={50}
    >
      <Animated.View
        style={[
          styles.wrap,
          { opacity: entry, transform: [{ translateY: entry.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] },
          isOutgoing ? styles.rowRight : styles.rowLeft,
          highlighted && styles.highlightedWrap,
        ]}
      >
        {!isOutgoing && showAvatar ? (
          <View style={styles.avatarWrap}>
            <LocalAvatar id={message.senderId} size={36} />
          </View>
        ) : null}
        {bubbleContent}
      </Animated.View>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    marginVertical: 4,
    paddingHorizontal: 8,
  },
  highlightedWrap: {
    backgroundColor: 'rgba(157, 240, 162, 0.15)',
    borderRadius: 12,
  },
  rowLeft: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
  },
  rowRight: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
  },
  avatarWrap: {
    marginRight: 8,
  },
  bubbleWrap: {
    maxWidth: '82%',
  },
  bubbleWrapRight: {
    alignItems: 'flex-end',
  },
  bubbleWrapLeft: {
    alignItems: 'flex-start',
  },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
  },
  bubbleRight: {
    borderColor: '#6ec77a',
    backgroundColor: 'transparent',
  },
  bubbleLeft: {
    backgroundColor: '#0f1720',
    borderColor: '#263244',
  },
  bubbleLeftImage: {
    padding: 6,
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  bubbleRightImage: {
    padding: 6,
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  bubbleLeftVideo: {
    padding: 6,
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  bubbleRightVideo: {
    padding: 6,
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  image: {
    width: 220,
    height: 160,
    borderRadius: 12,
    backgroundColor: '#091218',
    overflow: 'hidden',
  },
  videoPreview: {
    width: 220,
    height: 160,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.24)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  videoLabel: {
    fontSize: 14,
    fontWeight: '800',
  },
  videoSubLabel: {
    marginTop: 2,
    fontSize: 11,
  },
  videoLabelOutgoing: {
    color: '#0a1f0f',
  },
  videoLabelIncoming: {
    color: '#edf4ff',
  },
  mediaHintBadge: {
    position: 'absolute',
    left: 12,
    top: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(0, 0, 0, 0.42)',
  },
  mediaHintText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  mediaPressed: {
    opacity: 0.86,
  },
  text: {
    fontSize: 14,
    lineHeight: 18,
  },
  textRight: {
    color: '#05210b',
  },
  textLeft: {
    color: '#e6eefb',
  },
  meta: {
    fontSize: 10,
    marginTop: 6,
    alignSelf: 'flex-end',
  },
  metaRight: {
    color: '#13321b',
  },
  metaLeft: {
    color: '#7f93ae',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    marginTop: 6,
  },
  replyIconContainer: {
    width: 50,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  replyPreview: {
    flexDirection: 'row',
    borderRadius: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.06)',
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 6,
    maxWidth: 220,
  },
  replyPreviewMine: {
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
  },
  replyPreviewOther: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  replyBorder: {
    width: 3,
    borderTopLeftRadius: 3,
    borderBottomLeftRadius: 3,
  },
  replyBorderMine: {
    backgroundColor: '#05210b',
  },
  replyBorderOther: {
    backgroundColor: '#9df0a2',
  },
  replyContent: {
    flex: 1,
    paddingLeft: 8,
  },
  replySender: {
    fontSize: 11,
    fontWeight: '700',
  },
  replySenderMine: {
    color: '#05210b',
  },
  replySenderOther: {
    color: '#9df0a2',
  },
  replyText: {
    fontSize: 10,
    marginTop: 1,
  },
  replyTextMine: {
    color: '#1e3823',
  },
  replyTextOther: {
    color: '#8da0bb',
  },
  reactionsContainer: {
    position: 'absolute',
    bottom: -10,
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderColor: '#e1e5eb',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 1.0,
    elevation: 2,
  },
  reactionsRight: {
    right: 10,
  },
  reactionsLeft: {
    left: 10,
  },
  reactionEmoji: {
    fontSize: 12,
    marginRight: 2,
  },
  reactionCount: {
    fontSize: 10,
    color: '#555555',
    fontWeight: '600',
    marginLeft: 2,
  },
});
