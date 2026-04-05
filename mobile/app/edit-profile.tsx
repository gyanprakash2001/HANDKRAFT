import { useState, useEffect } from 'react';
import { StyleSheet, View, Pressable, ActivityIndicator, ScrollView, Alert, TextInput } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { updateUserProfile, getProfile } from '@/utils/api';

export default function EditProfileScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [changes, setChanges] = useState(false);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const profile = await getProfile();
        setName((prev) => (prev && String(prev).trim() ? prev : String(profile.name || '')));
        setPhoneNumber((prev) => (prev && String(prev).trim() ? prev : String(profile.phoneNumber || '')));
        setEmail((prev) => (prev && String(prev).trim() ? prev : String(profile.email || '')));
      } catch {
        // Load from params if API fails
        if (params.name) setName((prev) => (prev && String(prev).trim() ? prev : (params.name as string)));
        if (params.email) setEmail((prev) => (prev && String(prev).trim() ? prev : (params.email as string)));
      }
    };

    loadProfile();
  }, [params]);

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Name cannot be empty');
      return;
    }

    setLoading(true);
    try {
      await updateUserProfile({
        name: name.trim(),
        phoneNumber: phoneNumber.trim(),
        });

        setChanges(false);

        Alert.alert('Success', 'Profile updated successfully', [
          {
            text: 'OK',
            onPress: () => router.back(),
          },
        ]);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </Pressable>
        <ThemedText style={styles.headerTitle}>Edit Profile</ThemedText>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        <View style={styles.section}>
          <ThemedText style={styles.label}>Full Name</ThemedText>
          <TextInput
            style={styles.input}
            placeholder="Enter your name"
            placeholderTextColor="#666"
            value={name}
            onChangeText={(text) => {
              setName(text);
              setChanges(true);
            }}
          />
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.label}>Phone Number</ThemedText>
          <TextInput
            style={styles.input}
            placeholder="Enter your phone number"
            placeholderTextColor="#666"
            value={phoneNumber}
            onChangeText={(text) => {
              setPhoneNumber(text);
              setChanges(true);
            }}
            keyboardType="phone-pad"
          />
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.label}>Email</ThemedText>
          <TextInput
            style={[styles.input, { opacity: 0.9 }]}
            placeholder="Email Address"
            placeholderTextColor="#666"
            value={email}
            editable={false}
            keyboardType="email-address"
          />
        </View>

        {/* Bio removed from profile UI per product request */}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.cancelButton} onPress={() => router.back()}>
          <ThemedText style={styles.cancelText}>Cancel</ThemedText>
        </Pressable>
        <Pressable
          style={[styles.saveButton, !changes && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={loading || !changes}>
          {loading ? (
            <ActivityIndicator size="small" color="#0a0a0a" />
          ) : (
            <ThemedText style={styles.saveText}>Save Changes</ThemedText>
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
  header: {
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
  },
  headerSpacer: {
    width: 44,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  section: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#141922',
    borderWidth: 1,
    borderColor: '#272f3d',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 14,
    fontFamily: 'System',
  },
  bioInput: {
    paddingTop: 12,
    paddingBottom: 60,
    textAlignVertical: 'top',
  },
  charCount: {
    fontSize: 12,
    color: '#8e9bb2',
    marginTop: 6,
    textAlign: 'right',
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
    paddingBottom: 28,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#272f3d',
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  saveButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#9df0a2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0a0a0a',
  },
});
