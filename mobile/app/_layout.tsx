import 'react-native-gesture-handler';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { CartNotificationProvider } from '@/contexts/cart-notification-context';
import { useColorScheme } from '@/hooks/use-color-scheme';

export const unstable_settings = {
  initialRouteName: 'index',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <CartNotificationProvider>
          <Stack
            screenOptions={{
              headerShown: false,
              animation: 'none',
              contentStyle: { backgroundColor: '#0a0a0a' },
            }}>
            <Stack.Screen name="index" />
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
            <Stack.Screen name="seller-posts" />
            <Stack.Screen name="seller-orders/[stage]" />
            <Stack.Screen name="product/[id]" />
            <Stack.Screen name="seller-product/[id]" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="dev/api-switcher" />
            <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
          </Stack>
        </CartNotificationProvider>
        <StatusBar style="auto" />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
