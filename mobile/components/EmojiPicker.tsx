import React from 'react';
import { StyleSheet, View, Text, Pressable, Modal, TouchableWithoutFeedback } from 'react-native';

interface EmojiPickerProps {
  visible: boolean;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

const EMOJIS = ['❤️', '👍', '😂', '😮', '😢', '🙏'];

export default function EmojiPicker({ visible, onSelect, onClose }: EmojiPickerProps) {
  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={styles.pickerContainer}>
              {EMOJIS.map((emoji) => (
                <Pressable
                  key={emoji}
                  onPress={() => {
                    onSelect(emoji);
                    onClose();
                  }}
                  style={({ pressed }) => [
                    styles.emojiBtn,
                    pressed && styles.pressed
                  ]}
                >
                  <Text style={styles.emojiText}>{emoji}</Text>
                </Pressable>
              ))}
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
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickerContainer: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderRadius: 30,
    paddingHorizontal: 15,
    paddingVertical: 10,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    alignItems: 'center',
  },
  emojiBtn: {
    paddingHorizontal: 8,
    transform: [{ scale: 1 }],
  },
  pressed: {
    transform: [{ scale: 1.3 }],
  },
  emojiText: {
    fontSize: 28,
  },
});
