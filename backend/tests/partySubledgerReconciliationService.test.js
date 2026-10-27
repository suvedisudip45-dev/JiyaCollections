import test from "node:test";
import assert from "node:assert/strict";
import { buildPartySubledgerReconciliation } from "../services/partySubledgerReconciliationService.js";

test("party subledger checks compare open source documents with their mapped GL controls", () => {
  const rows = buildPartySubledgerReconciliation({
    documentGroups: [
      { side: "RECEIVABLE", sourceType: "NCM_COD_SALE", _sum: { remainingAmount: "1500.00" }, _count: { _all: 2 } },
      { side: "PAYABLE", sourceType: "NCM_CARRIER_FEE", _sum: { remainingAmount: "135.00" }, _count: { _all: 1 } },
      { side: "PAYABLE", sourceType: "DISTRIBUTOR_DELIVERY_EARNING", _sum: { remainingAmount: "250.00" }, _count: { _all: 3 } },
    ],
    accounts: [
      { accountCode: "1170", currentBalance: "1500.00" },
      { accountCode: "1190", currentBalance: "75.00" },
      { accountCode: "2180", currentBalance: "130.00" },
      { accountCode: "2190", currentBalance: "250.00" },
    ],
  });

  assert.equal(rows.length, 4);
  assert.equal(rows.find((row) => row.controlAccountCode === "1170").isReconciled, true);
  assert.equal(rows.find((row) => row.controlAccountCode === "1190").variance, 75);
  assert.equal(rows.find((row) => row.controlAccountCode === "2180").variance, -5);
  assert.equal(rows.find((row) => row.controlAccountCode === "2190").isReconciled, true);
  assert.ok(rows.every((row) => row.coverageStatus === "SOURCE_SCOPED"));
});

test("party subledger checks report missing account or document balances as variances", () => {
  const [ncmReceivable] = buildPartySubledgerReconciliation({
    documentGroups: [
      { side: "RECEIVABLE", sourceType: "NCM_COD_SALE", _sum: { remainingAmount: "20.25" }, _count: { _all: 1 } },
    ],
  });

  assert.equal(ncmReceivable.glControlBalance, 0);
  assert.equal(ncmReceivable.subledgerTotal, 20.25);
  assert.equal(ncmReceivable.variance, -20.25);
  assert.equal(ncmReceivable.isReconciled, false);
});
