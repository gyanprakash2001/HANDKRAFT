import React, { useEffect, useState, useRef } from 'react';
import { Modal, View, StyleSheet, Pressable, Text, Dimensions, ActivityIndicator, Image as RNImage } from 'react-native';
import { GestureHandlerRootView, PanGestureHandler, PinchGestureHandler, State } from 'react-native-gesture-handler';
import Animated, * as ReanimatedModule from 'react-native-reanimated';
import * as ImageManipulator from 'expo-image-manipulator';

const { useSharedValue, useAnimatedStyle } = ReanimatedModule as any;

const AnimatedImage = Animated.createAnimatedComponent(RNImage as any);

interface Props {
  visible: boolean;
  imageUri: string | null;
  onCancel: () => void;
  // onSave will receive the cropped result and an optional `setOnProfile` flag
  onSave: (result: { uri: string; base64?: string; setOnProfile?: boolean }) => void;
  // When true, the primary action will be labelled 'Upload' and the editor will
  // signal that the saved image should also be applied to the user's profile.
  setOnSaveApplyToProfile?: boolean;
  // Optional label for the primary action button (defaults to 'Save')
  primaryActionLabel?: string;
}

export default function AvatarEditor({ visible, imageUri, onCancel, onSave, setOnSaveApplyToProfile, primaryActionLabel }: Props) {
  const [loading, setLoading] = useState(false);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);

  const screenW = Math.min(Dimensions.get('window').width, 420);
  const size = Math.round(screenW - 48);

  const baseScale = useSharedValue(1);
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  useEffect(() => {
    if (!imageUri) return;
    // get natural image size
    RNImage.getSize(
      imageUri,
      (w, h) => {
        setImageSize({ width: w, height: h });
        const s = Math.max(size / w, size / h);
        baseScale.value = s;
        scale.value = 1;
        translateX.value = 0;
        translateY.value = 0;
      },
      () => {
        // ignore
        setImageSize({ width: size, height: size });
      }
    );
  }, [baseScale, imageUri, scale, size, translateX, translateY]);

  // Fallback gesture handling: some environments don't export
  // `useAnimatedGestureHandler`. Use plain JS handlers that update
  // Reanimated shared values from the JS thread.
  const pinchStart = useRef(1);
  const panStart = useRef({ x: 0, y: 0 });

  const onPinchEvent = (e: any) => {
    const next = Math.max(0.5, Math.min(pinchStart.current * (e.nativeEvent?.scale ?? 1), 5));
    scale.value = next;
  };
  const onPinchStateChange = (e: any) => {
    const s = e.nativeEvent?.state;
    if (s === State.BEGAN) {
      pinchStart.current = scale.value;
    } else if (s === State.END || s === State.CANCELLED || s === State.FAILED) {
      scale.value = Math.max(0.5, Math.min(scale.value, 5));
    }
  };

  const onPanEvent = (e: any) => {
    translateX.value = panStart.current.x + (e.nativeEvent?.translationX ?? 0);
    translateY.value = panStart.current.y + (e.nativeEvent?.translationY ?? 0);
  };
  const onPanStateChange = (e: any) => {
    const s = e.nativeEvent?.state;
    if (s === State.BEGAN) {
      panStart.current = { x: translateX.value, y: translateY.value };
    }
  };

  const animatedStyle = useAnimatedStyle(() => {
    const s = baseScale.value * scale.value;
    return {
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        { scale: s },
      ],
    };
  });

  const handleSave = async () => {
    if (!imageUri || !imageSize) return;
    try {
      setLoading(true);
      const s = baseScale.value * scale.value;
      const displayedW = imageSize.width * s;
      const displayedH = imageSize.height * s;
      const containerCenterX = size / 2;
      const containerCenterY = size / 2;
      const imageLeft = containerCenterX - displayedW / 2 + translateX.value;
      const imageTop = containerCenterY - displayedH / 2 + translateY.value;

      const cropX = Math.max(0, Math.round((-imageLeft) / s));
      const cropY = Math.max(0, Math.round((-imageTop) / s));
      const cropW = Math.min(Math.round(size / s), imageSize.width - cropX);
      const cropH = Math.min(Math.round(size / s), imageSize.height - cropY);

      const actions: any[] = [];
      actions.push({ crop: { originX: cropX, originY: cropY, width: cropW, height: cropH } });
      actions.push({ resize: { width: 512, height: 512 } });

      const result = await ImageManipulator.manipulateAsync(imageUri, actions, { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      onSave({ uri: result.uri, base64: result.base64, setOnProfile: Boolean(setOnSaveApplyToProfile) });
    } catch (err) {
      console.error('Avatar crop error', err);
    } finally {
      setLoading(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <GestureHandlerRootView style={styles.backdrop}>
        <View style={styles.card}>
          <View style={[styles.viewport, { width: size, height: size }]}>
            <PinchGestureHandler onGestureEvent={onPinchEvent} onHandlerStateChange={onPinchStateChange}>
              <Animated.View style={{ flex: 1 }}>
                <PanGestureHandler onGestureEvent={onPanEvent} onHandlerStateChange={onPanStateChange}>
                  <Animated.View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
                    {imageUri ? (
                      <AnimatedImage source={{ uri: imageUri }} style={[{ width: imageSize ? imageSize.width : size, height: imageSize ? imageSize.height : size }, animatedStyle]} resizeMode="cover" />
                    ) : null}
                  </Animated.View>
                </PanGestureHandler>
              </Animated.View>
            </PinchGestureHandler>
          </View>

          <View style={styles.actions}>
            <Pressable style={styles.btn} onPress={onCancel}>
              <Text style={styles.btnText}>Cancel</Text>
            </Pressable>
              <Pressable style={[styles.btn, styles.primary]} onPress={handleSave} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={[styles.btnText, { color: '#fff' }]}>{primaryActionLabel || (setOnSaveApplyToProfile ? 'Upload' : 'Save')}</Text>}
              </Pressable>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)' },
  card: { backgroundColor: '#0b0f15', borderRadius: 12, padding: 16, alignItems: 'center' },
  viewport: { backgroundColor: '#111317', borderRadius: 8, overflow: 'hidden' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: '#23272b' },
  primary: { backgroundColor: '#3bbf7b' },
  btnText: { color: '#cfe6d7', fontWeight: '700' },
});
