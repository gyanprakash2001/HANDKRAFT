import { useState, useEffect } from 'react';
import { StyleSheet, View, Pressable, ActivityIndicator, ScrollView, Alert, TextInput, KeyboardAvoidingView, Platform, Modal } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { addUserAddress, getProfileDashboard, sendOtp, verifyOtp } from '@/utils/api';

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
  const [fetchingPincode, setFetchingPincode] = useState(false);

  // WhatsApp OTP states
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [phoneOtpSent, setPhoneOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpSending, setOtpSending] = useState(false);

  const handlePincodeChange = async (text: string) => {
    const sanitized = text.replace(/[^0-9]/g, '');
    setPostalCode(sanitized);

    if (sanitized.length === 6) {
      setFetchingPincode(true);
      try {
        const response = await fetch(`https://api.postalpincode.in/pincode/${sanitized}`);
        const data = await response.json();
        if (data && data[0] && data[0].Status === 'Success' && data[0].PostOffice && data[0].PostOffice.length > 0) {
          const postOffice = data[0].PostOffice[0];
          setCity(postOffice.District || '');
          setState(postOffice.State || '');
        } else {
          Alert.alert('Error', 'Invalid Pincode. Please enter a valid Indian pincode.');
          setCity('');
          setState('');
        }
      } catch (error) {
        Alert.alert('Error', 'Failed to fetch city and state for this Pincode. Please check your internet connection.');
        setCity('');
        setState('');
      } finally {
        setFetchingPincode(false);
      }
    } else {
      setCity('');
      setState('');
    }
  };

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const dashboard = await getProfileDashboard();
        const profileName = String(dashboard?.user?.name || '').trim();
        const profileEmail = String(dashboard?.user?.email || '').trim();
        const profilePhone = String(dashboard?.user?.phoneNumber || '').trim();

        if (profileName) setFullName((prev) => prev || profileName);
        if (profileEmail) setEmail((prev) => prev || profileEmail);
        if (profilePhone) setPhoneNumber((prev) => prev || profilePhone);
      } catch (err) {
        // silently ignore
      }
    };
    loadProfile();
  }, []);

  const handlePhoneChange = (text: string) => {
    setPhoneNumber(text);
    if (phoneOtpSent) {
      setPhoneOtpSent(false);
      setOtpCode('');
    }
    if (phoneVerified) {
      setPhoneVerified(false);
    }
  };

  const handleSendPhoneOtp = async () => {
    const trimmedPhone = phoneNumber.trim();
    if (!trimmedPhone) {
      Alert.alert('Error', 'Please enter a phone number first');
      return;
    }

    setOtpSending(true);
    try {
      // Normalize and format phone number for WhatsApp message delivery
      let formattedPhone = trimmedPhone.replace(/\s+/g, '');
      if (!formattedPhone.startsWith('+')) {
        if (formattedPhone.length === 10) {
          formattedPhone = `+91${formattedPhone}`;
        } else {
          formattedPhone = `+${formattedPhone}`;
        }
      }

      await sendOtp('', formattedPhone);
      setPhoneOtpSent(true);
      Alert.alert('Success', 'Verification code has been sent to your WhatsApp!');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to send WhatsApp verification code');
    } finally {
      setOtpSending(false);
    }
  };

  const handleVerifyPhoneOtp = async () => {
    const trimmedOtp = otpCode.trim();
    if (!trimmedOtp) {
      Alert.alert('Error', 'Please enter the verification code');
      return;
    }

    setLoading(true);
    try {
      let formattedPhone = phoneNumber.trim().replace(/\s+/g, '');
      if (!formattedPhone.startsWith('+')) {
        if (formattedPhone.length === 10) {
          formattedPhone = `+91${formattedPhone}`;
        } else {
          formattedPhone = `+${formattedPhone}`;
        }
      }

      await verifyOtp(formattedPhone, trimmedOtp);
      setPhoneVerified(true);
      Alert.alert('Success', 'Phone number verified successfully!');
    } catch (err: any) {
      Alert.alert('Verification Failed', err?.message || 'Incorrect OTP or verification expired');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!fullName.trim() || !phoneNumber.trim() || !email.trim() || !street.trim() || !city.trim() || !postalCode.trim()) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    if (!phoneVerified) {
      Alert.alert('Error', 'Please verify your phone number first');
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
        otp: otpCode.trim(),
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
            <View style={styles.inputContainer}>
              <TextInput
                style={[
                  styles.input,
                  { marginVertical: 0 },
                  phoneVerified && styles.inputDisabled,
                  phoneNumber.trim().length > 0 && !phoneVerified && { paddingRight: 115 }
                ]}
                placeholder="Enter phone number"
                placeholderTextColor="#666"
                value={phoneNumber}
                onChangeText={handlePhoneChange}
                keyboardType="phone-pad"
                editable={!phoneVerified}
              />
              {phoneNumber.trim().length > 0 && !phoneVerified && (
                <Pressable
                  style={styles.inlineButton}
                  onPress={handleSendPhoneOtp}
                  disabled={loading || otpSending}>
                  {otpSending ? (
                    <ActivityIndicator size="small" color="#9df0a2" />
                  ) : (
                    <ThemedText style={styles.inlineButtonText}>
                      {phoneOtpSent ? 'Resend OTP' : 'Validate Phone'}
                    </ThemedText>
                  )}
                </Pressable>
              )}
              {phoneVerified && (
                <View style={styles.verifiedBadge}>
                  <Ionicons name="checkmark-circle" size={18} color="#9df0a2" />
                  <ThemedText style={styles.verifiedText}>Verified</ThemedText>
                </View>
              )}
            </View>
          </View>

          {phoneOtpSent && !phoneVerified && (
            <View style={styles.otpContainer}>
              <TextInput
                style={[styles.input, styles.otpInput]}
                placeholder="WhatsApp Verification OTP"
                placeholderTextColor="#b3b3b3"
                value={otpCode}
                onChangeText={setOtpCode}
                keyboardType="number-pad"
                maxLength={6}
              />
              <Pressable
                style={styles.verifyButton}
                onPress={handleVerifyPhoneOtp}
                disabled={loading}>
                {loading ? (
                  <ActivityIndicator size="small" color="#0a0a0a" />
                ) : (
                  <ThemedText style={styles.verifyButtonText}>Verify Phone</ThemedText>
                )}
              </Pressable>
            </View>
          )}

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
              <ThemedText style={styles.label}>Pincode *</ThemedText>
              <View style={{ justifyContent: 'center' }}>
                <TextInput
                  style={styles.input}
                  placeholder="Pincode"
                  placeholderTextColor="#666"
                  value={postalCode}
                  onChangeText={handlePincodeChange}
                  keyboardType="number-pad"
                  maxLength={6}
                />
                {fetchingPincode && (
                  <ActivityIndicator
                    size="small"
                    color="#9df0a2"
                    style={{ position: 'absolute', right: 12 }}
                  />
                )}
              </View>
            </View>
            <View style={[styles.section, styles.halfWidth]}>
              <ThemedText style={styles.label}>City</ThemedText>
              <TextInput
                style={[styles.input, styles.disabledInput]}
                placeholder="City"
                placeholderTextColor="#666"
                value={city}
                editable={false}
              />
            </View>
          </View>

          <View style={styles.row}>
            <View style={[styles.section, styles.halfWidth]}>
              <ThemedText style={styles.label}>State</ThemedText>
              <TextInput
                style={[styles.input, styles.disabledInput]}
                placeholder="State"
                placeholderTextColor="#666"
                value={state}
                editable={false}
              />
            </View>
            <View style={[styles.section, styles.halfWidth]}>
              <ThemedText style={styles.label}>Country</ThemedText>
              <TextInput
                style={[styles.input, styles.disabledInput]}
                placeholder="Country"
                placeholderTextColor="#666"
                value={country}
                editable={false}
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
          <Pressable style={styles.saveButton} onPress={handleSave} disabled={loading || otpSending}>
            {loading || otpSending ? (
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
    borderColor: '#FFFFFF',
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
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
    fontFamily: 'System',
  },
  disabledInput: {
    backgroundColor: '#111111',
    borderColor: '#444444',
    color: '#888888',
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
    borderColor: '#FFFFFF',
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
  inputContainer: {
    position: 'relative',
    justifyContent: 'center',
  },
  inlineButton: {
    position: 'absolute',
    right: 8,
    bottom: 6,
    backgroundColor: 'rgba(157, 240, 162, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(157, 240, 162, 0.3)',
  },
  inlineButtonText: {
    color: '#9df0a2',
    fontSize: 10,
    fontWeight: '600',
  },
  verifiedBadge: {
    position: 'absolute',
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  verifiedText: {
    color: '#9df0a2',
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 4,
  },
  otpContainer: {
    marginVertical: 8,
  },
  otpInput: {
    borderColor: '#9df0a2',
    backgroundColor: '#16222f',
  },
  verifyButton: {
    backgroundColor: '#9df0a2',
    paddingVertical: 10,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  verifyButtonText: {
    color: '#0a0a0a',
    fontSize: 13,
    fontWeight: '700',
  },
});
