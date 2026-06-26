import { Platform } from 'react-native';
import { registerPushToken } from './api';

let Notifications: any = null;
let hasNativeModule = false;

try {
  // Use require dynamically inside try-catch to avoid bundle-time compile errors
  // and handle devices/builds that don't have the native module compiled yet
  Notifications = require('expo-notifications');
  if (Notifications && typeof Notifications.getPermissionsAsync === 'function') {
    hasNativeModule = true;
  }
} catch (e) {
  console.warn('expo-notifications native module is not compiled in this client build:', e);
}

// Configure notification behavior when app is foregrounded (if native module is present)
if (hasNativeModule && Notifications) {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch (err) {
    console.warn('Failed to configure notification handler:', err);
    hasNativeModule = false;
  }
}

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (Platform.OS === 'web' || !hasNativeModule || !Notifications) {
    return null;
  }

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.warn('Failed to get push token for push notification!');
      return null;
    }

    const token = (await Notifications.getExpoPushTokenAsync()).data;
    if (token) {
      try {
        await registerPushToken(token);
      } catch (err: any) {
        console.warn('Failed to upload push token to backend:', err?.message);
      }
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
      });
    }

    return token;
  } catch (error) {
    console.warn('Error setting up push notifications:', error);
    return null;
  }
}
