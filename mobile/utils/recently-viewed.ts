import AsyncStorage from '@react-native-async-storage/async-storage';

const RECENTLY_VIEWED_KEY = 'HANDKRAFT_RECENTLY_VIEWED';
const MAX_ITEMS = 20;

export interface RecentlyViewedEntry {
  productId: string;
  viewedAt: number;
}

/**
 * Record a product view. Deduplicates entries and keeps only the latest MAX_ITEMS.
 */
export async function recordProductView(productId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(RECENTLY_VIEWED_KEY);
    let entries: RecentlyViewedEntry[] = [];
    try {
      entries = raw ? JSON.parse(raw) : [];
    } catch {
      entries = [];
    }

    // Remove existing entry for this product to avoid duplicates
    entries = entries.filter((e) => e.productId !== productId);

    // Add to the front
    entries.unshift({ productId, viewedAt: Date.now() });

    // Trim to max items
    if (entries.length > MAX_ITEMS) {
      entries = entries.slice(0, MAX_ITEMS);
    }

    await AsyncStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(entries));
  } catch {
    // Non-blocking — don't crash if storage fails
  }
}

/**
 * Get recently viewed product IDs, ordered by most recent first.
 */
export async function getRecentlyViewedIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENTLY_VIEWED_KEY);
    if (!raw) return [];
    const entries: RecentlyViewedEntry[] = JSON.parse(raw);
    return entries
      .sort((a, b) => b.viewedAt - a.viewedAt)
      .map((e) => e.productId);
  } catch {
    return [];
  }
}

/**
 * Clear all recently viewed items.
 */
export async function clearRecentlyViewed(): Promise<void> {
  try {
    await AsyncStorage.removeItem(RECENTLY_VIEWED_KEY);
  } catch {
    // Non-blocking
  }
}
