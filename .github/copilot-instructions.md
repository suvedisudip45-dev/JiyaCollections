# Copilot instructions

## Repository shape and architecture

- This repository is a set of independent applications, not a root-level npm workspace:
  - `frontend/`: customer storefront.
  - `admin/`: business operations portal.
  - `manufacturer/`: manufacturer fulfillment and inventory portal.
  - `marketing/`: marketing-partner portal.
  - `backend/`: shared Express API and business logic.
- Each portal has its own Vite/React app, dependencies, routes, API calls, and authentication integration. Implement a change in the owning portal and keep shared business rules in the backend API; do not make one portal depend on another portal's code.
- `backend/server.js` configures middleware and mounts domain routers under `/api`. The typical backend path is route (authentication, permission, and workspace context) → controller → domain service → Prisma. Check the actual route and service before changing a flow; not every domain uses precisely the same layering.
- `backend/prisma/schema.prisma` is the canonical data model and MySQL is the database. Prisma migrations and the generated client must remain aligned with schema changes.
- Authentication is session-aware JWT plus database-backed roles and permissions, not just a decoded role claim. Manufacturer, distributor, and marketing-partner operations also use authenticated workspace context to scope records.
- Manufacturer accounts upgraded to distributor retain MANUFACTURER as their login workspace while `req.auth.roles` and the authenticated profile context expose both active workspaces. `authorize()` unions scoped permissions only for the manufacturer/distributor pair. Automatic customer-order hub allocation targets active distributors with exact province/district coverage and sufficient distributor-ledger stock; do not reintroduce manufacturer assignments or legacy `ManufacturerInventory` reservation into checkout.
- Keep distinct workflows distinct: customer-order fulfillment uses `OrderAssignment`; distributor replenishment uses `StockTransfer`. For newer SKU/location stock flows, `InventoryBalance` is the current quantity and `InventoryLedgerEntry` is the auditable movement history. Older `StockLog` and `ManufacturerInventory` models are not equivalent to that ledger.
- Admin-issued manufacturer production orders require an explicit fabric/GSM, target date, and batch plan. Manufacturers must pass pre-production checks and set MOQ/unit COGS before starting; completion requires post-production QA and actual size/color counts. Record only good units through the inventory-ledger receipt path, in the same transaction as the production completion and payable journal. Manufacturers are not storefront-order fulfillment hubs; distributor assignment/receipt flows belong to the distributor workspace.
- Local/manual stock-transfer freight paid by the manufacturer is accrued as a manufacturer payable at dispatch; NCM carrier bookings are a separate flow. Manufacturer production and logistics settlement requests must be checked against accrued payables, and admin payment must update cash and journal accounting atomically.
- Distributor replenishment uses `StockTransfer`; its receipt checklist maps size/color good, damaged, and missing counts onto the existing shipment receipt ledger transaction. Distributor inventory decreases must be evidence-backed `DAMAGE`/`LOSS` movements with an open `InventoryDiscrepancy`; never add a distributor stock-increase path outside transfer receipt. A manufacturer-distributor dual-role account submits requests through separate profile IDs, including when supplying itself.
- NCM delivery, Cloudinary uploads, payment providers, and notifications are external boundaries. The notification worker is separate from the API and is gated; do not infer that existing business flows send notifications.

## Build, test, and lint

Run commands from the named package directory; root `package.json` has no application scripts.

| Package | Build | Lint |
| --- | --- | --- |
| `frontend/` | `npm run build` | `npm run lint` (ESLint) |
| `admin/` | `npm run build` | `npm run lint` (ESLint) |
| `manufacturer/` | `npm run build` | `npm run lint` (Oxlint) |
| `marketing/` | `npm run build` | `npm run lint` (ESLint) |
| `backend/` | `npm run build` (runs `prisma generate`) | No lint script is defined |

Portal development servers use `npm run dev`; the backend uses `npm run dev` (nodemon) or `npm start`.

Backend tests use Node's built-in test runner:

```sh
# From backend/
npm test
node --test tests/stockTransferService.test.js
node --test --test-name-pattern="test name or pattern" tests/stockTransferService.test.js
npm run test:delivery
npm run test:notifications
```

`npm test` runs test files sequentially. Database integration files are skipped unless `RUN_DATABASE_INTEGRATION_TESTS=1`; only enable that against an isolated test database. There are no test scripts in the four portal packages.

## Repository-specific conventions

- Treat the backend as authoritative for permissions, identity/ownership, inventory, pricing, order state, and delivery outcomes. A frontend check is UX, not authorization or a substitute for backend validation.
- Protected routes follow the existing `authenticate` → `authorize("permission:code")` pattern and add `setManufacturerContext`, `setDistributorContext`, or another workspace context where applicable. When adding/changing a permission, update the backend RBAC setup and the admin route permission map (`admin/src/auth/adminRoutePermissions.js`) as needed.
- Keep transitions and consequential side effects in domain services. State changes that reserve or move stock, create orders, or record external handoffs must preserve the existing transaction, audit, and idempotency patterns; inspect the domain tests before changing them.
- Inventory quantities are not UI-maintained counters. Preserve ledger movements and balances together, and retain actor/reference/idempotency information wherever the existing flow records it.
- External delivery outcomes must be explicit. A failed or ambiguous NCM request is not a successful booking; preserve failure/unknown state and use the existing reconciliation path rather than optimistic success.
- Preserve the API response convention (`success`, `message`, and, where used, `code`) and the portal's existing API/authentication helpers, token storage, routing, and toast patterns.
- Keep secrets out of source, frontend configuration, and `.env.example`. Notification credentials/configuration are separate from the API; consult `backend/notifications/README.md` before changing that subsystem.
- The project maintains implementation documentation. Update the relevant existing docs when changing a route, model, permission, environment variable, workflow, or UI: `PROJECT_OVERVIEW.md`, `ARCHITECTURE_AND_BACKEND.md`, `DATABASE_AND_SCHEMAS.md`, `FRONTEND_AND_UI.md`, `AI_CODING_RULES.md`, and, for manufacturer/distributor operations, `DISTRIBUTOR_MANUFACTURER_ADMIN_GUIDE.md`. Consult `SECURITY_DATA_FLOW_AND_UI_AUDIT.md` for security-sensitive data flows.
