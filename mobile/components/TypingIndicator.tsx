import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet } from 'react-native';

export default function TypingIndicator({ size = 8 }: { size?: number }) {
  const a = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.timing(a, { toValue: 0, duration: 350, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [a]);

  const dotStyle = (delay: number) => ({
    opacity: a.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1], extrapolate: 'clamp' }),
    transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }],
    marginHorizontal: 3,
  });

  return (
    <View style={styles.wrap}>
      <Animated.View style={[styles.dot, dotStyle(0), { width: size, height: size, borderRadius: size / 2 }]} />
      <Animated.View style={[styles.dot, dotStyle(120), { width: size, height: size, borderRadius: size / 2 }]} />
      <Animated.View style={[styles.dot, dotStyle(240), { width: size, height: size, borderRadius: size / 2 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  dot: {
    backgroundColor: '#7f93ae',
  },
});
