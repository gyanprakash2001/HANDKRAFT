import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, TextInput, Button, View, Alert, Platform } from 'react-native';
import { Link, useRouter } from 'expo-router';
import Constants from 'expo-constants';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { registerUser, signInWithGoogle } from '@/utils/api';
import { saveToken } from '@/utils/auth';
import currentUser from '@/utils/currentUser';
import { getNativeGoogleErrorMessage, signInWithGoogleNative } from '@/utils/google-native-auth';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';

WebBrowser.maybeCompleteAuthSession();

export default function SignupScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const router = useRouter();
  const isAndroid = Platform.OS === 'android';

  const appOwnership = String((Constants as any)?.appOwnership || '').toLowerCase();
  const useProxyForExpo = appOwnership === 'expo';

  const [request, response, promptAsync] = Google.useAuthRequest({
    expoClientId: process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    scopes: ['openid', 'profile', 'email'],
    selectAccount: true,
  });

  const completeGoogleAuth = useCallback(async (idToken?: string, accessToken?: string) => {
    const { token, user } = await signInWithGoogle(idToken, accessToken);
    await saveToken(token);
    if (user) currentUser.setProfile(user);

    const hasPhoneNumber = Boolean(String(user?.phoneNumber || '').trim());
    if (!hasPhoneNumber) {
      Alert.alert(
        'Add phone number',
        'Account created successfully. We could not fetch your phone from Google. Add it now.',
        [
          { text: 'Later', style: 'cancel', onPress: () => router.replace('/feed') },
          { text: 'Add now', onPress: () => router.replace('/edit-profile') },
        ]
      );
      return;
    }

    Alert.alert('Success', 'Signed up with Google');
    router.replace('/feed');
  }, [router]);

  const handleSubmit = async () => {
    try {
      const { token, user } = await registerUser(name, email, password);
      await saveToken(token);
      if (user) currentUser.setProfile(user);
      Alert.alert('Success', 'Account created');
      router.replace('/feed');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Signup failed');
    }
  };

  useEffect(() => {
    if (response?.type !== 'success') return;

    (async () => {
      try {
        const idToken =
          response.authentication?.idToken ||
          (typeof (response as any)?.params?.id_token === 'string' ? (response as any).params.id_token : null);
        const accessToken =
          response.authentication?.accessToken ||
          (typeof (response as any)?.params?.access_token === 'string' ? (response as any).params.access_token : null);

        if (!idToken && !accessToken) throw new Error('No id/access token returned from Google');
        await completeGoogleAuth(idToken || undefined, accessToken || undefined);
      } catch (err: any) {
        Alert.alert('Google Sign-up Error', err.message || 'Failed to sign up with Google');
      }
    })();
  }, [response, completeGoogleAuth]);

  const handleGoogleSignUp = async () => {
    if (!request) {
      Alert.alert('Google Sign-up Error', 'Google sign-up is initializing. Please try again.');
      return;
    }

    let nativeError: unknown = null;

    if (isAndroid && !useProxyForExpo) {
      try {
        console.log('Trying native Google sign-up on Android app build');
        const { idToken, accessToken } = await signInWithGoogleNative();
        await completeGoogleAuth(idToken, accessToken);
        return;
      } catch (err) {
        nativeError = err;
        console.warn('Native Google sign-up failed, falling back to AuthSession', err);
      }
    }

    // Debug: log OAuth request parameters so Metro shows them when sign-up is initiated
    try {
      console.log('Google Sign-up Request Initiating', {
        expoClientId: process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID,
        iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
        androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
        webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
        redirectUri: request.redirectUri,
        useProxyForExpo,
        appOwnership,
        requestExists: Boolean(request),
      });

      // Start the appropriate flow: use Expo proxy only when running in Expo Go.
      console.log(`Starting Google sign-up (useProxy=${useProxyForExpo})`);
      console.log('Auth request object:', request);
      await promptAsync({ useProxy: useProxyForExpo });
    } catch (firstError) {
      console.warn('Google AuthSession sign-up failed', firstError);

      const authSessionMessage = firstError instanceof Error ? firstError.message : 'Failed to start Google sign-up.';
      const nativeMessage = nativeError ? getNativeGoogleErrorMessage(nativeError) : '';
      const message = nativeMessage
        ? `${nativeMessage}\n\nAuthSession fallback error: ${authSessionMessage}`
        : authSessionMessage;
      Alert.alert('Google Sign-up Error', message);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title">Sign Up</ThemedText>
      <TextInput
        style={styles.input}
        placeholder="Name"
        placeholderTextColor="#b3b3b3"
        value={name}
        onChangeText={setName}
      />
      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor="#b3b3b3"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor="#b3b3b3"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <View style={styles.buttonContainer}>
        <Button title="Sign Up" onPress={handleSubmit} />
        <View style={styles.buttonSpacer} />
        <Button title="Sign up with Google" onPress={handleGoogleSignUp} disabled={!request} />
      </View>
      <Link href="/login" style={styles.link}>
        <ThemedText type="link">Already have an account? Log in</ThemedText>
      </Link>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
  },
  input: {
    height: 48,
    borderColor: '#555',
    borderWidth: 1,
    borderRadius: 4,
    marginVertical: 8,
    paddingHorizontal: 10,
    color: '#fff',
    backgroundColor: '#111',
  },
  buttonContainer: {
    marginTop: 16,
  },
  buttonSpacer: {
    height: 12,
  },
  link: {
    marginTop: 20,
    alignItems: 'center',
  },
});