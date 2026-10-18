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

- Sticky, translucent-white header with a subtle lower border/shadow and backdrop blur. Left side: mobile-only sidebar toggle, Aama Clothings logo, and brand title/subtitle (“Aama Clothings” / “Admin Management Console”).
- Right side: “Jump to a page” quick-navigation trigger; date pill in Nepal time on medium screens and wider; circular dark-green “AD” avatar and administrator/admin-console labels on small screens and wider; outlined Logout action.
- Quick navigation opens a centered, top-offset dialog with a search field, six permission-filtered quick links, result descriptions and route paths. It opens with Ctrl/Cmd+K, closes with Escape or the close button, submits the first matching option with Enter, and includes a note that record searching is done in page filters.
- Logout revokes the current session, then clears the local authentication token.
- Header contents and exact breakpoint behavior are in [`admin/src/components/Navbar.jsx`](./admin/src/components/Navbar.jsx).

### Sidebar

Collapsible section groups with icons, active-route styling, nested links, and per-permission visibility. It is the primary navigation for the workspace.

| Section | Links |
|---|---|
| Access Control | Users, Roles, Permissions, Audit History |
| Catalog & Products | Add Product, Product List, Categories, Combo Bundles, Collaborations, Special Offers |
| Sales & Orders | Customer Orders, Create Direct Order |
| Logistics & Supply Chain | Order Routing Engine, Delivery & COD Monitor, Manufacturers, Multi-Hub Stock, Production Requests, Distributor Applications, Bulk Stock Transfers |
| Location Pricing | District Rules |
| Marketing Partners | Card Assignment |
| Operations & Costing | Inventory & Stock, Inventory Ledger Audit, COGS & Margins, Shipping Rates |
| Platform Settings | Feature Settings |
| Finance & Banking | Financial Dashboard, Cash & Banks, Assets & Depreciation, Partners & Investors, Expenses & Overhead, 13% VAT & Tax, Returns & Debit Notes, Payables & Receivables, Financial Statements |
| General Ledger | Chart of Accounts, Journal Entries, General Ledger, Trial Balance, Fiscal Periods, Accounting Health |
| Customers & CRM | Customer Profiles, VIP Loyalty Tiers, Gift Promotions, Product Reviews, Story Letter Library |

Section headers are uppercase, compact, letter-spaced, and use line-style icons plus a rotating chevron. Groups expand/collapse; the group containing the current route opens by default. Individual links are hidden when the administrator lacks their route permissions; a group is hidden when none of its required section permissions are present. Active links use a pale brand tint, stronger brand text/icon, subtle shadow and thin ring; inactive links gain a subtle neutral hover background. Child links are indented and grouped by a faint vertical rule. The sidebar scrolls independently and keeps its footer visible, with **Change Password** and an Aama Clothings / Admin workspace identity card. On small screens it opens as a dismissible overlay/drawer and can be closed by navigation or its backdrop. See [`admin/src/components/Sidebar.jsx`](./admin/src/components/Sidebar.jsx).

### Breadcrumbs and page container

- Breadcrumbs start with Home, derive labels from URL segments, and render the last segment as the current page.
- Main content is fluid, padded responsively (`p-4`, then `sm:p-6`, then `lg:p-8`), capped at `max-w-7xl`, and prevents horizontal overflow at the shell level. The authenticated header is 65px high; the content area fills the remaining viewport height.
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
| `/platform-features` | `platform:features_manage` |
| `/access-control/users` | `access:admin_users_read`, `access:marketing_users_read`, `access:manufacturer_users_read`, `access:customer_users_read` |
| `/access-control/roles` | `access:roles_read` |
| `/access-control/permissions` | `access:permissions_read` |
| `/audit-history` | `access:audit_read` |
| `/change-password`, `*` | No route-level permission gate; authentication shell is still required. |

### Catalog, merchandising, and sales

| Route / page | Screen content, components, forms, and actions | API calls |
|---|---|---|
| `/add` — **Add Product** | Product creation form. Product media/gallery and cover selection; English and Nepali names with transliteration; structured description tabs; category/subcategory selection and inline creation; price, discount and low-stock threshold; bestseller, new-in-store, navigation, unisex and published flags; size/color/quantity variants and optional variant/color images. While product creation is in progress, the submit button is disabled and shows a progress state to prevent duplicate submissions. | `GET /api/category/list`, `/api/subcategory/list`, `/api/color/list`; `POST /api/category/add`, `/api/subcategory/add`, `/api/product/add`; transliteration helper: `POST /api/product/transliterate`. |
| `/list` — **Product List** | Catalog list with pagination, search, category/subcategory and bestseller filtering. Product item actions include edit, bestseller toggle, publish toggle, and confirmed delete. Edit form covers names/translations, structured descriptions, category, pricing, flags, variants, and images. | `GET /api/product/list`, `/api/color/list`, `/api/category/list`, `/api/subcategory/list`; `POST /api/product/update`, `/api/product/toggle-bestseller`, `/api/product/toggle-publish`, `/api/product/remove`; transliteration helper: `POST /api/product/transliterate`. |
| `/categories` — **Categories** | Category, subcategory, and color management. Add/edit/remove forms; curated/bestseller subcategory product selection and product-list/toggle controls. | `GET /api/category/list`, `/api/subcategory/list`, `/api/color/list`, `/api/product/list`; `POST /api/category/add`, `/api/category/remove`, `/api/subcategory/add`, `/api/subcategory/update`, `/api/subcategory/remove`, `/api/color/add`, `/api/color/remove`, `/api/product/toggle-bestseller`. |
| `/combo-bundles` — **Combo Bundles** | Bundle list and included products. Create/edit form selects products and category; delete action. | `GET /api/combo-bundles`, `/api/product/list`, `/api/category/list`; `POST /api/combo-bundles`, `PUT /api/combo-bundles/{id}`, `DELETE /api/combo-bundles/{id}`. |
| `/collaborations` — **Collaborations** | Collaboration product assignment and listing state, collaboration options, sales/report view, and partner-fee invoice generation. Includes forms/actions for assigning and managing partner products. | `GET /api/collaborations/admin/products`, `/api/collaborations/admin/options`, `/api/collaborations/admin/report`; `POST /api/collaborations/admin/products`, `/api/collaborations/admin/products/{id}/{action}`, `/api/collaborations/admin/invoices/generate`; `PATCH /api/collaborations/admin/products/{id}/listing`. |
| `/special-offers` — **Special Offers** | Festival/campaign offer cards or list with loading and empty states. Create/edit modal: title, subtitle, badge, date range, discount percentage, products, active state. Product search, select all/clear, and confirmed delete. | `GET /api/offer/list`, `/api/product/list`; `POST /api/offer/create`, `/api/offer/update`, `/api/offer/delete`. |
| `/create-order`, `/add-order` — **Create Direct Order** | Same page at both routes. Direct/social order workflow with customer lookup/verification; channel, social username/code, customer contact/name/email/gender; Nepal delivery location and NCM branch; required free-text customer street/neighborhood, landmark and notes; contextual Google Maps search link using the address and selected location; product/variant/quantity picker; discount, payment method/paid state, initial status, shipping fee/custom shipping. Street text is not restricted to an NCM coverage catalog. Product selection modal/search; successful order can lead to shipping-label printing. | `GET /api/category/list`, `/api/shipping/config`, `/api/product/list`, `/api/manufacturer/branches`, `/api/order/admin-customer`; `POST /api/order/admin-customer/verify`, `/api/order/admin-create`. |
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
| `/customers` — **Customer Profiles / Customer 360** | Customer analytics show total, active, and disabled accounts; province/district counts; weekly/monthly/yearly and selected-period new customer totals; and repeat-purchase rate (customers with 2+ non-cancelled purchase transactions divided by purchasers). Split shipment orders sharing a checkout group count as one transaction. All-time province/district sales based on each order's delivery address show customer and transaction counts, sales, estimated COGS, recorded NCM delivery charges, and approximate profit. Production overhead for the estimate comes only from overhead recorded on sold order-item cost snapshots, divided by that product's all-time non-cancelled units sold and allocated by geographic units sold; unsold inventory and production quantity in cost layers are excluded. Profit is an estimate, excluding local distributor delivery costs where not recorded, unrecorded carrier charges, returns/refunds, and other operating expenses. Customer identities remain search-first: load paginated records only after a search or explicit status, province/district, or account-creation date filter. Rows show location, join date, lifetime order value, order count, exchange count, latest order date, and account status. “View details” opens the customer detail page with identity/contact/addresses, account status and disable reason, purchase totals/frequency, order items and status, both NCM and distributor fulfillment/COD details and delivery events, loyalty, card assignments/rewards, letters, returns/exchanges and their events, product/distributor reviews, and recorded notification activity. Letter upload/delete remain available from the profile. Disable/re-enable is permission-gated by `customer:account_manage`; disabling prompts for a reason, while re-enabling asks for confirmation. | `GET /api/customer/admin/analytics`; `GET /api/customer/admin/search?search={query}&status={active|disabled}&province={province}&district={district}&period={all|week|month|year|date|range}&date={YYYY-MM-DD}&from={YYYY-MM-DD}&to={YYYY-MM-DD}&page={page}&limit={limit}`, `/api/customer/details/{id}`; `POST /api/customer/letter/upload`; `DELETE /api/customer/letter/{letterId}`; account status: `PATCH /api/customer/admin/{id}/status`. |
| `/loyalty-levels` — **VIP Loyalty Tiers** | Loyalty/purchase tier listing and add/delete level actions. | `GET /api/loyalty/levels`; `POST /api/loyalty/level`; `DELETE /api/loyalty/level/{id}`. |
| `/gift-promotions` — **Gift Promotions** | Gift catalog, configured tiers/triggers, hub stock lifecycle and distributor stock assignment. | `GET /api/admin/gifts/catalog`, `/api/admin/gifts/tiers`, `/api/admin/distributor-applications/coverage`; `POST /api/admin/gifts/catalog`, `/api/admin/gifts/tiers`, `/api/admin/gifts/assign-distributor`; `DELETE /api/admin/gifts/catalog/{id}`. |
| `/reviews` — **Product Reviews** | Paginated customer product-review moderation and delete action. | `GET /api/review/admin/list`; `POST /api/review/admin/delete`. |
| `/story-letter-library` — **Story Letter Library** | Story and template libraries; create/edit stories, letters and templates; reorder letters within a story. | `GET /api/admin/story-letter/stories`, `/api/admin/story-letter/templates`, `/api/admin/story-letter/stories/{storyId}/letters`; `POST /api/admin/story-letter/stories`, `/api/admin/story-letter/stories/{storyId}/letters`, `/api/admin/story-letter/templates`; `PATCH /api/admin/story-letter/stories/{storyId}`, `/api/admin/story-letter/story-letters/{letterId}`, `/api/admin/story-letter/templates/{templateId}`, `/api/admin/story-letter/stories/{storyId}/letters/reorder`. |
| `/access-control/users` — **Access Users** | Portal-user list by portal, detail/edit dialog, admin-user creation, role assignment, active-status toggle, and effective-permission inspection. | `GET /api/admin/access/users/{portal}`, `/api/admin/access/users/{portal}/{userId}`, `/api/admin/access/roles`; `POST /api/admin/access/users/admin`; `PATCH /api/admin/access/users/{portal}/{userId}`, `/api/admin/access/users/{portal}/{userId}/status`; `PUT /api/admin/access/users/admin/{userId}/roles`. |
| `/access-control/roles` — **Access Roles** | Roles list, create/edit role, role-permission editor, status toggle. | `GET /api/admin/access/roles`, `/api/admin/access/permissions`, `/api/admin/access/roles/{roleId}`; `POST /api/admin/access/roles`; `PATCH /api/admin/access/roles/{roleId}`, `/api/admin/access/roles/{roleId}/status`; `PUT /api/admin/access/roles/{roleId}/permissions`. |
| `/access-control/permissions` — **Access Permissions** | Read-only permission catalog. | `GET /api/admin/access/permissions`. |
| `/audit-history` — **Audit History** | Filterable audit event table, before/after detail, export action. | `GET /api/admin/access/audit-logs`, `/api/admin/access/audit-logs/export`. |
| `/platform-features` — **Feature Settings** | Three optional feature rows—Customer loyalty, Marketing cards, and Customer letters—with a description, right-aligned on/off switch, and a single Save feature settings action. Loading and load-error states are explicit. | `GET /api/features`; `PATCH /api/features`. |

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
| `Customer360Panel` | CRM detail presentation for account/address, purchase metrics, orders and delivery/COD events, product/reviews, returns/exchanges, and account status controls. |
| `Login` | Standalone multi-step login and 2FA form. |
| `Navbar`, `Sidebar`, `Breadcrumbs` | Shared authenticated shell/navigation components. |

The page component inventory is in [`admin/src/pages/`](./admin/src/pages/) and shared controls are in [`admin/src/components/`](./admin/src/components/). Individual screens also contain page-specific dialogs, forms, tables, filters, and confirmation prompts; they are summarized in the route table rather than being a single globally shared modal system.

Common page-level UI patterns include bordered white cards, compact labels, responsive grids, tables or card lists, status badges, modals, confirmation prompts, loading indicators, empty states, and toast feedback. Specific patterns vary by screen; there is no single standardized empty/error component evidenced across all pages.

## 5. Current visual system (observed, not a redesign prescription)

The portal has a light, neutral base with a green-teal brand accent. The palette below is read from the design tokens in [`admin/tailwind.config.js`](./admin/tailwind.config.js) and [`admin/src/index.css`](./admin/src/index.css); some older page-level components still use legacy gray/indigo/purple classes, so the current screens are not perfectly uniform.

| Token | Current value | Current use |
|---|---|---|
| Brand 50 | `#f0f9f7` | Very pale brand hover/fill |
| Brand 100 | `#d9f1eb` | Soft icon/backplate fill |
| Brand 200 | `#b3e3d7` | Brand border and hover outline |
| Brand 300 | `#7fcebf` | Mid-light brand state |
| Brand 400 | `#43b3a0` | Mid brand state |
| Brand 500 | `#0d7a68` | Main accent and primary action |
| Brand 600 | `#0b6657` | Hover/darker primary action |
| Brand 700 | `#084e42` | Strong active text/icon |
| Brand 800 | `#063b32` | Deep brand shade |
| Brand 900 | `#042721` | Header avatar/backplate |
| Canvas / surface base | `#f8fafc` | App background |
| Surface card | `#ffffff` | Cards, header, dialogs |
| Surface subtle | `#f1f5f9` | Neutral hover and soft fill |
| Surface tint | `#effcf9` | Brand-tinted interaction surface |
| Ink primary | `#0f172a` | Main titles and high-emphasis text |
| Ink secondary | `#334155` | Body copy and secondary actions |
| Ink muted | `#64748b` | Labels, helper text, timestamps |
| Ink subtle | `#94a3b8` | Placeholder, low emphasis, inactive icons |
| Border light | `#e2e8f0` | Standard card, control, table, and shell borders |
| Border subtle | `#f1f5f9` | Low-emphasis separators |
| Border brand | `#b3e3d7` | Active/hover brand edge |
| Ledger debit | `#0369a1` | Debit values |
| Ledger credit | `#0f766e` | Credit values |
| Ledger balanced | `#15803d` | Balanced/healthy state |
| Ledger unbalanced | `#b91c1c` | Unbalanced/error state |

- **Type:** Outfit is the global sans-serif. JetBrains Mono is configured for monospaced/numeric data, and Space Grotesk is configured as a display face. Audit History has a local DM Sans override and Space Grotesk headings.
- **Shape and depth:** common controls use about 8px corners (`rounded-lg`); cards/dialogs often use 12–16px corners. Borders are subtle. Shadows are restrained: subtle 1px elevation on cards, stronger elevation on dialogs/menus.
- **Icons:** thin, mostly 1.8px outline SVG icons in the sidebar; Lucide outline icons appear in the navbar and newer UI. Small icon size is typically 14–16px, with 16–20px in larger controls.
- **Density:** most pages use compact 10–13px labels and table text, bold section/page titles, compact cards and responsive grids. Financial values frequently use tabular numerals/monospace.
- **Accessibility:** form controls have rounded borders and brand-colored focus outlines; keyboard focus uses a 2px visible outline with offset. Checkbox/radio accents use the brand color. Reduced-motion preferences reduce transitions and animations.
- **Legacy variation:** `.admin-shell` overrides some slate/indigo/blue primary button classes to the brand teal, but does not globally normalize all legacy backgrounds, text, borders, gradients, badges, or focus treatments. The Customers page and Customer 360 panel still contain indigo/purple accents. Treat those as inconsistencies to reconcile, not as canonical brand tokens.
- **Responsive behavior observed:** navbar hides date below `md` and hides user identity below `sm`; its sidebar button appears below `sm`. Main padding scales from 16px to 24px to 32px. The page shell clips horizontal overflow, so wide tables should get their own horizontal scroll area rather than widening the viewport.

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

## 8. Stitch-ready UI enhancement brief

The following is a handoff brief for generating an improved admin UI. It combines confirmed product requirements with visual recommendations. It is not a claim that all listed design treatments already exist.

### Product and audience

Design a polished, dependable back-office console for Aama Clothings, a Nepal-based clothing e-commerce business. Primary users are administrators handling orders, fulfillment, catalog, distributors/manufacturers, inventory, finance, customer care, marketing, and role-based access. Prioritize rapid scanning, low-error operational actions, dense but readable data, and traceable status. This is an operational tool, not a customer storefront or marketing landing page.

### Design outcomes

1. Make the next action and current status obvious without hiding useful context.
2. Use consistent page headers, filters, tables, forms, detail panels, dialogs, status chips, and feedback states across all modules.
3. Keep high-risk actions visually distinct, show consequences and record context before confirmation, and never use color alone to convey status.
4. Keep information architecture and all current page capabilities. Do not remove data fields, workflows, role gates, status steps, NCM/self-delivery distinction, print flows, or accounting records while redesigning.
5. Do not automatically load customer lists on the CRM page. Customer information must remain search-first.
6. Use Nepal context: `Rs` currency, Nepal provinces/districts, NPT timestamps, and clear English labels (preserve Nepali fields and text as data rather than translating or removing them).

### Recommended visual direction

- A calm, restrained retail-operations aesthetic: warm-white cards on a very light slate canvas, deep navy/slate text, and the existing emerald-teal brand accent. Keep the current palette as the starting point; do not introduce multiple competing accent colors.
- Use color for meaning: green for success/paid/active, amber for pending/attention, red for failed/destructive/overdue, blue only for informational or delivery states where it is already semantically appropriate. Pair each color with text/icon and accessible contrast.
- Prefer clear typographic hierarchy over oversized dashboard decoration. Use Outfit for interface text, Space Grotesk for occasional page/display headings, and JetBrains Mono only for IDs, codes, and aligned numeric values.
- Use fine borders, very soft shadows, modest radii, and generous spacing around sections; retain compact row height and tabular density for operational lists.
- Avoid gradients, large empty hero areas, excessive decorative charts, emoji as primary icons, and bright saturated purple/indigo accents.

### Suggested design tokens for Stitch output

These are a normalization target based on existing tokens, not additional application configuration:

| Role | Suggested token |
|---|---|
| App canvas | `#f8fafc` |
| Surface / cards / dialogs | `#ffffff` |
| Soft neutral surface | `#f1f5f9` |
| Brand tint | `#effcf9` |
| Main text | `#0f172a` |
| Secondary text | `#334155` |
| Muted/help text | `#64748b` |
| Placeholder/disabled text | `#94a3b8` |
| Default border | `#e2e8f0` |
| Brand / primary action | `#0d7a68` |
| Primary hover | `#0b6657` |
| Active text/icon | `#084e42` |
| Success | `#15803d` with pale green surface |
| Warning | `#b45309` with pale amber surface |
| Error/destructive | `#b91c1c` with pale red surface |
| Info | `#0369a1` with pale blue surface |

Use an 8px spacing rhythm. Suggested scale: 4px icon gaps/tight label offset; 8px inside compact controls; 12–16px card gutters; 20–24px between page sections; 28–32px on wide page edges. Use 8px control radius, 12px card radius, 16px dialog radius. Ensure body text remains comfortably legible (target 14px minimum for primary content; compact table metadata may be 12–13px, never below 11px).

### Global application shell

**Desktop composition**

- Keep a 65px sticky top bar across the viewport.
- Under the bar, use a fixed-width, independently scrollable left navigation column (recommend about 260–280px on desktop) and a flexible content region. The page content should remain centered with a maximum width similar to the current `max-w-7xl`.
- Keep the navbar and sidebar visually quiet so page content stays primary. Use a fine border between regions and no heavy dark blocks.
- Keep breadcrumbs above the page heading, and make their current-page state non-clickable.
- Within the content region, consistently use: breadcrumb → page title and concise helper text → right-aligned primary action (when relevant) → page-level filters/tabs → summary cards (when useful) → table/content → pagination.

**Tablet/mobile composition**

- Collapse the sidebar into a modal drawer below the desktop breakpoint; include a visible close affordance and ensure navigation closes it.
- Keep logo compact, quick navigation available as a search icon/button, hide the date and admin label before they crowd the header, retain logout as an icon with accessible label.
- Use a single-column stack for page heading/actions, filters, and summary cards. On mobile, filters should wrap or use a clearly labeled filter sheet; do not compress multiple inputs into unreadable narrow columns.
- Keep tables readable with sticky first column or horizontal scroll inside the table container. Avoid global page-width overflow.
- Dialogs become near-full-screen sheets with a sticky title/action area, scrollable content, and safe-area margins.

**Top navigation details**

- Left: hamburger (mobile), brand logo, “Aama Clothings”, “Admin Management Console”.
- Right: global quick-jump search with `Ctrl/Cmd + K` hint on larger screens; localized date display marked NPT; administrator avatar/name; Logout.
- Global quick jump is navigation only; it does not replace each page's record search.
- Keyboard behavior must be included: open quick jump with Ctrl/Cmd+K, focus input, Escape closes, Enter opens the first match, clicking the backdrop closes.

**Sidebar details**

- Preserve the permission-filtered groups and nested routes from the inventory above. Do not make an inaccessible page discoverable through the sidebar or quick jump.
- Section labels: small uppercase and letter-spaced; section icon at left, chevron at right. Active group expands automatically.
- Links: one-line labels with 16px outline icons, consistent hit-area height, active pale teal fill and left-edge/ring cue. Keep keyboard focus distinct from active state.
- Keep sidebar scrolling separate from a sticky footer containing Change Password and workspace identity. Do not use a fake “store active” indicator unless it reflects real application status; the current footer is a workspace identity card.

### Page-level components

**Page heading**
- H1, concise plain-language description, optional small module icon.
- Primary action in the header row (e.g. Add Product, Create Order, Add Account). Secondary actions use neutral outlined styling.
- If there are important totals, place a small row of 3–5 metric cards below the heading; do not repeat metrics already obvious in the table.

**Filters and search**
- Place search and filters in a compact toolbar above results. Use visible labels or accessible labels, clear current selections, and a Reset/Clear control only when filters are active.
- Distinguish global page search from table column sorting. Use debounced text search only where current behavior supports it; keep submit-based CRM search explicit.
- On narrow screens, collapse advanced filters into a filter panel with active-filter count and apply/reset buttons.

**Tables and record lists**
- Use a distinct light-neutral header row with concise uppercase or title-case column labels, consistent cell padding, and subtle row dividers.
- Align amounts and quantities consistently; use tabular numerals and `Rs` formatting. Use monospace for long order IDs, references, tracking codes, and transaction numbers.
- Preserve existing sortable/filterable/paginated behavior. Keep pagination count/range, current page, previous/next, and disabled states visible when relevant.
- Use a compact action column with labeled icon buttons or a small menu. Keep destructive actions away from routine navigation actions.
- For mobile, provide row cards or a controlled horizontal scroll container with the customer/order/entity identity visible first.

**Status chips**
- Use a consistent pill geometry, 11–12px semibold text, and optional small dot/icon. Provide distinct tokens for active/inactive, pending/on hold, processing, booked/dispatched, delivered/completed, failed/rejected/cancelled, paid/unpaid/COD pending, and balanced/unbalanced.
- Preserve exact domain status text from the system; do not flatten NCM delivery states into generic order states or conflate distributor self-delivery with NCM.
- Include textual label and accessible contrast; no status must be color-only.

**Cards, forms, and data density**
- Cards use white background, 1px neutral border, 12px corners, and soft shadow only when elevated above a page surface.
- Form fields have persistent labels, optional helper text, clear required markers, and inline validation. Group related fields; avoid long ungrouped forms.
- Use section headers, two-column desktop form grids, and one-column mobile forms. For long forms, use logical steps or sticky action bars rather than shrinking labels.
- Destructive/irreversible controls use red styling and explicit confirmation. Save/cancel controls remain consistent across edit forms.

**Dialogs, drawers, and overlays**
- Centered dialog for quick confirmation or short form; side drawer for long record details where keeping list context is useful; full-width/full-screen sheet on small devices.
- Backdrop should dim the app (about 40% dark overlay) without obscuring dialog. Dialogs have title, short description, close button, scrollable body, and action footer.
- Keep primary action at lower right, secondary/cancel adjacent, destructive action separated visually. Disable actions and show progress while saving; prevent accidental double submits.
- Confirm the record/amount/action in the dialog title/body for consequential operations (order update, return/exchange decision, transfer, settlement, account disable, deletion).
- Existing quick-jump dialog is a 12vh top-offset, max-width about 576px, white rounded panel with a 56px input header, scrollable result list, and keyboard/help footer. Retain this compact command-palette feel.

**Loading, empty, error, and success feedback**
- Loading: preserve page layout with skeleton rows/cards or a small inline spinner; never show a blank white page for a normal fetch.
- Empty: explain why there are no rows and suggest the next valid action (search/filter/create) without showing misleading zero metrics before a search.
- Error: show a clear inline message with retry where possible, and retain the page context. Toasts are supplemental—not the only place to expose a blocking failure.
- Success: use a brief toast plus updated visible state. For high-impact operations, show a persistent audit-relevant status or confirmation in the record view.
- Preserve accessible focus indicators, keyboard order, dialog focus handling, and reduced-motion behavior.

**Print and upload workflows**
- Print sheets and shipping labels need print-optimized previews, correct paper/label dimensions, and controls that are not printed. Show current item/count and previous/next for batches.
- Upload dialogs should show accepted type/size guidance, selected file name, preview where relevant, progress, success/failure, and remove/replace action. Avoid presenting fake upload progress.

### Module-specific screen treatments

Use the page inventory in Section 3 as the exhaustive route checklist. These patterns explain how Stitch should compose the major workspaces without changing their function:

1. **Orders and order detail:** start with clear order source/status filters and compact totals; show customer/order identity, created date, line-item count, total/payment status, fulfillment channel and current stage. Batch actions such as printing need a selected-count state and clear select-all behavior. Order detail should group customer/address, product lines, payment, assignment, delivery timeline, NCM/COD or self-delivery, and return/exchange requests; keep status updates and irreversible actions clearly separate.
2. **Create direct order:** use a guided vertical workflow or well-labeled sections: customer lookup/verification → customer and delivery address → location/NCM coverage → product/variant/quantity → discounts/payment/shipping → review/create. Product selection should be searchable, include thumbnails and variant stock context, and show a selected-items summary. Keep shipping fee and custom shipping editable only where current permission/behavior allows.
3. **Catalog/product management:** give product imagery a dedicated upload/gallery area; separate bilingual identity, structured description sections, category, pricing, publication/merchandising flags, and size/color variants. Reuse the three structured-description tabs and transliteration affordance. Show the product list in table/card modes with a compact thumbnail, searchable filters, and visibly distinct publish/bestseller states.
4. **Logistics, routing, inventory, transfers:** emphasize current workflow state and location/hub context. Use timeline/stepper visuals for order handoff and delivery; distinguish delivery partner (NCM vs distributor) and COD settlement. Inventory views should show SKU/variant, location, available quantity and movement context without replacing ledger data with decorative totals. Bulk transfer selection must show selected count, destination, status, and review/dispatch actions.
5. **Shipping rates/location pricing:** make the configuration understandable through grouped rate tiers, current values, a clear save action, and a shipment simulation panel with origin/destination and an itemized calculation result. Explain rule precedence visually; avoid a giant district-by-district manual price matrix.
6. **Finance/accounting:** prioritize accurate figures, period selectors, account filters, debit/credit separation, balanced states, and printable/exportable reports. Use right-aligned tabular amounts; separate dashboard metrics from transaction-level tables. Reversal, settlement, payment, and period-close actions require context-rich confirmation.
7. **Customers & CRM:** keep the landing state intentionally empty of personal records until an admin searches. Show a privacy-conscious empty state with search instructions; require at least two characters. Search result rows should identify customer and summarize loyalty, spend, orders, and letters. Customer 360 should be a responsive modal/drawer with a compact profile header, enabled/disabled status, key lifetime metrics, then clearly separated sections or tabs for account/addresses, orders and delivery/COD, items/reviews, loyalty/cards/rewards, letters, returns/exchanges, and notifications. Long histories should have internal scrolling and collapsible sections; avoid a single unstructured wall of text. Keep disable/re-enable controls permission-gated and confirmation-based.
8. **Access control:** use dedicated list, detail, and edit surfaces. Role-permission management needs a searchable grouped permission tree, selected count, select-all within group, and clear save/cancel state. Display effective permissions readably and make account activation/deactivation confirmations explicit.
9. **Marketing, loyalty, letters, offers:** use image/QR previews only when they aid action. Campaign and card tables should distinguish partner, campaign, inventory/assignment state, and performance. Story-letter content editing needs a clear library hierarchy and preview. Gift/loyalty configuration should distinguish eligibility rules from item stock assignment.
10. **Applications and review queues:** expose review status, applicant identity, location/coverage, and supporting documents in a consistent review panel. Provide approve/reject or update actions in a contextual dialog with a reason field where present.

### Page/route preservation checklist

Stitch should create a coherent pattern set that can cover **all routes in Section 3**, not only `/finance` or `/orders`. The current top-level navigation contains Access Control, Catalog & Products, Sales & Orders, Logistics & Supply Chain, Location Pricing, Marketing Partners, Operations & Costing, Platform Settings, Finance & Banking, General Ledger, and Customers & CRM. Preserve permission-aware visibility. Include templates for:

- searchable and paginated data lists;
- filterable review queues;
- create/edit forms;
- detail view and timeline;
- financial summary/report;
- product media and variant editing;
- bulk selection and print;
- status configuration;
- confirmation and long-form edit dialogs;
- responsive table-to-card behavior.

### Requested Stitch deliverables

Ask Stitch to return:

1. A coherent desktop admin shell plus tablet/mobile variants.
2. Token sheet: exact colors, type scale, spacing, radii, shadows, focus state, status palette, and icon sizing.
3. Reusable components: app header, permission-aware sidebar, breadcrumb, page heading, filter bar, metric card, data table, status chip, pagination, form controls, toast, empty/loading/error states, confirmation dialog, detail drawer, quick-jump palette, upload preview, and print preview.
4. High-fidelity representative screens: Orders list/detail, Create Direct Order, Product List/Edit, Order Routing/Delivery Monitor, Shipping Rates, Finance Dashboard/ledger, Customer Search/Customer 360, Access Roles/Permissions.
5. A mapping from every existing route in Section 3 to the relevant new template/component, explicitly preserving current actions, statuses, permissions, and responsive behavior.
6. A brief list of any suggested workflow changes separately from the visual redesign; do not silently change workflow or business rules.

### Copy/paste prompt for Stitch

> Redesign the Aama Clothings Admin Management Console as a premium, calm, highly usable back-office for Nepal-based clothing e-commerce operations. Use the route/page inventory and existing workflows in `ADMIN_PORTAL_UI_REFERENCE.md` as requirements. Preserve all current features, permissions, status distinctions, search-first customer privacy, NCM and distributor self-delivery paths, order/return/exchange flows, inventory/ledger distinctions, finance actions, and printing. Create a desktop shell with sticky top navigation, permission-aware grouped sidebar, breadcrumbs, max-width content, and responsive mobile drawer. Use a restrained slate/white/teal palette (primary `#0d7a68`, hover `#0b6657`, canvas `#f8fafc`, surface `#ffffff`, text `#0f172a`, muted `#64748b`, border `#e2e8f0`), Outfit UI type, Space Grotesk display headings, JetBrains Mono for IDs and numeric columns, 8px spacing rhythm, subtle borders/shadows, and accessible semantic status colors. Design reusable dense-but-readable tables, filters, forms, pagination, status chips, toasts, empty/loading/error states, confirmation dialogs, drawers, upload/print previews, and a Ctrl/Cmd+K quick-jump palette. Provide desktop/tablet/mobile variants and representative high-fidelity screens for Orders, Create Direct Order, Catalog, Delivery Monitor, Shipping Rates, Finance, Customer Search/Customer 360, and Access Control. Do not invent new business rules, remove existing fields/actions, or present customer records before an explicit search. Clearly label any workflow change ideas separately from visual changes.
