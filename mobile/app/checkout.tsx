import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { StyleSheet, View, ScrollView, ActivityIndicator, Pressable, TextInput, Alert, NativeModules } from 'react-native';
import { useRouter } from 'expo-router';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import Constants from 'expo-constants';
import RazorpayCheckout from 'react-native-razorpay';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { useCartNotification } from '@/contexts/cart-notification-context';
import {
  getProfileDashboard,
  createOrder,
  createRazorpayPaymentOrder,
  processOrderPayment,
  ShippingAddress,
  Order,
  CartItem,
  replaceCart,
  getUserAddresses,
  addUserAddress,
  UserAddress,
  getProductById,
  estimateOrderShipping,
  discardDraftOrder,
  OrderShippingEstimateResponse,
} from '@/utils/api';
import { getToken } from '@/utils/auth';

function resolveNimbusQuoteErrorMessage({ estimate, shippingEstimateError } : { estimate?: any; shippingEstimateError?: string | null }) {
  return shippingEstimateError || 'Live shipping quote could not be fetched from Nimbus. Please try again.';
}

type CheckoutStep = 'cart' | 'address' | 'shipping' | 'payment-method' | 'payment' | 'confirmation';

function getEffectiveProductPrice(product: any) {
  const realPrice = Math.max(0, Number(product?.realPrice ?? product?.price) || 0);
  const discountedPrice = Number(product?.discountedPrice);
  const hasDiscount = Number.isFinite(discountedPrice) && discountedPrice >= 0 && discountedPrice < realPrice;
  return hasDiscount ? discountedPrice : realPrice;
}

function resolveCartImageSource(product: any) {
  const mediaImage = Array.isArray(product?.media)
    ? product.media.find((entry: any) => entry?.type !== 'video' && (entry?.thumbnailDataUri || entry?.thumbnailUrl || entry?.url))
    : null;
  const candidate = mediaImage?.thumbnailDataUri || mediaImage?.thumbnailUrl || mediaImage?.url || product.images?.[0] || '';
  return candidate || 'https://placehold.co/80x60';
}

function getRazorpayRuntime() {
  const appOwnership = String((Constants as any)?.appOwnership || '').toLowerCase();
  const isAvailable = appOwnership !== 'expo';
  return {
    isAvailable,
    reason: appOwnership === 'expo' ? 'Razorpay unavailable in Expo Go' : null,
  };
}

function formatDeliveryDate(etd?: string | null) {
  if (!etd) return '—';
  // expect DD-MM-YYYY or ISO
  const parts = String(etd).split('-');
  if (parts.length === 3 && parts[2].length === 4) {
    const [d, m, y] = parts.map(Number);
    try {
      const dt = new Date(y, (m || 1) - 1, d || 1);
      return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return String(etd);
    }
  }
  try {
    const dt = new Date(String(etd));
    return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return String(etd);
  }
}

function calculateDaysToDelivery(etd?: string | null) {
  if (!etd) return Infinity;
  const parts = String(etd).split('-');
  let dt: Date;
  if (parts.length === 3 && parts[2].length === 4) {
    const [d, m, y] = parts.map(Number);
    dt = new Date(y, (m || 1) - 1, d || 1);
  } else {
    dt = new Date(String(etd));
  }
  const diff = Math.ceil((dt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return Number.isFinite(diff) ? Math.max(0, diff) : Infinity;
}

function getServiceType(daysToDelivery: number) {
  return daysToDelivery <= 2 ? 'Express' : 'Normal';
}

export default function CheckoutScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<CheckoutStep>('cart');
  const [order, setOrder] = useState<Order | null>(null);
  const [processing, setProcessing] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<'cod' | 'razorpay'>('razorpay');
  const [savedAddresses, setSavedAddresses] = useState<UserAddress[]>([]);
  const [selectedAddressIndex, setSelectedAddressIndex] = useState<number | null>(null);
  const [useNewAddressForm, setUseNewAddressForm] = useState(false);
  const [setAsDefaultAddress, setSetAsDefaultAddress] = useState(false);
  const [shippingAddressForOrder, setShippingAddressForOrder] = useState<ShippingAddress | null>(null);
  const [shippingEstimate, setShippingEstimate] = useState<OrderShippingEstimateResponse | null>(null);
  const [estimatingShipping, setEstimatingShipping] = useState(false);
  const [shippingEstimateError, setShippingEstimateError] = useState<string | null>(null);
  const latestShippingEstimateErrorRef = useRef<string | null>(null);
  const [selectedQuotesMap, setSelectedQuotesMap] = useState<Record<string, string>>({});
  const [selectedServiceType, setSelectedServiceType] = useState<'Express' | 'Normal'>('Normal');
  const [addressSelectedInCart, setAddressSelectedInCart] = useState(false);
  const [cartStepFormVisible, setCartStepFormVisible] = useState(false);
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

  // Load cart items from profile
  useFocusEffect(
    useCallback(() => {
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
          // auto-select default address in cart view
          setAddressSelectedInCart(true);
        } else {
          setSelectedAddressIndex(null);
          setUseNewAddressForm(false);
          setSetAsDefaultAddress(false);
          setCartStepFormVisible(false);
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

    void loadCart();
    }, [hydrateCartFromBackend])
  );

  // When a default/selected address is present on load, fetch shipping estimate
  useEffect(() => {
    const autoFetch = async () => {
      if (selectedAddressIndex === null) return;
      const addr = savedAddresses[selectedAddressIndex];
      if (!addr) return;
      const shippingAddr = mapUserAddressToShippingAddress(addr);
      setShippingAddressForOrder(shippingAddr);
      // Fetch estimate and auto-select cheapest courier per shipment
      const estimate = await fetchShippingEstimateForAddress(shippingAddr);
      if (estimate && estimate.shippingQuote && Array.isArray(estimate.shippingQuote.details)) {
        // pick cheapest option per detail
        const defaults: Record<string, string> = {};
        estimate.shippingQuote.details.forEach((detail: any) => {
          const key = String(detail.shipmentRef || detail.sellerId || '');
          const options = Array.isArray(detail.options) ? detail.options : [];
          if (options.length === 0) return;
          const cheapest = options.reduce((min: any, cur: any) => (Number(cur.totalCharges || Infinity) < Number(min.totalCharges || Infinity) ? cur : min), options[0]);
          if (cheapest && cheapest.courierId) defaults[key] = String(cheapest.courierId);
        });
        if (Object.keys(defaults).length > 0) setSelectedQuotesMap(defaults);
      }
    };

    void autoFetch();
  }, [selectedAddressIndex, savedAddresses]);

  const cartItems: CartItem[] = sharedCartItems.map((entry) => ({
    product: entry.product,
    quantity: entry.quantity,
  }));
  const razorpayRuntime = useMemo(() => getRazorpayRuntime(), []);
  const isAddressStep = step === 'address';
  const isShippingStep = step === 'shipping';
  const isPaymentMethodStep = step === 'payment-method';
  const isPaymentStep = step === 'payment';

  // Check if COD is available from the selected courier options
  const getCodAvailable = () => {
    if (!hasLiveNimbusQuote) return false;
    // COD is available only when every selected courier was confirmed by a Nimbus COD quote.
    return (quoteDetails || []).every((detail) => {
      const key = String(detail.shipmentRef || detail.sellerId || '');
      const selectedCourierId = String(selectedQuotesMap[key] || detail.selectedCourierId || detail.options?.[0]?.courierId || '');
      const selectedOption = (detail.options || []).find((opt: any) => String(opt.courierId || '') === selectedCourierId);
      if (!selectedOption) {
        return false;
      }

      if (typeof (detail as any).selectedCodAvailable === 'boolean') {
        return Boolean((detail as any).selectedCodAvailable);
      }

      return Boolean((selectedOption as any).codAvailable);
    });
  };
  const isCodAvailable = getCodAvailable();

  const subtotal = cartItems.reduce((sum, item) => sum + getEffectiveProductPrice(item.product) * item.quantity, 0);
  const quoteDetails = shippingEstimate?.shippingQuote?.details || [];
  const hasLiveNimbusQuote = shippingEstimate?.shippingQuote?.source === 'nimbus_serviceability' && quoteDetails.length > 0;

  // Build selected shipping quotes payload (uses component state)
  function buildSelectedShippingQuotesPayload() {
    const details = shippingEstimate?.shippingQuote?.details || [];
    return details
      .map((detail) => {
        const key = String(detail.shipmentRef || detail.sellerId || '');
        const selectedCourierId = String(selectedQuotesMap[key] || detail.selectedCourierId || detail.options?.[0]?.courierId || '');
        return {
          sellerId: String(detail.sellerId || ''),
          shipmentRef: String(detail.shipmentRef || ''),
          courierId: selectedCourierId,
        };
      })
      .filter((entry) => entry.courierId);
  }

  const selectedShippingCost = hasLiveNimbusQuote
    ? quoteDetails.reduce((sum, detail) => {
        const key = String(detail.shipmentRef || detail.sellerId || '');
        const selectedCourierId = selectedQuotesMap[key] || detail.selectedCourierId;
        const options = Array.isArray(detail.options) ? detail.options : [];
        const matched = options.find((option) => String(option.courierId || '') === String(selectedCourierId || ''));
        return sum + Number(matched?.totalCharges || 0);
      }, 0)
    : 0;

  const displaySubtotal = Number(shippingEstimate?.subtotal ?? subtotal);
  const platformFee = 8; // includes ₹1 CSR contribution
  const csrContributionPerPaidOrder = 1; // included in platformFee, shown for info only
  const shippingCost = Number(hasLiveNimbusQuote ? selectedShippingCost : 0);
  const totalAmount = Number(displaySubtotal + shippingCost + platformFee); // CSR already inside platformFee
  const shippingDisplayText = hasLiveNimbusQuote
    ? (shippingCost === 0 ? 'Free' : `₹${shippingCost.toFixed(2)}`)
    : (addressSelectedInCart ? 'Calculating...' : 'Select address');

  const shippingSourceText = hasLiveNimbusQuote
    ? 'Live Nimbus quote based on destination pincode and package weight/dimensions.'
    : (shippingEstimateError
      ? `Live shipping quote unavailable: ${shippingEstimateError}`
        : (addressSelectedInCart ? 'Fetching shipping options...' : 'Select address below to view shipping options'));

  const selectedQuotesPayload = buildSelectedShippingQuotesPayload();
  const shippingSelectedForAll = hasLiveNimbusQuote ? selectedQuotesPayload.length === (quoteDetails?.length || 0) : false;

// Typo fix from ScrollView
const ScatterView = ScrollView;

  const formatCompactAddress = (address: UserAddress | null) => {
    if (!address) return '';
    return [address.fullName, address.street, address.city, address.postalCode]
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .join(', ');
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (step === 'cart') {
        return;
      }

      event.preventDefault();
      setStep('cart');
    });

    return unsubscribe;
  }, [navigation, step]);

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

  const restoreCartAfterFailedCheckout = async (draftOrderId?: string | null, fallbackMessage?: string) => {
    if (draftOrderId) {
      await discardDraftOrder(draftOrderId).catch(() => {
        // Ignore cleanup errors; the order will be hidden from sellers and can be removed later.
      });
    }

    try {
      const dashboard = await getProfileDashboard();
      hydrateCartFromBackend(dashboard.cartItems || []);
    } catch {
      hydrateCartFromBackend(sharedCartItems);
    }

    setShippingEstimate(null);
    setSelectedQuotesMap({});
    setShippingEstimateError(null);
    setShippingAddressForOrder(null);
    setOrder(null);
    setStep('cart');

    if (fallbackMessage) {
      setError(fallbackMessage);
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
    setShippingEstimate(null);
    setSelectedQuotesMap({});
    setShippingEstimateError(null);
    void persistCart(nextItems);
  };

  const handleRemoveItem = (productId: string) => {
    const nextItems = sharedCartItems
      .filter((entry) => entry.product._id !== productId)
      .map((entry) => ({ productId: entry.product._id, quantity: entry.quantity }));

    removeNotificationItem(productId);
    setShippingEstimate(null);
    setSelectedQuotesMap({});
    setShippingEstimateError(null);
    void persistCart(nextItems);
  };

  const handleContinueToShippingStep = async () => {
    if (cartItems.length === 0) {
      Alert.alert('Error', 'Your cart is empty');
      return;
    }

    try {
      const stockCheck = await reconcileCartStock();
      if (!stockCheck.isValid) {
        setError(stockCheck.message);
        return;
      }

      await syncCartToBackend();
      setError(null);
      setStep('shipping');
    } catch (err: any) {
      setError(err?.message || 'Failed to sync cart before checkout');
    }
  };

  const handleContinueFromCart = async () => {
    if (!addressSelectedInCart) {
      setError('Please select a delivery address');
      return;
    }

    if (!hasLiveNimbusQuote) {
      setError('Shipping options not available. Please try again.');
      return;
    }

    try {
      const stockCheck = await reconcileCartStock();
      if (!stockCheck.isValid) {
        setError(stockCheck.message);
        return;
      }

      await syncCartToBackend();
      setError(null);
      setStep('payment-method');
    } catch (err: any) {
      setError(err?.message || 'Failed to proceed to payment');
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

  const fetchShippingEstimateForAddress = async (shippingAddress: ShippingAddress) => {
    try {
      setEstimatingShipping(true);
      setShippingEstimateError(null);
      latestShippingEstimateErrorRef.current = null;

      const estimate = await estimateOrderShipping({ shippingAddress });
      setShippingEstimate(estimate);
      latestShippingEstimateErrorRef.current = null;
      setError(null);

      const defaults: Record<string, string> = {};
      const details = estimate?.shippingQuote?.details || [];
      details.forEach((detail: any) => {
        const key = String(detail.shipmentRef || detail.sellerId || '');
        const options = Array.isArray(detail.options) ? detail.options : [];
        if (options.length === 0) return;
        const cheapest = options.reduce((min: any, cur: any) => (Number(cur.totalCharges || Infinity) < Number(min.totalCharges || Infinity) ? cur : min), options[0]);
        if (cheapest && (cheapest.courierId || cheapest.courier_id)) {
          defaults[key] = String(cheapest.courierId || cheapest.courier_id);
        }
      });
      setSelectedQuotesMap(defaults);

      return estimate;
    } catch (err: any) {
      setShippingEstimate(null);
      setSelectedQuotesMap({});
      const resolvedMessage = resolveNimbusQuoteErrorMessage({
        estimate: null,
        shippingEstimateError: err?.message || 'Failed to fetch shipping estimate',
      });
      latestShippingEstimateErrorRef.current = resolvedMessage;
      setShippingEstimateError(resolvedMessage);
      setError(resolvedMessage);
      return null;
    } finally {
      setEstimatingShipping(false);
    }
  };

  const getQuotesByServiceType = (serviceType: 'Express' | 'Normal') => {
    if (!quoteDetails || quoteDetails.length === 0) return {};

    const result: Record<string, typeof quoteDetails[0]['options']> = {};
    quoteDetails.forEach((detail) => {
      const key = String(detail.shipmentRef || detail.sellerId || '');
      const filteredOptions = (detail.options || []).filter((option) => {
        const daysToDelivery = calculateDaysToDelivery(option.etd);
        const optionServiceType = getServiceType(daysToDelivery);
        return optionServiceType === serviceType;
      });
      if (filteredOptions.length > 0) {
        result[key] = filteredOptions;
      }
    });
    return result;
  };

  const handleContinueToReview = async () => {
    const selected = await ensureAddressSelectedForCheckout();
    if (!selected) {
      return;
    }

    setShippingAddressForOrder(selected);
    const estimate = await fetchShippingEstimateForAddress(selected);
    const hasLiveQuote = estimate?.shippingQuote?.source === 'nimbus_serviceability'
      && Array.isArray(estimate?.shippingQuote?.details)
      && estimate.shippingQuote.details.length > 0;

    if (!estimate || !hasLiveQuote) {
      setError(resolveNimbusQuoteErrorMessage({
        estimate,
        shippingEstimateError: latestShippingEstimateErrorRef.current || shippingEstimateError,
      }));
      return;
    }
    setError(null);
    setStep('payment');
  };

  const handleConfirmAddressAndReturn = async () => {
    const selected = await ensureAddressSelectedForCheckout();
    if (!selected) {
      return;
    }

    setShippingAddressForOrder(selected);
    setAddressSelectedInCart(true);

    const estimate = await fetchShippingEstimateForAddress(selected);
    const hasLiveQuote = estimate?.shippingQuote?.source === 'nimbus_serviceability'
      && Array.isArray(estimate?.shippingQuote?.details)
      && estimate.shippingQuote.details.length > 0;

    if (!estimate || !hasLiveQuote) {
      setError(resolveNimbusQuoteErrorMessage({
        estimate,
        shippingEstimateError: latestShippingEstimateErrorRef.current || shippingEstimateError,
      }));
    } else {
      setError(null);
    }

    setStep('cart');
  };

  const handleProcessPayment = async () => {
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

      if (!hasLiveNimbusQuote) {
        setError('Live Nimbus shipping quote is required before payment.');
        setStep('shipping');
        return;
      }

      if (selectedPaymentMethod === 'cod' && !isCodAvailable) {
        setError('Cash on Delivery is not available for the selected courier or destination.');
        setStep('payment-method');
        return;
      }

      if (selectedPaymentMethod === 'cod') {
        // COD completes directly on the server; no Razorpay runtime is required.
        console.log('[CHECKOUT] Creating COD order...');
        const selectedShippingQuotes = buildSelectedShippingQuotesPayload();
        if (selectedShippingQuotes.length === 0) {
          setError('Please select a shipping option before placing order.');
          return;
        }

        const newOrder = await createOrder({
          shippingAddress,
          selectedShippingQuotes,
        });
        console.log('[CHECKOUT] COD order created:', newOrder._id);

        const paymentResult = await processOrderPayment(newOrder._id, {
          paymentProvider: 'cash_on_delivery',
        });

        setOrder(paymentResult.order);

        hydrateCartFromBackend([]);
        await replaceCart([]).catch(() => {
          // Non-blocking: order is already successful.
        });

        setStep('confirmation');
        return;
      }

      const isRazorpayAvailable = razorpayRuntime.isAvailable;
      if (!isRazorpayAvailable) {
        const sdkMissingMessage = razorpayRuntime.reason
          ? `${razorpayRuntime.reason} Use npm run android (or npm run ios) and open the newly installed app.`
          : 'Razorpay checkout is unavailable in this app build. Use an Expo development build (not Expo Go), then rebuild with npm run android (or npm run ios).';
        setError(sdkMissingMessage);
        Alert.alert('Razorpay unavailable', sdkMissingMessage);
        return;
      }

      // Create order
      console.log('[CHECKOUT] Creating order...');
      const selectedShippingQuotes = buildSelectedShippingQuotesPayload();
      if (selectedShippingQuotes.length === 0) {
        setError('Please select a shipping option before placing order.');
        return;
      }

      const newOrder = await createOrder({
        shippingAddress,
        selectedShippingQuotes,
      });
      console.log('[CHECKOUT] Order created:', newOrder._id);
      setOrder(newOrder);

      const draftOrderId = String(newOrder._id || '');
      let paymentOrder;
      try {
        paymentOrder = await createRazorpayPaymentOrder(newOrder._id);
      } catch (paymentOrderError: any) {
        await restoreCartAfterFailedCheckout(draftOrderId, paymentOrderError?.message || 'Failed to initialize payment.');
        return;
      }

      console.log('[CHECKOUT] Razorpay order created:', paymentOrder.gatewayOrderId);

      let razorpayResult: any;
      try {
        razorpayResult = await RazorpayCheckout.open({
          key: paymentOrder.keyId,
          amount: paymentOrder.amount,
          currency: paymentOrder.currency,
          order_id: paymentOrder.gatewayOrderId,
          name: paymentOrder.name,
          description: paymentOrder.description,
          prefill: paymentOrder.prefill,
          theme: { color: '#4caf50' },
        });
      } catch (checkoutError: any) {
        const checkoutMessage = checkoutError?.description || checkoutError?.message || 'Payment cancelled';
        const normalizedMessage = String(checkoutMessage).toLowerCase();
        if (normalizedMessage.includes('cancel') || normalizedMessage.includes('dismiss')) {
          await restoreCartAfterFailedCheckout(draftOrderId, 'Payment was cancelled. Your cart is unchanged.');
          return;
        }

        throw new Error(checkoutMessage);
      }

      const paymentResult = await processOrderPayment(newOrder._id, {
        paymentProvider: 'razorpay',
        razorpayOrderId: String(razorpayResult?.razorpay_order_id || ''),
        razorpayPaymentId: String(razorpayResult?.razorpay_payment_id || ''),
        razorpaySignature: String(razorpayResult?.razorpay_signature || ''),
      });
      console.log('[CHECKOUT] Payment successful');

      setOrder(paymentResult.order);

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
      console.warn('[CHECKOUT] Payment warning:', errorMsg);
      setError(errorMsg);
    } finally {
      setProcessing(false);
    }
  };

  const handleBackPress = () => {
    if (step === 'cart') {
      router.back();
    } else if (step === 'shipping') {
      setStep('cart');
    } else if (step === 'address') {
      setStep('cart');
    } else if (step === 'payment-method') {
      setStep('cart');
    } else if (step === 'payment') {
      // Since shipping is handled in cart step, avoid going to shipping when backing from payment
      setStep('cart');
    }
  };

  const handleContinueShopping = () => {
    router.replace('/(tabs)');
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

            <Pressable style={[styles.primaryButton, styles.confirmationContinueButton]} onPress={handleContinueShopping}>
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
          <Pressable onPress={handleBackPress}>
            <Ionicons name={step === 'cart' ? 'close' : 'chevron-back'} size={28} color="#fff" />
          </Pressable>
          <ThemedText type="title" style={styles.headerTitle}>
            {step === 'cart' ? 'Checkout' : step === 'shipping' ? 'Select Courier Partner' : step === 'address' ? 'Shipping Address' : step === 'payment-method' ? 'Payment Method' : 'Payment'}
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
                      source={{ uri: resolveCartImageSource(item.product) }}
                      style={styles.itemImage}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                    />
                    <View style={styles.itemDetails}>
                      <ThemedText numberOfLines={2} style={styles.itemTitle}>{item.product.title}</ThemedText>
                      <View style={styles.priceMetaRow}>
                        <ThemedText style={styles.subtleText}>₹{getEffectiveProductPrice(item.product).toFixed(2)}</ThemedText>
                        {getEffectiveProductPrice(item.product) < Math.max(0, Number(item.product.realPrice ?? item.product.price) || 0) ? (
                          <ThemedText style={styles.originalPriceStrike}>₹{Math.max(0, Number(item.product.realPrice ?? item.product.price) || 0).toFixed(2)}</ThemedText>
                        ) : null}
                      </View>
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
                      <ThemedText style={styles.itemPrice}>₹{(getEffectiveProductPrice(item.product) * item.quantity).toFixed(2)}</ThemedText>
                      <Pressable onPress={() => handleRemoveItem(item.product._id)}>
                        <Ionicons name="trash-outline" size={14} color="#ff6b6b" />
                      </Pressable>
                    </View>
                  </View>
                ))}

                {/* Address selector and service type (cart step) */}
                <View style={styles.addressSelectorSection}>
                  {!addressSelectedInCart ? (
                    <>
                      <ThemedText style={styles.sectionTitle}>Select Delivery Address</ThemedText>
                      {savedAddresses.length > 0 && (
                        <>
                          <ThemedText style={styles.savedAddressTitle}>Saved addresses</ThemedText>
                          {savedAddresses.map((address, index) => (
                            <Pressable
                              key={`cart-saved-address-${index}`}
                              style={styles.savedAddressCard}
                              onPress={async () => {
                                setSelectedAddressIndex(index);
                                setAddressSelectedInCart(true);
                                const shippingAddr = mapUserAddressToShippingAddress(address);
                                setShippingAddressForOrder(shippingAddr);
                                await fetchShippingEstimateForAddress(shippingAddr);
                              }}>
                              <View style={styles.savedAddressTopRow}>
                                <ThemedText style={styles.savedAddressLabel}>{address.label || 'Address'}</ThemedText>
                              </View>
                              <ThemedText style={styles.savedAddressName}>{address.fullName}</ThemedText>
                              <ThemedText style={styles.savedAddressLine}>{address.street}, {address.city}</ThemedText>
                              <ThemedText style={styles.savedAddressLine}>{address.postalCode}</ThemedText>
                            </Pressable>
                          ))}
                          <Pressable
                            style={[styles.secondaryButton, styles.addNewAddressButton]}
                            onPress={() => router.push('/add-address')}>
                            <ThemedText style={styles.secondaryButtonText}>+ Add New Address</ThemedText>
                          </Pressable>
                        </>
                      )}

                      {savedAddresses.length === 0 && (
                        <View style={{ marginTop: 12, alignItems: 'center' }}>
                          <ThemedText style={{ color: '#8e9bb2', marginBottom: 12 }}>Add address to view shipping cost</ThemedText>
                          <Pressable
                            style={[styles.primaryButton, { width: '100%' }]}
                            onPress={() => router.push('/add-address')}>
                            <ThemedText style={styles.buttonText}>Add Address</ThemedText>
                          </Pressable>
                        </View>
                      )}
                    </>
                  ) : (
                    <View style={styles.selectedAddressCompact}>
                      <View style={styles.selectedAddressHeaderRow}>
                        <ThemedText style={styles.savedAddressLabel}>Deliver to</ThemedText>
                        <Pressable style={styles.changeButton} onPress={() => setStep('address')}>
                          <ThemedText style={styles.changeButtonText}>Change</ThemedText>
                        </Pressable>
                      </View>
                      <ThemedText style={styles.savedAddressLine} numberOfLines={2}>
                        {formatCompactAddress(getSelectedSavedAddress())}
                      </ThemedText>

                      {/* courier teaser removed from address area; moved below Add Payment Details */}
                    </View>
                  )}
                </View>

                <View style={styles.costSummary}>
                  <View style={styles.costRow}>
                    <ThemedText>Subtotal</ThemedText>
                    <ThemedText>₹{displaySubtotal.toFixed(2)}</ThemedText>
                  </View>
                  <View style={styles.costRow}>
                    <ThemedText>Shipping</ThemedText>
                    <ThemedText>{shippingDisplayText}</ThemedText>
                  </View>
                  <View style={styles.costRow}>
                    <ThemedText>Platform fee</ThemedText>
                    <ThemedText>₹{platformFee.toFixed(2)}</ThemedText>
                  </View>
                <View style={styles.csrInfoRow}>
                  <ThemedText style={styles.csrInfoText}>
                    Platform fee includes ₹{csrContributionPerPaidOrder} CSR contribution per successful order.
                  </ThemedText>
                </View>
                  <View style={[styles.costRow, styles.costRowTotal]}>
                    <ThemedText style={styles.totalLabel}>Total</ThemedText>
                    <ThemedText style={styles.totalLabel}>₹{totalAmount.toFixed(2)}</ThemedText>
                  </View>
                </View>

                <ThemedText style={styles.shippingInfoText}>{shippingSourceText}</ThemedText>

                <Pressable 
                  style={[styles.primaryButton, (!addressSelectedInCart || estimatingShipping || !shippingSelectedForAll) && styles.disabledButton]}
                  onPress={() => {
                    if (!addressSelectedInCart) {
                      setError('Please select a delivery address');
                      return;
                    }
                    if (!shippingSelectedForAll) {
                      setError('Please choose a shipping option for all shipments');
                      return;
                    }
                    void handleContinueFromCart();
                  }}
                  disabled={!addressSelectedInCart || estimatingShipping || !shippingSelectedForAll}>
                  <ThemedText style={styles.buttonText}>
                    {estimatingShipping ? 'Loading...' : (!addressSelectedInCart ? 'Select Address' : (!shippingSelectedForAll ? 'Select Shipping Option' : 'Add Payment Details'))}
                  </ThemedText>
                </Pressable>

                {/* Selected courier summary placed below the Add Payment Details button */}
                {hasLiveNimbusQuote && (quoteDetails || []).length > 0 ? (
                  <View style={styles.courierSummaryBelowButton}>
                    {(quoteDetails || []).map((detail, detailIndex) => {
                      const key = String(detail.shipmentRef || detail.sellerId || `shipment-${detailIndex}`);
                      const selectedCourierId = String(selectedQuotesMap[key] || detail.selectedCourierId || detail.options?.[0]?.courierId || '');
                      const selectedOption = (detail.options || []).find((opt: any) => String(opt.courierId || '') === selectedCourierId) || detail.options?.[0] || null;
                      if (!selectedOption) return null;
                      return (
                        <View key={`courier-summary-${detailIndex}`} style={styles.courierSummaryCard}>
                          <View style={styles.courierSummaryInner}>
                            <View style={styles.courierSummaryLeft}>
                              <ThemedText style={styles.courierSummaryName}>{selectedOption.courierName}</ThemedText>
                              <ThemedText style={styles.courierSummaryMeta}>Delivery by {formatDeliveryDate(selectedOption.etd)} • Chargeable {selectedOption.chargeableWeight || detail.weight}g</ThemedText>
                            </View>
                            <View style={styles.courierSummaryRight}>
                              <ThemedText style={styles.courierSummaryPrice}>₹{Number(selectedOption.totalCharges || 0).toFixed(2)}</ThemedText>
                              <Pressable style={styles.changeSmallButton} onPress={() => setStep('shipping')}>
                                <ThemedText style={styles.changeSmallButtonText}>Change</ThemedText>
                              </Pressable>
                            </View>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                ) : null}
              </>
            )}
          </>
        )}

        {isAddressStep && (
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
                        setShippingEstimate(null);
                        setSelectedQuotesMap({});
                        setShippingEstimateError(null);
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
                    router.push('/add-address');
                  }}>
                  <ThemedText style={styles.secondaryButtonText}>+ Add New Address</ThemedText>
                </Pressable>
              </>
            ) : (
              <View style={{ marginTop: 12, alignItems: 'center' }}>
                <ThemedText style={{ color: '#8e9bb2', marginBottom: 12 }}>Add address to view shipping cost</ThemedText>
                <Pressable
                  style={[styles.primaryButton, { width: '100%' }]}
                  onPress={() => router.push('/add-address')}>
                  <ThemedText style={styles.buttonText}>Add Address</ThemedText>
                </Pressable>
              </View>
            )}

            <Pressable
              style={[styles.primaryButton, estimatingShipping && styles.disabledButton, savedAddresses.length === 0 && styles.disabledButton]}
              onPress={() => void handleConfirmAddressAndReturn()}
              disabled={estimatingShipping || savedAddresses.length === 0}>
              <ThemedText style={styles.buttonText}>{estimatingShipping ? 'Calculating Shipping...' : 'Okay'}</ThemedText>
            </Pressable>
          </>
          )}

        {isShippingStep && (
          <>
            <ThemedText style={styles.sectionTitle}>Select Courier Partner</ThemedText>
            {hasLiveNimbusQuote ? (
            <View style={styles.quoteListWrap}>
              {(quoteDetails || []).map((detail, detailIndex) => {
                const key = String(detail.shipmentRef || detail.sellerId || `shipment-${detailIndex}`);
                const selectedCourierId = String(selectedQuotesMap[key] || detail.selectedCourierId || detail.options?.[0]?.courierId || '');

                return (
                  <View key={`quote-detail-${detailIndex}`} style={styles.quoteShipmentCard}>
                    <ThemedText style={styles.quoteShipmentTitle}>
                      Shipment {detailIndex + 1}: {detail.origin} to {detail.destination} ({detail.weight}g)
                    </ThemedText>

                    {(detail.options || []).map((option: any, optionIndex: number) => {
                      const isSelected = String(option.courierId || '') === selectedCourierId;
                      return (
                        <Pressable
                          key={`quote-option-${detailIndex}-${optionIndex}`}
                          style={[styles.quoteOptionRow, isSelected && styles.quoteOptionRowSelected]}
                          onPress={() => setSelectedQuotesMap((prev) => ({ ...prev, [key]: String(option.courierId || '') }))}>
                          <View style={styles.quoteOptionTextWrap}>
                            <ThemedText style={styles.quoteOptionName}>{option.courierName || option.courierId}</ThemedText>
                            <ThemedText style={styles.quoteOptionMeta}>Delivery by {formatDeliveryDate(option.etd)} • Chargeable {option.chargeableWeight || detail.weight}g</ThemedText>
                            <View style={styles.quoteOptionBadges}>
                              <View style={[styles.quoteOptionBadge, option.codAvailable ? styles.quoteOptionBadgeSuccess : styles.quoteOptionBadgeMuted]}>
                                <ThemedText style={styles.quoteOptionBadgeText}>
                                  {option.codAvailable
                                    ? `COD ${option.codCharges !== null ? `₹${Number(option.codCharges || 0).toFixed(2)}` : 'available'}`
                                    : 'COD unavailable'}
                                </ThemedText>
                              </View>
                            </View>
                          </View>
                          <ThemedText style={styles.quoteOptionPrice}>₹{Number(option.totalCharges || 0).toFixed(2)}</ThemedText>
                        </Pressable>
                      );
                    })}
                  </View>
                );
              })}
            </View>
            ) : null}

            <Pressable
              style={[styles.primaryButton, !shippingSelectedForAll && styles.disabledButton]}
              onPress={() => {
                if (!shippingSelectedForAll) {
                  setError('Please choose a shipping option for all shipments');
                  return;
                }
                setError(null);
                setStep('cart');
              }}
              disabled={!shippingSelectedForAll}>
              <ThemedText style={styles.buttonText}>Okay</ThemedText>
            </Pressable>
          </>
        )}

        {isPaymentMethodStep && (
          <>
            <ThemedText style={styles.sectionTitle}>Select Payment Method</ThemedText>

            <View style={styles.paymentMethodContainer}>
              {/* COD Option */}
              <Pressable
                style={[styles.paymentMethodCard, selectedPaymentMethod === 'cod' && styles.paymentMethodCardSelected]}
                onPress={() => setSelectedPaymentMethod('cod')}
                disabled={!isCodAvailable}>
                <View style={styles.paymentMethodRadio}>
                  {selectedPaymentMethod === 'cod' && <View style={styles.paymentMethodRadioInner} />}
                </View>
                <View style={styles.paymentMethodContent}>
                  <ThemedText style={[styles.paymentMethodLabel, !isCodAvailable && styles.paymentMethodDisabled]}>
                    Cash on Delivery (COD)
                  </ThemedText>
                  {!isCodAvailable && (
                    <ThemedText style={styles.paymentMethodDisabledText}>Not available for selected couriers</ThemedText>
                  )}
                </View>
              </Pressable>

              {/* Razorpay Option */}
              <Pressable
                style={[styles.paymentMethodCard, selectedPaymentMethod === 'razorpay' && styles.paymentMethodCardSelected]}
                onPress={() => setSelectedPaymentMethod('razorpay')}>
                <View style={styles.paymentMethodRadio}>
                  {selectedPaymentMethod === 'razorpay' && <View style={styles.paymentMethodRadioInner} />}
                </View>
                <View style={styles.paymentMethodContent}>
                  <ThemedText style={styles.paymentMethodLabel}>Online Payment</ThemedText>
                  <ThemedText style={styles.paymentMethodSubtext}>Credit Card, Debit Card, UPI, Net Banking</ThemedText>
                </View>
              </Pressable>
            </View>

            <Pressable
              style={[styles.primaryButton, (!isCodAvailable && selectedPaymentMethod === 'cod') && styles.disabledButton]}
              onPress={() => {
                if (selectedPaymentMethod === 'cod') {
                  void handleProcessPayment();
                } else {
                  setStep('payment');
                }
              }}
              disabled={(!isCodAvailable && selectedPaymentMethod === 'cod')}>
              <ThemedText style={styles.buttonText}>Continue</ThemedText>
            </Pressable>
          </>
        )}

        {isPaymentStep && (
          <>
            <ThemedText style={styles.sectionTitle}>Payment Details</ThemedText>

            <View style={styles.orderSummaryBox}>
              <ThemedText style={styles.summaryTitle}>Order Total</ThemedText>
              <ThemedText style={styles.summaryPrice}>₹{totalAmount.toFixed(2)}</ThemedText>

              <View style={styles.paymentBreakdown}>
                <View style={styles.costRow}>
                  <ThemedText style={styles.summaryLineLabel}>Subtotal</ThemedText>
                  <ThemedText style={styles.summaryLineValue}>₹{displaySubtotal.toFixed(2)}</ThemedText>
                </View>
                <View style={styles.costRow}>
                  <ThemedText style={styles.summaryLineLabel}>Shipping</ThemedText>
                  <ThemedText style={styles.summaryLineValue}>{shippingDisplayText}</ThemedText>
                </View>
                <View style={styles.costRow}>
                  <ThemedText style={styles.summaryLineLabel}>Platform fee</ThemedText>
                  <ThemedText style={styles.summaryLineValue}>₹{platformFee.toFixed(2)}</ThemedText>
                </View>
                <View style={styles.csrInfoRow}>
                  <ThemedText style={styles.csrInfoText}>
                    Platform fee includes ₹{csrContributionPerPaidOrder} CSR contribution per successful order.
                  </ThemedText>
                </View>
              </View>

              <ThemedText style={styles.shippingInfoText}>{shippingSourceText}</ThemedText>


            </View>

            <ThemedText style={[styles.sectionTitle, { marginTop: 16 }]}>Razorpay Checkout</ThemedText>
            <ThemedText style={styles.paymentHintText}>
              Tap pay to open Razorpay secure checkout. Use Razorpay test mode cards/UPI/netbanking in the popup.
            </ThemedText>

            <ThemedText style={styles.secureText}>
              <Ionicons name="lock-closed" size={12} color="#4caf50" /> Secure payment powered by Razorpay
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
  priceMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  originalPriceStrike: {
    fontSize: 11,
    color: '#7f8792',
    textDecorationLine: 'line-through',
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
  shippingInfoText: {
    marginTop: 8,
    color: '#9eb0c8',
    fontSize: 11,
    lineHeight: 16,
  },
  csrInfoRow: {
    marginTop: 6,
    marginBottom: 2,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#2a3d53',
    backgroundColor: '#102132',
  },
  csrInfoText: {
    color: '#bee4ff',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
  },
  quoteListWrap: {
    marginTop: 12,
    width: '100%',
    gap: 10,
  },
  quoteShipmentCard: {
    borderWidth: 1,
    borderColor: '#2d3d4f',
    backgroundColor: '#101723',
    borderRadius: 10,
    padding: 10,
    gap: 8,
  },
  quoteShipmentTitle: {
    color: '#d8e5f8',
    fontSize: 12,
    fontWeight: '700',
  },
  quoteOptionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#223045',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#0e1622',
  },
  quoteOptionRowSelected: {
    borderColor: '#6ec77a',
    backgroundColor: '#13261d',
  },
  quoteOptionTextWrap: {
    flex: 1,
    paddingRight: 8,
  },
  quoteOptionName: {
    color: '#f5fbff',
    fontSize: 12,
    fontWeight: '600',
  },
  quoteOptionMeta: {
    marginTop: 2,
    color: '#9eb0c8',
    fontSize: 11,
  },
  quoteOptionPrice: {
    color: '#9df0a2',
    fontSize: 13,
    fontWeight: '700',
  },
  quoteOptionBadges: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  quoteOptionBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },
  quoteOptionBadgeSuccess: {
    backgroundColor: '#082912',
    borderColor: '#1f5b2f',
  },
  quoteOptionBadgeMuted: {
    backgroundColor: '#1c1222',
    borderColor: '#4f2c3b',
  },
  quoteOptionBadgeText: {
    color: '#dce7f8',
    fontSize: 10,
    fontWeight: '600',
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
  paymentHintText: {
    color: '#9eb0c8',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
  paymentUnavailableText: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 18,
    color: '#ff9f7a',
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
  confirmationContinueButton: {
    width: '100%',
    borderRadius: 10,
    paddingVertical: 18,
    marginTop: 24,
    alignSelf: 'stretch',
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
  paymentBreakdown: {
    marginTop: 10,
    width: '100%',
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: '#253246',
    paddingTop: 10,
  },
  summaryLineLabel: {
    color: '#9eb0c8',
    fontSize: 12,
  },
  summaryLineValue: {
    color: '#dce7f8',
    fontSize: 12,
    fontWeight: '600',
  },
  addressSelectorSection: {
    marginTop: 16,
    backgroundColor: '#111',
    borderRadius: 10,
    padding: 14,
  },
  addressFormSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#2a3d4f',
  },
  serviceTypeSelectorSection: {
    marginTop: 16,
    backgroundColor: '#111',
    borderRadius: 10,
    padding: 14,
  },
  serviceTypeTabsContainer: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
    marginTop: 8,
  },
  serviceTypeTab: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2d3d4f',
    backgroundColor: '#0e1622',
    alignItems: 'center',
  },
  serviceTypeTabActive: {
    backgroundColor: '#1a3a2a',
    borderColor: '#6ec77a',
  },
  serviceTypeTabText: {
    color: '#9eb0c8',
    fontSize: 12,
    fontWeight: '600',
  },
  serviceTypeTabTextActive: {
    color: '#9df0a2',
  },
  serviceOptionsList: {
    gap: 10,
    marginTop: 8,
  },
  serviceOptionCard: {
    borderWidth: 1,
    borderColor: '#223045',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#0e1622',
  },
  optionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  courierName: {
    color: '#f5fbff',
    fontSize: 13,
    fontWeight: '600',
  },
  optionPrice: {
    color: '#9df0a2',
    fontSize: 14,
    fontWeight: '700',
  },
  optionDetails: {
    gap: 6,
  },
  optionDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  optionDetailLabel: {
    color: '#9eb0c8',
    fontSize: 11,
    fontWeight: '600',
  },
  optionDetailValue: {
    color: '#dce7f8',
    fontSize: 11,
    fontWeight: '500',
  },
  optionBadges: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  badge: {
    backgroundColor: '#1a2d40',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#2d3d4f',
  },
  badgeText: {
    color: '#b8d4f1',
    fontSize: 10,
    fontWeight: '600',
  },
  selectedAddressCompact: {
    marginTop: 12,
    backgroundColor: '#0f1720',
    borderRadius: 10,
    padding: 12,
  },
  selectedAddressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  selectedAddressHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  selectedAddressDetailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 4,
  },
  changeButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#101827',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2d3d4f',
  },
  changeButtonText: {
    color: '#9df0a2',
    fontWeight: '700',
    fontSize: 13,
  },
  cheapestCourierCard: {
    marginTop: 10,
    backgroundColor: '#0b1a14',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#183224',
  },
  quoteSelectedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  quoteSelectedInfo: {
    flex: 1,
    paddingRight: 8,
  },
  quoteSelectedRight: {
    alignItems: 'flex-end',
    gap: 6,
  },
  changeSmallButton: {
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#0f1720',
    borderWidth: 1,
    borderColor: '#2d3d4f',
  },
  changeSmallButtonText: {
    color: '#9df0a2',
    fontWeight: '700',
    fontSize: 12,
  },
  courierSummaryBelowButton: {
    marginTop: 14,
    gap: 10,
  },
  courierSummaryCard: {
    backgroundColor: '#082912',
    borderWidth: 1,
    borderColor: '#1f5b2f',
    borderRadius: 12,
    padding: 12,
  },
  courierSummaryInner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  courierSummaryLeft: {
    flex: 1,
    paddingRight: 8,
  },
  courierSummaryName: {
    color: '#e8fced',
    fontSize: 14,
    fontWeight: '700',
  },
  courierSummaryMeta: {
    color: '#bcdcc1',
    fontSize: 12,
    marginTop: 4,
  },
  courierSummaryRight: {
    alignItems: 'flex-end',
    gap: 6,
  },
  courierSummaryPrice: {
    color: '#9df0a2',
    fontSize: 16,
    fontWeight: '800',
  },
  paymentMethodContainer: {
    gap: 12,
    marginBottom: 16,
  },
  paymentMethodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f1720',
    borderRadius: 10,
    padding: 14,
    borderWidth: 2,
    borderColor: '#2d3d4f',
    gap: 12,
  },
  paymentMethodCardSelected: {
    borderColor: '#4caf50',
    backgroundColor: '#082912',
  },
  paymentMethodRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#2d3d4f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentMethodRadioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#4caf50',
  },
  paymentMethodContent: {
    flex: 1,
    gap: 4,
  },
  paymentMethodLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  paymentMethodSubtext: {
    color: '#9eb0c8',
    fontSize: 12,
  },
  paymentMethodDisabled: {
    opacity: 0.5,
  },
  paymentMethodDisabledText: {
    color: '#ff6b6b',
    fontSize: 11,
    fontWeight: '500',
  },
});
