import { GoogleSignin, isErrorWithCode, statusCodes, type SignInResponse } from '@react-native-google-signin/google-signin';

type ConfigureMode = 'withWebClient' | 'withoutWebClient';

let configuredMode: ConfigureMode | null = null;

function getWebClientId() {
  return process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '';
}

function configureGoogleSignin(mode: ConfigureMode) {
  if (configuredMode === mode) return;

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
  return response.type === 'success';
}

export function getNativeGoogleErrorMessage(error: unknown) {
  const easSha1 = '39:90:A3:A4:44:92:D8:25:22:52:8D:8E:CF:97:D0:CB:93:90:17:D0';
  const developerErrorHelp = `Google Sign-In developer configuration mismatch. Verify BOTH in Google Cloud: (1) Android OAuth client uses package com.handkraft with SHA-1 ${easSha1}; (2) EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is a Web client ID from the same project. Then uninstall/reinstall app and try again.`;

  if (isErrorWithCode(error)) {
    const errorCode = String(error.code || '').toUpperCase();
    if (errorCode === 'DEVELOPER_ERROR' || errorCode === '10') {
      return developerErrorHelp;
    }
    if (error.code === statusCodes.SIGN_IN_CANCELLED) {
      return 'Google sign-in was cancelled.';
    }
    if (error.code === statusCodes.IN_PROGRESS) {
      return 'Google sign-in is already in progress.';
    }
    if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      return 'Google Play Services is not available or needs an update on this device.';
    }
    if (typeof error.message === 'string' && error.message.trim()) {
      const upper = error.message.toUpperCase();
      if (upper.includes('DEVELOPER_ERROR')) {
        return developerErrorHelp;
      }
      return error.message;
    }
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
  if (isErrorWithCode(error)) {
    const code = String(error.code || '').toUpperCase();
    if (code === 'DEVELOPER_ERROR' || code === '10') return true;
    if (typeof error.message === 'string' && error.message.toUpperCase().includes('DEVELOPER_ERROR')) return true;
  }
  if (typeof error === 'string' && error.toUpperCase().includes('DEVELOPER_ERROR')) return true;
  if (error instanceof Error && error.message.toUpperCase().includes('DEVELOPER_ERROR')) return true;
  return false;
}

async function performNativeSignIn(mode: ConfigureMode) {
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
