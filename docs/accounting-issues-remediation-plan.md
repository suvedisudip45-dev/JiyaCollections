# Comprehensive Accounting System Remediation & Modernization Plan

**Project:** Aama Clothings (Jiya Collections)  
**Status:** Approved Remediation Plan  
**Prepared:** 2026-10-29  
**Scope:** Complete resolution of technical, operational, and architectural accounting defects across GL, Treasury, AP/AR, Manufacturer, and Distributor modules.  
**Authority:** `docs/accounting-system-redesign.md` and `docs/accounting/04-target-accounting-domain-model.md` remain the accounting policy baseline.

---

## 1. Executive Summary & Defect Inventory

This plan unifies the original security/audit findings and the operational/data-integrity review into a concrete, phased roadmap. Each iteration is strictly isolated, independently tested, and guarded by explicit exit gates.

### Defect Inventory Table

| ID | Category | Severity | Issue Summary | Exact Code / Schema Location | Target Architectural Fix |
|---|---|---|---|---|---|
| **I-1** | Production & Inventory | **High** | Production completion debits company inventory and recognizes manufacturer AP before delivery. | `completeProduction()` in `manufacturerProductionController.js` (lines 693–727) | Remove GL posting from production completion; record cost layer only; recognize inventory/COGS at delivery (consignment). |
| **I-2** | Payout Evidence | **High** | Payout status marks records "paid" immediately without verified bank transfer evidence or lifecycle tracking. | `payManufacturerSettlement()` & `executeAdminDistributorSettlement()` | Implement multi-state payment lifecycle: transfer reference is *evidence*, requiring reconciliation to confirm settlement. |
| **I-3** | Internal Controls | **High** | Manufacturer self-reported production counts drive inventory and payable without an Admin acceptance gate. | `completeProduction()` in `manufacturerProductionController.js` | Introduce Admin Acceptance & QA Gate (`ACCEPT_PRODUCTION`) before stock enters available inventory. |
| **I-4** | Subledger Integrity | **Med-High** | Distributor settlements split between subledger-backed and unverified legacy AP creation. | `submitDistributorSettlementRequest()` in `distributorFinanceService.js` | Enforce subledger document backing; replace raw amount AP creation with verified claim documents. |
| **I-5** | Document Lineage | **Medium** | Manufacturer payables are calculated from aggregate GL lines rather than discrete, bill-level accounting documents. | `getManufacturerSettlementSummary()` in `manufacturerSettlementService.js` | Generate discrete `AccountingDocument` (BILL) per completed production batch at customer delivery. |
| **I-6** | Treasury Controls | **Medium** | Treasury currency validation missing; payout accounts default to arbitrary bank GL mappings. | `treasuryAccountingService.js` & `accountingPostingEngine.js` | Enforce currency matching (NPR) and explicit GL account code mapping for CASH, BANK, and WALLET accounts. |
| **I-7** | Data Precision & State Split | **High** | `FinancialAccount.currentBalance`, `CashTransaction.amount`, `AccountPayable`, and `AccountReceivable` store `Float` balances while GL uses `Decimal(18, 4)`. Independently mutable balances diverge. | `schema.prisma` lines 1029, 1049, 1441–1443, 1465–1467 | Additive migration to `Decimal(18, 4)`; deprecate manual balance updates; derive real-time balances from immutable ledger entries. |
| **I-8** | Entity Attribution | **Medium** | Manufacturer settlement summaries match lines by supplier name string fallback and calculate completed payments only from settlement requests. | `manufacturerSettlementService.js` lines 7–10, 117 | Eliminate name-string matching (require strict `partyId` / `supplierId`); compute completed payments from subledger allocations and linked cash transactions. |
| **I-9** | Trapped Requests | **Med-High** | Distributor settlement requests with legacy earnings are tagged `LEGACY_EARNINGS_RECONCILIATION_REQUIRED` and permanently blocked with no resolution path. | `distributorFinanceService.js` lines 513–520, 598–603 | Create an administrative earning backfill script and reconciliation resolution workflow to unblock valid pending requests. |
| **I-10** | Supplier Credits | **Medium** | Returned items and defects are netted mathematically in settlement summaries rather than tracked as formal Credit/Debit Notes applied to bills. | `manufacturerSettlementService.js` lines 76–84, 114 | Introduce explicit `DEBIT_NOTE` / `CREDIT_NOTE` `AccountingDocument` workflow with audit-logged `AccountingAllocation`. |
| **I-11** | Payment Lifecycle | **High** | Payout status treated as binary (UNPAID/PAID) with single reference field, failing to reflect modern banking and reconciliation states. | `schema.prisma`, `manufacturerFinanceController.js`, `distributorFinanceService.js` | Implement finite state machine: `DRAFT` -> `APPROVED` -> `INITIATED` -> `SETTLED` (or `FAILED` / `REVERSED` / `RECONCILED`). |
| **I-12** | Audit & Cutover | **High** | No isolated environment test harness or opening balance reconciliation runbook for data migration and statutory sign-off. | Operational rollout | Build isolated database test suite for concurrent payouts, backfills, reversals, and establish Nepal accountant sign-off gates. |

---

## 2. Core Architectural Invariants

Every proposed code and schema modification must adhere to these non-negotiable principles:

1. **Posted Journals are Immutable:** A posted `JournalEntry` and `JournalLine` can never be edited or deleted. Corrections are strictly posted as linked reversal entries (`REVERSAL`).
2. **Consignment Inventory Model:** Goods produced by manufacturers remain manufacturer-owned consignment inventory. Merchandise inventory asset (Account `1140`) and Manufacturer Payable (Account `2160`) are recognized **only upon delivery to customer**, never at production completion.
3. **Decimal Precision Throughout:** All monetary figures, exchange rates, and transaction balances must be stored and computed using `Prisma.Decimal` or arbitrary-precision math. JavaScript IEEE 754 `Number` floating point math is prohibited for monetary storage.
4. **Subledger-to-GL Lineage:** Every operational transaction (cash movement, bill, invoice, credit note) must possess a 1-to-1 or 1-to-many link to an `AccountingDocument`, `AccountingEvent`, and balanced `JournalEntry`.
5. **Separation of Evidence and Proof:** A bank reference number entered by an operator is *payment evidence*. It transitions a payout to `INITIATED`. Final settlement (`SETTLED`) requires bank confirmation or reconciliation against an uploaded bank statement / statement line.
6. **Additive Schema Migrations Only:** Never drop tables or existing columns during ongoing operations. New fields are nullable or default-valued. Legacy columns are populated via dual-write until formally deprecated.
7. **Strict Idempotency:** Every financial mutation endpoint must require an `idempotencyKey` and enforce atomic database transactions via Prisma interactive transactions (`$transaction`).

---

## 3. Sequence & Dependency Graph

The remediation is organized into 13 discrete iterations (Iterations A through M) to prevent circular blockers and ensure incremental testability:

```
[Phase 1: Consignment & Controls Core]
Iteration A: Remove Premature Inventory Debit (I-1)
       │
       ├──► Iteration B: Admin Acceptance & QA Gate (I-3)
       │
       └──► Iteration C: Payment Lifecycle FSM & Evidence Tracking (I-2, I-11)
                   │
[Phase 2: Subledger & Document Maturation]
                   ├──► Iteration D: Bill-Level Manufacturer Payables (I-5)
                   │           │
                   │           ├──► Iteration E: Manufacturer Attribution & Payout Aggregation (I-8)
                   │           │
                   │           └──► Iteration F: Supplier Credit Note Workflow (I-10)
                   │
                   └──► Iteration G: Distributor Backfill & Reconciliation Workflow (I-4, I-9)
                               │
[Phase 3: Balance Integrity & Treasury Controls]
                               ├──► Iteration H: Float to Decimal Migration & Balance Derivation (I-7)
                               │
                               ├──► Iteration I: Treasury Currency & Account Controls (I-6)
                               │
                               └──► Iteration J: Gross Separation of COD & Service Payables
                                           │
[Phase 4: Verification, Audit & Cutover]
                                           ├──► Iteration K: Isolated Sandbox Concurrency & Stress Testing (I-12)
                                           │
                                           ├──► Iteration L: Accountant Review & Opening Balance Reconciliation
                                           │
                                           └──► Iteration M: Policy & Architecture Documentation Reconciliation
```

---

## 4. Detailed Iteration Plans

---

### Iteration A — Remove Premature Inventory Debit at Production Completion (I-1)

**Target:** Eliminate premature balance sheet expansion (inventory debit & payable credit) when a manufacturer marks a production batch complete.  
**Files Affected:**
- `backend/controllers/manufacturerProductionController.js` (function `completeProduction`)
- `backend/services/inventoryCostService.js`
- `backend/tests/manufacturerProductionCompletion.test.js` (new)

#### Analysis & Code Change
Currently, `completeProduction()` executes:
```javascript
// Lines 694-727 in manufacturerProductionController.js
await postJournalEntry({
  mappingKey: "INVENTORY", // Debits 1140 Merchandise Inventory
  creditAccount: "MANUFACTURER_PAYABLE", // Credits 2160
  amount: productionCogs,
  ...
});
```
This violates the consignment model where the manufacturer retains title until delivery to end consumers.

#### Implementation Steps
1. In `completeProduction()`, remove the call to `postJournalEntry()`.
2. Retain `ManufacturerInventory` quantity updates and `receiveCompletedProductionLine()` cost-layer creation.
3. Record a durable, non-posting `AccountingEvent`:
   ```javascript
   await tx.accountingEvent.create({
     data: {
       idempotencyKey: `MANUFACTURER_PRODUCTION:${request.id}`,
       sourceType: "MANUFACTURER_PRODUCTION",
       sourceId: request.id,
       eventType: "PRODUCTION_COMPLETED_COST_LAYER",
       status: "POSTED",
       payload: {
         productionQuantity,
         unitCost: fullyLoadedUnitCogs.toFixed(4),
         manufacturerId: request.manufacturerId,
         productId: request.productId
       }
     }
   });
   ```
4. Delivery path (`postDeliveredOrderAccounting`) remains the sole recognized trigger for DR COGS (Account `5100`) and CR Manufacturer Payable (Account `2160`).

#### Exit Gate Tests
- [ ] Production completion increases `ManufacturerInventory` without creating any `JournalEntry` or `JournalLine`.
- [ ] GL Account `1140` and `2160` remain unchanged after production completion.
- [ ] Delivery of an order containing consignment stock correctly debits COGS and credits Manufacturer Payable based on recorded cost layers.
- [ ] Unit test `manufacturerProductionCompletion.test.js` passes with 100% assertions.

---

### Iteration B — Admin Quality & Quantity Acceptance Gate (I-3)

**Target:** Prevent manufacturer self-reported counts from automatically updating cost layers and stock records without admin verification.  
**Files Affected:**
- `backend/prisma/schema.prisma`
- `backend/controllers/manufacturerProductionController.js`
- `backend/routes/manufacturerProductionRoute.js`
- `backend/tests/manufacturerProductionAdminAcceptance.test.js` (new)

#### Schema Changes
```prisma
enum ProductionStatus {
  PENDING
  ACCEPTED
  IN_PRODUCTION
  SUBMITTED_FOR_REVIEW  // Manufacturer reported completion
  ACCEPTED_BY_ADMIN     // Admin QA passed
  REJECTED_BY_ADMIN     // Quality/count dispute
  CANCELLED
}
```

#### Implementation Steps
1. Update `completeProduction()`: instead of transitioning directly to `COMPLETED`, update request status to `SUBMITTED_FOR_REVIEW`.
2. Create endpoint `POST /api/manufacturer/production/:id/accept` (Admin role required):
   - Admin inspects physical delivery, enters accepted quantity and rejected quantity.
   - Updates `ManufacturerInventory` and creates `ManufacturerInventoryCostLayer` strictly for the *accepted* quantity.
   - If rejected quantity > 0, generate a `PRODUCTION_REJECTION_REPORT` record.
   - Transitions status to `ACCEPTED_BY_ADMIN`.

#### Exit Gate Tests
- [ ] Manufacturer submitting production cannot directly increment cost layers.
- [ ] Admin acceptance with full count updates cost layers accurately.
- [ ] Admin acceptance with partial count only records cost layers for accepted units.
- [ ] Non-admin callers receive HTTP 403 Forbidden on the acceptance endpoint.

---

### Iteration C — Payment Lifecycle State Machine & Transfer Evidence (I-2, I-11)

**Target:** Replace immediate "PAID" status with a multi-step lifecycle distinguishing operator evidence from actual settlement.  
**Files Affected:**
- `backend/prisma/schema.prisma`
- `backend/services/paymentLifecycleService.js` (new)
- `backend/controllers/manufacturerFinanceController.js`
- `backend/services/distributorFinanceService.js`
- `backend/tests/paymentLifecycle.test.js` (new)

#### Schema Changes
```prisma
enum PayoutLifecycleStatus {
  DRAFT
  APPROVED
  INITIATED        // Reference provided, money in flight
  SETTLED          // Bank confirmed / statement matched
  RECONCILED       // GL matched with periodic bank audit
  FAILED           // Bank returned / rejected
  REVERSED         // Voided by admin
}

model PayoutTransaction {
  id                        String                @id @default(uuid())
  idempotencyKey            String                @unique @db.VarChar(191)
  payoutType                String                // MANUFACTURER_SETTLEMENT, DISTRIBUTOR_SETTLEMENT
  sourceRequestId           String                @db.VarChar(191)
  financialAccountId        String                @db.VarChar(191)
  amount                    Decimal               @db.Decimal(18, 4)
  currency                  String                @default("NPR")
  status                    PayoutLifecycleStatus @default(DRAFT)
  externalPaymentReference  String?               @db.VarChar(191)
  proofDocumentUrl          String?               @db.Text
  initiatedByAdminId        String?
  initiatedAt               DateTime?
  settledAt                 DateTime?
  failedAt                  DateTime?
  failureReason             String?               @db.Text
  reconciledAt              DateTime?
  reconciliationBatchId     String?
  journalEntryId            String?               @db.VarChar(191)
  createdAt                 DateTime              @default(now())
  updatedAt                 DateTime              @updatedAt

  financialAccount          FinancialAccount      @relation(fields: [financialAccountId], references: [id])

  @@index([sourceRequestId, payoutType])
  @@index([status])
  @@index([externalPaymentReference])
}
```

#### Lifecycle State Transitions
1. **Approve:** Admin reviews request -> status moves from `DRAFT` to `APPROVED`.
2. **Initiate (`initiatePayout`):** Admin executes bank transfer, enters bank transaction code and uploads receipt -> status becomes `INITIATED`.
   - Decrements account available balance (holds funds).
   - Posts suspense/in-flight journal if configured, or leaves settlement journal pending.
3. **Settle (`settlePayout`):** Admin or automated bank statement webhook verifies fund delivery -> status becomes `SETTLED`.
   - Posts primary GL settlement journal: DR Accounts Payable (Account `2160`/`2150`), CR Cash/Bank (Account `1110`/`1120`).
   - Marks parent settlement request `PAID`.
4. **Fail (`failPayout`):** Bank transfer rejected -> status becomes `FAILED`.
   - Releases held balance, marks settlement request `REOPENED`.

#### Exit Gate Tests
- [ ] Transfer reference alone moves status to `INITIATED`, not `SETTLED`.
- [ ] Settlement journal is only posted upon entering `SETTLED`.
- [ ] Rejection of an initiated payout correctly restores payable balances without orphan journal lines.
- [ ] Idempotency prevents duplicate initiation requests for the same payout.

---

### Iteration D — Bill-Level Manufacturer Payables & Subledger Allocation (I-5)

**Target:** Transition manufacturer payables from ad-hoc GL aggregations to discrete, bill-level `AccountingDocument` entities.  
**Files Affected:**
- `backend/services/accountingPostingEngine.js`
- `backend/services/accountingSubledgerService.js`
- `backend/services/manufacturerSettlementService.js`
- `backend/tests/manufacturerBillLevelPayable.test.js` (new)

#### Implementation Steps
1. Upon delivery of goods (in `postDeliveredOrderAccounting`):
   - Create an `AccountingDocument` of type `BILL` with `side: "PAYABLE"`:
     - `documentNumber`: `BILL-MFG-{ORDER_ID}-{LINE_ID}`
     - `partyId`: Manufacturer accounting party ID
     - `originalAmount`: Cost layer amount for the delivered units
     - `remainingAmount`: Original amount
     - `status`: `OPEN`
2. Update `allocateManufacturerPaymentToDocuments()`:
   - When a payout is settled, allocate the payment amount FIFO against outstanding `BILL` documents.
   - Record an `AccountingAllocation` linking payment `JournalEntry` and the `AccountingDocument`.
3. In `getManufacturerSettlementSummary()`, read outstanding balances directly from `AccountingDocument` aggregates rather than parsing raw GL lines.

#### Exit Gate Tests
- [ ] Every delivered customer order with consignment items generates a discrete `BILL` document.
- [ ] Partial payments correctly reduce `remainingAmount` on targeted bills.
- [ ] Outstanding manufacturer payable equals the sum of `remainingAmount` across all `OPEN` / `PARTIALLY_PAID` bills.

---

### Iteration E — Robust Entity Attribution & Direct Payment Aggregation (I-8)

**Target:** Eliminate fragile string name matching and ensure all valid payment routes are reflected in manufacturer settlement summaries.  
**Files Affected:**
- `backend/services/manufacturerSettlementService.js`
- `backend/tests/manufacturerAttribution.test.js` (new)

#### Code Changes in `manufacturerSettlementService.js`
1. **Remove string name matching fallback (lines 7–10):**
   ```javascript
   // Strict new implementation
   const isManufacturerLine = (line, manufacturerPartyId) =>
     line.accountingPartyId === manufacturerPartyId || line.supplierId === manufacturerPartyId;
   ```
2. **Compute `completedPayments` from ledger truth (line 117):**
   - Replace settlement-request only aggregation with actual settled payout documents and linked `SUPPLIER_PAYMENT` cash transactions:
   ```javascript
   const completedPayments = await client.accountingAllocation.aggregate({
     where: {
       document: { party: { sourceEntityId: manufacturerId, partyType: "MANUFACTURER" } }
     },
     _sum: { allocatedAmount: true }
   });
   ```

#### Exit Gate Tests
- [ ] Two manufacturers with identical names but different UUIDs never share or cross-pollinate journal lines.
- [ ] Payments made directly through admin manual supplier payments are reflected in `completedPayments`.
- [ ] Name changes to a manufacturer profile do not alter historical statement attribution.

---

### Iteration F — Supplier Credit Note & Return Workflow (I-10)

**Target:** Formalize manufacturer returns, damaged goods, and debit notes into discrete documents instead of implicit mathematical netting.  
**Files Affected:**
- `backend/prisma/schema.prisma`
- `backend/services/accountingSubledgerService.js`
- `backend/services/customerReturnWorkflowService.js`
- `backend/services/manufacturerSettlementService.js`
- `backend/tests/supplierCreditWorkflow.test.js` (new)

#### Implementation Steps
1. When a returned item is received at the warehouse and confirmed defective or returned to manufacturer:
   - Create an `AccountingDocument` with `type: "DEBIT_NOTE"`, `side: "RECEIVABLE"` (Company has a claim against the manufacturer).
   - Post balanced journal: DR Supplier Claim / Return Receivable (Account `1195`), CR Inventory/COGS (Account `5100`/`1140`).
2. Provide explicit Admin workflow: **Apply Credit to Bill (`applySupplierCreditToBill`)**:
   - Creates an `AccountingAllocation` linking the `DEBIT_NOTE` to an open `BILL`.
   - Posts netting journal: DR Manufacturer Payable (Account `2160`), CR Supplier Claim (Account `1195`).
   - Reduces `remainingAmount` on both documents simultaneously.
3. Remove automatic mathematical netting in `getManufacturerSettlementSummary()`; display gross outstanding bills and available credit notes separately until explicitly applied.

#### Exit Gate Tests
- [ ] Defective return generates a formal `DEBIT_NOTE` `AccountingDocument`.
- [ ] Applying a credit note to an open bill reduces balances on both documents with an explicit two-leg journal.
- [ ] Unapplied credit notes appear as available deductions, not silent automatic reductions.

---

### Iteration G — Distributor Backfill & Trapped Settlement Resolution (I-4, I-9)

**Target:** Unblock distributor requests flagged as `LEGACY_EARNINGS_RECONCILIATION_REQUIRED` via an audited administrative reconciliation and backfill utility.  
**Files Affected:**
- `backend/services/distributorFinanceService.js`
- `backend/scripts/backfillDistributorEarningDocuments.js` (new)
- `backend/controllers/distributorFinanceController.js`
- `backend/tests/distributorReconciliationResolution.test.js` (new)

#### Implementation Steps
1. **Reconciliation Backfill Tool:**
   - Develop `backfillDistributorEarnings({ distributorId, cutoffDate, dryRun = true })`.
   - Identifies delivered assignments lacking `DistributorServiceEarning` or `AccountingDocument`.
   - Synthesizes proper earning records based on the historical snapshotted rate card.
   - Creates linked `AccountingDocument` (CLAIM) in `OPEN` state.
2. **Administrative Resolution Endpoint:**
   - Add `POST /api/admin/distributor/settlements/:id/resolve-reconciliation`:
     - Allows Admin to review matched synthesized documents.
     - Transitions settlement basis from `LEGACY_EARNINGS_RECONCILIATION_REQUIRED` to `ADMIN_RECONCILED_SUBLEDGER`.
     - Links verified document IDs to settlement request metadata.
     - Unblocks standard execution via `executeAdminDistributorSettlement()`.
3. Eliminate legacy code branch that creates raw unbacked `AccountPayable` rows from unverified input amounts.

#### Exit Gate Tests
- [ ] Backfill script runs in dry-run mode without modifying records, producing detailed variance report.
- [ ] Running backfill script in commit mode successfully generates missing subledger documents.
- [ ] Resolving a trapped request allows normal payment execution.
- [ ] New requests without matched documents are rejected immediately at submission time rather than trapped in perpetual pending state.

---

### Iteration H — Float to Decimal Migration & Balance Derivation (I-7)

**Target:** Eliminate floating-point rounding errors and resolve split mutable state between `FinancialAccount.currentBalance`, `CashTransaction.amount`, `AccountPayable`, and the General Ledger.  
**Files Affected:**
- `backend/prisma/schema.prisma`
- Database migrations
- `backend/services/treasuryAccountingService.js`
- `backend/controllers/financialController.js`
- `backend/tests/decimalPrecisionAndBalanceDerivation.test.js` (new)

#### Additive Migration Plan
```prisma
// Phase 1 Additive Columns
model FinancialAccount {
  // Existing: currentBalance Float @default(0)
  currentBalanceDecimal   Decimal?  @db.Decimal(18, 4)
  clearedBalanceDecimal   Decimal?  @db.Decimal(18, 4)
}

model CashTransaction {
  // Existing: amount Float
  amountDecimal           Decimal?  @db.Decimal(18, 4)
}

model AccountPayable {
  // Existing: totalAmount, paidAmount, remainingBalance Float
  totalAmountDecimal      Decimal?  @db.Decimal(18, 4)
  paidAmountDecimal       Decimal?  @db.Decimal(18, 4)
  remainingBalanceDecimal Decimal?  @db.Decimal(18, 4)
}

model AccountReceivable {
  // Existing: totalAmount, receivedAmount, remainingBalance Float
  totalAmountDecimal      Decimal?  @db.Decimal(18, 4)
  receivedAmountDecimal   Decimal?  @db.Decimal(18, 4)
  remainingBalanceDecimal Decimal?  @db.Decimal(18, 4)
}
```

#### Dual-Write & Reconciliation Strategy
1. **Migration 1:** Add Decimal columns with nullable definitions.
2. **Backfill Script:** Convert historical float values to Decimal with exact banker's rounding (`ROUND_HALF_UP` to 4 decimal places).
3. **Application Dual-Write:** Update all service writes to populate both Float and Decimal columns.
4. **Balance Derivation Engine:** Implement real-time ledger balance validation comparing cached balances against ledger totals.
5. **Phase 2 Migration (post-reconciliation):** Enforce `NOT NULL` on Decimal columns and mark Float columns as deprecated.

#### Exit Gate Tests
- [ ] Financial calculations with large volumes do not lose cents (0.1 + 0.2 === 0.3 precision invariant).
- [ ] Dual-write writes identical precision to Decimal columns.
- [ ] GL aggregate balance matches `FinancialAccount.currentBalanceDecimal` with zero variance.

---

### Iteration I — Treasury Currency, Multi-Asset & Mapping Controls (I-6)

**Target:** Enforce currency matching and prevent invalid fallback GL account mappings for treasury operations.  
**Files Affected:**
- `backend/services/treasuryAccountingService.js`
- `backend/services/accountingPostingEngine.js`
- `backend/tests/treasuryCurrencyAndMapping.test.js` (new)

#### Implementation Steps
1. Require currency validation:
   - Financial accounts must explicitly define currency (`NPR`).
   - Payout requests must specify currency; reject transactions with mismatched currencies until multi-currency FX revaluation is enabled.
2. Mandatory GL Account Link:
   - Reject any cash or bank transaction on a `FinancialAccount` that lacks a linked `accountingAccountId` (`Account` record).
   - Remove automatic fallback to generic `"BANK"` (Account `1120`) when paying from a `WALLET` or `CASH` account.
   - Enforce distinct mappings:
     - `CASH` -> `1110 Cash in Hand`
     - `BANK` -> `1120 Bank Accounts`
     - `WALLET` -> `1130 Digital Wallets & Payment Gateways`

#### Exit Gate Tests
- [ ] Payout from a `WALLET` account without a dedicated 1130 GL account throws `UNMAPPED_TREASURY_ACCOUNT` error.
- [ ] Currency mismatch throws `CURRENCY_MISMATCH_ERROR`.
- [ ] Journal entry lines generated from treasury transfers reflect the exact GL code linked to the selected account.

---

### Iteration J — Gross Separation of COD Receivables & Service Payables

**Target:** Prevent unremitted COD receivables from being silently netted against distributor service earnings, maintaining gross legal presentation.  
**Files Affected:**
- `backend/services/distributorFinanceService.js`
- `backend/tests/codAndServicePayableGross.test.js` (new)

#### Implementation Steps
1. In `executeAdminDistributorSettlement()`:
   - Check outstanding unremitted COD on the distributor.
   - If outstanding COD > 0, do not silently subtract from service earnings payout.
   - Return an explicit warning code `UNREMITTED_COD_OUTSTANDING` with the exact outstanding COD amount.
2. In `netDistributorRefundPayable()`:
   - Ensure netting is recorded via an explicit two-leg journal:
     - DR Customer Refund Payable (Account `2140`)
     - CR Distributor COD Receivable (Account `1190`)
   - Both original gross documents maintain full audit lineage.

#### Exit Gate Tests
- [ ] Paying distributor service fee when COD is owed triggers an audit warning but retains gross payment amount.
- [ ] Netting customer refunds against COD creates explicit two-leg journal with `AccountingAllocation` entries.
- [ ] Gross balance sheet presentation accurately reflects both receivables and payables.

---

### Iteration K — Isolated Sandbox Concurrency, Stress Testing & Edge Cases (I-12)

**Target:** Validate full system behavior under high concurrency, race conditions, network failures, and edge cases in an isolated database sandbox.  
**Files Affected:**
- `backend/tests/isolated/` (new test suite)
- `backend/tests/isolated/concurrencyPayouts.test.js`
- `backend/tests/isolated/duplicateRequests.test.js`
- `backend/tests/isolated/reversalsAndFailures.test.js`
- `backend/tests/isolated/periodCloseAndCutover.test.js`

#### Test Scenarios & Invariants
1. **Concurrent Payouts:** 10 simultaneous payout execution requests with identical or different idempotency keys against the same financial account.
   - *Invariant:* Exactly 1 request succeeds; 9 receive idempotency replay or lock contention error. Account balance is debited exactly once.
2. **Partial Payments & Rounding:** Series of 3 partial payments of odd amounts (e.g., 33.33 NPR on a 100.00 NPR bill).
   - *Invariant:* Sum of allocated amounts + remaining amount equals exactly 100.0000 NPR with zero penny leakage.
3. **Failed Transfer & Reversal:** Simulate bank transfer failure after initiation.
   - *Invariant:* Payout status transitions to `FAILED`; held funds are released; settlement journal is not committed; audit log records failure reason.
4. **Period Close Protection:** Attempt posting an operational transaction with effective date inside a closed Nepali fiscal period.
   - *Invariant:* System rejects transaction with `PERIOD_CLOSED` error; requires administrative adjustment entry in an open period.

#### Exit Gate Tests
- [ ] All 4 isolated sandbox test suites execute with 0 failures under parallel worker execution.
- [ ] Zero database deadlocks encountered during concurrent transaction execution.

---

### Iteration L — Accountant Review, Opening Balance Audit & Production Cutover Runbook

**Target:** Obtain formal sign-off from a qualified Nepal Chartered Accountant (ICAN registered) and execute cutover runbook with zero downtime or data loss.  
**Deliverables:**
- `docs/accounting/opening-balance-reconciliation-report.md`
- `docs/accounting/accountant-sign-off-checklist.md`
- `backend/scripts/verifyLedgerIntegrity.js`

#### Statutory Decision Gates
| Item | Statute / Standard | Key Decision Required | Code Impact |
|---|---|---|---|
| **Consignment COGS Recognition** | NAS 18 / NFRS 15 | Confirm title passes at delivery to retail customer, not factory completion. | Confirms Iteration A & B behavior. |
| **VAT Input Credit Split** | Nepal Value Added Tax Act, 2052 | Determine if manufacturer tax invoice is required prior to claiming input VAT on production materials. | Affects input VAT line generation in `postDeliveredOrderAccounting`. |
| **Withholding Tax (TDS)** | Nepal Income Tax Act, 2058 (Sec 88/89) | Determine whether 1.5% TDS on goods or 15% on services applies to manufacturer and distributor payouts. | If applicable, payout FSM automatically generates TDS Payable (Account `2125`) deduction. |
| **Customer Price VAT Inclusion** | Nepal VAT Guidelines | Confirm whether retail display prices are 13% VAT-inclusive or VAT-exclusive. | Governs revenue split between Sales (Account `4100`) and Output VAT (Account `2120`). |

#### Production Cutover Steps
1. Put accounting engine in read-only maintenance window (5 minutes).
2. Execute additive migrations (`prisma migrate deploy`).
3. Run `backfillDistributorEarningDocuments.js` and `backfillDecimalBalances.js`.
4. Run `verifyLedgerIntegrity.js`:
   - Verify Trial Balance: Total Debits == Total Credits.
   - Verify Bank Balance: Sum of Cash Transactions == FinancialAccount Decimal balance.
   - Verify Subledger: Sum of open `AccountingDocument` balances == Balance Sheet AP/AR account balances.
5. Obtain sign-off from Head of Finance and Owner.
6. Enable updated application servers.

---

### Iteration M — Policy & Architecture Documentation Harmonization

**Target:** Synchronize all historical and active architectural documents so that policy, schema, and runtime code speak with one single voice.  
**Files Affected:**
- `docs/accounting-system-redesign.md`
- `docs/accounting/04-target-accounting-domain-model.md`
- `docs/accounting/03-implementation-plan-and-iteration-tracker.md`
- `ACCOUNTING_AND_FINANCIAL_SYSTEM_REFERENCE.md`

#### Updates Required
1. Update posting matrices in `04-target-accounting-domain-model.md` to state explicitly:
   - Production Completion: No GL posting.
   - Customer Delivery: DR COGS (Account `5100`), CR Manufacturer Payable (Account `2160`).
2. Add the Payment Lifecycle State Machine diagram and specification to `ACCOUNTING_AND_FINANCIAL_SYSTEM_REFERENCE.md`.
3. Update `03-implementation-plan-and-iteration-tracker.md` with all 13 iterations, assigned engineers, and verification statuses.

---

## 5. Master Regression Test Suite & Verification Commands

To guarantee non-regression of core commerce, delivery, and marketing functions, execute the test suites after each iteration:

```bash
# Per-iteration focused suites
node --test backend/tests/manufacturerProductionCompletion.test.js
node --test backend/tests/manufacturerProductionAdminAcceptance.test.js
node --test backend/tests/paymentLifecycle.test.js
node --test backend/tests/manufacturerBillLevelPayable.test.js
node --test backend/tests/manufacturerAttribution.test.js
node --test backend/tests/supplierCreditWorkflow.test.js
node --test backend/tests/distributorReconciliationResolution.test.js
node --test backend/tests/decimalPrecisionAndBalanceDerivation.test.js
node --test backend/tests/treasuryCurrencyAndMapping.test.js
node --test backend/tests/codAndServicePayableGross.test.js

# Full end-to-end accounting regression suite
node --test \
  backend/tests/accountingEngine.test.js \
  backend/tests/accountingOperationalPosters.test.js \
  backend/tests/accountingOutbox.test.js \
  backend/tests/accountingSubledger.test.js \
  backend/tests/distributorSelfDeliveryAndFinance.test.js \
  backend/tests/distributorCashSettlement.test.js \
  backend/tests/manufacturerSettlementService.test.js \
  backend/tests/settlementIdempotencyAndRevert.test.js \
  backend/tests/ncmSettlementService.test.js \
  backend/tests/treasuryAccountingService.test.js \
  backend/tests/deliveryAccountingOutboxIntegration.test.js

# Isolated sandbox concurrency and stress suite
node --test \
  backend/tests/isolated/concurrencyPayouts.test.js \
  backend/tests/isolated/duplicateRequests.test.js \
  backend/tests/isolated/reversalsAndFailures.test.js \
  backend/tests/isolated/periodCloseAndCutover.test.js
```

---

## 6. Project Sign-Off Tracker

| Iteration | Description | Primary Owner | Reviewer | Status |
|---|---|---|---|---|
| **Iteration A** | Remove Premature Inventory Debit | Backend Engineer | Lead Architect | ◻ Ready |
| **Iteration B** | Admin Acceptance & QA Gate | Backend Engineer | Operations Lead | ◻ Ready |
| **Iteration C** | Payment Lifecycle FSM & Evidence | Backend Engineer | Compliance Officer | ◻ Ready |
| **Iteration D** | Bill-Level Manufacturer Payables | Backend Engineer | Lead Architect | ◻ Ready |
| **Iteration E** | Manufacturer Attribution & Payouts | Backend Engineer | Lead Architect | ◻ Ready |
| **Iteration F** | Supplier Credit Note Workflow | Backend Engineer | Finance Lead | ◻ Ready |
| **Iteration G** | Distributor Backfill & Resolution | Backend Engineer | Logistics Lead | ◻ Ready |
| **Iteration H** | Float to Decimal Migration | Database Engineer | Lead Architect | ◻ Ready |
| **Iteration I** | Treasury Currency & Mapping Controls | Backend Engineer | Treasury Lead | ◻ Ready |
| **Iteration J** | COD Gross Separation | Backend Engineer | Finance Lead | ◻ Ready |
| **Iteration K** | Sandbox Concurrency & Stress Testing | QA Engineer | Lead Architect | ◻ Ready |
| **Iteration L** | Accountant Review & Cutover | Chartered Accountant | Owner / Admin | ◻ Ready |
| **Iteration M** | Policy & Documentation Harmonization | Tech Writer / Architect | Team | ◻ Ready |
