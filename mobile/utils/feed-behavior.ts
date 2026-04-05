import AsyncStorage from '@react-native-async-storage/async-storage';

const FEED_BEHAVIOR_KEY = 'HANDKRAFT_FEED_BEHAVIOR_V1';

export type FeedInteractionType = 'seen' | 'clicked' | 'visited';

export interface FeedBehaviorState {
  seen: Record<string, number>;
  clicked: Record<string, number>;
  visited: Record<string, number>;
  lastSeenAt: Record<string, string>;
  lastClickedAt: Record<string, string>;
  lastVisitedAt: Record<string, string>;
  updatedAt: string;
}

const EMPTY_BEHAVIOR: FeedBehaviorState = {
  seen: {},
  clicked: {},
  visited: {},
  lastSeenAt: {},
  lastClickedAt: {},
  lastVisitedAt: {},
  updatedAt: new Date(0).toISOString(),
};

function normalizeBehavior(value: any): FeedBehaviorState {
  return {
    seen: value?.seen && typeof value.seen === 'object' ? value.seen : {},
    clicked: value?.clicked && typeof value.clicked === 'object' ? value.clicked : {},
    visited: value?.visited && typeof value.visited === 'object' ? value.visited : {},
    lastSeenAt: value?.lastSeenAt && typeof value.lastSeenAt === 'object' ? value.lastSeenAt : {},
    lastClickedAt: value?.lastClickedAt && typeof value.lastClickedAt === 'object' ? value.lastClickedAt : {},
    lastVisitedAt: value?.lastVisitedAt && typeof value.lastVisitedAt === 'object' ? value.lastVisitedAt : {},
    updatedAt: typeof value?.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
  };
}

function getTimestampBucketForInteraction(
  state: FeedBehaviorState,
  interaction: FeedInteractionType
): Record<string, string> {
  if (interaction === 'seen') return { ...(state.lastSeenAt || {}) };
  if (interaction === 'clicked') return { ...(state.lastClickedAt || {}) };
  return { ...(state.lastVisitedAt || {}) };
}

export async function getFeedBehavior(): Promise<FeedBehaviorState> {
  try {
    const raw = await AsyncStorage.getItem(FEED_BEHAVIOR_KEY);
    if (!raw) {
      return EMPTY_BEHAVIOR;
    }

    return normalizeBehavior(JSON.parse(raw));
  } catch {
    return EMPTY_BEHAVIOR;
  }
}

export async function recordFeedInteraction(productId: string, interaction: FeedInteractionType, amount = 1): Promise<void> {
  const id = String(productId || '').trim();
  if (!id) return;

  const bump = Number.isFinite(amount) ? Math.max(1, Math.floor(amount)) : 1;

  try {
    const current = await getFeedBehavior();
    const nextBucket = { ...(current[interaction] || {}) };
    const nextTimestampBucket = getTimestampBucketForInteraction(current, interaction);
    nextBucket[id] = Math.min(999, (nextBucket[id] || 0) + bump);
    nextTimestampBucket[id] = new Date().toISOString();

    const nextValue: FeedBehaviorState = {
      ...current,
      [interaction]: nextBucket,
      ...(interaction === 'seen' ? { lastSeenAt: nextTimestampBucket } : {}),
      ...(interaction === 'clicked' ? { lastClickedAt: nextTimestampBucket } : {}),
      ...(interaction === 'visited' ? { lastVisitedAt: nextTimestampBucket } : {}),
      updatedAt: new Date().toISOString(),
    };

    await AsyncStorage.setItem(FEED_BEHAVIOR_KEY, JSON.stringify(nextValue));
  } catch {
    // Non-blocking analytics signal.
  }
}
