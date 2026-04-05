import { useEffect, useState } from 'react';
import { StyleSheet, View, ScrollView, ActivityIndicator, Pressable, TextInput, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { useCartNotification } from '@/contexts/cart-notification-context';
import {
  getProfileDashboard,
  createOrder,
  processOrderPayment,
  ShippingAddress,
  Order,
  CartItem,
  replaceCart,
  getUserAddresses,
  addUserAddress,
  UserAddress,
  getProductById,
} from '@/utils/api';
import { getToken } from '@/utils/auth';

type CheckoutStep = 'cart' | 'shipping' | 'payment' | 'confirmation';

export default function CheckoutScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<CheckoutStep>('cart');
  const [order, setOrder] = useState<Order | null>(null);
  const [processing, setProcessing] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState<UserAddress[]>([]);
  const [selectedAddressIndex, setSelectedAddressIndex] = useState<number | null>(null);
  const [useNewAddressForm, setUseNewAddressForm] = useState(false);
  const [setAsDefaultAddress, setSetAsDefaultAddress] = useState(false);
  const [shippingAddressForOrder, setShippingAddressForOrder] = useState<ShippingAddress | null>(null);
  const {
    cartItems: sharedCartItems,
    changeNotificationQuantity,
    removeNotificationItem,
    hydrateCartFromBackend,
    syncCartToBackend,
  } = useCartNotification();

  // Shipping form state
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');

  // Simulated payment details (for demo purposes, in real app use Stripe)
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvc, setCardCvc] = useState('');

  // Load cart items from profile
  useEffect(() => {
    const loadCart = async () => {
      try {
        setLoading(true);
        const [dashboard, addresses] = await Promise.all([getProfileDashboard(), getUserAddresses()]);
        hydrateCartFromBackend(dashboard.cartItems || []);
        setSavedAddresses(addresses || []);

        const profileName = String(dashboard?.user?.name || '').trim();
        const profileEmail = String(dashboard?.user?.email || '').trim();
        const profilePhone = String(dashboard?.user?.phoneNumber || '').trim();

        if (profileName) {
          setFullName((prev) => (prev.trim() ? prev : profileName));
        }
        if (profileEmail) {
          setEmail((prev) => (prev.trim() ? prev : profileEmail));
        }
        if (profilePhone) {
          setPhoneNumber((prev) => (prev.trim() ? prev : profilePhone));
        }

        const defaultIndex = (addresses || []).findIndex((item) => Boolean(item.isDefault));
        if ((addresses || []).length > 0) {
          setSelectedAddressIndex(defaultIndex >= 0 ? defaultIndex : 0);
          setUseNewAddressForm(false);
          setSetAsDefaultAddress(false);
        } else {
          setSelectedAddressIndex(null);
          setUseNewAddressForm(true);
          setSetAsDefaultAddress(true);
        }

        if (dashboard.cartItems.length === 0) {
          setError('Your cart is empty');
        } else {
          setError(null);
        }
      } catch (err: any) {
        setError(err?.message || 'Failed to load cart');
      } finally {
        setLoading(false);
      }
    };

    loadCart();
  }, [hydrateCartFromBackend]);

  const cartItems: CartItem[] = sharedCartItems.map((entry) => ({
    product: entry.product,
    quantity: entry.quantity,
  }));

  const subtotal = cartItems.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const shippingCost = subtotal > 500 ? 0 : 50;
  const tax = Number((subtotal * 0.05).toFixed(2));
  const totalAmount = subtotal + shippingCost + tax;

  const persistCart = async (items: { productId: string; quantity: number }[]) => {
    try {
      await replaceCart(items);
      if (items.length === 0) {
        setError('Your cart is empty');
      } else {
        setError(null);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to update cart');
    }
  };

  const reconcileCartStock = async () => {
    if (sharedCartItems.length === 0) {
      return { isValid: false, message: 'Your cart is empty.' };
    }

    const checks = await Promise.all(
      sharedCartItems.map(async (entry) => {
        try {
          const latest = await getProductById(entry.product._id);
          return {
            productId: entry.product._id,
            title: latest.title || entry.product.title,
            requested: entry.quantity,
            available: Math.max(0, Number(latest.stock) || 0),
          };
        } catch {
          return {
            productId: entry.product._id,
            title: entry.product.title,
            requested: entry.quantity,
            available: 0,
          };
        }
      })
    );

    const nextItems: { productId: string; quantity: number }[] = [];
    const removed: string[] = [];
    const adjusted: string[] = [];

    for (const check of checks) {
      if (check.available <= 0) {
        removed.push(check.title);
        removeNotificationItem(check.productId);
        continue;
      }

      const nextQty = Math.min(check.requested, check.available);
      nextItems.push({ productId: check.productId, quantity: nextQty });

      if (nextQty !== check.requested) {
        adjusted.push(`${check.title} (${check.requested} -> ${nextQty})`);
        changeNotificationQuantity(check.productId, nextQty);
      }
    }

    if (removed.length === 0 && adjusted.length === 0) {
      return { isValid: true, message: '' };
    }

    await persistCart(nextItems);

    const parts: string[] = [];
    if (removed.length > 0) {
      parts.push(`Removed: ${removed.join(', ')}`);
    }
    if (adjusted.length > 0) {
      parts.push(`Updated qty: ${adjusted.join(', ')}`);
    }

    return {
      isValid: false,
      message: `Stock changed while you were checking out. ${parts.join(' | ')}`,
    };
  };

  const handleQuantityChange = (productId: string, newQuantity: number) => {
    if (newQuantity <= 0) {
      handleRemoveItem(productId);
      return;
    }

    const nextItems = sharedCartItems.map((entry) =>
      entry.product._id === productId
        ? { productId: entry.product._id, quantity: newQuantity }
        : { productId: entry.product._id, quantity: entry.quantity }
    );

    changeNotificationQuantity(productId, newQuantity);
    void persistCart(nextItems);
  };

  const handleRemoveItem = (productId: string) => {
    const nextItems = sharedCartItems
      .filter((entry) => entry.product._id !== productId)
      .map((entry) => ({ productId: entry.product._id, quantity: entry.quantity }));

    removeNotificationItem(productId);
    void persistCart(nextItems);
  };

  const handleContinueToShipping = async () => {
    if (cartItems.length === 0) {
      Alert.alert('Error', 'Your cart is empty');
      return;
    }

    try {
      const stockCheck = await reconcileCartStock();
      if (!stockCheck.isValid) {
        setError(stockCheck.message);
        setStep('cart');
        return;
      }

      await syncCartToBackend();
      setStep('shipping');
    } catch (err: any) {
      setError(err?.message || 'Failed to sync cart before checkout');
    }
  };

  const validateShippingForm = () => {
    if (!fullName.trim()) {
      setError('Full name is required');
      return false;
    }
    if (!phoneNumber.trim() || phoneNumber.length < 10) {
      setError('Valid phone number is required');
      return false;
    }
    if (!email.trim() || !email.includes('@')) {
      setError('Valid email is required');
      return false;
    }
    if (!street.trim()) {
      setError('Street address is required');
      return false;
    }
    if (!city.trim()) {
      setError('City is required');
      return false;
    }
    if (!postalCode.trim() || postalCode.length < 5) {
      setError('Valid postal code is required');
      return false;
    }
    setError(null);
    return true;
  };

  const normalizeAddressValue = (value?: string) => String(value || '').trim().toLowerCase();

  const getSelectedSavedAddress = () => {
    if (selectedAddressIndex === null) return null;
    return savedAddresses[selectedAddressIndex] || null;
  };

  const mapUserAddressToShippingAddress = (address: UserAddress): ShippingAddress => ({
    fullName: String(address.fullName || '').trim(),
    phoneNumber: String(address.phoneNumber || '').trim(),
    email: String(address.email || '').trim(),
    street: String(address.street || '').trim(),
    city: String(address.city || '').trim(),
    state: String(address.state || '').trim() || 'Not specified',
    postalCode: String(address.postalCode || '').trim(),
    country: String(address.country || '').trim() || 'India',
  });

  const buildShippingAddressFromForm = (): ShippingAddress => ({
    fullName: fullName.trim(),
    phoneNumber: phoneNumber.trim(),
    email: email.trim(),
    street: street.trim(),
    city: city.trim(),
    state: 'Not specified',
    postalCode: postalCode.trim(),
    country: 'India',
  });

  const findMatchingAddressIndex = (target: ShippingAddress, list: UserAddress[]) => list.findIndex((candidate) => (
    normalizeAddressValue(candidate.fullName) === normalizeAddressValue(target.fullName)
    && normalizeAddressValue(candidate.phoneNumber) === normalizeAddressValue(target.phoneNumber)
    && normalizeAddressValue(candidate.email) === normalizeAddressValue(target.email)
    && normalizeAddressValue(candidate.street) === normalizeAddressValue(target.street)
    && normalizeAddressValue(candidate.city) === normalizeAddressValue(target.city)
    && normalizeAddressValue(candidate.postalCode) === normalizeAddressValue(target.postalCode)
    && normalizeAddressValue(candidate.country) === normalizeAddressValue(target.country)
  ));

  const ensureAddressSelectedForCheckout = async (): Promise<ShippingAddress | null> => {
    if (!useNewAddressForm) {
      const selectedSavedAddress = getSelectedSavedAddress();
      if (!selectedSavedAddress) {
        setError('Please choose a saved address or add a new one');
        return null;
      }

      return mapUserAddressToShippingAddress(selectedSavedAddress);
    }

    if (!validateShippingForm()) {
      return null;
    }

    const shippingAddress = buildShippingAddressFromForm();
    const existingIndex = findMatchingAddressIndex(shippingAddress, savedAddresses);

    if (existingIndex >= 0) {
      setSelectedAddressIndex(existingIndex);
      setUseNewAddressForm(false);
      return mapUserAddressToShippingAddress(savedAddresses[existingIndex]);
    }

    try {
      const response = await addUserAddress({
        label: 'Home',
        fullName: shippingAddress.fullName,
        phoneNumber: shippingAddress.phoneNumber,
        email: shippingAddress.email,
        street: shippingAddress.street,
        city: shippingAddress.city,
        state: shippingAddress.state || '',
        postalCode: shippingAddress.postalCode,
        country: shippingAddress.country,
        isDefault: savedAddresses.length === 0 || setAsDefaultAddress,
      });

      const updatedAddresses = response.addresses || [];
      setSavedAddresses(updatedAddresses);

      const matchedIndex = findMatchingAddressIndex(shippingAddress, updatedAddresses);
      setSelectedAddressIndex(matchedIndex >= 0 ? matchedIndex : Math.max(0, updatedAddresses.length - 1));
      setUseNewAddressForm(false);

      return shippingAddress;
    } catch (err: any) {
      setError(err?.message || 'Failed to save address');
      return null;
    }
  };

  const handleContinueToPayment = async () => {
    const selected = await ensureAddressSelectedForCheckout();
    if (!selected) {
      return;
    }

    setShippingAddressForOrder(selected);
    setStep('payment');
  };

  const validatePaymentForm = () => {
    const digits = cardNumber.replace(/\D/g, '');
    const cvcDigits = cardCvc.replace(/\D/g, '');

    // Demo-mode validation: allow fake test numbers, only require minimum input.
    if (digits.length < 4) {
      setError('Enter at least 4 digits for card number');
      return false;
    }
    if (!cardExpiry.trim() || cardExpiry.trim().length < 3) {
      setError('Enter a valid expiry (for example 12/30)');
      return false;
    }
    if (cvcDigits.length < 3) {
      setError('Enter at least 3 digits for CVC');
      return false;
    }

    setError(null);
    return true;
  };

  const formatCardExpiry = (input: string) => {
    const digits = String(input || '').replace(/\D/g, '').slice(0, 4);
    if (digits.length <= 2) {
      return digits;
    }
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  };

  const handleProcessPayment = async () => {
    if (!validatePaymentForm()) {
      return;
    }

    try {
      setProcessing(true);
      setError(null);
      console.log('[CHECKOUT] Starting payment process...');

      // Check if user is logged in (token exists)
      const token = await getToken();
      if (!token) {
        setError('You must be logged in to checkout. Please log in again.');
        Alert.alert('Not logged in', 'You must be logged in to checkout. Please log in again.');
        setProcessing(false);
        // Optionally, redirect to login screen here
        return;
      }

      const stockCheck = await reconcileCartStock();
      if (!stockCheck.isValid) {
        console.log('[CHECKOUT] Stock check failed:', stockCheck.message);
        setError(stockCheck.message);
        setStep('cart');
        return;
      }
      console.log('[CHECKOUT] Stock check passed');

      await syncCartToBackend();
      console.log('[CHECKOUT] Cart synced to backend');

      const shippingAddress = shippingAddressForOrder || (await ensureAddressSelectedForCheckout());
      if (!shippingAddress) {
        console.log('[CHECKOUT] No shipping address selected');
        setProcessing(false);
        setStep('shipping');
        return;
      }
      console.log('[CHECKOUT] Shipping address confirmed');

      // Create order
      console.log('[CHECKOUT] Creating order...');
      const newOrder = await createOrder({ shippingAddress });
      console.log('[CHECKOUT] Order created:', newOrder._id);
      setOrder(newOrder);

      // Process payment (demo: use masked card number as token)
      const stripeToken = `tok_${cardNumber.slice(-4)}_demo`;
      console.log('[CHECKOUT] Processing payment with token:', stripeToken);
      await processOrderPayment(newOrder._id, stripeToken);
      console.log('[CHECKOUT] Payment successful');

      // Clear local cart badge state immediately after successful payment.
      hydrateCartFromBackend([]);

      // Keep backend cart in sync so refreshed screens do not resurrect stale badge counts.
      await replaceCart([]).catch(() => {
        // Non-blocking: order is already successful.
      });

      // Payment successful
      setStep('confirmation');
    } catch (err: any) {
      const errorMsg = err?.message || JSON.stringify(err) || 'Payment processing failed';
      console.error('[CHECKOUT] Payment error:', errorMsg);
      console.error('[CHECKOUT] Full error object:', err);
      setError(errorMsg);
    } finally {
      setProcessing(false);
    }
  };

  const handleBackPress = () => {
    if (step === 'shipping') {
      setStep('cart');
    } else if (step === 'payment') {
      setStep('shipping');
    }
  };

  const handleContinueShopping = () => {
    router.replace('/feed');
  };

  if (loading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator size="large" color="#fff" />
      </ThemedView>
    );
  }

  if (step === 'confirmation' && order) {
    return (
      <ThemedView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.header}>
            <Pressable onPress={() => router.back()}>
              <Ionicons name="close" size={28} color="#fff" />
            </Pressable>
            <ThemedText type="title" style={styles.headerTitle}>Order Confirmation</ThemedText>
            <View style={{ width: 28 }} />
          </View>

          <View style={styles.confirmationCard}>
            <View style={styles.successIcon}>
              <Ionicons name="checkmark-circle" size={64} color="#4caf50" />
            </View>
            <ThemedText style={styles.confirmationTitle}>Order Placed Successfully!</ThemedText>
            <ThemedText style={styles.confirmationText}>
              Thank you for your purchase. Your order has been confirmed.
            </ThemedText>

            <View style={styles.orderInfoBox}>
              <View style={styles.infoRow}>
                <ThemedText style={styles.infoLabel}>Order ID:</ThemedText>
                <ThemedText style={styles.infoValue}>{order._id}</ThemedText>
              </View>
              <View style={styles.infoRow}>
                <ThemedText style={styles.infoLabel}>Total Amount:</ThemedText>
                <ThemedText style={[styles.infoValue, styles.totalText]}>₹{order.totalAmount}</ThemedText>
              </View>
              <View style={styles.infoRow}>
                <ThemedText style={styles.infoLabel}>Status:</ThemedText>
                <ThemedText style={styles.infoValue}>Confirmed</ThemedText>
              </View>
              <View style={styles.infoRow}>
                <ThemedText style={styles.infoLabel}>Delivery to:</ThemedText>
                <ThemedText style={styles.infoValue}>{order.shippingAddress.city}</ThemedText>
              </View>
            </View>

            <ThemedText style={styles.orderStatementText}>
              A confirmation email has been sent to {order.shippingAddress.email}
            </ThemedText>

            <Pressable style={styles.primaryButton} onPress={handleContinueShopping}>
              <ThemedText style={styles.buttonText}>Continue Shopping</ThemedText>
            </Pressable>
          </View>
        </ScrollView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScatterView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Pressable onPress={() => (step === 'cart' ? router.back() : handleBackPress())}>
            <Ionicons name={step === 'cart' ? 'close' : 'chevron-back'} size={28} color="#fff" />
          </Pressable>
          <ThemedText type="title" style={styles.headerTitle}>
            {step === 'cart' ? 'Checkout' : step === 'shipping' ? 'Shipping Address' : 'Payment'}
          </ThemedText>
          <View style={{ width: 28 }} />
        </View>

        {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}

        {step === 'cart' && (
          <>
            <ThemedText style={styles.sectionTitle}>Order Summary</ThemedText>
            {cartItems.length === 0 ? (
              <View style={styles.emptyCartState}>
                <Ionicons name="cart-outline" size={44} color="#666" />
                <ThemedText style={styles.emptyCartTitle}>Cart is empty</ThemedText>
                <ThemedText style={styles.emptyCartSubtitle}>Add products from the feed to continue checkout.</ThemedText>
                <Pressable style={styles.secondaryButton} onPress={handleContinueShopping}>
                  <ThemedText style={styles.secondaryButtonText}>Browse Products</ThemedText>
                </Pressable>
              </View>
            ) : (
              <>
                {cartItems.map((item) => (
                  <View key={item.product._id} style={styles.cartItemRow}>
                    <Image
                      source={{ uri: item.product.images?.[0] || 'https://placehold.co/80x60' }}
                      style={styles.itemImage}
                      contentFit="cover"
                    />
                    <View style={styles.itemDetails}>
                      <ThemedText numberOfLines={2} style={styles.itemTitle}>{item.product.title}</ThemedText>
                      <ThemedText style={styles.subtleText}>₹{item.product.price}</ThemedText>
                    </View>
                    <View style={styles.quantityControl}>
                      <Pressable
                        style={styles.qtyButton}
                        onPress={() => handleQuantityChange(item.product._id, Math.max(1, item.quantity - 1))}>
                        <Ionicons name="remove" size={16} color="#fff" />
                      </Pressable>
                      <ThemedText style={styles.qtyText}>{item.quantity}</ThemedText>
                      <Pressable
                        style={styles.qtyButton}
                        onPress={() => handleQuantityChange(item.product._id, item.quantity + 1)}>
                        <Ionicons name="add" size={16} color="#fff" />
                      </Pressable>
                    </View>
                    <View style={styles.itemTotalCol}>
                      <ThemedText style={styles.itemPrice}>₹{(item.product.price * item.quantity).toFixed(2)}</ThemedText>
                      <Pressable onPress={() => handleRemoveItem(item.product._id)}>
                        <Ionicons name="trash-outline" size={14} color="#ff6b6b" />
                      </Pressable>
                    </View>
                  </View>
                ))}

                <View style={styles.costSummary}>
                  <View style={styles.costRow}>
                    <ThemedText>Subtotal</ThemedText>
                    <ThemedText>₹{subtotal.toFixed(2)}</ThemedText>
                  </View>
                  <View style={styles.costRow}>
                    <ThemedText>Shipping</ThemedText>
                    <ThemedText>{shippingCost === 0 ? 'Free' : `₹${shippingCost}`}</ThemedText>
                  </View>
                  <View style={styles.costRow}>
                    <ThemedText>Tax (5%)</ThemedText>
                    <ThemedText>₹{tax.toFixed(2)}</ThemedText>
                  </View>
                  <View style={[styles.costRow, styles.costRowTotal]}>
                    <ThemedText style={styles.totalLabel}>Total</ThemedText>
                    <ThemedText style={styles.totalLabel}>₹{totalAmount.toFixed(2)}</ThemedText>
                  </View>
                </View>

                <Pressable style={styles.primaryButton} onPress={handleContinueToShipping}>
                  <ThemedText style={styles.buttonText}>Continue Checkout</ThemedText>
                </Pressable>
              </>
            )}
          </>
        )}

        {step === 'shipping' && (
          <>
            <ThemedText style={styles.sectionTitle}>Shipping Address</ThemedText>

            {savedAddresses.length > 0 ? (
              <>
                <ThemedText style={styles.savedAddressTitle}>Choose saved address</ThemedText>
                {savedAddresses.map((address, index) => {
                  const isSelected = !useNewAddressForm && selectedAddressIndex === index;
                  return (
                    <Pressable
                      key={`saved-address-${index}`}
                      style={[styles.savedAddressCard, isSelected && styles.savedAddressCardSelected]}
                      onPress={() => {
                        setSelectedAddressIndex(index);
                        setUseNewAddressForm(false);
                        setError(null);
                      }}>
                      <View style={styles.savedAddressTopRow}>
                        <ThemedText style={styles.savedAddressLabel}>{address.label || 'Address'}</ThemedText>
                        {isSelected ? <Ionicons name="checkmark-circle" size={18} color="#9df0a2" /> : null}
                      </View>
                      <ThemedText style={styles.savedAddressName}>{address.fullName}</ThemedText>
                      <ThemedText style={styles.savedAddressLine}>{address.street}, {address.city}</ThemedText>
                      <ThemedText style={styles.savedAddressLine}>{address.postalCode} • {address.phoneNumber}</ThemedText>
                    </Pressable>
                  );
                })}

                <Pressable
                  style={[styles.secondaryButton, styles.addNewAddressButton]}
                  onPress={() => {
                    setUseNewAddressForm(true);
                    setSelectedAddressIndex(null);
                    setSetAsDefaultAddress(savedAddresses.length === 0);
                    setError(null);
                  }}>
                  <ThemedText style={styles.secondaryButtonText}>+ Add New Address</ThemedText>
                </Pressable>
              </>
            ) : null}

            {useNewAddressForm ? (
              <>
                <ThemedText style={styles.savedAddressTitle}>Add new address</ThemedText>

                <TextInput
                  style={styles.input}
                  placeholder="Full Name"
                  placeholderTextColor="#666"
                  value={fullName}
                  onChangeText={setFullName}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Phone Number"
                  placeholderTextColor="#666"
                  value={phoneNumber}
                  onChangeText={setPhoneNumber}
                  keyboardType="phone-pad"
                />
                <TextInput
                  style={styles.input}
                  placeholder="Email Address"
                  placeholderTextColor="#666"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                />
                <TextInput
                  style={styles.input}
                  placeholder="Street Address"
                  placeholderTextColor="#666"
                  value={street}
                  onChangeText={setStreet}
                />
                <TextInput
                  style={styles.input}
                  placeholder="City"
                  placeholderTextColor="#666"
                  value={city}
                  onChangeText={setCity}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Postal Code"
                  placeholderTextColor="#666"
                  value={postalCode}
                  onChangeText={setPostalCode}
                />

                <Pressable
                  style={styles.defaultToggleRow}
                  onPress={() => setSetAsDefaultAddress((prev) => !prev)}>
                  <View style={[styles.defaultToggleBox, setAsDefaultAddress && styles.defaultToggleBoxActive]}>
                    {setAsDefaultAddress ? <Ionicons name="checkmark" size={14} color="#0a0a0a" /> : null}
                  </View>
                  <ThemedText style={styles.defaultToggleText}>Set as default address</ThemedText>
                </Pressable>
              </>
            ) : null}

            <Pressable style={styles.primaryButton} onPress={() => void handleContinueToPayment()}>
              <ThemedText style={styles.buttonText}>Continue to Payment</ThemedText>
            </Pressable>
          </>
        )}

        {step === 'payment' && (
          <>
            <ThemedText style={styles.sectionTitle}>Payment Details</ThemedText>

            <View style={styles.orderSummaryBox}>
              <ThemedText style={styles.summaryTitle}>Order Total</ThemedText>
              <ThemedText style={styles.summaryPrice}>₹{totalAmount.toFixed(2)}</ThemedText>
            </View>

            <ThemedText style={[styles.sectionTitle, { marginTop: 16 }]}>Card Information</ThemedText>
            <TextInput
              style={styles.input}
              placeholder="Card Number (16 digits)"
              placeholderTextColor="#666"
              value={cardNumber}
              onChangeText={setCardNumber}
              keyboardType="number-pad"
              maxLength={16}
            />
            <View style={styles.rowInputs}>
              <TextInput
                style={[styles.input, styles.halfInput]}
                placeholder="MM/YY"
                placeholderTextColor="#666"
                value={cardExpiry}
                onChangeText={(value) => setCardExpiry(formatCardExpiry(value))}
                keyboardType="number-pad"
                maxLength={5}
              />
              <TextInput
                style={[styles.input, styles.halfInput]}
                placeholder="CVC"
                placeholderTextColor="#666"
                value={cardCvc}
                onChangeText={setCardCvc}
                keyboardType="number-pad"
                maxLength={4}
              />
            </View>

            <ThemedText style={styles.secureText}>
              <Ionicons name="lock-closed" size={12} color="#4caf50" /> Secure payment powered by Stripe
            </ThemedText>

            <Pressable
              style={[styles.primaryButton, processing && styles.disabledButton]}
              onPress={handleProcessPayment}
              disabled={processing}>
              <ThemedText style={styles.buttonText}>
                {processing ? 'Processing...' : `Pay ₹${totalAmount.toFixed(2)}`}
              </ThemedText>
            </Pressable>
          </>
        )}
      </ScatterView>
    </ThemedView>
  );
}

// Typo fix from ScrollView
const ScatterView = ScrollView;

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
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingTop: 56,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
  },
  errorText: {
    backgroundColor: '#3f0a0a',
    color: '#ff6b6b',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    fontSize: 13,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginTop: 20,
    marginBottom: 12,
  },
  savedAddressTitle: {
    color: '#9eb0c8',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 8,
  },
  savedAddressCard: {
    backgroundColor: '#111a27',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2c3a4f',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  savedAddressCardSelected: {
    borderColor: '#6ec77a',
    backgroundColor: '#162334',
  },
  savedAddressTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  savedAddressLabel: {
    color: '#d8e5f8',
    fontSize: 12,
    fontWeight: '700',
  },
  savedAddressName: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  savedAddressLine: {
    color: '#9eb0c8',
    fontSize: 12,
  },
  cartItemRow: {
    flexDirection: 'row',
    marginBottom: 12,
    backgroundColor: '#111',
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    gap: 12,
  },
  itemImage: {
    width: 70,
    height: 70,
    borderRadius: 6,
    backgroundColor: '#1a1a1a',
  },
  itemDetails: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 13,
    fontWeight: '500',
    color: '#fff',
    marginBottom: 4,
  },
  subtleText: {
    fontSize: 12,
    color: '#888',
  },
  itemPrice: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4caf50',
  },
  quantityControl: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
    gap: 4,
  },
  qtyButton: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qtyText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    minWidth: 20,
    textAlign: 'center',
  },
  itemTotalCol: {
    alignItems: 'flex-end',
    gap: 6,
  },
  costSummary: {
    backgroundColor: '#111',
    borderRadius: 10,
    marginTop: 16,
    padding: 14,
    gap: 10,
  },
  costRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  costRowTotal: {
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
    paddingTop: 10,
    marginTop: 4,
  },
  emptyCartState: {
    marginTop: 8,
    marginBottom: 10,
    backgroundColor: '#111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#232323',
    paddingVertical: 26,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  emptyCartTitle: {
    marginTop: 10,
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  emptyCartSubtitle: {
    marginTop: 6,
    fontSize: 13,
    color: '#888',
    textAlign: 'center',
  },
  secondaryButton: {
    marginTop: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3a3a3a',
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#1a1a1a',
  },
  addNewAddressButton: {
    marginTop: 0,
    marginBottom: 14,
  },
  defaultToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 2,
    marginBottom: 6,
  },
  defaultToggleBox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#2d3d4f',
    backgroundColor: '#10151f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  defaultToggleBoxActive: {
    backgroundColor: '#9df0a2',
    borderColor: '#9df0a2',
  },
  defaultToggleText: {
    color: '#d7e4f7',
    fontSize: 13,
    fontWeight: '600',
  },
  secondaryButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  totalLabel: {
    fontWeight: '600',
    color: '#fff',
  },
  input: {
    backgroundColor: '#141922',
    borderColor: '#2d3d4f',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: '#fff',
    marginBottom: 10,
    fontSize: 14,
  },
  rowInputs: {
    flexDirection: 'row',
    gap: 10,
  },
  halfInput: {
    flex: 1,
  },
  secureText: {
    color: '#888',
    fontSize: 11,
    marginTop: 8,
    marginBottom: 16,
  },
  primaryButton: {
    backgroundColor: '#4caf50',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
  },
  disabledButton: {
    backgroundColor: '#666',
    opacity: 0.6,
  },
  buttonText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 14,
  },
  confirmationCard: {
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 20,
    marginTop: 20,
    marginBottom: 20,
    alignItems: 'center',
  },
  successIcon: {
    marginBottom: 16,
  },
  confirmationTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#4caf50',
    marginBottom: 8,
  },
  confirmationText: {
    fontSize: 13,
    color: '#888',
    textAlign: 'center',
    marginBottom: 16,
  },
  orderInfoBox: {
    width: '100%',
    backgroundColor: '#0a0a0a',
    borderRadius: 10,
    padding: 14,
    marginVertical: 14,
    gap: 10,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  infoLabel: {
    fontSize: 12,
    color: '#888',
  },
  infoValue: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '500',
  },
  totalText: {
    color: '#4caf50',
  },
  orderStatementText: {
    fontSize: 12,
    color: '#888',
    textAlign: 'center',
    marginBottom: 16,
  },
  orderSummaryBox: {
    backgroundColor: '#141922',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  summaryTitle: {
    fontSize: 12,
    color: '#888',
    marginBottom: 6,
  },
  summaryPrice: {
    fontSize: 24,
    fontWeight: '700',
    color: '#4caf50',
  },
});
