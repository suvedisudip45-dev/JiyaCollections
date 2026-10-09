# Frontend and UI Reference

## 1. UI Architecture

The project uses a multi-app frontend architecture:

| Portal | Purpose | Router pattern |
| --- | --- | --- |
| `frontend/` | Customer storefront | `react-router-dom` routes, navbar + footer layout |
| `admin/` | Admin dashboard / ops portal | `Routes` with permission gating |
| `manufacturer/` | Manufacturer fulfillment portal | `BrowserRouter` + protected layout |
| `marketing/` | Partner campaign portal | `BrowserRouter` + protected route shell |

### Frameworks and styling

- Vite as the build tool for all portals
- React as the UI layer
- Tailwind CSS for layout and utility styling
- `react-toastify` for in-app notifications
- `lucide-react` for icons
- `axios` for API access
- localStorage for token persistence and some client state persistence

### Styling setup

The frontend CSS is defined in `frontend/src/index.css` and uses the following design tokens:

- base colors:
  - `--paper`: `#f8f7f4`
  - `--ink`: `#171717`
  - `--white`: `#ffffff`
  - `--stone`: `#eceae5`
  - `--line`: `#dedbd3`
  - `--muted`: `#6f6d68`
  - `--accent`: `#d85b3f`
- fonts:
  - `DM Sans` for body text
  - `Space Grotesk` for headings / title styling
- layout conventions:
  - neutral paper background
  - compact storefront shell
  - minimal, editorial e-commerce presentation
  - utility-first Tailwind composition with some custom CSS classes like `fashion-shell`, `.eyebrow`, `.announcement-bar`, and `.cart-count`

## 2. Customer Storefront (`frontend/`)

### Core entrypoints

The storefront app is bootstrapped through `frontend/src/App.jsx` and includes routes such as:

| Route | Purpose |
| --- | --- |
| `/` | Home |
| `/shop` | Product collection |
| `/combo-bundles` | Bundle directory |
| `/combo-bundles/:slug` | Single bundle view |
| `/collaborations` | Collaboration directory |
| `/product/:productId` | Product detail |
| `/cart` | Cart overview |
| `/login` | Auth entry |
| `/place-order` | Checkout |
| `/orders` | Customer order history |
| `/profile` | Customer profile |
| `/marketing-cards` | Customer marketing cards |
| `/wishlist` | Wishlist |
| `/verify` | Verification flow |

### Key client state

The store is driven by `frontend/src/context/ShopContext.jsx` and manages:

- `cartItems`
- `products`
- `wishlist`
- `token`
- `search` and `showSearch`
- `shippingConfig`

The cart logic includes stock checks by size and color, quantity validation, localStorage persistence when no token exists, and backend cart sync when a logged-in customer is present.

### Major customer components

The component tree includes:

- `Navbar`
- `SearchBar`
- `Footer`
- `Hero`
- `LatestCollection`
- `BestSeller`
- `CategoryShowcase`
- `ProductItem`
- `RelatedProducts`
- `ReviewSection`
- `NepalMapModal`
- `NewsletterBox`
- `DigitalScratchCard`
- `TermsAndConditionsModal`
- `SponsorAdModal`

### Checkout pricing and NCM status handling

The storefront checkout is designed around server-authoritative pricing rather than local product-price assumptions. `ShopContext`, `Product.jsx`, `Cart.jsx`, and `PlaceOrder.jsx` fetch or verify current location-aware pricing using the customer’s saved address or selected province/district, and they reject stale or invalid quote state before creating an order.

`PlaceOrder.jsx` loads the customer's claimed Own Store discount rewards and eligible VIP loyalty reward in the Offers Available section. The customer may select one reward or none; the total reflects only that selection, and the order request sends the choice and selected card ID for authoritative backend validation. The UI does not stack card and loyalty discounts.

Carrier state labels are also intentionally strict. A failed NCM booking is presented as "Failed to Book Courier" or equivalent failure text instead of the optimistic "Courier Booked" state, and the manufacturer UI uses the same failed-state labels to prevent false-positive booking confirmations.

## 3. Admin Portal (`admin/`)

### App shell

The admin app is structured as a protected workspace with a sidebar layout (`Sidebar`) and an authenticated session check in `Admin/src/App.jsx`. Access to pages is gated by `ADMIN_ROUTE_PERMISSIONS` and `PermissionsContext`.

### Admin routes and modules

The application exposes modules such as:

- `/finance`, `/treasury`, `/assets`, `/partners`, `/expenses`, `/tax`
- `/returns`, `/payables`, `/statements`, `/chart-of-accounts`
- `/journal-entries`, `/general-ledger`, `/trial-balance`, `/fiscal-periods`, `/accounting-health`
- `/add`, `/list`, `/inventory`, `/cogs`, `/special-offers`
- `/create-order`, `/orders`, `/order-assignments`, `/delivery-monitor`
- `/manufacturers`, `/manufacturer-inventory`, `/manufacturer-production`, `/distributor-applications`, `/stock-transfers`, `/marketing-cards`
- `/customers`, `/loyalty-levels`, `/gift-promotions`, `/categories`, `/combo-bundles`, `/collaborations`
- `/reviews`, `/story-letter-library`, `/shipping`
- `/access-control/users`, `/access-control/roles`, `/access-control/permissions`
- `/audit-history`

### Admin UX behavior

- requires a valid admin token and permission set before route access
- uses a local permissions provider to evaluate route access
- centralizes permission guard logic in `admin/src/auth/adminRoutePermissions.js`
- `/audit-history` requires `access:audit_read` and displays paginated actor/action/entity/date/result-filtered system audit records, including authentication and security signals, with before/after diffs and CSV export. Failed/blocked entries are visually distinguished and explicitly described as signals rather than confirmed breaches. Its in-memory query cache is bounded to 20 entries with a 15-second TTL; Refresh clears the cache and reloads the current query.
- an authenticated visit to `/` redirects to `/orders`; unmatched admin paths render a 404 page with a return-to-orders link
- `/marketing-cards` supports Own Store campaign creation, public-to-everyone distribution with an admin-configured per-account campaign scan cap (default one), and separate partner/custom-organization distribution tracking while allowing all Own Store cards to be scanned by signed-in customers without a delivered order; physical stock is assigned to distributors, with batch generation, QR export, and print flows. Customer-order card attachment and delivery handoff validate distributor ownership against the order's `OrderAssignment`, including automatically allocated orders that do not store a direct `Order.distributorId`.
- integrates `react-toastify` for action feedback
- `/gift-promotions` provides responsive sections for a name-based-SKU gift catalog with controlled categories, order-value rules, and distributor stock distribution; route access uses the existing `loyalty:level_manage` permission. Loyalty gift descriptions and value caps are edited directly in `/loyalty-levels`.
- `/returns` includes customer RMA review, NCM attempt/charge details, verified timeout reconciliation, inspection/refund milestones, and supplier-return tools
- the exchange panel supports admin-created cases, replacement-stock tracking, charge allocation, and NCM attempt history
- `/distributor-applications` separates regular distributor sign-up applications from manufacturer requests for distributor access; manufacturer requests are listed from `/api/admin/distributor-applications` and approved or rejected through its review endpoint
- Distributor sign-up uses the manufacturer registration fields for business/contact credentials, province/district, NCM branch and covered area, address, pickup/return details, and contract dates. Admins can edit those stored registration details from each application row; service-district coverage remains editable separately.
- Distributor Management includes a Service-area coverage tab for assigning active distributors province/district coverage. Allocation prefers stocked exact-district hubs, then stocked same-province hubs, then review-ranked nationwide hubs. The customer Orders page lets customers rate the assigned hub after delivery; order allocation still requires every ordered variant and quantity to be available in distributor-ledger stock.

## 4. Manufacturer and Distributor Portal (`manufacturer/`)

The `manufacturer/` app serves separate manufacturer and distributor workspaces,
selected through `activeWorkspace` and protected by backend role permissions.
Factory production and replenishment stay in the manufacturer workspace; hub
inventory, direct hub sales, customer-order fulfillment, gift stock, and
marketing-card stock are distributor-only. Its route list includes:

| Route | Purpose |
| --- | --- |
| `/` | Dashboard |
| `/orders` | Assigned customer-order queue (distributor workspace only) |
| `/orders/:id` | Distributor customer-order fulfillment workflow |
| `/direct-orders` | Distributor direct hub orders (distributor workspace only) |
| `/inventory` | Distributor ledger-backed hub stock (distributor workspace only) |
| `/collaborations` | Collaboration items |
| `/pickup-profile` | NCM pickup settings |
| `/performance` | Production/performance metrics |
| `/finance` | Manufacturer finance data |
| `/customer-loyalty` | Distributor customer loyalty and promotion view |
| `/gift-inventory` | Distributor gift-stock acceptance/rejection and available/reserved quantities |
| `/marketing-cards` | Distributor card receipt and processing |

These hub pages are gated to `activeWorkspace === "DISTRIBUTOR"`; they are not manufacturer features. Distributor order packing displays the assigned catalog gift and requires an explicit inclusion check before the packing transition is accepted. Gift delivery status follows the authoritative NCM webhook rather than a frontend-only success action. Historical manufacturer gift/card/order records remain available in storage but new hub activity uses distributor ownership and backend authorization.

## 5. Marketing Portal (`marketing/`)

The marketing portal is built around a protected dashboard layout and includes the following paths:

| Route | Purpose |
| --- | --- |
| `/login` | Partner login |
| `/signup` | Partner registration |
| `/dashboard` | Overview |
| `/campaigns` | Campaign list |
| `/campaigns/:id` | Campaign detail |
| `/cards` | Card inventory |
| `/cards/:id` | Card detail |
| `/redemptions` | Redemption processing |
| `/qr-validator` | QR validation |
| `/reports` | Campaign reporting |
| `/collaborations` | Collaboration module |
| `/profile` | Partner profile |
| `/settings` | Settings |

This portal is clearly structured around the backend `marketing-cards` router and is meant to be partner-scoped rather than admin-scoped.

## 6. Client-Side State and Flow

### Customer flow

1. Product catalog loads from the backend.
2. `ShopContext` handles cart state and local storage fallback.
3. Checkout uses backend order creation plus shipping/config lookup.
4. Customer marketing-card scans report server-enforced Own Store quotas (five per campaign per calendar week, two per campaign/organization for the campaign lifetime, and the configured campaign lifetime cap per account). Each card is consumable by one successful QR scan only; after scratching/reveal it cannot be scanned again by the same or another account. Own Store code entries and QR scans are tracked, and eligible cards can be claimed on demand.
5. Checkout offers a mutually exclusive selection between one claimed card reward, the active VIP loyalty reward, or no reward.
6. `Orders` page reads customer order history and supports cancellation, return requests, exchange requests with replacement-variant selection, and verified distributor-hub reviews after delivery.
7. Return/exchange requests await admin approval before NCM is called; customers can see carrier failures and recorded charges.
8. Auth tokens are stored in `localStorage` and refreshed through the auth interceptor.

### Admin flow

1. Admin logs in and receives a token.
2. `PermissionsProvider` resolves role permissions.
3. Route access is checked against the route-permission map.
4. Each module calls the backend APIs for product, order, accounting, or access-management actions.

### Manufacturer flow

1. Manufacturer logs in to a dedicated portal.
2. The provider loads manufacturer context and verifies a valid token.
3. Orders, inventory, and pickup configuration are managed via manufacturer-specific pages.
4. The orders page shows a manufacturer-scoped queue of incoming customer returns with pickup state and NCM charge payer.
5. The production pre-check sends `fabricPassed`, `qualitySamplePassed`, and `colorShadeMatched` boolean fields; the API also accepts the prior UI field aliases for compatibility.
6. An approved production request exposes the pre-check; a passed pre-check exposes Start Production; and an in-production request exposes post-production QA and stock intake. The post-check submits one actual count per requested size/color variant using the backend checklist contract.
7. The manufacturer dashboard shows factory products/SKUs and available factory units separately from inspected production and damaged counts. Factory stock does not show as available to customers; that happens only after the distributor receives the transfer.
8. The **Distributor Demands** page only shows admin-approved distributor requests; its sidebar badge refreshes periodically and announces newly approved demands. Manufacturers must save passing checks for availability, quality, color, size, and packaging before delivery controls unlock. They can choose NCM or local freight, while a transfer between the same account's manufacturer/distributor profiles automatically uses direct own-store delivery with NPR 0 freight.

### Marketing partner flow

1. Partner signs in or signs up.
2. Protected routes ensure partner-only access.
3. Campaigns and cards are fetched from backend endpoints and manipulated through partner-specific views.

## 7. UI-specific implementation details

- `react-toastify` is used for action messages and error feedback.
- `localStorage` is used for auth token persistence and some cart/wishlist state.
- `axios` is configured with interceptors for backend auth flows.
- Route-level restrictions are a consistent pattern across the projects.
- Frontend views do not treat client state as the security boundary; the backend remains the source of truth.
