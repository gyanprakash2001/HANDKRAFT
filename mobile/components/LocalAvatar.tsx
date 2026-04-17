import React from 'react';
import { Text, StyleSheet, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

type Props = {
  id?: string | number;
  size?: number;
  style?: ViewStyle;
  emoji?: string;
};

const EMOJIS = [
  '🧶','🪡','🧵','🎨','🪵','🪚','🧰','🧸','🪴','🧺',
  '🔨','🖌️','🧩','📿','🧲','✂️','🔧','🪀','🧧','🌿',
  '🌼','🪶','🍃','🪡','🧪','🏺','🕯️','📦','🧯','🪵'
];

const PALETTES = [
  ['#FFD6A5', '#FDFFB6'],
  ['#9DE0FF', '#C3FBD8'],
  ['#FAD2E1', '#E1F0FF'],
  ['#E2F0CB', '#C6E2FF'],
  ['#FDE2A1', '#FFD1DC'],
  ['#E6E6FA', '#FFF0F5'],
  ['#FFE4B5', '#E0FFFE'],
  ['#FCE1FF', '#EAF6FF'],
  ['#DFF7DF', '#FFF3D9'],
  ['#F0F7FF', '#E7FFE6'],
];

function indexFromId(id?: string | number) {
  if (typeof id === 'number') return id % EMOJIS.length;
  if (typeof id === 'string') {
    const m = id.match(/(\d+)/);
    if (m) return (Number(m[1]) - 1) % EMOJIS.length;
  }
  return 0;
}

export default function LocalAvatar({ id, size = 44, style, emoji }: Props) {
  const idx = indexFromId(id);
  const pickEmoji = emoji || EMOJIS[idx % EMOJIS.length] || '🎨';
  const palette = PALETTES[idx % PALETTES.length];

  return (
    <LinearGradient
      colors={palette}
      start={[0, 0]}
      end={[1, 1]}
      style={[{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }, style]}
    >
      <Text style={[styles.emoji, { fontSize: Math.round(size * 0.55) }]}>{pickEmoji}</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  emoji: {
    lineHeight: undefined,
  },
});
