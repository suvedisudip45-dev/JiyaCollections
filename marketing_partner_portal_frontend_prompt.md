# Marketing Partner Portal — Frontend Implementation Prompt

## Role

Act as a **senior frontend engineer with 15+ years of production experience**, with deep expertise in React, TypeScript/JavaScript, npm, authentication, authorization-aware UI, secure API integration, responsive dashboards, QR scanning, accessibility, state management, and production debugging.

You are implementing a new **Marketing Partner Portal** for an existing clothing e-commerce project.

Current repository:

```text
clothing-store-ecommerce/
├── frontend/
├── backend/
├── manufacturer/
└── admin/
```

Create:

```text
clothing-store-ecommerce/
├── frontend/
├── backend/
├── manufacturer/
├── admin/
└── marketing/
```

The new `marketing/` folder is the frontend application for authenticated marketing partners.

---

## 1. Non-negotiable architecture rule

**DO NOT BREAK OR REWRITE THE CURRENT ARCHITECTURE.**

Before coding, inspect the existing repository and especially `backend/`.

The existing backend is the source of truth for:

- authentication
- users
- roles
- permissions
- marketing partners
- campaigns
- cards
- manufacturer assignments
- card lifecycle
- customer/card linkage
- benefits
- redemptions
- QR validation
- geography
- analytics
- API contracts

Do not invent APIs that already exist.

Do not create a second authentication system, ORM, database, API architecture, or unnecessary state-management architecture.

Reuse existing frontend conventions where appropriate.

The new `marketing/` application may have its own package and build configuration, but it must integrate cleanly with the existing backend.

---

# 2. Mandatory backend analysis before UI development

Before writing application code, inspect the backend and produce:

```text
marketing/docs/backend-api-analysis.md
```

Document:

```text
Authentication:
Authorization/RBAC:
Marketing partner APIs:
Campaign APIs:
Card APIs:
Card assignment APIs:
Benefit APIs:
Redemption APIs:
QR APIs:
Analytics APIs:
Geographic APIs:
Profile/account APIs:
Existing validation:
Existing pagination/filtering:
Existing API error format:
Existing frontend conventions:
Security requirements:
Integration risks:
```

Also inspect the existing `frontend/`, `manufacturer/`, and `admin/` applications for:

- component library
- typography
- colors
- spacing
- API client
- routing
- authentication handling
- loading states
- notifications
- tables
- forms
- responsive patterns
- reusable components

**Do not start major UI implementation until this analysis is complete.**

---

# 3. Security principle

The frontend must be secure, but **frontend security is not the authority**.

Backend authorization must remain authoritative for:

- partner ownership
- campaign ownership
- card ownership
- customer information
- QR validation
- benefit eligibility
- redemption
- permissions

Frontend protection is for UX and defense-in-depth.

Never treat these as security:

- hidden buttons
- hidden routes
- disabled controls
- client-side role checks alone
- URL IDs
- local state
- decoded QR information

---

# 4. Absolute authentication requirement

Only an authenticated marketing partner can access the portal.

All non-auth routes must be protected.

Example:

```text
/login
/signup
/forgot-password
/reset-password
/verify-email

/dashboard
/campaigns
/campaigns/:id
/cards
/cards/:id
/redemptions
/qr-validator
/reports
/profile
/settings
```

If logged out:

```text
→ redirect to /login
```

If authenticated but unauthorized:

```text
→ show a proper 403/unauthorized page
```

Do not expose private data during redirects.

---

# 5. Authentication pages

Implement the authentication pages supported by the backend:

```text
/signup
/login
/forgot-password
/reset-password
/verify-email
```

Do not invent unsupported backend flows.

## Signup

Use only fields supported by the backend. Potential fields:

- business/partner name
- email
- phone
- password
- confirm password
- business type
- address
- province
- district
- website/social profile if supported
- terms acceptance

Features:

- inline validation
- password requirements
- password strength
- duplicate account feedback
- server validation errors
- loading state
- success state
- email verification state if supported

Never show backend stack traces.

## Login

Include:

- email/username
- password
- show/hide password
- remember-me only if backend supports it
- forgot password
- loading state
- invalid credentials
- account disabled
- account not verified

Follow the existing authentication mechanism.

If the backend uses HTTP-only cookies, use them correctly and do not copy credentials into localStorage unnecessarily.

If the backend uses another secure mechanism, follow it rather than replacing it.

---

# 6. Authentication state

Implement a clean auth layer following the existing application architecture.

Conceptually:

```text
AuthProvider
├── currentUser
├── loading
├── isAuthenticated
├── permissions
├── login()
├── logout()
├── refreshUser()
└── hasPermission()
```

Do not introduce a new state-management library unless the existing architecture genuinely requires it.

---

# 7. Partner data isolation

The currently authenticated marketing partner must see **only their own authorized data**.

Never trust:

```text
partnerId
```

from:

- URL
- query string
- request body
- local storage

as proof of ownership.

The backend must enforce ownership.

Test manually:

```text
Partner A → Partner A campaign = allowed
Partner A → Partner B campaign URL = rejected
Partner A → Partner B card URL = rejected
Partner A → Partner B redemption URL = rejected
```

---

# 8. Portal UX

Design for a non-technical marketer.

Priorities:

1. Dashboard
2. Campaigns
3. Cards
4. Redemptions
5. QR Validator
6. Reports
7. Account

The UI should be:

- simple
- clean
- professional
- fast
- responsive
- easy to understand
- accessible

Avoid excessive animations, complicated charts, and unnecessary controls.

---

# 9. Main layout

Use the existing project branding where appropriate.

Suggested navigation:

```text
Dashboard

Campaigns

Cards
  └── All Cards

Redemptions

QR Validator

Reports

Account
  ├── Profile
  └── Security

Logout
```

Do not blindly copy the admin interface. Create a marketer-focused experience.

---

# 10. Dashboard

Create `/dashboard`.

The dashboard should answer immediately:

- how many campaigns?
- how many cards?
- how many activated?
- how many redeemed?
- where are cards being distributed?
- what is happening recently?

Suggested summary metrics:

```text
Total Campaigns
Active Campaigns
Total Cards
Cards Distributed
Cards Activated
Benefits Redeemed
```

Only display metrics the backend can calculate reliably.

## Distribution funnel

Where backend data supports it:

```text
Generated
↓
Assigned
↓
Received by Manufacturers
↓
Packed
↓
Delivered
↓
Customer Activated
↓
Benefit Redeemed
```

Do not fabricate missing metrics.

## Time filters

Support backend-supported ranges:

```text
Today
This Week
This Month
This Year
Custom Range
```

Clearly show the selected range.

---

# 11. Campaigns

Create:

```text
/campaigns
/campaigns/:id
```

## Campaign list

Show:

```text
Campaign
Status
Geography
Cards Requested
Cards Generated
Cards Assigned
Cards Activated
Redemptions
Start Date
End Date
```

Support backend-supported actions such as:

- view
- edit
- pause
- resume
- cancel

Do not display unsupported actions.

## Campaign detail

Sections:

### Overview

- partner
- campaign
- status
- start/end
- target geography

### Card statistics

- generated
- assigned
- received
- packed
- delivered
- activated

### Benefit statistics

- available
- redeemed
- expired

### Geography

- province
- district
- cards
- activations
- redemptions

### Timeline

Use actual backend events.

---

# 12. Cards

Create `/cards`.

Purpose:

Allow the marketer to understand physical card distribution.

Filters:

```text
Campaign
Province
District
Manufacturer
Status
Date range
```

Search:

```text
Card code
```

Example:

```text
AAMA-NAT-001B00001
```

Table:

```text
Card Code
Campaign
Geography
Manufacturer
Physical Status
Customer Status
Activated
Redeemed
```

Use server-side pagination when supported.

Do not expose QR secrets.

---

# 13. Card detail

Create `/cards/:id`.

Show:

```text
Card code
Campaign
Marketing partner
Geography
Manufacturer assignment
Physical status
Customer activation status
Benefits
Redemption state
Important dates
```

Show lifecycle timeline:

```text
Generated
↓
Assigned
↓
Manufacturer Received
↓
Packed
↓
Delivered
↓
Customer Activated
↓
Benefit Redeemed
```

The timeline must be based on backend facts.

Do not expose:

- raw QR tokens
- database secrets
- unnecessary customer PII

---

# 14. QR Validator

Create:

```text
/qr-validator
```

This is a core feature.

Only authenticated marketing partners may use it.

Provide:

```text
Scan QR
```

and a manual fallback:

```text
Enter Card Code
```

## Scanner UX

```text
┌─────────────────────────┐
│                         │
│      QR SCANNER         │
│                         │
│   Align QR in frame     │
│                         │
└─────────────────────────┘
```

Handle:

- camera permission
- permission denied
- camera unavailable
- retry
- manual entry
- invalid QR
- already redeemed
- backend failure

Do not automatically open the camera on page load.

Only request camera permission after the user chooses to scan.

Stop the camera stream after:

- successful scan
- closing scanner
- navigation
- component unmount

Do not upload camera frames.

---

# 15. QR security

Never implement:

```text
QR → public endpoint → card data
```

Required flow:

```text
Authenticated Marketing Partner
        ↓
QR scan
        ↓
Opaque QR token
        ↓
Authenticated backend request
        ↓
Backend verifies partner permission
        ↓
Backend resolves token
        ↓
Backend verifies campaign/card
        ↓
Safe response
```

The frontend must not trust QR-decoded data as authoritative.

Do not put sensitive information into QR codes.

Do not store QR secrets in localStorage.

Do not expose raw QR tokens in logs.

---

# 16. QR validation result

Keep results simple.

## Valid / available

```text
✓ Valid Card

Campaign:
Summer Promotion

Benefit:
20% OFF

Status:
Available
```

## Genuine but already redeemed

```text
✓ Genuine Card

Benefit:
20% OFF

Status:
Already Redeemed

Redeemed:
24 Sep 2026, 10:42 AM
```

## Invalid

```text
✕ Invalid Card

This card could not be verified.
```

Do not reveal unnecessary internal security information.

---

# 17. Customer data shown to marketers

The original product concept mentions:

- customer name
- purchase time
- product purchased
- QR scan time
- contact number

Do not automatically expose all of these.

Render only fields explicitly returned by an authorized backend response.

Prefer:

```text
Customer:
Ram K.

Order:
#****8291

Purchased:
24 Sep 2026

Benefit:
20% OFF

Status:
Available
```

If contact information is necessary, mask it unless full information is explicitly authorized.

Example:

```text
98******42
```

The frontend must never display a field simply because it exists in an API response.

---

# 18. Partner redemption

If the backend supports partner-side redemption, implement:

```text
Validate Card
↓
Show benefit
↓
Confirm redemption
↓
Backend transaction
↓
Success
```

Confirmation dialog:

```text
Redeem this benefit?

20% OFF
Summer Promotion

[Cancel] [Confirm Redemption]
```

Never mark a benefit redeemed before backend confirmation.

Success:

```text
✓ Redemption successful

Redemption ID:
RDM-XXXXXX

Time:
24 Sep 2026, 10:45 AM
```

---

# 19. Redemptions

Create:

```text
/redemptions
```

Show:

```text
Date
Campaign
Card
Benefit
Geography
Status
```

Filters:

```text
Campaign
Benefit
Province
District
Date
Status
```

Search:

```text
Card code
Redemption ID
```

Use backend pagination.

Do not download thousands of records merely to paginate in the browser.

---

# 20. Reports

Create `/reports`.

Reports should cover:

## Card distribution

```text
Generated
Assigned
Received
Packed
Delivered
Activated
```

## Customer engagement

```text
Cards Activated
Benefits Redeemed
Redemption Rate
```

## Geography

```text
Province
District
Cards
Activations
Redemptions
```

## Time

```text
Weekly
Monthly
Yearly
Custom
```

Prefer backend aggregation.

Do not reconstruct business-critical analytics from frontend events.

---

# 21. Geographic filtering

Support:

```text
Nation
Province
District
```

If backend has hierarchical geography:

```text
Province
↓
District
```

Changing province should update available districts.

Never hard-code Nepal's provinces/districts into frontend logic.

Use backend-provided geographic entities.

---

# 22. Profile and account

Create:

```text
/profile
/settings
```

Only expose fields and actions supported by the backend.

Possible:

```text
Business Information
Contact Information
Account Information
Change Password
Email Verification
Security
```

Never display:

- passwords
- access tokens
- refresh tokens
- QR secrets

---

# 23. API integration

Use a centralized API layer following existing conventions.

Possible organization:

```text
src/api/
├── auth.*
├── campaigns.*
├── cards.*
├── redemptions.*
├── qr.*
├── reports.*
└── profile.*
```

Adapt to the repository.

Do not scatter raw API calls throughout React components.

API layer should support:

- authentication
- consistent errors
- 401 handling
- 403 handling
- pagination
- filtering
- cancellation where useful
- refresh/session handling

---

# 24. Frontend security requirements

Implement all of the following:

### Authentication

- protected routes
- secure session restoration
- logout
- expired-session handling
- unauthorized redirect

### Authorization

- permission-aware navigation
- permission-aware actions
- backend remains authoritative

### XSS

Avoid unsafe HTML rendering.

Do not use `dangerouslySetInnerHTML` unless absolutely necessary and safely sanitized.

### Sensitive data

Do not store:

- passwords
- QR secrets
- backend credentials
- signing secrets

in browser storage.

Do not put backend secrets into frontend environment variables.

Anything bundled into frontend JavaScript is public.

### URLs

Do not use URLs as authorization.

### QR

Never trust QR payload.

Always validate with backend.

### Logs

Do not log:

- passwords
- tokens
- QR secrets
- unnecessary customer PII

---

# 25. Error states

Every major page must support:

```text
Loading
Empty
Success
Validation Error
Unauthorized
Forbidden
Not Found
Conflict
Server Error
Network Error
```

Never display stack traces, SQL errors, ORM errors, or internal implementation details.

---

# 26. Responsive/mobile UX

Support:

- desktop
- laptop
- tablet
- mobile

Mobile is particularly important for QR validation.

Tables should become:

- horizontally scrollable
- responsive cards
- compact lists

where appropriate.

---

# 27. Accessibility

Use:

- semantic HTML
- labels
- keyboard navigation
- visible focus
- accessible dialogs
- screen-reader-friendly status messages
- adequate contrast
- accessible errors

QR scanner must have manual entry fallback.

---

# 28. Performance

Use:

- route lazy-loading where appropriate
- server-side pagination
- debounced search
- sensible caching
- controlled rerenders
- proper cleanup of QR camera streams

Avoid unnecessary dependencies.

Before installing npm packages, check whether the existing project already has an equivalent.

---

# 29. Suggested folder structure

Follow existing project conventions first.

Possible structure:

```text
marketing/
├── public/
├── src/
│   ├── api/
│   ├── auth/
│   ├── components/
│   │   ├── layout/
│   │   ├── campaigns/
│   │   ├── cards/
│   │   ├── qr/
│   │   ├── redemptions/
│   │   └── common/
│   ├── pages/
│   │   ├── auth/
│   │   ├── dashboard/
│   │   ├── campaigns/
│   │   ├── cards/
│   │   ├── redemptions/
│   │   ├── qr-validator/
│   │   ├── reports/
│   │   └── account/
│   ├── routes/
│   ├── hooks/
│   ├── types/
│   ├── utils/
│   ├── styles/
│   └── App.*
├── docs/
│   └── backend-api-analysis.md
├── package.json
└── README.md
```

This is a guideline, not a reason to violate existing conventions.

---

# 30. Implementation phases

Do not build the whole portal in one pass.

## Phase 0 — Discovery

- inspect backend
- inspect current frontend/admin/manufacturer applications
- inspect auth
- inspect marketing APIs
- document API contracts
- document reusable components
- document security requirements

Deliver:

```text
marketing/docs/backend-api-analysis.md
```

No major UI implementation yet.

## Phase 1 — Application foundation

Create `marketing/`.

Implement only:

- project setup
- routing
- API client
- environment configuration
- global styles
- error boundary
- authentication foundation

Acceptance:

- app runs
- backend connection works
- existing applications are unaffected

## Phase 2 — Authentication

Implement:

- signup
- login
- forgot password if supported
- reset password if supported
- verification if supported
- protected routes
- logout
- session restoration

## Phase 3 — Portal shell

Implement:

- responsive sidebar
- header
- user menu
- loading states
- unauthorized page
- responsive layout

## Phase 4 — Dashboard

Implement:

- summary metrics
- campaign summary
- card distribution
- geography
- time filters

## Phase 5 — Campaigns

Implement:

- list
- search/filter
- details
- statistics
- geography
- benefits
- backend-supported campaign actions

## Phase 6 — Cards

Implement:

- list
- filters
- search
- pagination
- details
- lifecycle timeline

## Phase 7 — QR Validator

Implement:

- authenticated scanner
- camera permission flow
- manual fallback
- secure backend validation
- result states
- partner redemption if backend supports it

This phase requires extra security testing.

## Phase 8 — Redemptions

Implement:

- history
- filters
- search
- pagination
- details

## Phase 9 — Reports

Implement:

- distribution
- activation
- redemption
- geography
- weekly/monthly/yearly/custom filters

## Phase 10 — Profile/security

Implement supported:

- profile
- account settings
- password change
- email verification
- security settings

## Phase 11 — Security hardening

Test:

- route manipulation
- IDOR scenarios
- partner isolation
- QR abuse
- token handling
- XSS
- sensitive data exposure
- camera lifecycle
- dependency vulnerabilities

## Phase 12 — UX polish

Improve:

- skeleton loading
- empty states
- mobile
- accessibility
- responsive tables
- confirmations
- notifications
- error messages

Do not add decorative complexity.

---

# 31. Testing requirements

Use the existing testing stack.

Test:

## Authentication

- login success/failure
- signup
- logout
- expired session
- protected route

## Authorization

- forbidden page
- partner isolation
- URL ID manipulation

## Campaigns

- list
- detail
- filtering
- empty
- API errors

## Cards

- search
- filters
- detail
- lifecycle
- pagination

## QR

- camera permission
- successful scan
- invalid QR
- already redeemed
- backend error
- manual fallback
- unauthorized user

## Redemption

- confirmation
- successful redemption
- duplicate/conflict
- backend rejection

## Responsive

Manually verify:

- desktop
- tablet
- mobile

---

# 32. Final security acceptance checklist

Do not declare the portal complete until:

- [ ] Logged-out users cannot access protected pages
- [ ] Authentication uses the existing backend architecture
- [ ] Partner data is isolated
- [ ] URL IDs are not treated as ownership
- [ ] Backend authorization is relied upon
- [ ] QR scanning requires authentication
- [ ] QR token is sent securely to backend
- [ ] Frontend does not trust decoded QR data
- [ ] QR secrets are not displayed
- [ ] Customer PII is minimized
- [ ] Passwords/tokens/secrets are never logged
- [ ] No backend stack traces are shown
- [ ] Camera stops after scan/navigation
- [ ] Manual validation exists
- [ ] Redemption success comes from backend
- [ ] Duplicate redemption is handled
- [ ] No unnecessary sensitive information is stored in browser storage
- [ ] No backend secrets are bundled
- [ ] XSS risks reviewed
- [ ] Dependency audit reviewed
- [ ] Production build passes

---

# 33. Final UX acceptance checklist

- [ ] Signup is simple
- [ ] Login is simple
- [ ] Dashboard is understandable immediately
- [ ] Campaigns are easy to navigate
- [ ] Cards are searchable
- [ ] QR validator is prominent
- [ ] QR validation works well on mobile
- [ ] Manual fallback exists
- [ ] Redemptions are easy to find
- [ ] Reports are understandable
- [ ] Geography filters are intuitive
- [ ] Tables work on small screens
- [ ] Empty states explain next actions
- [ ] Errors are understandable
- [ ] Loading states are visible
- [ ] Destructive actions require confirmation
- [ ] Accessibility is checked

---

# 34. Required agent reporting

Before each phase, report:

```text
What I inspected:
What already exists:
What I will reuse:
What I need to add:
Backend APIs used:
Potential risks:
```

After each phase:

```text
Files changed:
Components added:
API integrations:
Security controls:
Tests added:
Tests executed:
Results:
Known limitations:
```

Do not silently make architectural changes.

If backend behavior conflicts with this specification, inspect the actual backend implementation and adapt the frontend to the backend contract rather than inventing a competing architecture.

---

# 35. Final instruction

Build this as a production marketing portal, not a mockup.

Priority order:

```text
1. Backend contract correctness
2. Authentication
3. Authorization
4. Partner data isolation
5. QR/card security
6. Data integrity
7. Existing architecture compatibility
8. UX
9. Performance
10. Visual polish
```

Never bypass authentication for convenience.

Never trust frontend state for authorization.

Never expose another marketing partner's data.

Never expose raw QR secrets.

Never make QR validation public.

Never fabricate analytics.

Never invent backend APIs.

Do not implement the portal by blindly copying the admin interface. Reuse compatible components and conventions while designing a simpler marketer-focused experience.

The final repository must contain:

```text
clothing-store-ecommerce/
├── frontend/
├── backend/
├── manufacturer/
├── admin/
└── marketing/
```

The `marketing/` application must be independently runnable according to the repository's established frontend conventions and securely integrated with the existing backend.

After every major phase:

```text
- run lint
- run typecheck
- run tests
- run production build where practical
- inspect changed files
- verify existing applications still work
- document completed work
- document remaining issues
```

Do not proceed past a critical security or data-integrity failure.
