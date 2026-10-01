<div align="center">

# Aama Clothings — Distributed E-Commerce Ecosystem

### Multi-Hub Manufacturing, Intelligent Proximity Order Routing & Regional Courier Fleet

A production-grade distributed e-commerce network built with Node.js, Express, Prisma (MySQL), React (Vite), and Tailwind CSS.

![Status](https://img.shields.io/badge/status-active-emerald)
![License](https://img.shields.io/badge/license-MIT-blue)
![Stack](https://img.shields.io/badge/stack-Node%20%7C%20Prisma%20%7C%20React%20%7C%20MySQL-13aa52)
![React](https://img.shields.io/badge/React%2019-61DAFB)
![Express](https://img.shields.io/badge/Express-API-000000)

</div>

---

## 🌐 The Business Model & Architecture

```
                                  ┌───────────────────────────┐
                                  │      Customer Store       │
                                  │  (frontend/ : port 5173)  │
                                  └─────────────┬─────────────┘
                                                │ Places Order
                                                ▼
                                  ┌───────────────────────────┐
                                  │    Node/Express Backend   │
                                  │   (backend/ : port 4000)  │
                                  └─────────────┬─────────────┘
                                                │ Smart Nearest Proximity
                                                │ + Stock Availability
                                                │ + Quality Rating Engine
                                                ▼
                                  ┌───────────────────────────┐
                                  │    Manufacturer Hubs      │
                                  │(manufacturer/ : port 5175)│
                                  └─────────────┬─────────────┘
                                                │ Production & Packaging Complete
                                                │ Ready for Pickup Trigger
                                                ▼
                                  ┌───────────────────────────┐
                                  │   Delivery Fleet Hub      │
                                  │  (delivery/ : port 5176)  │
                                  └─────────────┬─────────────┘
                                                │ Doorstep Handover & COD Collection
                                                ▼
                                  ┌───────────────────────────┐
                                  │      Customer Happy       │
                                  └───────────────────────────┘
                                                ▲
                                                │ Oversight, Contracts, Stock & COD
                                  ┌─────────────┴─────────────┐
                                  │    Master Admin Portal    │
                                  │    (admin/ : port 5174)   │
                                  └───────────────────────────┘
```

---

## 🚀 Portals & Applications

| Portal | Directory | Default Port | Description |
| --- | --- | --- | --- |
| **Customer Storefront** | `frontend/` | `5173` | Customer browsing, catalog search, loyalty rewards, cart & checkout |
| **Admin Portal** | `admin/` | `5174` | Full business cockpit: multi-hub inventory, legal contracts with PDF uploads, order router, double-entry GL, finance |
| **Manufacturer Hub** | `manufacturer/` | `5175` | Localized factory portal: order acceptance, production status, packaging checklist, hub stock management |
| **Delivery Fleet** | `delivery/` | `5176` | Courier driver portal: route acceptance, hub pickup, customer doorstep delivery, COD cash reconciliation |
| **REST API Server** | `backend/` | `4000` | Node.js + Prisma ORM (MySQL), Cloudinary media storage, auto-allocation engine |

---

## ⚡ Key System Features

### 1. 🏭 Multi-Manufacturer Network & Smart Routing
- **Proximity-Based Allocation Engine**: Matches customer orders to the nearest qualified manufacturer hub across Nepal (Kathmandu, Lalitpur, Bhaktapur, Pokhara, Biratnagar, Butwal, Chitwan, Dharan, etc.).
- **Real-Time Stock Availability Check**: Ensures the hub has sufficient available units (`quantity - reservedQty >= orderedQty`) before allocating.
- **Quality Score Weighting**: High-quality rated manufacturers are prioritized for assignment.
- **Failover & Re-Allocation**: If a manufacturer declines an order, the engine automatically re-routes it to the next best regional hub.
- **Admin Manual Routing Override**: Admins can re-route any order directly from the dashboard.

### 2. 📦 Quality Compliance & Legal Contracts
- **Master Manufacturing Agreement**: Enforces legal terms, start/end dates, and commission rates.
- **Cloudinary PDF Contract Upload**: Admins upload signed contract scans directly to Cloudinary.
- **Manufacturer Quality Auditing**: Admin-managed 1.0 to 5.0 star quality rating system.

### 3. 🚚 Delivery Partner Portal & COD Reconciliation
- **Driver Auto-Dispatch**: Notifies local delivery partners the moment a manufacturer marks a parcel `ready_for_pickup`.
- **Customer Privacy Protection**: Full customer street address is hidden until the driver accepts the run.
- **Doorstep COD Handover**: Driver marks cash collected, logs recipient relation/name, and uploads proof of delivery photos.
- **Driver Earnings & Treasury Ledger**: Real-time tracking of cash-on-hand and commission earnings per completed delivery.

### Operational Delivery Guardrail
- The carrier booking step is now treated as a real external handoff: an assignment only advances to `ready_for_pickup` after the NCM create request succeeds.
- If the delivery partner API fails, the system surfaces a clear manufacturer message such as "Failed to book courier" and keeps the order retryable without falsely marking it as booked.
- The manufacturer can retry the courier booking flow after the external partner issue is resolved without reworking the order status manually.

### 4. 📊 Multi-Hub Aggregate Inventory Monitoring
- **Admin Central Visibility**: View total stock across Nepal and breakdown per manufacturer warehouse.
- **Quantity-Aware Stock Reservation**: Inventory is automatically reserved upon order assignment and finalized upon delivery.
- **Low-Stock Alerts**: Automatic warnings when hub stock falls below safety thresholds.

### 5. ↩️ Audited Customer Return & Exchange Lifecycle
- Customers can request a return or exchange from delivered-order history; admins can also create cases on a customer's behalf.
- Every request records its cause, selected items, requester, timestamps, and idempotency key. Admin approval is required before NCM is called.
- NCM request/response attempts, rejection details, available charges, and charge payer are stored. Failed and unknown handoffs remain distinct from successful bookings.
- Return refunds and inventory changes wait for manufacturer receipt and inspection. Exchange replacement stock is reserved at approval and consumed on confirmed replacement delivery.
- The current NCM exchange-create API accepts only the original order ID; admins must verify the replacement waybill against the internally reserved replacement variant.

---

## 🛠️ Tech Stack

- **Backend**: Node.js, Express.js, Prisma ORM, MySQL, JWT, bcrypt, Multer, Cloudinary
- **Frontend / Portals**: React 19 / 18, Vite, React Router, Tailwind CSS, Lucide React, Axios, React-Toastify
- **Database**: MySQL relational database managed via Prisma migrations

---

## 🏁 Quick Start Guide

### Prerequisites
- Node.js 18+
- MySQL Server (running on port 3306 or remote)
- Cloudinary account for media & contract uploads

### 1. Clone & Setup Database
```bash
git clone https://github.com/dexter747/Clothes-Store-ECommerce.git
cd Clothes-Store-ECommerce

# Install backend dependencies
cd backend
npm install

# Run database push/migrations
npx prisma db push
```

### 2. Start Services
In separate terminal windows:

```bash
# Terminal 1: Backend API (Port 4000)
cd backend && npm run server

# Terminal 2: Customer Storefront (Port 5173)
cd frontend && npm run dev

# Terminal 3: Admin Portal (Port 5174)
cd admin && npm run dev

# Terminal 4: Manufacturer Portal (Port 5175)
cd manufacturer && npm run dev

# Terminal 5: Delivery Partner Portal (Port 5176)
cd delivery && npm run dev
```

---

## 🔒 Configuration (`.env`)

### `backend/.env`
```env
PORT=4000
DATABASE_URL="mysql://root:password@localhost:3306/aama_clothings"
JWT_SECRET="your_jwt_secret"
CLOUDINARY_NAME="your_cloud_name"
CLOUDINARY_API_KEY="your_api_key"
CLOUDINARY_SECRET_KEY="your_secret_key"
ADMIN_EMAIL="admin@aama.com"
ADMIN_PASSWORD="adminpassword"
```

### Portals (`.env` in `frontend/`, `admin/`, `manufacturer/`, `delivery/`)
```env
VITE_BACKEND_URL=http://localhost:4000
```

### Return and exchange schema rollout
From `backend/`, apply the additive migration, seed the new RBAC permissions, and regenerate Prisma Client before starting the API:
```bash
npx prisma migrate deploy
npm run seed
npx prisma generate
```
On Windows, stop the running backend before `prisma generate` if its native query-engine DLL is locked.

---

## 📄 License

Released under the [MIT License](./LICENSE). Built for the Aama Clothings Distributed Ecosystem.
