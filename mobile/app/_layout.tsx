import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useNavigationContainerRef } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Sentry from '@sentry/react-native';
import { useEffect } from 'react';

import { CartNotificationProvider } from '@/contexts/cart-notification-context';
import { useColorScheme } from '@/hooks/use-color-scheme';

// Sentry navigation integration for automatic screen tracking
const routingInstrumentation = Sentry.reactNavigationIntegration({
  enableTimeToInitialDisplay: true,
});

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN || '',
  integrations: [routingInstrumentation],
  // Performance Monitoring — capture 20% of transactions in production
  tracesSampleRate: __DEV__ ? 1.0 : 0.2,
  // Disable Sentry in dev to avoid noise (set to true to test locally)
  enabled: !__DEV__,
  debug: __DEV__,
  environment: __DEV__ ? 'development' : 'production',
});

export const unstable_settings = {
  initialRouteName: 'index',
};

function RootLayout() {
  const colorScheme = useColorScheme();
  const ref = useNavigationContainerRef();

  useEffect(() => {
    if (ref?.current) {
      routingInstrumentation.registerNavigationContainer(ref);
    }
  }, [ref]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <CartNotificationProvider>
            <Stack
              screenOptions={{
                headerShown: false,
                animation: 'none',
                contentStyle: { backgroundColor: '#0a0a0a' },
              }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="onboarding" />
              <Stack.Screen name="login" />
              <Stack.Screen name="signup" />
              <Stack.Screen name="feed" />
              <Stack.Screen name="daily-picks" />
              <Stack.Screen name="explore" />
              <Stack.Screen name="messages" />
              <Stack.Screen name="messages/[id]" />
              <Stack.Screen name="upload" />
              <Stack.Screen name="profile" />
              <Stack.Screen name="seller-analytics" />
              <Stack.Screen name="seller-payouts" />
              <Stack.Screen name="admin-payouts" />
              <Stack.Screen name="seller-posts" />
              <Stack.Screen name="edit-seller-profile" />
              <Stack.Screen name="seller-orders/[stage]" />
              <Stack.Screen name="seller/[id]" />
              <Stack.Screen name="product/[id]" />
              <Stack.Screen name="seller-product/[id]" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="dev/api-switcher" />
              <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
            </Stack>
          </CartNotificationProvider>
          <StatusBar style="auto" />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(RootLayout);
