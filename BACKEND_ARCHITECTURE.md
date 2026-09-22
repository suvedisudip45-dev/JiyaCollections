# BACKEND_ARCHITECTURE.md — Single Source of Truth for System Architecture

**Repository Path**: `backend/`  
**Runtime**: Node.js (v20+ ESM)  
**Framework**: Express.js (v4.x)  
**Database**: MySQL 8.0 via Prisma ORM  
**Port**: `4000` (API Gateway)  
**Last Updated**: September 14, 2026  

---

## System Architecture Overview

The **Aama Clothings** backend is built as a modular enterprise API gateway managing multi-hub manufacturing allocation, real-time courier logistics, storefront e-commerce, 13% Nepal VAT tax reporting, operating overhead tracking, and double-entry financial accounting.

```
                          ┌──────────────────────────┐
                          │  Customer Web Frontend   │
                          │   (Port 5173 - React)    │
                          └─────────────┬────────────┘
                                        │
                          ┌─────────────▼────────────┐
                          │   Admin Control Portal   │
                          │   (Port 5174 - React)    │
                          └─────────────┬────────────┘
                                        │
     ┌──────────────────────────────────┼──────────────────────────────────┐
     │                                  │                                  │
┌────▼─────────────────────┐  ┌─────────▼────────────────┐  ┌───────────────▼──────────┐
│  Manufacturer Hub Portal │  │  Delivery Driver Portal  │  │  External Payment API    │
│   (Port 5175 - React)    │  │   (Port 5176 - React)    │  │  (eSewa, Khalti, Stripe) │
└────────────┬─────────────┘  └─────────┬────────────────┘  └───────────────┬──────────┘
             │                          │                                   │
             └──────────────────────────┼───────────────────────────────────┘
                                        │
                           ┌────────────▼───────────┐
                           │   Express API Gateway  │
                           │      (Port 4000)       │
                           └────────────┬───────────┘
                                        │
       ┌────────────────────────────────┼────────────────────────────────┐
       │                                │                                │
┌──────▼─────────────────┐   ┌──────────▼──────────────┐   ┌─────────────▼────────────┐
│ Proximity Allocation   │   │  13% Nepal VAT Engine   │   │ Double-Entry GL Ledger   │
│    & Stock Sync        │   │  & IRD Tax Compliance   │   │   & Financial Suite      │
└──────────────┬─────────┘   └──────────┬──────────────┘   └─────────────┬────────────┘
               │                        │                                │
               └────────────────────────┴────────────────────────────────┘
                                        │
                           ┌────────────▼───────────┐
                           │  MySQL 8.0 via Prisma  │
                           └────────────────────────┘
```

---

## Client Portal Topology & Security Matrix

| Portal Role | Client Origin | Primary Middleware | Auth Token Type | Responsibilities |
|---|---|---|---|---|
| **Customer Storefront** | `http://localhost:5173` | `auth.js` | User JWT | Product catalog, cart management, checkout, reviews, order tracking |
| **Admin Portal** | `http://localhost:5174` | `adminAuth.js` | Admin JWT | Financial reporting, expense management, user cap table, tax compliance, partner creation |
| **Manufacturer Hub** | `http://localhost:5175` | `manufacturerAuth.js` | Manufacturer JWT | Hub order acceptance, stock sync, manufacturing progress, packaging |
| **Delivery Partner** | `http://localhost:5176` | `deliveryAuth.js` | Delivery Driver JWT | Parcel pickup, route acceptance, COD collection, proof of delivery photo upload |

---

## Core Domain Engine Architecture

### 1. Proximity Allocation & Stock Synchronization Engine
- **Files**: [`backend/controllers/orderAssignmentController.js`](file:///c:/Users/user/Desktop/Sudeep%20Subedi/projects/Clothes-Store-ECommerce/backend/controllers/orderAssignmentController.js), [`backend/services/stockSyncService.js`](file:///c:/Users/user/Desktop/Sudeep%20Subedi/projects/Clothes-Store-ECommerce/backend/services/stockSyncService.js)
- **Algorithm**:
  1. When an order is placed, candidate regional factory hubs (`Manufacturer`) are evaluated based on city proximity, active contract status (`contractStatus === 'ACTIVE'`), hub availability, and physical inventory (`quantity - reservedQty >= orderedQty`).
  2. Scores candidate hubs via:
     $$\text{Score} = (\text{Proximity Weight}) + (\text{Quality Rating} \times 20) - (\text{Pending Workload} \times 5)$$
  3. Automatically reserves hub stock (`reservedQty += itemQty`) and assigns the order to the optimal manufacturer hub.
  4. Real-time background service `syncProductStockFromManufacturerInventory(productId)` aggregates physical inventory across all regional hubs and updates the global `Product.stockQuantity` and variant stock maps.

### 2. Operating & Overhead Expense Engine
- **File**: [`backend/controllers/expenseController.js`](file:///c:/Users/user/Desktop/Sudeep%20Subedi/projects/Clothes-Store-ECommerce/backend/controllers/expenseController.js)
- **Features**:
  - Full CRUD operations for operating costs across categories: `MARKETING`, `RENT`, `ELECTRICITY`, `SALARIES`, `UTILITIES`, `MAINTENANCE`, `MISCELLANEOUS`.
  - Supports 13% Nepal VAT bill toggle (`isVatBill`), automatically splitting the total expense into **Taxable Net Expense** (`Amount / 1.13`) and **Claimable Input VAT Credit** (`Amount * 13 / 113`).
  - Auto-posts double-entry general ledger journal entries to the Chart of Accounts via `postExpenseAccounting`.

### 3. 13% Nepal VAT & IRD Tax Compliance Engine
- **Files**: [`backend/controllers/financialController.js`](file:///c:/Users/user/Desktop/Sudeep%20Subedi/projects/Clothes-Store-ECommerce/backend/controllers/financialController.js), [`backend/controllers/taxComplianceController.js`](file:///c:/Users/user/Desktop/Sudeep%20Subedi/projects/Clothes-Store-ECommerce/backend/controllers/taxComplianceController.js)
- **Nepal VAT Law Compliance**:
  - **Output VAT Collected**: E-commerce retail sales prices include 13% Nepal VAT:
    $$\text{Taxable Sales Base} = \frac{\text{Gross Revenue}}{1.13}, \quad \text{Output VAT} = \text{Gross Revenue} - \text{Taxable Sales Base}$$
  - **Input VAT Credit (Purchases & COGS)**: Manufacturer-agreed COGS and overhead expenses with VAT bills contain 13% claimable Input VAT Credit:
    $$\text{Input VAT Credit} = (\text{COGS Inc. VAT} \times \frac{13}{113}) + (\text{Overhead Expenses Inc. VAT} \times \frac{13}{113})$$
  - **Net Monthly VAT Payable / Credit Carryforward**:
    $$\text{Net VAT Payable} = \text{Output VAT Collected} - \text{Input VAT Claimable}$$

### 4. Double-Entry Accounting & Ledger Engine
- **Files**: [`backend/services/accountingPostingEngine.js`](file:///c:/Users/user/Desktop/Sudeep%20Subedi/projects/Clothes-Store-ECommerce/backend/services/accountingPostingEngine.js), [`backend/controllers/accountingController.js`](file:///c:/Users/user/Desktop/Sudeep%20Subedi/projects/Clothes-Store-ECommerce/backend/controllers/accountingController.js)
- **Ledger Invariants**:
  - Every financial transaction automatically generates a balanced `JournalEntry` where `totalDebit === totalCredit`.
  - Maintains strict Account Hierarchy (Assets `1000`, Liabilities `2000`, Equity `3000`, Revenue `4000`, Expenses `5000`, Operating Expenses `6000`).

### 5. Treasury & Liquid Capital Solvency Engine
- **File**: [`backend/controllers/financialController.js`](file:///c:/Users/user/Desktop/Sudeep%20Subedi/projects/Clothes-Store-ECommerce/backend/controllers/financialController.js)
- **Solvency Invariants**:
  - Tracks liquid cash across Treasury Accounts (`FinancialAccount`: Cash, Bank, Wallet, Escrow).
  - Outflow payments (supplier payouts, asset purchases, direct expense payments) enforce capital solvency:
    $$\text{Available Liquid Balance} \ge \text{Transfer Amount}$$
  - Prevents unbacked disbursements and prompts user to record unpaid disbursements as `AccountPayable`.

### 6. Audited Financial Statements Engine (GAAP / IFRS Direct & Indirect Reconciled)
- **File**: [`backend/controllers/financialController.js`](file:///c:/Users/user/Desktop/Sudeep%20Subedi/projects/Clothes-Store-ECommerce/backend/controllers/financialController.js) (`getFinancialStatements`)
- **Statements**:
  1. **Income Statement (P&L)**: Net Sales Revenue, COGS, Gross Profit, Operating Overhead Expenses (OPEX), Non-Cash Depreciation, Net Operating Income (EBT), 25% Corporate Income Tax Estimate, Net Income After Tax.
  2. **Balance Sheet**: Current Assets (Liquid Treasury Cash, Accounts Receivable, Inventory at Cost), Non-Current Fixed Assets (Gross Cost - Accumulated Depreciation = Net Book Value), Liabilities (Accounts Payable, Investor Debt), Partner Capital, Retained Earnings, Total Equity.
  3. **Statement of Cash Flows (Direct Method & Indirect Reconciled)**:
     - **Operating Cash Flows**: Customer Sales Receipts, Supplier COGS Outflows, Overhead Expense Outflows.
     - **Investing Cash Flows**: Fixed Asset Capital Purchases ONLY (`netInvestingCashFlow = -assetAdditionsInPeriod`). Depreciation is non-cash and excluded.
     - **Financing Cash Flows**: Partner Capital Injections, Loan Disbursements, Loan Repayments, Partner Drawings.
     - **Indirect Method Reconciliation**: Net Income After Tax $\rightarrow$ + Non-Cash Depreciation Addback $\rightarrow$ + Working Capital & Cash Tax Adjustments $\rightarrow$ Reconciled Net Operating Cash Flow.

---

## API Route Catalog Summary

### Admin Direct-Order Customer Verification

Admin-created social/direct orders use a server-authoritative identity decision before order creation:

1. Normalize and validate the Nepal mobile number.
2. Search both customer profiles and historical order address snapshots.
3. A new number requires the admin to complete the required customer and delivery fields.
4. An existing number requires the social customer code supplied by the customer.
5. A matching phone/code pair links the order to the existing account and preserves loyalty eligibility.
6. A mismatched code may use the previous customer data for dispatch, but creates an unlinked order with loyalty and gift eligibility disabled.

The lookup endpoint never returns the stored social code. The create endpoint re-checks the phone/code pair and records the decision in `Order.rewardApplied`. Fulfillment remains owned by manufacturer and delivery portals; the admin portal creates and monitors the order only.

### Storefront & Cart Routes (`/api/product`, `/api/cart`, `/api/order`)
- `GET /api/product/list`: Public product catalog with published filter.
- `POST /api/cart/add`, `POST /api/cart/update`: Shopping cart management.
- `POST /api/order/create`: Customer order placement & allocation dispatch.

### Operating Expense Routes (`/api/expense`)
- `POST /api/expense/create`: Log operating expense with 13% VAT bill toggle.
- `GET /api/expense/list`: Query expenses by category, date range, search.
- `PUT /api/expense/update`: Edit expense.
- `DELETE /api/expense/delete`: Remove expense record.
- `GET /api/expense/summary`: Aggregate expense breakdown.

### Manufacturer Hub Routes (`/api/manufacturer`, `/api/order-assignment`)
- `POST /api/manufacturer/login`: Hub authentication.
- `GET /api/order-assignment/my`: Fetch assigned orders for hub.
- `POST /api/order-assignment/accept/:id`: Accept order into production.
- `POST /api/order-assignment/reject/:id`: Decline order & trigger auto re-routing.

### Courier Delivery Routes (`/api/delivery-partner`, `/api/delivery-job`)
- `POST /api/delivery-job/ready-for-pickup/:assignmentId`: Mark parcel ready for driver pickup.
- `POST /api/delivery-job/accept/:jobId`: Courier accepts run.
- `POST /api/delivery-job/deliver/:jobId`: Mark delivered, confirm COD collection, upload POD image.

### Finance, Accounting & Tax Compliance Routes (`/api/finance`)
- `GET /api/finance/dashboard`: High-level executive dashboard metrics.
- `GET /api/finance/tax-report`: Monthly 13% Nepal VAT & IRD filing report.
- `GET /api/finance/statements`: P&L Income Statement, Balance Sheet, & Cash Flow Suite.
- `POST /api/finance/transfer`: Execute treasury transfers and cash outflows.
