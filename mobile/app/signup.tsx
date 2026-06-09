import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, Button, View, Alert, Modal, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Link, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { registerUser, signInWithGoogle, sendOtp, verifyOtp } from '@/utils/api';
import { saveToken } from '@/utils/auth';
import currentUser from '@/utils/currentUser';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';

WebBrowser.maybeCompleteAuthSession();

export default function SignupScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [emailOtp, setEmailOtp] = useState('');
  const [phoneOtp, setPhoneOtp] = useState('');
  const [emailOtpSent, setEmailOtpSent] = useState(false);
  const [emailOtpLoading, setEmailOtpLoading] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [emailVerifyLoading, setEmailVerifyLoading] = useState(false);
  const [emailVerificationError, setEmailVerificationError] = useState('');
  const [phoneOtpSent, setPhoneOtpSent] = useState(false);
  const [phoneOtpLoading, setPhoneOtpLoading] = useState(false);
  const router = useRouter();

  const [successVisible, setSuccessVisible] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [successDetail, setSuccessDetail] = useState('');
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [authLoading, setAuthLoading] = useState<'signup' | 'google' | null>(null);

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

  const handleEmailChange = (text: string) => {
    setEmail(text);
    setEmailVerificationError('');
    if (emailOtpSent) {
      setEmailOtpSent(false);
      setEmailOtp('');
    }
    if (emailVerified) {
      setEmailVerified(false);
    }
  };

  const handleVerifyEmailOtp = async () => {
    try {
      const trimmedOtp = emailOtp.trim();
      if (!trimmedOtp) {
        Alert.alert('Error', 'Please enter verification code');
        return;
      }
      setEmailVerifyLoading(true);
      setEmailVerificationError('');
      await verifyOtp(email.trim().toLowerCase(), trimmedOtp);
      setEmailVerifyLoading(false);
      setEmailVerified(true);
      Alert.alert('Success', 'Email verified successfully!');
    } catch (err: any) {
      setEmailVerifyLoading(false);
      const errMsg = err.message || 'Incorrect OTP or verification expired';
      setEmailVerificationError(errMsg);
      Alert.alert('Verification Failed', errMsg);
    }
  };

  const handlePhoneChange = (text: string) => {
    setPhoneNumber(text);
    if (phoneOtpSent) {
      setPhoneOtpSent(false);
      setPhoneOtp('');
    }
  };

  const handleSendEmailOtp = async () => {
    try {
      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail) {
        Alert.alert('Error', 'Please enter email first');
        return;
      }
      if (!normalizedEmail.includes('@')) {
        Alert.alert('Error', 'Please enter a valid email address');
        return;
      }

      setEmailOtpLoading(true);
      setEmailVerificationError('');
      await sendOtp(normalizedEmail, '');
      setEmailOtpLoading(false);
      setEmailOtpSent(true);
      Alert.alert('Success', 'Verification code has been sent to your email!');
    } catch (err: any) {
      setEmailOtpLoading(false);
      const errMsg = err.message || 'Failed to send email verification code';
      setEmailVerificationError(errMsg);
      Alert.alert('Error', errMsg);
    }
  };

  const handleSendPhoneOtp = async () => {
    try {
      const normalizedPhone = phoneNumber.trim();
      if (!normalizedPhone) {
        Alert.alert('Error', 'Please enter WhatsApp number first');
        return;
      }
      if (normalizedPhone.length < 10) {
        Alert.alert('Error', 'Please enter a valid WhatsApp number (minimum 10 digits)');
        return;
      }

      setPhoneOtpLoading(true);
      await sendOtp('', normalizedPhone);
      setPhoneOtpLoading(false);
      setPhoneOtpSent(true);
      Alert.alert('Success', 'Verification code has been sent to your WhatsApp!');
    } catch (err: any) {
      setPhoneOtpLoading(false);
      Alert.alert('Error', err.message || 'Failed to send WhatsApp verification code');
    }
  };

  const handleSubmit = async () => {
    try {
      if (authLoading) return;

      const normalizedName = name.trim();
      const normalizedEmail = email.trim().toLowerCase();
      const normalizedPhone = phoneNumber.trim();
      const trimmedEmailOtp = emailOtp.trim();
      const trimmedPhoneOtp = phoneOtp.trim();

      if (!normalizedName || !normalizedEmail || !normalizedPhone || !password || !trimmedEmailOtp || !trimmedPhoneOtp) {
        Alert.alert('Error', 'Please fill in all fields and enter both verification codes');
        return;
      }

      if (!emailVerified) {
        Alert.alert('Error', 'Please verify your email address first');
        return;
      }

      const hasLetter = /[a-zA-Z]/.test(password);
      const hasNumber = /[0-9]/.test(password);
      const hasSpecial = /[^a-zA-Z0-9]/.test(password);
      if (password.length < 8 || !hasLetter || !hasNumber || !hasSpecial) {
        Alert.alert(
          'Weak Password',
          'Password must be at least 8 characters long and contain a combination of letters, numbers, and at least one special character.'
        );
        return;
      }

      setAuthLoading('signup');
      const { token, user, isNewUser } = await registerUser(
        normalizedName,
        normalizedEmail,
        normalizedPhone,
        password,
        trimmedEmailOtp,
        trimmedPhoneOtp
      );
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

    try {
      console.log('Google Sign-up Request Initiating', {
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
      <View style={styles.inputContainer}>
        <TextInput
          style={[
            styles.input,
            { marginVertical: 0 },
            emailVerified && styles.inputDisabled,
            email.trim().length > 0 && !emailVerified && { paddingRight: 115 }
          ]}
          placeholder="Email"
          placeholderTextColor="#b3b3b3"
          value={email}
          onChangeText={handleEmailChange}
          autoCapitalize="none"
          keyboardType="email-address"
          editable={!emailVerified}
        />
        {email.trim().length > 0 && !emailVerified && (
          <TouchableOpacity
            style={styles.inlineButton}
            onPress={handleSendEmailOtp}
            disabled={isAnyLoading || emailOtpLoading}>
            {emailOtpLoading ? (
              <ActivityIndicator size="small" color="#9df0a2" />
            ) : (
              <ThemedText style={styles.inlineButtonText}>
                {emailOtpSent ? 'Resend OTP' : 'Validate Email'}
              </ThemedText>
            )}
          </TouchableOpacity>
        )}
        {emailVerified && (
          <View style={styles.verifiedBadge}>
            <Ionicons name="checkmark-circle" size={18} color="#9df0a2" />
            <ThemedText style={styles.verifiedText}>Verified</ThemedText>
          </View>
        )}
      </View>

      {emailVerificationError ? (
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={16} color="#ff6b6b" />
          <ThemedText style={styles.errorText}>Not Verified: {emailVerificationError}</ThemedText>
        </View>
      ) : null}

      {emailOtpSent && !emailVerified && (
        <View style={styles.otpContainer}>
          <TextInput
            style={[styles.input, styles.otpInput]}
            placeholder="Email Verification OTP"
            placeholderTextColor="#b3b3b3"
            value={emailOtp}
            onChangeText={setEmailOtp}
            keyboardType="number-pad"
            maxLength={6}
          />
          <TouchableOpacity
            style={styles.verifyButton}
            onPress={handleVerifyEmailOtp}
            disabled={emailVerifyLoading}>
            {emailVerifyLoading ? (
              <ActivityIndicator size="small" color="#0a0a0a" />
            ) : (
              <ThemedText style={styles.verifyButtonText}>Verify</ThemedText>
            )}
          </TouchableOpacity>
        </View>
      )}

      <TextInput
        style={styles.input}
        placeholder="WhatsApp Number"
        placeholderTextColor="#b3b3b3"
        value={phoneNumber}
        onChangeText={handlePhoneChange}
        keyboardType="phone-pad"
      />
      <View style={styles.inlineValidateContainer}>
        <View style={styles.buttonWrap}>
          <Button
            title={phoneOtpLoading ? ' ' : (phoneOtpSent ? 'Resend WhatsApp OTP' : 'Validate WhatsApp')}
            onPress={handleSendPhoneOtp}
            disabled={isAnyLoading || phoneOtpLoading}
          />
          {phoneOtpLoading ? (
            <View style={styles.buttonSpinner}>
              <ActivityIndicator color="#ffffff" />
            </View>
          ) : null}
        </View>
      </View>
      {phoneOtpSent && (
        <TextInput
          style={[styles.input, styles.otpInput]}
          placeholder="WhatsApp Verification OTP"
          placeholderTextColor="#b3b3b3"
          value={phoneOtp}
          onChangeText={setPhoneOtp}
          keyboardType="number-pad"
          maxLength={6}
        />
      )}

      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor="#b3b3b3"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <ThemedText style={styles.disclaimer}>
        (Password must be at least 8 characters long and contain letters, numbers, and at least one special character)
      </ThemedText>

      <View style={styles.buttonContainer}>
        <View style={styles.buttonWrap}>
          <Button
            title={isSignupLoading ? ' ' : 'Sign Up'}
            onPress={handleSubmit}
            disabled={isAnyLoading || !emailVerified || !phoneOtpSent}
          />
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
  disclaimer: {
    fontSize: 11,
    color: '#8e8e93',
    marginTop: -2,
    marginBottom: 10,
    paddingHorizontal: 4,
    lineHeight: 15,
  },
  inlineValidateContainer: {
    marginTop: 4,
    marginBottom: 12,
  },
  otpInput: {
    borderColor: '#9df0a2',
    backgroundColor: '#16222f',
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
  inputContainer: {
    position: 'relative',
    marginVertical: 8,
    justifyContent: 'center',
  },
  inlineButton: {
    position: 'absolute',
    right: 8,
    bottom: 6,
    backgroundColor: 'rgba(157, 240, 162, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(157, 240, 162, 0.3)',
  },
  inlineButtonText: {
    color: '#9df0a2',
    fontSize: 10,
    fontWeight: '600',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 12,
    marginLeft: 4,
    fontWeight: '500',
  },
  inputDisabled: {
    borderColor: '#1e2b38',
    color: '#8e8e93',
    backgroundColor: '#0a0f14',
  },
  verifiedBadge: {
    position: 'absolute',
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  verifiedText: {
    color: '#9df0a2',
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 4,
  },
  otpContainer: {
    marginVertical: 4,
  },
  verifyButton: {
    backgroundColor: '#9df0a2',
    paddingVertical: 10,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 10,
  },
  verifyButtonText: {
    color: '#0a0a0a',
    fontSize: 13,
    fontWeight: '700',
  },
});
