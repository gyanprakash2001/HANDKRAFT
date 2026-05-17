import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

function normalizePendingResult(result: any): ImagePicker.ImagePickerResult | null {
  if (!result) return null;
  if (Array.isArray(result)) {
    const usable = result.find((entry) => entry && (entry.assets || entry.canceled !== undefined));
    return usable || null;
  }
  return result;
}

function isAndroidLauncherRegistrationError(error: unknown) {
  const message = String((error as any)?.message || error || '').toLowerCase();
  return message.includes('activityresultlauncher')
    || message.includes('imagelibrarycontract')
    || message.includes('registered before calling launch');
}

function waitForNextNativeTurn() {
  return new Promise((resolve) => setTimeout(resolve, 180));
}

export async function launchStableImageLibraryAsync(
  options: ImagePicker.ImagePickerOptions
): Promise<ImagePicker.ImagePickerResult> {
  if (Platform.OS === 'android') {
    const pending = normalizePendingResult(await ImagePicker.getPendingResultAsync().catch(() => null));
    if (pending && !pending.canceled && Array.isArray((pending as any).assets) && (pending as any).assets.length > 0) {
      return pending;
    }
  }

  const attempts: ImagePicker.ImagePickerOptions[] = [options];

  if (Platform.OS === 'android') {
    attempts.push({ ...options, legacy: true });
    if (options.allowsMultipleSelection) {
      attempts.push({
        ...options,
        legacy: true,
        allowsMultipleSelection: false,
        selectionLimit: 1,
      });
    }
  }

  let lastError: unknown = null;
  for (let index = 0; index < attempts.length; index += 1) {
    try {
      if (index > 0) {
        await waitForNextNativeTurn();
      }
      return await ImagePicker.launchImageLibraryAsync(attempts[index]);
    } catch (error) {
      lastError = error;
      if (Platform.OS !== 'android' || !isAndroidLauncherRegistrationError(error)) {
        break;
      }
    }
  }

  throw lastError;
}
