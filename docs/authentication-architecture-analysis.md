# Authentication Architecture Analysis

## 1. Executive Summary
This document analyzes the existing authentication and authorization architecture of the Clothes Store E-Commerce system across its backend and four frontend portals:
1. **Customer Portal** (`frontend`)
2. **Admin Portal** (`admin`)
3. **Manufacturer Portal** (`manufacturer`)
4. **Marketing Partner Portal** (`marketing`)

## 2. Current Architecture Overview

```text
[Frontend Portals]
  ├── Customer Portal (Vite + React 18) ────────┐
  ├── Admin Portal (Vite + React 18) ───────────┼───> [Backend Express Server] (Port 4000)
  ├── Manufacturer Portal (Vite + React 18) ────┤         ├── Controllers & Middleware
  └── Marketing Partner Portal (Vite + React 18)┘         └── Prisma ORM (MySQL)
```

## 3. Discovered Authentication Bottlenecks & Weaknesses

1. **Fragmented Credential Storage**:
   - `User` table stores customer credentials (`email`, `password`).
   - `Admin` table stores admin credentials (`email`, `password`).
   - `Manufacturer` table stores manufacturer credentials (`email`, `password`).
   - `MarketingPartner` table stores marketing partner credentials (`email`, `passwordHash`).
   
2. **Token Inconsistency**:
   - Customer: JWT payload `{ id }` (no role specified).
   - Admin: JWT payload `{ adminId, role: "admin" }`.
   - Manufacturer: JWT payload `{ manufacturerId, role: "manufacturer" }`.
   - Marketing Partner: JWT payload `{ partnerId, role: "marketing_partner" }`.

3. **In-Transit Encryption Discrepancies**:
   - Customer, Admin, and Marketing portals utilize client-side AES-256-CBC encryption.
   - Manufacturer portal submits raw plaintext passwords over HTTP.

4. **Security Vulnerabilities**:
   - `adminAuth.js` contains a legacy backdoor checking `process.env.ADMIN_EMAIL + process.env.ADMIN_PASSWORD`.
   - User enumeration is possible due to different error messages (`"User doesn't exist"` vs `"Invalid credentials"`).
   - Lack of account lockout upon brute-force attempts.
   - No audit trail for authentication security events.
   - Admin entity lacks a mobile number (`9846008536`).

## 4. Target Unified Authentication Architecture

```text
                     ┌───────────────────────────┐
                     │     UNIFIED AUTH API      │
                     │   POST /api/auth/login    │
                     │   POST /api/auth/logout   │
                     │   GET  /api/auth/me       │
                     └─────────────┬─────────────┘
                                   │
                                   ▼
                     ┌───────────────────────────┐
                     │          Account          │
                     │  (Central Identity Layer) │
                     └─────────────┬─────────────┘
                                   │
             ┌─────────────────────┼─────────────────────┐
             ▼                     ▼                     ▼
┌─────────────────────────┐ ┌─────────────┐ ┌─────────────────────────┐
│       AuthSession       │ │OtpChallenge │ │      AuthAuditLog       │
└─────────────────────────┘ └─────────────┘ └─────────────────────────┘
                                   │
      ┌────────────────┬───────────┴────┬────────────────┐
      ▼                ▼                ▼                ▼
┌───────────┐   ┌─────────────┐   ┌────────────┐   ┌────────────┐
│ Customer  │   │Admin Profile│   │Manufacturer│   │ Marketing  │
│  Profile  │   │             │   │  Profile   │   │  Partner   │
│  (User)   │   │             │   │            │   │  Profile   │
└───────────┘   └─────────────┘   └────────────┘   └────────────┘
```
