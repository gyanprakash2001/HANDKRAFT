import React, { useEffect, useMemo } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { ThemedText } from '@/components/themed-text';
import LocalAvatar from '@/components/LocalAvatar';
import type { ChatMessage } from '@/utils/api';

export default function MessageBubble({
  message,
  isOutgoing,
  showAvatar,
}: {
  message: ChatMessage;
  isOutgoing: boolean;
  showAvatar?: boolean;
}) {
  const entry = useMemo(() => new Animated.Value(0), []);

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
    } catch (e) {
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
          const isImage = Boolean(message.isImage || String(message.text || '').startsWith('data:') || String(message.text || '').startsWith('file:') || /uploads\/messages\//.test(String(message.text || '')));
          if (isImage) {
            return (
              <View style={[styles.bubble, isOutgoing ? styles.bubbleRightImage : styles.bubbleLeftImage]}>
                <Image source={{ uri: message.text }} style={styles.image} contentFit="cover" />
                <Text style={[styles.meta, isOutgoing ? styles.metaRight : styles.metaLeft]}>{time}</Text>
              </View>
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
  image: {
    width: 220,
    height: 160,
    borderRadius: 12,
    backgroundColor: '#091218',
    overflow: 'hidden',
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
