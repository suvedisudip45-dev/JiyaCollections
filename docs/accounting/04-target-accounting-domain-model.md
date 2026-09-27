# Accounting Design 04: Target Domain Model And Posting Rules

**Status:** Owner-approved business policy translated into a provisional technical design. No Prisma schema or production accounting flow is changed in this document.  
**Policy decisions:** Confirmed by the owner on 2026-09-28.  
**Review gate:** Tax account classifications, fiscal-calendar conversion and final statutory reporting require qualified accountant review.

## Design Principles

1. The General Ledger is the authoritative posted financial record; commerce, delivery and treasury state are source evidence, not alternate P&Ls.
2. One posted journal represents one accounting event. Manufacturer payable and manufacturer receivable are opposite views of one party-document balance, not separately posted balances.
3. Events have stable source keys and are safe to retry. No controller fire-and-forget GL calls.
4. Snapshots capture approved commercial terms before posting. Later product, inventory, commission, tax-rate or party-name changes do not rewrite history.
5. Amount calculations use exact decimal arithmetic and a documented NPR rounding rule; JavaScript floating-point math is not the posting authority.
6. Posted entries are immutable. Corrections use linked reversal/adjustment events.
7. A confirmed manufacturer return is a physical receipt/inspection event, not merely an NCM return request. A pre-delivery return has no sale/COGS entry; a post-delivery return reverses linked entries after receipt confirmation.

## Owner-Approved Business Rules

| Rule | Approved behavior |
| --- | --- |
| Inventory ownership | Manufacturer owns supplied stock on consignment until sale/delivery; no company inventory asset at hub receipt |
| Sale recognition | Company is seller and collector, including manufacturer-originated orders; revenue and VAT recognized at delivery |
| Customer prices | Product and delivery prices are VAT-inclusive |
| Manufacturer COGS | Admin-approved agreed COGS, VAT-inclusive, at NCM `DELIVERED`; never proposed/global cost |
| Cost snapshot | Lock the agreed unit cost at manufacturer acceptance; no retroactive edits |
| Manufacturer return | After confirmed receipt, reverse linked sales/VAT/customer settlement and manufacturer COGS/payable; restock only after inspection |
| Input VAT | Split from gross COGS only when a valid manufacturer tax invoice is recorded; otherwise gross cost is non-recoverable |
| Manufacturer commission | Additional to COGS only for `DIRECT_MANUFACTURER` + `PHONE_ORDER` or `HUB_VISIT`; exclude `ONLINE_STORE` and `ADMIN_DIRECT` social orders |
| Commission basis | `max(0, discounted product revenue ex-VAT/delivery - approved COGS ex-recoverable input VAT) * approved rate` |
| Commission timing | Delivery, only if the goods are not subsequently returned |
| Direct sale terms | Both approved COGS and `commissionStatus=APPROVED` are required at acceptance; missing approval blocks acceptance/order creation |
| Marketing CPA | Accrue per verified benefit redemption; settlement approval controls payout, not recognition |
| NCM settlement | Keep COD receivable and carrier-fee payable gross until bank settlement is confirmed |
| Tax rates | Effective-dated/configurable; current VAT rate is 13%, not a permanent constant |
| Corporate tax | 25% may be shown as an estimate only pending accountant/tax-adviser approval |
| Currency/calendar | NPR; Nepali FY Shrawan 1 through Ashadh end, Asia/Kathmandu timezone |
| Readiness | Gate accounting/finance operations only; do not gate catalog or customer order operations |

These are requirements, not current runtime behavior. The current system posts COGS at order creation and has no delivery-triggered manufacturer ledger posting.

## Target Logical Model

```text
Source order / delivery / return / redemption / payment
  └── AccountingEvent (immutable source key, version, effective date, payload hash)
        ├── AccountingOrderSnapshot (acceptance-time approved terms)
        │     └── AccountingOrderSnapshotLine (approved unit COGS, quantity, commission terms)
        └── JournalEntry (unique event key, period, status, totals, reversal link)
              └── JournalLine (account, debit, credit, party, source dimensions)

AccountingParty ── AccountingDocument (AR or AP bill/credit note)
                         └── Payment/Receipt Allocation ── Cash/Bank GL Account

TaxTransaction ── JournalLine
AccountingAuditEvent ── event/journal/document/user
AccountingReconciliationRun ── GL/control account/subledger result
```

## Core Entities

| Entity | Responsibility and constraints |
| --- | --- |
| `AccountingParty` | Stable party type (`CUSTOMER`, `MANUFACTURER`, `MARKETING_PARTNER`, `CARRIER`, `VENDOR`, `PAYMENT_PROVIDER`, `OTHER`), source-entity reference, status and display-name snapshots. Unique by party type + source ID. A party can have both AR and AP documents. |
| `AccountingOrderSnapshot` | One immutable acceptance-time snapshot per order/assignment version: manufacturer, source channel, accepted time, approved commission rate/status, currency and tax configuration reference. Unique order + version. |
| `AccountingOrderSnapshotLine` | Product/variant, accepted quantity, VAT-inclusive agreed unit COGS, approval reference and stable line identity. No proposed/global cost fallback. |
| `AccountingEvent` | Durable outbox event with unique idempotency key, source type/ID/version, effective timestamp, payload/hash, `PENDING/PROCESSING/POSTED/FAILED/BLOCKED`, attempts and error metadata. Retry must not mutate its source payload. |
| COA account mapping | Existing hierarchical accounts plus configurable semantic mappings for sales, VAT, COGS, manufacturer AP, commission, NCM COD/fees, cash/bank clearing, CPA and reversals. Never rely on database IDs. |
| `AccountingPeriod` | UTC start/end instants derived from verified BS calendar rules, BS label, timezone and `OPEN/SOFT_CLOSED/CLOSED/LOCKED` state. Closed/locked periods reject normal posting. |
| `JournalEntry` | Immutable posted journal linked to event, unique idempotency key, currency, period, reversal relation, creator/approver, timestamps and balanced decimal totals. Drafts do not affect reports. |
| `JournalLine` | Decimal debit/credit, account, optional party/document/order/product/delivery dimensions; exactly one positive side. |
| `AccountingDocument` | Bill or credit note with `RECEIVABLE/PAYABLE` side, party, source, original/allocated/outstanding amounts, currency, dates, due date and status. |
| `AccountingPayment` / `AccountingReceipt` | Immutable cash/bank movement, counterparty, account, method/reference, effective date, amount and stable idempotency/provider reference. |
| `AccountingAllocation` | Applies payment/receipt/credit to open AR/AP documents. Partial payment, advances and unallocated amounts are explicit; allocation cannot exceed open balances. |
| `TaxTransaction` | Tax code/rate snapshot, taxable base, tax amount, invoice/evidence reference and linked journal line. Input VAT requires valid invoice evidence. |
| `AccountingAuditEvent` | Append-only actor/action/time/source/reason/event/journal/document references; never stores credentials or payment secrets. |
| `AccountingReconciliationRun` | Period/scope/run metadata and differences for GL-to-AR/AP, party, treasury, NCM, inventory ownership events and trial balance. Differences remain visible. |

Use project naming conventions and staged migrations, but preserve these invariants. Existing operational models remain the source of business facts; accounting adapters own the financial representation.

## Posting Matrix

Exact account codes are configurable mappings and require accountant approval. This table describes economic direction, not tax advice.

| Event | Debit | Credit | Notes |
| --- | --- | --- | --- |
| Delivered company sale | Customer/channel receivable or actual cash/clearing for VAT-inclusive total | Product and delivery revenue ex-VAT; output VAT payable | Determine tender from actual receipts, not only `Order.payment=true` |
| Delivered manufacturer COGS, valid invoice | COGS ex-recoverable input VAT; input VAT receivable | Manufacturer AP for VAT-inclusive approved COGS | No inventory credit: manufacturer owns stock until delivery |
| Delivered manufacturer COGS, no valid invoice | COGS for gross approved COGS | Manufacturer AP for gross approved COGS | No unsupported input VAT claim |
| Eligible manufacturer commission | Manufacturer commission expense (account mapping subject to accountant) | Manufacturer AP | Direct manufacturer phone/shop only; approved rate snapshot and gross-profit formula |
| Confirmed post-delivery return | Sales return/contra revenue; output VAT reversal; manufacturer AP reversal; customer refund/receivable clearing | Cash/refund payable/customer balance and COGS/input VAT reversal as applicable | Link to original delivery journals; never edit/delete the originals |
| Verified Marketing Partner redemption | Marketing CPA expense | Marketing Partner AP | One accrual per verified redemption; settlement approval controls payout |
| NCM bank remittance | Bank | NCM COD receivable | Clear only on verified bank settlement |
| NCM carrier fee settlement | NCM carrier AP | Bank | Preserve gross COD receivable and carrier payable; any netting is a settlement/offset record |

## Recognition And Event Contracts

1. **Manufacturer acceptance:** inside the acceptance transaction, load the assigned manufacturer’s inventory and terms. Require every ordered product to have `priceStatus=APPROVED` and positive `agreedCostPrice`; for `DIRECT_MANUFACTURER`, require `commissionStatus=APPROVED` and an agreed rate. Snapshot terms. If any requirement fails, return conflict and do not accept.
2. **Delivery:** NCM `DELIVERED` is an idempotent source event. Consume only the accepted snapshot, never current product/inventory prices. Create sale/VAT/COGS/AP/eligible commission postings once.
3. **Return before delivery:** do not post sale/COGS/commission.
4. **Return after delivery:** `RETURN_REQUESTED` alone is not physical receipt. Reverse only after manufacturer confirms receipt/inspection; link all reversals to delivery postings.
5. **Marketing CPA:** verify card-benefit redemption and snapshot partner/campaign terms; accrue one payable per eligible redemption.
6. **NCM settlement:** status callbacks are evidence, not proof of bank receipt. A verified statement/manual approved receipt clears balances.

## Iteration Order

After the recognition-policy unit tests, add the acceptance snapshot/guard; design/migrate normalized event/party/subledger/journal structures; implement transactional posting/idempotency; wire delivery/return/CPA events; then build reconciliation, reports and UI. Do not run a second authoritative ledger beside the existing GL. Replace/adapt current posting paths in the same cutover iteration before declaring the ledger authoritative.