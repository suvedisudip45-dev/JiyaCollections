import { prisma } from "../config/db.js";

const MAX_TRANSFERS_PER_PAGE = 50;
const MAX_TRANSFER_LINES = 200;
const MAX_SOURCE_RECORDS = 2000;
const MAX_LEDGER_RECORDS = 5000;
const MAX_LOCATION_RECORDS = 1000;
const MAX_BALANCE_PAIRS = 500;
const CORE_SOURCES = [
  "transfers",
  "shipments",
  "receipts",
  "discrepancies",
  "ledgerEntries",
  "balances",
  "locations",
];

const emptyCoverage = () => ({
  transfers: false,
  shipments: false,
  receipts: false,
  discrepancies: false,
  ledgerEntries: false,
  balances: false,
  locations: false,
  costLayers: false,
  costEvidence: false,
});

const uniqueSorted = (values) => [...new Set(values.filter(Boolean))].sort();
const emptySources = () => ({
  transfers: [],
  shipments: [],
  receipts: [],
  discrepancies: [],
  ledgerEntries: [],
  balances: [],
  locations: [],
  costLayers: [],
  costEvidence: [],
});

const pairKey = (locationId, inventorySkuId) => JSON.stringify([locationId, inventorySkuId]);
const compareById = (left, right) => String(left.id).localeCompare(String(right.id));

const appendMapValue = (map, key, value) => {
  const values = map.get(key) || [];
  values.push(value);
  map.set(key, values);
};

const buildTransferWhere = (filters, cursor) => {
  const where = {
    ...(filters.from || filters.to ? {
      requestedAt: {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lt: new Date(filters.to) } : {}),
      },
    } : {}),
    ...(filters.sourceLocationId ? { sourceLocationId: filters.sourceLocationId } : {}),
    ...(filters.destinationLocationId ? { destinationLocationId: filters.destinationLocationId } : {}),
    ...(filters.distributorId ? { distributorId: filters.distributorId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.inventorySkuId
      ? { lines: { some: { inventorySkuId: filters.inventorySkuId } } }
      : {}),
  };
  if (!cursor) return where;
  return {
    AND: [
      where,
      {
        OR: [
          { requestedAt: { lt: new Date(cursor.requestedAt) } },
          { requestedAt: new Date(cursor.requestedAt), id: { lt: cursor.transferId } },
        ],
      },
    ],
  };
};

const sourceReadFailure = (result) => CORE_SOURCES.filter((source) => result.coverage[source] !== true);

export const loadStockTransferReconciliationSources = async ({
  filters = {},
  cursor = null,
  limit = 25,
  client = prisma,
} = {}) => {
  const coverage = emptyCoverage();
  const sources = emptySources();
  const sourceErrors = new Set();
  const truncatedSources = new Set();
  const normalizedLimit = Number.isInteger(limit) && limit > 0
    ? Math.min(limit, MAX_TRANSFERS_PER_PAGE)
    : 25;

  const incompleteResult = (unavailableSource) => {
    const failedCoverage = emptyCoverage();
    const errors = unavailableSource ? [unavailableSource] : [];
    return {
      ...emptySources(),
      coverage: failedCoverage,
      sourceErrors: errors,
      truncatedSources: [],
      page: { limit: normalizedLimit, hasMore: false, lastTransfer: null },
      snapshotConsistency: "UNAVAILABLE",
    };
  };

  try {
    const loadSources = async (tx) => {
      let rawTransfers;
      try {
        rawTransfers = await tx.stockTransfer.findMany({
          where: buildTransferWhere(filters, cursor),
          select: {
            id: true,
            manufacturerId: true,
            distributorId: true,
            sourceLocationId: true,
            destinationLocationId: true,
            status: true,
            requestedByAccountId: true,
            requestedAt: true,
            reviewedByAccountId: true,
            reviewedAt: true,
            lines: {
              orderBy: [{ id: "asc" }],
              take: MAX_TRANSFER_LINES + 1,
              select: {
                id: true,
                inventorySkuId: true,
                requestedQuantity: true,
                approvedQuantity: true,
                dispatchedQuantity: true,
                reservedShipmentQuantity: true,
              },
            },
          },
          orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
          take: normalizedLimit + 1,
        });
      } catch {
        sourceErrors.add("transfers");
        return incompleteResult("transfers");
      }

      const hasMore = rawTransfers.length > normalizedLimit;
      const transfers = rawTransfers.slice(0, normalizedLimit).map((transfer) => {
        if (transfer.lines.length > MAX_TRANSFER_LINES) {
          coverage.transfers = false;
          truncatedSources.add("transfers");
        }
        return {
          ...transfer,
          lines: transfer.lines.slice(0, MAX_TRANSFER_LINES),
        };
      });
      if (hasMore) {
        coverage.transfers = false;
        truncatedSources.add("transfers");
      }
      if (coverage.transfers !== false) coverage.transfers = true;
      sources.transfers = transfers;
      const transferIds = uniqueSorted(transfers.map((transfer) => transfer.id));
      const distributorIds = uniqueSorted(transfers.map((transfer) => transfer.distributorId));
      const readRows = async (source, delegate, args, maximum = MAX_SOURCE_RECORDS) => {
        try {
          const rows = await tx[delegate].findMany({ ...args, take: maximum + 1 });
          if (!Array.isArray(rows)) throw new TypeError(`${delegate}.findMany must return an array.`);
          if (rows.length > maximum) {
            coverage[source] = false;
            truncatedSources.add(source);
          } else if (!sourceErrors.has(source) && !truncatedSources.has(source)) {
            coverage[source] = true;
          }
          return rows.slice(0, maximum);
        } catch {
          coverage[source] = false;
          sourceErrors.add(source);
          return [];
        }
      };

      if (!transferIds.length) {
        for (const source of CORE_SOURCES.filter((item) => item !== "transfers")) coverage[source] = true;
        coverage.transfers = true;
        coverage.costLayers = true;
        return {
          ...sources,
          coverage,
          sourceErrors: [],
          truncatedSources: [],
          page: { limit: normalizedLimit, hasMore, lastTransfer: null },
          snapshotConsistency: "REPEATABLE_READ",
        };
      }

      const shipments = await readRows("shipments", "stockTransferShipment", {
        where: { stockTransferId: { in: transferIds } },
        select: {
          id: true,
          stockTransferId: true,
          status: true,
          bookingMode: true,
          bookingIdempotencyKey: true,
          bookingRequestHash: true,
          dispatchedAt: true,
          bookedAt: true,
        },
        orderBy: [{ stockTransferId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      });
      const shipmentIds = uniqueSorted(shipments.map((shipment) => shipment.id));
      if (sourceErrors.has("shipments")) coverage.shipments = false;
      const shipmentLines = shipmentIds.length
        ? await readRows("shipments", "stockTransferShipmentLine", {
            where: { shipmentId: { in: shipmentIds } },
            select: {
              id: true,
              shipmentId: true,
              stockTransferLineId: true,
              quantity: true,
              uncostedQuantity: true,
            },
            orderBy: [{ shipmentId: "asc" }, { id: "asc" }],
          })
        : [];
      const shipmentLineIds = uniqueSorted(shipmentLines.map((line) => line.id));
      const costAllocations = shipmentLineIds.length
        ? await readRows("costLayers", "stockTransferShipmentLineCostLayer", {
            where: {
              shipmentLineId: { in: shipmentLineIds },
              status: "DISPATCHED",
            },
            select: {
              id: true,
              shipmentLineId: true,
              costLayerId: true,
              quantity: true,
              status: true,
            },
            orderBy: [{ shipmentLineId: "asc" }, { id: "asc" }],
          })
        : [];
      const costLayerIdsFromAllocations = costAllocations.map((allocation) => allocation.costLayerId);
      if (sourceErrors.has("shipments") || truncatedSources.has("shipments")) {
        coverage.shipments = false;
        coverage.costLayers = false;
      }

      const receipts = shipmentIds.length
        ? await readRows("receipts", "stockTransferReceipt", {
            where: { shipmentId: { in: shipmentIds } },
            select: {
              id: true,
              shipmentId: true,
              status: true,
              receivedBy: true,
              receivedAt: true,
            },
            orderBy: [{ shipmentId: "asc" }, { receivedAt: "asc" }, { id: "asc" }],
          })
        : [];
      if (!shipmentIds.length) coverage.receipts = true;
      const receiptIds = uniqueSorted(receipts.map((receipt) => receipt.id));
      if (sourceErrors.has("shipments") || truncatedSources.has("shipments")) coverage.receipts = false;
      const receiptLines = receiptIds.length
        ? await readRows("receipts", "stockTransferReceiptLine", {
            where: { receiptId: { in: receiptIds } },
            select: {
              id: true,
              receiptId: true,
              shipmentLineId: true,
              goodQuantity: true,
              damagedQuantity: true,
              missingQuantity: true,
            },
            orderBy: [{ receiptId: "asc" }, { id: "asc" }],
          })
        : [];

      const discrepancyClauses = [
        { stockTransferId: { in: transferIds } },
        ...(shipmentIds.length ? [{ shipmentId: { in: shipmentIds } }] : []),
        ...(receiptIds.length ? [{ receiptId: { in: receiptIds } }] : []),
      ];
      const discrepancies = await readRows("discrepancies", "inventoryDiscrepancy", {
        where: { OR: discrepancyClauses },
        select: {
          id: true,
          stockTransferId: true,
          shipmentId: true,
          receiptId: true,
          distributorId: true,
          inventoryLocationId: true,
          inventorySkuId: true,
          discrepancyType: true,
          custodyStage: true,
          quantity: true,
          status: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      if (sourceErrors.has("shipments") || sourceErrors.has("receipts") ||
          truncatedSources.has("shipments") || truncatedSources.has("receipts")) {
        coverage.discrepancies = false;
      }

      const referenceClauses = [
        { referenceType: "STOCK_TRANSFER", referenceId: { in: transferIds } },
        ...(receiptIds.length
          ? [{ referenceType: "STOCK_TRANSFER_RECEIPT", referenceId: { in: receiptIds } }]
          : []),
      ];
      const referencedLedgerEntries = await readRows("ledgerEntries", "inventoryLedgerEntry", {
        where: { OR: referenceClauses },
        select: {
          id: true,
          inventorySkuId: true,
          sourceLocationId: true,
          destinationLocationId: true,
          quantity: true,
          movementType: true,
          inventoryOwner: true,
          referenceType: true,
          referenceId: true,
          productionCostLayerId: true,
          idempotencyKey: true,
          actorId: true,
          actorRole: true,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      if (sourceErrors.has("shipments") || sourceErrors.has("receipts") ||
          truncatedSources.has("shipments") || truncatedSources.has("receipts")) {
        coverage.ledgerEntries = false;
      }
      const transitLocationKeys = shipmentIds.map((id) => `IN_TRANSIT:${id}`);
      const auxiliaryLocationKeys = distributorIds.flatMap((id) => [
        `DAMAGED:DISTRIBUTOR:${id}`,
        `LOST:DISTRIBUTOR:${id}`,
      ]);
      const knownLocationIds = uniqueSorted([
        ...transfers.flatMap((transfer) => [transfer.sourceLocationId, transfer.destinationLocationId]),
        ...referencedLedgerEntries.flatMap((entry) => [entry.sourceLocationId, entry.destinationLocationId]),
        ...discrepancies.map((item) => item.inventoryLocationId),
      ]);
      const locationClauses = [
        ...(knownLocationIds.length ? [{ id: { in: knownLocationIds } }] : []),
        ...((transitLocationKeys.length || auxiliaryLocationKeys.length)
          ? [{ locationKey: { in: [...transitLocationKeys, ...auxiliaryLocationKeys] } }]
          : []),
      ];
      const locations = locationClauses.length
        ? await readRows("locations", "inventoryLocation", {
            where: { OR: locationClauses },
            select: {
              id: true,
              locationKey: true,
              kind: true,
              inventoryOwner: true,
              manufacturerId: true,
              distributorId: true,
            },
            orderBy: [{ id: "asc" }],
          }, MAX_LOCATION_RECORDS)
        : [];
      if (sourceErrors.has("shipments") || sourceErrors.has("ledgerEntries") ||
          truncatedSources.has("shipments") || truncatedSources.has("ledgerEntries")) {
        coverage.locations = false;
      }
      if (!locationClauses.length) coverage.locations = true;
      const pairs = new Map();
      const addPair = (locationId, inventorySkuId) => {
        if (locationId && inventorySkuId) {
          pairs.set(pairKey(locationId, inventorySkuId), { locationId, inventorySkuId });
        }
      };
      for (const transfer of transfers) {
        for (const line of transfer.lines) {
          addPair(transfer.sourceLocationId, line.inventorySkuId);
          addPair(transfer.destinationLocationId, line.inventorySkuId);
        }
      }
      for (const entry of referencedLedgerEntries) {
        for (const locationId of [entry.sourceLocationId, entry.destinationLocationId].filter(Boolean)) {
          addPair(locationId, entry.inventorySkuId);
        }
      }
      for (const discrepancy of discrepancies) {
        addPair(discrepancy.inventoryLocationId, discrepancy.inventorySkuId);
      }
      const locationIdByKey = new Map(locations.map((location) => [location.locationKey, location.id]));
      const shipmentById = new Map(shipments.map((shipment) => [shipment.id, shipment]));
      const transferLineById = new Map(transfers.flatMap((transfer) =>
        transfer.lines.map((line) => [line.id, line])
      ));
      for (const line of shipmentLines) {
        const shipment = shipmentById.get(line.shipmentId);
        const transferLine = transferLineById.get(line.stockTransferLineId);
        if (!shipment || !transferLine) continue;
        addPair(locationIdByKey.get(`IN_TRANSIT:${shipment.id}`), transferLine.inventorySkuId);
      }
      const orderedPairs = [...pairs.values()].sort((left, right) =>
        left.locationId.localeCompare(right.locationId) ||
        left.inventorySkuId.localeCompare(right.inventorySkuId)
      );
      if (orderedPairs.length > MAX_BALANCE_PAIRS) {
        coverage.balances = false;
        coverage.ledgerEntries = false;
        truncatedSources.add("balances");
        truncatedSources.add("ledgerEntries");
      }
      const boundedPairs = orderedPairs.slice(0, MAX_BALANCE_PAIRS);
      const pairBalanceClauses = boundedPairs.map(({ locationId, inventorySkuId }) => ({
        locationId,
        inventorySkuId,
      }));
      const balances = pairBalanceClauses.length
        ? await readRows("balances", "inventoryBalance", {
            where: { OR: pairBalanceClauses },
            select: {
              locationId: true,
              inventorySkuId: true,
              quantityOnHand: true,
              reservedQuantity: true,
            },
            orderBy: [{ locationId: "asc" }, { inventorySkuId: "asc" }],
          })
        : [];
      if (coverage.locations !== true || coverage.ledgerEntries !== true ||
          sourceErrors.has("locations") || sourceErrors.has("ledgerEntries") ||
          truncatedSources.has("locations") || truncatedSources.has("ledgerEntries")) {
        coverage.balances = false;
      }
      if (!pairBalanceClauses.length) coverage.balances = true;

      const pairLedgerClauses = boundedPairs.map(({ locationId, inventorySkuId }) => ({
        inventorySkuId,
        OR: [{ sourceLocationId: locationId }, { destinationLocationId: locationId }],
      }));
      const ledgerWhere = {
        OR: [
          ...pairLedgerClauses,
          ...referenceClauses,
        ],
      };
      const historyLedgerEntries = (boundedPairs.length || referenceClauses.length)
        ? await readRows("ledgerEntries", "inventoryLedgerEntry", {
            where: ledgerWhere,
            select: {
              id: true,
              inventorySkuId: true,
              sourceLocationId: true,
              destinationLocationId: true,
              quantity: true,
              movementType: true,
              inventoryOwner: true,
              referenceType: true,
              referenceId: true,
              productionCostLayerId: true,
              idempotencyKey: true,
              actorId: true,
              actorRole: true,
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          }, MAX_LEDGER_RECORDS)
        : [];
      const ledgerEntriesById = new Map();
      for (const entry of [...referencedLedgerEntries, ...historyLedgerEntries]) {
        ledgerEntriesById.set(entry.id, entry);
      }
      const ledgerEntries = [...ledgerEntriesById.values()].sort(compareById);
      if (coverage.ledgerEntries !== false) coverage.ledgerEntries = true;

      const allCostLayerIds = uniqueSorted([
        ...costLayerIdsFromAllocations,
        ...ledgerEntries.map((entry) => entry.productionCostLayerId),
      ]);
      const costLayers = allCostLayerIds.length
        ? await readRows("costLayers", "manufacturerInventoryCostLayer", {
            where: { id: { in: allCostLayerIds } },
            select: {
              id: true,
              inventorySkuId: true,
              manufacturerId: true,
              productId: true,
              unitCogs: true,
              producedQuantity: true,
            },
            orderBy: [{ id: "asc" }],
          })
        : [];
      if (!allCostLayerIds.length && !sourceErrors.has("costLayers") &&
          !truncatedSources.has("costLayers") && !truncatedSources.has("shipments")) {
        coverage.costLayers = true;
      }

      const allocationsByLine = new Map();
      for (const allocation of costAllocations) appendMapValue(allocationsByLine, allocation.shipmentLineId, allocation);
      const linesByShipment = new Map();
      for (const line of shipmentLines) {
        appendMapValue(linesByShipment, line.shipmentId, {
          id: line.id,
          stockTransferLineId: line.stockTransferLineId,
          quantity: line.quantity,
          uncostedQuantity: line.uncostedQuantity,
          costLayerAllocations: (allocationsByLine.get(line.id) || []).map((allocation) => ({
            id: allocation.id,
            costLayerId: allocation.costLayerId,
            quantity: allocation.quantity,
            status: allocation.status,
          })).sort(compareById),
        });
      }
      sources.shipments = shipments.map((shipment) => ({
        ...shipment,
        lines: (linesByShipment.get(shipment.id) || []).sort(compareById),
      })).sort(compareById);
      const linesByReceipt = new Map();
      for (const line of receiptLines) appendMapValue(linesByReceipt, line.receiptId, {
        id: line.id,
        shipmentLineId: line.shipmentLineId,
        goodQuantity: line.goodQuantity,
        damagedQuantity: line.damagedQuantity,
        missingQuantity: line.missingQuantity,
      });
      sources.receipts = receipts.map((receipt) => ({
        ...receipt,
        lines: (linesByReceipt.get(receipt.id) || []).sort(compareById),
      })).sort(compareById);
      sources.discrepancies = discrepancies;
      sources.ledgerEntries = ledgerEntries;
      sources.balances = balances;
      sources.locations = locations;
      sources.costLayers = costLayers;
      sources.costEvidence = [];
      coverage.costEvidence = false;

      if (coverage.shipments === true && !sourceErrors.has("shipments")) coverage.shipments = true;
      if (coverage.receipts !== false) coverage.receipts = true;
      if (coverage.discrepancies !== false) coverage.discrepancies = true;
      if (coverage.locations !== false) coverage.locations = true;
      if (coverage.balances !== false) coverage.balances = true;
      if (sourceErrors.has("shipments") || sourceErrors.has("receipts") ||
          truncatedSources.has("shipments") || truncatedSources.has("receipts")) {
        coverage.discrepancies = false;
        coverage.ledgerEntries = false;
      }
      if (sourceErrors.has("shipments") || sourceErrors.has("ledgerEntries") ||
          truncatedSources.has("shipments") || truncatedSources.has("ledgerEntries")) {
        coverage.locations = false;
      }
      if (sourceErrors.has("locations") || sourceErrors.has("ledgerEntries") ||
          truncatedSources.has("locations") || truncatedSources.has("ledgerEntries")) {
        coverage.balances = false;
      }
      if (sourceErrors.has("shipments") || truncatedSources.has("shipments")) {
        coverage.costLayers = false;
      }
      const lastTransfer = transfers.length
        ? {
            transferId: transfers[transfers.length - 1].id,
            requestedAt: transfers[transfers.length - 1].requestedAt,
          }
        : null;
      return {
        ...sources,
        coverage,
        sourceErrors: [...sourceErrors].sort(),
        truncatedSources: [...truncatedSources].sort(),
        page: { limit: normalizedLimit, hasMore, lastTransfer },
        snapshotConsistency: "REPEATABLE_READ",
      };
    };
    const result = typeof client.$transaction === "function"
      ? await client.$transaction(loadSources, { isolationLevel: "RepeatableRead" })
      : await loadSources(client);
    return {
      ...result,
      sourceErrors: [...new Set(result.sourceErrors)].sort(),
      truncatedSources: [...new Set(result.truncatedSources)].sort(),
      incompleteSources: sourceReadFailure(result),
    };
  } catch {
    const unavailable = incompleteResult("snapshot");
    return {
      ...unavailable,
      incompleteSources: CORE_SOURCES,
    };
  }
};
