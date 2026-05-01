import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import MediaViewerModal from '@/components/MediaViewerModal';
import { CsrActivity, CsrSummary, getCsrActivities, getCsrSummary } from '@/utils/api';

type ViewerType = 'image' | 'video';

function formatMoney(value: number) {
  return `₹${Math.max(0, Number(value || 0)).toLocaleString('en-IN')}`;
}

export default function CsrScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<CsrSummary | null>(null);
  const [activities, setActivities] = useState<CsrActivity[]>([]);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerUri, setViewerUri] = useState('');
  const [viewerType, setViewerType] = useState<ViewerType>('image');

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [summaryRes, activityRes] = await Promise.all([
        getCsrSummary(),
        getCsrActivities(),
      ]);
      setSummary(summaryRes);
      setActivities(activityRes || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load CSR details');
    } finally {
      if (isRefresh) setRefreshing(false);
      else setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const progressPercent = useMemo(() => Math.max(0, Math.min(100, Number(summary?.progressPercent || 0))), [summary?.progressPercent]);

  const openViewer = useCallback((uri: string, type: ViewerType) => {
    if (!uri) return;
    setViewerUri(uri);
    setViewerType(type);
    setViewerVisible(true);
  }, []);

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={18} color="#e8f2ff" />
        </Pressable>
        <ThemedText style={styles.title}>CSR Impact</ThemedText>
      </View>

      {loading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator color="#9df0a2" />
        </View>
      ) : (
        <FlatList
          data={activities}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />}
          contentContainerStyle={styles.content}
          ListHeaderComponent={(
            <View style={styles.summaryCard}>
              <ThemedText style={styles.summaryTitle}>Donation progress from buyer orders</ThemedText>
              <ThemedText style={styles.summaryLine}>
                ₹1 from every paid order is included in platform fees and reserved for CSR.
              </ThemedText>

              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
              </View>
              <ThemedText style={styles.progressMeta}>
                {formatMoney(summary?.currentMilestoneProgressAmount || 0)} / {formatMoney(summary?.milestoneAmount || 20000)} for milestone #{summary?.nextMilestoneNumber || 1}
              </ThemedText>

              <View style={styles.metricRow}>
                <View style={styles.metricBox}>
                  <ThemedText style={styles.metricLabel}>Total CSR Collected</ThemedText>
                  <ThemedText style={styles.metricValue}>{formatMoney(summary?.totalContributionAmount || 0)}</ThemedText>
                </View>
                <View style={styles.metricBox}>
                  <ThemedText style={styles.metricLabel}>Paid Orders Counted</ThemedText>
                  <ThemedText style={styles.metricValue}>{Number(summary?.totalPaidOrdersCounted || 0).toLocaleString('en-IN')}</ThemedText>
                </View>
              </View>
            </View>
          )}
          ListEmptyComponent={(
            <View style={styles.emptyCard}>
              <ThemedText style={styles.emptyTitle}>No CSR activities published yet</ThemedText>
              <ThemedText style={styles.emptySubTitle}>After each ₹20,000 milestone, activities posted by admin will appear here.</ThemedText>
            </View>
          )}
          renderItem={({ item }) => (
            <View style={styles.activityCard}>
              <View style={styles.activityHeader}>
                <ThemedText style={styles.activityTitle}>{item.title}</ThemedText>
                <ThemedText style={styles.activityBadge}>Milestone #{item.milestoneNumber}</ThemedText>
              </View>
              {!!item.description && <ThemedText style={styles.activityDescription}>{item.description}</ThemedText>}
              <ThemedText style={styles.activityMeta}>
                Funded: {formatMoney(item.fundedAmount)} • Orders: {Number(item.ordersCounted || 0).toLocaleString('en-IN')}
              </ThemedText>
              {Array.isArray(item.media) && item.media.length > 0 ? (
                <View style={styles.mediaRow}>
                  {item.media.slice(0, 6).map((media, index) => (
                    <Pressable key={`${item.id}-media-${index}`} style={styles.mediaTile} onPress={() => openViewer(media.url, media.type === 'video' ? 'video' : 'image')}>
                      <Image source={{ uri: media.thumbnailUrl || media.url }} style={styles.mediaImage} contentFit="cover" />
                      {media.type === 'video' ? (
                        <View style={styles.videoBadge}>
                          <Ionicons name="play" size={12} color="#ffffff" />
                        </View>
                      ) : null}
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          )}
          ListFooterComponent={error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}
        />
      )}

      <MediaViewerModal
        visible={viewerVisible}
        mediaUri={viewerUri}
        mediaType={viewerType}
        onClose={() => setViewerVisible(false)}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070a10' },
  centerBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#213247',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f1b2a',
  },
  title: { color: '#edf4ff', fontSize: 20, fontWeight: '700' },
  content: { paddingHorizontal: 12, paddingBottom: 22, gap: 10 },
  summaryCard: {
    borderWidth: 1,
    borderColor: '#223346',
    borderRadius: 14,
    backgroundColor: '#0f1824',
    padding: 12,
    marginBottom: 8,
  },
  summaryTitle: { color: '#f6fbff', fontSize: 15, fontWeight: '700' },
  summaryLine: { color: '#b8c9dc', fontSize: 12, marginTop: 5, lineHeight: 17 },
  progressTrack: {
    marginTop: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: '#1d2c3f',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#89e49f',
  },
  progressMeta: { marginTop: 8, color: '#c4d8ef', fontSize: 11, fontWeight: '600' },
  metricRow: { marginTop: 10, flexDirection: 'row', gap: 8 },
  metricBox: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a3d52',
    backgroundColor: '#121f2d',
    padding: 8,
  },
  metricLabel: { color: '#a8bbd2', fontSize: 10 },
  metricValue: { color: '#ecf6ff', fontSize: 13, fontWeight: '700', marginTop: 3 },
  activityCard: {
    borderWidth: 1,
    borderColor: '#223346',
    borderRadius: 14,
    backgroundColor: '#0f1824',
    padding: 12,
  },
  activityHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  activityTitle: { color: '#f4fbff', fontSize: 14, fontWeight: '700', flex: 1 },
  activityBadge: { color: '#98efac', fontSize: 10, fontWeight: '700' },
  activityDescription: { marginTop: 6, color: '#c0d0e0', fontSize: 12, lineHeight: 17 },
  activityMeta: { marginTop: 7, color: '#9eb2c8', fontSize: 11, fontWeight: '600' },
  mediaRow: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mediaTile: {
    width: 102,
    height: 72,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2a3d53',
    backgroundColor: '#0b1019',
  },
  mediaImage: { width: '100%', height: '100%' },
  videoBadge: {
    position: 'absolute',
    right: 5,
    bottom: 5,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCard: {
    borderWidth: 1,
    borderColor: '#223346',
    borderRadius: 14,
    backgroundColor: '#0f1824',
    padding: 14,
  },
  emptyTitle: { color: '#ecf4ff', fontSize: 14, fontWeight: '700' },
  emptySubTitle: { marginTop: 6, color: '#9fb2c8', fontSize: 12, lineHeight: 17 },
  errorText: { marginTop: 8, color: '#ff8f8f', fontSize: 12 },
});
