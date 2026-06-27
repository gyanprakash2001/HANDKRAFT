import React from 'react';
import { StyleSheet, View, Text, Pressable, Modal, TouchableWithoutFeedback, Clipboard } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ThemedText } from './themed-text';

interface MessageOptionsModalProps {
  visible: boolean;
  message: { id: string; text: string } | null;
  isPinned: boolean;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onPin: () => void;
  onClose: () => void;
}

const EMOJIS = ['❤️', '👍', '😂', '😮', '😢', '🙏'];

export default function MessageOptionsModal({
  visible,
  message,
  isPinned,
  onReact,
  onReply,
  onPin,
  onClose,
}: MessageOptionsModalProps) {
  if (!visible || !message) return null;

  const handleEmojiSelect = (emoji: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onReact(emoji);
    onClose();
  };

  const handleCopy = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // Ignore media URIs when copying message text
    const textToCopy = message.text.startsWith('http') || message.text.startsWith('data:') ? '[Media file]' : message.text;
    Clipboard.setString(textToCopy);
    onClose();
  };

  const handleAction = (callback: () => void) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    callback();
    onClose();
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={styles.sheetContainer}>
              {/* Emojis row */}
              <View style={styles.emojiRow}>
                {EMOJIS.map((emoji) => (
                  <Pressable
                    key={emoji}
                    onPress={() => handleEmojiSelect(emoji)}
                    style={({ pressed }) => [
                      styles.emojiBtn,
                      pressed && styles.emojiPressed
                    ]}
                  >
                    <Text style={styles.emojiText}>{emoji}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.separator} />

              {/* Action List */}
              <View style={styles.actionList}>
                <Pressable
                  style={({ pressed }) => [styles.actionItem, pressed && styles.actionPressed]}
                  onPress={() => handleAction(onReply)}
                >
                  <Ionicons name="arrow-undo-outline" size={20} color="#9df0a2" />
                  <ThemedText style={styles.actionText}>Reply</ThemedText>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [styles.actionItem, pressed && styles.actionPressed]}
                  onPress={() => handleAction(onPin)}
                >
                  <Ionicons name="pin-outline" size={20} color="#8da0bb" />
                  <ThemedText style={styles.actionText}>
                    {isPinned ? 'Unpin Message' : 'Pin Message'}
                  </ThemedText>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [styles.actionItem, pressed && styles.actionPressed]}
                  onPress={handleCopy}
                >
                  <Ionicons name="copy-outline" size={20} color="#ebf2ff" />
                  <ThemedText style={styles.actionText}>Copy Text</ThemedText>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [styles.actionItem, pressed && styles.actionPressed, styles.cancelItem]}
                  onPress={onClose}
                >
                  <Ionicons name="close-outline" size={20} color="#ff8a8a" />
                  <ThemedText style={[styles.actionText, styles.cancelText]}>Cancel</ThemedText>
                </Pressable>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sheetContainer: {
    width: '100%',
    backgroundColor: '#0c121c',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: '#1f2b38',
    paddingTop: 18,
    paddingBottom: Platform.OS === 'ios' ? 38 : 24,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 20,
  },
  emojiRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 10,
    marginBottom: 8,
  },
  emojiBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(30, 43, 56, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  emojiPressed: {
    transform: [{ scale: 1.35 }],
    backgroundColor: 'rgba(157, 240, 162, 0.25)',
  },
  emojiText: {
    fontSize: 26,
  },
  separator: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginVertical: 10,
  },
  actionList: {
    gap: 4,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    gap: 12,
  },
  actionPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  actionText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ebf2ff',
  },
  cancelItem: {
    marginTop: 6,
  },
  cancelText: {
    color: '#ff8a8a',
  },
});
