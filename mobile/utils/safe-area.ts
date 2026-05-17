import { Platform } from 'react-native';
import type { EdgeInsets } from 'react-native-safe-area-context';

export const CUSTOM_TAB_BAR_HEIGHT = 70;

const MIN_BOTTOM_SYSTEM_INSET = Platform.OS === 'android' ? 28 : 12;

export function getBottomSystemInset(insets: Pick<EdgeInsets, 'bottom'>) {
  const measuredInset = Number(insets?.bottom || 0);
  return Math.max(measuredInset, MIN_BOTTOM_SYSTEM_INSET);
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
