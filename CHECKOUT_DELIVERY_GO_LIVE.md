# Checkout + Delivery Go-Live Checklist

Use this as the single source of truth for a successful payment-to-delivery flow.

## 1) Completed In Code
- [x] Razorpay gateway order creation endpoint (`POST /api/orders/:id/pay/razorpay-order`)
- [x] Razorpay signature verification on payment confirmation (`POST /api/orders/:id/pay`)
- [x] Idempotent payment confirmation (retries do not break already-paid orders)
- [x] Razorpay webhook endpoint with HMAC verification (`POST /api/orders/webhooks/razorpay`)
- [x] Shipment skeletons per seller are created at order creation time
- [x] NimbusPost booking attempted automatically after payment success
- [x] NimbusPost webhook endpoint for tracking status updates (`POST /api/orders/carrier/nimbuspost/webhook`)
- [x] Seller shipment status sync endpoint (`POST /api/orders/seller/:orderId/shipments/:shipmentRef/sync-tracking`)
- [x] Mobile checkout runtime fix for native Razorpay module detection
- [x] Protected debug readiness endpoint (`GET /api/debug/integrations/readiness`)
- [x] Smoke-test script for env + webhooks (`npm run verify:checkout-flow` in `server`)

## 2) Must Complete In Cloud Dashboards (Manual)
- [ ] Deploy backend to a public HTTPS URL (Render/Railway/etc)
- [ ] Set production env vars in deployed backend
- [ ] Configure Razorpay webhook URL:
      `https://<your-domain>/api/orders/webhooks/razorpay`
- [ ] Configure Razorpay webhook events:
      `payment.authorized`, `payment.captured`, `order.paid`, `payment.failed`
- [ ] Set same `RAZORPAY_WEBHOOK_SECRET` in backend env and Razorpay dashboard
- [ ] Enable NimbusPost in env and complete pickup/warehouse details
- [ ] Configure NimbusPost webhook URL:
      `https://<your-domain>/api/orders/carrier/nimbuspost/webhook`
- [ ] Set same `NIMBUSPOST_WEBHOOK_SECRET` in backend env and Nimbus dashboard
- [ ] Set mobile env `EXPO_PUBLIC_API_URL=https://<your-domain>/api`
- [ ] Install a fresh native app build (Razorpay will not work in Expo Go)

## 3) Verify In 2 Minutes
1. Start backend:
   - `cd server`
   - `npm run dev`
2. Run checks:
   - `npm run verify:checkout-flow`
3. Confirm all checks show `PASS`.

## 4) First End-to-End Test (Sandbox)
1. Place one order from mobile checkout.
2. Complete Razorpay test payment.
3. Confirm order transitions:
   - `paymentStatus: completed`
   - `status: confirmed`
4. Confirm seller shipment transitions:
   - `ready_for_booking` -> `booked` or `awb_assigned`
5. Confirm AWB/tracking appears in seller shipment data.

## 5) Production Safety Notes
- Rotate any keys that were ever exposed in logs/screenshots/chat.
- Keep webhook secrets non-empty in production.
- Keep payment and shipment transitions server-authoritative (never trust client-only success).
