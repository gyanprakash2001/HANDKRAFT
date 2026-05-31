import { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';

type MediaType = 'image' | 'video';

type Props = {
  visible: boolean;
  mediaUri: string;
  mediaType: MediaType;
  onClose: () => void;
};

function FullscreenVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.loop = false;
    videoPlayer.muted = false;
  });

  return <VideoView style={styles.media} player={player} nativeControls contentFit="contain" />;
}

export default function MediaViewerModal({ visible, mediaUri, mediaType, onClose }: Props) {
  const { width, height } = useWindowDimensions();

  const mediaStyle = useMemo(() => {
    const maxWidth = Math.min(width - 24, 920);
    const maxHeight = Math.min(height * 0.78, 720);
    return {
      width: maxWidth,
      height: maxHeight,
    };
  }, [height, width]);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
          <BlurView intensity={42} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={styles.backdrop} />
        </Pressable>

        <View style={styles.centerWrap} pointerEvents="box-none">
          <View style={[styles.card, mediaStyle]}>
            <View style={styles.header}
            >
              <ThemedText style={styles.title}>{mediaType === 'video' ? 'Video preview' : 'Image preview'}</ThemedText>
              <Pressable onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color="#f4f8ff" />
              </Pressable>
            </View>

            {mediaType === 'video' ? (
              <FullscreenVideo uri={mediaUri} />
            ) : (
              <Image source={{ uri: mediaUri }} style={styles.media} contentFit="contain" cachePolicy="memory-disk" />
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(5, 8, 14, 0.38)',
  },
  centerWrap: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 18,
  },
  card: {
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: '#0b1119',
    borderWidth: 1,
    borderColor: 'rgba(164, 190, 220, 0.2)',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  header: {
    minHeight: 52,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(12, 18, 26, 0.9)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(164, 190, 220, 0.12)',
  },
  title: {
    color: '#edf3fb',
    fontSize: 14,
    fontWeight: '700',
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  media: {
    width: '100%',
    flex: 1,
    backgroundColor: '#070b10',
  },
});
