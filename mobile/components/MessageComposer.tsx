import React from 'react';
import { View, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

export default function MessageComposer({
  value,
  onChangeText,
  onSend,
  sending,
  onPickImage,
}: {
  value: string;
  onChangeText: (t: string) => void;
  onSend: () => void;
  sending?: boolean;
  onPickImage?: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <Pressable style={styles.leftIcon} onPress={() => onPickImage && onPickImage()}>
        <Ionicons name="image-outline" size={20} color="#9fb3c9" />
      </Pressable>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="Write a message..."
        placeholderTextColor="#7d8da8"
        style={styles.input}
        multiline
      />
      <Pressable onPress={onSend} disabled={sending} style={styles.sendBtnWrapper}>
        <LinearGradient colors={["#9df0a2","#5fd37e"]} style={styles.sendBtn}>
          {sending ? <ActivityIndicator color="#07210a" /> : <Ionicons name="send" size={18} color="#07210a" />}
        </LinearGradient>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
    backgroundColor: 'transparent',
  },
  leftIcon: {
    padding: 8,
    borderRadius: 8,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 110,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#0f1720',
    color: '#fff',
  },
  sendBtnWrapper: {
    width: 44,
    height: 44,
  },
  sendBtn: {
    flex: 1,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
