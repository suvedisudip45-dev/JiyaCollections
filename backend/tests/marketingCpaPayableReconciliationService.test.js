import assert from "node:assert/strict";
import test from "node:test";
import { buildMarketingCpaPayableReconciliation } from "../services/marketingCpaPayableReconciliationService.js";

const sourceFixture = () => ({
  redemptionEvents: [{
    id: "event-1",
    eventType: "BENEFIT_REDEEMED",
    referenceId: "redemption-1",
    metadata: { redemptionId: "redemption-1", cpaRateSnapshot: "125.75" },
  }],
  journalEntries: [{
    id: "journal-1",
    sourceType: "MARKETING_CPA",
    sourceId: "redemption-1",
    status: "POSTED",
    lines: [
      {
        debit: "125.75",
        credit: "0",
        account: { accountCode: "6420" },
        accountingParty: {
          partyType: "MARKETING_PARTNER",
          sourceEntityId: "partner-1",
          displayName: "Partner One",
        },
      },
      {
        debit: "0",
        credit: "125.75",
        account: { accountCode: "2170" },
        accountingParty: {
          partyType: "MARKETING_PARTNER",
          sourceEntityId: "partner-1",
          displayName: "Partner One",
        },
      },
    ],
  }],
  documents: [{
    id: "bill-1",
    documentType: "BILL",
    side: "PAYABLE",
    sourceType: "MARKETING_CPA",
    sourceId: "redemption-1",
    currency: "NPR",
    originalAmount: "125.75",
    allocatedAmount: "25.75",
    remainingAmount: "100.00",
    status: "PARTIALLY_PAID",
    party: {
      partyType: "MARKETING_PARTNER",
      sourceEntityId: "partner-1",
      displayName: "Partner One",
    },
  }],
});

test("matches a posted Marketing CPA journal to its payable bill and partner", () => {
  const result = buildMarketingCpaPayableReconciliation(sourceFixture());

  assert.equal(result.coverageStatus, "SOURCE_SCOPED");
  assert.equal(result.sourceCount, 1);
  assert.equal(result.unmatchedCount, 0);
  assert.equal(result.isReconciled, true);
  assert.equal(result.sources[0].journalDocumentVariance, 0);
  assert.equal(result.sources[0].expectedCpaAmount, 125.75);
  assert.equal(result.sources[0].documentOutstanding, 100);
  assert.equal(result.sources[0].partnerName, "Partner One");
});

test("reports missing and duplicate journals or bills without hiding source rows", () => {
  const fixture = sourceFixture();
  fixture.journalEntries = [];
  fixture.documents.push({ ...fixture.documents[0], id: "bill-duplicate" });

  const result = buildMarketingCpaPayableReconciliation(fixture);

  assert.equal(result.unmatchedCount, 1);
  assert.ok(result.sources[0].issues.includes("MISSING_JOURNAL"));
  assert.ok(result.sources[0].issues.includes("DUPLICATE_BILLS"));
  assert.equal(result.sources[0].isReconciled, false);
});

test("flags amount, party, and document-balance differences", () => {
  const fixture = sourceFixture();
  fixture.journalEntries[0].lines[1].credit = "120.00";
  fixture.journalEntries[0].lines[1].accountingParty.sourceEntityId = "partner-other";
  fixture.documents[0].remainingAmount = "99.00";
  fixture.documents[0].party.sourceEntityId = "partner-other";

  const result = buildMarketingCpaPayableReconciliation(fixture);

  assert.equal(result.unmatchedCount, 1);
  assert.ok(result.sources[0].issues.includes("AMOUNT_MISMATCH"));
  assert.ok(result.sources[0].issues.includes("PARTY_MISMATCH"));
  assert.ok(result.sources[0].issues.includes("DOCUMENT_BALANCE_MISMATCH"));
});

test("flags unsupported bill type, currency, and status", () => {
  const fixture = sourceFixture();
  fixture.documents[0].documentType = "INVOICE";
  fixture.documents[0].currency = "USD";
  fixture.documents[0].status = "CANCELLED";

  const result = buildMarketingCpaPayableReconciliation(fixture);

  assert.ok(result.sources[0].issues.includes("DOCUMENT_TYPE_MISMATCH"));
  assert.ok(result.sources[0].issues.includes("DOCUMENT_CURRENCY_MISMATCH"));
  assert.ok(result.sources[0].issues.includes("DOCUMENT_STATUS_MISMATCH"));
});

test("flags records with no source ID and documents on the wrong side", () => {
  const fixture = sourceFixture();
  fixture.documents[0].side = "RECEIVABLE";
  fixture.documents[0].sourceId = null;

  const result = buildMarketingCpaPayableReconciliation(fixture);

  const unlinkedDocument = result.sources.find(({ sourceId }) => sourceId.startsWith("UNLINKED-BILL:"));
  assert.ok(unlinkedDocument);
  assert.ok(unlinkedDocument.issues.includes("MISSING_SOURCE_ID"));
  assert.ok(unlinkedDocument.issues.includes("DOCUMENT_SIDE_MISMATCH"));
});

test("flags reversed CPA journals and exposes documents without source journals", () => {
  const fixture = sourceFixture();
  fixture.journalEntries[0].status = "REVERSED";
  fixture.journalEntries.push({
    id: "journal-duplicate",
    sourceType: "MARKETING_CPA",
    sourceId: "document-only",
    status: "POSTED",
    lines: [],
  });
  fixture.documents.push({
    ...fixture.documents[0],
    id: "bill-document-only",
    sourceId: "document-only",
  });

  const result = buildMarketingCpaPayableReconciliation(fixture);

  assert.equal(result.sourceCount, 2);
  assert.equal(result.unmatchedCount, 2);
  assert.ok(result.sources.find(({ sourceId }) => sourceId === "redemption-1").issues.includes("JOURNAL_REVERSED"));
  assert.ok(result.sources.find(({ sourceId }) => sourceId === "document-only").issues.includes("JOURNAL_LINES_MISMATCH"));
});

test("reports empty accounting records without claiming full control reconciliation", () => {
  const result = buildMarketingCpaPayableReconciliation();

  assert.equal(result.coverageStatus, "SOURCE_SCOPED");
  assert.equal(result.sourceCount, 0);
  assert.equal(result.isReconciled, false);
  assert.match(result.coverageNote, /Historical redemption events without snapshots remain unverified/);
});

test("flags a positive-rate redemption when both accounting records are missing", () => {
  const result = buildMarketingCpaPayableReconciliation({
    redemptionEvents: sourceFixture().redemptionEvents,
  });

  assert.equal(result.sources[0].expectedCpaAmount, 125.75);
  assert.deepEqual(result.sources[0].issues, ["MISSING_JOURNAL", "MISSING_BILL"]);
  assert.equal(result.unmatchedCount, 1);
});

test("flags a missing payable bill for an otherwise posted CPA accrual", () => {
  const fixture = sourceFixture();
  fixture.documents = [];
  const result = buildMarketingCpaPayableReconciliation(fixture);

  assert.ok(result.sources[0].issues.includes("MISSING_BILL"));
  assert.equal(result.sources[0].isReconciled, false);
});

test("recognizes a zero-rate partner redemption without expecting CPA accounting", () => {
  const result = buildMarketingCpaPayableReconciliation({
    redemptionEvents: [{
      id: "event-zero",
      eventType: "BENEFIT_REDEEMED",
      referenceId: "redemption-zero",
      metadata: { redemptionId: "redemption-zero", cpaRateSnapshot: "0" },
    }],
  });

  assert.equal(result.sources[0].status, "NO_CPA_EXPECTED");
  assert.equal(result.sources[0].isReconciled, true);
  assert.equal(result.sources[0].expectedCpaAmount, 0);
});

test("keeps historical or invalid CPA-rate snapshots unknown instead of guessing", () => {
  const result = buildMarketingCpaPayableReconciliation({
    redemptionEvents: [
      {
        id: "event-legacy",
        eventType: "BENEFIT_REDEEMED",
        referenceId: "redemption-legacy",
        metadata: { redemptionId: "redemption-legacy" },
      },
      {
        id: "event-invalid",
        eventType: "BENEFIT_REDEEMED",
        referenceId: "redemption-invalid",
        metadata: { redemptionId: "redemption-invalid", cpaRateSnapshot: "" },
      },
    ],
  });

  const legacy = result.sources.find(({ sourceId }) => sourceId === "redemption-legacy");
  const invalid = result.sources.find(({ sourceId }) => sourceId === "redemption-invalid");
  assert.equal(legacy.expectedCpaAmount, null);
  assert.ok(legacy.issues.includes("CPA_RATE_SNAPSHOT_UNKNOWN"));
  assert.ok(invalid.issues.includes("CPA_RATE_SNAPSHOT_INVALID"));
  assert.equal(result.rateSnapshotUnknownCount, 1);
  assert.equal(result.isReconciled, false);
});

test("does not treat customer-claimed checkout rewards as partner CPA redemption events", () => {
  const result = buildMarketingCpaPayableReconciliation({
    redemptionEvents: [
      { id: "checkout-event", eventType: "CUSTOMER_REWARD_REDEEMED", referenceId: "reward-1", metadata: {} },
    ],
  });

  assert.equal(result.sourceCount, 0);
  assert.equal(result.isReconciled, false);
});
