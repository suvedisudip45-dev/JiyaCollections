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
