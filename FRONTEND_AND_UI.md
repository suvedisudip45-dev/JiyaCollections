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
- `/manufacturers`, `/manufacturer-inventory`, `/marketing-cards`
- `/customers`, `/loyalty-levels`, `/categories`, `/combo-bundles`, `/collaborations`
- `/reviews`, `/story-letter-library`, `/shipping`
- `/access-control/users`, `/access-control/roles`, `/access-control/permissions`

### Admin UX behavior

- requires a valid admin token and permission set before route access
- uses a local permissions provider to evaluate route access
- centralizes permission guard logic in `admin/src/auth/adminRoutePermissions.js`
- integrates `react-toastify` for action feedback
- `/returns` includes customer RMA review, NCM attempt/charge details, verified timeout reconciliation, inspection/refund milestones, and supplier-return tools
- the exchange panel supports admin-created cases, replacement-stock tracking, charge allocation, and NCM attempt history

## 4. Manufacturer Portal (`manufacturer/`)

The manufacturer app is a separate React app with a protected main layout. Its route list includes:

| Route | Purpose |
| --- | --- |
| `/` | Dashboard |
| `/orders` | Order queue |
| `/orders/:id` | Detailed order workflow |
| `/direct-orders` | Direct manufacturer orders |
| `/inventory` | Stock and fulfillment inventory |
| `/collaborations` | Collaboration items |
| `/pickup-profile` | NCM pickup settings |
| `/performance` | Production/performance metrics |
| `/finance` | Manufacturer finance data |
| `/customer-loyalty` | Customer loyalty and promotion view |
| `/marketing-cards` | Card assignment and processing |

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
4. `Orders` page reads customer order history and supports cancellation, return requests, and exchange requests with replacement-variant selection.
5. Return/exchange requests await admin approval before NCM is called; customers can see carrier failures and recorded charges.
6. Auth tokens are stored in `localStorage` and refreshed through the auth interceptor.

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
