import React, { useEffect, useMemo } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
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
    lower.startsWith('data:video/')
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
}: {
  message: ChatMessage;
  isOutgoing: boolean;
  showAvatar?: boolean;
  onPressMedia?: (payload: { uri: string; type: 'image' | 'video' }) => void;
}) {
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

  return (
    <Animated.View
      style={[
        styles.wrap,
        { opacity: entry, transform: [{ translateY: entry.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] },
        isOutgoing ? styles.rowRight : styles.rowLeft,
      ]}
    >
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
                <Image source={{ uri: media.uri }} style={styles.image} contentFit="cover" cachePolicy="memory-disk" />
                <View style={styles.mediaHintBadge}>
                  <Ionicons name="expand-outline" size={12} color="#fff" />
                  <Text style={styles.mediaHintText}>Open</Text>
                </View>
                <Text style={[styles.meta, isOutgoing ? styles.metaRight : styles.metaLeft]}>{time}</Text>
              </Pressable>
            );
          }

          if (media?.type === 'video') {
            return (
              <Pressable
                onPress={() => onPressMedia?.(media)}
                style={({ pressed }) => [styles.bubble, isOutgoing ? styles.bubbleRightVideo : styles.bubbleLeftVideo, pressed && styles.mediaPressed]}
              >
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
                <Text style={[styles.meta, isOutgoing ? styles.metaRight : styles.metaLeft]}>{time}</Text>
              </Pressable>
            );
          }

          if (isOutgoing) {
            return (
              <LinearGradient colors={["#9df0a2", "#5fd37e"]} style={[styles.bubble, styles.bubbleRight]}>
                <ThemedText style={[styles.text, styles.textRight]}>{message.text}</ThemedText>
                <Text style={[styles.meta, styles.metaRight]}>{time}</Text>
              </LinearGradient>
            );
          }

          return (
            <View style={[styles.bubble, styles.bubbleLeft]}>
              <ThemedText style={[styles.text, styles.textLeft]}>{message.text}</ThemedText>
              <Text style={[styles.meta, styles.metaLeft]}>{time}</Text>
            </View>
          );
        })()}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    marginVertical: 6,
    paddingHorizontal: 8,
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
});
