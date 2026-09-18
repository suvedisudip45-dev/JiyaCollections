# Manufacturer API Notes

## Update manufacturer pickup branch

Admin endpoint for setting the NCM pickup branch for a manufacturer. This value is used as the origin branch during NCM order creation.

### Endpoint

POST /api/manufacturer/update

### Auth

Admin only

### Example request

```bash
curl --location 'https://your-backend-url/api/manufacturer/update' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <admin-token>' \
  --data '{
    "manufacturerId": "<manufacturer-id>",
    "ncmPickupBranch": "TINKUNE"
  }'
```

### Example response

```json
{
  "success": true,
  "message": "Manufacturer updated",
  "manufacturer": {
    "id": "<manufacturer-id>",
    "name": "Jiya Manufacturing",
    "city": "Kathmandu",
    "ncmPickupBranch": "TINKUNE",
    "isActive": true,
    "isAvailable": true
  }
}
```

### Notes

- `ncmPickupBranch` is normalized to uppercase before saving.
- If this field is empty, the system falls back to the legacy city-based branch mapping for compatibility.
- For distributed manufacturing, each manufacturer should ideally have its own assigned pickup branch.
- Never rely on a single global city map as the final source of truth for pickup origin.

## NCM branch catalog and customer delivery addresses

The customer delivery flow uses NCM's live `GET /api/v2/branches` catalog:

1. The customer selects a province.
2. The district filters the branches returned by NCM.
3. The selected branch loads its `covered_areas` from the same NCM branch record.
4. The customer selects one covered area. Manual town or area entry is not accepted.
5. The selected exact branch is sent to `GET /api/v1/shipping-rate` and `POST /api/v1/order/create`.

`GET /api/v2/vendor/assigned-branches` is a separate endpoint for the vendor's assigned pickup branches. It should be used when validating a manufacturer's pickup origin, not for customer destination selection.

### `NCM_BRANCH_MAP_JSON`

This variable is retained only for compatibility with legacy addresses and older integrations. It must not be used to generate customer destination choices or destination fallbacks. NCM's live branch catalog is the source of truth for destination branches and covered areas.

If legacy data must be supported, keep only verified exact branch values and do not add guessed alternatives. New orders should persist the selected `ncmBranch` and covered area in the address snapshot.

Example of a temporary legacy-only value:

```env
NCM_BRANCH_MAP_JSON={"legacy-kathmandu":"TINKUNE"}
```

### Database catalog synchronization

The application stores the NCM branch catalog in the `NcmBranch` table. Customer and manufacturer branch dropdowns read this table and do not call NCM for every request.

An administrator refreshes the catalog from NCM with:

```text
POST /api/manufacturer/admin/branches/sync
```

The endpoint is admin-authenticated. It fetches `GET /api/v2/branches`, upserts the exact NCM branch identity and covered areas, and marks branches no longer returned by NCM as inactive. Run this action after NCM changes its branch or coverage data.

The local database was synchronized with `prisma db push`. This repository currently has older migration drift in the `Manufacturer` table, so `prisma migrate dev` requests a database reset and must not be run against the existing database without first reconciling that historical migration drift.
