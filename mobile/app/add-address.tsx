import { useState } from 'react';
import { StyleSheet, View, Pressable, ActivityIndicator, ScrollView, Alert, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { addUserAddress } from '@/utils/api';

export default function AddAddressScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const returnTo = typeof params.returnTo === 'string' && params.returnTo.trim()
    ? params.returnTo
    : '/profile';
  const [loading, setLoading] = useState(false);
  const [label, setLabel] = useState('Home');
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('India');
  const [isDefault, setIsDefault] = useState(false);

  const handleSave = async () => {
    if (!fullName.trim() || !phoneNumber.trim() || !email.trim() || !street.trim() || !city.trim() || !postalCode.trim()) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    setLoading(true);
    try {
      await addUserAddress({
        label,
        fullName: fullName.trim(),
        phoneNumber: phoneNumber.trim(),
        email: email.trim(),
        street: street.trim(),
        city: city.trim(),
        state: state.trim(),
        postalCode: postalCode.trim(),
        country,
        isDefault,
      });

      Alert.alert('Success', 'Address added successfully', [
        {
          text: 'OK',
          onPress: () => router.back(),
        },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to add address');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={28} color="#fff" />
          </Pressable>
          <ThemedText style={styles.headerTitle}>Add Address</ThemedText>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView style={styles.content} contentContainerStyle={styles.contentInner} keyboardShouldPersistTaps="handled">
          <View style={styles.section}>
            <ThemedText style={styles.label}>Address Label</ThemedText>
            <View style={styles.labelOptions}>
              {['Home', 'Work', 'Other'].map((option) => (
                <Pressable
                  key={option}
                  style={[styles.labelButton, label === option && styles.labelButtonActive]}
                  onPress={() => setLabel(option)}>
                  <ThemedText style={[styles.labelButtonText, label === option && styles.labelButtonTextActive]}>
                    {option}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <ThemedText style={styles.label}>Full Name *</ThemedText>
            <TextInput
              style={styles.input}
              placeholder="Enter your full name"
              placeholderTextColor="#666"
              value={fullName}
              onChangeText={setFullName}
            />
          </View>

          <View style={styles.section}>
            <ThemedText style={styles.label}>Phone Number *</ThemedText>
            <TextInput
              style={styles.input}
              placeholder="Enter phone number"
              placeholderTextColor="#666"
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              keyboardType="phone-pad"
            />
          </View>

          <View style={styles.section}>
            <ThemedText style={styles.label}>Email Address *</ThemedText>
            <TextInput
              style={styles.input}
              placeholder="Enter email address"
              placeholderTextColor="#666"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
            />
          </View>

          <View style={styles.section}>
            <ThemedText style={styles.label}>Street Address *</ThemedText>
            <TextInput
              style={[styles.input, styles.bioInput]}
              placeholder="House no., Building name"
              placeholderTextColor="#666"
              value={street}
              onChangeText={setStreet}
              multiline
              numberOfLines={2}
            />
          </View>

          <View style={styles.row}>
            <View style={[styles.section, styles.halfWidth]}>
              <ThemedText style={styles.label}>City *</ThemedText>
              <TextInput
                style={styles.input}
                placeholder="City"
                placeholderTextColor="#666"
                value={city}
                onChangeText={setCity}
              />
            </View>
            <View style={[styles.section, styles.halfWidth]}>
              <ThemedText style={styles.label}>State</ThemedText>
              <TextInput
                style={styles.input}
                placeholder="State"
                placeholderTextColor="#666"
                value={state}
                onChangeText={setState}
              />
            </View>
          </View>

          <View style={styles.row}>
            <View style={[styles.section, styles.halfWidth]}>
              <ThemedText style={styles.label}>Postal Code *</ThemedText>
              <TextInput
                style={styles.input}
                placeholder="Postal code"
                placeholderTextColor="#666"
                value={postalCode}
                onChangeText={setPostalCode}
                keyboardType="number-pad"
              />
            </View>
            <View style={[styles.section, styles.halfWidth]}>
              <ThemedText style={styles.label}>Country</ThemedText>
              <TextInput
                style={styles.input}
                placeholder="Country"
                placeholderTextColor="#666"
                value={country}
                onChangeText={setCountry}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Pressable style={styles.checkboxRow} onPress={() => setIsDefault(!isDefault)}>
              <View style={[styles.checkbox, isDefault && styles.checkboxChecked]}>
                {isDefault && <Ionicons name="checkmark" size={16} color="#0a0a0a" />}
              </View>
              <ThemedText style={styles.checkboxLabel}>Set as default address</ThemedText>
            </Pressable>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable style={styles.cancelButton} onPress={() => router.back()}>
            <ThemedText style={styles.cancelText}>Cancel</ThemedText>
          </Pressable>
          <Pressable style={styles.saveButton} onPress={handleSave} disabled={loading}>
            {loading ? (
              <ActivityIndicator size="small" color="#0a0a0a" />
            ) : (
              <ThemedText style={styles.saveText}>Add Address</ThemedText>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
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
    paddingBottom: 100,
  },
  section: {
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  halfWidth: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 6,
  },
  labelOptions: {
    flexDirection: 'row',
    gap: 10,
  },
  labelButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#272f3d',
    alignItems: 'center',
  },
  labelButtonActive: {
    borderColor: '#9df0a2',
    backgroundColor: '#1a4d2e',
  },
  labelButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8e9bb2',
  },
  labelButtonTextActive: {
    color: '#9df0a2',
  },
  input: {
    backgroundColor: '#141922',
    borderWidth: 1,
    borderColor: '#272f3d',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
    fontFamily: 'System',
  },
  bioInput: {
    paddingTop: 10,
    paddingBottom: 40,
    textAlignVertical: 'top',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#272f3d',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    borderColor: '#9df0a2',
    backgroundColor: '#9df0a2',
  },
  checkboxLabel: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '500',
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
  saveText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0a0a0a',
  },
});
