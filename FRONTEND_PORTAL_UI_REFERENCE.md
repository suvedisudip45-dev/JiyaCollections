# Storefront UI and API Reference

This document describes the customer-facing React app in `frontend/` for UI redesign, Stitch handoff, and API integration work. It is based on the current frontend routes/components and checked backend route/controller contracts for core endpoints. It is not an API guarantee for external providers, nor does it define business rules beyond those represented in the current code.

## 1. Application overview

- **App:** `frontend/`, a standalone React 18 + Vite customer storefront. It is not a root workspace and must be developed/built from the `frontend/` package directory.
- **Libraries:** React Router 6, Axios, Tailwind CSS, Lucide React, React Toastify, Leaflet, CryptoJS, and Canvas Confetti.
- **Local dev URL:** Vite port `5173`.
- **API origin:** `VITE_BACKEND_URL` (the auth interceptor falls back to `http://localhost:4000`).
- **Currency:** `Rs `.
- **Global structure:** `BrowserRouter` → `ShopContextProvider` → app shell. The shell renders announcement strip, responsive storefront navigation, contextual search, route content, footer, and Toastify container.
- **Authentication:** guest browsing/cart supported; checkout, profile, orders, and marketing cards require a customer session. Protected pages redirect to `/login` and commonly preserve an intended route.
- **Feature flags:** `/api/features` controls optional portal surfaces/actions, currently loyalty, marketing cards, and customer letters. Marketing Cards navigation/route is suppressed unless enabled.
- **Cart:** guests store cart in local storage; authenticated customer cart is stored server-side and guest cart is synced on login.
- **Location-based data:** checkout requests server-side shipping and location-pricing quotes using province/district and product variants. Do not use client-side fallback rates as authoritative checkout prices.

## 2. Route inventory

All storefront routes are rendered inside the shared shell unless a route redirects. `CustomerOnly` protects the customer workflow routes. Marketing Cards additionally requires its feature flag.

| Route | Screen | Main UI and behavior |
|---|---|---|
| `/` | Home | Editorial hero, category image tiles, New In and Best Sellers product rails, active festival offers, category showcase, policy strip, newsletter signup. |
| `/shop` | Collection | Category/subcategory selection from query params, New/Bestseller featured filters, subcategory banner/description, product grid, sorting, client-side product search, infinite-scroll pages (12 per chunk), loading/empty states. |
| `/collection` | Alias | Redirects to `/shop`. |
| `/product/:productId` | Product detail | Image gallery, variant/color/size/stock selection, location-specific price quote, add-to-cart, wishlist, sticky mobile purchase bar, image lightbox/zoom, size guide, description/details/reviews tabs, related products. |
| `/combo-bundles` | Combo directory | Browse combo bundle cards; category/category ID can be passed through query parameters. |
| `/combo-bundles/:slug` | Combo detail | Bundle information, included product/variant selection, quantity and proceed-to-checkout action. |
| `/collaborations` | Collaboration directory | Public active collaboration products/brands, partner presentation and product links. |
| `/about` | Journal/About | Static brand/story editorial content. |
| `/contact` | Contact | Contact and inquiry content/form. |
| `/cart` | Cart | Variant-specific product rows, selected quantity, current stock, location price where applicable, line totals, cart total and Continue Shopping/Checkout actions. Guest and signed-in carts use the shared context. |
| `/login` | Sign in / register | Toggle login/signup, account setup, Terms & Conditions modal, validation and social-customer profile recovery/activation flow. Redirects back to requested destination after successful sign-in. |
| `/place-order` | Checkout | Authenticated multi-section delivery form, saved-address selector, Nepal location selector/map, NCM branch/covered-area lookup, location-discount verification, distributor allocation/shipping quote, reward choice, order summary and COD submission. A combo bundle can enter checkout as a special pending purchase payload. |
| `/verify` | Payment callback | Reads payment outcome/order ID from query params, calls the frontend's payment verification URL and navigates to orders or cart. The current backend order router did not expose a matching `verifyStripe` route during source review; verify that payment integration before treating it as an active API contract. |
| `/orders` | Order history & tracking | Authenticated order table/cards with product snapshots, payment and fulfillment status; order detail modal; track delivery, cancel eligible order, submit hub rating, request return/exchange. Polls order data periodically and supports pagination. |
| `/profile` | Customer profile | Account details, profile editing, password update, saved address management, optional loyalty status. |
| `/marketing-cards` | Cards & rewards | Authenticated card list, enter card code, QR scan/manual QR token, sponsor-ad modal, scratch/reward reveal, activate card and claim reward; only routed when cards feature enabled. |
| `/wishlist` | Wishlist | Products saved in browser-local wishlist state; product cards and remove/continue-shopping affordances. |

### Navigation topology

- **Desktop:** announcement strip above the main navbar. Brand/logo plus “Kathmandu / Nepal” on the left; category navigation across center; search, account, wishlist, bag/count and mobile menu controls on the right.
- **Desktop category menus:** category hover/focus dropdown with category landing link, subcategory links, combo-bundle entry, and collaboration entry.
- **Mobile:** hamburger opens a right-side drawer up to 390px wide over a dark backdrop. Header row has close, account/login and bag links; category names become tabs with subcategory/bundle/collaboration links, followed by Unisex, Best sellers, Contact, Wishlist and a large “Explore the edit” image CTA. Search, bag and menu remain in the compact header; account and wishlist icons move into navigation on narrow screens. Desktop category links are hidden. Drawer closes through explicit close, backdrop or navigation.
- **Account menu:** anonymous account icon navigates to Login; signed-in hover menu offers Profile, Orders, feature-gated Marketing Cards, and Logout.
- **Search:** clicking the navbar search button opens a separate search strip and navigates to `/shop` if needed. Search filters currently loaded results client-side; it is not a global backend search endpoint.
- **Breadcrumbs:** rendered above route content by the shell.
- **Cart badge:** quantity sum across all product variants, not number of distinct lines.

## 3. Visual system and layout details

### Current palette

Values are from `frontend/src/index.css`; page components can contain extra Tailwind utility colors and therefore vary.

| Token/role | Current value | Use |
|---|---|---|
| Main ink | `#161714` | Headlines, body, dark surfaces |
| Paper/canvas | `#f8f7f4` | Warm off-white app background |
| White surface | `#ffffff` | Cards, dropdowns, forms |
| Stone | `#eae8e2` | Warm neutral |
| Line | `#dedbd3` | Dividers and outlines |
| Muted | `#6f6d68` | Secondary text and navigation |
| Accent | `#d85b3f` | Terracotta/red-orange emphasis and icon hover |
| Announcement background | `#161714` | Top ticker |
| Announcement highlight | `#d85b3f` | Ticker separator/highlight |

**Observed variation:** some legacy page utilities still use gray, emerald, amber, and red classes. New shared controls use the token palette, semantic status colors, visible terracotta focus rings, and reduced-motion support.

### Typography and shape

- **Global font:** DM Sans, loaded from Google Fonts.
- **Display class:** `.prata-regular` currently points to Space Grotesk (despite the class name). Space Grotesk is loaded at weights 400–700.
- **Editorial UI:** small uppercase eyebrow labels, tracked navigation, bold uppercase category tile headings, body copy with relaxed line-height.
- **Controls:** rounded search/button/inputs in many commerce forms; editorial header dropdowns lean on square corners and fine borders. Product tiles use rounded imagery/cards in newer home content.
- **Motion:** announcement marquee (~22s), image hover zoom and transitions, cart and product-action feedback, reduced-motion stylesheet fallback.
- **Scrollbars:** WebKit scrollbar hidden globally. Design should retain clear scroll affordance in mobile drawers, horizontal tables/rails and long modal content.
- **Shell width:** navbar centered at max-width 1440px. Content padding uses responsive `px-3`, `sm:px-5`, `lg:px-8`; home editorial sections add wider local spacing. Footer begins with a generous top margin.

### Responsive content

- Product listing uses responsive grid/cards and an intersection sentinel to load next 12 items.
- Product cards use a consistent 3:4 image ratio, warm stone surfaces, terracotta emphasis and 44px wishlist targets.
- On narrow screens, the compact header prioritizes search, bag and menu; account/wishlist are discoverable from navigation.
- Home category tiles stack on narrow screens, then use 3 columns from `md`; tile heights step from 280px mobile to 400px desktop.
- Product detail carousel supports mobile horizontal swipe; desktop supports hover zoom and image controls. A sticky bottom purchase bar appears after the main purchase controls leave view.
- Checkout stacks address and summary areas on mobile and uses side-by-side columns at large breakpoint.
- Menus, modal and selector layouts have bespoke responsive behavior. Stitch should not assume one generic modal pattern covers all features.

## 4. Components and on-screen content

### Shared shell/components

| Component | Function |
|---|---|
| `Navbar` | Announcement bar, category/menu navigation, account menu, search trigger, wishlist/cart icons and cart count, logout, mobile drawer; account and wishlist controls move into the drawer at narrow widths. |
| `SearchBar` | Conditionally shown token-styled search form; state lives in ShopContext, sends user to `/shop`, filters loaded collection products by name/category/subcategory. |
| `Breadcrumbs` | Route context above page content. |
| `Footer` | Brand summary, Company links, contact details, copyright. |
| `ProductItem` | Product card reused by collections/rails/related products; image, name, price/discount, rating and product navigation/actions. |
| `ProductRail` | Home horizontal/overflow product row with eyebrow, title, description and view-all link. |
| `Title` | Reusable split-title style for collection/cart headings. |
| `CartTotal` | Subtotal, delivery-fee/total summary reused in cart/checkout; checkout suppresses any legacy fallback charge until a current shipping quote is ready. |
| `Pagination` | Reusable pagination UI where endpoint uses page metadata. |
| `RelatedProducts` | Product recommendations below product details. |
| `ReviewSection` | Product review list, rating summary, user review status, add/edit/delete, like/dislike and pagination. |
| `CategoryShowcase` | Category/subcategory visual entry section. |
| `FestiveOfferSection` | Loads active offer cards; image/title/campaign links as available. |
| `OurPolicy` | Delivery/return/service policy highlights. |
| `NewsletterBox` | Newsletter signup presentation; verify live endpoint wiring before redesigning its submit behavior. |
| `StructuredDescription` pages | Product copy/content is rendered by the product detail component through description tabs. |

### Home page sequence

1. Hero/brand campaign.
2. Three image-led category tiles: Men, Women, Everyday Essentials. Full-bleed photography with a dark bottom gradient, small collection tag, circular arrow, uppercase heading and terracotta “Explore Drops” text.
3. “New in” rail, ordered by newest where present.
4. Active festive offers.
5. “Best sellers” rail, ranked with rating fallback.
6. Category showcase.
7. Policy strip.
8. Newsletter area.
9. Site footer.

### Collection and product card pattern

- Collection filters can be reflected in URL: `category`, `subcategory`, `featured`.
- Backend product page size is requested as 12. Infinite loading appends subsequent product pages.
- Client-side search and sorting apply to currently fetched results; sort choices include relevance/default, low-high, high-low, newest, top-rated.
- Subcategory metadata can provide banner image/description; description can expand.
- Product cards are image-led with title, current price and discount context; product routes are `/product/:productId`.
- Product payload includes image arrays and variant data; variant/color images can supersede default gallery image.

### Product detail

- Main gallery, thumbnails/previous-next, responsive swipe rail, zoom/lightbox, featured variant image.
- Product name, category, rating/review count, price/discount, location discount information and quote-loading/error state.
- Required size/color selection, quantity, stock availability, Add to Cart and Wishlist.
- Optional product size guide opens modal; tabs switch description/details/reviews.
- When selected district/province is known (from saved profile address), UI requests per-item quote. Display quote source/discount percentage and strike-through original price as applicable.
- Sticky mobile CTA repeats purchase action after original CTA scrolls away.

### Cart and checkout

- Cart line identity is product + selected size/color. Quantity is checked against variant stock; removal occurs by setting quantity to zero.
- Guest cart uses `localStorage.cartItems`; wishlists use `localStorage.wishlist`.
- Location pricing recalculates for basket items after a profile/delivery location is known.
- Checkout address fields: first/last name, email, Nepal phone, street/covered area, landmark, district, town/branch, province, delivery instruction, country.
- Saved address selection pre-fills contact/location fields; current UI uses a Nepal map/location picker and branch/coverage checks.
- Checkout displays loading/error/ready states for shipping quote and pricing quote. It blocks order submission when authoritative shipping/pricing quote is not ready or when stock is insufficient.
- Rewards are shown conditionally according to active feature flags and customer eligibility: none, loyalty reward, marketing-card reward. Card discount selection links a claimed card reward.
- Order summary includes item subtotal, applicable reward discount and server-calculated dynamic shipping. Final order uses COD from the current visible flow.
- Successful order clears the cart (except combo bundle purchase handling), refreshes products, surfaces pending distributor assignment distinctly, then navigates to Orders.

### Orders, tracking, returns and exchanges

- Customer orders request is paginated. Each order remains a separate record (including split shipments) rather than flattened into one row.
- List/detail displays order ID, placed date, item names/variants/quantities, total, payment status, order status, fulfillment method, delivery/tracking and COD where returned.
- Delivery can be NCM or distributor self-delivery; do not show self-delivery as undelivered or imply COD was not received when assignment status indicates delivery/receipt.
- Detail interaction opens a modal with track order, request exchange, request return, rate hub, and eligible cancellation actions.
- Return/exchange dialogs select quantities per line, request reason, and replacement size/color for exchange. Status feedback says submitted for admin review; fulfillment handling is downstream.
- Refresh button and 20-second background poll keep statuses current.

### Profile and login

- Profile shows editable first/last name/phone, read-only account identifiers as applicable, password change, address operations and optional loyalty status.
- Login screen toggles “Log In”/“Sign Up”; signup gathers identity, email, Nepal mobile, gender, password and required terms acceptance.
- Social-customer recovery step validates mobile + secret code, shows matched profile identity, then collects email/password and activates linked account.
- Checkout redirect state returns user to checkout after auth.
- Credentials are encrypted in client using `VITE_AES_KEY` and `VITE_AES_IV` before login; access/refresh token management is in `frontend/src/auth/tokenStorage.js`.

### Feature-gated Marketing Cards

- Cards route is customer-authenticated and only displayed when `marketingCardsEnabled` is true.
- Flow: card listing → enter card code → backend card-code check → QR camera scan or manual token input → scan verification → result/reveal → activate card → list refreshed.
- Separate claim-reward action is available for eligible card.
- Scanner modal includes camera error state and manual QR path. Sponsor/ad content can open a separate modal before proceeding.
- Scratch/reveal uses animation/confetti where configured.

## 5. API and response conventions

### Request conventions

- Backend requests use Axios and `${VITE_BACKEND_URL}/api/...`.
- Authenticated customer requests generally send `{ token }` as a request header (not only the conventional `Authorization` header). Auth requests include cookies via `withCredentials`.
- Most requests and responses are JSON. Product image upload or campaign media may use `FormData`; inspect its concrete component before changing upload UI.
- Shared auth interceptor installs once, installs GET response caching, retries eligible authenticated `401` responses once via `POST /api/auth/refresh`, rotates tokens, clears cached responses on auth changes, and redirects home if refresh fails.
- Error UI commonly reads `error.response.data.message`; several quote errors additionally include `code` and `stockShortages`.
- Core response envelope: `{ success: true, ...data }` on success; failures generally use `{ success: false, message }`, sometimes HTTP status and a `code`. The UI should check `success`; HTTP 200 does not guarantee application success in all legacy controllers.
- This document shows representative shapes rather than full records. IDs, optional fields, snapshots and nested relations vary by endpoint and record.

### Verified product/category/shipping responses

#### Feature flags

`GET /api/features` (public), `PATCH /api/features` (admin only; not a customer mutation):

```json
{
  "success": true,
  "features": {
    "loyaltyEnabled": true,
    "marketingCardsEnabled": true,
    "lettersEnabled": true
  }
}
```

The feature flags object is returned by backend; frontend uses at least `loyaltyEnabled` and `marketingCardsEnabled`. If fetch fails, ShopContext stores `{}` and optional feature interfaces remain unavailable.

#### Category navigation

`GET /api/category/navigation`:

```json
{
  "success": true,
  "navigation": [
    {
      "id": "category-id",
      "name": "Women",
      "productCount": 8,
      "subcategories": ["Tops"],
      "comboBundles": [
        { "id": "bundle-id", "name": "Everyday Set", "slug": "everyday-set", "image": "...", "bannerImage": "..." }
      ]
    }
  ]
}
```

The navigation response is built from categories with published product counts and active combo bundles. The navbar consumes `navigation[]`.

`GET /api/category/list` returns `{ success, categories }`. `GET /api/subcategory/list` is consumed as `{ success, subCategories }`; a category/subcategory record may include image/description and category relation.

#### Product list

`GET /api/product/list?page=1&limit=12&category=...&subcategory=...&featured=new|bestseller&search=...`

Backend paginated envelope:

```json
{
  "success": true,
  "products": [
    {
      "_id": "product-id",
      "id": "product-id",
      "name": "Product name",
      "nepaliName": "...",
      "image": ["https://..."],
      "category": "Women",
      "categories": ["Women"],
      "subCategory": "Tops",
      "price": 2500,
      "discount": 10,
      "globalDiscountPercentage": 10,
      "locationDiscountPercentage": 0,
      "discountSource": "GLOBAL",
      "sizes": ["S", "M"],
      "colors": ["Black"],
      "variants": [{ "size": "S", "color": "Black", "quantity": 4, "image": "..." }],
      "published": true,
      "newInStore": true,
      "bestseller": false,
      "rating": 4.5,
      "reviewCount": 2
    }
  ],
  "data": ["same records as products"],
  "pagination": {
    "page": 1,
    "limit": 12,
    "total": 25,
    "totalPages": 3,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

Fields shown are an illustrative subset of the actual product record. Public list excludes unpublished/deleted products and may calculate location-aware effective discount when province/district query parameters are supplied. Default pagination is page 1/limit 12, maximum 50.

#### Product location price

`POST /api/product/resolve-prices` request:

```json
{
  "province": "Gandaki Province",
  "district": "Kaski",
  "eligibilityMode": "PER_ITEM",
  "items": [{ "productId": "product-id", "size": "M", "color": "Black", "quantity": 1 }]
}
```

Success envelope is `{ "success": true, ...result }`. The result contains an `items` array; each matched line is read in UI using `productId`, `size`, `color`, `effectiveUnitPrice`, `effectiveDiscountPercentage`, `locationDiscountPercentage`, `discountSource`, and `lineTotal`. Request may use `WHOLE_BASKET` instead, especially in cart and checkout. Errors can contain `{ success:false, code, message }`.

#### Shipping configuration and quote

`GET /api/shipping/config`:

```json
{
  "success": true,
  "config": {
    "sameDistrictFee": 50,
    "differentDistrictFee": 120,
    "sameProvinceFee": 120,
    "differentProvinceFee": 120,
    "splitShipmentFee": 200,
    "routeOverrides": [],
    "freeShippingMin": 0
  }
}
```

`POST /api/shipping/calculate` request carries `{ district, province, subtotal, items, ncmBranch }`; each item identifies product and positive quantity, with optional variant fields. This calculation can preview distributor allocation and uses product lines and destination. Representative single shipment:

```json
{
  "success": true,
  "fee": 250,
  "tier": "SAME_PROVINCE",
  "rateTier": "SAME_PROVINCE",
  "label": "Within Province",
  "hasLocalHub": true,
  "probableDistributor": { "id": "hub-id", "name": "Hub", "district": "Kaski", "province": "Gandaki Province" },
  "freeShippingMin": 3000
}
```

Representative split shipment response additionally includes `splitShipment: true`, `shipmentCount`, `splitShipmentFee`, `shipments[]` (distributor, items, origin), and `destination`. Free shipping returns `fee: 0` and a free-shipping tier/label. Allocation failures may return HTTP 409 with `code`, `message`, and `stockShortages`. Do not render a successful quote if `success` is false or quote key no longer matches current location/cart.

### Customer account, cart and order APIs

| Screen/action | API request | Response used by frontend |
|---|---|---|
| Register | `POST /api/user/register` with firstName, lastName, gender, email, phone, password | `{ success, token, accessToken, refreshTokenExpiresAt, user }`; `user` includes identity/contact/socialCustomerCode/addresses. |
| Login | `POST /api/auth/login` with email, encrypted `targetPortal` and `encryptedPassword`; cookies enabled | `{ success, accessToken/token, refreshTokenExpiresAt, ... }`; if 2FA required, response instead includes `requiresTwoFactor: true` and challenge details. Login failures use `{ success:false, message }`. |
| Social account recovery validation | `POST /api/user/social/validate` with `{ phone, code }` | `{ success, customer }`; customer identity fields are used to prefill activation. |
| Social account activation | `POST /api/user/social/activate` with phone/code/email/password/name/gender | Successful login-like token/user response. |
| Token refresh | `POST /api/auth/refresh` with `{ portal: "CUSTOMER" }`, refresh cookie | Rotated access-token payload and `refreshTokenExpiresAt`; interceptor requires a complete token response. |
| Logout | `POST /api/auth/logout`, authenticated session/cookies | `{ success, message }`; client clears tokens/cart state. |
| Public user profile | `GET /api/user/profile`, token header | `{ success, user }`; profile includes addresses and identity fields. |
| Profile update | `POST /api/user/profile/update` with first/last name, phone | `{ success, user }`; UI replaces profile fields from returned `user`. |
| Password change | `POST /api/user/password/change` with current/new password | `{ success, message }`. |
| Save/delete address | `POST /api/user/address/save` or `/api/user/address/delete` with address/addressId | `{ success, message, addresses }`; returned address list should replace stale local list. |
| Cart add/update | `POST /api/cart/add` or `/api/cart/update` with itemId, size, color, quantity | Success `{ success, message }`; stock validation may return `{ success:false, message }`, including when quantity was adjusted server-side. |
| Guest cart sync | `POST /api/cart/sync` with `{ localCart }`; authenticated | `{ success, cartData }`. |
| Read signed-in cart | `POST /api/cart/get` with `{}`; authenticated | `{ success, cartData }`. `cartData` is keyed by product ID then variant string to quantity, e.g. `{ "product-id": { "M-Black": 2 } }`. |
| Place customer order | `POST /api/order/place`, authenticated | See order response below. |
| Read orders | `POST /api/order/userorders?page=1&limit=10`, token | Standard paginated response `{ success, orders, data, pagination }`. Order objects include delivery NCM details, self-delivery assignment where relevant, and display snapshots. |
| Cancel order | `POST /api/order/:orderId/cancel` with `{ reason }`, token | UI expects `{ success, message }`; failure includes `{ success:false, message }`. |
| Verify payment callback | Frontend calls `POST /api/order/verifyStripe` with `{ success, orderId }`, token | UI branches on `response.success`; success clears cart and routes to orders, failure returns to cart. The current `backend/routes/orderRoute.js` did not show a matching `verifyStripe` handler, so treat this as a frontend call that needs backend/payment-route verification—not a confirmed backend response contract. It is not the COD checkout request. |

Representative order place payload generated by checkout:

```json
{
  "address": {
    "firstName": "A",
    "lastName": "Customer",
    "phone": "98XXXXXXXX",
    "street": "Covered area",
    "landmark": "Near landmark",
    "district": "Kaski",
    "province": "Gandaki Province",
    "city": "Pokhara",
    "ncmBranch": "Pokhara",
    "deliveryInstruction": "",
    "country": "Nepal"
  },
  "items": [
    { "id": "product-id", "name": "Product name", "size": "M", "color": "Black", "quantity": 1 }
  ],
  "deliveryFee": 250,
  "amount": 2750,
  "rewardChoice": "NONE"
}
```

The actual payload uses product snapshots from the loaded product record and can include `comboBundle` for bundle checkout and `marketingCardId` for selected card reward. Never treat this sample as authoritative input validation.

Verified placement success shape:

```json
{
  "success": true,
  "message": "Order placed and assigned to a distributor.",
  "allocation": { "status": "ASSIGNED" },
  "orderIds": ["order-id"],
  "checkoutGroupId": "group-id",
  "shipmentCount": 1
}
```

For split shipment, `allocation` may contain `status` and `shipments[]` keyed by each order ID. If assignment is pending, response is still `success: true`, but `allocation.status` is `PENDING_ASSIGNMENT`; show the pending message rather than a fully-assigned success message. Errors may include `code`/`message`.

### Reviews, return/exchange, loyalty and cards

| Feature | API requests used | Response shape consumed |
|---|---|---|
| Product reviews | `GET /api/review/product/:productId?sortBy=...&page=...&limit=10` | `{ success, reviews, pagination, stats }`; stats include `totalReviews` and `averageRating`. |
| Review eligibility | `POST /api/review/status/:productId` | `{ success, canReview, hasReviewed, userReview }`. |
| Submit review | `POST /api/review/add` | UI checks `{ success, message }`; interaction endpoints include review ID/action data. |
| Review like/dislike/delete | `POST /api/review/like`, `/dislike`, `/delete` | UI expects success/message and refreshes review data. |
| Loyalty status | `GET /api/loyalty/my-status`, authenticated and requested only when loyalty feature enabled | `{ success, loyalty }`; UI reads `activeReward.isEligible` at checkout and displays returned loyalty data in profile. |
| Customer card list | `GET /api/marketing-cards/customer/cards`, authenticated | `{ success, cards }`. |
| Card rewards at checkout | `GET /api/marketing-cards/customer/rewards`, authenticated | `{ success, rewards }`; reward contains `cardId` and benefit (`benefitType`, `value` etc.). |
| Verify card code | `POST /api/marketing-cards/customer/cards/verify-code` with `{ cardCode }` | UI retains full response; reads `success`, `message`, optional `ad`. |
| Verify QR | `POST /api/marketing-cards/customer/cards/verify-qr` with `{ cardCode, token }` | UI retains result; reads `success`, `message`, `cardId` and offer fields for reveal. |
| Activate card | `POST /api/marketing-cards/customer/cards/:cardId/activate` | `{ success, message }`; reload cards after success. |
| Claim reward | `POST /api/marketing-cards/customer/claim-reward` with `{ cardId }` | `{ success, message }`; reload cards after success. |
| Exchange requests list | `GET /api/returns/exchange/customer`, authenticated | UI consumes `requests[]`. |
| Create exchange | `POST /api/returns/exchange/customer` with orderId, requestKey, reasonCode/details, selected `items[]`, `replacementItems[]` | UI expects `{ success, message }`; refreshes order/return state. |
| Return requests list | `GET /api/returns/customer/requests`, authenticated | UI consumes `returns[]`. |
| Create return | `POST /api/returns/customer/request` with order/item/quantity/reason and request key fields | UI checks `{ success, message }`; refreshes data. Exact allowed fields depend on controller validation. |
| Delivery tracking | `GET /api/delivery/customer/:lookupId`, authenticated | UI consumes delivery/assignment state, events and tracking information; preserve NCM vs `SELF_DELIVERY` distinction. |
| Active offer cards | `GET /api/offer/active` | `FestiveOfferSection` checks `success` and displays returned active offers; exact field shape follows live backend offer record. |

Returns/exchange list and write endpoints are authenticated/permission-gated on the backend. Admin acceptance and actual return/exchange fulfillment are not customer-front-end requests; they are handled in admin/distributor/NCM workflows.

### Combos, collaborations, branches and external location service

| UI | API | Response |
|---|---|---|
| Combo bundle directory | `GET /api/combo-bundles` (may include category filters) | UI expects successful `comboBundles` list and bundle product detail fields. |
| Bundle detail/checkout | `GET /api/combo-bundles/:id?categoryId=...&status=ACTIVE` | `{ success, comboBundle }`; bundle has `products[]` with linked product records, selling/calculated price and status. |
| Collaboration directory | `GET /api/collaborations/public/products` | UI renders public active products/partner context from the returned public listing. |
| NCM branch list | `GET /api/manufacturer/branches?province=...&district=...` | UI reads `branches[]`. |
| NCM coverage for selected branch | `GET /api/manufacturer/branches?branch=...&district=...&province=...` | UI reads `coveredAreas[]`. |
| Map place search | OpenStreetMap Nominatim `GET https://nominatim.openstreetmap.org/search?...&countrycodes=np&limit=6&addressdetails=1` | Array of places; UI maps display name, lat/lon. Local `NEPAL_CITIES` matches are merged first. |
| Map reverse geocode | OpenStreetMap Nominatim `/reverse?format=json&lat=...&lon=...&zoom=18&addressdetails=1` | Uses `address.road`, `suburb`, or `neighbourhood` as address snippet when available. |

External map responses are not backend API responses; they may fail or be incomplete. Local Nepal location/district data is also present in `frontend/src/data/`.

## 6. State and pricing behavior to preserve

- Storefront product listing is public and only displays published records from the backend. Product detail currently resolves from the shared loaded product list, so route behavior should account for loading and missing IDs.
- Product `price` and `discount` can be location-adjusted by backend when product list is fetched with province and district. `resolve-prices` returns effective price line-by-line and should be used when basket/selection changes.
- Shipping is dynamic: quote includes customer province/district, order subtotal, item product/variant/quantity and NCM branch; backend can pick likely distributor origin and may respond with split shipment routing and fee. Admin-configured shipping remains authoritative.
- There is a legacy `delivery_fee` fallback in ShopContext (`50`) and a legacy client helper for instant display. It is not authoritative for checkout; checkout blocks until quote ready. Design should not imply fallback value is a confirmed fee.
- With a basket that requires products from multiple distributor hubs, backend can create multiple order shipments and return multiple `orderIds`. Keep each shipment visible in Orders; do not merge them into a fictional single fulfillment record.
- User cart data is variant keyed. A selected size/color must be represented consistently across card, product, cart, quote, and order lines.
- Feature flags are loaded asynchronously at app start. Until loaded, avoid rendering gated flows as definitively disabled; `FeatureRoute` renders nothing while value is undefined, then redirects if disabled.
- Token changes clear GET response cache. Authenticated stale-token recovery is handled centrally; page components should still show understandable errors and not silently imply order placement succeeded.

## 7. Stitch handoff brief

Design a responsive fashion storefront for Aama Clothings, Nepal, not the internal admin UI. Maintain an editorial streetwear/essentials visual language with warmth, product photography, and restrained terracotta accents while keeping product choice and checkout extremely clear.

### Desired design improvements

1. Normalize page-level Tailwind colors to the paper/charcoal/terracotta palette and semantic success/warning/error/info colors.
2. Make mobile navigation, category expansion, search, and cart entry easy to discover without overcrowding the header.
3. Establish product-card consistency and clear stock/discount/price-location messaging.
4. Make checkout quote states explicit: “Calculating”, “Ready”, “Unavailable” and “Retry”; show distributor/split-shipment explanation only to the level appropriate for customers and do not expose internal routing data unnecessarily.
5. Show delivery charge only from the current valid server quote; quote must refresh on address/cart changes.
6. Make NCM branch/covered-area validation understandable without requiring users to understand internal logistics.
7. In Orders, clearly separate order status, delivery-provider status, payment state and COD state; show an event timeline and actual delivery date for both NCM and distributor self-delivery.
8. Convert long profile/order/product content into clear sections/tabs, and design accessible dialogs for order detail, return/exchange, size guide, map, scanner, campaign ad and lightbox.
9. Design robust loading/empty/error states for every route and preserve search-first privacy where customer information is involved.
10. Preserve keyboard operation, visible focus, touch target sizes, reduced-motion support and accessible image labels.

### Representative screens Stitch should return

- Global desktop/mobile header with category dropdown, mobile menu, account menu and cart badge.
- Homepage with hero, category tiles, new/bestseller rails, offers and footer.
- Collection page with filters, sorting, card grid, loading/infinite-scroll/empty state.
- Product detail desktop and mobile with variants, location-aware pricing, sticky CTA, reviews, size guide and image lightbox.
- Cart with variant-aware line items, stock warnings, price summary and empty state.
- Checkout with address/location map, covered-area/branch selection, saved-address cards, pricing and delivery quote states, rewards and final summary.
- Order history table/card list, full detail drawer/modal, delivery tracking timelines for both NCM and distributor self-delivery, return and exchange dialogs.
- Login/signup/social profile activation and customer profile/address management.
- Marketing card scan/verify/reveal/activate/reward flow (feature-gated).

### Suggested reusable components

Announcement ticker; responsive site header; category menu/drawer; search strip; breadcrumbs; price/discount display; product card; product rail; rating summary/review card; variant selector; size guide dialog; gallery/lightbox; cart line; stock warning; location selector/map dialog; shipping quote card; checkout reward selector; address card/form; order table/card; delivery timeline; return/exchange dialog; profile forms; marketing card scanner; toast; skeleton; empty/error state; footer.

### Copy-ready Stitch prompt

> Design the Aama Clothings customer storefront in `frontend/` as a premium Nepal-based fashion e-commerce experience. Use `FRONTEND_PORTAL_UI_REFERENCE.md` as requirements: preserve all listed routes, components, fields, API-driven states, feature gates, cart variants, server-quoted product prices/shipping, split shipments as distinct orders, saved addresses, NCM coverage selection, reviews, loyalty/card rewards, order tracking for both NCM and distributor self-delivery, returns/exchanges, and mobile behavior. Visual direction: warm editorial streetwear, paper background `#f8f7f4`, charcoal ink `#161714`, white surfaces, warm borders `#dedbd3`, muted `#6f6d68`, terracotta accent `#d85b3f`; DM Sans UI and Space Grotesk display; premium fashion photography, restrained uppercase labels, generous whitespace, and sharp readable product pricing. Design desktop/tablet/mobile, accessible status colors, visible focus states, reduced-motion support, skeleton/empty/error/retry states, and dialogs/drawers for every existing interaction. Make checkout clear and trustworthy: show delivery/price quote loading and failures, never present the old fallback delivery fee as final, and refresh quotes when cart or delivery address changes. Do not invent business rules or expose internal allocation data unnecessarily. Return design tokens, reusable components, representative screen layouts, and a route-to-template mapping.

## 8. Source map and scope notes

- Route/shell: `frontend/src/App.jsx`, `frontend/src/main.jsx`.
- Global styles: `frontend/src/index.css`, `frontend/tailwind.config.js`.
- Shared cart/auth/product/pricing state: `frontend/src/context/ShopContext.jsx`.
- Auth/cache: `frontend/src/api/authInterceptor.js`, `frontend/src/api/responseCache.js`, `frontend/src/auth/tokenStorage.js`.
- Customer routes: `frontend/src/pages/`.
- Shared UI: `frontend/src/components/`.
- Backend route/controller response sources checked for core API contracts: `backend/routes/`, `backend/controllers/`, `backend/utils/pagination.js`.
- Response examples are illustrative and omit private customer data. They use synthetic IDs and placeholder images.
- Some page APIs (for example payment callback, campaign partner listings, and external Nominatim data) have only been described to the degree actually consumed by this frontend. Verify the live controller/contract before treating omitted fields as guaranteed.
- This file is the **customer storefront** reference. The separate [`ADMIN_PORTAL_UI_REFERENCE.md`](./ADMIN_PORTAL_UI_REFERENCE.md) covers the admin portal.
