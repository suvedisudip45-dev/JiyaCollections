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

### List pagination and response caching

Bulk APIs accept `page` and `limit` and return pagination metadata; operational list screens request bounded pages and place recently updated records first where supported. Direct detail pages request the record by ID, so links remain valid regardless of which list page contains the record. The admin manufacturer directory and marketing campaign list now also use bounded server-side pagination and search, alongside the admin Orders and Delivery Monitor, admin Stock Transfers, manufacturer Factory Transfers, and distributor inbound-transfer lists.

Admin monitor order details show the initial distributor from the order-allocation audit history and the current distributor from the active assignment record. If the assignment has changed, both are shown; if the initial audit history is unavailable, the UI says so rather than treating the current distributor as the original. A rejected latest assignment is identified as most recently assigned, not as an active assignment.

The Admin Customers screen shows aggregate customer analytics without loading customer identities: total, active, and disabled accounts; customer counts by province and district; weekly, monthly, yearly, and selected-period new-account counts; and the repeat-purchase rate. Purchase transactions group split shipment-order rows by `checkoutGroupId`; the retention metric is customers with more than one non-cancelled transaction divided by customers with at least one. It also reports all-time non-cancelled sales by the province/district in each order's delivery address, distinct purchasers, transaction counts, sales, estimated COGS, recorded NCM delivery charges, and approximate profit. Production overhead for this sales estimate is derived only from overhead amounts attached to sold order-item cost snapshots, summed and divided by that product's all-time non-cancelled units sold, then allocated to locations by units sold. Unsold production/inventory quantities and cost-layer production quantities are not used in this overhead allocation. Profit uses available per-order/accepted product-cost data and excludes unrecorded NCM charges, local distributor delivery costs, refunds/returns, and other operating expenses; treat it as an estimate rather than accounting profit. Customer rows remain search-first: an administrator must search or explicitly apply status, province/district, or account-creation date filters before records load. Search/filter results are server-paginated and ordered by most recent non-cancelled order; rows show location, account creation date, lifetime order value, order count, exchange count, latest order date, and account status. “View details” navigates to `/customers/:customerId`, where the profile, addresses, summary metrics, account disable/re-enable action, and letter archive are presented. Order history opens in its own modal and uses the separately paginated customer-orders endpoint.

All four portals use a bounded in-memory cache for JSON GET responses only (10-second TTL, 100 entries maximum). Keys are scoped by request URL, query parameters, access token and, in the manufacturer portal, active workspace. Successful mutations and auth token changes clear cached responses. Binary downloads bypass this cache. It is browser-memory only, is not shared across tabs/devices, and is intentionally short-lived.

Location-entry forms across the storefront, Admin, and Manufacturer/Distributor portals load province and district choices from `GET /api/lookups/nepal`; active NCM branches and covered areas are also database-backed for workflows that need carrier coverage selection. The API and each portal reuse successful lookup responses for ten minutes. Customer checkout and Admin direct/social order creation use a required free-text street/neighborhood field with a separate NCM branch selector; manufacturer/distributor workflows retain covered-area selectors where operationally required. Lookup failures are shown in affected location selectors rather than silently allowing stale or empty options to appear valid.

Admin direct/social orders can be created without an existing customer's social code. The code is optional verification for linking an existing account and applying eligible loyalty or gift benefits; when skipped, the order uses the details entered for that order and is not linked to the existing customer account.

### Styling setup

The frontend CSS is defined in `frontend/src/index.css` and uses the following design tokens:

- base colors:
  - `--paper`: `#f8f7f4`
  - `--ink`: `#161714`
  - `--white`: `#ffffff`
  - `--stone`: `#eae8e2`
  - `--line`: `#dedbd3`
  - `--muted`: `#6f6d68`
  - `--accent`: `#d85b3f`
- Tailwind also exposes canvas, ink, terracotta, and semantic status text/background/border tokens.
- fonts:
  - `DM Sans` for body text
  - `Space Grotesk` for headings / title styling
- layout conventions:
  - neutral paper background
  - compact storefront shell
  - minimal, editorial e-commerce presentation
  - utility-first Tailwind composition, visible terracotta focus states, reduced-motion support, and reusable classes like `fashion-shell`, `.eyebrow`, `.announcement-bar`, and `.cart-count`

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

Customer, manufacturer, and distributor login screens expose a **Forgot password?** flow. Recovery collects the account email and phone number, which must both match the active account for the selected portal. It shows the masked SMS destination returned by the API, verifies the SMS code, requires matching new-password and confirmation fields, and returns the user to normal sign-in. It does not offer email recovery or automatically log the user in.

### Key client state

The store is driven by `frontend/src/context/ShopContext.jsx` and manages:

- `cartItems`
- `products`
- `wishlist`
- `token`
- `search` and `showSearch`
- `shippingConfig`
- `platformFeatures` (public feature flags fetched from `/api/features`)

The cart logic includes stock checks by size and color, quantity validation, localStorage persistence when no token exists, and backend cart sync when a logged-in customer is present. Cart product IDs are revalidated against the public catalog; valid products are loaded even when outside the initial catalog page, while deleted or unavailable products are removed from guest and authenticated carts.

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

The storefront shell uses shared responsive page and section gutters with a 1440px content cap. Major home sections, category product data, and footer content align to those gutters; category grids, policy highlights, the newsletter form, and footer columns reflow for narrow screens.

Checkout refreshes its shipping quote when the customer changes the delivery province, district, NCM branch, cart, or delivery method. The quote API uses the prioritized active distributors with available distributor-ledger stock. For a same-district/service-zone distributor (including the Kathmandu Valley cluster), checkout offers door-to-door only. For remote routes, checkout offers door-to-door or NCM door-to-hub (customer pickup at the destination branch), each showing its configured fee. If the cart splits across hubs, the quote uses the separately configured split-shipment fee for the selected delivery method once for the checkout group. Checkout shows the applicable delivery tier, fee, and a customer-friendly multiple-package notice without exposing distributor names or internal allocation details. Order creation recalculates availability, delivery method, and fee server-side, creates one independently assigned order per supplying hub, and stores a shared `checkoutGroupId` on those orders; each hub receives only its own item lines and creates its own delivery record. Existing free-shipping and loyalty rules continue to apply. Admin social-order creation previews the likely distributor allocation and offers the same delivery choices; manual delivery-fee override remains available. Shipping Settings exposes independent same-province, cross-province, and split-shipment fees for both delivery methods.

Customer checkout and admin-created direct/social orders collect the customer's street/neighborhood as required free text instead of choosing an NCM covered area. Checkout provides an interactive Nepal map modal using OpenStreetMap/Nominatim; confirming a selected location prefills the street/area and applicable province/district/branch fields while leaving them editable. The Admin direct-order form offers a separate Google Maps search link. The backend strips HTML from the street field, enforces non-empty text and a 255-character limit, and rejects recognizable SQL injection syntax; database writes use Prisma parameterization. The NCM branch remains a separate delivery-routing selection.

The Place Order submit action is disabled and shows a progress indicator during order submission. A synchronous handler guard also prevents repeat submissions before the disabled state renders.

`PlaceOrder.jsx` loads the customer's claimed Own Store discount rewards and eligible VIP loyalty reward in the Offers Available section. The customer may select one reward or none; the total reflects only that selection, and the order request sends the choice and selected card ID for authoritative backend validation. The UI does not stack card and loyalty discounts.

Carrier state labels are also intentionally strict. A failed NCM booking is presented as "Failed to Book Courier" or equivalent failure text instead of the optimistic "Courier Booked" state, and the manufacturer UI uses the same failed-state labels to prevent false-positive booking confirmations.

In the manufacturer portal's distributor workspace, the final order-assignment step offers Self Delivery only when the customer district matches the distributor's own or actively covered district. Selecting Self Delivery or NCM places the packed order on hold instead of dispatching it immediately. Self-Delivery Management presents a paginated table with order/product, customer/destination, payment and COD amount, delivery status, created date, and the expected per-order delivery charge from the distributor's active rate card. Dispatchable orders can be selected and dispatched together; individual results show any orders that need attention. Orders can also be dispatched or progressed individually. After admin approval, self-delivery returns and exchanges are assigned to the original distributor: the distributor receives and inspects returned units, then handles the return accounting or dispatches the replacement from stock reserved at approval and marks it delivered. NCM-delivered returns and exchanges instead use NCM's reverse-pickup/return and replacement-delivery workflow. Held NCM orders appear under NCM Deliveries, where distributors can review order details and submit selected orders together; each order is still booked individually and retains its own NCM result. The NCM page includes on-hold, failed NCM, active booked (excluding delivered orders), delivered, and all-NCM views, with carrier-status filtering for Pickup Order Created, Sent for Pickup, Drop off Order Created, Pickup Complete, Sent for Delivery, Dispatched, In Transit, Arrived, Out for Delivery, Delivered, and Returned in the applicable booked, delivered, and all-order views. Where webhook normalization groups carrier labels, selecting either label matches the same persisted state; the table shows the latest original carrier status when present. A failed NCM submission can be reapplied directly by the distributor without admin review. Likely delivery time is displayed only when an NCM event includes a recognized expected-date field; otherwise the UI states that NCM did not provide one.

For distributor-assigned customer orders, the admin Order Assignments detail
opens the same package-details workflow used by the fulfillment portal
(product/package type, description, delivery instructions, weight, dimensions,
fragile handling, and quality/packaging notes). Admins can request NCM delivery
after package details are complete. Customer-order booking and tracking state
is stored in the backend; NCM webhook updates are applied before acknowledging
the webhook, and admin/distributor/manufacturer views read the persisted status
instead of repeatedly querying NCM. The NCM create request sends the combined
contents and handling summary as `package`, the selected parcel choice as
`package_type`, and fragile status as `handling` (`Fragile` or `Non-Fragile`),
so these values appear in their matching NCM portal fields. NCM delivery
charges are settled by the platform/admin and are not partner payables.
The Admin NCM deliveries table has an all-ages “Needs reconciliation” filter.
Ambiguous or out-of-order provider updates retain the last trusted delivery
status and appear with the carrier status/reason in the details view. Admins can
fetch the current carrier status or explicitly confirm delivered/not delivered;
both decisions require an investigation note. Confirming delivery uses the
normal delivery, inventory, and accounting transaction, while confirming not
delivered preserves the current state and records the decision.

For bulk distributor stock transfers, the manufacturer view shows the end-to-end
transfer stages (demand, admin approval, factory preparation, carrier custody,
and distributor receipt QA) separately from each shipment's NCM carrier
milestones. Every NCM shipment has its own booking outcome, carrier order ID,
carrier-versus-receipt progress, unit QA totals, and expandable event and package
details; failed and uncertain booking attempts are distinguished, and return
requests are offered only for confirmed bookings. Manufacturer and distributor
views show the persisted NCM event timeline in chronological order, while only
admins can explicitly reconcile against the NCM order detail/status APIs.
Manufacturer, admin, and distributor shipment details surface the recent
provider events and last-update time; a stale event remains visible in event
history but cannot rewind the current carrier state or trigger custody movement.
Booking acceptance is shown as booked, not dispatched; manufacturer stock stays
reserved until pickup/custody is confirmed. The manufacturer NCM booking form requires package type, product
type/contents, measured weight, dimensions, and offers delivery instructions,
fragile handling, and packaging notes. The backend stores these details with
the shipment and maps them onto NCM's documented `package`, `instruction`, and
`weight` fields; dimensions and package type are not sent as unsupported fields.
Admins, manufacturers, and distributors can see the saved package details.
The portals also display the NCM route and branch verification state; a
destination matching the active NCM catalog is verified by the backend at
booking, while rejected or unavailable branches remain ineligible.
Carrier delivery is separate from distributor receipt and inspection.
The manufacturer can request a carrier return with a reason. The UI distinguishes
NCM's return request from physical receipt: returned stock remains subject to
the distributor receipt checklist and inspection. NCM charges are identified as
platform/admin settlement, never payable to the manufacturer or distributor.

## 3. Admin Portal (`admin/`)

### App shell

The admin app is structured as a protected workspace with a sidebar layout (`Sidebar`) and an authenticated session check in `Admin/src/App.jsx`. Access to pages is gated by `ADMIN_ROUTE_PERMISSIONS` and `PermissionsContext`.

### Admin routes and modules

The application exposes modules such as:

- `/finance`, `/treasury`, `/assets`, `/partners`, `/expenses`, `/tax`
- `/returns`, `/payables`, `/statements`, `/chart-of-accounts`
- `/returns` includes Admin review of distributor-paid customer refund evidence and the separate treasury payout action for the resulting distributor payable.
- `/distributors/:distributorId` Finance includes a COD receivable/remittance panel with transfer evidence, Admin verification/rejection, and separate refund-payable reporting.
- `/journal-entries`, `/general-ledger`, `/trial-balance`, `/fiscal-periods`, `/accounting-health`
- `/payables` displays distributor settlement requests with the payable balance and lets an authorized Admin make full or partial payment from a selected treasury account.
- `/add`, `/list`, `/inventory`, `/cogs`, `/special-offers`
- `/create-order`, `/orders`, `/product-analytics`, `/order-assignments`, `/delivery-monitor`, `/ncm-deliveries`, `/self-deliveries`, `/ncm-tools`
- `/manufacturers`, `/manufacturer-inventory`, `/manufacturer-production`, `/distributor-applications`, `/stock-transfers`, `/marketing-cards`
- `/customers`, `/loyalty-levels`, `/gift-promotions`, `/categories`, `/combo-bundles`, `/collaborations`
- `/reviews`, `/story-letter-library`, `/shipping`

In Manufacturer Management, admins can edit pickup status and commission in
the profile and Pickup Config views. Pickup status changes can be saved at any
time. Commission edits send a proposal that remains pending until the
manufacturer accepts it; admin edits do not directly change the agreed rate.
- `/platform-features` (requires `platform:features_manage`)
- `/access-control/users`, `/access-control/roles`, `/access-control/permissions`
- `/audit-history`

The `/finance` dashboard adds a period cost breakdown for Product COGS, manufacturer-to-distributor logistics, fixed overhead, marketing, and total operating expenses. Its live-assets snapshot values on-hand stock in platform-owned inventory locations at production-layer cost where available, with product cost as the fallback for uncosted or legacy stock; stock recorded as lost is excluded. The logistics total uses dispatched local MANUAL stock-transfer shipments in the selected month and counts each recorded batch freight charge once, independent of how many units or orders are later sold. Admins can open the logistics details to see dispatch date, transfer, local delivery company, tracking reference, manufacturer/distributor, freight amount, and paid/outstanding amounts. Paid manufacturer LOGISTICS settlements are allocated FIFO by dispatch date, with partial shipment settlements visible. NCM carrier charges and item-level delivery/other snapshots are not included in this category. The financial statement's Account 6430 excludes legacy per-order overhead postings from delivery-sale journals while retaining actual NCM carrier settlements and one-time local stock-transfer freight. Fixed and marketing overhead details show the recorded expense, date, vendor, invoice, payment status, and notes. Product COGS details retain order/product-level quantity, rate, calculation source, and linked cost-layer reference where available. The dashboard API includes itemized `costsAndExpenses.details` alongside the category totals.

Journal entries, general ledger, trial balance, financial statements, and accounting health display a shared delivered-sale posting warning when the backend reports unresolved outbox events. The warning shows pending/processing/failed/blocked counts and a bounded list of order amounts, and explicitly states that those amounts are excluded from posted ledger balances until posting succeeds.

### Admin UX behavior

- requires a valid admin token and permission set before route access
- uses a local permissions provider to evaluate route access
- centralizes permission guard logic in `admin/src/auth/adminRoutePermissions.js`
- `/platform-features` lets authorized admins enable or disable loyalty, marketing cards, and letters. The customer storefront, marketing-partner portal, and distributor portal hide disabled features; backend APIs enforce the same flags.
- `/customers` starts empty and searches only after an admin submits a query. The detail view aggregates orders and delivery/COD, loyalty, cards, letters, returns/exchanges, reviews, and recorded notification history. Account disable/re-enable is separately guarded by `customer:account_manage`.
- `/audit-history` requires `access:audit_read` and displays paginated actor/action/entity/date/result-filtered system audit records, including authentication and security signals, with before/after diffs and CSV export. Failed/blocked entries are visually distinguished and explicitly described as signals rather than confirmed breaches. Its in-memory query cache is bounded to 20 entries with a 15-second TTL; Refresh clears the cache and reloads the current query.
- `/product-analytics` is a separate permission-guarded Sales & Orders page (`product:sales_analytics_read`). It follows the admin portal's compact light analytics layout with a shared period/date control, Overview first, and underlined tabs; only the active Overview, Charts & comparisons, Products & returns, Sales by location, or Product timeline panel mounts. The Overview combines four summary cards with the five leading products from a separate product-list request. Admins can choose vertical bar diagrams or pie charts for product, location, and distributor comparisons; one shared measure selector switches between quantity, revenue, and estimated gross profit, and the same records are not rendered in both chart types at once. The Sales by location panel has its own product selector, defaults to all products unless reached with a selected product, and reports distinct customers and orders for each province/district. Product Timeline has an in-panel product selector and loads the selected product's daily or monthly sales and completed-return history. Chart results are bounded to leading records; detailed product lists are separately paginated, and timeline details load only after selecting a product. Revenue uses order-item price snapshots and excludes delivery; estimated gross profit subtracts recorded historical item COGS and completed refunds but excludes delivery and operating expenses. Reports flag missing cost data. Completed refunds are shown by refund-completion date, while sale location comes from the order's province/district snapshot.
- `/ncm-deliveries` and `/self-deliveries` are distinct compact paginated tables with Kathmandu-local today/week/month/year/all/custom filters. They show only summary fields until a row is opened; NCM detail lazily loads event, return/exchange, financial-settlement, and customer data, while self-delivery detail loads the explicit assignment, distributor location/quality rating, customer order, and return/exchange history. Self-delivery excludes direct distributor phone/walk-in orders and NCM-linked assignments.
- NCM order, branch/rate, staff/customer, label/comment, and support-ticket tools are split into focused tabs on `/ncm-tools`; NCM COD settlement requests use the existing settlement workflow. NCM support lists active and closed tickets from the local database without a carrier request; support and COD tickets are indexed using the scalar `ticket` ID in NCM's create response. Fetching a ticket by ID loads its latest details and records a local summary. Older tickets can be added to the local index by fetching them once by ID. Webhook callbacks are handled by the backend rather than an admin URL control. The supplied carrier docs provide no full date-range NCM order listing or payable/receivable ledger, so the UI does not claim to reconcile carrier-only orders or a complete external financial ledger.
- an authenticated visit to `/` redirects to `/orders`; unmatched admin paths render a 404 page with a return-to-orders link
- `/marketing-cards` supports Own Store campaign creation, public-to-everyone distribution with an admin-configured per-account campaign scan cap (default one), and separate partner/custom-organization distribution tracking while allowing all Own Store cards to be scanned by signed-in customers without a delivered order; physical stock is assigned to distributors, with batch generation, QR export, and print flows. Customer-order card attachment and delivery handoff validate distributor ownership against the order's `OrderAssignment`, including automatically allocated orders that do not store a direct `Order.distributorId`.
- Marketing partner overview/approval UI is isolated in a reusable component. Partner rows link to `/marketing-partners/:partnerId`, a separate detail page with current/expired campaign filters and campaign, distributor, scan-location, and distribution-location tables. The page requests its partner-scoped aggregate payload from a dedicated API module; analytics access is guarded by `marketing_card:analytics_read`. Admin-created partner credentials are removed; public partner signup and admin approval remain.
- integrates `react-toastify` for action feedback
- `/gift-promotions` provides responsive sections for a name-based-SKU gift catalog with controlled categories, order-value rules, and distributor stock distribution; route access uses the existing `loyalty:level_manage` permission. Loyalty gift descriptions and value caps are edited directly in `/loyalty-levels`.
- `/returns` includes customer RMA review, NCM attempt/charge details, verified timeout reconciliation, inspection/refund milestones, and supplier-return tools
- the exchange panel supports admin-created cases, replacement-stock tracking, charge allocation, and NCM attempt history
- `/distributor-applications` separates regular distributor sign-up applications from manufacturer requests for distributor access; manufacturer requests are listed from `/api/admin/distributor-applications` and approved or rejected through its review endpoint
- Manufacturer request rows expose the existing pickup contact, pickup address, NCM branch, and active manufacturer province/district locations for review. Approval provisions those business and pickup details in the distributor profile; distributors can later edit their copied business/contact/location and pickup details from the Distributor workspace's Pickup Profile page.
- Distributor sign-up uses the manufacturer registration fields for business/contact credentials, province/district, NCM branch and covered area, address, pickup/return details, and contract dates. Admins can edit those stored registration details from each application row; service-district coverage remains editable separately.
- `/distributors` is a searchable, server-paginated directory; searches require at least two characters and results are fetched only after submit. Rows include contact/location, account status, assignment count, and latest assignment. “View details” opens `/distributors/:distributorId`, a dedicated page with independent Profile, Finance, Inventory, Stock transfers, Orders & delivery, Returns, Exchanges, and Login history sections. Each section loads only when selected and uses paginated history APIs.
- The profile section edits distributor contact/address/pickup fields through the existing audited profile endpoint and provides an approved general rate-card editor for delivery/return charge, commission, incentive, and VAT values. Linked manufacturer accounts are shown separately with a link to `/manufacturers/:manufacturerId`; their operational records are not merged.
- Inventory shows on-hand/reserved/available quantities plus total retail/cost estimates based on current product prices, labelled as estimates rather than historical cost-layer valuation. Finance separates balances from paginated transaction and settlement-request histories. Delivery history displays assignment status, self-delivery/NCM type, COD, and recent delivery events.
- `/manufacturers` retains the existing searchable directory and opens `/manufacturers/:manufacturerId` for dedicated manufacturer details. Profile, factory ledger inventory, production, distributor transfers, finance, accounting transactions, and payable requests are separate permission-filtered sections; history is paginated and loaded per section. The profile editor reuses the existing update API for business/contact/pickup and contract-date fields, synchronizes linked login email changes, and leaves contract/account status controls to their existing workflow.
- Distributor Management includes a Service-area coverage tab for assigning active distributors province/district coverage. Allocation prefers stocked exact-district hubs, then stocked same-province hubs, then review-ranked nationwide hubs. The customer Orders page lets customers rate the assigned hub after delivery; order allocation still requires every ordered variant and quantity to be available in distributor-ledger stock.
- Distributor Hub Orders retains delivery-queued, courier-booked, and delivered assignments so the distributor can open their details, including saved packaging specifications. After queue handoff or carrier booking, the assignment detail is view-only and backend status updates reject fulfillment edits.

## 4. Manufacturer and Distributor Portal (`manufacturer/`)

The `manufacturer/` app serves separate manufacturer and distributor workspaces,
selected through `activeWorkspace` and protected by backend role permissions.
Factory production and replenishment stay in the manufacturer workspace; hub
inventory, direct hub sales, customer-order fulfillment, gift stock, and
marketing-card stock are distributor-only. Customer loyalty, marketing-card,
and letter links/actions follow the public platform feature configuration.
New database seeds leave these optional features disabled until an admin enables
them; core production, transfer, ordering, and delivery actions remain available.
Turning a flag off does not delete loyalty or personalized-letter history. Its route list includes:

| Route | Purpose |
| --- | --- |
| `/` | Dashboard |
| `/orders` | Assigned customer-order queue (distributor workspace only) |
| `/orders/:id` | Distributor customer-order fulfillment workflow |
| `/distributor/deliveries` | Self-delivery tracking and parcel slip printing |
| `/ncm` | NCM booking/tracking and parcel slip printing |
| `/direct-orders` | Distributor direct hub orders (distributor workspace only) |
| `/inventory` | Distributor ledger-backed hub stock (distributor workspace only) |
| `/distributor/demand` | Factory stock requests, inbound carrier/local transfer tracking, and receipt QA |
| `/collaborations` | Collaboration items |
| `/pickup-profile` | NCM pickup settings |
| `/performance` | Production/performance metrics |
| `/finance` | Manufacturer finance data; distributor delivery earnings plus COD receivable, remittance evidence/status, and separate refund payable |
| `/customer-loyalty` | Distributor customer loyalty and promotion view |
| `/gift-inventory` | Distributor gift-stock acceptance/rejection and available/reserved quantities |
| `/marketing-cards` | Distributor card receipt and processing |

These hub pages are gated to `activeWorkspace === "DISTRIBUTOR"`; they are not manufacturer features. Distributor order packing displays the assigned catalog gift and requires an explicit inclusion check before the packing transition is accepted. Gift delivery status follows the authoritative NCM webhook rather than a frontend-only success action. Historical manufacturer gift/card/order records remain available in storage but new hub activity uses distributor ownership and backend authorization.

Distributor self-delivery and NCM order lists allow selecting orders for a shared compact 80 mm thermal parcel slip. The slip includes recipient and sender contact/location, order and carrier references where available, item variants, quantities, unit and line prices, assigned gifts, totals, and the amount to collect. Print slips separately from dispatch or NCM booking; attach each printed slip to the outside of its parcel. The browser print dialog should use the printer's 80 mm roll setting.

The distributor Finance dashboard keeps COD balances distinct from delivery-service earnings: open company receivable, pending remittance, verified refund payable, and eligibility for an Admin-approved offset are shown separately. The cash panel spans the dashboard width rather than being squeezed into the earnings summary grid. Distributors submit COD transfers with a bank/wallet reference and a JPG/PNG image; Admin verification posts the receipt. Admins can explicitly approve a partial or full offset in distributor detail after reviewing refund evidence; the UI presents the available cap and offset history. The self-delivery return panel requires a JPG/PNG photo of returned goods and lets the distributor submit customer-refund method/reference/image for review. Delivery/refund money flows are not browser-cached because stale financial balances could permit invalid submissions.

The public `GET /api/features` response includes company contact values configured through the backend's `COMPANY_CONTACT_EMAIL` and `COMPANY_CONTACT_PHONE` environment variables. The Manufacturer/Distributor portal displays those values on parcel slips; blank values are omitted.

The distributor demand screen loads the factory catalog separately from inbound
transfer history so a history API error does not hide requestable stock. Its
factory selector lists only active factories with unreserved ledger quantities
for active SKUs on published products; each factory's returned `stock` array is
the SKU variant list used to compose a request. A successfully loaded empty
selector means there is no eligible factory stock in that catalog response,
not that a request can be submitted against legacy-only inventory; catalog
authorization or loading failures are shown separately.

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
6. `Orders` page presents order history in a table with order ID, creation time, product summary, order status, total, payment status, and delivery date. The table has only a View action; order details open in a modal containing tracking, eligible cancellation/return/exchange actions, hub rating, and links to exchange details. Exchange requests have a separate details view with requested/replacement items, status, charges, and event history.
7. Return/exchange requests await admin approval. The Admin panel identifies the original delivery handler: NCM-delivered orders are submitted to NCM, while self-delivered orders are assigned to the original distributor. NCM-specific charge, attempt, and reconciliation controls are shown only on NCM cases; customers can see carrier failures, exchange progress, and recorded charges.
8. Customer tracking follows the actual fulfillment route: NCM orders show carrier tracking, while distributor self-delivery uses the assigned distributor's status and dispatch/on-the-way/delivery timestamps. A completed self-delivery COD order is shown as delivered and collected.
9. Auth tokens are stored in `localStorage` and refreshed through the auth interceptor.

### Admin flow

1. Admin logs in and receives a token.
2. `PermissionsProvider` resolves role permissions.
3. Shipping Rate Settings manage normal customer delivery tiers and four company-paid return/exchange settlement rates; the latter are snapshotted on approval and are not displayed as customer delivery charges.
4. Route access is checked against the route-permission map.
5. Each module calls the backend APIs for product, order, accounting, or access-management actions.

### Manufacturer flow

1. Manufacturer logs in to a dedicated portal.
2. The provider loads manufacturer context and verifies a valid token.
3. Orders, inventory, and pickup configuration are managed via manufacturer-specific pages.
4. The orders page shows a manufacturer-scoped queue of incoming customer returns with pickup state and NCM charge payer.
5. The production pre-check sends `fabricPassed`, `qualitySamplePassed`, and `colorShadeMatched` boolean fields; the API also accepts the prior UI field aliases for compatibility.
6. An approved production request exposes the pre-check; a passed pre-check exposes Start Production; and an in-production request exposes post-production QA and stock intake. The post-check submits one actual count per requested size/color variant using the backend checklist contract.
   The manufacturer production form also records exempt/inclusive/exclusive VAT, rate, and supplier invoice reference. Manufacturer and Admin production screens show unit goods cost before VAT, VAT per unit, total goods cost including VAT, batch other production charges, and whether invoice verification makes VAT recoverable or leaves it in inventory cost. Distributor delivery freight is shown separately on the stock-transfer dispatch and shipment screens; it is not included in production batch charges. Admin review can verify the supplier invoice; only verified VAT becomes input VAT receivable, otherwise it remains in inventory cost. The Admin VAT reconciliation displays posted journal totals rather than recalculating credits from estimated COGS.
7. The manufacturer dashboard shows factory products/SKUs and available factory units separately from inspected production and damaged counts. Factory stock does not show as available to customers; that happens only after the distributor receives the transfer.
8. The **Distributor Demands** page only shows admin-approved distributor requests; its sidebar badge refreshes periodically and announces newly approved demands. Manufacturers must save passing checks for availability, quality, color, size, and packaging before delivery controls unlock. They can choose NCM or local freight, while a transfer between the same account's manufacturer/distributor profiles automatically uses direct own-store delivery with NPR 0 freight.

### Marketing partner flow

1. Partner signs in or signs up.
2. Protected routes ensure partner-only access.
3. Campaigns and cards are fetched from backend endpoints and manipulated through partner-specific views.

### Operational list and detail pattern

Operational queues use compact, responsive tables to show only identifiers, dates,
customer or counterparty, product summary, quantity/value, and current status.
Explicit row actions navigate to dedicated detail routes; state-changing actions
(such as accepting/rejecting an application or recording receipt QA) remain
deliberate and are not triggered just by opening a record. Breadcrumbs appear in
the storefront, admin, manufacturer/distributor, and marketing shells, with parent
links for navigating back to the relevant list. Admin-created and storefront
orders retain separate views, with print/selection controls preserved. Manufacturer
assignment and stock-transfer detail routes retain NCM milestones, preparation
checks, approval/reconciliation controls, and receipt inspection actions.
Marketing campaigns link to their existing detail route, while already table-based
card and redemption lists remain unchanged. Customer-facing order history is not
an operational queue and retains its dedicated tracking/detail experience.

## 7. UI-specific implementation details

- `react-toastify` is used for action messages and error feedback.
- `localStorage` is used for auth token persistence and some cart/wishlist state.
- `axios` is configured with interceptors for backend auth flows.
- Route-level restrictions are a consistent pattern across the projects.
- Frontend views do not treat client state as the security boundary; the backend remains the source of truth.
