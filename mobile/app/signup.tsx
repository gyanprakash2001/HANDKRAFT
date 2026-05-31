import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, Button, View, Alert, Modal, ActivityIndicator } from 'react-native';
import { Link, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { registerUser, signInWithGoogle } from '@/utils/api';
import { saveToken } from '@/utils/auth';
import currentUser from '@/utils/currentUser';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';

WebBrowser.maybeCompleteAuthSession();

export default function SignupScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const router = useRouter();

  const [successVisible, setSuccessVisible] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [successDetail, setSuccessDetail] = useState('');
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [authLoading, setAuthLoading] = useState<'signup' | 'google' | null>(null);

  const appOwnership = String((Constants as any)?.appOwnership || '').toLowerCase();
  const useProxyForExpo = appOwnership === 'expo';
  const useNativeGoogleAuth = String(process.env.EXPO_PUBLIC_GOOGLE_NATIVE_AUTH || '').toLowerCase() === 'true';

  const [request, response, promptAsync] = Google.useAuthRequest({
    expoClientId: process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    scopes: ['openid', 'profile', 'email', 'https://www.googleapis.com/auth/user.phonenumbers.read'],
    selectAccount: true,
  } as any);

  const showSuccess = useCallback((title: string, detail: string) => {
    setSuccessMessage(title);
    setSuccessDetail(detail);
    setSuccessVisible(true);
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    successTimerRef.current = setTimeout(() => {
      setSuccessVisible(false);
      router.replace('/feed');
    }, 1200);
  }, [router]);

  const completeGoogleAuth = useCallback(async (idToken?: string, accessToken?: string) => {
    const { token, user, isNewUser } = await signInWithGoogle(idToken, accessToken);
    await saveToken(token);
    if (user) currentUser.setProfile(user);

    const hasPhoneNumber = Boolean(String(user?.phoneNumber || '').trim());
    if (!hasPhoneNumber) {
      setAuthLoading(null);
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

    const isNew = typeof isNewUser === 'boolean' ? isNewUser : true;
    const successTitle = isNew ? 'Success signup' : 'Welcome Back';
    const successDetailText = isNew ? 'Your account is ready.' : 'Great to see you again.';
    setAuthLoading(null);
    showSuccess(successTitle, successDetailText);
  }, [router, showSuccess]);

  const handleSubmit = async () => {
    try {
      if (authLoading) return;
      setAuthLoading('signup');
      const { token, user, isNewUser } = await registerUser(name, email, password);
      await saveToken(token);
      if (user) currentUser.setProfile(user);
      const isNew = typeof isNewUser === 'boolean' ? isNewUser : true;
      const successTitle = isNew ? 'Success signup' : 'Welcome Back';
      const successDetailText = isNew ? 'Your account is ready.' : 'Great to see you again.';
      setAuthLoading(null);
      showSuccess(successTitle, successDetailText);
    } catch (err: any) {
      setAuthLoading(null);
      Alert.alert('Error', err.message || 'Signup failed');
    }
  };

  useEffect(() => {
    if (!response) return;
    if (response.type !== 'success') {
      setAuthLoading(null);
      return;
    }

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
        setAuthLoading(null);
        Alert.alert('Google Sign-up Error', err.message || 'Failed to sign up with Google');
      }
    })();
  }, [response, completeGoogleAuth]);

  const handleGoogleSignUp = async () => {
    if (!request) {
      Alert.alert('Google Sign-up Error', 'Google sign-up is initializing. Please try again.');
      return;
    }
    if (authLoading) return;
    setAuthLoading('google');

    // Debug: log OAuth request parameters so Metro shows them when sign-up is initiated
    try {
      console.log('Google Sign-up Request Initiating', {
        expoClientId: process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID,
        iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
        androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
        webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
        redirectUri: request.redirectUri,
        useProxyForExpo,
        useNativeGoogleAuth,
        appOwnership,
        requestExists: Boolean(request),
      });

      // Start Expo proxy only in Expo Go; otherwise use the browser/web flow by default.
      console.log(`Starting Google sign-up (useProxy=${useProxyForExpo}, useNative=${useNativeGoogleAuth})`);
      console.log('Auth request object:', request);
      if (useNativeGoogleAuth) {
        const { signInWithGoogleNative, getNativeGoogleErrorMessage } = await import('@/utils/google-native-auth');
        try {
          console.log('Trying native Google sign-up on Android app build');
          const { idToken, accessToken } = await signInWithGoogleNative();
          await completeGoogleAuth(idToken, accessToken);
          return;
        } catch (err) {
          console.warn('Native Google sign-up failed', err);
          setAuthLoading(null);
          Alert.alert('Google Sign-up Error', getNativeGoogleErrorMessage(err));
          return;
        }
      }

      const result = await promptAsync(useProxyForExpo ? ({ useProxy: true } as any) : undefined);
      if (result?.type !== 'success') {
        setAuthLoading(null);
      }
    } catch (firstError) {
      console.warn('Google AuthSession sign-up failed', firstError);
      setAuthLoading(null);
      const authSessionMessage = firstError instanceof Error ? firstError.message : 'Failed to start Google sign-up.';
      Alert.alert('Google Sign-up Error', authSessionMessage);
    }
  };

  const isSignupLoading = authLoading === 'signup';
  const isGoogleLoading = authLoading === 'google';
  const isAnyLoading = authLoading !== null;

  useEffect(() => {
    return () => {
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current);
      }
    };
  }, []);

  return (
    <ThemedView style={styles.container}>
      <Modal
        visible={successVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setSuccessVisible(false)}>
        <View style={styles.successBackdrop}>
          <View style={styles.successCard}>
            <View style={styles.successIconWrap}>
              <Ionicons name="checkmark" size={32} color="#0a0a0a" />
            </View>
            <ThemedText style={styles.successTitle}>{successMessage}</ThemedText>
            <ThemedText style={styles.successText}>{successDetail}</ThemedText>
            <View style={styles.successTag}>
              <ThemedText style={styles.successTagText}>Taking you to your feed</ThemedText>
            </View>
          </View>
        </View>
      </Modal>
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
        <View style={styles.buttonWrap}>
          <Button title={isSignupLoading ? ' ' : 'Sign Up'} onPress={handleSubmit} disabled={isAnyLoading} />
          {isSignupLoading ? (
            <View style={styles.buttonSpinner}>
              <ActivityIndicator color="#ffffff" />
            </View>
          ) : null}
        </View>
        <View style={styles.buttonSpacer} />
        <View style={styles.buttonWrap}>
          <Button
            title={isGoogleLoading ? ' ' : 'Sign up with Google'}
            onPress={handleGoogleSignUp}
            disabled={!request || isAnyLoading}
          />
          {isGoogleLoading ? (
            <View style={styles.buttonSpinner}>
              <ActivityIndicator color="#ffffff" />
            </View>
          ) : null}
        </View>
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
  buttonWrap: {
    position: 'relative',
  },
  buttonSpinner: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSpacer: {
    height: 12,
  },
  link: {
    marginTop: 20,
    alignItems: 'center',
  },
  successBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.68)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  successCard: {
    paddingHorizontal: 26,
    paddingVertical: 28,
    borderRadius: 18,
    alignItems: 'center',
    backgroundColor: '#0b1118',
    borderWidth: 1,
    borderColor: '#1e2b38',
    minWidth: 280,
    maxWidth: '82%',
    shadowColor: '#000',
    shadowOpacity: 0.38,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  successIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#9df0a2',
    shadowColor: '#9df0a2',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  successTitle: {
    marginTop: 14,
    color: '#f5fbff',
    fontWeight: '700',
    fontSize: 20,
    letterSpacing: 0.2,
  },
  successText: {
    marginTop: 6,
    color: '#9fb0c1',
    fontWeight: '500',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  successTag: {
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(157, 240, 162, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(157, 240, 162, 0.3)',
  },
  successTagText: {
    color: '#9df0a2',
    fontWeight: '700',
    fontSize: 11,
    letterSpacing: 0.2,
  },
});
