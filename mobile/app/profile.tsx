import { useEffect, useMemo, useState, useCallback } from 'react';
import { StyleSheet, View, Pressable, ActivityIndicator, FlatList, Switch, ScrollView, Alert, Modal, TextInput, useWindowDimensions, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import AvatarEditor from '@/components/AvatarEditor';
import { Image } from 'expo-image';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PanGestureHandler, PanGestureHandlerStateChangeEvent, State } from 'react-native-gesture-handler';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import LocalAvatar from '@/components/LocalAvatar';
import {
  getProfileDashboard,
  ProductItem,
  ProfileDashboardResponse,
  getUserOrderHistory,
  Order,
  getUserAddresses,
  UserAddress,
  addProductStock,
  SellerOrder,
  SellerOrderItem,
  SellerFulfillmentStatus,
  getSellerOrders,
  updateSellerOrderItemStatus,
  updateUserProfile,
  uploadAvatar,
  getDefaultAvatars,
} from '@/utils/api';
import currentUser from '@/utils/currentUser';

// Local in-app avatar manifest (emoji + gradient) — non-human, neutral
const LOCAL_MANIFEST: string[] = Array.from({ length: 30 }, (_, i) => `local:avatar${String(i + 1).padStart(2, '0')}`);
const ENV_BASE_URL = process.env.EXPO_PUBLIC_API_URL;

function resolveFileBaseUrl() {
  if (ENV_BASE_URL) return ENV_BASE_URL.replace(/\/api\/?$/, '');
  const hostUri = Constants.expoConfig?.hostUri || (Constants as any)?.manifest2?.extra?.expoClient?.hostUri;
  const host = hostUri ? hostUri.split(':')[0] : null;
  const isIpv4 = host ? /^\d{1,3}(\.\d{1,3}){3}$/.test(host) : false;
  if (host && isIpv4) return `http://${host}:5000`;
  if (Platform.OS === 'android') return 'http://10.0.2.2:5000';
  return 'http://localhost:5000';
}

// Helper to get avatar Image source. Always returns an object suitable for the Image `source` prop.
function getAvatarUri(filename: any) {
  try {
    if (!filename) return { uri: 'https://placehold.co/180x180?text=Avatar' };
    const asStr = String(filename || '');
    if (asStr.startsWith('/')) {
      return { uri: `${resolveFileBaseUrl()}${asStr}` };
    }
    if (asStr.startsWith('http') || asStr.startsWith('data:')) {
      return { uri: asStr };
    }
    const match = asStr.match(/(\d+)/);
    const idx = match ? Number(match[1]) : 1;
    const seed = `handkraft-${String(idx).padStart(2, '0')}`;
    return { uri: `https://avatars.dicebear.com/api/identicon/${encodeURIComponent(seed)}.png?background=%23eaf6ff` };
  } catch (e) {
    return { uri: 'https://placehold.co/180x180?text=Avatar' };
  }
}
// Append a short cache-buster so updated server files are fetched immediately
function cacheBustUrl(url: any) {
  try {
    if (!url || typeof url !== 'string') return url;
    const asStr = String(url);
    if (asStr.startsWith('local:')) return asStr;
    // already has v= param
    if (asStr.includes('v=')) return asStr;
    const sep = asStr.includes('?') ? '&' : '?';
    return `${asStr}${sep}v=${Date.now()}`;
  } catch (e) {
    return url;
  }
}
// Avatar Picker Modal
function AvatarPickerModal({ visible, avatars, onSelect, onClose, currentAvatar }: { visible: boolean; avatars: any[]; onSelect: (a: any) => void; onClose: () => void; currentAvatar?: string | null }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.avatarModalBackdrop}>
        <View style={styles.avatarModalCard}>
          <ThemedText style={styles.avatarModalTitle}>Choose Your Avatar</ThemedText>
                  <ScrollView contentContainerStyle={styles.avatarGrid}>
                    {avatars.map((av: any) => {
                      const isSelected = Boolean(
                        currentAvatar && (
                          currentAvatar === av || currentAvatar.endsWith(av) || String(currentAvatar).includes(av)
                        )
                      );
                      return (
                        <Pressable
                          key={av}
                          style={[styles.avatarOption, isSelected && styles.avatarOptionSelected]}
                          onPress={() => onSelect(av)}
                        >
                          {typeof av === 'string' && av.startsWith('local:') ? (
                            <LocalAvatar id={av} size={56} style={{ width: 56, height: 56, borderRadius: 28 }} />
                          ) : (
                            <Image source={getAvatarUri(av)} style={styles.avatarOptionImg} contentFit="cover" />
                          )}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
          <Pressable style={styles.avatarModalCloseBtn} onPress={onClose}>
            <ThemedText style={styles.avatarModalCloseText}>Cancel</ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// Modal showing the two avatar actions (modern popup)
function AvatarActionsModal({ visible, onClose, onOpenDefault, onOpenUpload }: { visible: boolean; onClose: () => void; onOpenDefault: () => void; onOpenUpload: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.avatarModalBackdrop}>
        <View style={styles.avatarModalCard}>
          <ThemedText style={styles.avatarModalTitle}>Change Avatar</ThemedText>
          <View style={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
            <Pressable
              style={[styles.avatarChangeBtn, { flex: 1, alignItems: 'center', paddingVertical: 14 }]}
              onPress={() => {
                onClose();
                setTimeout(onOpenDefault, 120);
              }}
            >
              <Ionicons name="images-outline" size={22} color="#9df0a2" />
              <ThemedText style={[styles.avatarChangeBtnText, { marginTop: 8 }]}>Choose Default</ThemedText>
            </Pressable>

            <Pressable
              style={[styles.avatarChangeBtn, { flex: 1, alignItems: 'center', paddingVertical: 14 }]}
              onPress={() => {
                onClose();
                setTimeout(onOpenUpload, 120);
              }}
            >
              <Ionicons name="cloud-upload-outline" size={22} color="#9df0a2" />
              <ThemedText style={[styles.avatarChangeBtnText, { marginTop: 8 }]}>Upload</ThemedText>
            </Pressable>
          </View>
          <Pressable style={styles.avatarModalCloseBtn} onPress={onClose}>
            <ThemedText style={styles.avatarModalCloseText}>Cancel</ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}


type ProfileMode = 'buyer' | 'seller';
type BuyerTab = 'saved' | 'orders' | 'addresses' | 'account';
type SavedBoard = {
  id: string;
  title: string;
  subtitle: string;
  items: ProductItem[];
};

const BUYER_TABS: BuyerTab[] = ['saved', 'orders', 'addresses', 'account'];
const SELLER_FLOW_STEPS: SellerFulfillmentStatus[] = ['new', 'processing', 'packed', 'shipped', 'delivered'];
const SELLER_STAGE_TABS = [
  { key: 'new', label: 'New Orders' },
  { key: 'shipment', label: 'In Shipment' },
  { key: 'delivered', label: 'Delivered' },
] as const;

const PROFILE_MODE_KEY = 'HANDKRAFT_PROFILE_MODE';
const SELLER_SEEN_COUNT_KEY = 'HANDKRAFT_SELLER_SEEN_COUNT';
const NEW_ORDERS_TAB_SEEN_COUNT_KEY = 'HANDKRAFT_NEW_ORDERS_TAB_SEEN_COUNT';

export default function ProfileScreen() {
  const [mode, setMode] = useState<ProfileMode>('buyer');
  const [buyerTab, setBuyerTab] = useState<BuyerTab>('saved');
  const [activeSavedBoard, setActiveSavedBoard] = useState('home');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<ProfileDashboardResponse | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [addresses, setAddresses] = useState<UserAddress[]>([]);
  const [sellerOrders, setSellerOrders] = useState<SellerOrder[]>([]);
  const [expandedSellerOrderIds, setExpandedSellerOrderIds] = useState<string[]>([]);
  const [sellerOrderUpdatingKey, setSellerOrderUpdatingKey] = useState<string | null>(null);
  const [stockUpdatingId, setStockUpdatingId] = useState<string | null>(null);
  const [stockPromptItem, setStockPromptItem] = useState<ProductItem | null>(null);
  const [stockPromptValue, setStockPromptValue] = useState('1');
  const [sellerSeenCount, setSellerSeenCount] = useState(0);
  const [newOrdersTabSeenCount, setNewOrdersTabSeenCount] = useState(0);
  const [pendingSellerBadgeClear, setPendingSellerBadgeClear] = useState(false);
  const { width: screenWidth } = useWindowDimensions();
  const router = useRouter();
  const [serverAvatars, setServerAvatars] = useState<string[]>([]);
  const [editorUri, setEditorUri] = useState<string | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editorUploadMode, setEditorUploadMode] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  // Avatar modal state and handler (moved inside component to comply with Hooks rules)
  const [avatarModalVisible, setAvatarModalVisible] = useState(false);
  const [avatarUpdating, setAvatarUpdating] = useState(false);
  const [avatarActionsVisible, setAvatarActionsVisible] = useState(false);
  const defaultAvatars = useMemo(() => {
    // Keep up to 30 local defaults, but always show any uploaded server avatars too.
    const local = LOCAL_MANIFEST.slice(0, 30);
    if (!serverAvatars || serverAvatars.length === 0) return local;
    // Combine server avatars (newest first) and local defaults, de-duplicating by base path.
    const seen = new Set();
    const combined: string[] = [];
    for (const av of serverAvatars) {
      const key = String(av).split('?')[0];
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(av);
      }
    }
    for (const la of local) {
      const key = String(la).split('?')[0];
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(la);
      }
    }
    return combined;
  }, [serverAvatars]);

  const handleAvatarSelect = async (filename: any) => {
    if (!dashboard?.user) return;
    setAvatarUpdating(true);
    try {
      if (typeof filename === 'string' && filename.startsWith('data:')) {
        const res = await uploadAvatar(filename);
        const newAvatar = res?.user?.avatarUrl;
        if (newAvatar) {
          const busted = cacheBustUrl(newAvatar);
          const base = String(newAvatar).split('?')[0];
          setServerAvatars((prev) => {
            const filtered = (prev || []).filter((p) => String(p).split('?')[0] !== base);
            return [busted, ...filtered].slice(0, 30);
          });
          const updatedUser = { ...res.user, avatarUrl: busted };
          setDashboard((d) => (d ? { ...d, user: updatedUser } : d));
          currentUser.setProfile(updatedUser);
        } else {
          await loadDashboard();
        }
      } else if (typeof filename === 'string' && filename.startsWith('local:')) {
        // local in-app avatar selection (no upload required)
        const updated = await updateUserProfile({ avatarUrl: filename });
        setDashboard((d) => (d ? { ...d, user: updated } : d));
        currentUser.setProfile(updated);
      } else if (typeof filename === 'string' && (filename.startsWith('http') || filename.startsWith('https'))) {
        const updated = await updateUserProfile({ avatarUrl: filename });
        const avatarUrl = updated?.avatarUrl || filename;
        const busted = cacheBustUrl(avatarUrl);
        const base = String(avatarUrl).split('?')[0];
        setServerAvatars((prev) => {
          const filtered = (prev || []).filter((p) => String(p).split('?')[0] !== base);
          return [busted, ...filtered].slice(0, 30);
        });
        const updatedUser = { ...updated, avatarUrl: busted };
        setDashboard((d) => (d ? { ...d, user: updatedUser } : d));
        currentUser.setProfile(updatedUser);
      } else if (typeof filename === 'string') {
        const avatarUrl = `/assets/profile-avatars/${filename}`;
        const updated = await updateUserProfile({ avatarUrl });
        setServerAvatars((prev) => {
          const filtered = (prev || []).filter((p) => String(p).split('?')[0] !== avatarUrl);
          return [avatarUrl, ...filtered].slice(0, 30);
        });
        setDashboard((d) => (d ? { ...d, user: updated } : d));
        currentUser.setProfile(updated);
      }

      setAvatarModalVisible(false);
    } catch (err: any) {
      Alert.alert('Avatar update failed', String(err?.message || err || 'Could not update avatar.'));
    } finally {
      setAvatarUpdating(false);
    }
  };

  // Fetch server-side default avatars if available
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const list = await getDefaultAvatars();
        if (mounted && Array.isArray(list) && list.length) {
          const busted = list.map((u) => cacheBustUrl(u));
          setServerAvatars(busted);
        }
      } catch (e) {
        // ignore
      }
    })();
    return () => { mounted = false; };
  }, []);

  const pickImage = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return Alert.alert('Permission required', 'Please allow access to your photos to choose an avatar.');
      // Prefer explicit media type to avoid runtime access of deprecated enums.
      const mediaTypesOption = ['images'];

      const result = await (ImagePicker as any).launchImageLibraryAsync({ mediaTypes: mediaTypesOption, quality: 1, copyToCacheDirectory: true });
      const anyRes = result as any;
      const uri = anyRes?.assets?.[0]?.uri || anyRes?.uri;
      if (!uri) return;
      setEditorUri(uri);
      setEditorUploadMode(true);
      setEditorVisible(true);
    } catch (err) {
      console.error('Pick image error', err);
    }
  };

  const handleEditorSave = async ({ uri, base64, setOnProfile }: { uri: string; base64?: string; setOnProfile?: boolean }) => {
    try {
      setEditorVisible(false);
      setIsUploadingAvatar(true);
      // Ensure we upload the selected image to server so it becomes part of the avatar list.
      let dataUri: string | undefined = base64 ? `data:image/jpeg;base64,${base64}` : undefined;

      if (!dataUri && uri) {
        try {
          const isPng = String(uri).toLowerCase().endsWith('.png');
          const fileBase64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
          dataUri = `data:${isPng ? 'image/png' : 'image/jpeg'};base64,${fileBase64}`;
        } catch (readErr) {
          // If reading as base64 fails (some Android content:// URIs), fall back to alerting the user.
          dataUri = undefined;
        }
      }

      if (dataUri) {
        // Upload the avatar and set on profile if requested by the editor action.
        const res = await uploadAvatar(dataUri, Boolean(setOnProfile));
        const newAvatarUrl = res?.url || res?.user?.avatarUrl;
        if (newAvatarUrl) {
          const busted = cacheBustUrl(newAvatarUrl);
          const base = String(newAvatarUrl).split('?')[0];
          setServerAvatars((prev) => {
            const filtered = (prev || []).filter((p) => String(p).split('?')[0] !== base);
            return [busted, ...filtered];
          });
          // If server returned updated user (setOnProfile=true), update local profile.
          if (setOnProfile && res?.user) {
            const updatedUser = { ...res.user, avatarUrl: cacheBustUrl(res.user.avatarUrl) };
            setDashboard((d) => (d ? { ...d, user: updatedUser } : d));
            currentUser.setProfile(updatedUser);
          }
        } else {
          await loadDashboard();
        }
      } else if (uri) {
        // Could not read file as base64 for upload — notify user.
        Alert.alert('Upload failed', 'Could not read the selected image. Please allow photo permissions and try again, or pick a different image.');
      }
    } catch (err: any) {
      Alert.alert('Upload failed', String(err?.message || err || 'Could not upload avatar'));
    } finally {
      setIsUploadingAvatar(false);
      setEditorUri(null);
      setEditorUploadMode(false);
    }
  };

  const syncProfileModeFromStorage = useCallback(async () => {
    try {
      const storedMode = await AsyncStorage.getItem(PROFILE_MODE_KEY);
      if (storedMode === 'buyer' || storedMode === 'seller') {
        if (storedMode !== mode) {
          setMode(storedMode);
          if (storedMode === 'buyer') {
            setBuyerTab('saved');
          }
        }
      }
    } catch {
      // Keep current mode if storage read fails.
    }
  }, [mode]);

  const loadDashboard = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      setError(null);
      if (mode === 'buyer') {
        const data = await getProfileDashboard();
        const userWithBust = data?.user ? { ...data.user, avatarUrl: cacheBustUrl(data.user.avatarUrl) } : null;
        setDashboard(data ? { ...data, user: userWithBust } : data);
        currentUser.setProfile(userWithBust);

        Promise.allSettled([getUserOrderHistory(), getUserAddresses()])
          .then(([ordersResult, addressesResult]) => {
            if (ordersResult.status === 'fulfilled') {
              setOrders(ordersResult.value);
            }
            if (addressesResult.status === 'fulfilled') {
              setAddresses(addressesResult.value);
            }
          })
          .catch(() => {
            // Secondary data is non-blocking for initial profile render.
          });
      } else {
        const data = await getProfileDashboard();
        const userWithBust = data?.user ? { ...data.user, avatarUrl: cacheBustUrl(data.user.avatarUrl) } : null;
        setDashboard(data ? { ...data, user: userWithBust } : data);
        currentUser.setProfile(userWithBust);

        getSellerOrders()
          .then((sellerOrderData) => {
            setSellerOrders(sellerOrderData.orders || []);
          })
          .catch(() => {
            // Non-blocking error for seller orders
          });
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load profile');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [mode]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    let mounted = true;

    const restoreMode = async () => {
      try {
        const storedMode = await AsyncStorage.getItem(PROFILE_MODE_KEY);
        if (mounted && (storedMode === 'buyer' || storedMode === 'seller')) {
          if (storedMode !== mode) {
            setMode(storedMode);
            if (storedMode === 'buyer') {
              setBuyerTab('saved');
            }
          }
        }
      } catch {
        // Keep default buyer mode if reading from storage fails.
      }
    };

    restoreMode();
    return () => {
      mounted = false;
    };
  }, [mode]);

  useEffect(() => {
    const loadNotificationStatus = async () => {
      try {
        const [sellerSeenCountString, newTabSeenCountString] = await Promise.all([
          AsyncStorage.getItem(SELLER_SEEN_COUNT_KEY),
          AsyncStorage.getItem(NEW_ORDERS_TAB_SEEN_COUNT_KEY),
        ]);

        setSellerSeenCount(Math.max(0, Number(sellerSeenCountString) || 0));
        setNewOrdersTabSeenCount(Math.max(0, Number(newTabSeenCountString) || 0));
      } catch {
        // Keep defaults if storage read fails.
      }
    };

    loadNotificationStatus();
  }, []);

  useFocusEffect(
    useCallback(() => {
      syncProfileModeFromStorage();
    }, [syncProfileModeFromStorage])
  );

  const onModeChange = (isSeller: boolean) => {
    const nextMode: ProfileMode = isSeller ? 'seller' : 'buyer';
    setMode(nextMode);
    setBuyerTab('saved'); // Reset tab when switching modes
    AsyncStorage.setItem(PROFILE_MODE_KEY, nextMode).catch(() => {
      // Non-blocking persistence failure.
    });

    if (isSeller) {
      const currentNewOrderCount = sellerOrderStats.newOrders;
      setSellerSeenCount(currentNewOrderCount);
      setPendingSellerBadgeClear(true);
      AsyncStorage.setItem(SELLER_SEEN_COUNT_KEY, String(currentNewOrderCount)).catch(() => {
        // Non-blocking persistence failure.
      });
    }
  };

  const clearNewOrderNotification = useCallback(async (currentNewOrderCount: number) => {
    setNewOrdersTabSeenCount(currentNewOrderCount);
    await AsyncStorage.setItem(NEW_ORDERS_TAB_SEEN_COUNT_KEY, String(currentNewOrderCount)).catch(() => {
      // Non-blocking persistence failure
    });
  }, []);

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          await AsyncStorage.removeItem('auth_token');
          await AsyncStorage.removeItem('user_id');
          router.replace('/login');
        },
      },
    ]);
  };

  const handleEditProfile = () => {
    router.push({
      pathname: '/edit-profile',
      params: {
        name: dashboard?.user.name || '',
        email: dashboard?.user.email || '',
        avatarUrl: dashboard?.user.avatarUrl || '',
      },
    });
  };

  const savedItems = useMemo(() => dashboard?.likedItems || [], [dashboard]);
  const sellerItems = useMemo(() => dashboard?.listedItems || [], [dashboard]);

  const sellerInsights = useMemo(() => {
    const listingCount = sellerItems.length;
    const lowStockItems = sellerItems.filter((item) => Number(item.stock) > 0 && Number(item.stock) <= 3);
    const outOfStockItems = sellerItems.filter((item) => Number(item.stock) <= 0);
    const customizableItems = sellerItems.filter((item) => Boolean(item.customizable ?? item.isCustomizable));
    const totalStockUnits = sellerItems.reduce((sum, item) => sum + Math.max(0, Number(item.stock) || 0), 0);
    const estimatedCatalogValue = sellerItems.reduce(
      (sum, item) => sum + (Math.max(0, Number(item.stock) || 0) * (Number(item.price) || 0)),
      0
    );

    const categoryMap = new Map<string, number>();
    for (const item of sellerItems) {
      const category = String(item.category || 'Others').trim() || 'Others';
      categoryMap.set(category, (categoryMap.get(category) || 0) + 1);
    }

    const topCategory = Array.from(categoryMap.entries())
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

    return {
      listingCount,
      lowStockItems,
      outOfStockItems,
      customizableCount: customizableItems.length,
      totalStockUnits,
      estimatedCatalogValue,
      topCategory,
    };
  }, [sellerItems]);

  const sellerOrderStats = useMemo(() => {
    const allItems = sellerOrders.flatMap((order) => order.items || []);
    const newOrders = allItems.filter((item) => ['new', 'processing', 'packed'].includes(item.fulfillmentStatus)).length;
    const inShipment = allItems.filter((item) => item.fulfillmentStatus === 'shipped').length;
    const delivered = allItems.filter((item) => item.fulfillmentStatus === 'delivered').length;
    return {
      newOrders,
      inShipment,
      delivered,
    };
  }, [sellerOrders]);

  useEffect(() => {
    if (!pendingSellerBadgeClear || mode !== 'seller') {
      return;
    }

    const currentNewOrderCount = sellerOrderStats.newOrders;
    setSellerSeenCount(currentNewOrderCount);
    setPendingSellerBadgeClear(false);
    AsyncStorage.setItem(SELLER_SEEN_COUNT_KEY, String(currentNewOrderCount)).catch(() => {
      // Non-blocking persistence failure.
    });
  }, [mode, pendingSellerBadgeClear, sellerOrderStats.newOrders]);

  const showSellerModeBadge = sellerOrderStats.newOrders > sellerSeenCount;
  const showNewOrdersTabBadge = sellerOrderStats.newOrders > newOrdersTabSeenCount;

  const restockCardWidth = useMemo(
    () => Math.min(232, Math.max(172, Math.round(screenWidth * 0.54))),
    [screenWidth]
  );

  const restockSnapInterval = restockCardWidth + 8;

  const sellerListHeader = useMemo(() => (
    <View style={styles.sellerHeaderWrap}>
      <View style={styles.sellerStageTabsRow}>
        {SELLER_STAGE_TABS.map((tab) => {
          const count = tab.key === 'new'
            ? sellerOrderStats.newOrders
            : tab.key === 'shipment'
              ? sellerOrderStats.inShipment
              : sellerOrderStats.delivered;

          return (
            <Pressable
              key={tab.key}
              style={({ pressed }) => [styles.sellerStageTabBtn, pressed && styles.sellerQuickActionBtnPressed]}
              onPress={() => {
                if (tab.key === 'new') {
                  clearNewOrderNotification(sellerOrderStats.newOrders);
                }
                router.push({
                  pathname: '/seller-orders/[stage]',
                  params: { stage: tab.key },
                });
              }}>
              <ThemedText style={styles.sellerStageTabTitle}>{tab.label}</ThemedText>
              <ThemedText style={styles.sellerStageTabCount}>{count}</ThemedText>
              {tab.key === 'new' && showNewOrdersTabBadge && (
                <View style={styles.newOrdersBellTag} />
              )}
            </Pressable>
          );
        })}
      </View>

      <View style={styles.sellerQuickActionsRow}>
        <Pressable style={({ pressed }) => [styles.sellerQuickActionBtn, pressed && styles.sellerQuickActionBtnPressed]} onPress={() => router.push('/upload')}>
          <Ionicons name="add-circle-outline" size={18} color="#9df0a2" />
          <ThemedText style={styles.sellerQuickActionText}>Add Listing</ThemedText>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.sellerQuickActionBtn, pressed && styles.sellerQuickActionBtnPressed]} onPress={() => router.push('/messages')}>
          <Ionicons name="chatbubble-ellipses-outline" size={18} color="#9fc8ff" />
          <ThemedText style={styles.sellerQuickActionText}>Messages</ThemedText>
        </Pressable>
      </View>

      <View style={styles.sellerInsightCard}>
        <View style={styles.sellerInsightHeader}>
          <ThemedText style={styles.sellerInsightTitle}>Inventory Health</ThemedText>
          <ThemedText style={styles.sellerInsightMeta}>Top: {sellerInsights.topCategory}</ThemedText>
        </View>
        <View style={styles.sellerInsightRow}>
          <ThemedText style={styles.sellerInsightLabel}>Low stock (≤3)</ThemedText>
          <ThemedText style={styles.sellerInsightValue}>{sellerInsights.lowStockItems.length}</ThemedText>
        </View>
        <View style={styles.sellerInsightRow}>
          <ThemedText style={styles.sellerInsightLabel}>Out of stock</ThemedText>
          <ThemedText style={styles.sellerInsightValue}>{sellerInsights.outOfStockItems.length}</ThemedText>
        </View>
        <View style={styles.sellerInsightRow}>
          <ThemedText style={styles.sellerInsightLabel}>Customizable listings</ThemedText>
          <ThemedText style={styles.sellerInsightValue}>{sellerInsights.customizableCount}</ThemedText>
        </View>
      </View>

      {[...sellerInsights.outOfStockItems, ...sellerInsights.lowStockItems].length > 0 ? (
        <LinearGradient colors={['#1a2433', '#111a27']} style={styles.sellerAlertWrap}>
          <View style={styles.sellerAlertHeaderRow}>
            <View style={styles.sellerAlertTitleRow}>
              <Ionicons name="alert-circle" size={14} color="#ffcf85" />
              <ThemedText style={styles.sellerAlertTitle}>Restock Alerts</ThemedText>
            </View>
            <View style={styles.sellerAlertCountPill}>
              <ThemedText style={styles.sellerAlertCount}>
                {[...sellerInsights.outOfStockItems, ...sellerInsights.lowStockItems].length} listing(s)
              </ThemedText>
            </View>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={restockSnapInterval}
            snapToAlignment="start"
            disableIntervalMomentum
            decelerationRate="fast"
            contentContainerStyle={styles.sellerAlertCarousel}>
            {[...sellerInsights.outOfStockItems, ...sellerInsights.lowStockItems].map((listing) => {
              const isOut = Number(listing.stock) <= 0;
              return (
                <LinearGradient
                  key={listing._id}
                  colors={isOut ? ['#3a2028', '#23151a'] : ['#2b3420', '#182015']}
                  style={[styles.sellerAlertSlideCard, { width: restockCardWidth }]}>
                  <View style={styles.sellerAlertTopRow}>
                    <ThemedText numberOfLines={1} style={styles.sellerAlertSlideTitle}>{listing.title}</ThemedText>
                    <ThemedText style={styles.sellerAlertSlideStock}>
                      {isOut ? '0 left' : `${listing.stock} left`}
                    </ThemedText>
                  </View>
                  <View style={styles.sellerAlertBottomRow}>
                    <Pressable
                      style={({ pressed }) => [styles.sellerAlertAction, pressed && styles.sellerAlertActionPressed]}
                      onPress={() => {
                        Haptics.selectionAsync().catch(() => {});
                        router.push({
                          pathname: '/seller-product/[id]',
                          params: { id: listing._id },
                        });
                      }}>
                      <ThemedText style={styles.sellerAlertActionText}>Review</ThemedText>
                    </Pressable>
                    <View style={[styles.sellerAlertStatusChip, isOut ? styles.sellerAlertStatusOut : styles.sellerAlertStatusLow]}>
                      <ThemedText style={styles.sellerAlertStatusText}>{isOut ? 'OUT' : 'LOW'}</ThemedText>
                    </View>
                  </View>
                </LinearGradient>
              );
            })}
          </ScrollView>
        </LinearGradient>
      ) : null}

    </View>
  ), [clearNewOrderNotification, showNewOrdersTabBadge, restockCardWidth, restockSnapInterval, router, sellerInsights, sellerOrderStats.delivered, sellerOrderStats.inShipment, sellerOrderStats.newOrders]);

  const sellerScrollableHeader = useMemo(() => (
    <View>
      <View style={styles.profileTop}>
          <View style={styles.avatarColumn}>
            {dashboard?.user?.avatarUrl && String(dashboard.user.avatarUrl).startsWith('local:') ? (
              <LocalAvatar id={dashboard.user.avatarUrl} size={72} style={styles.avatar} />
            ) : (
              <Image
                source={getAvatarUri(dashboard?.user.avatarUrl)}
                style={styles.avatar}
                contentFit="cover"
              />
            )}
            <Pressable
              style={({ pressed }) => [styles.changeProfileTextOnly, pressed && styles.changeProfileTextOnlyPressed]}
              onPress={() => setAvatarActionsVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="Change Avatar"
            >
              <ThemedText style={styles.changeProfileText}>Change profile</ThemedText>
            </Pressable>
          </View>
        <View style={styles.profileInfo}>
          <ThemedText style={styles.nameText}>{dashboard?.user.name || 'User'}</ThemedText>
          <ThemedText style={styles.subtleText}>{dashboard?.user.email || ''}</ThemedText>
          <ThemedText style={styles.subtleText}>Seller account</ThemedText>
        </View>
      </View>

      <View style={styles.profileTabs}>
        <Pressable
          style={[styles.profileTabButton, styles.profileTabButtonActive]}
          onPress={() => router.push('/seller-analytics')}>
          <View style={styles.profileTabTitleRow}>
            <Ionicons name="stats-chart-outline" size={16} color="#9fd1ff" />
            <ThemedText style={[styles.profileTabText, styles.profileTabTextActive]}>Analytics</ThemedText>
          </View>
        </Pressable>
        <Pressable
          style={[styles.profileTabButton, styles.profileTabButtonActive]}
          onPress={() => router.push('/seller-posts')}>
          <View style={styles.profileTabTitleRow}>
            <Ionicons name="grid-outline" size={16} color="#ffcf85" />
            <ThemedText style={[styles.profileTabText, styles.profileTabTextActive]}>My Posts</ThemedText>
          </View>
        </Pressable>
      </View>

      {sellerListHeader}
    </View>
  ), [dashboard?.user.avatarUrl, dashboard?.user.email, dashboard?.user.name, router, sellerListHeader]);

  const savedBoards = useMemo<SavedBoard[]>(() => {
    // Build dynamic boards from saved items by category so all liked categories are represented
    const groups = new Map<string, ProductItem[]>();
    savedItems.forEach((item) => {
      const raw = String(item.category || 'Uncategorized').trim();
      const key = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'uncategorized';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    });

    const boards: SavedBoard[] = Array.from(groups.entries()).map(([key, items]) => {
      const firstCat = String(items[0]?.category || key);
      const title = firstCat
        .trim()
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      return { id: key, title, subtitle: '', items };
    });

    // sort by item count descending so larger boards show first
    boards.sort((a, b) => b.items.length - a.items.length);
    return boards;
  }, [savedItems]);

  const selectedBoard = useMemo(
    () => savedBoards.find((board) => board.id === activeSavedBoard) || savedBoards[0] || null,
    [savedBoards, activeSavedBoard]
  );

  useEffect(() => {
    if (!savedBoards.some((board) => board.id === activeSavedBoard)) {
      setActiveSavedBoard(savedBoards[0]?.id || 'home');
    }
  }, [savedBoards, activeSavedBoard]);

  const handleOpenStockPrompt = (item: ProductItem) => {
    setStockPromptItem(item);
    setStockPromptValue('1');
  };

  const handleCloseStockPrompt = () => {
    setStockPromptItem(null);
    setStockPromptValue('1');
  };

  const handleAddStock = async (item: ProductItem, addBy: number) => {
    if (stockUpdatingId === item._id) return;

    if (!Number.isInteger(addBy) || addBy <= 0) {
      Alert.alert('Invalid quantity', 'Please enter a valid positive number.');
      return;
    }

    try {
      setStockUpdatingId(item._id);
      const updated = await addProductStock(item._id, addBy);

      setDashboard((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          listedItems: prev.listedItems.map((listed) =>
            listed._id === updated._id ? { ...listed, stock: updated.stock } : listed
          ),
        };
      });
    } catch (err: any) {
      Alert.alert('Stock update failed', err?.message || 'Could not add stock right now.');
    } finally {
      setStockUpdatingId(null);
      handleCloseStockPrompt();
    }
  };

  const handleConfirmStockIncrease = () => {
    if (!stockPromptItem) return;
    const parsed = Number(stockPromptValue);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      Alert.alert('Invalid quantity', 'Please enter a valid positive number.');
      return;
    }
    handleAddStock(stockPromptItem, parsed);
  };

  const renderProductCard = (item: ProductItem, sellerModeCard = false) => (
    <Pressable
      style={styles.card}
      onPress={() =>
        router.push({
          pathname: sellerModeCard ? '/seller-product/[id]' : '/product/[id]',
          params: { id: item._id },
        })
      }>
      <Image
        source={{ uri: item.images?.[0] || 'https://placehold.co/600x400?text=Handmade' }}
        style={styles.cardImage}
        contentFit="cover"
      />
      <View style={styles.cardBody}>
        <ThemedText numberOfLines={2} style={styles.cardTitle}>{item.title}</ThemedText>
        <ThemedText style={styles.priceText}>₹{item.price}</ThemedText>
        <ThemedText style={styles.subtleText}>{item.category}</ThemedText>
        {sellerModeCard ? (
          <View style={styles.sellerStockRow}>
            <ThemedText style={styles.subtleText}>{item.stock > 0 ? `Stock: ${item.stock}` : 'Out of stock'}</ThemedText>
            <Pressable
              style={[styles.addStockButton, stockUpdatingId === item._id && styles.addStockButtonDisabled]}
              onPress={() => handleOpenStockPrompt(item)}
              disabled={stockUpdatingId === item._id}>
              {stockUpdatingId === item._id ? (
                <ActivityIndicator size="small" color="#0a0a0a" />
              ) : (
                <Ionicons name="add" size={16} color="#0a0a0a" />
              )}
            </Pressable>
          </View>
        ) : (
          <ThemedText style={styles.subtleText}>{item.stock > 0 ? `Stock: ${item.stock}` : 'Out of stock'}</ThemedText>
        )}
      </View>
    </Pressable>
  );

  const renderOrderItem = ({ item }: { item: Order }) => (
    <Pressable
      style={styles.orderCard}
      onPress={() =>
        router.push({
          pathname: '/order-details',
          params: { orderId: item._id },
        })
      }>
      <View style={styles.orderHeader}>
        <ThemedText style={styles.orderIdText}>Order #{item._id.slice(-8).toUpperCase()}</ThemedText>
        <View
          style={[
            styles.statusBadge,
            item.status === 'delivered' && styles.statusDelivered,
            item.status === 'shipped' && styles.statusShipped,
            item.status === 'pending' && styles.statusPending,
            item.status === 'cancelled' && styles.statusCancelled,
          ]}>
          <ThemedText style={styles.statusText}>{item.status.toUpperCase()}</ThemedText>
        </View>
      </View>
      <ThemedText style={styles.orderDateText}>
        {new Date(item.createdAt).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })}
      </ThemedText>
      <View style={styles.orderItemsPreview}>
        <ThemedText style={styles.orderItemCount}>{item.items.length} item(s)</ThemedText>
        <ThemedText style={styles.orderTotalText}>₹{item.totalAmount.toFixed(2)}</ThemedText>
      </View>
    </Pressable>
  );

  const renderAddressItem = ({ item, index }: { item: UserAddress; index: number }) => (
    <Pressable
      style={styles.addressCard}
      onPress={() =>
        router.push({
          pathname: '/edit-address',
          params: { index: index.toString() },
        })
      }>
      <View style={styles.addressHeader}>
        <ThemedText style={styles.addressLabel}>{item.label}</ThemedText>
        {item.isDefault && <ThemedText style={styles.defaultBadge}>DEFAULT</ThemedText>}
      </View>
      <ThemedText style={styles.addressName}>{item.fullName}</ThemedText>
      <ThemedText style={styles.addressText}>
        {item.street}, {item.city}, {item.state} {item.postalCode}
      </ThemedText>
      <ThemedText style={styles.addressText}>{item.phoneNumber}</ThemedText>
    </Pressable>
  );

  const renderRow = ({ item }: { item: ProductItem }) => renderProductCard(item);

  const statusLabelMap: Record<SellerFulfillmentStatus, string> = {
    new: 'New',
    processing: 'Processing',
    packed: 'Packed',
    shipped: 'Shipped',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
  };

  const nextShipmentStatusMap: Record<SellerFulfillmentStatus, SellerFulfillmentStatus | null> = {
    new: 'processing',
    processing: 'packed',
    packed: 'shipped',
    shipped: 'delivered',
    delivered: null,
    cancelled: null,
  };

  const handleAdvanceShipment = async (orderId: string, item: SellerOrderItem) => {
    const nextStatus = nextShipmentStatusMap[item.fulfillmentStatus];
    if (!nextStatus) return;

    const key = `${orderId}-${item.itemIndex}`;
    try {
      setSellerOrderUpdatingKey(key);
      const updatedOrder = await updateSellerOrderItemStatus(orderId, item.itemIndex, nextStatus);
      setSellerOrders((prev) => prev.map((entry) => (entry.id === updatedOrder.id ? updatedOrder : entry)));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (err: any) {
      Alert.alert('Shipment update failed', err?.message || 'Could not update this order item right now.');
    } finally {
      setSellerOrderUpdatingKey(null);
    }
  };

  const renderSellerOrderRow = ({ item }: { item: SellerOrder }) => (
    <Pressable
      style={styles.sellerOrderCard}
      onPress={() => {
        setExpandedSellerOrderIds((prev) => (
          prev.includes(item.id)
            ? prev.filter((entry) => entry !== item.id)
            : [...prev, item.id]
        ));
      }}>
      <View style={styles.sellerOrderHeaderRow}>
        <View style={styles.sellerOrderHeaderMetaWrap}>
          <ThemedText style={styles.sellerOrderTitle}>Order #{item.orderId.slice(-8).toUpperCase()}</ThemedText>
          <ThemedText style={styles.sellerOrderBuyer}>Buyer: {item.buyer?.name || 'Buyer'} • {item.items.length} item(s)</ThemedText>
        </View>
        <View style={styles.sellerOrderHeaderRightWrap}>
          <ThemedText style={styles.sellerOrderDate}>
            {new Date(item.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </ThemedText>
          <Ionicons
            name={expandedSellerOrderIds.includes(item.id) ? 'chevron-up' : 'chevron-down'}
            size={18}
            color="#9cb0cc"
          />
        </View>
      </View>

      <View style={styles.sellerOrderSummaryRow}>
        <ThemedText style={styles.sellerOrderAddress}>
          Ship to: {item.shippingAddress?.city}, {item.shippingAddress?.postalCode}
        </ThemedText>
        <ThemedText style={styles.sellerOrderPayment}>Payment: {item.paymentStatus}</ThemedText>
      </View>

      {expandedSellerOrderIds.includes(item.id) ? (
        <View style={styles.sellerExpandedPanel}>
          <View style={styles.sellerAddressDetailCard}>
            <ThemedText style={styles.sellerAddressDetailTitle}>Fulfillment Address</ThemedText>
            <ThemedText style={styles.sellerAddressDetailText}>{item.shippingAddress?.fullName}</ThemedText>
            <ThemedText style={styles.sellerAddressDetailText}>{item.shippingAddress?.phoneNumber}</ThemedText>
            <ThemedText style={styles.sellerAddressDetailText}>{item.shippingAddress?.street}</ThemedText>
            <ThemedText style={styles.sellerAddressDetailText}>
              {item.shippingAddress?.city}, {item.shippingAddress?.state} {item.shippingAddress?.postalCode}
            </ThemedText>
          </View>

          {item.items.map((orderItem) => {
            const key = `${item.id}-${orderItem.itemIndex}`;
            const latestEvent = orderItem.trackingEvents?.[orderItem.trackingEvents.length - 1];
            const isUpdating = sellerOrderUpdatingKey === key;
            const isCancelled = orderItem.fulfillmentStatus === 'cancelled';
            const currentStatusIndex = SELLER_FLOW_STEPS.indexOf(orderItem.fulfillmentStatus);

            return (
              <View key={key} style={styles.sellerOrderItemCard}>
                <View style={styles.sellerOrderItemTopRow}>
                  <View style={styles.sellerOrderItemTextWrap}>
                    <ThemedText numberOfLines={1} style={styles.sellerOrderItemTitle}>{orderItem.title}</ThemedText>
                    <ThemedText style={styles.sellerOrderItemMeta}>Qty {orderItem.quantity} • ₹{orderItem.lineTotal.toFixed(2)}</ThemedText>
                  </View>
                  <View style={styles.sellerStatusBadge}>
                    <ThemedText style={styles.sellerStatusBadgeText}>{statusLabelMap[orderItem.fulfillmentStatus]}</ThemedText>
                  </View>
                </View>

                <ThemedText style={styles.sellerTrackingText}>
                  {latestEvent
                    ? `Latest: ${statusLabelMap[latestEvent.status]} • ${new Date(latestEvent.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                    : 'No tracking update yet'}
                </ThemedText>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.sellerFlowRow}>
                  {SELLER_FLOW_STEPS.map((step, stepIndex) => {
                    const isReached = stepIndex <= currentStatusIndex;
                    const isCurrent = step === orderItem.fulfillmentStatus;
                    const isNext = stepIndex === currentStatusIndex + 1;
                    const canPress = !isCancelled && isNext && !isUpdating;

                    return (
                      <Pressable
                        key={`${key}-${step}`}
                        style={[
                          styles.sellerFlowStep,
                          isReached && styles.sellerFlowStepReached,
                          isCurrent && styles.sellerFlowStepCurrent,
                          canPress && styles.sellerFlowStepAction,
                        ]}
                        onPress={() => {
                          if (!canPress) return;
                          handleAdvanceShipment(item.id, orderItem);
                        }}
                        disabled={!canPress}>
                        <ThemedText
                          style={[
                            styles.sellerFlowStepText,
                            isReached && styles.sellerFlowStepTextReached,
                            canPress && styles.sellerFlowStepTextAction,
                          ]}>
                          {statusLabelMap[step]}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                <View style={styles.sellerActionRow}>
                  {isUpdating ? (
                    <View style={styles.sellerUpdatingWrap}>
                      <ActivityIndicator size="small" color="#9df0a2" />
                      <ThemedText style={styles.sellerUpdatingText}>Updating status...</ThemedText>
                    </View>
                  ) : isCancelled ? (
                    <ThemedText style={styles.sellerStepHintText}>This item is cancelled and cannot move further.</ThemedText>
                  ) : (
                    <ThemedText style={styles.sellerStepHintText}>
                      Tap the highlighted next step to move this item forward.
                    </ThemedText>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </Pressable>
  );

  const switchBuyerTabBySwipe = useCallback((direction: 'next' | 'prev') => {
    const currentIndex = BUYER_TABS.indexOf(buyerTab);
    if (currentIndex < 0) return;

    const nextIndex = direction === 'next'
      ? Math.min(currentIndex + 1, BUYER_TABS.length - 1)
      : Math.max(currentIndex - 1, 0);

    if (nextIndex !== currentIndex) {
      setBuyerTab(BUYER_TABS[nextIndex]);
    }
  }, [buyerTab]);

  const onBuyerSwipeStateChange = useCallback((event: PanGestureHandlerStateChangeEvent) => {
    if (mode !== 'buyer') return;

    const { state, translationX, translationY, velocityX } = event.nativeEvent;
    if (state !== State.END) return;

    const absDx = Math.abs(translationX);
    const absDy = Math.abs(translationY);

    // Require substantial horizontal displacement and more horizontal than vertical
    if (absDx < 48 || absDx < absDy * 1.1) return;

    // Determine direction: prioritize translationX, use velocity as secondary indicator
    const isMovingRight = translationX > 0;
    const isMovingLeft = translationX < 0;
    const hasHighVelocityRight = velocityX > 450;
    const hasHighVelocityLeft = velocityX < -450;

    // Require consistent direction: translation and velocity should not contradict
    if (isMovingRight && !hasHighVelocityLeft) {
      switchBuyerTabBySwipe('prev');
    } else if (isMovingLeft && !hasHighVelocityRight) {
      switchBuyerTabBySwipe('next');
    }
  }, [mode, switchBuyerTabBySwipe]);

  if (loading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator size="large" color="#fff" />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <AvatarPickerModal
        visible={avatarModalVisible}
        avatars={defaultAvatars}
        onSelect={handleAvatarSelect}
        onClose={() => setAvatarModalVisible(false)}
        currentAvatar={dashboard?.user.avatarUrl}
      />
      <AvatarActionsModal
        visible={avatarActionsVisible}
        onClose={() => setAvatarActionsVisible(false)}
        onOpenDefault={() => setAvatarModalVisible(true)}
        onOpenUpload={() => pickImage()}
      />
      <View style={styles.header}>
        <ThemedText type="title" style={styles.headerTitle}>Profile</ThemedText>
        <View style={styles.switchWrap}>
          <ThemedText style={[styles.switchLabel, mode === 'buyer' && styles.switchLabelActive]}>Buyer</ThemedText>
          <Switch
            value={mode === 'seller'}
            onValueChange={onModeChange}
            trackColor={{ false: '#2a3340', true: '#254028' }}
            thumbColor={mode === 'seller' ? '#9df0a2' : '#e4e8ef'}
          />
          <View style={styles.sellerLabelContainer}>
            <ThemedText style={[styles.switchLabel, mode === 'seller' && styles.switchLabelActive]}>Seller</ThemedText>
            {showSellerModeBadge && (
              <View style={styles.sellerBellTag} />
            )}
          </View>
        </View>
      </View>

      {/* Profile Card */}
      {mode !== 'seller' && (
        <View style={styles.profileTop}>
          <View style={styles.avatarColumn}>
            {dashboard?.user?.avatarUrl && String(dashboard.user.avatarUrl).startsWith('local:') ? (
              <LocalAvatar id={dashboard.user.avatarUrl} size={72} style={styles.avatar} />
            ) : (
              <Image
                source={getAvatarUri(dashboard?.user.avatarUrl)}
                style={styles.avatar}
                contentFit="cover"
              />
            )}
            <Pressable
              style={({ pressed }) => [styles.changeProfileTextOnly, pressed && styles.changeProfileTextOnlyPressed]}
              onPress={() => setAvatarActionsVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="Change Avatar"
            >
              <ThemedText style={styles.changeProfileText}>Change profile</ThemedText>
            </Pressable>
          </View>
        <View style={styles.profileInfo}>
          <ThemedText style={styles.nameText}>{dashboard?.user.name || 'User'}</ThemedText>
          <ThemedText style={styles.subtleText}>{dashboard?.user.email || ''}</ThemedText>
          <ThemedText style={styles.subtleText}>Buyer account</ThemedText>
        </View>
        </View>
      )}

      {/* Buyer Tabs */}
      {mode === 'buyer' && (
        <View style={styles.tabsRow}>
          <Pressable
            style={[styles.tab, buyerTab === 'saved' && styles.tabActive]}
            onPress={() => setBuyerTab('saved')}>
            <ThemedText style={[styles.tabText, buyerTab === 'saved' && styles.tabTextActive]}>Saved</ThemedText>
          </Pressable>
          <Pressable
            style={[styles.tab, buyerTab === 'orders' && styles.tabActive]}
            onPress={() => setBuyerTab('orders')}>
            <ThemedText style={[styles.tabText, buyerTab === 'orders' && styles.tabTextActive]}>Orders</ThemedText>
          </Pressable>
          <Pressable
            style={[styles.tab, buyerTab === 'addresses' && styles.tabActive]}
            onPress={() => setBuyerTab('addresses')}>
            <ThemedText style={[styles.tabText, buyerTab === 'addresses' && styles.tabTextActive]}>Addresses</ThemedText>
          </Pressable>
          <Pressable
            style={[styles.tab, buyerTab === 'account' && styles.tabActive]}
            onPress={() => setBuyerTab('account')}>
            <ThemedText style={[styles.tabText, buyerTab === 'account' && styles.tabTextActive]}>Account</ThemedText>
          </Pressable>
        </View>
      )}

      {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}

      {mode === 'buyer' && (
        <PanGestureHandler
          activeOffsetX={[-16, 16]}
          failOffsetY={[-14, 14]}
          onHandlerStateChange={onBuyerSwipeStateChange}>
          <View style={styles.buyerContent}>
          {/* Saved Items Tab */}
          {buyerTab === 'saved' && (
            <FlatList
              data={selectedBoard?.items || savedItems}
              keyExtractor={(item) => item._id}
              numColumns={2}
              columnWrapperStyle={styles.row}
              renderItem={renderRow}
              refreshing={refreshing}
              onRefresh={() => loadDashboard(true)}
              contentContainerStyle={styles.listContent}
              ListHeaderComponent={
                savedItems.length > 0 && savedBoards.length > 0 ? (
                  <View style={styles.savedBoardsHeader}>
                    {savedBoards.length > 1 ? (
                      // When multiple category boards exist show a single-row selector where the active
                      // board label is the only prominent heading.
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.savedBoardSelectorRow}
                      >
                        {savedBoards.map((board) => (
                          <Pressable
                            key={board.id}
                            onPress={() => setActiveSavedBoard(board.id)}
                            style={({ pressed }) => [
                              styles.savedBoardSelectorBtn,
                              pressed && styles.savedBoardSelectorBtnPressed,
                            ]}
                          >
                            <ThemedText style={[
                              styles.savedBoardSelectorText,
                              activeSavedBoard === board.id && styles.savedBoardSelectorTextActive,
                            ]}>{board.title}</ThemedText>
                          </Pressable>
                        ))}
                      </ScrollView>
                    ) : (
                      // Single category: show the heading plainly
                      <View style={styles.savedBoardHeaderSingle}>
                        <ThemedText style={styles.savedBoardInfoTitle}>{selectedBoard?.title || 'Saved Items'}</ThemedText>
                      </View>
                    )}
                  </View>
                ) : null
              }
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Ionicons name="heart-outline" size={48} color="#666" />
                  <ThemedText style={styles.emptyTitle}>No Saved Items</ThemedText>
                  <ThemedText style={styles.subtleText}>Like items from feed to see them here.</ThemedText>
                </View>
              }
            />
          )}

          {/* Orders Tab */}
          {buyerTab === 'orders' && (
            <FlatList
              data={orders}
              keyExtractor={(item) => item._id}
              renderItem={renderOrderItem}
              refreshing={refreshing}
              onRefresh={() => loadDashboard(true)}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Ionicons name="document-outline" size={48} color="#666" />
                  <ThemedText style={styles.emptyTitle}>No Orders</ThemedText>
                  <ThemedText style={styles.subtleText}>You haven&apos;t placed any orders yet.</ThemedText>
                  <Pressable
                    style={styles.exploreButton}
                    onPress={() => router.replace('/feed')}>
                    <ThemedText style={styles.exploreButtonText}>Start Shopping</ThemedText>
                  </Pressable>
                </View>
              }
            />
          )}

          {/* Addresses Tab */}
          {buyerTab === 'addresses' && (
            <View style={styles.addressesContainer}>
              <Pressable style={styles.addAddressButton} onPress={() => router.push('/add-address')}>
                <Ionicons name="add-circle" size={24} color="#9df0a2" />
                <ThemedText style={styles.addAddressText}>Add New Address</ThemedText>
              </Pressable>
              <FlatList
                data={addresses}
                keyExtractor={(_, index) => `address-${index}`}
                renderItem={(props) => renderAddressItem({ ...props, index: addresses.indexOf(props.item) })}
                scrollEnabled={false}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={
                  <View style={styles.emptyState}>
                    <Ionicons name="location-outline" size={48} color="#666" />
                    <ThemedText style={styles.emptyTitle}>No Addresses</ThemedText>
                    <ThemedText style={styles.subtleText}>Add a shipping address to get started.</ThemedText>
                  </View>
                }
              />
            </View>
          )}

          {/* Account Settings Tab */}
          {buyerTab === 'account' && (
                <ScrollView style={styles.accountContainer} contentContainerStyle={styles.accountContent}>
              <ThemedText style={styles.sectionTitleFirst}>Account Information</ThemedText>
              <Pressable style={styles.settingItem} onPress={handleEditProfile}>
                <View style={styles.settingItemLeft}>
                  <Ionicons name="person-circle-outline" size={24} color="#9df0a2" />
                  <View>
                    <ThemedText style={styles.settingLabel}>Edit Profile</ThemedText>
                    <ThemedText style={styles.settingValue}>{dashboard?.user.name}</ThemedText>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={24} color="#666" />
              </Pressable>

              <ThemedText style={styles.sectionTitle}>Account Stats</ThemedText>
              <View style={styles.statsRow}>
                <View style={styles.statCard}>
                  <ThemedText style={styles.statValue}>{dashboard?.user.stats.likedCount || 0}</ThemedText>
                  <ThemedText style={styles.statLabel}>Saved Items</ThemedText>
                </View>
                <View style={styles.statCard}>
                  <ThemedText style={styles.statValue}>{orders.length}</ThemedText>
                  <ThemedText style={styles.statLabel}>Orders</ThemedText>
                </View>
                <View style={styles.statCard}>
                  <ThemedText style={styles.statValue}>{addresses.length}</ThemedText>
                  <ThemedText style={styles.statLabel}>Addresses</ThemedText>
                </View>
              </View>

              <ThemedText style={styles.sectionTitle}>Preferences</ThemedText>
              <Pressable style={styles.settingItem} onPress={() => {}}>
                <View style={styles.settingItemLeft}>
                  <Ionicons name="notifications-outline" size={24} color="#9df0a2" />
                  <ThemedText style={styles.settingLabel}>Notifications</ThemedText>
                </View>
                <Switch
                  value={true}
                  onValueChange={() => {}}
                  trackColor={{ false: '#2a3340', true: '#254028' }}
                  thumbColor="#e4e8ef"
                />
              </Pressable>

              <ThemedText style={styles.sectionTitle}>Danger Zone</ThemedText>
              <Pressable style={styles.logoutButton} onPress={handleLogout}>
                <Ionicons name="log-out-outline" size={24} color="#ff6b6b" />
                <ThemedText style={styles.logoutText}>Logout</ThemedText>
              </Pressable>
            </ScrollView>
          )}
          </View>
        </PanGestureHandler>
      )}

      {/* Seller Content */}
      {mode === 'seller' && (
        <FlatList
          data={[]}
          keyExtractor={(item) => item.id}
          renderItem={renderSellerOrderRow}
          refreshing={refreshing}
          onRefresh={() => loadDashboard(true)}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={sellerScrollableHeader}
        />
      )}

      <Modal
        visible={Boolean(stockPromptItem)}
        transparent
        animationType="fade"
        onRequestClose={handleCloseStockPrompt}>
        <View style={styles.stockModalBackdrop}>
          <View style={styles.stockModalCard}>
            <ThemedText style={styles.stockModalTitle}>Add Stock</ThemedText>
            <ThemedText numberOfLines={2} style={styles.stockModalSubtitle}>
              {stockPromptItem?.title}
            </ThemedText>

            <ThemedText style={styles.stockModalLabel}>Increase by</ThemedText>
            <View style={styles.stockQuickRow}>
              {[1, 5, 10].map((qty) => (
                <Pressable
                  key={qty}
                  style={[styles.stockQuickChip, stockPromptValue === String(qty) && styles.stockQuickChipActive]}
                  onPress={() => setStockPromptValue(String(qty))}>
                  <ThemedText style={[styles.stockQuickChipText, stockPromptValue === String(qty) && styles.stockQuickChipTextActive]}>
                    +{qty}
                  </ThemedText>
                </Pressable>
              ))}
            </View>

            <TextInput
              value={stockPromptValue}
              onChangeText={(text) => setStockPromptValue(text.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              style={styles.stockModalInput}
              placeholder="Enter quantity"
              placeholderTextColor="#8e9bb2"
            />

            <View style={styles.stockModalActions}>
              <Pressable style={styles.stockModalCancelBtn} onPress={handleCloseStockPrompt}>
                <ThemedText style={styles.stockModalCancelText}>Cancel</ThemedText>
              </Pressable>
              <Pressable style={styles.stockModalConfirmBtn} onPress={handleConfirmStockIncrease}>
                <ThemedText style={styles.stockModalConfirmText}>Update Stock</ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Avatar Editor Modal */}
      <AvatarEditor
        visible={editorVisible}
        imageUri={editorUri}
        onCancel={() => { setEditorVisible(false); setEditorUploadMode(false); }}
        onSave={handleEditorSave}
        primaryActionLabel={editorUploadMode ? 'Upload' : undefined}
        setOnSaveApplyToProfile={editorUploadMode}
      />

      {/* Bottom Tab Bar */}
      <View style={styles.tabBar}>
        <Pressable style={styles.tabItem} onPress={() => router.push('/feed')}>
          <Ionicons name="home-outline" size={26} color="#fff" />
        </Pressable>
        <Pressable style={styles.tabItem} onPress={() => router.push(mode === 'seller' ? '/upload' : '/explore')}>
          <Ionicons name={mode === 'seller' ? 'add' : 'search-outline'} size={mode === 'seller' ? 30 : 26} color="#fff" />
        </Pressable>
        <Pressable style={styles.tabItem} onPress={() => router.push('/profile')}>
          {dashboard?.user?.avatarUrl ? (
            String(dashboard.user.avatarUrl).startsWith('local:') ? (
              <LocalAvatar id={dashboard.user.avatarUrl} size={36} style={styles.tabAvatar} />
            ) : (
              <Image
                source={getAvatarUri(dashboard.user.avatarUrl)}
                style={styles.tabAvatar}
                contentFit="cover"
              />
            )
          ) : (
            <Ionicons name="person" size={26} color="#fff" />
          )}
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 64,
    paddingBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: '700',
    color: '#fff',
  },
  switchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 0,
  },
  switchLabel: {
    color: '#8e9bb2',
    fontWeight: '600',
    fontSize: 12,
  },
  switchLabelActive: {
    color: '#ffffff',
  },
  sellerLabelContainer: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sellerBellTag: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#7cf7ff',
    shadowColor: '#24d8ff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.95,
    shadowRadius: 4,
    elevation: 5,
  },
  newOrdersBellTag: {
    position: 'absolute',
    top: 3,
    right: 16,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#7cf7ff',
    shadowColor: '#24d8ff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.95,
    shadowRadius: 4,
    elevation: 5,
  },
  profileTop: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  avatar: {
    width: 82,
    height: 82,
    borderRadius: 41,
    borderWidth: 2,
    borderColor: '#2d2d2d',
  },
  profileInfo: {
    flex: 1,
    justifyContent: 'center',
    marginTop: -28,
  },
  nameText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  profileTabs: {
    flexDirection: 'row',
    marginTop: 6,
    marginBottom: 14,
    marginHorizontal: 16,
    gap: 10,
    backgroundColor: 'transparent',
    borderRadius: 0,
    padding: 0,
    borderWidth: 0,
  },
  profileTabButton: {
    flex: 1,
    borderWidth: 0,
    borderRadius: 14,
    paddingVertical: 11,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  profileTabButtonActive: {
    backgroundColor: '#192334',
    borderWidth: 1,
    borderColor: '#2a3a4f',
  },
  profileTabText: {
    color: '#bfc8d7',
    fontWeight: '600',
  },
  profileTabTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  profileTabCount: {
    marginTop: 2,
    color: '#8f9cb1',
    fontSize: 12,
  },
  profileTabTextActive: {
    color: '#fff',
  },
  // Tabs Navigation
  tabsRow: {
    flexDirection: 'row',
    marginHorizontal: 0,
    marginBottom: 0,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#9df0a2',
  },
  tabText: {
    color: '#8e9bb2',
    fontWeight: '600',
    fontSize: 14,
  },
  tabTextActive: {
    color: '#fff',
  },
  buyerContent: {
    flex: 1,
  },
  // Order Styles
  orderCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    backgroundColor: '#141922',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#272f3d',
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  orderIdText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#2a3340',
  },
  statusDelivered: {
    backgroundColor: '#1a4d2e',
  },
  statusShipped: {
    backgroundColor: '#2d3d5c',
  },
  statusPending: {
    backgroundColor: '#4d3d1a',
  },
  statusCancelled: {
    backgroundColor: '#4d1a1a',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#9df0a2',
  },
  orderDateText: {
    fontSize: 12,
    color: '#8e9bb2',
    marginBottom: 8,
  },
  orderItemsPreview: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  orderItemCount: {
    fontSize: 12,
    color: '#b4b4b4',
  },
  orderTotalText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#9df0a2',
  },
  // Address Styles
  addressesContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 0,
    paddingBottom: 92,
  },
  addAddressButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 14,
    backgroundColor: '#141922',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#272f3d',
    gap: 10,
  },
  addAddressText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9df0a2',
  },
  addressCard: {
    marginBottom: 12,
    padding: 14,
    backgroundColor: '#141922',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#272f3d',
  },
  addressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  addressLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  defaultBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9df0a2',
    backgroundColor: '#1a4d2e',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  addressName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  addressText: {
    fontSize: 12,
    color: '#b4b4b4',
    marginBottom: 2,
  },
  // Account Settings Styles
  accountContainer: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  accountContent: {
    paddingHorizontal: 16,
    paddingTop: 0,
    paddingVertical: 0,
    paddingBottom: 92,
  },
  avatarModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarModalCard: {
    backgroundColor: '#181f2a',
    borderRadius: 18,
    padding: 20,
    width: 320,
    maxHeight: 480,
    alignItems: 'center',
  },
  avatarModalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 12,
  },
  avatarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 16,
  },
  avatarOption: {
    margin: 6,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  avatarOptionSelected: {
    borderColor: '#9df0a2',
    borderWidth: 3,
  },
  avatarOptionImg: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  avatarModalCloseBtn: {
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 8,
    backgroundColor: '#232c3b',
  },
  avatarModalCloseText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  avatarChangeBtn: {
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#232c3b',
    alignSelf: 'flex-start',
  },
  avatarChangeInline: {
    marginLeft: 12,
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarColumn: {
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  changeProfilePill: {
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minHeight: 26,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f1720',
    borderWidth: 1,
    borderColor: '#24313f',
    shadowColor: '#0a0a0a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 1,
  },
  changeProfilePillPressed: {
    transform: [{ scale: 0.992 }],
    opacity: 0.96,
  },
  changeProfileIcon: {
    marginRight: 3,
  },
  changeProfileText: {
    color: '#9df0a2',
    fontWeight: '700',
    fontSize: 11,
    textTransform: 'capitalize',
  },
  changeProfileTextOnly: {
    marginTop: 6,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  changeProfileTextOnlyPressed: {
    opacity: 0.85,
  },
  avatarChangeBtnText: {
    color: '#9df0a2',
    fontWeight: '600',
    fontSize: 15,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarActionRow: {
    flexDirection: 'row',
    marginTop: 10,
  },
  avatarPreview: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#111',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#8e9bb2',
    marginTop: 20,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionTitleFirst: {
    fontSize: 14,
    fontWeight: '700',
    color: '#8e9bb2',
    marginTop: 0,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    backgroundColor: '#141922',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#272f3d',
  },
  settingItemLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  settingLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  settingValue: {
    fontSize: 12,
    color: '#8e9bb2',
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  statCard: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 16,
    backgroundColor: '#141922',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#272f3d',
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#9df0a2',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 11,
    color: '#8e9bb2',
    fontWeight: '600',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    backgroundColor: '#4d1a1a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#703030',
  },
  logoutText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ff6b6b',
  },
  emptyState: {
    paddingTop: 30,
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginTop: 12,
    marginBottom: 4,
  },
  subtleText: {
    fontSize: 13,
    color: '#b4b4b4',
    marginTop: 2,
  },
  errorText: {
    marginHorizontal: 14,
    marginBottom: 8,
    color: '#ff6b6b',
  },
  listContent: {
    paddingHorizontal: 10,
    paddingTop: 0,
    paddingBottom: 92,
  },
  savedBoardsHeader: {
    marginTop: 10,
    marginBottom: 12,
  },
  savedBoardRowPlain: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  savedBoardRowPlainText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  savedBoardRow: {
    paddingHorizontal: 2,
    paddingBottom: 10,
    gap: 8,
  },
  savedBoardChip: {
    borderRadius: 999,
    borderWidth: 0,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  savedBoardChipActive: {
    borderColor: 'transparent',
    backgroundColor: 'transparent',
  },
  savedBoardChipText: {
    color: '#a6b3c6',
    fontSize: 13,
    fontWeight: '600',
  },
  savedBoardChipTextActive: {
    color: '#c9f8ce',
  },
  savedBoardInfoCard: {
    marginHorizontal: 0,
    marginBottom: 8,
    borderRadius: 0,
    borderWidth: 0,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  savedBoardInfoTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  savedBoardInfoSubtitle: {
    color: '#9aa7b8',
    fontSize: 13,
    marginTop: 4,
    textDecorationLine: 'none',
  },
  // Selector for saved boards (text-only, minimal)
  savedBoardSelectorRow: {
    paddingHorizontal: 6,
    paddingBottom: 6,
    alignItems: 'center',
    gap: 12,
  },
  savedBoardSelectorBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  savedBoardSelectorBtnPressed: {
    opacity: 0.8,
  },
  savedBoardSelectorBtnActive: {},
  savedBoardSelectorText: {
    color: '#9fb0c6',
    fontSize: 13,
    fontWeight: '600',
  },
  savedBoardSelectorTextActive: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 18,
  },
  savedBoardHeaderSingle: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  sellerHeaderWrap: {
    marginBottom: 10,
    gap: 10,
  },
  sellerMetricRow: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 2,
  },
  sellerMetricCard: {
    flex: 1,
    backgroundColor: '#131a25',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#273245',
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  sellerMetricValue: {
    color: '#9df0a2',
    fontSize: 14,
    fontWeight: '700',
  },
  sellerMetricLabel: {
    color: '#8fa0b8',
    fontSize: 11,
    marginTop: 2,
    fontWeight: '600',
  },
  sellerStageTabsRow: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 2,
  },
  sellerStageTabBtn: {
    flex: 1,
    position: 'relative',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2b3a4f',
    backgroundColor: '#141f2e',
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sellerStageTabTitle: {
    color: '#d9e6f8',
    fontSize: 11,
    fontWeight: '700',
  },
  sellerStageTabCount: {
    marginTop: 2,
    color: '#9df0a2',
    fontSize: 12,
    fontWeight: '800',
  },
  sellerQuickActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 2,
  },
  sellerQuickActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2b3a4f',
    backgroundColor: '#141f2e',
    paddingVertical: 10,
  },
  sellerQuickActionBtnPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.98 }],
  },
  sellerQuickActionText: {
    color: '#d9e6f8',
    fontSize: 12,
    fontWeight: '700',
  },
  sellerInsightCard: {
    marginHorizontal: 2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#243248',
    backgroundColor: '#111a28',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  sellerInsightHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  sellerInsightTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  sellerInsightMeta: {
    color: '#8fa0b8',
    fontSize: 11,
    fontWeight: '600',
  },
  sellerInsightRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sellerInsightLabel: {
    color: '#a7b6cb',
    fontSize: 12,
  },
  sellerInsightValue: {
    color: '#d7fce2',
    fontSize: 12,
    fontWeight: '700',
  },
  sellerAlertWrap: {
    marginHorizontal: 2,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#33455d',
    paddingVertical: 10,
  },
  sellerAlertHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  sellerAlertTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  sellerAlertTitle: {
    color: '#ecf4ff',
    fontSize: 13,
    fontWeight: '700',
  },
  sellerAlertCountPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#3c506a',
    backgroundColor: '#152334',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  sellerAlertCount: {
    color: '#c9d9ee',
    fontSize: 11,
    fontWeight: '700',
  },
  sellerAlertCarousel: {
    paddingHorizontal: 12,
    paddingRight: 4,
  },
  sellerAlertSlideCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3a4b62',
    paddingHorizontal: 9,
    paddingVertical: 9,
    marginRight: 8,
  },
  sellerAlertTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 5,
    gap: 8,
  },
  sellerAlertSlideTitle: {
    color: '#f0f6ff',
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
    marginBottom: 0,
  },
  sellerAlertBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sellerAlertSlideStock: {
    color: '#b6c9e2',
    fontSize: 10,
    fontWeight: '700',
  },
  sellerAlertStatusChip: {
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
  },
  sellerAlertStatusLow: {
    backgroundColor: '#24372a',
    borderColor: '#4e9561',
  },
  sellerAlertStatusOut: {
    backgroundColor: '#472028',
    borderColor: '#b85d76',
  },
  sellerAlertStatusText: {
    color: '#eff7ff',
    fontSize: 10,
    fontWeight: '700',
  },
  sellerAlertAction: {
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#4c617d',
    backgroundColor: '#1c2b40',
  },
  sellerAlertActionPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  sellerAlertActionText: {
    color: '#deebfc',
    fontSize: 10,
    fontWeight: '700',
  },
  sellerOrderCard: {
    marginHorizontal: 2,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a3850',
    backgroundColor: '#111a28',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sellerOrderHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sellerOrderHeaderMetaWrap: {
    flex: 1,
    marginRight: 8,
  },
  sellerOrderHeaderRightWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sellerOrderTitle: {
    color: '#f3f8ff',
    fontSize: 13,
    fontWeight: '700',
  },
  sellerOrderBuyer: {
    marginTop: 2,
    color: '#9cb0cc',
    fontSize: 11,
  },
  sellerOrderDate: {
    color: '#94a8c3',
    fontSize: 11,
    fontWeight: '600',
  },
  sellerOrderAddress: {
    marginTop: 6,
    color: '#c2d4ec',
    fontSize: 11,
  },
  sellerOrderSummaryRow: {
    marginTop: 3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sellerOrderPayment: {
    color: '#a6bad6',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  sellerExpandedPanel: {
    marginTop: 8,
  },
  sellerAddressDetailCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334963',
    backgroundColor: '#152234',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  sellerAddressDetailTitle: {
    color: '#f0f6ff',
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 3,
  },
  sellerAddressDetailText: {
    color: '#bcd0e8',
    fontSize: 11,
    marginTop: 2,
  },
  sellerOrderItemCard: {
    marginTop: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334963',
    backgroundColor: '#152234',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  sellerOrderItemTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  sellerOrderItemTextWrap: {
    flex: 1,
  },
  sellerOrderItemTitle: {
    color: '#f4f8ff',
    fontSize: 12,
    fontWeight: '700',
  },
  sellerOrderItemMeta: {
    color: '#a8bad3',
    fontSize: 11,
    marginTop: 2,
  },
  sellerStatusBadge: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#506d8f',
    backgroundColor: '#24364e',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  sellerStatusBadgeText: {
    color: '#dde9fb',
    fontSize: 10,
    fontWeight: '700',
  },
  sellerTrackingText: {
    marginTop: 6,
    color: '#8fa6c4',
    fontSize: 10.5,
  },
  sellerFlowRow: {
    marginTop: 8,
    gap: 6,
    paddingRight: 4,
  },
  sellerFlowStep: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#3c506c',
    backgroundColor: '#1c2a3e',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  sellerFlowStepReached: {
    borderColor: '#5f8f70',
    backgroundColor: '#24402b',
  },
  sellerFlowStepCurrent: {
    borderColor: '#9df0a2',
    backgroundColor: '#2d5736',
  },
  sellerFlowStepAction: {
    borderColor: '#9df0a2',
    backgroundColor: '#9df0a2',
  },
  sellerFlowStepText: {
    color: '#c6d6ea',
    fontSize: 10,
    fontWeight: '700',
  },
  sellerFlowStepTextReached: {
    color: '#d7f5dd',
  },
  sellerFlowStepTextAction: {
    color: '#071b0e',
  },
  sellerActionRow: {
    marginTop: 8,
    minHeight: 22,
    justifyContent: 'center',
  },
  sellerUpdatingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sellerUpdatingText: {
    color: '#9df0a2',
    fontSize: 10,
    fontWeight: '700',
  },
  sellerStepHintText: {
    color: '#8fa6c4',
    fontSize: 10,
    fontWeight: '600',
  },
  row: {
    justifyContent: 'space-between',
  },
  card: {
    flex: 1,
    marginHorizontal: 4,
    marginBottom: 10,
    borderColor: '#2a2a2a',
    borderWidth: 1,
    borderRadius: 12,
    backgroundColor: '#101010',
    overflow: 'hidden',
  },
  cardImage: {
    width: '100%',
    height: 118,
  },
  cardBody: {
    padding: 10,
    minHeight: 100,
  },
  sellerStockRow: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  addStockButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#9df0a2',
    borderWidth: 1,
    borderColor: '#7bcf83',
  },
  addStockButtonDisabled: {
    opacity: 0.7,
  },
  stockModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.56)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  stockModalCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a3240',
    backgroundColor: '#141922',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  stockModalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  stockModalSubtitle: {
    color: '#8e9bb2',
    fontSize: 12,
    marginTop: 4,
    marginBottom: 10,
  },
  stockModalLabel: {
    color: '#c4cfde',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  stockQuickRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  stockQuickChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#324054',
    backgroundColor: '#1a212d',
  },
  stockQuickChipActive: {
    borderColor: '#9df0a2',
    backgroundColor: '#1f3322',
  },
  stockQuickChipText: {
    color: '#d5deeb',
    fontSize: 12,
    fontWeight: '700',
  },
  stockQuickChipTextActive: {
    color: '#bffac5',
  },
  stockModalInput: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a3240',
    backgroundColor: '#0f131a',
    color: '#fff',
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  stockModalActions: {
    flexDirection: 'row',
    gap: 10,
  },
  stockModalCancelBtn: {
    flex: 1,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#303948',
    backgroundColor: '#1a212b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stockModalConfirmBtn: {
    flex: 1,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#66ba6c',
    backgroundColor: '#2c7f36',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stockModalCancelText: {
    color: '#d5deeb',
    fontSize: 13,
    fontWeight: '700',
  },
  stockModalConfirmText: {
    color: '#f5fff5',
    fontSize: 13,
    fontWeight: '700',
  },
  cardTitle: {
    color: '#fff',
    fontWeight: '600',
  },
  priceText: {
    color: '#fff',
    marginTop: 6,
    fontWeight: '700',
    fontSize: 15,
  },
  tabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 70,
    backgroundColor: '#111',
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
  },
  tabItem: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    height: '100%',
  },
  tabAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#2b3750',
  },
  exploreButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#2196F3',
    borderRadius: 10,
  },
  exploreButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  sellerPostsSection: {
    paddingHorizontal: 8,
    marginTop: 4,
    marginBottom: 12,
  },
  sellerPostsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 8,
    marginBottom: 12,
  },
  sellerPostsTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  sellerPostsCount: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8fa0b8',
  },
  sellerPostsContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  sellerPostsColumn: {
    flex: 1,
    gap: 8,
  },
  sellerPostCard: {
    borderRadius: 10,
    backgroundColor: '#141922',
    borderWidth: 1,
    borderColor: '#2a3a4f',
    overflow: 'hidden',
  },
  sellerPostImageContainer: {
    width: '100%',
    backgroundColor: '#0a0f18',
    overflow: 'hidden',
  },
  sellerPostImage: {
    width: '100%',
  },
  sellerPostBody: {
    padding: 10,
  },
  sellerPostTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  sellerPostTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#d9e6f8',
  },
  sellerPostPrice: {
    fontSize: 14,
    fontWeight: '700',
    color: '#9df0a2',
    marginBottom: 6,
  },
  sellerPostMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 4,
  },
  sellerPostProof: {
    fontSize: 11,
    fontWeight: '500',
    color: '#a9b5c4',
    flex: 1,
  },
  sellerPostBadge: {
    fontSize: 9,
    fontWeight: '700',
    color: '#ffcf85',
    backgroundColor: 'rgba(255, 207, 133, 0.1)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
});
