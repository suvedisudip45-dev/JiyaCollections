<div align="center">

# Aama Clothings — Multi-Portal Commerce Repository

### Customer storefront, business operations, manufacturer/distributor workspaces, and marketing portal

Built with Node.js, Express, Prisma (MySQL), React (Vite), and Tailwind CSS.

![License](https://img.shields.io/badge/license-MIT-blue)
![Stack](https://img.shields.io/badge/stack-Node%20%7C%20Prisma%20%7C%20React%20%7C%20MySQL-13aa52)
![React](https://img.shields.io/badge/React%2019-61DAFB)
![Express](https://img.shields.io/badge/Express-API-000000)

</div>

---

> **Current-source note:** The first production release is limited to Cash on Delivery (COD); no bank/debit/credit-card gateway, payment processor, card-token, PCI-processing, or payment-provider webhook flow is in scope. Marketing cards are promotional instruments, not payment cards. This repository has four independent portals (`frontend/`, `admin/`, `manufacturer/`, `marketing/`); distributor operations are a workspace in `manufacturer/`, and there is no `delivery/` app. Do not use legacy database setup commands; see [Project Overview](PROJECT_OVERVIEW.md), [First Production Release Readiness](docs/first-production-release-readiness.md), [Architecture and Backend](ARCHITECTURE_AND_BACKEND.md), and the [P6-R2B readiness audit](docs/phase-6/04-whole-project-erp-implementation-readiness-audit.md).

## 🌐 The Business Model & Architecture

```
Customer storefront ─┐
Admin operations ────┼── HTTP/JSON ──> Express API ── Prisma ──> MySQL
Manufacturer /      ─┤                       ├── NCM integration
distributor workspace┤                       ├── Cloudinary
Marketing partner ───┘                       └── separate notification worker
```

---

## 🚀 Portals & Applications

| Portal | Directory | Default Port | Description |
| --- | --- | --- | --- |
| **Customer Storefront** | `frontend/` | `5173` | Customer browsing, catalog search, loyalty rewards, cart & checkout |
| **Admin Portal** | `admin/` | `5174` | Business operations, catalog, orders, transfers, finance/accounting, access and reporting |
| **Manufacturer / Distributor Workspaces** | `manufacturer/` | `5175` | Manufacturer production and a separate distributor workspace for hub inventory, transfers and fulfillment |
| **Marketing Partner Portal** | `marketing/` | `5176` | Partner campaigns, cards, redemptions and reporting |
| **REST API Server** | `backend/` | `4000` | Shared Express API, Prisma/MySQL access, domain services and integrations |

---

## ⚡ Current Source-Backed Overview

- Customer checkout and order fulfillment use distributor workspaces; manufacturer production is a distinct workflow and production stock is not storefront stock.
- Distributor replenishment uses stock transfers. Newer SKU/location inventory flows use inventory balances and ledger entries, while legacy stock models and writers still exist and require a controlled migration plan.
- Delivery is integrated with NCM and other operational flows through the backend; there is no separate delivery portal. A delivery status is not, by itself, evidence of COD cash collection or remittance.
- Admin finance and accounting features are present, but reports and subsystem reconciliation have documented scope and completeness limits. See [the accounting documentation](docs/accounting/).
- Marketing partner workflows are implemented in the separate `marketing/` portal.
- Cloudinary uploads and the separate notification worker are external boundaries. Customer orders in the first production release use COD only; no payment-provider transaction flow is part of the release.

---

## 🛠️ Tech Stack

- **Backend**: Node.js, Express.js, Prisma ORM, MySQL, JWT, bcrypt, Multer, Cloudinary
- **Frontend / Portals**: React 19 / 18, Vite, React Router, Tailwind CSS, Lucide React, Axios, React-Toastify
- **Database**: MySQL relational database managed via Prisma migrations

---

## 🏁 Quick Start Guide

### Prerequisites
- Node.js 18+

### 1. Install dependencies

Each application is independent; install dependencies from its own package
directory. There is no root npm workspace.
```bash
npm install
```

### 2. Start a development server

Run the relevant script from the package directory:
```bash
npm run dev
```

The backend requires an explicitly approved and configured database target.
Database provisioning and application are not part of this quick start; do not
use `prisma db push` or run database commands against an unverified target.
Use package-specific environment examples as templates, and never commit
credentials or populated `.env` files.

### Prisma migration baseline

The migration history is squashed into `backend/prisma/migrations/0_init`, generated from the current `backend/prisma/schema.prisma`. Fresh databases should apply this baseline with `npx prisma migrate deploy` from `backend/`; do not run the baseline SQL against an existing database whose tables already exist.

Existing databases must retain their data and must not apply `0_init` as a new schema migration. Before deploying to one, back it up and coordinate a migration-history cutover for its `_prisma_migrations` table; verify the live schema matches the baseline first. This repository change does not connect to a database or rewrite deployed migration records. After the cutover, create future schema changes as new Prisma migrations and apply them with `npx prisma migrate deploy`.

### RBAC and Prisma Client refresh
After applying the baseline to a fresh database or deploying a later migration that changes permissions or the Prisma schema, run the relevant seed/client-generation steps from `backend/` before starting the API:
```bash
npm run seed
npx prisma generate
```
On Windows, stop the running backend before `prisma generate` if its native query-engine DLL is locked.

`ADMIN_EMAIL` is required when seeding and identifies the configured owner Admin account. RBAC seeding grants the built-in broad `ADMIN` role only to that active account and deactivates that built-in role mapping for other Admin accounts while preserving their custom role mappings. Review the existing Admin role assignments and take a database backup before running the updated seed in an existing environment; do not treat seed execution as a substitute for reviewing who should retain privileged access. Never assign the `all:function` authorization bypass to a user or custom role.

---

## 📄 License

Released under the [MIT License](./LICENSE). Built for the Aama Clothings Distributed Ecosystem.
