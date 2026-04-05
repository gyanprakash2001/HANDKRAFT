# HANDKRAFT Project Progress Tracker

Last updated: 2026-03-22

How to use:
- Checked box `[x]` means completed.
- Unchecked box `[ ]` means pending.
- Update this file at the end of each work session.

## Vision
- [x] Build an ecommerce app for handmade products.
- [x] Pinterest-like browse/feed experience as the UI direction.

## Phase 0 - Setup and Foundation
- [x] Monorepo/workspace structure created (server, mobile, client).
- [x] Server setup with Express and Mongoose.
- [x] Mobile app initialized with Expo Router.
- [x] Web app initialized with Vite + React.

## Phase 1 - Marketplace Backend Core
- [x] Product model created.
- [x] Products API route added to server.
- [x] GET /api/products (pagination, search, filters, sort).
- [x] GET /api/products/:id.
- [x] Seed endpoint added for sample products.
- [x] Atlas MongoDB connection configured in environment.
- [x] Sample products seeded and API response verified in browser.

## Phase 2 - Mobile Feed Integration
- [x] Connect mobile feed screen to GET /api/products.
- [x] Replace dummy product cards with real API data.
- [x] Add loading, error, and empty states.
- [x] Add pull-to-refresh for feed.

## Phase 3 - Product Experience
- [x] Product details screen.
- [x] Product image gallery support.
- [x] Seller name, material, and stock shown in UI.
- [x] Related products or recommendations.

## Phase 4 - Shopping Flow
- [x] Cart backend endpoints (add/remove/view via profile dashboard).
- [x] Cart UI in mobile app (profile tab + add to cart from product details).
- [x] Checkout flow (order creation, payment processing, order confirmation).
- [ ] Order history/tracking endpoint.
- [ ] Invoice generation.

## Phase 5 - Seller Flow
- [x] Seller listing create API.
- [x] Seller product management in profile (Listed tab).
- [ ] Seller listing edit APIs.
- [ ] Inventory update support.

## Phase 5.5 - Unified Buyer + Seller Profile
- [x] Profile header with seller avatar and identity details.
- [x] Listed tab powered by user-owned products.
- [x] Saved/Liked tab powered by liked items.
- [x] Cart tab powered by user cart items.
- [x] Product details actions for Like and Add to Cart.

## Phase 6 - Web Client
- [ ] Replace default Vite starter UI.
- [ ] Build web product feed page.
- [ ] Build web product details page.
- [ ] Connect web app to backend APIs.

## Phase 7 - Quality and Deployment
- [ ] Backend validation and consistent error handling.
- [ ] Authentication hardening and security checks.
- [ ] Basic automated tests.
- [ ] Deployment configuration for backend + apps.

## Phase 8 - Buyer View Modernization
- [x] Feed spacing tightened for denser visual browsing.
- [x] Personalized discovery strip added on buyer feed.
- [x] Category chips added on feed with quick filtering.
- [x] Skeleton loading cards for feed.
- [ ] Richer empty states with guided actions.
- [ ] Product trust chips (fast dispatch, limited stock, handmade verified).
- [x] Social proof snippets on product cards.
- [x] Wishlist collections (boards) instead of a single saved list.
- [ ] Offer strip in cart/checkout with savings summary.
- [ ] Profile quick widgets (recent order tracker and shortcuts).

## Current Session Snapshot
- [x] Backend product APIs are functional.
- [x] Local MongoDB mode stabilized and in use.
- [x] /api/products returns product list successfully.
- [x] Phase 2 mobile feed integration completed.
- [x] Phase 3 product details and related products completed.
- [x] Unified profile with Listed/Saved/Cart tabs completed.
- [x] Profile dashboard endpoints fully wired (GET /api/users/me/profile-dashboard).
- [x] Like/cart toggle actions working on product detail screen.
- [x] Mobile API methods integrated (toggleLikedProduct, addProductToCart, removeProductFromCart).
- [x] Order model created with status tracking and payment info.
- [x] Checkout endpoints implemented (POST /api/orders, POST /api/orders/:id/pay, GET /api/orders/:id).
- [x] Checkout screen completed with 4-step flow (cart summary → shipping → payment → confirmation).
- [x] Payment form validation and processing (Stripe token simulation for demo).
- [x] Order confirmation screen with order ID and details display.
- [x] Cart notification popup component (minimal, bottom-fixed, shows last added item).
- [x] Replaced full cart drawer with lightweight notification UX.
- [x] Fixed duplicate/random items bug - prevented multiple rapid API calls.
- [x] Added button disabled state during cart operations for safety.
- [ ] Sync notification quantity changes to backend when navigating to checkout.
- [x] Feed personalization started (discovery strip + category chips).
- [ ] Next: offer strip in cart/checkout with savings summary.
