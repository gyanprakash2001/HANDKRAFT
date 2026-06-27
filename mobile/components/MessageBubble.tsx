import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { PanGestureHandler, State, PanGestureHandlerStateChangeEvent } from 'react-native-gesture-handler';
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
  highlighted,
}: {
  message: ChatMessage;
  isOutgoing: boolean;
  showAvatar?: boolean;
  onPressMedia?: (payload: { uri: string; type: 'image' | 'video' }) => void;
  onSwipeToReply?: (message: ChatMessage) => void;
  onPressReplyPreview?: (replyToId: string) => void;
  highlighted?: boolean;
}) {
  const entry = useMemo(() => new Animated.Value(0), []);
  const media = useMemo(() => getMessageMedia(message), [message]);

  const dragX = useRef(new Animated.Value(0)).current;
  const hasTriggeredHaptic = useRef(false);

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

  const onGestureEvent = Animated.event(
    [{ nativeEvent: { translationX: dragX } }],
    {
      useNativeDriver: true,
      listener: (event: any) => {
        const tx = event.nativeEvent.translationX;
        if (tx < 0) {
          dragX.setValue(0);
          return;
        }
        if (tx > 90) {
          dragX.setValue(90);
        }
        if (tx >= 60 && !hasTriggeredHaptic.current) {
          hasTriggeredHaptic.current = true;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        } else if (tx < 60 && hasTriggeredHaptic.current) {
          hasTriggeredHaptic.current = false;
        }
      }
    }
  );

  const onHandlerStateChange = (event: PanGestureHandlerStateChangeEvent) => {
    const { state, translationX } = event.nativeEvent;
    if (state === State.END || state === State.CANCELLED || state === State.FAILED) {
      if (translationX >= 60 && state === State.END) {
        onSwipeToReply?.(message);
      }
      hasTriggeredHaptic.current = false;
      Animated.spring(dragX, {
        toValue: 0,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }).start();
    }
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
    return (
      <Ionicons
        name="checkmark-done"
        size={14}
        color="#13321b"
        style={{ marginLeft: 4, alignSelf: 'flex-end' }}
      />
    );
  };

  return (
    <PanGestureHandler
      activeOffsetX={[-10, 10]}
      failOffsetY={[-10, 10]}
      onGestureEvent={onGestureEvent}
      onHandlerStateChange={onHandlerStateChange}
      enabled={!!onSwipeToReply}
    >
      <Animated.View
        style={[
          styles.wrap,
          { opacity: entry, transform: [{ translateY: entry.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] },
          isOutgoing ? styles.rowRight : styles.rowLeft,
          highlighted && styles.highlightedWrap,
        ]}
      >
        {onSwipeToReply && (
          <Animated.View style={[styles.replyIconContainer, {
            opacity: dragX.interpolate({ inputRange: [0, 60], outputRange: [0, 1], extrapolate: 'clamp' }),
            transform: [{
              scale: dragX.interpolate({ inputRange: [0, 60], outputRange: [0.6, 1], extrapolate: 'clamp' })
            }, {
              translateX: dragX.interpolate({ inputRange: [0, 60], outputRange: [-25, 0], extrapolate: 'clamp' })
            }]
          }]}>
            <Ionicons name="arrow-undo-outline" size={20} color="#9df0a2" />
          </Animated.View>
        )}

        <Animated.View style={[{ flex: 1, flexDirection: 'row', justifyContent: isOutgoing ? 'flex-end' : 'flex-start', transform: [{ translateX: dragX }] }]}>
          {!isOutgoing && showAvatar ? (
            <View style={styles.avatarWrap}>
              <LocalAvatar id={message.senderId} size={36} />
            </View>
          ) : null}

          <View style={[styles.bubbleWrap, isOutgoing ? styles.bubbleWrapRight : styles.bubbleWrapLeft]}>
            {(() => {
              if (media?.type === 'image') {
                return (
                  <Pressable
                    onPress={() => onPressMedia?.(media)}
                    style={({ pressed }) => [styles.bubble, isOutgoing ? styles.bubbleRightImage : styles.bubbleLeftImage, pressed && styles.mediaPressed]}
                  >
                    {message.replyTo && renderReplyPreview(message.replyTo, isOutgoing)}
                    <Image source={{ uri: media.uri }} style={styles.image} contentFit="cover" cachePolicy="memory-disk" />
                    <View style={styles.mediaHintBadge}>
                      <Ionicons name="expand-outline" size={12} color="#fff" />
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
          </View>
        </Animated.View>
      </Animated.View>
    </PanGestureHandler>
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
    position: 'absolute',
    left: -35,
    top: '35%',
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 0,
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
});
