import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View, Modal, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Link, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedAlert, AlertButton } from '@/components/ThemedAlert';
import { loginUser, signInWithGoogle } from '@/utils/api';
import { saveToken } from '@/utils/auth';
import currentUser from '@/utils/currentUser';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();

  const [successVisible, setSuccessVisible] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [successDetail, setSuccessDetail] = useState('');
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [authLoading, setAuthLoading] = useState<'login' | 'google' | null>(null);

  // ThemedAlert state
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [alertButtons, setAlertButtons] = useState<AlertButton[]>([]);

  const showAlert = useCallback((title: string, message: string, buttons?: AlertButton[]) => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertButtons(buttons || []);
    setAlertVisible(true);
  }, []);

  const appOwnership = String((Constants as any)?.appOwnership || '').toLowerCase();
  const useProxyForExpo = appOwnership === 'expo';
  const useNativeGoogleAuth = appOwnership !== 'expo';

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
      showAlert(
        'Add phone number',
        'Signed in successfully. We could not fetch your phone from Google. Add it now.',
        [
          { text: 'Later', style: 'cancel', onPress: () => router.replace('/feed') },
          { text: 'Add now', onPress: () => router.replace('/edit-profile') },
        ]
      );
      return;
    }

    const isNew = typeof isNewUser === 'boolean' ? isNewUser : false;
    const successTitle = isNew ? 'Success login' : 'Welcome Back';
    const successDetailText = isNew ? 'Your account is ready.' : 'Great to see you again.';
    setAuthLoading(null);
    showSuccess(successTitle, successDetailText);
  }, [router, showSuccess]);

  const handleSubmit = async () => {
    try {
      if (authLoading) return;
      setAuthLoading('login');
      const { token, isNewUser } = await loginUser(email, password);
      await saveToken(token);
      const isNew = typeof isNewUser === 'boolean' ? isNewUser : false;
      const successTitle = isNew ? 'Success login' : 'Welcome Back';
      const successDetailText = isNew ? 'Your account is ready.' : 'Great to see you again.';
      setAuthLoading(null);
      showSuccess(successTitle, successDetailText);
    } catch (err: any) {
      setAuthLoading(null);
      showAlert('Error', err.message || 'Login failed');
    }
  };

  useEffect(() => {
    return () => {
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current);
      }
    };
  }, []);

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
        showAlert('Google Sign-in Error', err.message || 'Failed to sign in with Google');
      }
    })();
  }, [response, completeGoogleAuth]);

  const handleGoogleSignIn = async () => {
    if (!request) {
      showAlert('Google Sign-in Error', 'Google sign-in is initializing. Please try again.');
      return;
    }
    if (authLoading) return;
    setAuthLoading('google');

    // Debug: log OAuth request parameters so Metro shows them when sign-in is initiated
    try {
      console.log('Google Sign-in Request Initiating', {
        expoClientId: process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID,
        iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
        androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
        webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
        redirectUri: request?.redirectUri,
        useProxyForExpo,
        useNativeGoogleAuth,
        appOwnership,
        requestExists: Boolean(request),
      });

      // Start Expo proxy only in Expo Go; otherwise use the browser/web flow by default.
      console.log(`Starting Google sign-in (useProxy=${useProxyForExpo}, useNative=${useNativeGoogleAuth})`);
      console.log('Auth request object:', request);
      if (useNativeGoogleAuth) {
        const { signInWithGoogleNative, getNativeGoogleErrorMessage } = await import('@/utils/google-native-auth');
        try {
          console.log('Trying native Google sign-in on Android app build');
          const { idToken, accessToken } = await signInWithGoogleNative();
          await completeGoogleAuth(idToken, accessToken);
          return;
        } catch (err) {
          console.warn('Native Google sign-up failed', err);
          setAuthLoading(null);
          showAlert('Google Sign-in Error', getNativeGoogleErrorMessage(err));
          return;
        }
      }

      const result = await promptAsync(useProxyForExpo ? ({ useProxy: true } as any) : undefined);
      if (result?.type !== 'success') {
        setAuthLoading(null);
      }
    } catch (firstError) {
      console.warn('Google AuthSession sign-in failed', firstError);
      setAuthLoading(null);
      const authSessionMessage = firstError instanceof Error ? firstError.message : 'Failed to start Google sign-in.';
      showAlert('Google Sign-in Error', authSessionMessage);
    }
  };

  const isLoginLoading = authLoading === 'login';
  const isGoogleLoading = authLoading === 'google';
  const isAnyLoading = authLoading !== null;

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
      <ThemedAlert
        visible={alertVisible}
        title={alertTitle}
        message={alertMessage}
        buttons={alertButtons}
        onClose={() => setAlertVisible(false)}
      />
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
      <View style={styles.inputContainer}>
        <TextInput
          style={[styles.input, { marginVertical: 0, paddingRight: 45 }]}
          placeholder="Password"
          placeholderTextColor="#b3b3b3"
          secureTextEntry={!showPassword}
          value={password}
          onChangeText={setPassword}
        />
        <TouchableOpacity
          style={styles.eyeButton}
          onPress={() => setShowPassword(!showPassword)}>
          <Ionicons
            name={showPassword ? 'eye-off' : 'eye'}
            size={20}
            color="#b3b3b3"
          />
        </TouchableOpacity>
      </View>
      <View style={styles.buttonContainer}>
        <View style={styles.buttonWrap}>
          <TouchableOpacity
            style={[styles.primaryButton, isAnyLoading && styles.primaryButtonDisabled]}
            onPress={handleSubmit}
            disabled={isAnyLoading}
          >
            <ThemedText style={styles.primaryButtonText}>
              {isLoginLoading ? '' : 'Log In'}
            </ThemedText>
          </TouchableOpacity>
          {isLoginLoading ? (
            <View style={styles.buttonSpinner}>
              <ActivityIndicator color="#ffffff" />
            </View>
          ) : null}
        </View>
        <View style={styles.buttonSpacer} />
        <View style={styles.buttonWrap}>
          <TouchableOpacity
            style={[styles.primaryButton, (!request || isAnyLoading) && styles.primaryButtonDisabled]}
            onPress={handleGoogleSignIn}
            disabled={!request || isAnyLoading}
          >
            <ThemedText style={styles.primaryButtonText}>
              {isGoogleLoading ? '' : 'Sign in with Google'}
            </ThemedText>
          </TouchableOpacity>
          {isGoogleLoading ? (
            <View style={styles.buttonSpinner}>
              <ActivityIndicator color="#ffffff" />
            </View>
          ) : null}
        </View>
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
  primaryButton: {
    backgroundColor: '#2196F3',
    height: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
    shadowColor: '#2196F3',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  primaryButtonDisabled: {
    backgroundColor: '#2196F3',
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  inputContainer: {
    position: 'relative',
    marginVertical: 8,
    justifyContent: 'center',
  },
  eyeButton: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
