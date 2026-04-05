import { View, StyleSheet, Image } from 'react-native';
import { Link } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';

// hero image placed in assets folder
const logo = require('../assets/handkraft_logo.png');

export default function HomeScreen() {
  return (
    <ThemedView style={styles.container}>
      <LinearGradient
        colors={['#1a1a1a', '#050505']}
        style={styles.card}
        start={[0, 0]}
        end={[1, 1]}
      >
        <Image source={logo} style={styles.logo} resizeMode="contain" />
        <ThemedText type="title" style={styles.title}>
          Welcome to Handkraft
        </ThemedText>
        <ThemedText style={styles.subtitle}>Discover beautiful handmade products from real artisans.</ThemedText>
        <View style={styles.links}>
          <Link href="/login" style={[styles.button, styles.primaryButton]}>
            <ThemedText style={styles.buttonText}>
              Login
            </ThemedText>
          </Link>
          <Link href="/signup" style={[styles.button, styles.secondaryButton]}>
            <ThemedText style={styles.secondaryButtonText}>
              Sign Up
            </ThemedText>
          </Link>
          {__DEV__ ? (
            <Link href="/dev/api-switcher" style={[styles.button, styles.devButton]}>
              <ThemedText style={styles.devButtonText}>Dev</ThemedText>
            </Link>
          ) : null}
        </View>
      </LinearGradient>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#000',
  },
  card: {
    width: '92%',
    padding: 28,
    borderRadius: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  logo: {
    width: 120,
    height: 120,
    marginBottom: 20,
  },
  title: {
    fontFamily: 'sans-serif-medium',
    fontSize: 30,
    color: '#fff',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    color: '#c4c4c4',
    textAlign: 'center',
    marginBottom: 24,
    fontSize: 14,
    lineHeight: 20,
  },
  links: {
    width: '100%',
    alignItems: 'center',
  },
  button: {
    width: '100%',
    paddingVertical: 15,
    marginVertical: 8,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: '#f1f1f1',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#666',
    backgroundColor: 'transparent',
  },
  buttonText: {
    color: '#111',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
    width: '100%',
    textAlign: 'center',
  },
  secondaryButtonText: {
    color: '#f5f5f5',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
    width: '100%',
    textAlign: 'center',
  },
  devButton: {
    backgroundColor: '#222',
    borderWidth: 1,
    borderColor: '#444',
  },
  devButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
});