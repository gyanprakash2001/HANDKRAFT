import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { getProductById, updateProduct, normalizeAssetUrl } from '@/utils/api';

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

export default function EditProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form fields state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [customCategory, setCustomCategory] = useState('');
  const [material, setMaterial] = useState('');
  const [price, setPrice] = useState('');
  const [discountedPrice, setDiscountedPrice] = useState('');
  const [stock, setStock] = useState('1');
  const [packageWeightGrams, setPackageWeightGrams] = useState('500');
  const [packageLengthCm, setPackageLengthCm] = useState('10');
  const [packageBreadthCm, setPackageBreadthCm] = useState('10');
  const [packageHeightCm, setPackageHeightCm] = useState('10');
  const [customizable, setCustomizable] = useState(false);
  const [existingMedia, setExistingMedia] = useState<any[]>([]);

  // Category dropdown state
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);

  useEffect(() => {
    if (!id) {
      setError('Missing product ID');
      setLoading(false);
      return;
    }

    async function loadProduct() {
      try {
        setLoading(true);
        setError(null);
        const product = await getProductById(id as string);
        
        setTitle(product.title || '');
        setDescription(product.description || '');
        setCategory(product.category || '');
        setCustomCategory(product.customCategory || '');
        setMaterial(product.material || '');
        setPrice(String(product.realPrice ?? product.price ?? ''));
        setDiscountedPrice(product.discountedPrice ? String(product.discountedPrice) : '');
        setStock(String(product.stock ?? '0'));
        setPackageWeightGrams(String(product.packageWeightGrams ?? '0'));
        setPackageLengthCm(String(product.packageLengthCm ?? '0'));
        setPackageBreadthCm(String(product.packageBreadthCm ?? '0'));
        setPackageHeightCm(String(product.packageHeightCm ?? '0'));
        setCustomizable(Boolean(product.customizable));
        setExistingMedia(product.media || []);
      } catch (err: any) {
        setError(err.message || 'Failed to load product details');
      } finally {
        setLoading(false);
      }
    }

    loadProduct();
  }, [id]);

  const handleUpdate = async () => {
    if (!title.trim()) {
      Alert.alert('Validation Error', 'Title is required');
      return;
    }
    if (!category) {
      Alert.alert('Validation Error', 'Category is required');
      return;
    }
    if (category === 'Others' && !customCategory.trim()) {
      Alert.alert('Validation Error', 'Please specify custom category');
      return;
    }
    
    const parsedPrice = Number(price);
    if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
      Alert.alert('Validation Error', 'Price must be a valid non-negative number');
      return;
    }

    let parsedDiscountedPrice: number | null = null;
    if (discountedPrice.trim() !== '') {
      parsedDiscountedPrice = Number(discountedPrice);
      if (Number.isNaN(parsedDiscountedPrice) || parsedDiscountedPrice < 0) {
        Alert.alert('Validation Error', 'Discounted price must be a valid non-negative number');
        return;
      }
      if (parsedDiscountedPrice > parsedPrice) {
        Alert.alert('Validation Error', 'Discounted price cannot be greater than original price');
        return;
      }
    }

    const parsedStock = Number(stock);
    if (Number.isNaN(parsedStock) || parsedStock < 0 || !Number.isInteger(parsedStock)) {
      Alert.alert('Validation Error', 'Stock must be a valid non-negative integer');
      return;
    }

    try {
      setSubmitting(true);
      await updateProduct(id as string, {
        title: title.trim(),
        description: description.trim(),
        category,
        customCategory: category === 'Others' ? customCategory.trim() : '',
        material: material.trim(),
        realPrice: parsedPrice,
        price: parsedPrice,
        discountedPrice: parsedDiscountedPrice,
        stock: parsedStock,
        packageWeightGrams: Number(packageWeightGrams || 0),
        packageLengthCm: Number(packageLengthCm || 0),
        packageBreadthCm: Number(packageBreadthCm || 0),
        packageHeightCm: Number(packageHeightCm || 0),
        customizable,
      });

      Alert.alert('Success', 'Listing updated successfully!', [
        { text: 'OK', onPress: () => router.back() }
      ]);
    } catch (err: any) {
      Alert.alert('Update Failed', err.message || 'Could not update listing.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator size="large" color="#9df0a2" />
        <ThemedText style={styles.loadingText}>Fetching listing details...</ThemedText>
      </ThemedView>
    );
  }

  if (error) {
    return (
      <ThemedView style={styles.center}>
        <Ionicons name="alert-circle-outline" size={48} color="#ff8f8f" />
        <ThemedText style={styles.errorText}>{error}</ThemedText>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <ThemedText style={styles.backBtnText}>Go Back</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerIconBtn}>
          <Ionicons name="close" size={24} color="#fff" />
        </Pressable>
        <ThemedText style={styles.headerTitle}>Edit Listing</ThemedText>
        <Pressable onPress={handleUpdate} disabled={submitting} style={styles.headerIconBtn}>
          {submitting ? (
            <ActivityIndicator size="small" color="#9df0a2" />
          ) : (
            <Ionicons name="checkmark" size={24} color="#9df0a2" />
          )}
        </Pressable>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Media Preview Section */}
          {existingMedia.length > 0 ? (
            <View style={styles.mediaContainer}>
              <ThemedText style={styles.sectionTitle}>Existing Photos</ThemedText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mediaScroll}>
                {existingMedia.map((m: any, index: number) => {
                  const uri = normalizeAssetUrl(m.thumbnailUrl || m.url || '');
                  return (
                    <View key={index} style={styles.mediaItem}>
                      <Image source={{ uri }} style={styles.mediaImage} contentFit="cover" />
                      {m.type === 'video' ? (
                        <View style={styles.videoBadge}>
                          <Ionicons name="play" size={10} color="#fff" />
                          <ThemedText style={styles.videoBadgeText}>VIDEO</ThemedText>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </ScrollView>
              <ThemedText style={styles.mediaNote}>
                Media edits are currently locked. To update photos/videos, please create a new listing.
              </ThemedText>
            </View>
          ) : null}

          {/* Form Fields */}
          <View style={styles.card}>
            <ThemedText style={styles.fieldLabel}>Product Title *</ThemedText>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Handmade Ceramic Flower Vase"
              placeholderTextColor="#5a6e85"
              style={styles.input}
            />

            <ThemedText style={styles.fieldLabel}>Category *</ThemedText>
            <Pressable
              style={styles.dropdownTrigger}
              onPress={() => setCategoryDropdownOpen(!categoryDropdownOpen)}
            >
              <ThemedText style={category ? styles.dropdownText : styles.dropdownPlaceholder}>
                {category || 'Select Category'}
              </ThemedText>
              <Ionicons
                name={categoryDropdownOpen ? 'chevron-up' : 'chevron-down'}
                size={18}
                color="#8fa6c4"
              />
            </Pressable>

            {categoryDropdownOpen && (
              <View style={styles.dropdownList}>
                {SELLER_CATEGORIES.map((cat) => (
                  <Pressable
                    key={cat}
                    style={styles.dropdownItem}
                    onPress={() => {
                      setCategory(cat);
                      setCategoryDropdownOpen(false);
                    }}
                  >
                    <ThemedText style={category === cat ? styles.dropdownItemSelectedText : styles.dropdownItemText}>
                      {cat}
                    </ThemedText>
                    {category === cat && <Ionicons name="checkmark" size={16} color="#9df0a2" />}
                  </Pressable>
                ))}
              </View>
            )}

            {category === 'Others' && (
              <View style={{ marginTop: 10 }}>
                <ThemedText style={styles.fieldLabel}>Custom Category Name *</ThemedText>
                <TextInput
                  value={customCategory}
                  onChangeText={setCustomCategory}
                  placeholder="e.g. Leatherwork"
                  placeholderTextColor="#5a6e85"
                  style={styles.input}
                />
              </View>
            )}

            <ThemedText style={styles.fieldLabel}>Material Used</ThemedText>
            <TextInput
              value={material}
              onChangeText={setMaterial}
              placeholder="e.g. Clay, Oak wood, 100% Linen"
              placeholderTextColor="#5a6e85"
              style={styles.input}
            />
          </View>

          {/* Pricing and Stock Card */}
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <ThemedText style={styles.fieldLabel}>Price (₹) *</ThemedText>
                <TextInput
                  value={price}
                  onChangeText={setPrice}
                  placeholder="0.00"
                  placeholderTextColor="#5a6e85"
                  keyboardType="decimal-pad"
                  style={styles.input}
                />
              </View>
              <View style={{ width: 12 }} />
              <View style={{ flex: 1 }}>
                <ThemedText style={styles.fieldLabel}>Discount Price (₹)</ThemedText>
                <TextInput
                  value={discountedPrice}
                  onChangeText={setDiscountedPrice}
                  placeholder="Optional"
                  placeholderTextColor="#5a6e85"
                  keyboardType="decimal-pad"
                  style={styles.input}
                />
              </View>
            </View>

            <ThemedText style={styles.fieldLabel}>Available Stock *</ThemedText>
            <TextInput
              value={stock}
              onChangeText={setStock}
              placeholder="1"
              placeholderTextColor="#5a6e85"
              keyboardType="number-pad"
              style={styles.input}
            />
          </View>

          {/* Packaging Details Card */}
          <View style={styles.card}>
            <ThemedText style={styles.cardTitle}>Shipping Dimensions (for NimbusPost)</ThemedText>
            <ThemedText style={styles.cardSubtitle}>
              Accurate package details prevent shipping charge disputes.
            </ThemedText>

            <ThemedText style={styles.fieldLabel}>Dead Weight (Grams)</ThemedText>
            <TextInput
              value={packageWeightGrams}
              onChangeText={setPackageWeightGrams}
              placeholder="500"
              placeholderTextColor="#5a6e85"
              keyboardType="number-pad"
              style={styles.input}
            />

            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <ThemedText style={styles.fieldLabel}>Length (cm)</ThemedText>
                <TextInput
                  value={packageLengthCm}
                  onChangeText={setPackageLengthCm}
                  placeholder="10"
                  placeholderTextColor="#5a6e85"
                  keyboardType="number-pad"
                  style={styles.input}
                />
              </View>
              <View style={{ width: 8 }} />
              <View style={{ flex: 1 }}>
                <ThemedText style={styles.fieldLabel}>Breadth (cm)</ThemedText>
                <TextInput
                  value={packageBreadthCm}
                  onChangeText={setPackageBreadthCm}
                  placeholder="10"
                  placeholderTextColor="#5a6e85"
                  keyboardType="number-pad"
                  style={styles.input}
                />
              </View>
              <View style={{ width: 8 }} />
              <View style={{ flex: 1 }}>
                <ThemedText style={styles.fieldLabel}>Height (cm)</ThemedText>
                <TextInput
                  value={packageHeightCm}
                  onChangeText={setPackageHeightCm}
                  placeholder="10"
                  placeholderTextColor="#5a6e85"
                  keyboardType="number-pad"
                  style={styles.input}
                />
              </View>
            </View>
          </View>

          {/* Customizability & Description Card */}
          <View style={styles.card}>
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <ThemedText style={styles.switchLabel}>Accept Customization</ThemedText>
                <ThemedText style={styles.switchSub}>
                  Allow buyers to request custom orders of this item.
                </ThemedText>
              </View>
              <Switch
                value={customizable}
                onValueChange={setCustomizable}
                trackColor={{ false: '#202938', true: '#2c5a3b' }}
                thumbColor={customizable ? '#9df0a2' : '#68788d'}
              />
            </View>

            <View style={{ height: 16 }} />

            <ThemedText style={styles.fieldLabel}>Description</ThemedText>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Tell buyers about how you make this item, materials used, production processes..."
              placeholderTextColor="#5a6e85"
              multiline
              numberOfLines={4}
              style={[styles.input, styles.textArea]}
            />
          </View>

          {/* Submit Button */}
          <Pressable
            onPress={handleUpdate}
            disabled={submitting}
            style={({ pressed }) => [styles.submitBtn, (pressed || submitting) && { opacity: 0.8 }]}
          >
            {submitting ? (
              <ActivityIndicator color="#0a0a0a" />
            ) : (
              <ThemedText style={styles.submitBtnText}>Update Listing</ThemedText>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
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
    padding: 20,
    backgroundColor: '#0a0a0a',
  },
  loadingText: {
    marginTop: 12,
    color: '#8fa6c4',
    fontSize: 14,
  },
  errorText: {
    marginTop: 12,
    color: '#ff8f8f',
    textAlign: 'center',
    fontSize: 14,
    marginBottom: 20,
  },
  header: {
    paddingTop: 54,
    paddingBottom: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#1a222e',
    backgroundColor: '#000',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
  },
  headerIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111720',
  },
  scrollContent: {
    padding: 14,
    gap: 12,
    paddingBottom: 40,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8fa6c4',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  mediaContainer: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ffffff',
    backgroundColor: '#000',
    padding: 12,
  },
  mediaScroll: {
    gap: 8,
    paddingBottom: 4,
  },
  mediaItem: {
    width: 90,
    height: 90,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#151c26',
    position: 'relative',
  },
  mediaImage: {
    width: '100%',
    height: '100%',
  },
  videoBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  videoBadgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '800',
  },
  mediaNote: {
    color: '#68788d',
    fontSize: 11,
    marginTop: 8,
    fontStyle: 'italic',
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ffffff',
    backgroundColor: '#000',
    padding: 14,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 2,
  },
  cardSubtitle: {
    fontSize: 11,
    color: '#8fa6c4',
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8fa6c4',
    marginTop: 10,
    marginBottom: 6,
  },
  input: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#202a39',
    backgroundColor: '#0c1017',
    color: '#fff',
    paddingHorizontal: 12,
    fontSize: 14,
  },
  textArea: {
    height: 100,
    paddingTop: 12,
    paddingBottom: 12,
    textAlignVertical: 'top',
  },
  dropdownTrigger: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#202a39',
    backgroundColor: '#0c1017',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  dropdownText: {
    color: '#fff',
    fontSize: 14,
  },
  dropdownPlaceholder: {
    color: '#5a6e85',
    fontSize: 14,
  },
  dropdownList: {
    marginTop: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#202a39',
    backgroundColor: '#0c1017',
    overflow: 'hidden',
  },
  dropdownItem: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#151c26',
  },
  dropdownItemText: {
    color: '#cbd5e1',
    fontSize: 13,
  },
  dropdownItemSelectedText: {
    color: '#9df0a2',
    fontSize: 13,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switchLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
  },
  switchSub: {
    fontSize: 11,
    color: '#8fa6c4',
    marginTop: 2,
  },
  submitBtn: {
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#78cf84',
    backgroundColor: '#9df0a2',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  submitBtnText: {
    color: '#0a0a0a',
    fontSize: 15,
    fontWeight: '800',
  },
  backBtn: {
    borderWidth: 1,
    borderColor: '#202938',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#111720',
  },
  backBtnText: {
    color: '#fff',
    fontWeight: '700',
  },
});
