# Admin Portal UI Reference

This is a source-based inventory of the current admin portal for design handoff to Stitch and later UI implementation. It describes the existing routed pages, shared shell, visible controls, and frontend API calls. It is not a proposed redesign or an assertion about backend behavior.

## 1. Portal at a glance

- **Application:** `admin/`, an independent React 18 + Vite application using React Router, Axios, Tailwind CSS, Lucide icons, and React Toastify.
- **Purpose:** internal management of catalog, orders, supply chain, inventory, finance/accounting, marketing, customer programs, and access controls.
- **Authenticated shell:** sticky brand header, collapsible permission-aware sidebar, breadcrumb trail, responsive main content container, and global toast notifications.
- **Currency convention:** UI exports `currency = "Rs "`.
- **Data/API base:** `VITE_BACKEND_URL`; API calls are generally Axios requests to `/api/...`.
- **Permission model:** route access and sidebar visibility are filtered using permissions returned for the authenticated admin. A route is allowed if the user has any permission configured for it; `all:function` bypasses checks. A denied route shows an inline alert, not a redirect.
- **Routes not necessarily shown in the sidebar:** `/change-password`, which is available in the sidebar footer, and parameterized detail routes that reuse their list pages.

## 2. Shared shell and navigation

### Header

- Sticky white header with the Aama Clothings logo and “Admin Management Console” brand.
- Shows the current weekday/month/day on medium screens and wider.
- Shows a round “AD” admin avatar, “Administrator” and “Authenticated” labels on larger screens.
- Logout calls `POST /api/auth/logout` then clears local auth tokens. Header contents are in [`admin/src/components/Navbar.jsx`](./admin/src/components/Navbar.jsx).

### Sidebar

Collapsible section groups with icons, active-route styling, nested links, and per-permission visibility. It is the primary navigation for the workspace.

| Section | Links |
|---|---|
| Access Control | Users, Roles, Permissions, Audit History |
| Catalog & Products | Add Product, Product List, Categories, Combo Bundles, Collaborations, Special Offers |
| Sales & Orders | Customer Orders, Create Direct Order |
| Supply Chain | Order Routing Engine, Delivery & COD Monitor, Manufacturers, Multi-Hub Stock, Production Requests, Distributor Applications, Bulk Stock Transfers |
| Location Pricing | District Rules |
| Marketing Partners | Card Assignment |
| Operations | Inventory & Stock, Inventory Ledger Audit, COGS & Margins, Shipping Rates |
| Finance | Financial Dashboard, Cash & Banks, Assets & Depreciation, Partners & Investors, Expenses & Overhead, 13% VAT & Tax, Returns & Debit Notes, Payables & Receivables, Financial Statements |
| General Ledger | Chart of Accounts, Journal Entries, General Ledger, Trial Balance, Fiscal Periods, Accounting Health |
| Customers & CRM | Customer Profiles, VIP Loyalty Tiers, Gift Promotions, Product Reviews, Story Letter Library |

The sidebar footer holds **Change Password** and a green-dot “Aama Store Active / v2.4 Management” badge. Groups can be expanded/collapsed; a group containing the current route opens automatically. See [`admin/src/components/Sidebar.jsx`](./admin/src/components/Sidebar.jsx).

### Breadcrumbs and page container

- Breadcrumbs start with Home, derive labels from URL segments, and render the last segment as the current page.
- Main content is fluid, padded responsively, capped at `max-w-7xl`, and prevents horizontal overflow at the shell level.
- Breadcrumbs are in [`admin/src/components/Breadcrumbs.jsx`](./admin/src/components/Breadcrumbs.jsx).

### Login, session, permissions

- Login form steps: email/password; optional delivery-method selection (SMS or email); numeric one-time code; expiry countdown; resend cooldown; back/restart actions.
- The auth entry also displays the Aama Clothings/Admin Panel brand and a credential-encryption note.
- Calls: `POST /api/auth/login`, `POST /api/auth/admin/2fa/send`, `POST /api/auth/admin/2fa/verify`, `POST /api/auth/2fa/resend`.
- A stored token causes `GET /api/auth/me`; the shell requires a successful response with an `ADMIN` role. Until then it shows “Checking session…”. Invalid sessions clear auth and return to login.
- A required password change replaces the regular shell content with the password form until completion; success navigates to `/list`.
- Axios attaches auth credentials, attempts token refresh after eligible `401` responses through `POST /api/auth/refresh`, and logout revokes the session. JSON GET responses use a short-lived in-memory cache (10-second TTL, maximum 100 entries).
- Relevant files: [`App.jsx`](./admin/src/App.jsx), [`Login.jsx`](./admin/src/components/Login.jsx), [`authInterceptor.js`](./admin/src/api/authInterceptor.js), [`tokenStorage.js`](./admin/src/auth/tokenStorage.js), [`PermissionsContext.jsx`](./admin/src/auth/PermissionsContext.jsx).

## 3. Page and route inventory

API paths below omit the configured backend origin. `{id}`, `{userId}`, etc. represent dynamic record identifiers. Calls listed are those made by the admin UI; payloads and server-side effects are intentionally not inferred. Route permissions are any-of unless noted otherwise.

### Route-level permissions

The listed permissions gate both the route content and sidebar link; a route with multiple codes accepts any one of them.

| Route | Permission code(s) |
|---|---|
| `/finance` | `finance:dashboard_read` |
| `/treasury` | `finance:treasury_read` |
| `/assets` | `finance:assets_read` |
| `/partners` | `finance:captable_read`, `finance:partnership_read` |
| `/expenses` | `expense:read`, `expense:summary_read` |
| `/tax` | `finance:tax_report_read` |
| `/returns` | `returns:supplier_read`, `returns:customer_read`, `exchange:admin_read` |
| `/payables` | `finance:payables_read` |
| `/statements` | `finance:statements_read`, `accounting:statements_read` |
| `/chart-of-accounts` | `accounting:coa_read` |
| `/journal-entries` | `accounting:journal_read` |
| `/general-ledger` | `accounting:ledger_read` |
| `/trial-balance` | `accounting:trial_balance_read` |
| `/fiscal-periods` | `accounting:fiscal_years_read`, `accounting:period_toggle` |
| `/accounting-health` | `accounting:coa_read`, `accounting:journal_read`, `accounting:subledger_read` |
| `/add` | `product:create` |
| `/list` | `product:list_admin`, `product:create`, `product:update`, `product:delete` |
| `/inventory` | `inventory:admin_read_all` |
| `/cogs` | `cogs:read` |
| `/special-offers` | `offer:list`, `offer:create`, `offer:update` |
| `/create-order`, `/add-order` | `order:admin_create` |
| `/orders`, `/orders/:orderId` | `order:list_admin` |
| `/order-assignments` | `assignment:admin_list` |
| `/delivery-monitor` | `delivery:admin_list`, `delivery:settlements_read`, `delivery:logs_read`, `delivery:ncm_handoff_recover` |
| `/manufacturers`, `/manufacturers/:manufacturerId` | `manufacturer:admin_list` |
| `/location-pricing` | `manufacturer:admin_update`, `product:update` |
| `/manufacturer-inventory` | `inventory:admin_read_all`, `inventory:admin_low_stock` |
| `/manufacturer-production` | `manufacturer:production_admin` |
| `/distributor-applications` | `distributor:admin_list` |
| `/inventory-ledger` | `inventory:ledger_read` |
| `/stock-transfers`, `/stock-transfers/:transferId` | `transfer:admin_read` |
| `/marketing-cards` | `marketing_card:admin_manage`, `marketing_card:own_store_manage`, `marketing_card:custom_assign` |
| `/customers` | `customer:admin_list` |
| `/loyalty-levels`, `/gift-promotions` | `loyalty:level_manage` |
| `/categories` | `category:create`, `category:delete`, `subcategory:create`, `subcategory:update`, `color:create` |
| `/combo-bundles` | `combo_bundle:create`, `combo_bundle:update`, `combo_bundle:delete` |
| `/collaborations` | `collaboration:admin_manage`, `collaboration:admin_reports_read` |
| `/reviews` | `review:admin_list` |
| `/story-letter-library` | `storyletter:admin_manage` |
| `/shipping` | `shipping:config_update` |
| `/access-control/users` | `access:admin_users_read`, `access:marketing_users_read`, `access:manufacturer_users_read`, `access:customer_users_read` |
| `/access-control/roles` | `access:roles_read` |
| `/access-control/permissions` | `access:permissions_read` |
| `/audit-history` | `access:audit_read` |
| `/change-password`, `*` | No route-level permission gate; authentication shell is still required. |

### Catalog, merchandising, and sales

| Route / page | Screen content, components, forms, and actions | API calls |
|---|---|---|
| `/add` — **Add Product** | Product creation form. Product media/gallery and cover selection; English and Nepali names with transliteration; structured description tabs; category/subcategory selection and inline creation; price, discount and low-stock threshold; bestseller, new-in-store, navigation, unisex and published flags; size/color/quantity variants and optional variant/color images. | `GET /api/category/list`, `/api/subcategory/list`, `/api/color/list`; `POST /api/category/add`, `/api/subcategory/add`, `/api/product/add`; transliteration helper: `POST /api/product/transliterate`. |
| `/list` — **Product List** | Catalog list with pagination, search, category/subcategory and bestseller filtering. Product item actions include edit, bestseller toggle, publish toggle, and confirmed delete. Edit form covers names/translations, structured descriptions, category, pricing, flags, variants, and images. | `GET /api/product/list`, `/api/color/list`, `/api/category/list`, `/api/subcategory/list`; `POST /api/product/update`, `/api/product/toggle-bestseller`, `/api/product/toggle-publish`, `/api/product/remove`; transliteration helper: `POST /api/product/transliterate`. |
| `/categories` — **Categories** | Category, subcategory, and color management. Add/edit/remove forms; curated/bestseller subcategory product selection and product-list/toggle controls. | `GET /api/category/list`, `/api/subcategory/list`, `/api/color/list`, `/api/product/list`; `POST /api/category/add`, `/api/category/remove`, `/api/subcategory/add`, `/api/subcategory/update`, `/api/subcategory/remove`, `/api/color/add`, `/api/color/remove`, `/api/product/toggle-bestseller`. |
| `/combo-bundles` — **Combo Bundles** | Bundle list and included products. Create/edit form selects products and category; delete action. | `GET /api/combo-bundles`, `/api/product/list`, `/api/category/list`; `POST /api/combo-bundles`, `PUT /api/combo-bundles/{id}`, `DELETE /api/combo-bundles/{id}`. |
| `/collaborations` — **Collaborations** | Collaboration product assignment and listing state, collaboration options, sales/report view, and partner-fee invoice generation. Includes forms/actions for assigning and managing partner products. | `GET /api/collaborations/admin/products`, `/api/collaborations/admin/options`, `/api/collaborations/admin/report`; `POST /api/collaborations/admin/products`, `/api/collaborations/admin/products/{id}/{action}`, `/api/collaborations/admin/invoices/generate`; `PATCH /api/collaborations/admin/products/{id}/listing`. |
| `/special-offers` — **Special Offers** | Festival/campaign offer cards or list with loading and empty states. Create/edit modal: title, subtitle, badge, date range, discount percentage, products, active state. Product search, select all/clear, and confirmed delete. | `GET /api/offer/list`, `/api/product/list`; `POST /api/offer/create`, `/api/offer/update`, `/api/offer/delete`. |
| `/create-order`, `/add-order` — **Create Direct Order** | Same page at both routes. Direct/social order workflow with customer lookup/verification; channel, social username/code, customer contact/name/email/gender; Nepal delivery location and NCM branch/coverage; street/landmark/notes; product/variant/quantity picker; discount, payment method/paid state, initial status, shipping fee/custom shipping. Product selection modal/search; successful order can lead to shipping-label printing. | `GET /api/category/list`, `/api/shipping/config`, `/api/product/list`, `/api/manufacturer/branches`, `/api/order/admin-customer`; `POST /api/order/admin-customer/verify`, `/api/order/admin-create`. |
| `/orders` — **Orders** | Customer order management. Separate admin-created and website-order sources, status filters, order summaries/cards, multi-select, print courier slips, order-detail navigation, and status/update actions. Empty messages distinguish the two sources. | `GET /api/order/admin-list`, `/api/order/list`, `/api/customer/list`; order update uses the applicable source endpoint (`POST /api/order/admin-list` or `/api/order/list`). Shipping labels may load customer loyalty data via `GET /api/customer/list`. |
| `/orders/:orderId` — **Admin Order Detail** | Detail view exported by `Orders`; order facts and fulfillment context, with customer-return and exchange request panels. Shared return/exchange panels have review/decision actions. | Order data uses the same order APIs as `/orders`. Return panel: `GET /api/returns/customer/admin/requests`, `POST /api/returns/customer/admin/{returnId}/{action}`. Exchange panel: `GET /api/returns/exchange/admin`, `POST /api/returns/exchange/admin/{requestId}/{action}`, `POST /api/returns/exchange/admin`. |

### Operations and supply chain

| Route / page | Screen content, components, forms, and actions | API calls |
|---|---|---|
| `/inventory` — **Inventory & Stock** | Central catalog stock monitor with product stock visibility. | `GET /api/product/list`. |
| `/cogs` — **COGS & Margins** | Manufacturer unit-cost/profit overview and cross-city manufacturing cost comparison. Pending manufacturer price proposals can be accepted or rejected. | `GET /api/cogs/overview`, `/api/cogs/pending-proposals`; `POST /api/cogs/accept-price`, `/api/cogs/reject-price`. |
| `/order-assignments` — **Order Routing Engine** | List of all/unassigned orders, assignment controls, and NCM delivery-request flow with dispatch packaging/quality parameters. | `GET /api/order-assignment/admin/all`, `/api/order-assignment/admin/unassigned`; `POST /api/order-assignment/assign`, `/api/delivery/admin/assignment/{id}/ncm`. |
| `/delivery-monitor` — **Delivery & COD Monitor** | Delivery status and COD settlement monitoring; settlement summary/list; request transfer, confirm remittance, and resolve NCM handoff. Treasury account data supports settlement forms. | `GET /api/order-assignment/admin/all`, `/api/delivery/admin/settlements/summary`, `/api/finance/treasury-accounts`, `/api/delivery/admin/settlements`; `POST /api/delivery/admin/settlements/request`, `/api/delivery/admin/settlements/confirm`, `/api/delivery/admin/{deliveryId}/resolve-ncm-handoff`. |
| `/manufacturers`, `/manufacturers/:manufacturerId` — **Manufacturers** | Manufacturer onboarding/list and profile context. Register/edit manufacturer, manage contract and commission, quality updates, upload contracts, sync branches and ratings. Parameterized route reuses the same page. | `GET /api/manufacturer/admin/list`, `/api/manufacturer/branches`; `POST /api/manufacturer/admin/sync-ratings`, `/api/manufacturer/admin/branches/sync`, `/api/manufacturer/admin/register`, `/api/manufacturer/admin/contract-upload/{id}`; `PUT /api/manufacturer/admin/contract/{id}`, `/api/manufacturer/admin/commission/{id}`, `/api/manufacturer/admin/update/{id}`, `/api/manufacturer/admin/quality/{id}`. |
| `/location-pricing` — **District Rules** | Assign manufacturer service districts and configure place-wise product pricing/discount rules. | `GET /api/admin/manufacturer-locations`, `/api/admin/location-discounts`; `POST /api/admin/manufacturer-locations`, `/api/admin/location-discounts`. |
| `/manufacturer-inventory` — **Multi-Hub Stock** | Manufacturer/distributor hub inventory monitor. | `GET /api/manufacturer-inventory/admin/all`. |
| `/manufacturer-production` — **Production Requests** | Manufacturer production request list with admin review actions. | `GET /api/manufacturer-production/admin/requests`; `POST /api/manufacturer-production/admin/requests/{id}/review`. |
| `/distributor-applications` — **Distributor Applications** | Application review, distributor profile editing, location/coverage setup, rate/incentive configuration, and settlement execution. Branches support selection. | `GET /api/distributor/admin/applications`, `/api/admin/distributor-applications`, `/api/admin/distributor-applications/coverage`, `/api/admin/distributor-rates`, `/api/admin/distributor-finance/settlements`, `/api/manufacturer/branches`; `PATCH /api/distributor/admin/applications/{id}/review`, `/api/admin/distributor-applications/{id}`; `PUT /api/admin/distributor-applications/{id}/profile`, `/api/admin/distributor-applications/{id}/coverage`; `POST /api/admin/distributor-rates`, `/api/admin/distributor-finance/settlements/{id}/execute`. |
| `/inventory-ledger` — **Inventory Ledger Audit** | Inventory ledger audit/reconciliation with available options and reconciliation results. | `GET /api/admin/inventory-ledger/options`, `/api/admin/inventory-ledger/reconciliation`. |
| `/stock-transfers`, `/stock-transfers/:transferId` — **Bulk Stock Transfers** | Transfer review and shipment/NCM resolution controls. Parameterized route reuses the same screen. | `GET /api/stock-transfers/admin`; `PATCH /api/stock-transfers/admin/{id}/review`, `/api/stock-transfers/admin/shipments/{id}/ncm-resolution`; `POST /api/stock-transfers/admin/shipments/{id}/ncm-sync`. |
| `/shipping` — **Shipping Rates** | Configure shared within-district, within-province, and cross-province rates, the flat multi-hub split-shipment fee, optional corridor exceptions, free-delivery threshold, and simulate a shipment by origin/destination. | `GET /api/shipping/config`, `/api/shipping/calculate`; `POST /api/shipping/update`. |

### Finance and accounting

| Route / page | Screen content, forms, and actions | API calls |
|---|---|---|
| `/finance` — **Financial Dashboard** | Executive finance metrics, break-even analysis, asset/net-worth snapshot, and analytics. Month selector and refresh; loading and toast-error feedback. | `GET /api/finance/dashboard?month={month}`. |
| `/treasury` — **Cash & Banks** | Treasury accounts and cash-transaction log; create account, map to ledger account, transfer between accounts, and enter inflow/outflow. | `GET /api/finance/treasury-accounts`, `/api/finance/cash-transactions`, `/api/accounting/chart-of-accounts`; `POST /api/finance/create-account`, `/api/finance/map-treasury-account`, `/api/finance/cash-transfer`. |
| `/assets` — **Assets & Depreciation** | Fixed-asset register; purchase/create asset, run depreciation, and record damage/disposal. Treasury account selection supports asset transactions. | `GET /api/finance/fixed-assets`, `/api/finance/treasury-accounts`; `POST /api/finance/create-asset`, `/api/finance/run-depreciation`, `/api/finance/damage-asset`. |
| `/partners` — **Partners & Investors** | Cap table, ownership/ledger and valuation benchmarks; record investment rounds/debt facilities, issue/transfer/sell shares, distribute profit, review loan schedule, and record repayment. | `GET /api/finance/cap-table-valuation`, `/api/finance/liabilities`, `/api/finance/treasury-accounts`, `/api/finance/loan-schedule/{loanId}`; `POST /api/finance/save-partner`, `/api/finance/issue-new-shares`, `/api/finance/transfer-share`, `/api/finance/update-valuation`, `/api/finance/record-financing`, `/api/finance/repay-liability`, `/api/finance/profit-distribution`. |
| `/expenses` — **Expenses & Overhead** | Expense/income listings and summaries; record direct income, add an expense category, delete an expense. | `GET /api/expense/categories`, `/api/expense/list`, `/api/expense/summary`, `/api/expense/income/list`, `/api/finance/treasury-accounts`; `POST /api/expense/income/add`, `/api/expense/categories/add`, `/api/expense/delete`. |
| `/tax` — **13% VAT & Tax** | Monthly VAT reconciliation and corporate-income-tax projection/advisory content; month selection. | `GET /api/finance/tax-report?month={month}`. |
| `/returns` — **Returns & Debit Notes** | Customer return requests and supplier debit notes; create return/supplier note using product and treasury choices. | `GET /api/returns/customer/list`, `/api/returns/supplier/list`, `/api/product/list`, `/api/finance/treasury-accounts`; `POST /api/returns/customer/create`, `/api/returns/supplier/create`. |
| `/payables` — **Payables & Receivables** | Manufacturer/direct-sales payables and receivables, settlement/cashflow audit, reversals; create/pay/settle payable and create/collect receivable actions. | `GET /api/finance/payables-receivables`, `/api/finance/manufacturer-summary`; `POST /api/finance/create-payable`, `/api/finance/create-receivable`, `/api/finance/settle-payable`, `/api/finance/collect-receivable`, `/api/finance/pay-manufacturer`, `/api/finance/revert-settlement`. |
| `/statements` — **Financial Statements** | Statement/report view with company heading and accounting/finance statement data. | `GET /api/accounting/financial-statements`, `/api/finance/statements`. |
| `/chart-of-accounts` — **Chart of Accounts** | Ledger account list and create/update account form. | `GET /api/accounting/chart-of-accounts`; `POST /api/accounting/create-account`, `/api/accounting/update-account`. |
| `/journal-entries` — **Journal Entries** | Journal list, manual journal form, and reversal form; chart-of-account choices support line entry. | `GET /api/accounting/journal-entries`, `/api/accounting/chart-of-accounts`; `POST /api/accounting/manual-journal`, `/api/accounting/reverse-journal`. |
| `/general-ledger` — **General Ledger** | Account selector and selected account's transaction ledger. | `GET /api/accounting/chart-of-accounts`, `/api/accounting/general-ledger/{accountId}`. |
| `/trial-balance` — **Trial Balance** | Trial balance report. | `GET /api/accounting/trial-balance`. |
| `/fiscal-periods` — **Fiscal Periods** | Fiscal-year and period control; initialize fiscal year and open/close periods. | `GET /api/accounting/fiscal-years`; `POST /api/accounting/create-fiscal-year`, `/api/accounting/toggle-period`. |
| `/accounting-health` — **Accounting Health** | Subledger reconciliation and control comparisons, including trial-balance and balance-sheet checks. | `GET /api/accounting/subledger-reconciliation`, `/api/accounting/trial-balance`, `/api/accounting/financial-statements`. |

### Marketing, customers, and access

| Route / page | Screen content, forms, and actions | API calls |
|---|---|---|
| `/marketing-cards` — **Card Assignment** | Marketing partner/campaign metrics and breakdowns; create partner/campaign; generate and print QR card batches; assign cards to own-store/distributor contexts; approve partners; invalidate cards; campaign-media upload. | `GET /api/marketing-cards/admin/partners`, `/api/marketing-cards/admin/campaigns`, `/api/marketing-cards/admin/metrics`, `/api/marketing-cards/admin/stats`, `/api/marketing-cards/admin/cards`, `/api/admin/distributor-applications/coverage`; `POST /api/marketing-cards/admin/partners`, `/api/marketing-cards/admin/batches`, `/api/marketing-cards/admin/assignments`, `/api/marketing-cards/admin/own-store/assignments`, `/api/marketing-cards/admin/cards/invalidate`, `/api/marketing-cards/admin/campaign-media`; campaign submit: `/api/marketing-cards/admin/campaigns` or `/api/marketing-cards/admin/own-store/campaigns`; `PATCH /api/marketing-cards/admin/partners/{id}/approve`, `/api/marketing-cards/admin/campaigns/{id}/deactivate`. |
| `/customers` — **Customer Profiles** | Searchable, paginated customer list; open customer details; upload or delete customer letters. | `GET /api/customer/list`, `/api/customer/details/{id}`; `POST /api/customer/letter/upload`; `DELETE /api/customer/letter/{letterId}`. |
| `/loyalty-levels` — **VIP Loyalty Tiers** | Loyalty/purchase tier listing and add/delete level actions. | `GET /api/loyalty/levels`; `POST /api/loyalty/level`; `DELETE /api/loyalty/level/{id}`. |
| `/gift-promotions` — **Gift Promotions** | Gift catalog, configured tiers/triggers, hub stock lifecycle and distributor stock assignment. | `GET /api/admin/gifts/catalog`, `/api/admin/gifts/tiers`, `/api/admin/distributor-applications/coverage`; `POST /api/admin/gifts/catalog`, `/api/admin/gifts/tiers`, `/api/admin/gifts/assign-distributor`; `DELETE /api/admin/gifts/catalog/{id}`. |
| `/reviews` — **Product Reviews** | Paginated customer product-review moderation and delete action. | `GET /api/review/admin/list`; `POST /api/review/admin/delete`. |
| `/story-letter-library` — **Story Letter Library** | Story and template libraries; create/edit stories, letters and templates; reorder letters within a story. | `GET /api/admin/story-letter/stories`, `/api/admin/story-letter/templates`, `/api/admin/story-letter/stories/{storyId}/letters`; `POST /api/admin/story-letter/stories`, `/api/admin/story-letter/stories/{storyId}/letters`, `/api/admin/story-letter/templates`; `PATCH /api/admin/story-letter/stories/{storyId}`, `/api/admin/story-letter/story-letters/{letterId}`, `/api/admin/story-letter/templates/{templateId}`, `/api/admin/story-letter/stories/{storyId}/letters/reorder`. |
| `/access-control/users` — **Access Users** | Portal-user list by portal, detail/edit dialog, admin-user creation, role assignment, active-status toggle, and effective-permission inspection. | `GET /api/admin/access/users/{portal}`, `/api/admin/access/users/{portal}/{userId}`, `/api/admin/access/roles`; `POST /api/admin/access/users/admin`; `PATCH /api/admin/access/users/{portal}/{userId}`, `/api/admin/access/users/{portal}/{userId}/status`; `PUT /api/admin/access/users/admin/{userId}/roles`. |
| `/access-control/roles` — **Access Roles** | Roles list, create/edit role, role-permission editor, status toggle. | `GET /api/admin/access/roles`, `/api/admin/access/permissions`, `/api/admin/access/roles/{roleId}`; `POST /api/admin/access/roles`; `PATCH /api/admin/access/roles/{roleId}`, `/api/admin/access/roles/{roleId}/status`; `PUT /api/admin/access/roles/{roleId}/permissions`. |
| `/access-control/permissions` — **Access Permissions** | Read-only permission catalog. | `GET /api/admin/access/permissions`. |
| `/audit-history` — **Audit History** | Filterable audit event table, before/after detail, export action. | `GET /api/admin/access/audit-logs`, `/api/admin/access/audit-logs/export`. |

### Other routes

| Route / page | Content and behavior | API calls |
|---|---|---|
| `/change-password` — **Change Password** | Password change form. If `mustChangePassword` is true, this form is forced in place of normal route content; success navigates to `/list`. | `POST /api/user/admin/change-password`. |
| `*` — **Not Found** | Static “This admin page is not here.” message inside authenticated shell. | None. |

## 4. Shared UI components and interaction patterns

| Component | Current role |
|---|---|
| `Pagination` | Reusable previous/next and up-to-five-page controls; displays “Showing X–Y of Z”; hides if there is no result count or only one page. |
| `ProductImageCarousel` | Reusable product image viewing component. |
| `StructuredDescriptionEditor` | Three tabs: About & Story, Fabric & Care, Size & Fit; character count, section hints, textareas, and Nepali transliteration action. |
| `PrintSheetModal` | Reusable print-sheet modal. |
| `ShippingLabelModal` | One or batch 4×6 label preview/print; sender location form and up to five saved senders in local storage; batch preview navigation. |
| `CustomerReturnRequestsPanel` | Embedded order-detail return request listing and review actions. |
| `ExchangeRequestsPanel` | Embedded order-detail exchange request listing, create/review interactions. |
| `NcmWebhookMockPanel` | Auxiliary NCM webhook mock panel; not a standalone routed page. |
| `Login` | Standalone multi-step login and 2FA form. |
| `Navbar`, `Sidebar`, `Breadcrumbs` | Shared authenticated shell/navigation components. |

Common page-level UI patterns include bordered white cards, compact labels, responsive grids, tables or card lists, status badges, modals, confirmation prompts, loading indicators, empty states, and toast feedback. Specific patterns vary by screen; there is no single standardized empty/error component evidenced across all pages.

## 5. Current visual system (observed, not a redesign prescription)

- **Canvas:** light gray-green `#f3f6f4`; white cards and header.
- **Primary ink:** deep charcoal/green `#172321`; muted text `#6b7975`; divider/border `#dfe7e3`.
- **Accent:** teal `#147d6d`; dark teal `#0d574e`; pale active surface `#e7f2ef`.
- **Typography:** Outfit is the global font; audit-history screens override with DM Sans and Space Grotesk headings.
- **Components:** Tailwind utility classes, subtle borders/shadows, rounded cards/controls, small-label typography, SVG/Lucide-style icons.
- **Compatibility styling:** legacy indigo/blue/purple/cyan backgrounds, text, borders, and buttons are remapped to teal equivalents inside `.admin-shell`.
- **Responsive affordances:** header brand/date/user information is hidden at narrower breakpoints; main content padding scales at `sm`/`lg`; page width is capped and scroll overflow is clipped horizontally at the shell.

Source styling: [`admin/src/index.css`](./admin/src/index.css), [`admin/tailwind.config.js`](./admin/tailwind.config.js).

## 6. Useful notes for the Stitch handoff

1. Ask Stitch for a visual system and page patterns that can accommodate **operational data density**, long tables, filters, multi-step forms, and financial/inventory values—not only marketing-style dashboard cards.
2. Keep a clear distinction between read-only reports, editable configuration, and actions that change order, stock, settlement, or access state. Important actions commonly use modals, confirmation, or toast feedback.
3. Preserve the current information architecture or explicitly return a proposed replacement mapping from each sidebar group and route to the new navigation.
4. Specify responsive treatment for the fixed/sticky header, long permission-filtered sidebar, dense tables, modal forms, and print workflows (courier labels and QR sheets).
5. Treat teal/dark green and the light neutral canvas above as the current baseline only. Stitch can propose alternatives, but the generated guide should state color tokens, type scale, spacing, icon style, card/table/button states, empty/loading/error states, and modal layouts explicitly.
6. For implementation, use the route/page inventory above as the coverage checklist. Do not assume two routes are separate designs when they render the same page component (for example `/add-order` and `/create-order`).

## 7. Scope and accuracy notes

- This inventory is based on the frontend source and its route definitions. It does not describe backend validation, database semantics, or screens in the other portals.
- `/add-order` aliases `/create-order`; parameterized order, manufacturer, and transfer routes reuse corresponding page components.
- `ManufacturerPickupProfile.jsx` exists in the pages folder but is not routed from `App.jsx`, so it is excluded from the route catalog.
- Some screens select endpoint variants dynamically. The paths shown are the concrete frontend paths identifiable from the source; record-specific segments are represented with placeholders.
- The project also has [`FRONTEND_AND_UI.md`](./FRONTEND_AND_UI.md) for broader app documentation; this file is the admin-only Stitch handoff inventory.
