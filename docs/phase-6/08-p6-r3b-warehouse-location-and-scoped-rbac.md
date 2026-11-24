# P6-R3B - Warehouse Location and Location-Scoped RBAC

**Status:** COMPLETE - EXISTING-SCHEMA AUTHORIZATION FOUNDATION ONLY
**P6-R3A:** COMPLETE - DATABASE-INDEPENDENT MOVEMENT FOUNDATION
**P6-R3C:** PLANNED - NOT STARTED
**P6-R3:** PLANNED - OVERALL IMPLEMENTATION NOT STARTED
**Phase status:** Phase 4 INCOMPLETE; Phase 5 PARTIAL / INCOMPLETE; Phase 6 IN PROGRESS; Phase 7 BLOCKED

## 1. Existing schema and code evidence

The repository has stable identities and profile-linked locations, but it does
not have warehouse staff assignment or location-scoped RBAC.

Existing models:

- `InventoryLocation`: stable UUID, unique `locationKey`, name, kind,
  `inventoryOwner`, optional `manufacturerId`/`distributorId`, active state.
- `InventoryBalance`: unique location/SKU balance.
- `InventoryLedgerEntry`: location/SKU movement, owner, reference, actor and
  idempotency evidence.
- `ManufacturerLocation`: manufacturer province/district geographic coverage,
  not a physical inventory location.
- `DistributorLocation`: distributor province/district geographic coverage,
  not a physical inventory location.
- `Manufacturer` and `Distributor`: authenticated profile identity and
  `accountId`.
- `Role`, `Permission`, `RolePermissionMapping`, `AuthAccountRoleMapping`:
  global role/permission mappings.

No existing model maps an account or role to an assigned warehouse/location.
No warehouse role or warehouse/location permission identifier was found.
No physical bin/storage-location hierarchy or central warehouse model was found.

## 2. Location and warehouse representation

Current inventory locations are flat holding locations in
`InventoryLocation`. Their kinds include factory, distributor, transit,
quarantine, damaged, lost, return hold and return receipt. No parent-child
warehouse hierarchy is represented.

The target hierarchy, if approved:

1. Organization/platform.
2. Warehouse or operating site.
3. Storage area or zone.
4. Bin or holding location.
5. Inventory movement state/location: available, reserved, transit,
   quarantine, damaged, lost or return hold.

Distributor and manufacturer custody locations remain linked to their existing
profiles and remain platform-owned inventory. A distributor or manufacturer
profile is not an inventory owner.

Logical states should not be modeled as physical warehouses unless a separately
approved physical location contract requires it.

## 3. Location identity and lifecycle

Proposed rules:

- `InventoryLocation.id` is immutable once used.
- `locationKey` is unique and descriptive.
- Kind and owner/custody associations are explicit.
- Parent/child warehouse relations require a future schema addition.
- Deactivation requires no on-hand/reserved stock, open movement or active
  transfer/return reference.
- Historical references preserve the old location rather than deleting or
  repurposing it.
- Location/custody relationship changes require an explicit transfer/correction
  event rather than silently changing IDs.
- Hierarchy cycles and deactivation cascades require database constraints or
  service checks.

## 4. Existing RBAC and scoped authorization

Existing authentication is session-aware and permission resolution is
database-backed by account, active role and active role mapping. Workspace
contexts are resolved from authenticated profile IDs:

- Manufacturer: `setManufacturerContext`.
- Distributor: `setDistributorContext`.
- Fulfillment: `setFulfillmentContext`.

These contexts prevent client-supplied manufacturer/distributor override in
the existing middleware. They do not provide a general account-to-location
assignment or warehouse hierarchy.

No proposed warehouse role names or permission identifiers are added as
existing permissions.

Implemented reusable pure/middleware behavior is in
`backend/middleware/locationScope.js`:

- Normalizes and rejects malformed location IDs.
- Resolves a server-side location rather than trusting a client location ID.
- Validates active state and platform inventory owner.
- Matches manufacturer/distributor location links to authenticated profile IDs.
- Denies Admin global access unless a caller explicitly grants global scope.
- Keeps source and destination permission checks separate.
- Writes authorization decisions to the existing system audit recorder where
  available.

This is a reusable contract, not a warehouse permission catalog or deployed
warehouse role assignment.

## 5. Permission matrix

Existing identifiers remain:

- `inventory:ledger_read`
- `inventory:admin_read_all`
- `stock:adjust`
- `transfer:distributor_request`
- `transfer:distributor_read`
- `transfer:distributor_receive`
- `transfer:manufacturer_dispatch`
- `transfer:manufacturer_read`
- `transfer:admin_read`
- `transfer:admin_review`
- `distributor:inventory_decrease`
- `distributor:inventory_read`
- `manufacturer:inventory_read`
- `manufacturer:inventory_update`
- `returns:admin_inspect`
- `returns:admin_refund`

The following remain proposed, not existing permission identifiers:

- Location view/read
- Location receive/inspect/put-away
- Location reserve/release/pick/pack/dispatch
- Location count/request-adjustment/approve-adjustment
- Location reconciliation read
- Location configuration administer

Approval, execution and reconciliation permissions must remain separate.
Maker/checker separation is not proven by the current Role/Permission schema.

## 6. Movement authorization

The target contract evaluates source and destination independently:

- Source actor requires source movement/dispatch permission and source scope.
- Destination actor requires receipt/confirmation permission and destination
  scope.
- Transfer approval does not imply dispatch or receipt permission.
- Dispatch and receipt should use separate actors when maker/checker policy
  applies.
- Transit is a distinct in-transit custody location.
- Distributor custody remains platform-owned and does not create sale or COGS.
- Cancellation/reversal requires business authorization, source evidence and
  linked compensating movement; no history overwrite.

## 7. API and middleware contract

Routes should compose existing middleware:

`authenticate -> authorize(permission) -> setWorkspaceContext ->
resolveServerLocation -> requireLocationAccess -> controller/service`

For a movement:

`authenticate -> authorize(source/destination permission) ->
resolve source/destination from transfer/business record ->
evaluate both location scopes -> domain service`

A client-supplied location ID must never establish access. It may be validated
as a requested target, but server-resolved transfer/profile/location ownership
must confirm the scope.

Missing and malformed IDs should fail before data lookup where possible.
Inactive or inaccessible locations should return generic access denial.
Missing a server-referenced location may use a not-found response only when
the caller already has the appropriate read scope.

Authorization decisions use the existing `SystemAuditLog`/outbox mechanism.

## 8. Minimal implemented example

The distributor inventory-decrease route now adds
`requireDistributorInventoryLocation` after `setDistributorContext` and before
the controller.

The middleware:

- Resolves the active platform-owned distributor location from
  `req.distributorId`.
- Ignores client-supplied location IDs.
- Denies inactive, missing, non-platform or cross-distributor locations.
- Sets `req.locationScope` for downstream use.

No inventory amount, ledger entry or accounting behavior changed.

## 9. Security findings

The existing profile context is stronger than client profile fields for
manufacturer/distributor routes, but it does not establish warehouse location
assignment. Existing Admin routes have broad role/permission behavior and
must not automatically receive future location-scoped permissions.

No route or UI control should be treated as authorization. Server middleware
must resolve resource ownership and permission.

## 10. Schema changes required

No schema change was applied. A future authorization implementation would
need, after business approval:

- `Warehouse` or central `OperatingSite`.
- Optional warehouse hierarchy with parent and lifecycle fields.
- Warehouse/operator/account assignment.
- Warehouse/location permission scope mapping.
- Optional storage-area/bin models.
- Unique warehouse code and location hierarchy constraints.
- Database indexes for account/location active assignments.
- Foreign-key/restriction behavior for historical references.
- Maker/checker approval relation for high-risk movements.

Do not infer these fields or enact migrations without an isolated implementation
increment.

## 11. Legacy location migration

Existing `InventoryLocation` and distributor/manufacturer profile links can seed
a proposed location scope view only after separately approved mapping. Existing
province/district `ManufacturerLocation` and `DistributorLocation` records are
coverage/addressing records, not physical stock locations.

Historical records must preserve old IDs and inactive location references.
No synthetic warehouse hierarchy or staff assignment should be generated.

## 12. Tests and limitations

Database-independent tests cover:

- Malformed/missing location identity.
- Assigned distributor and manufacturer access.
- Cross-location denial.
- Inactive and non-platform locations.
- Explicit global Admin access versus fail closed.
- Source/destination permission separation.
- Server-side location resolution instead of client location ID.

These tests use mocks and controlled doubles. They do not prove persisted role
assignments, location assignments, database constraints or transaction safety.

## 13. P6-R3C prerequisites

P6-R3C requires:

- Approved warehouse hierarchy and location lifecycle.
- Approved staff roles and location assignment model.
- Schema/migration/recovery approval.
- Independently verified isolated database.
- Persisted account/location assignment tests.
- Receipt/inspection/put-away evidence policy.
- Physical count and reconciliation gates.

No P6-R3C work is started.

## 14. Files changed

- `backend/middleware/locationScope.js`
- `backend/routes/distributorRoute.js`
- `backend/tests/locationScope.test.js`
- `docs/phase-6/08-p6-r3b-warehouse-location-and-scoped-rbac.md`
- Phase 6 tracker and relevant ERP/accounting documentation
