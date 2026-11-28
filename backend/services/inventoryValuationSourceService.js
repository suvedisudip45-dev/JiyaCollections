import { Prisma } from "@prisma/client";

export const loadPlatformInventoryValuationSources = async (
  client,
  { includeLostLocations = false, includeLedgerOnlyLocations = false } = {},
) => {
  const allLocations = await client.inventoryLocation.findMany({
    where: { inventoryOwner: "PLATFORM" },
    select: { id: true, kind: true, inventoryOwner: true },
  });
  const locations = includeLostLocations
    ? allLocations
    : allLocations.filter((location) => location.kind !== "LOST");
  const locationIds = locations.map(({ id }) => id);
  if (!locationIds.length) return { locations, balances: [], layerBalances: [] };

  const balances = await client.inventoryBalance.findMany({
    where: { locationId: { in: locationIds } },
    select: {
      locationId: true,
      inventorySkuId: true,
      quantityOnHand: true,
      inventorySku: {
        select: {
          productId: true,
          product: { select: { id: true, costPrice: true } },
        },
      },
    },
  });
  const layerLocationIds = includeLedgerOnlyLocations
    ? locationIds
    : [...new Set(balances.map(({ locationId }) => locationId))];
  if (!layerLocationIds.length) return { locations, balances, layerBalances: [] };

  const layerBalances = await client.$queryRaw(Prisma.sql`
      SELECT
        movements.locationId,
        movements.inventorySkuId,
        movements.productionCostLayerId,
        SUM(movements.quantityDelta) AS quantity,
        layer.unitCogs
      FROM (
        SELECT
          sourceLocationId AS locationId,
          inventorySkuId,
          productionCostLayerId,
          -quantity AS quantityDelta
        FROM InventoryLedgerEntry
        WHERE inventoryOwner = 'PLATFORM'
          AND productionCostLayerId IS NOT NULL
          AND sourceLocationId IN (${Prisma.join(layerLocationIds)})
        UNION ALL
        SELECT
          destinationLocationId AS locationId,
          inventorySkuId,
          productionCostLayerId,
          quantity AS quantityDelta
        FROM InventoryLedgerEntry
        WHERE inventoryOwner = 'PLATFORM'
          AND productionCostLayerId IS NOT NULL
          AND destinationLocationId IN (${Prisma.join(layerLocationIds)})
      ) movements
      INNER JOIN ManufacturerInventoryCostLayer layer
        ON layer.id = movements.productionCostLayerId
      GROUP BY
        movements.locationId,
        movements.inventorySkuId,
        movements.productionCostLayerId,
        layer.unitCogs
    `);

  return { locations, balances, layerBalances };
};
