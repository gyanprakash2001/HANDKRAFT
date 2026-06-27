import React from 'react';
import { StyleSheet, View, Pressable, Modal, TouchableWithoutFeedback, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ThemedText } from './themed-text';

interface ShareMediaModalProps {
  visible: boolean;
  onPickPhoto: () => void;
  onPickVideo: () => void;
  onClose: () => void;
}

export default function ShareMediaModal({
  visible,
  onPickPhoto,
  onPickVideo,
  onClose,
}: ShareMediaModalProps) {
  if (!visible) return null;

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
              <ThemedText style={styles.sheetTitle}>Share Media</ThemedText>
              <ThemedText style={styles.sheetSubtitle}>Choose a media type to share</ThemedText>

              <View style={styles.btnRow}>
                <Pressable
                  style={({ pressed }) => [styles.mediaBtn, pressed && styles.btnPressed]}
                  onPress={() => handleAction(onPickPhoto)}
                >
                  <View style={[styles.iconContainer, styles.photoIconColor]}>
                    <Ionicons name="image" size={26} color="#fff" />
                  </View>
                  <ThemedText style={styles.btnText}>Photo</ThemedText>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [styles.mediaBtn, pressed && styles.btnPressed]}
                  onPress={() => handleAction(onPickVideo)}
                >
                  <View style={[styles.iconContainer, styles.videoIconColor]}>
                    <Ionicons name="videocam" size={26} color="#fff" />
                  </View>
                  <ThemedText style={styles.btnText}>Video</ThemedText>
                </Pressable>
              </View>

              <Pressable
                style={({ pressed }) => [styles.cancelBtn, pressed && styles.cancelPressed]}
                onPress={onClose}
              >
                <ThemedText style={styles.cancelBtnText}>Cancel</ThemedText>
              </Pressable>
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
    paddingTop: 20,
    paddingBottom: Platform.OS === 'ios' ? 38 : 24,
    paddingHorizontal: 22,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 20,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ebf2ff',
    letterSpacing: 0.2,
  },
  sheetSubtitle: {
    fontSize: 13,
    color: '#8da0bb',
    marginTop: 4,
    marginBottom: 24,
  },
  btnRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  mediaBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: 80,
  },
  btnPressed: {
    transform: [{ scale: 0.94 }],
    opacity: 0.85,
  },
  iconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  photoIconColor: {
    backgroundColor: '#2bcf6a', // Whatsapp green
  },
  videoIconColor: {
    backgroundColor: '#2b97ff', // Whatsapp blue
  },
  btnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ebf2ff',
  },
  cancelBtn: {
    width: '100%',
    height: 46,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  cancelPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ff8a8a',
  },
});
