type ConfigureMode = 'withWebClient' | 'withoutWebClient';

let configuredMode: ConfigureMode | null = null;

type GoogleSigninModule = {
  GoogleSignin: {
    configure: (options: { webClientId?: string; offlineAccess: boolean }) => void;
    hasPlayServices: (options: { showPlayServicesUpdateDialog: boolean }) => Promise<void>;
    signIn: () => Promise<any>;
    getTokens: () => Promise<{ accessToken?: string }>;
  };
};

let googleSigninModuleCache: GoogleSigninModule | null = null;

function getGoogleSigninModule(): GoogleSigninModule {
  if (googleSigninModuleCache) {
    return googleSigninModuleCache;
  }

  try {
    googleSigninModuleCache = require('@react-native-google-signin/google-signin') as GoogleSigninModule;
    return googleSigninModuleCache;
  } catch {
    throw new Error(
      'Native Google Sign-In is unavailable in this app binary. Use Expo Go Google button (web flow) or install a dev-client/rebuilt APK that includes @react-native-google-signin/google-signin.'
    );
  }
}

function getWebClientId() {
  return process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '';
}

function configureGoogleSignin(mode: ConfigureMode) {
  if (configuredMode === mode) return;

  const { GoogleSignin } = getGoogleSigninModule();

  const webClientId = getWebClientId();
  if (mode === 'withWebClient' && !webClientId) {
    throw new Error('Missing EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in mobile/.env');
  }

  if (mode === 'withWebClient') {
    GoogleSignin.configure({
      webClientId,
      offlineAccess: false,
    });
  } else {
    // Fallback mode for Android in case webClientId mapping is misconfigured.
    // This can still return an access token on some setups.
    GoogleSignin.configure({
      offlineAccess: false,
    });
  }

  configuredMode = mode;
}

function isSuccessResponse(response: SignInResponse): response is Extract<SignInResponse, { type: 'success' }> {
  return response?.type === 'success';
}

function getErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') {
    return '';
  }

  const maybeCode = (error as any).code;
  return String(maybeCode || '').toUpperCase();
}

export function getNativeGoogleErrorMessage(error: unknown) {
  const developerErrorHelp =
    'Google Sign-In developer configuration mismatch. Verify BOTH in Google Cloud: (1) Android OAuth client uses package com.handkraft and the SHA-1 from your currently installed app signing key (run mobile/android gradlew signingReport); (2) EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is a Web client ID from the same Google project. Then uninstall/reinstall the app and try again.';

  const errorCode = getErrorCode(error);
  if (errorCode === 'DEVELOPER_ERROR' || errorCode === '10') {
    return developerErrorHelp;
  }
  if (errorCode === 'SIGN_IN_CANCELLED') {
    return 'Google sign-in was cancelled.';
  }
  if (errorCode === 'IN_PROGRESS') {
    return 'Google sign-in is already in progress.';
  }
  if (errorCode === 'PLAY_SERVICES_NOT_AVAILABLE') {
    return 'Google Play Services is not available or needs an update on this device.';
  }

  if (error && typeof error === 'object' && typeof (error as any).message === 'string' && (error as any).message.trim()) {
    const message = (error as any).message;
    const upper = message.toUpperCase();
    if (upper.includes('DEVELOPER_ERROR')) {
      return developerErrorHelp;
    }
    return message;
  }

  if (typeof error === 'string' && error.toUpperCase().includes('DEVELOPER_ERROR')) {
    return developerErrorHelp;
  }

  if (error instanceof Error && error.message) {
    if (error.message.toUpperCase().includes('DEVELOPER_ERROR')) {
      return developerErrorHelp;
    }
    return error.message;
  }

  return 'Google sign-in failed.';
}

function isDeveloperError(error: unknown) {
  const code = getErrorCode(error);
  if (code === 'DEVELOPER_ERROR' || code === '10') return true;
  if (error && typeof error === 'object' && typeof (error as any).message === 'string' && (error as any).message.toUpperCase().includes('DEVELOPER_ERROR')) return true;
  if (typeof error === 'string' && error.toUpperCase().includes('DEVELOPER_ERROR')) return true;
  if (error instanceof Error && error.message.toUpperCase().includes('DEVELOPER_ERROR')) return true;
  return false;
}

async function performNativeSignIn(mode: ConfigureMode) {
  const { GoogleSignin } = getGoogleSigninModule();
  configureGoogleSignin(mode);

  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  const response = await GoogleSignin.signIn();
  if (!isSuccessResponse(response)) {
    throw new Error('Google sign-in was cancelled.');
  }

  const idToken = response.data.idToken || undefined;
  const tokens = await GoogleSignin.getTokens().catch(() => null);
  const accessToken = tokens?.accessToken;

  if (!idToken && !accessToken) {
    throw new Error('Google sign-in succeeded but no idToken/accessToken was returned.');
  }

  return {
    idToken,
    accessToken,
  };
}

export async function signInWithGoogleNative() {
  const hasWebClientId = Boolean(getWebClientId());

  try {
    return await performNativeSignIn(hasWebClientId ? 'withWebClient' : 'withoutWebClient');
  } catch (error) {
    // If the configured web client mapping is the source of DEVELOPER_ERROR,
    // retry once without webClientId.
    if (hasWebClientId && isDeveloperError(error)) {
      return performNativeSignIn('withoutWebClient');
    }
    throw error;
  }
}
