import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import AddressPickerModal from '@/components/AddressPickerModal';
import { getProfile, updateSellerProfile, uploadProductFile } from '@/utils/api';
import type { UserAddress } from '@/utils/api';

type SellerFormState = {
  sellerDisplayName: string;
  sellerTagline: string;
  sellerStory: string;
  sellerStoryVideoUrl: string;
  sellerInstagram: string;
  sellerContactEmail: string;
  sellerContactPhone: string;
  sellerWebsite: string;
  sellerLocation: string;
};

const EMPTY_FORM: SellerFormState = {
  sellerDisplayName: '',
  sellerTagline: '',
  sellerStory: '',
  sellerStoryVideoUrl: '',
  sellerInstagram: '',
  sellerContactEmail: '',
  sellerContactPhone: '',
  sellerWebsite: '',
  sellerLocation: '',
};

function mapSellerPickupToAddress(pickup: any): UserAddress | null {
  if (!pickup || typeof pickup !== 'object') return null;

  const hasAnyValue = [
    pickup.label,
    pickup.street,
    pickup.city,
    pickup.postalCode,
    pickup.phoneNumber,
    pickup.email,
  ].some((value) => String(value || '').trim().length > 0);

  if (!hasAnyValue) return null;

  return {
    _id: pickup.addressId ? String(pickup.addressId) : undefined,
    label: String(pickup.label || 'Pickup'),
    fullName: String(pickup.fullName || ''),
    phoneNumber: String(pickup.phoneNumber || ''),
    email: String(pickup.email || ''),
    street: String(pickup.street || ''),
    city: String(pickup.city || ''),
    state: String(pickup.state || ''),
    postalCode: String(pickup.postalCode || ''),
    country: String(pickup.country || 'India'),
    isDefault: false,
  };
}

function serializePickupAddress(address: UserAddress | null) {
  if (!address) return 'null';

  return JSON.stringify({
    _id: address._id || null,
    label: address.label || '',
    fullName: address.fullName || '',
    phoneNumber: address.phoneNumber || '',
    email: address.email || '',
    street: address.street || '',
    city: address.city || '',
    state: address.state || '',
    postalCode: address.postalCode || '',
    country: address.country || '',
  });
}

function formatPickupAddress(address: UserAddress | null) {
  if (!address) return 'Select saved pickup address';

  const line = [
    address.street,
    address.city,
    address.state,
    address.postalCode,
  ]
    .filter(Boolean)
    .join(', ');

  return `${address.label || 'Pickup'}${line ? ` - ${line}` : ''}`;
}

function StoryVideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.loop = false;
  });

  return (
    <VideoView
      style={styles.videoPreview}
      player={player}
      nativeControls
      contentFit="cover"
    />
  );
}

export default function EditSellerProfileScreen() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [form, setForm] = useState<SellerFormState>(EMPTY_FORM);
  const [initialForm, setInitialForm] = useState<SellerFormState>(EMPTY_FORM);
  const [addressModalVisible, setAddressModalVisible] = useState(false);
  const [pickupAddressId, setPickupAddressId] = useState<string | null>(null);
  const [pickupAddressSnapshot, setPickupAddressSnapshot] = useState<UserAddress | null>(null);
  const [initialPickupAddressId, setInitialPickupAddressId] = useState<string | null>(null);
  const [initialPickupAddressSnapshot, setInitialPickupAddressSnapshot] = useState<UserAddress | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const profile = await getProfile();
        const nextForm: SellerFormState = {
          sellerDisplayName: String(profile?.sellerDisplayName || profile?.name || ''),
          sellerTagline: String(profile?.sellerTagline || ''),
          sellerStory: String(profile?.sellerStory || ''),
          sellerStoryVideoUrl: String(profile?.sellerStoryVideoUrl || ''),
          sellerInstagram: String(profile?.sellerInstagram || ''),
          sellerContactEmail: String(profile?.sellerContactEmail || profile?.email || ''),
          sellerContactPhone: String(profile?.sellerContactPhone || profile?.phoneNumber || ''),
          sellerWebsite: String(profile?.sellerWebsite || ''),
          sellerLocation: String(profile?.sellerLocation || ''),
        };
        const nextPickupAddress = mapSellerPickupToAddress(profile?.sellerPickupAddress);
        const nextPickupAddressId = nextPickupAddress?._id ? String(nextPickupAddress._id) : null;

        setForm(nextForm);
        setInitialForm(nextForm);
        setPickupAddressId(nextPickupAddressId);
        setPickupAddressSnapshot(nextPickupAddress);
        setInitialPickupAddressId(nextPickupAddressId);
        setInitialPickupAddressSnapshot(nextPickupAddress);
      } catch (err: any) {
        Alert.alert('Error', err?.message || 'Failed to load seller profile');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const hasChanges = useMemo(() => {
    const formChanged = JSON.stringify(form) !== JSON.stringify(initialForm);
    const pickupIdChanged = (pickupAddressId || '') !== (initialPickupAddressId || '');
    const pickupSnapshotChanged =
      serializePickupAddress(pickupAddressSnapshot) !== serializePickupAddress(initialPickupAddressSnapshot);

    return formChanged || pickupIdChanged || pickupSnapshotChanged;
  }, [form, initialForm, pickupAddressId, initialPickupAddressId, pickupAddressSnapshot, initialPickupAddressSnapshot]);

  const setField = (key: keyof SellerFormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handlePickStoryVideo = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission required', 'Allow gallery access to upload a story video.');
        return;
      }

      const result = await (ImagePicker as any).launchImageLibraryAsync({
        mediaTypes: ['videos'],
        quality: 0.8,
        allowsMultipleSelection: false,
      });

      const anyResult = result as any;
      const uri = anyResult?.assets?.[0]?.uri || anyResult?.uri;
      if (!uri) {
        return;
      }

      setUploadingVideo(true);
      const upload = await uploadProductFile(uri);
      setField('sellerStoryVideoUrl', String(upload?.url || ''));
      Alert.alert('Uploaded', 'Story video added to your storefront profile.');
    } catch (err: any) {
      Alert.alert('Upload failed', err?.message || 'Could not upload story video.');
    } finally {
      setUploadingVideo(false);
    }
  };

  const handleSave = async () => {
    if (!form.sellerDisplayName.trim()) {
      Alert.alert('Missing field', 'Storefront name is required.');
      return;
    }

    if (!pickupAddressId && !pickupAddressSnapshot) {
      Alert.alert('Pickup address required', 'Please select a pickup address for shipment collection.');
      return;
    }

    if (pickupAddressSnapshot && !String(pickupAddressSnapshot.state || '').trim()) {
      Alert.alert('Address incomplete', 'Selected pickup address must include state for shipping.');
      return;
    }

    try {
      setSaving(true);
      const payload = {
        sellerDisplayName: form.sellerDisplayName.trim(),
        sellerTagline: form.sellerTagline.trim(),
        sellerStory: form.sellerStory.trim(),
        sellerStoryVideoUrl: form.sellerStoryVideoUrl.trim(),
        sellerInstagram: form.sellerInstagram.trim(),
        sellerContactEmail: form.sellerContactEmail.trim(),
        sellerContactPhone: form.sellerContactPhone.trim(),
        sellerWebsite: form.sellerWebsite.trim(),
        sellerLocation: form.sellerLocation.trim(),
        sellerPickupAddressId: pickupAddressId || undefined,
        sellerPickupAddress: pickupAddressSnapshot
          ? {
              label: String(pickupAddressSnapshot.label || 'Pickup'),
              fullName: String(pickupAddressSnapshot.fullName || ''),
              phoneNumber: String(pickupAddressSnapshot.phoneNumber || ''),
              email: String(pickupAddressSnapshot.email || ''),
              street: String(pickupAddressSnapshot.street || ''),
              city: String(pickupAddressSnapshot.city || ''),
              state: String(pickupAddressSnapshot.state || ''),
              postalCode: String(pickupAddressSnapshot.postalCode || ''),
              country: String(pickupAddressSnapshot.country || 'India'),
            }
          : undefined,
      };

      await updateSellerProfile(payload);
      setInitialForm(form);
      setInitialPickupAddressId(pickupAddressId);
      setInitialPickupAddressSnapshot(pickupAddressSnapshot);

      Alert.alert('Saved', 'Your seller storefront has been updated.', [
        {
          text: 'OK',
          onPress: () => router.back(),
        },
      ]);
    } catch (err: any) {
      Alert.alert('Save failed', err?.message || 'Could not update seller profile.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator size="large" color="#9df0a2" />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.headerBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={18} color="#e8f0ff" />
        </Pressable>
        <ThemedText style={styles.headerTitle}>Edit Storefront</ThemedText>
        <View style={styles.headerGhost} />
      </View>

      <View style={styles.infoBanner}>
        <Ionicons name="shield-checkmark-outline" size={14} color="#9df0a2" />
        <ThemedText style={styles.infoBannerText}>Only your own storefront can be edited from this screen.</ThemedText>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.fieldWrap}>
          <ThemedText style={styles.label}>Storefront Name</ThemedText>
          <TextInput
            style={styles.input}
            placeholder="Your craft brand name"
            placeholderTextColor="#7f8ea4"
            value={form.sellerDisplayName}
            onChangeText={(value) => setField('sellerDisplayName', value)}
          />
        </View>

        <View style={styles.fieldWrap}>
          <ThemedText style={styles.label}>Tagline</ThemedText>
          <TextInput
            style={styles.input}
            placeholder="One-line brand promise"
            placeholderTextColor="#7f8ea4"
            value={form.sellerTagline}
            onChangeText={(value) => setField('sellerTagline', value)}
          />
        </View>

        <View style={styles.fieldWrap}>
          <ThemedText style={styles.label}>Growth Story</ThemedText>
          <TextInput
            style={[styles.input, styles.storyInput]}
            placeholder="Tell buyers your journey and craft process"
            placeholderTextColor="#7f8ea4"
            multiline
            value={form.sellerStory}
            onChangeText={(value) => setField('sellerStory', value)}
          />
        </View>

        <View style={styles.fieldWrap}>
          <ThemedText style={styles.label}>Story Video</ThemedText>
          <Pressable
            style={({ pressed }) => [styles.uploadBtn, pressed && styles.btnPressed]}
            onPress={handlePickStoryVideo}
            disabled={uploadingVideo}>
            {uploadingVideo ? (
              <ActivityIndicator size="small" color="#0a0a0a" />
            ) : (
              <Ionicons name="videocam-outline" size={16} color="#0a0a0a" />
            )}
            <ThemedText style={styles.uploadBtnText}>{uploadingVideo ? 'Uploading...' : 'Upload Story Video'}</ThemedText>
          </Pressable>

          {form.sellerStoryVideoUrl ? (
            <View style={styles.videoWrap}>
              <StoryVideoPreview uri={form.sellerStoryVideoUrl} />
              <Pressable
                style={styles.removeVideoBtn}
                onPress={() => setField('sellerStoryVideoUrl', '')}>
                <Ionicons name="trash-outline" size={14} color="#ffb8b8" />
                <ThemedText style={styles.removeVideoText}>Remove video</ThemedText>
              </Pressable>
            </View>
          ) : null}
        </View>

        <View style={styles.fieldWrap}>
          <ThemedText style={styles.label}>Instagram</ThemedText>
          <TextInput
            style={styles.input}
            placeholder="@your_handle"
            placeholderTextColor="#7f8ea4"
            value={form.sellerInstagram}
            onChangeText={(value) => setField('sellerInstagram', value)}
          />
        </View>

        <View style={styles.fieldWrap}>
          <ThemedText style={styles.label}>Website</ThemedText>
          <TextInput
            style={styles.input}
            placeholder="yourbrand.com"
            placeholderTextColor="#7f8ea4"
            value={form.sellerWebsite}
            onChangeText={(value) => setField('sellerWebsite', value)}
            autoCapitalize="none"
          />
        </View>

        <View style={styles.fieldWrap}>
          <ThemedText style={styles.label}>Contact Email</ThemedText>
          <TextInput
            style={styles.input}
            placeholder="hello@yourbrand.com"
            placeholderTextColor="#7f8ea4"
            value={form.sellerContactEmail}
            onChangeText={(value) => setField('sellerContactEmail', value)}
            autoCapitalize="none"
            keyboardType="email-address"
          />
        </View>

        <View style={styles.fieldWrap}>
          <ThemedText style={styles.label}>Contact Phone</ThemedText>
          <TextInput
            style={styles.input}
            placeholder="+91 ..."
            placeholderTextColor="#7f8ea4"
            value={form.sellerContactPhone}
            onChangeText={(value) => setField('sellerContactPhone', value)}
            keyboardType="phone-pad"
          />
        </View>

        <View style={styles.fieldWrap}>
          <ThemedText style={styles.label}>Pickup Address</ThemedText>
          <Pressable
            style={({ pressed }) => [styles.addressPicker, pressed && styles.btnPressed]}
            onPress={() => setAddressModalVisible(true)}>
            <View style={styles.addressPickerTextWrap}>
              <ThemedText style={styles.addressPickerValue}>{formatPickupAddress(pickupAddressSnapshot)}</ThemedText>
              <ThemedText style={styles.addressPickerHint}>Used as seller pickup origin for courier booking.</ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#9aa7b8" />
          </Pressable>
        </View>

        <View style={styles.fieldWrap}>
          <ThemedText style={styles.label}>Location</ThemedText>
          <TextInput
            style={styles.input}
            placeholder="City, State"
            placeholderTextColor="#7f8ea4"
            value={form.sellerLocation}
            onChangeText={(value) => setField('sellerLocation', value)}
          />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.cancelBtn} onPress={() => router.back()}>
          <ThemedText style={styles.cancelBtnText}>Cancel</ThemedText>
        </Pressable>
        <Pressable
          style={[styles.saveBtn, (!hasChanges || saving) && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={!hasChanges || saving}>
          {saving ? <ActivityIndicator size="small" color="#0a0a0a" /> : <ThemedText style={styles.saveBtnText}>Save</ThemedText>}
        </Pressable>
      </View>

      <AddressPickerModal
        visible={addressModalVisible}
        onClose={() => setAddressModalVisible(false)}
        returnTo="/edit-seller-profile"
        onSelect={(addr) => {
          setPickupAddressId((addr as any)?._id ? String((addr as any)._id) : null);
          setPickupAddressSnapshot(addr as UserAddress);
          setAddressModalVisible(false);
        }}
      />
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
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a0a0a',
  },
  header: {
    paddingTop: 58,
    paddingBottom: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#243247',
  },
  headerBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2b3c52',
    backgroundColor: '#131f2f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerGhost: {
    width: 34,
    height: 34,
  },
  headerTitle: {
    color: '#f4f8ff',
    fontSize: 19,
    fontWeight: '700',
  },
  infoBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2f4a3a',
    backgroundColor: '#14241c',
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  infoBannerText: {
    flex: 1,
    color: '#bfeacc',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  content: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    paddingBottom: 24,
    gap: 12,
  },
  fieldWrap: {
    gap: 7,
  },
  label: {
    color: '#d8e7ff',
    fontSize: 13,
    fontWeight: '700',
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2d3f57',
    backgroundColor: '#141f2f',
    color: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
  },
  addressPicker: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2d3f57',
    backgroundColor: '#141f2f',
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  addressPickerTextWrap: {
    flex: 1,
    gap: 3,
  },
  addressPickerValue: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  addressPickerHint: {
    color: '#9aa7b8',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '500',
  },
  storyInput: {
    minHeight: 104,
    textAlignVertical: 'top',
  },
  uploadBtn: {
    borderRadius: 10,
    backgroundColor: '#9df0a2',
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  uploadBtnText: {
    color: '#0a0a0a',
    fontSize: 13,
    fontWeight: '800',
  },
  videoWrap: {
    marginTop: 10,
    gap: 8,
  },
  videoPreview: {
    width: '100%',
    height: 210,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#0e1622',
  },
  removeVideoBtn: {
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#583235',
    backgroundColor: '#2a1719',
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  removeVideoText: {
    color: '#ffb8b8',
    fontSize: 12,
    fontWeight: '700',
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#243247',
    paddingBottom: 24,
  },
  cancelBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2f425d',
    backgroundColor: '#162335',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
  },
  cancelBtnText: {
    color: '#d8e7ff',
    fontSize: 13,
    fontWeight: '700',
  },
  saveBtn: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: '#9df0a2',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
  },
  saveBtnDisabled: {
    opacity: 0.45,
  },
  saveBtnText: {
    color: '#0a0a0a',
    fontSize: 13,
    fontWeight: '800',
  },
  btnPressed: {
    opacity: 0.85,
  },
});
