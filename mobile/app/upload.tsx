import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, Pressable, Text, TextInput, ScrollView, Alert, ActivityIndicator, Switch, Dimensions, Animated, Easing, PanResponder, GestureResponderEvent, PanResponderGestureState, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import LocalAvatar from '@/components/LocalAvatar';
import { createProduct, uploadProductMedia, uploadProductFile, getProfile, prepareLocalUploadUri } from '@/utils/api';
import AddressPickerModal from '@/components/AddressPickerModal';
import type { UserAddress } from '@/utils/api';
import currentUser from '@/utils/currentUser';

const RATIO_OPTIONS = [
  { label: '1:1', value: 1 },
  { label: '4:5', value: 0.8 },
  { label: '3:4', value: 0.75 },
  { label: '2:3', value: 0.67 },
  { label: '16:9', value: 1.78 },
];

const SELLER_CATEGORIES = [
  'Jewelry',
  'Home Decor',
  'Kitchen',
  'Textiles',
  'Pottery',
  'Woodwork',
  'Accessories',
  'Art',
  'Others',
];

function clampAspectRatio(value: number) {
  return Math.max(0.5, Math.min(2, Number(value) || 1));
}

function normalizeRotationDeg(value: number) {
  return (((Number(value || 0) % 360) + 360) % 360);
}

function getRotatedDimensions(width: number, height: number, rotation: number) {
  const w = Math.max(1, Number(width || 1));
  const h = Math.max(1, Number(height || 1));
  const rot = normalizeRotationDeg(rotation);
  if (rot % 180 !== 0) {
    return { width: h, height: w };
  }
  return { width: w, height: h };
}

function getPreviewImageGeometry(sourceW: number, sourceH: number, containerW: number, containerH: number, zoom = 1, rotation = 0) {
  const sw = Math.max(1, Number(sourceW || 1));
  const sh = Math.max(1, Number(sourceH || 1));
  const cw = Math.max(1, Number(containerW || 1));
  const ch = Math.max(1, Number(containerH || 1));
  const z = Math.max(1, Number(zoom || 1));
  const rot = normalizeRotationDeg(rotation);

  const rotated = getRotatedDimensions(sw, sh, rot);
  const coverScale = Math.max(cw / rotated.width, ch / rotated.height);

  // Keep original image ratio in the rendered element; rotation changes visible bounding box.
  const baseWidth = sw * coverScale;
  const baseHeight = sh * coverScale;
  const displayWidth = (rot % 180 !== 0 ? baseHeight : baseWidth) * z;
  const displayHeight = (rot % 180 !== 0 ? baseWidth : baseHeight) * z;

  return {
    coverScale,
    baseWidth,
    baseHeight,
    displayWidth,
    displayHeight,
    rotatedWidth: rotated.width,
    rotatedHeight: rotated.height,
  };
}

function resolveFileBaseUrl() {
  if (ENV_BASE_URL) return ENV_BASE_URL.replace(/\/api\/?$/, '');
  const hostUri = Constants.expoConfig?.hostUri || (Constants as any)?.manifest2?.extra?.expoClient?.hostUri;
  const host = hostUri ? hostUri.split(':')[0] : null;
  const isIpv4 = host ? /^\d{1,3}(\.\d{1,3}){3}$/.test(host) : false;
  if (host && isIpv4) return `http://${host}:5000`;
  if (Platform.OS === 'android') return 'http://10.0.2.2:5000';
  return 'http://localhost:5000';
}

function resolveAvatarSource(avatarUrl?: string | null) {
  if (!avatarUrl) return null;
  const asStr = String(avatarUrl || '');
  if (asStr.startsWith('/')) return { uri: `${resolveFileBaseUrl()}${asStr}` };
  if (asStr.startsWith('http') || asStr.startsWith('data:')) return { uri: asStr };
  const match = asStr.match(/avatar(\d+)/i);
  const seed = match ? `handkraft-${match[1].padStart(2, '0')}` : asStr;
  return { uri: `https://avatars.dicebear.com/api/identicon/${encodeURIComponent(seed)}.png?background=%23eaf6ff` };
}

type UploadMediaItem = {
  type: 'image' | 'video';
  url: string;
  aspectRatio?: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
  rotation?: number;
};

type UploadMediaSource =
  | { type: 'image'; uri: string; width: number; height: number }
  | { type: 'video'; uri: string; width?: number; height?: number };

const PREVIEW_WIDTH = Dimensions.get('window').width - 32;
const GRID_COLUMNS = 3;
const GRID_GAP = 8;
const PREVIEW_EDGE_SAFE_OVERLAP = 1.5;
const LOCAL_PRICE_OVERRIDES_KEY = 'HANDKRAFT_PRICE_OVERRIDES';
const ENV_BASE_URL = process.env.EXPO_PUBLIC_API_URL;

function detectAssetKind(asset: any): 'image' | 'video' | null {
  const declaredType = asset?.type;
  if (declaredType === 'image' || declaredType === 'video') return declaredType;

  const mime = String(asset?.mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';

  const uri = String(asset?.uri || '').toLowerCase();
  if (/\.(jpg|jpeg|png|webp|heic|heif|gif)$/.test(uri)) return 'image';
  if (/\.(mp4|mov|m4v|webm|avi)$/.test(uri)) return 'video';

  if (typeof asset?.duration === 'number' && asset.duration > 0) return 'video';
  return null;
}

function UploadVideoPreview({ uri, onVideoSize }: { uri: string; onVideoSize?: (w: number, h: number) => void }) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.loop = true;
    videoPlayer.muted = true;
    videoPlayer.play();
  });

  // Listen for video track changes to obtain natural size when available
  useEffect(() => {
    if (!player || !onVideoSize) return;
    let sub: any = null;
    try {
      sub = player.addListener('videoTrackChange', (payload: any) => {
        try {
          const size = payload?.videoTrack?.size;
          if (size && typeof size.width === 'number' && typeof size.height === 'number' && size.width > 0 && size.height > 0) {
            onVideoSize(size.width, size.height);
          }
        } catch (e) {
          // ignore
        }
      });
    } catch (e) {
      // ignore if event not supported
    }

    return () => {
      try {
        if (sub && typeof sub.remove === 'function') sub.remove();
      } catch (e) {
        // ignore
      }
    };
  }, [player, onVideoSize]);

  return (
    <VideoView
      style={styles.largePreviewMedia}
      player={player}
      nativeControls
      contentFit="contain"
    />
  );
}

export default function UploadScreen() {
  const CUSTOMIZABLE_MARKER = '[CUSTOMIZABLE]';
  const MAX_BASE64_CHARS = 20_000_000;
  const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [customCategory, setCustomCategory] = useState('');
  const [material, setMaterial] = useState('');
  const [price, setPrice] = useState('');
  const [discountedPrice, setDiscountedPrice] = useState('');
  const [stock, setStock] = useState('1');
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const [customizable, setCustomizable] = useState(false);
  const [imageAspectRatio, setImageAspectRatio] = useState(0.8);
  const [mediaSources, setMediaSources] = useState<UploadMediaSource[]>([]);
  const [mediaItems, setMediaItems] = useState<UploadMediaItem[]>([]);
  const [mediaViewTab, setMediaViewTab] = useState<'preview' | 'grid'>('preview');
  const [activePreviewIndex, setActivePreviewIndex] = useState(0);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [formScrollEnabled, setFormScrollEnabled] = useState(true);
  const [processingMedia, setProcessingMedia] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [addressModalVisible, setAddressModalVisible] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState<UserAddress[]>([]);
  const [pickupAddressId, setPickupAddressId] = useState<string | null>(null);
  const [pickupAddressSnapshot, setPickupAddressSnapshot] = useState<UserAddress | null>(null);
  const router = useRouter();

  const imageToDataUri = async (uri: string, width: number, height: number, ratio: number) => {
    const safeRatio = clampAspectRatio(ratio);
    const sourceWidth = Math.max(1, Math.round(width || 1));
    const sourceHeight = Math.max(1, Math.round(height || 1));

    let cropWidth = sourceWidth;
    let cropHeight = Math.round(sourceWidth / safeRatio);

    if (cropHeight > sourceHeight) {
      cropHeight = sourceHeight;
      cropWidth = Math.round(sourceHeight * safeRatio);
    }

    cropWidth = Math.max(1, Math.min(sourceWidth, cropWidth));
    cropHeight = Math.max(1, Math.min(sourceHeight, cropHeight));

    const originX = Math.max(0, Math.floor((sourceWidth - cropWidth) / 2));
    const originY = Math.max(0, Math.floor((sourceHeight - cropHeight) / 2));

    const extMatch = String(uri).split('?')[0].match(/\.([a-z0-9]+)$/i);
    const ext = extMatch ? (extMatch[1] || '').toLowerCase() : '';
    let saveFormat = ImageManipulator.SaveFormat.JPEG;
    let mime = 'image/jpeg';
    let compress = 1;
    if (ext === 'png') {
      saveFormat = ImageManipulator.SaveFormat.PNG;
      mime = 'image/png';
      compress = 1;
    } else {
      saveFormat = ImageManipulator.SaveFormat.JPEG;
      mime = 'image/jpeg';
      compress = 1;
    }

    const manipulated = await ImageManipulator.manipulateAsync(uri, [
      {
        crop: {
          originX,
          originY,
          width: cropWidth,
          height: cropHeight,
        },
      },
    ], {
      compress,
      format: saveFormat,
      base64: true,
    });

    if (!manipulated.base64 || manipulated.base64.length > MAX_BASE64_CHARS) {
      throw new Error('Cropped image invalid or too large');
    }

    return `data:${mime};base64,${manipulated.base64}`;
  };

  const rebuildMediaItems = async (sources: UploadMediaSource[], ratio: number) => {
    const next: UploadMediaItem[] = [];
      for (const source of sources) {
        if (source.type === 'video') {
          // Preserve video natural aspect when available; do NOT apply image crop ratio to videos.
          let vidRatio: number | undefined = undefined;
          if (typeof source.width === 'number' && typeof source.height === 'number' && source.height > 0) {
            vidRatio = clampAspectRatio(source.width / source.height);
          }
          next.push({ type: 'video', url: source.uri, aspectRatio: vidRatio, zoom: 1, offsetX: 0, offsetY: 0, rotation: 0 });
        } else {
          // Do NOT crop images at selection time. Keep original URI and allow user to pan/zoom in the editor.
          next.push({ type: 'image', url: source.uri, aspectRatio: ratio, zoom: 1, offsetX: 0, offsetY: 0, rotation: 0 });
        }
      }
    setMediaItems(next);
  };

  const applyRatioToAll = async (ratio: number) => {
    if (!mediaSources.length) return;
    setProcessingMedia(true);
    try {
      const safeRatio = clampAspectRatio(ratio);
      setImageAspectRatio(safeRatio);
      // Only apply the selected ratio to image items — leave videos untouched.
      setMediaItems((prev) =>
        prev.map((item) => {
          if (item.type !== 'image') return item;
          return {
            ...item,
            aspectRatio: safeRatio,
            zoom: 1,
            offsetX: 0,
            offsetY: 0,
          };
        })
      );
    } finally {
      setProcessingMedia(false);
    }
  };

  const addMediaFromLibrary = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Please allow photo and video access.');
      return;
    }

    let result;
    try {
      // Use explicit media type strings to avoid accessing possibly-undefined
      // enum properties on older Expo Go runtime builds.
      const mediaTypesOption = ['images', 'videos'];

      result = await (ImagePicker as any).launchImageLibraryAsync({
        mediaTypes: mediaTypesOption,
        allowsMultipleSelection: true,
        allowsEditing: false,
        base64: false,
        quality: 1,
        // Ensure selected assets are copied into the app cache (file://) so uploads work in Expo Go
        copyToCacheDirectory: true,
      });
    } catch (err: any) {
      Alert.alert(
        'Picker issue',
        err?.message || 'Could not open mixed media picker. Try selecting images/videos again.'
      );
      return;
    }

    if (result.canceled || !result.assets?.length) return;

    const nextSources = [...mediaSources];
    for (const asset of result.assets) {
      const kind = detectAssetKind(asset);
      if (kind === 'video') {
        if (asset.uri && (asset.fileSize || 0) <= MAX_VIDEO_SIZE_BYTES) {
          nextSources.push({ type: 'video', uri: asset.uri, width: asset.width, height: asset.height });
        }
      } else if (kind === 'image' && asset.uri && asset.width && asset.height) {
        nextSources.push({ type: 'image', uri: asset.uri, width: asset.width, height: asset.height });
      }
    }

    if (nextSources.length === mediaSources.length) {
      Alert.alert('No compatible media', 'Could not detect selected files as valid images/videos. Try selecting again.');
      return;
    }

    const firstImage = nextSources.find((item) => item.type === 'image') as Extract<UploadMediaSource, { type: 'image' }> | undefined;
    const ratioToUse = mediaSources.length === 0 && firstImage
      ? clampAspectRatio(firstImage.width / firstImage.height)
      : imageAspectRatio;

    setMediaSources(nextSources);
    setProcessingMedia(true);
    try {
      setImageAspectRatio(ratioToUse);
      await rebuildMediaItems(nextSources, ratioToUse);
    } finally {
      setProcessingMedia(false);
    }
  };

  const activeItem = mediaItems[activePreviewIndex];
  const hasImages = mediaItems.some((item) => item.type === 'image');
  const parsedRealPricePreview = Number(price);
  const parsedDiscountedPricePreview = Number(discountedPrice);
  const hasLiveDiscountPreview =
    price.trim().length > 0
    && discountedPrice.trim().length > 0
    && !Number.isNaN(parsedRealPricePreview)
    && !Number.isNaN(parsedDiscountedPricePreview)
    && parsedRealPricePreview > 0
    && parsedDiscountedPricePreview >= 0
    && parsedDiscountedPricePreview < parsedRealPricePreview;
  const liveDiscountPercentage = hasLiveDiscountPreview
    ? Math.round(((parsedRealPricePreview - parsedDiscountedPricePreview) / parsedRealPricePreview) * 100)
    : 0;
  const gridCellSize = Math.floor((PREVIEW_WIDTH - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS);
  const previewRatio = clampAspectRatio(imageAspectRatio);
  const previewMaxWidth = PREVIEW_WIDTH - 12;
  const previewMaxHeight = 320;
  let previewFrameWidth = previewMaxWidth;
  let previewFrameHeight = previewFrameWidth / previewRatio;
  if (previewFrameHeight > previewMaxHeight) {
    previewFrameHeight = previewMaxHeight;
    previewFrameWidth = previewFrameHeight * previewRatio;
  }
  // Compute a separate frame size for the active item so videos can use their native aspect ratio
  let activeFrameWidth = previewFrameWidth;
  let activeFrameHeight = previewFrameHeight;
  if (activeItem && activeItem.type === 'video') {
    const vidRatio = Number(activeItem.aspectRatio) || undefined;
    const useRatio = typeof vidRatio === 'number' && vidRatio > 0 ? clampAspectRatio(vidRatio) : undefined;
    if (useRatio) {
      // Start from max width and constrain by max height
      let w = previewMaxWidth;
      let h = Math.max(1, Math.round(w / useRatio));
      if (h > previewMaxHeight) {
        h = previewMaxHeight;
        w = Math.round(h * useRatio);
      }
      activeFrameWidth = w;
      activeFrameHeight = h;
    } else {
      // Fallback to a reasonable 16:9 if native ratio unknown
      const fallback = 16 / 9;
      let w = previewMaxWidth;
      let h = Math.max(1, Math.round(w / fallback));
      if (h > previewMaxHeight) {
        h = previewMaxHeight;
        w = Math.round(h * fallback);
      }
      activeFrameWidth = w;
      activeFrameHeight = h;
    }
  }

  const activeImageSource = activeItem?.type === 'image'
    ? (mediaSources[activePreviewIndex] as UploadMediaSource | undefined)
    : undefined;
  const activeImageRotation = activeItem?.type === 'image'
    ? normalizeRotationDeg(activeItem.rotation || 0)
    : 0;
  const activeImageBaseGeometry = activeImageSource && activeImageSource.type === 'image'
    ? getPreviewImageGeometry(
        (activeImageSource as any).width,
        (activeImageSource as any).height,
        previewFrameWidth,
        previewFrameHeight,
        1,
        activeImageRotation
      )
    : null;
  const activeImageBaseWidth = activeImageBaseGeometry?.baseWidth || previewFrameWidth;
  const activeImageBaseHeight = activeImageBaseGeometry?.baseHeight || previewFrameHeight;

  const previewViewportHeight = previewMaxHeight + 16;
  const gestureRef = useRef({
    mode: 'none' as 'none' | 'pan' | 'pinch',
    startX: 0,
    startY: 0,
    startOffsetX: 0,
    startOffsetY: 0,
    startDistance: 0,
    startZoom: 1,
  });
  const transformRef = useRef({ zoom: 1, offsetX: 0, offsetY: 0 });
  const translateXAnim = useRef(new Animated.Value(0)).current;
  const translateYAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const introAnim = useRef(new Animated.Value(0)).current;
  const detailsCardAnim = useRef(new Animated.Value(0)).current;
  const mediaCardAnim = useRef(new Animated.Value(0)).current;
  const submitAnim = useRef(new Animated.Value(0)).current;
  const submitPressScaleAnim = useRef(new Animated.Value(1)).current;
  const submitGlowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!activeItem || activeItem.type !== 'image') return;

    const source = mediaSources[activePreviewIndex] as UploadMediaSource | undefined;
    const nextZoom = Math.max(1, Number(activeItem.zoom || 1));
    let nextOffsetX = Number(activeItem.offsetX || 0);
    let nextOffsetY = Number(activeItem.offsetY || 0);

    if (source && source.type === 'image' && (source as any).width && (source as any).height) {
      const rot = Number(activeItem.rotation || 0);
      const bounds = computePanBounds((source as any).width, (source as any).height, previewFrameWidth, previewFrameHeight, nextZoom, rot);
      nextOffsetX = Math.max(bounds.minX, Math.min(bounds.maxX, nextOffsetX));
      nextOffsetY = Math.max(bounds.minY, Math.min(bounds.maxY, nextOffsetY));
    }

    transformRef.current = {
      zoom: nextZoom,
      offsetX: nextOffsetX,
      offsetY: nextOffsetY,
    };
    translateXAnim.setValue(nextOffsetX);
    translateYAnim.setValue(nextOffsetY);
    scaleAnim.setValue(nextZoom);

    const zoomChanged = Math.abs((activeItem.zoom || 1) - nextZoom) > 0.01;
    const xChanged = Math.abs((activeItem.offsetX || 0) - nextOffsetX) > 0.1;
    const yChanged = Math.abs((activeItem.offsetY || 0) - nextOffsetY) > 0.1;
    if (zoomChanged || xChanged || yChanged) {
      setMediaItems((prev) => prev.map((it, idx) => {
        if (idx !== activePreviewIndex || it.type !== 'image') return it;
        return { ...it, zoom: nextZoom, offsetX: nextOffsetX, offsetY: nextOffsetY };
      }));
    }
  }, [activeItem, activePreviewIndex, mediaSources, previewFrameWidth, previewFrameHeight, scaleAnim, translateXAnim, translateYAnim]);

  useEffect(() => {
    const animatedBlocks = [introAnim, detailsCardAnim, mediaCardAnim, submitAnim];
    animatedBlocks.forEach((value) => value.setValue(0));

    Animated.stagger(
      85,
      animatedBlocks.map((value) =>
        Animated.timing(value, {
          toValue: 1,
          duration: 360,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        })
      )
    ).start();
  }, [detailsCardAnim, introAnim, mediaCardAnim, submitAnim]);

  useEffect(() => {
    (async () => {
      try {
        const profile = await getProfile();
        setUserAvatar(profile?.avatarUrl || null);
        currentUser.setProfile(profile || null);
      } catch {
        // Avatar fetch is non-blocking for upload.
      }
    })();
  }, []);

  useEffect(() => {
    const unsub = currentUser.subscribe((p) => {
      try { setUserAvatar(p?.avatarUrl || null); } catch (e) { /* ignore */ }
    });
    return () => {
      try { unsub(); } catch (e) { /* ignore cleanup errors */ }
    };
  }, []);

  const persistActiveTransform = () => {
    if (!activeItem || activeItem.type !== 'image') return;
    let zoom = Math.max(1, Number(transformRef.current.zoom || 1));
    let offsetX = Number(transformRef.current.offsetX || 0);
    let offsetY = Number(transformRef.current.offsetY || 0);

    const source = mediaSources[activePreviewIndex] as UploadMediaSource | undefined;
    if (source && source.type === 'image' && (source as any).width && (source as any).height) {
      const rot = Number(activeItem.rotation || 0);
      const bounds = computePanBounds((source as any).width, (source as any).height, previewFrameWidth, previewFrameHeight, zoom, rot);
      offsetX = Math.max(bounds.minX, Math.min(bounds.maxX, offsetX));
      offsetY = Math.max(bounds.minY, Math.min(bounds.maxY, offsetY));
      transformRef.current = { zoom, offsetX, offsetY };
      translateXAnim.setValue(offsetX);
      translateYAnim.setValue(offsetY);
      scaleAnim.setValue(zoom);
    }

    setMediaItems((prev) => prev.map((item, index) => {
      if (index !== activePreviewIndex || item.type !== 'image') return item;
      return { ...item, zoom, offsetX, offsetY };
    }));
  };

  const computePanBounds = (
    srcW: number,
    srcH: number,
    containerW: number,
    containerH: number,
    scale: number,
    rotation = 0
  ) => {
    try {
      const geom = getPreviewImageGeometry(srcW, srcH, containerW, containerH, scale, rotation);
      const maxX = Math.max(0, (geom.displayWidth - containerW) / 2 - PREVIEW_EDGE_SAFE_OVERLAP);
      const maxY = Math.max(0, (geom.displayHeight - containerH) / 2 - PREVIEW_EDGE_SAFE_OVERLAP);
      const minX = -maxX;
      const minY = -maxY;

      return { minX, maxX, minY, maxY };
    } catch (e) {
      // Fail-safe: if geometry cannot be computed, lock panning to avoid exposing background.
      return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    }
  };

  async function cropImageWithTransform(item: UploadMediaItem, source: UploadMediaSource, containerWidth: number, containerHeight: number) {
    try {
      const imgWRaw = Number((source as any).width || 1);
      const imgHRaw = Number((source as any).height || 1);
      if (!imgWRaw || !imgHRaw) {
        // fallback to center crop
        return await imageToDataUri(source.uri, imgWRaw || 1, imgHRaw || 1, item.aspectRatio || imageAspectRatio);
      }

      const rotation = normalizeRotationDeg(item.rotation || 0);
      const S_user = Math.max(1, Number(item.zoom || 1));
      const geom = getPreviewImageGeometry(imgWRaw, imgHRaw, containerWidth, containerHeight, S_user, rotation);
      const imgW = geom.rotatedWidth;
      const imgH = geom.rotatedHeight;
      const panBounds = computePanBounds(imgWRaw, imgHRaw, containerWidth, containerHeight, S_user, rotation);
      const Tx = Math.max(panBounds.minX, Math.min(panBounds.maxX, Number(item.offsetX || 0)));
      const Ty = Math.max(panBounds.minY, Math.min(panBounds.maxY, Number(item.offsetY || 0)));

      const s = geom.coverScale * S_user;
      const displayW = geom.displayWidth;
      const displayH = geom.displayHeight;
      const left = (containerWidth - displayW) / 2 + Tx;
      const top = (containerHeight - displayH) / 2 + Ty;

      const originX = (0 - left) / s;
      const originY = (0 - top) / s;
      const cropW = containerWidth / s;
      const cropH = containerHeight / s;

      const cx = Math.max(0, Math.min(imgW - cropW, originX));
      const cy = Math.max(0, Math.min(imgH - cropH, originY));
      const cw = Math.max(1, Math.min(imgW, cropW));
      const ch = Math.max(1, Math.min(imgH, cropH));

      const prepared = await prepareLocalUploadUri(source.uri);
      const uriToUse = prepared.uri;

      // Choose output format and quality close to original
      const extMatch = String(source.uri).split('?')[0].match(/\.([a-z0-9]+)$/i);
      const ext = extMatch ? (extMatch[1] || '').toLowerCase() : '';
      let saveFormat = ImageManipulator.SaveFormat.JPEG;
      let mime = 'image/jpeg';
      let compress = 1;
      if (ext === 'png') {
        saveFormat = ImageManipulator.SaveFormat.PNG;
        mime = 'image/png';
        compress = 1;
      } else {
        saveFormat = ImageManipulator.SaveFormat.JPEG;
        mime = 'image/jpeg';
        compress = 1;
      }

      const actions: any[] = [];
      if (rotation) actions.push({ rotate: rotation });
      actions.push({
        crop: {
          originX: Math.max(0, Math.floor(cx)),
          originY: Math.max(0, Math.floor(cy)),
          width: Math.max(1, Math.floor(cw)),
          height: Math.max(1, Math.floor(ch)),
        },
      });

      const manipulated = await ImageManipulator.manipulateAsync(uriToUse, actions, { compress, format: saveFormat, base64: true });

      // cleanup temp copy if any
      if (prepared?.tempPath) {
        try {
          await FileSystem.deleteAsync(prepared.tempPath, { idempotent: true });
        } catch (e) {
          // ignore cleanup errors
        }
      }

      if (!manipulated?.base64) throw new Error('Crop failed');
      return `data:${mime};base64,${manipulated.base64}`;
    } catch (e) {
      // fallback to center crop
      try {
        return await imageToDataUri(source.uri, (source as any).width || 1, (source as any).height || 1, item.aspectRatio || imageAspectRatio);
      } catch (err) {
        throw e;
      }
    }
  }

  const getTouchDistance = (touches: readonly any[]) => {
    if (!touches || touches.length < 2) return 0;
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const goToPreviewIndex = (nextIndex: number) => {
    if (!mediaItems.length) return;
    persistActiveTransform();
    setActivePreviewIndex(Math.max(0, Math.min(nextIndex, mediaItems.length - 1)));
  };

  const reorderList = <T,>(list: T[], from: number, to: number) => {
    const copy = [...list];
    const [moved] = copy.splice(from, 1);
    copy.splice(to, 0, moved);
    return copy;
  };

  const handleGridReorder = (fromIndex: number, dx: number, dy: number) => {
    const step = gridCellSize + GRID_GAP;
    const currentRow = Math.floor(fromIndex / GRID_COLUMNS);
    const currentCol = fromIndex % GRID_COLUMNS;
    const rowDelta = Math.round(dy / step);
    const colDelta = Math.round(dx / step);

    const maxRow = Math.floor((mediaItems.length - 1) / GRID_COLUMNS);
    const nextRow = Math.max(0, Math.min(maxRow, currentRow + rowDelta));
    const nextCol = Math.max(0, Math.min(GRID_COLUMNS - 1, currentCol + colDelta));
    const candidateIndex = Math.max(0, Math.min(mediaItems.length - 1, nextRow * GRID_COLUMNS + nextCol));

    if (candidateIndex === fromIndex) return;

    setMediaItems((prev) => reorderList(prev, fromIndex, candidateIndex));
    setMediaSources((prev) => reorderList(prev, fromIndex, candidateIndex));

    setActivePreviewIndex((prevActive) => {
      if (prevActive === fromIndex) return candidateIndex;
      if (fromIndex < prevActive && candidateIndex >= prevActive) return prevActive - 1;
      if (fromIndex > prevActive && candidateIndex <= prevActive) return prevActive + 1;
      return prevActive;
    });
  };

  const createGridDragResponder = (index: number) => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_: GestureResponderEvent, gestureState: PanResponderGestureState) => Math.abs(gestureState.dx) > 7 || Math.abs(gestureState.dy) > 7,
    onPanResponderGrant: () => {
      setDraggingIndex(index);
    },
    onPanResponderRelease: (_: GestureResponderEvent, gestureState: PanResponderGestureState) => {
      handleGridReorder(index, gestureState.dx, gestureState.dy);
      setDraggingIndex(null);
    },
    onPanResponderTerminate: () => {
      setDraggingIndex(null);
    },
  });

  const handleImageGestureStart = (event: any) => {
    if (!activeItem || activeItem.type !== 'image') return;
    setFormScrollEnabled(false);
    const touches = event.nativeEvent.touches;
    if (touches?.length >= 2) {
      gestureRef.current.mode = 'pinch';
      gestureRef.current.startDistance = getTouchDistance(touches);
      gestureRef.current.startZoom = transformRef.current.zoom || 1;
      return;
    }

    const touch = touches?.[0] ?? event.nativeEvent;
    gestureRef.current.mode = 'pan';
    gestureRef.current.startX = touch.pageX;
    gestureRef.current.startY = touch.pageY;
    gestureRef.current.startOffsetX = transformRef.current.offsetX || 0;
    gestureRef.current.startOffsetY = transformRef.current.offsetY || 0;
  };

  const handleImageGestureMove = (event: any) => {
    if (!activeItem || activeItem.type !== 'image') return;
    const touches = event.nativeEvent.touches;

    if (touches?.length >= 2) {
      if (gestureRef.current.mode !== 'pinch') {
        gestureRef.current.mode = 'pinch';
        gestureRef.current.startDistance = getTouchDistance(touches);
        gestureRef.current.startZoom = transformRef.current.zoom || 1;
      }

      const distance = getTouchDistance(touches);
      if (!gestureRef.current.startDistance || !distance) return;
      const nextZoom = Math.max(1, Math.min(3, gestureRef.current.startZoom * (distance / gestureRef.current.startDistance)));
      transformRef.current.zoom = nextZoom;
      scaleAnim.setValue(nextZoom);
      // After zoom change, clamp offsets so viewport remains covered
      try {
        const source = mediaSources[activePreviewIndex] as UploadMediaSource | undefined;
        if (source && source.type === 'image' && (source as any).width && (source as any).height) {
          const rot = Number((activeItem as any)?.rotation || 0);
          const bounds = computePanBounds((source as any).width, (source as any).height, previewFrameWidth, previewFrameHeight, nextZoom, rot);
          const curX = Number(transformRef.current.offsetX || 0);
          const curY = Number(transformRef.current.offsetY || 0);
          const clampX = Math.max(bounds.minX, Math.min(bounds.maxX, curX));
          const clampY = Math.max(bounds.minY, Math.min(bounds.maxY, curY));
          transformRef.current.offsetX = clampX;
          transformRef.current.offsetY = clampY;
          translateXAnim.setValue(clampX);
          translateYAnim.setValue(clampY);
        } else {
          // No reliable source geometry: lock movement to avoid showing empty areas.
          transformRef.current.offsetX = 0;
          transformRef.current.offsetY = 0;
          translateXAnim.setValue(0);
          translateYAnim.setValue(0);
        }
      } catch (e) {
        transformRef.current.offsetX = 0;
        transformRef.current.offsetY = 0;
        translateXAnim.setValue(0);
        translateYAnim.setValue(0);
      }
      return;
    }

    const touch = touches?.[0];
    if (!touch) return;
    const nextOffsetX = gestureRef.current.startOffsetX + (touch.pageX - gestureRef.current.startX);
    const nextOffsetY = gestureRef.current.startOffsetY + (touch.pageY - gestureRef.current.startY);

    // Compute pan bounds based on image natural size, container, current zoom and rotation
    try {
      const source = mediaSources[activePreviewIndex] as UploadMediaSource | undefined;
      if (source && source.type === 'image' && (source as any).width && (source as any).height) {
        const rot = Number((activeItem as any)?.rotation || 0);
        const bounds = computePanBounds((source as any).width, (source as any).height, previewFrameWidth, previewFrameHeight, transformRef.current.zoom || 1, rot);
        const clampedX = Math.round(Math.max(bounds.minX, Math.min(bounds.maxX, nextOffsetX)) * 10) / 10;
        const clampedY = Math.round(Math.max(bounds.minY, Math.min(bounds.maxY, nextOffsetY)) * 10) / 10;
        transformRef.current.offsetX = clampedX;
        transformRef.current.offsetY = clampedY;
        translateXAnim.setValue(clampedX);
        translateYAnim.setValue(clampedY);
      } else {
        transformRef.current.offsetX = 0;
        transformRef.current.offsetY = 0;
        translateXAnim.setValue(0);
        translateYAnim.setValue(0);
      }
    } catch (e) {
      transformRef.current.offsetX = 0;
      transformRef.current.offsetY = 0;
      translateXAnim.setValue(0);
      translateYAnim.setValue(0);
    }
  };

  const handleImageGestureEnd = () => {
    gestureRef.current.mode = 'none';
    persistActiveTransform();
    setFormScrollEnabled(true);
  };

  const rotateActive = (delta: number) => {
    if (!mediaItems.length) return;
    const idx = activePreviewIndex;
    setMediaItems((prev) => prev.map((it, i) => {
      if (i !== idx || it.type !== 'image') return it;
      const nextRot = (((it.rotation || 0) + delta) % 360 + 360) % 360;
      return { ...it, rotation: nextRot, zoom: 1, offsetX: 0, offsetY: 0 };
    }));
    // reset live transform
    transformRef.current = { zoom: 1, offsetX: 0, offsetY: 0 };
    translateXAnim.setValue(0);
    translateYAnim.setValue(0);
    scaleAnim.setValue(1);
    persistActiveTransform();
  };

  const handlePostItem = async () => {
    if (!title.trim() || !category.trim() || !price.trim()) {
      Alert.alert('Missing fields', 'Please add title, category and price.');
      return;
    }

    if (category === 'Others' && !customCategory.trim()) {
      Alert.alert('Missing category detail', 'Please specify your category when selecting Others.');
      return;
    }

    const parsedPrice = Number(price);
    const parsedDiscountedPrice = discountedPrice.trim().length ? Number(discountedPrice) : null;
    const parsedStock = Number(stock || 0);
    if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
      Alert.alert('Invalid price', 'Price must be a valid non-negative number.');
      return;
    }
    if (Number.isNaN(parsedStock) || parsedStock < 0) {
      Alert.alert('Invalid stock', 'Stock must be a valid non-negative number.');
      return;
    }
    if (!pickupAddressId && !pickupAddressSnapshot) {
      Alert.alert('Pickup address required', 'Please select a pickup address for this listing.');
      return;
    }
    if (parsedDiscountedPrice !== null) {
      if (Number.isNaN(parsedDiscountedPrice) || parsedDiscountedPrice < 0) {
        Alert.alert('Invalid discounted price', 'Discounted price must be a valid non-negative number.');
        return;
      }
      if (parsedDiscountedPrice > parsedPrice) {
        Alert.alert('Invalid discounted price', 'Discounted price cannot be greater than real price.');
        return;
      }
    }

    try {
      setSubmitting(true);
      const cleanDescription = description.trim();
      const normalizedDescription = customizable && !cleanDescription.includes(CUSTOMIZABLE_MARKER)
        ? `${CUSTOMIZABLE_MARKER} ${cleanDescription}`.trim()
        : cleanDescription;

      // Persist any active transforms before cropping/upload
      persistActiveTransform();
      // Pre-upload any local video files (content:// or file://) and crop images now according to user pan/zoom
      const mediaForUpload = [] as { type: 'image' | 'video'; url: string; aspectRatio?: number }[];
      setProcessingMedia(true);
      try {
        for (let i = 0; i < mediaItems.length; i++) {
          const item = mediaItems[i];
          const source = mediaSources[i];
          if (item.type === 'video') {
            const isRemote = /^https?:\/\//i.test(String(item.url || ''));
            if (isRemote) {
              mediaForUpload.push({ type: 'video', url: item.url, aspectRatio: item.aspectRatio });
            } else {
              // Upload local file via multipart to server
              const uploaded = await uploadProductFile(item.url);
              mediaForUpload.push({ type: 'video', url: uploaded.url, aspectRatio: item.aspectRatio });
            }
          } else {
            // Images: if already a data URI (pre-cropped) use it, otherwise crop now using transform and include as base64 data URI
            try {
              if (String(item.url || '').startsWith('data:')) {
                mediaForUpload.push({ type: 'image', url: item.url, aspectRatio: item.aspectRatio });
              } else {
                const dataUri = await cropImageWithTransform(item, source, previewFrameWidth, previewFrameHeight);
                mediaForUpload.push({ type: 'image', url: dataUri, aspectRatio: item.aspectRatio });
              }
            } catch (e) {
              // As a fallback do a center crop similar to previous behavior
              try {
                const fallback = await imageToDataUri(source.uri, (source as any).width || 1, (source as any).height || 1, item.aspectRatio || imageAspectRatio);
                mediaForUpload.push({ type: 'image', url: fallback, aspectRatio: item.aspectRatio });
              } catch (err) {
                // Skip this media if we cannot crop it
              }
            }
          }
        }
      } finally {
        setProcessingMedia(false);
      }

      const uploadedMedia = await uploadProductMedia(mediaForUpload as any);
      if (!uploadedMedia || !Array.isArray((uploadedMedia as any).media)) {
        throw new Error('Media upload returned invalid response');
      }

      const created = await createProduct({
        title: title.trim(),
        description: normalizedDescription,
        category: category.trim(),
        customCategory: category === 'Others' ? customCategory.trim() : '',
        material: material.trim(),
        price: parsedPrice,
        realPrice: parsedPrice,
        discountedPrice: parsedDiscountedPrice ?? undefined,
        stock: parsedStock,
        imageAspectRatio,
        media: uploadedMedia.media,
        customizable,
        isCustomizable: customizable,
        images: uploadedMedia.images || [],
        pickupAddressId: pickupAddressId || undefined,
        pickupAddress: pickupAddressSnapshot || undefined,
      });

      if (created?._id && parsedDiscountedPrice !== null && parsedDiscountedPrice < parsedPrice) {
        try {
          const raw = await AsyncStorage.getItem(LOCAL_PRICE_OVERRIDES_KEY);
          const parsed = raw ? JSON.parse(raw) : {};
          const next = {
            ...parsed,
            [created._id]: {
              realPrice: parsedPrice,
              discountedPrice: parsedDiscountedPrice,
              discountPercentage: Math.round(((parsedPrice - parsedDiscountedPrice) / parsedPrice) * 100),
              updatedAt: Date.now(),
            },
          };
          await AsyncStorage.setItem(LOCAL_PRICE_OVERRIDES_KEY, JSON.stringify(next));
        } catch {
          // Ignore local cache failures; post is already successful.
        }
      }

      Alert.alert('Success', 'Your handmade item is now live for selling.');
      setTitle('');
      setDescription('');
      setCategory('');
      setCustomCategory('');
      setMaterial('');
      setPrice('');
      setDiscountedPrice('');
      setStock('1');
      setPickupAddressId(null);
      setPickupAddressSnapshot(null);
      setCategoryDropdownOpen(false);
      setImageAspectRatio(0.8);
      setCustomizable(false);
      setMediaSources([]);
      setMediaItems([]);
      setActivePreviewIndex(0);
      setMediaViewTab('preview');
      router.replace('/feed');
    } catch (err: any) {
      if ((err?.message || '').toLowerCase().includes('token')) {
        Alert.alert('Session expired', 'Please log in again.');
        router.replace('/login');
        return;
      }
      Alert.alert('Post failed', err?.message || 'Could not post your item.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitPressIn = () => {
    Animated.spring(submitPressScaleAnim, {
      toValue: 0.97,
      speed: 24,
      bounciness: 4,
      useNativeDriver: true,
    }).start();
  };

  const handleSubmitPressOut = () => {
    Animated.spring(submitPressScaleAnim, {
      toValue: 1,
      speed: 20,
      bounciness: 7,
      useNativeDriver: true,
    }).start();
  };

  const triggerSubmitGlowPulse = () => {
    submitGlowAnim.setValue(0);
    Animated.sequence([
      Animated.timing(submitGlowAnim, {
        toValue: 1,
        duration: 140,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.timing(submitGlowAnim, {
        toValue: 0,
        duration: 220,
        easing: Easing.in(Easing.quad),
        useNativeDriver: false,
      }),
    ]).start();
  };

  const handleSubmitWithPulse = () => {
    triggerSubmitGlowPulse();
    handlePostItem();
  };

  const isLocalTabAvatar = useMemo(() => Boolean(userAvatar && String(userAvatar).startsWith('local:')), [userAvatar]);
  const tabAvatarSource = useMemo(() => (isLocalTabAvatar ? null : resolveAvatarSource(userAvatar)), [userAvatar, isLocalTabAvatar]);

  return (
    <ThemedView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <ThemedText type="title" style={styles.headerTitle}>Sell Item</ThemedText>
          <ThemedText style={styles.headerSubtitle}>Create a listing buyers will love</ThemedText>
        </View>
        <View style={{backgroundColor:'#e6f9e8', borderRadius:18, padding:6, shadowColor:'#000', shadowOpacity:0.08, shadowRadius:4, elevation:2}}>
          <Ionicons name="leaf-outline" size={22} color="#3bb273" />
        </View>
      </View>

      <ScrollView
        style={styles.formWrap}
        contentContainerStyle={styles.formContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={formScrollEnabled}>

        {/* Removed helper heading 'Fill in details buyers care about before posting.' */}

        <Animated.View
          style={[
            styles.animatedBlock,
            {
              opacity: detailsCardAnim,
              transform: [
                {
                  translateY: detailsCardAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [18, 0],
                  }),
                },
              ],
            },
          ]}>
          <View style={styles.sectionCard}>

        <ThemedText style={styles.label}>Item Title *</ThemedText>
        <TextInput
          style={styles.input}
          placeholder="e.g. Handwoven Bamboo Basket"
          placeholderTextColor="#8f8f8f"
          value={title}
          onChangeText={setTitle}
        />

        <ThemedText style={styles.label}>Description</ThemedText>
        <TextInput
          style={[styles.input, styles.inputMultiline]}
          placeholder="Write size, style, care instructions, and what makes it handmade"
          placeholderTextColor="#8f8f8f"
          value={description}
          onChangeText={setDescription}
          multiline
          textAlignVertical="top"
        />

        <ThemedText style={styles.label}>Category *</ThemedText>
        <ThemedText style={styles.helperInlineText}>Pick from list for better feed filtering.</ThemedText>
        <View style={styles.categoryDropdownWrap}>
          <Pressable
            style={styles.categoryDropdownButton}
            onPress={() => setCategoryDropdownOpen((prev) => !prev)}>
            <ThemedText style={category ? styles.categoryDropdownValue : styles.categoryDropdownPlaceholder}>
              {category || 'Select category'}
            </ThemedText>
            <Ionicons name={categoryDropdownOpen ? 'chevron-up' : 'chevron-down'} size={18} color="#b6bdc9" />
          </Pressable>

          {categoryDropdownOpen ? (
            <View style={styles.categoryDropdownList}>
              {SELLER_CATEGORIES.map((option) => (
                <Pressable
                  key={option}
                  style={[styles.categoryDropdownItem, category === option && styles.categoryDropdownItemActive]}
                  onPress={() => {
                    setCategory(option);
                    if (option !== 'Others') {
                      setCustomCategory('');
                    }
                    setCategoryDropdownOpen(false);
                  }}>
                  <ThemedText style={[styles.categoryDropdownItemText, category === option && styles.categoryDropdownItemTextActive]}>
                    {option}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        {category === 'Others' ? (
          <>
            <ThemedText style={styles.label}>Specify Category *</ThemedText>
            <TextInput
              style={styles.input}
              placeholder="e.g. Toys, Stationery, Candles"
              placeholderTextColor="#8f8f8f"
              value={customCategory}
              onChangeText={setCustomCategory}
            />
          </>
        ) : null}

        <ThemedText style={styles.label}>Material</ThemedText>
        <TextInput
          style={styles.input}
          placeholder="e.g. Cotton, Clay, Wood"
          placeholderTextColor="#8f8f8f"
          value={material}
          onChangeText={setMaterial}
        />

        <View style={styles.twoColRow}>
          <View style={styles.twoColItem}>
            <ThemedText style={styles.label}>Real Price (INR) *</ThemedText>
            <TextInput
              style={styles.input}
              placeholder="e.g. 499"
              placeholderTextColor="#8f8f8f"
              value={price}
              onChangeText={setPrice}
              keyboardType="numeric"
            />
          </View>
          <View style={styles.twoColItem}>
            <ThemedText style={styles.label}>Discounted Price (INR)</ThemedText>
            <TextInput
              style={styles.input}
              placeholder="e.g. 399"
              placeholderTextColor="#8f8f8f"
              value={discountedPrice}
              onChangeText={setDiscountedPrice}
              keyboardType="numeric"
            />
          </View>
        </View>

        {hasLiveDiscountPreview ? (
          <ThemedText style={styles.discountPreviewText}>Instant discount: {liveDiscountPercentage}% off</ThemedText>
        ) : null}

        <View style={styles.twoColRow}>
          <View style={styles.twoColItem}>
            <ThemedText style={styles.label}>Stock</ThemedText>
            <TextInput
              style={styles.input}
              placeholder="1"
              placeholderTextColor="#8f8f8f"
              value={stock}
              onChangeText={setStock}
              keyboardType="numeric"
            />
          </View>
          <View style={styles.twoColItem} />
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.label}>Pickup address *</ThemedText>
          <Pressable style={styles.addressRow} onPress={() => setAddressModalVisible(true)}>
            <ThemedText style={styles.addressPreviewText} numberOfLines={2}>
              {pickupAddressSnapshot
                ? `${pickupAddressSnapshot.label} — ${pickupAddressSnapshot.street || ''}${pickupAddressSnapshot.city ? ', ' + pickupAddressSnapshot.city : ''}`
                : 'Select pickup address'}
            </ThemedText>
            <Ionicons name="chevron-forward" size={18} color="#9aa7b8" />
          </Pressable>
        </View>

        <View style={styles.customizableRow}>
          <View style={styles.customizableTextWrap}>
            <ThemedText style={styles.label}>Customizable</ThemedText>
            <ThemedText style={styles.helperInlineText}>Enable if buyers can request custom changes</ThemedText>
          </View>
          <Switch
            value={customizable}
            onValueChange={setCustomizable}
            trackColor={{ false: '#2d2d2d', true: '#245d36' }}
            thumbColor={customizable ? '#8df0aa' : '#d6d9de'}
          />
        </View>

          </View>
        </Animated.View>

        <Animated.View
          style={[
            styles.animatedBlock,
            {
              opacity: mediaCardAnim,
              transform: [
                {
                  translateY: mediaCardAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [22, 0],
                  }),
                },
              ],
            },
          ]}>
          <View style={styles.sectionCard}>

        <ThemedText style={styles.label}>Product Media</ThemedText>
        <ThemedText style={styles.helperInlineText}>Preview is editable. Drag, zoom, and rotate to set framing. Crop is applied only when you tap Post.</ThemedText>

        {hasImages && activeItem?.type === 'image' ? (
          <View style={styles.ratioHintRow}>
            <ThemedText style={styles.ratioHintLabel}>Using ratio:</ThemedText>
            <ThemedText style={styles.ratioHintValue}>
              {RATIO_OPTIONS.reduce((best, option) => {
                const currentDiff = Math.abs(option.value - imageAspectRatio);
                const bestDiff = Math.abs(best.value - imageAspectRatio);
                return currentDiff < bestDiff ? option : best;
              }).label}
            </ThemedText>
          </View>
        ) : null}

        {hasImages && activeItem?.type === 'image' ? (
          <View style={styles.ratioWrap}>
            {RATIO_OPTIONS.map((option) => {
              const active = Math.abs(imageAspectRatio - option.value) < 0.03;
              return (
                <Pressable
                  key={option.label}
                  style={[styles.ratioChip, active && styles.ratioChipActive]}
                  onPress={() => applyRatioToAll(option.value)}>
                  <ThemedText style={[styles.ratioChipText, active && styles.ratioChipTextActive]}>{option.label}</ThemedText>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <Pressable style={styles.imagePickButton} onPress={addMediaFromLibrary}>
          <Text style={styles.imagePickButtonText}>{mediaItems.length === 0 ? 'Select images/videos' : 'Add more images/videos'}</Text>
        </Pressable>

        {processingMedia ? <ThemedText style={styles.processingText}>Applying ratio to selected images...</ThemedText> : null}

        {mediaItems.length > 0 ? (
          <View style={styles.mediaViewTabs}>
            <Pressable
              style={[styles.mediaViewTabButton, mediaViewTab === 'preview' && styles.mediaViewTabButtonActive]}
              onPress={() => setMediaViewTab('preview')}>
              <ThemedText style={[styles.mediaViewTabText, mediaViewTab === 'preview' && styles.mediaViewTabTextActive]}>Preview</ThemedText>
            </Pressable>
            <Pressable
              style={[styles.mediaViewTabButton, mediaViewTab === 'grid' && styles.mediaViewTabButtonActive]}
              onPress={() => setMediaViewTab('grid')}>
              <ThemedText style={[styles.mediaViewTabText, mediaViewTab === 'grid' && styles.mediaViewTabTextActive]}>Grid</ThemedText>
            </Pressable>
          </View>
        ) : null}

        {mediaViewTab === 'preview' && mediaItems.length > 0 ? (
          <View style={styles.largePreviewWrap}>
            <View style={[styles.largePreviewSlide, { height: previewViewportHeight }]}> 
              {activeItem?.type === 'image' ? (
                <View
                  style={[styles.largePreviewDragFrame, { width: previewFrameWidth, height: previewFrameHeight }]}
                  onStartShouldSetResponder={() => true}
                  onMoveShouldSetResponder={() => true}
                  onResponderGrant={handleImageGestureStart}
                  onResponderMove={handleImageGestureMove}
                  onResponderRelease={handleImageGestureEnd}
                  onResponderTerminate={handleImageGestureEnd}>
                  <Animated.View
                    style={[
                      styles.previewImageTranslateLayer,
                      {
                        transform: [
                          { translateX: translateXAnim },
                          { translateY: translateYAnim },
                        ],
                      },
                    ]}>
                    <Animated.Image
                      source={{ uri: activeItem.url }}
                      style={[
                        styles.largePreviewMedia,
                        {
                          width: activeImageBaseWidth,
                          height: activeImageBaseHeight,
                        },
                        {
                          transform: [
                            { rotate: `${activeImageRotation}deg` },
                            { scale: scaleAnim },
                          ],
                        },
                      ]}
                      resizeMode="cover"
                    />
                  </Animated.View>
                </View>
              ) : null}
              {activeItem?.type === 'image' ? (
                <View style={styles.rotateControls}>
                  <Pressable style={styles.rotateButton} onPress={() => rotateActive(-90)}>
                    <Ionicons name="reload" size={18} color="#dbeffd" style={{ transform: [{ rotate: '-90deg' }] }} />
                  </Pressable>
                  <Pressable style={styles.rotateButton} onPress={() => rotateActive(90)}>
                    <Ionicons name="reload" size={18} color="#dbeffd" />
                  </Pressable>
                </View>
              ) : activeItem ? (
                <View style={[styles.largePreviewDragFrame, { width: activeFrameWidth, height: activeFrameHeight }]}> 
                  <UploadVideoPreview
                    uri={activeItem.url}
                    onVideoSize={(w, h) => {
                      const ratio = clampAspectRatio(w / h);
                      setMediaItems((prev) =>
                        prev.map((it, idx) => {
                          if (idx !== activePreviewIndex) return it;
                          if (it.type !== 'video') return it;
                          const existing = Number(it.aspectRatio) || 0;
                          if (existing > 0 && Math.abs(existing - ratio) < 0.01) return it;
                          return { ...it, aspectRatio: ratio };
                        })
                      );
                    }}
                  />
                </View>
              ) : null}
              {mediaItems.length > 1 ? (
                <>
                  <Pressable
                    style={[styles.previewArrowButton, styles.previewArrowLeft]}
                    onPress={() => goToPreviewIndex(activePreviewIndex - 1)}
                    disabled={activePreviewIndex === 0}>
                    <Ionicons
                      name="chevron-back"
                      size={20}
                      color={activePreviewIndex === 0 ? '#5f6b7a' : '#eaf2ff'}
                    />
                  </Pressable>
                  <Pressable
                    style={[styles.previewArrowButton, styles.previewArrowRight]}
                    onPress={() => goToPreviewIndex(activePreviewIndex + 1)}
                    disabled={activePreviewIndex === mediaItems.length - 1}>
                    <Ionicons
                      name="chevron-forward"
                      size={20}
                      color={activePreviewIndex === mediaItems.length - 1 ? '#5f6b7a' : '#eaf2ff'}
                    />
                  </Pressable>
                </>
              ) : null}
            </View>
            <View style={styles.previewMetaRow}>
              <ThemedText style={styles.previewMetaText}>Item {activePreviewIndex + 1} of {mediaItems.length}</ThemedText>
              {activeItem?.type === 'image' ? (
                <ThemedText style={styles.previewMetaText}>{(transformRef.current.zoom || 1).toFixed(1)}x</ThemedText>
              ) : (
                <ThemedText style={styles.previewMetaText}>Video</ThemedText>
              )}
            </View>
            {activeItem?.type === 'image' ? (
              <ThemedText style={styles.dragHintText}>Use one finger to slide image, two fingers to zoom. Crop happens only on Post.</ThemedText>
            ) : null}
          </View>
        ) : null}

        {mediaViewTab === 'grid' ? (
          <View style={styles.previewGrid}>
            {mediaItems.map((item, index) => (
              <View
                key={`${item.type}-${index}`}
                style={{ width: gridCellSize, height: gridCellSize }}
                {...createGridDragResponder(index).panHandlers}>
                <Pressable
                  style={[
                    styles.previewCell,
                    { width: gridCellSize, height: gridCellSize },
                    index === activePreviewIndex && styles.previewCellActive,
                    draggingIndex === index && styles.previewCellDragging,
                  ]}
                  onPress={() => {
                    setActivePreviewIndex(index);
                    setMediaViewTab('preview');
                  }}>
                  {item.type === 'image' ? (
                    <View style={styles.gridImageWrap}>
                      <ExpoImage source={{ uri: item.url }} style={styles.previewImage} contentFit="cover" />
                    </View>
                  ) : (
                    <View style={styles.videoPreviewStub}>
                      <Ionicons name="videocam" size={22} color="#d7e2f7" />
                      <ThemedText style={styles.videoPreviewText}>Video</ThemedText>
                    </View>
                  )}
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        {mediaViewTab === 'grid' && mediaItems.length > 1 ? (
          <ThemedText style={styles.dragHintText}>Drag tiles in Grid to reorder post sequence</ThemedText>
        ) : null}

          </View>
        </Animated.View>

        <Animated.View
          style={[
            styles.animatedBlock,
            {
              opacity: submitAnim,
              transform: [
                {
                  translateY: submitAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [26, 0],
                  }),
                },
                {
                  scale: submitAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.98, 1],
                  }),
                },
                {
                  scale: submitPressScaleAnim,
                },
              ],
            },
          ]}>
          <Animated.View
            style={[
              styles.submitButtonShell,
              {
                shadowOpacity: submitGlowAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.26, 0.54],
                }),
              },
              submitting && styles.submitDisabled,
            ]}>
            <Pressable
              style={styles.submitButton}
            onPressIn={handleSubmitPressIn}
            onPressOut={handleSubmitPressOut}
            onPress={handleSubmitWithPulse}
            disabled={submitting}>
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Post Handmade Item</Text>}
            </Pressable>
          </Animated.View>
        </Animated.View>

      </ScrollView>

      <AddressPickerModal
        visible={addressModalVisible}
        onClose={() => setAddressModalVisible(false)}
        onSelect={(addr) => {
          setPickupAddressId((addr as any)?._id ? String((addr as any)?._id) : null);
          setPickupAddressSnapshot(addr as UserAddress);
          setAddressModalVisible(false);
        }}
      />

    {/* Bottom Tab Navigation */}
    <View style={styles.tabBar}>
      <Pressable style={styles.tabItem} onPress={() => router.push('/feed')}>
        <Ionicons name="home-outline" size={26} color="#fff" />
      </Pressable>
      <Pressable style={styles.tabItem} onPress={() => router.push('/upload')}>
        <Ionicons name="add" size={30} color="#fff" />
      </Pressable>
      <Pressable style={styles.tabItem} onPress={() => router.push('/profile')}>
        {isLocalTabAvatar ? (
          <LocalAvatar id={userAvatar || 'local:avatar01'} size={36} style={styles.tabAvatar} />
        ) : tabAvatarSource ? (
          <ExpoImage source={tabAvatarSource} style={styles.tabAvatar} contentFit="cover" />
        ) : (
          <Ionicons name="person-outline" size={26} color="#fff" />
        )}
      </Pressable>
    </View>
  </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#070b12',
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 58,
    paddingBottom: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 34,
    fontWeight: '700',
    color: '#f7fbff',
    letterSpacing: 0.2,
  },
  headerSubtitle: {
    color: '#95a7bf',
    marginTop: 4,
    fontSize: 12,
  },
  headerBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#1a2431',
    borderWidth: 1,
    borderColor: '#30465f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  formWrap: {
    flex: 1,
  },
  formContent: {
    paddingHorizontal: 14,
    paddingBottom: 96,
  },
  animatedBlock: {
    width: '100%',
  },
  helperText: {
    color: '#c6d3e3',
    marginBottom: 12,
    backgroundColor: '#0f1723',
    borderWidth: 1,
    borderColor: '#223145',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 12,
    lineHeight: 18,
  },
  sectionCard: {
    backgroundColor: '#0d141f',
    borderWidth: 1,
    borderColor: '#1e2b3d',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingBottom: 12,
    marginBottom: 12,
  },
  label: {
    color: '#e6f0ff',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginTop: 10,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#2d3f57',
    backgroundColor: '#111b29',
    borderRadius: 12,
    height: 48,
    color: '#f8fbff',
    paddingHorizontal: 14,
    fontSize: 14,
  },
  inputMultiline: {
    minHeight: 112,
    height: 112,
    paddingTop: 12,
    lineHeight: 20,
  },
  twoColRow: {
    flexDirection: 'row',
    gap: 12,
  },
  twoColItem: {
    flex: 1,
  },
  discountPreviewText: {
    marginTop: 8,
    marginBottom: 2,
    color: '#9df0a2',
    fontSize: 12,
    fontWeight: '700',
  },
  customizableRow: {
    marginTop: 10,
    marginBottom: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a3c55',
    borderRadius: 12,
    backgroundColor: '#121f30',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  customizableTextWrap: {
    flex: 1,
    paddingRight: 10,
  },
  helperInlineText: {
    color: '#95a7bf',
    fontSize: 12,
    lineHeight: 16,
  },
  categoryDropdownWrap: {
    marginTop: 6,
    marginBottom: 4,
  },
  categoryDropdownButton: {
    height: 48,
    borderWidth: 1,
    borderColor: '#2d3f57',
    backgroundColor: '#111b29',
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  categoryDropdownPlaceholder: {
    color: '#8ea0ba',
    fontSize: 14,
  },
  categoryDropdownValue: {
    color: '#f8fbff',
    fontSize: 14,
  },
  categoryDropdownList: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#2a3b52',
    borderRadius: 12,
    backgroundColor: '#101a27',
    overflow: 'hidden',
  },
  categoryDropdownItem: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#1c2a3d',
  },
  categoryDropdownItemActive: {
    backgroundColor: '#1e3550',
  },
  categoryDropdownItemText: {
    color: '#d5e3f4',
    fontSize: 13,
    fontWeight: '600',
  },
  categoryDropdownItemTextActive: {
    color: '#ffffff',
  },
  imagePickButton: {
    height: 48,
    borderRadius: 12,
    backgroundColor: '#18293f',
    borderWidth: 1,
    borderColor: '#2b4463',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  ratioHintRow: {
    marginTop: 8,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ratioHintLabel: {
    color: '#8ea4bf',
    fontSize: 12,
  },
  ratioHintValue: {
    color: '#b7f3cc',
    fontSize: 12,
    fontWeight: '700',
  },
  ratioWrap: {
    marginTop: 6,
    marginBottom: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  ratioChip: {
    borderWidth: 1,
    borderColor: '#2a3b52',
    backgroundColor: '#111b29',
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  ratioChipActive: {
    backgroundColor: '#1f7a45',
    borderColor: '#30a766',
  },
  ratioChipText: {
    color: '#d8e4f3',
    fontSize: 12,
    fontWeight: '600',
  },
  ratioChipTextActive: {
    color: '#fff',
  },
  imagePickButtonText: {
    color: '#f5f9ff',
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  mediaViewTabs: {
    marginTop: 10,
    marginBottom: 8,
    flexDirection: 'row',
    gap: 8,
  },
  mediaViewTabButton: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a3b52',
    backgroundColor: '#101a27',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaViewTabButtonActive: {
    backgroundColor: '#1f324b',
    borderColor: '#42658b',
  },
  mediaViewTabText: {
    color: '#a9bad0',
    fontWeight: '600',
  },
  mediaViewTabTextActive: {
    color: '#ffffff',
  },
  largePreviewWrap: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#2a3b52',
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#0f1824',
  },
  largePreviewSlide: {
    width: PREVIEW_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  previewArrowButton: {
    position: 'absolute',
    top: '50%',
    marginTop: -16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(10, 20, 35, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#355778',
  },
  previewArrowLeft: {
    left: 10,
  },
  previewArrowRight: {
    right: 10,
  },
  largePreviewDragFrame: {
    width: PREVIEW_WIDTH - 12,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#111b29',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewImageTranslateLayer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  rotateControls: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    gap: 8,
    zIndex: 22,
  },
  rotateButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10, 20, 35, 0.6)',
    borderWidth: 1,
    borderColor: '#355778',
  },
  largePreviewMedia: {
    width: '100%',
    height: '100%',
    backgroundColor: '#111b29',
  },
  previewMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#132033',
  },
  previewMetaText: {
    color: '#b5c6db',
    fontSize: 12,
  },
  dragHintText: {
    color: '#96afc8',
    fontSize: 11,
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  processingText: {
    marginTop: 8,
    color: '#9ab5d0',
    fontSize: 12,
  },
  previewGrid: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
  previewCell: {
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2a3b52',
    backgroundColor: '#111b29',
  },
  previewCellActive: {
    borderColor: '#2dad65',
  },
  previewCellDragging: {
    opacity: 0.72,
    borderColor: '#8fc0f6',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  gridImageWrap: {
    width: '100%',
    height: '100%',
  },
  videoPreviewStub: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#16263a',
  },
  videoPreviewText: {
    color: '#d7e2f7',
    fontSize: 11,
    fontWeight: '700',
  },
  submitButton: {
    marginTop: 8,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#2a8f53',
    borderWidth: 1,
    borderColor: '#4ab878',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  submitButtonShell: {
    borderRadius: 14,
    shadowColor: '#57d38e',
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 14,
    elevation: 3,
  },
  submitDisabled: {
    opacity: 0.7,
  },
  submitText: {
    color: '#fafffb',
    fontWeight: '700',
    fontSize: 15,
    letterSpacing: 0.3,
  },
  tabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 70,
    backgroundColor: '#0c1420',
    borderTopWidth: 1,
    borderTopColor: '#203147',
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
});
