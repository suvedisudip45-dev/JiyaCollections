import assert from "node:assert/strict";
import test from "node:test";
import { loadStockTransferReconciliationSources } from "../services/stockTransferReconciliationDataService.js";

const makeTransfer = (id = "transfer-1") => ({
  id,
  manufacturerId: "manufacturer-1",
  distributorId: "distributor-1",
  sourceLocationId: "factory-1",
  destinationLocationId: "distributor-location-1",
  status: "IN_TRANSIT",
  requestedAt: new Date("2026-01-02T03:04:05.000Z"),
  lines: [{
    id: `${id}-line-1`,
    inventorySkuId: "sku-1",
    requestedQuantity: 4,
    approvedQuantity: 4,
    dispatchedQuantity: 4,
    reservedShipmentQuantity: 0,
  }],
});

const emptyDelegate = async () => [];
const makeClient = ({ transfers = [], failDelegate = null, rowsByDelegate = {} } = {}) => {
  const calls = [];
  const delegateNames = [
    "stockTransferShipment",
    "stockTransferShipmentLine",
    "stockTransferShipmentLineCostLayer",
    "stockTransferReceipt",
    "stockTransferReceiptLine",
    "inventoryDiscrepancy",
    "inventoryLedgerEntry",
    "inventoryLocation",
    "inventoryBalance",
    "manufacturerInventoryCostLayer",
  ];
  const tx = Object.fromEntries(delegateNames.map((name) => [name, {
    findMany: async (args) => {
      calls.push({ delegate: name, args });
      if (failDelegate === name) throw new Error("synthetic read failure");
      return rowsByDelegate[name] || emptyDelegate();
    },
  }]));
  tx.stockTransfer = {
    findMany: async (args) => {
      calls.push({ delegate: "stockTransfer", args });
      if (failDelegate === "stockTransfer") throw new Error("synthetic read failure");
      return transfers;
    },
  };
  let transactionOptions;
  const client = {
    $transaction: async (callback, options) => {
      transactionOptions = options;
      return callback(tx);
    },
  };
  return { client, calls, getTransactionOptions: () => transactionOptions };
};

test("loads an empty transfer scope in one repeatable-read, read-only snapshot", async () => {
  const mock = makeClient();
  const result = await loadStockTransferReconciliationSources({ client: mock.client });

  assert.equal(mock.getTransactionOptions().isolationLevel, "RepeatableRead");
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].delegate, "stockTransfer");
  assert.deepEqual(result.transfers, []);
  assert.equal(result.coverage.transfers, true);
  assert.equal(result.coverage.shipments, true);
  assert.equal(result.coverage.costLayers, true);
  assert.equal(result.coverage.costEvidence, false);
  assert.deepEqual(result.sourceErrors, []);
  assert.deepEqual(result.incompleteSources, []);
});

test("marks a paginated transfer page incomplete for cross-page duplicate checks", async () => {
  const mock = makeClient({ transfers: [makeTransfer("transfer-a"), makeTransfer("transfer-b")] });
  const result = await loadStockTransferReconciliationSources({
    client: mock.client,
    limit: 1,
  });

  assert.equal(result.transfers.length, 1);
  assert.equal(result.page.hasMore, true);
  assert.equal(result.page.lastTransfer.transferId, "transfer-a");
  assert.equal(result.coverage.transfers, false);
  assert.ok(result.truncatedSources.includes("transfers"));
  assert.ok(result.incompleteSources.includes("transfers"));
  assert.ok(mock.calls.every((call) => Number.isInteger(call.args.take)));
  assert.ok(mock.calls.every((call) => call.args.take <= 5001));
});

test("failed shipment reads invalidate every dependent coverage claim", async () => {
  const mock = makeClient({
    transfers: [makeTransfer()],
    failDelegate: "stockTransferShipment",
  });
  const result = await loadStockTransferReconciliationSources({ client: mock.client });

  assert.deepEqual(result.sourceErrors, ["shipments"]);
  for (const source of [
    "shipments",
    "receipts",
    "discrepancies",
    "ledgerEntries",
    "locations",
    "balances",
    "costLayers",
  ]) {
    assert.equal(result.coverage[source], false, `${source} must not appear complete`);
  }
  assert.ok(result.incompleteSources.includes("shipments"));
});

test("queries only dispatched cost-layer allocations as authoritative shipment evidence", async () => {
  const mock = makeClient({
    transfers: [makeTransfer()],
    rowsByDelegate: {
      stockTransferShipment: [{
        id: "shipment-1",
        stockTransferId: "transfer-1",
        status: "DISPATCHED",
        bookingMode: "MANUAL",
        bookingIdempotencyKey: "booking-key-1",
        bookingRequestHash: null,
        dispatchedAt: new Date("2026-01-03T00:00:00.000Z"),
        bookedAt: null,
      }],
      stockTransferShipmentLine: [{
        id: "shipment-line-1",
        shipmentId: "shipment-1",
        stockTransferLineId: "transfer-1-line-1",
        quantity: 4,
        uncostedQuantity: 0,
      }],
    },
  });
  const result = await loadStockTransferReconciliationSources({ client: mock.client });
  const allocationRead = mock.calls.find((call) =>
    call.delegate === "stockTransferShipmentLineCostLayer"
  );

  assert.ok(allocationRead);
  assert.deepEqual(allocationRead.args.where.status, "DISPATCHED");
  assert.deepEqual(result.costEvidence, []);
  assert.equal(result.coverage.costEvidence, false);
  assert.ok(mock.calls.every((call) => call.delegate !== "create" && call.delegate !== "update"));
});

test("builds ledger-history pairs from relevant SKU/location evidence without a Cartesian expansion", async () => {
  const mock = makeClient({
    transfers: [makeTransfer()],
    rowsByDelegate: {
      inventoryLedgerEntry: [{
        id: "ledger-1",
        inventorySkuId: "sku-2",
        sourceLocationId: "unrelated-location",
        destinationLocationId: null,
        quantity: 1,
        movementType: "ADJUSTMENT",
        inventoryOwner: "PLATFORM",
        referenceType: "STOCK_TRANSFER",
        referenceId: "transfer-1",
        productionCostLayerId: null,
        idempotencyKey: "ledger-idempotency-1",
        actorId: null,
        actorRole: null,
      }],
    },
  });
  await loadStockTransferReconciliationSources({ client: mock.client });
  const balanceRead = mock.calls.find((call) => call.delegate === "inventoryBalance");
  const pairKeys = balanceRead.args.where.OR.map(({ locationId, inventorySkuId }) =>
    JSON.stringify([locationId, inventorySkuId])
  );

  assert.deepEqual(pairKeys, [
    '["distributor-location-1","sku-1"]',
    '["factory-1","sku-1"]',
    '["unrelated-location","sku-2"]',
  ]);
});
