import assert from "node:assert/strict";
import test from "node:test";
import { buildDistributorSettlementPositionReport } from "../services/distributorSettlementPositionReportingService.js";

test("distributor position report preserves receivable/payable direction and independent net totals", () => {
  const report = buildDistributorSettlementPositionReport({
    distributors: [
      { id: "dist-1", name: "Distributor One" },
      { id: "dist-2", name: "Distributor Two" },
    ],
    parties: [
      { id: "party-1", sourceEntityId: "dist-1" },
      { id: "party-2", sourceEntityId: "dist-2" },
    ],
    documents: [
      { partyId: "party-1", side: "RECEIVABLE", remainingAmount: "10.00" },
      { partyId: "party-1", side: "PAYABLE", remainingAmount: "3.50" },
      { partyId: "party-2", side: "RECEIVABLE", remainingAmount: "1.00" },
      { partyId: "party-2", side: "PAYABLE", remainingAmount: "3.50" },
    ],
    returns: [{ id: "return-1", distributorId: "dist-1" }],
    exchanges: [{ id: "exchange-2", distributorId: "dist-2" }],
    legacyPayables: [
      { referenceType: "RETURN_LOGISTICS_SETTLEMENT", referenceId: "return-1", remainingBalance: "2.25" },
      { referenceType: "EXCHANGE_LOGISTICS_SETTLEMENT", referenceId: "exchange-2", remainingBalance: "0.75" },
    ],
    pendingRemittances: [
      { distributorId: "dist-1", amount: "1.10" },
      { distributorId: "dist-2", amount: "0.30" },
    ],
  });

  assert.deepEqual(report.rows.map(({ netBalance }) => netBalance), ["4.25", "-3.25"]);
  assert.equal(report.rows[0].outstandingReceivable, "10.00");
  assert.equal(report.rows[0].outstandingPayable, "5.75");
  assert.equal(report.rows[0].companyCollects, "4.25");
  assert.equal(report.rows[0].companyPays, "0.00");
  assert.equal(report.rows[0].legacyLogisticsPayable, "2.25");
  assert.equal(report.rows[1].outstandingPayable, "4.25");
  assert.equal(report.rows[1].companyPays, "3.25");
  assert.equal(report.totals.outstandingReceivable, "11.00");
  assert.equal(report.totals.outstandingPayable, "10.00");
  assert.equal(report.totals.companyCollects, "4.25");
  assert.equal(report.totals.companyPays, "3.25");
  assert.equal(report.totals.pendingRemittance, "1.40");
  assert.equal(report.totals.legacyLogisticsPayable, "3.00");
});

test("distributor position report handles empty and large decimal inputs", () => {
  const empty = buildDistributorSettlementPositionReport();
  assert.equal(empty.totals.distributorCount, 0);
  assert.equal(empty.totals.outstandingPayable, "0.00");

  const large = "999999999999999999.99";
  const report = buildDistributorSettlementPositionReport({
    distributors: [{ id: "dist-1", name: "Distributor One" }],
    parties: [{ id: "party-1", sourceEntityId: "dist-1" }],
    documents: [
      { partyId: "party-1", side: "RECEIVABLE", remainingAmount: large },
      { partyId: "party-1", side: "PAYABLE", remainingAmount: "0.01" },
    ],
  });

  assert.equal(report.rows[0].outstandingReceivable, large);
  assert.equal(report.rows[0].netBalance, "999999999999999999.98");
  assert.equal(typeof report.rows[0].netBalance, "string");
});
