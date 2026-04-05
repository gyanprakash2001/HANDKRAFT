import { useState, useEffect } from 'react';
import { StyleSheet, TextInput, Button, View, Alert, Platform } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { makeRedirectUri } from 'expo-auth-session';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { loginUser, signInWithGoogle } from '@/utils/api';
import { saveToken } from '@/utils/auth';
import currentUser from '@/utils/currentUser';
import { getNativeGoogleErrorMessage, signInWithGoogleNative } from '@/utils/google-native-auth';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const router = useRouter();
  const isAndroid = Platform.OS === 'android';

  const completeGoogleAuth = async (idToken?: string, accessToken?: string) => {
    const { token, user } = await signInWithGoogle(idToken, accessToken);
    await saveToken(token);
    if (user) currentUser.setProfile(user);

    const hasPhoneNumber = Boolean(String(user?.phoneNumber || '').trim());
    if (!hasPhoneNumber) {
      Alert.alert(
        'Add phone number',
        'Signed in successfully. We could not fetch your phone from Google. Add it now.',
        [
          { text: 'Later', style: 'cancel', onPress: () => router.replace('/feed') },
          { text: 'Add now', onPress: () => router.replace('/edit-profile') },
        ]
      );
      return;
    }

    Alert.alert('Success', 'Logged in with Google');
    router.replace('/feed');
  };

  const handleSubmit = async () => {
    try {
      const { token } = await loginUser(email, password);
      await saveToken(token);
      Alert.alert('Success', 'Logged in');
      router.replace('/feed');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Login failed');
    }
  };

  const redirectUri = makeRedirectUri({
    scheme: 'handkraft',
    path: 'oauthredirect',
  });

  const handleAndroidGoogleSignIn = async () => {
    try {
      const { idToken, accessToken } = await signInWithGoogleNative();
      await completeGoogleAuth(idToken, accessToken);
    } catch (err) {
      Alert.alert('Google Sign-in Error', getNativeGoogleErrorMessage(err));
    }
  };

  // Keep expo-auth-session only for non-Android platforms.
  function GoogleSignInButton() {
    const [request, response, promptAsync] = Google.useAuthRequest({
      expoClientId: process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID,
      iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
      webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
      scopes: ['openid', 'profile', 'email', 'https://www.googleapis.com/auth/user.phonenumbers.read'],
      redirectUri,
    });

    useEffect(() => {
      if (response?.type === 'success') {
        (async () => {
          try {
            const idToken =
              response.authentication?.idToken ||
              (typeof (response as any)?.params?.id_token === 'string' ? (response as any).params.id_token : null);
            const accessToken =
              response.authentication?.accessToken ||
              (typeof (response as any)?.params?.access_token === 'string' ? (response as any).params.access_token : null);

            if (!idToken) throw new Error('No id token returned from Google');
            await completeGoogleAuth(idToken, accessToken || undefined);
          } catch (err: any) {
            Alert.alert('Google Sign-in Error', err.message || 'Failed to sign in with Google');
          }
        })();
      }
    }, [response]);

    return (
      <Button
        title="Sign in with Google"
        onPress={() => promptAsync()}
        disabled={!request}
      />
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title">Login</ThemedText>
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
        <Button title="Log In" onPress={handleSubmit} />
        <View style={styles.buttonSpacer} />
        {isAndroid ? <Button title="Sign in with Google" onPress={handleAndroidGoogleSignIn} /> : <GoogleSignInButton />}
      </View>
      <Link href="/signup" style={styles.link}>
        <ThemedText type="link">Don&apos;t have an account? Sign up</ThemedText>
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