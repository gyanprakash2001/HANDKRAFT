import { useState, useRef } from 'react';
import { StyleSheet, View, ScrollView, Pressable, Dimensions, NativeScrollEvent, NativeSyntheticEvent, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';

const SCREEN_WIDTH = Dimensions.get('window').width;

const SLIDES = [
  {
    isLogo: true,
    title: 'Discover Authentic Craftsmanship',
    description: 'Explore rare and unique goods made with love by handpicked local artisans across the country.',
    color: '#ffffff',
  },
  {
    icon: 'chatbubbles-outline',
    title: 'Direct Creator Connection',
    description: 'Chat directly with the creators to customize your items, verify materials, and buy with confidence.',
    color: '#9df0a2',
  },
  {
    icon: 'heart-outline',
    title: 'Support and Give Back',
    description: 'We credit ₹1 from every platform fee directly to artisan welfare associations. Every buy supports a family.',
    color: '#f8d29d',
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<ScrollView | null>(null);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const xOffset = event.nativeEvent.contentOffset.x;
    const index = Math.round(xOffset / SCREEN_WIDTH);
    if (index !== activeIndex) {
      setActiveIndex(index);
      Haptics.selectionAsync().catch(() => {});
    }
  };

  const handleNext = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (activeIndex < SLIDES.length - 1) {
      scrollRef.current?.scrollTo({
        x: (activeIndex + 1) * SCREEN_WIDTH,
        animated: true,
      });
    } else {
      await finishOnboarding();
    }
  };

  const handleSkip = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    await finishOnboarding();
  };

  const finishOnboarding = async () => {
    try {
      await AsyncStorage.setItem('HANDKRAFT_SEEN_ONBOARDING', 'true');
      router.replace('/');
    } catch (err) {
      router.replace('/');
    }
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.logoWrap}>
          <Image source={require('../assets/feed_logo_trim_alpha.png')} style={{ width: 160, height: 40 }} resizeMode="contain" />
        </View>
        {activeIndex < SLIDES.length - 1 && (
          <Pressable onPress={handleSkip} style={styles.skipBtn}>
            <ThemedText style={styles.skipText}>Skip</ThemedText>
          </Pressable>
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        style={styles.slidesScroller}
      >
        {SLIDES.map((slide, index) => (
          <View key={index} style={styles.slide}>
            <View style={[styles.iconContainer, { borderColor: slide.color }]}>
              {slide.isLogo ? (
                <Image source={require('../assets/handkraft_logo_trim.png')} style={{ width: 110, height: 110 }} resizeMode="contain" />
              ) : (
                <Ionicons name={slide.icon as any} size={64} color={slide.color} />
              )}
            </View>
            <ThemedText style={styles.slideTitle}>{slide.title}</ThemedText>
            <ThemedText style={styles.slideDescription}>{slide.description}</ThemedText>
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        {/* Pagination dots */}
        <View style={styles.dotsRow}>
          {SLIDES.map((_, index) => (
            <View
              key={index}
              style={[
                styles.dot,
                activeIndex === index && styles.dotActive,
                activeIndex === index && { backgroundColor: SLIDES[index].color },
              ]}
            />
          ))}
        </View>

        {/* Action Button */}
        <Pressable onPress={handleNext} style={[styles.nextBtn, { backgroundColor: SLIDES[activeIndex].color }]}>
          <ThemedText style={styles.nextBtnText}>
            {activeIndex === SLIDES.length - 1 ? 'Start Exploring' : 'Continue'}
          </ThemedText>
          <Ionicons
            name={activeIndex === SLIDES.length - 1 ? 'arrow-forward' : 'chevron-forward'}
            size={18}
            color="#0a0a0a"
          />
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingLeft: 12,
    paddingRight: 24,
    paddingTop: 60,
    height: 110,
  },
  logoWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 1.5,
  },
  skipBtn: {
    padding: 8,
  },
  skipText: {
    fontSize: 14,
    color: '#8ea1b6',
    fontWeight: '600',
  },
  slidesScroller: {
    flex: 1,
  },
  slide: {
    width: SCREEN_WIDTH,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 36,
  },
  iconContainer: {
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000000',
    marginBottom: 40,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  slideTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 32,
  },
  slideDescription: {
    fontSize: 14,
    color: '#8ea1b6',
    textAlign: 'center',
    lineHeight: 22,
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 60,
    gap: 30,
    alignItems: 'center',
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#3e4a58',
  },
  dotActive: {
    width: 24,
    borderRadius: 99,
  },
  nextBtn: {
    width: '100%',
    height: 52,
    borderRadius: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  nextBtnText: {
    color: '#0a0a0a',
    fontSize: 15,
    fontWeight: '800',
  },
});
