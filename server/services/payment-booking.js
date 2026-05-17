async function bookReadySellerShipmentsAfterPayment({
  order,
  shipmentsToBook = [],
  sellerPickupMap = new Map(),
  createShipment,
  buildNimbusShipmentPayload,
  mapNimbusStatusToShipmentStatus,
  buildNimbusTrackingUrl,
  appendShipmentTimelineEntry,
  syncOrderItemsFromShipment,
  allowedShipmentStatuses = [],
}) {
  if (!order || typeof order !== 'object') {
    throw new Error('Order is required for shipment booking.');
  }

  if (!Array.isArray(shipmentsToBook) || shipmentsToBook.length === 0) {
    return { bookedCount: 0, failedCount: 0 };
  }

  if (typeof createShipment !== 'function') {
    throw new Error('createShipment dependency is required.');
  }

  const validStatuses = Array.isArray(allowedShipmentStatuses) ? allowedShipmentStatuses : [];
  let bookedCount = 0;
  let failedCount = 0;

  for (const shipment of shipmentsToBook) {
    try {
      const pickupOverride = sellerPickupMap.get(String(shipment?.seller || '')) || null;
      if (!pickupOverride) {
        throw new Error('Seller pickup address is missing or incomplete for this shipment.');
      }

      if (typeof buildNimbusShipmentPayload !== 'function') {
        throw new Error('buildNimbusShipmentPayload dependency is required.');
      }

      const payload = buildNimbusShipmentPayload(order, shipment, pickupOverride);
      const booking = await createShipment(payload);

      const mappedStatus = booking.awbNumber
        ? 'awb_assigned'
        : (typeof mapNimbusStatusToShipmentStatus === 'function'
          ? mapNimbusStatusToShipmentStatus(booking.remoteStatus || 'booked')
          : 'booked');

      shipment.status = validStatuses.includes(mappedStatus) ? mappedStatus : 'booked';
      shipment.lastError = '';
      shipment.carrier = {
        provider: 'nimbuspost',
        mode: booking.mode || '',
        orderId: booking.orderId || '',
        shipmentId: booking.shipmentId || '',
        awbNumber: booking.awbNumber || '',
        courierId: booking.courierId || '',
        courierName: booking.courierName || '',
        remoteStatus: booking.remoteStatus || '',
        labelUrl: booking.labelUrl || '',
        manifestUrl: booking.manifestUrl || '',
        trackingUrl: typeof buildNimbusTrackingUrl === 'function'
          ? buildNimbusTrackingUrl(booking.awbNumber)
          : '',
      };

      if (typeof appendShipmentTimelineEntry === 'function') {
        appendShipmentTimelineEntry(shipment, {
          status: shipment.status,
          note: booking.awbNumber
            ? `NimbusPost booking successful. AWB: ${booking.awbNumber}.`
            : 'NimbusPost booking successful.',
          source: 'system',
        });
      }

      if (typeof syncOrderItemsFromShipment === 'function') {
        syncOrderItemsFromShipment(order, shipment, {
          note: booking.awbNumber
            ? `Shipment AWB assigned (${booking.awbNumber}).`
            : 'Shipment booked with NimbusPost.',
          updatedBy: null,
        });
      }

      bookedCount += 1;
    } catch (bookingError) {
      const bookingMessage = bookingError?.message || 'Unknown NimbusPost booking error';
      shipment.status = 'failed';
      shipment.lastError = bookingMessage;

      if (typeof appendShipmentTimelineEntry === 'function') {
        appendShipmentTimelineEntry(shipment, {
          status: 'failed',
          note: `NimbusPost booking failed: ${bookingMessage}`,
          source: 'system',
        });
      }

      failedCount += 1;
      console.warn(`[PAYMENT][NIMBUS] Booking failed for ${shipment.localShipmentRef}:`, bookingMessage);
    }
  }

  return { bookedCount, failedCount };
}

module.exports = {
  bookReadySellerShipmentsAfterPayment,
};