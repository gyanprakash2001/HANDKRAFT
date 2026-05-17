import { Platform } from 'react-native';
import type { EdgeInsets } from 'react-native-safe-area-context';

export const CUSTOM_TAB_BAR_HEIGHT = 70;

const ANDROID_THREE_BUTTON_NAV_MIN_INSET = 36;

export function getBottomSystemInset(insets: Pick<EdgeInsets, 'bottom'>) {
  const measuredInset = Number(insets?.bottom || 0);

  if (Platform.OS === 'android') {
    return measuredInset >= ANDROID_THREE_BUTTON_NAV_MIN_INSET ? measuredInset : 0;
  }

  return Math.max(0, measuredInset);
}

export function getCustomTabBarHeight(insets: Pick<EdgeInsets, 'bottom'>) {
  return CUSTOM_TAB_BAR_HEIGHT + getBottomSystemInset(insets);
}

export function getTabBarContentPadding(insets: Pick<EdgeInsets, 'bottom'>, extra = 18) {
  return getCustomTabBarHeight(insets) + extra;
}

export function getScreenBottomPadding(insets: Pick<EdgeInsets, 'bottom'>, extra = 24) {
  return getBottomSystemInset(insets) + extra;
}
