function mapAddressToSellerPickup(addressDoc = {}, overrides = {}) {
  return {
    addressId: String(overrides.addressId || addressDoc?._id || '').trim(),
    label: String(overrides.label || addressDoc?.label || 'Pickup').trim().slice(0, 60),
    fullName: String(overrides.fullName || addressDoc?.fullName || '').trim().slice(0, 120),
    phoneNumber: String(overrides.phoneNumber || addressDoc?.phoneNumber || '').trim().slice(0, 40),
    email: String(overrides.email || addressDoc?.email || '').trim().slice(0, 140),
    street: String(overrides.street || addressDoc?.street || '').trim().slice(0, 240),
    city: String(overrides.city || addressDoc?.city || '').trim().slice(0, 120),
    state: String(overrides.state || addressDoc?.state || '').trim().slice(0, 120),
    postalCode: String(overrides.postalCode || addressDoc?.postalCode || '').trim().slice(0, 20),
    country: String(overrides.country || addressDoc?.country || 'India').trim().slice(0, 80) || 'India',
  };
}

function sanitizeSellerPickupAddress(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const next = mapAddressToSellerPickup(raw, {
    addressId: typeof raw.addressId === 'string' ? raw.addressId : '',
  });

  if (!next.fullName || !next.phoneNumber || !next.street || !next.city || !next.state || !next.postalCode) {
    return null;
  }

  return next;
}

function buildSellerPickupAddressResponse(pickup = {}) {
  return {
    addressId: String(pickup?.addressId || ''),
    label: String(pickup?.label || ''),
    fullName: String(pickup?.fullName || ''),
    phoneNumber: String(pickup?.phoneNumber || ''),
    email: String(pickup?.email || ''),
    street: String(pickup?.street || ''),
    city: String(pickup?.city || ''),
    state: String(pickup?.state || ''),
    postalCode: String(pickup?.postalCode || ''),
    country: String(pickup?.country || 'India'),
    updatedAt: pickup?.updatedAt || null,
  };
}

function resolveSellerPickupAddressUpdate(user, { sellerPickupAddressId = '', sellerPickupAddress = null } = {}) {
  const pickupAddressId = String(sellerPickupAddressId || '').trim();
  const pickupAddressPayload = sanitizeSellerPickupAddress(sellerPickupAddress);

  if (pickupAddressId) {
    const selectedAddress = (user?.addresses || []).find(
      (entry) => String(entry?._id || '') === pickupAddressId
    );

    if (!selectedAddress) {
      return {
        ok: false,
        statusCode: 400,
        message: 'Selected pickup address was not found in your saved addresses.',
      };
    }

    if (!String(selectedAddress?.state || '').trim()) {
      return {
        ok: false,
        statusCode: 400,
        message: 'Selected pickup address is missing state. Please edit the address and add state.',
      };
    }

    return {
      ok: true,
      sellerPickupAddress: {
        ...mapAddressToSellerPickup(selectedAddress, {
          addressId: pickupAddressId,
          label: selectedAddress.label || 'Pickup',
        }),
        updatedAt: new Date(),
      },
    };
  }

  if (pickupAddressPayload) {
    return {
      ok: true,
      sellerPickupAddress: {
        ...pickupAddressPayload,
        updatedAt: new Date(),
      },
    };
  }

  return {
    ok: false,
    statusCode: 400,
    message: 'sellerPickupAddressId or sellerPickupAddress is required',
  };
}

module.exports = {
  mapAddressToSellerPickup,
  sanitizeSellerPickupAddress,
  buildSellerPickupAddressResponse,
  resolveSellerPickupAddressUpdate,
};