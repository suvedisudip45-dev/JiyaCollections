# UI_SYSTEM.md

Repository path: frontend/ and admin/

Purpose
- Describe UI component system, design tokens, routes, key user flows, state management, responsiveness, accessibility and interaction patterns for developers and AI agents.

1. Frontend architecture
- Framework: React (v18) + Vite (frontend and admin).
- Styling: TailwindCSS (utility-first) plus custom CSS where needed; Tailwind config likely in frontend/ (search for tailwind.config.js).
- Routing: react-router-dom v6; pages mapped under src/pages and route declarations in src/App.jsx or src/router.
- Build: Vite dev server for HMR; env variables via VITE_*.

2. Component hierarchy and patterns
- Atomic-ish decomposition: components/ contains small UI elements (Button, Input, Icon), sections (ProductCard, ProductList), and page-level containers (HomePage, ProductPage, CartPage).
- Reusable primitives:
  - Button: accepts variant (primary, secondary, ghost), size (sm, md, lg), disabled state, and aria props.
  - Input: text, number, textarea with validation messaging.
  - Modal/Dialog: portal-based, traps focus.
  - Form components: controlled inputs integrated with local state; no global form library present.
- Higher-level components:
  - ProductCard: image, title, price, rating; clickable to product route.
  - ProductGrid/List: responsive grid with breakpoint adjustments.
  - Header/Nav: search, cart icon with count (derived from server or global store), auth links.
  - Admin-specific components: dashboards, CRUD forms, file upload components using Multer via admin API endpoints.

3. Design system / tokens
- Colors (suggested mapping based on UI visuals):
  - primary: #1F2937 (slate-800) or brand teal—use Tailwind token classes where possible
  - accent: #E11D48 (rose-600) for CTAs
  - muted: gray scale using Tailwind (gray-50..900)
  - success: #16A34A; danger: #DC2626; warning: #F59E0B
- Typography:
  - Base font: system-ui / Inter; sizes: 14px (base), 16px (body), 20px (h4), 24px (h3), 32px (h2), 48px (h1)
  - Line-height and font-weight follow Tailwind defaults.
- Spacing tokens: use Tailwind spacing scale (1 -> 0.25rem, 2 -> 0.5rem, 4 -> 1rem, etc.).
- Elevation: box-shadow utilities from Tailwind or custom CSS variables.

4. Key user flows and routes
- Public routes (frontend):
  - / -> Home (featured & categories)
  - /products -> Product listing (filters, sort, pagination)
  - /product/:id -> Product detail (images, variants, add to cart)
  - /cart -> Cart and checkout initiation
  - /checkout -> Payment flow (Stripe/Razorpay)
  - /auth/login, /auth/register -> Authentication screens
  - /account/orders -> Order history (requires auth)
- Admin routes (admin app):
  - /admin/login
  - /admin/products -> list/create/update products
  - /admin/orders -> manage orders
  - /admin/reports -> financial & stock reports

5. State management patterns
- Local state: useState/useReducer within components for local form state and transient interactions.
- Global state: lightweight global store (Context API or lifted state) for auth token, user profile, and cart synchronization. Controllers in backend expose endpoints for cart operations; frontend persists token in localStorage (recommended: HttpOnly cookie instead).
- Server state: Axios for HTTP; caching is ad-hoc (no react-query). Patterns:
  - Fetch on mount, store response in local component or context, revalidate on critical actions (cart update, place order).

6. Responsiveness rules
- Mobile-first: Tailwind classes implement breakpoints (sm, md, lg, xl). Grids collapse to single column on small screens.
- Image handling: use responsive image containers with object-fit: cover; limit uploaded image resolution on client.
- Touch targets: minimum 44x44 px for interactive controls on mobile.

7. Accessibility (A11y)
- Semantic HTML: use <button>, <nav>, <main>, <header>, <form>.
- Keyboard focus: modal/dialog traps focus; all interactive elements reachable via Tab.
- ARIA: descriptive aria-labels for icons, images have alt text (product name), role attributes for landmark regions where necessary.
- Color contrast: ensure 4.5:1 for body text and 3:1 for large text. Avoid color-only indicators for statuses.

8. Interactive behaviors
- Add-to-cart: optimistic UI update to show item increment; backend authored sync if conflict.
- Variant selection: size/color selection controls update price/stock availability in UI.
- Image uploads (admin): multi-file selection, preview before upload, progress indicator.
- Notifications: react-toastify for toasts; consistent placement top-right and dismiss behavior.

### Admin Direct-Order Step Flow
- Step 1: enter and validate a digits-only contact number.
- Step 2: show `New customer` when no profile or historical order exists; show blank required fields.
- Step 3: show `Code required` for a known contact. The admin enters the code provided by the customer; the code is never displayed by lookup.
- Step 4: show either `Verified customer` or `Existing customer - loyalty excluded`, and populate prior customer data for both states.
- Step 5: collect or review delivery details, select products, review payment, and confirm creation.
- Verification status must be communicated with text and accessible status messaging, not color alone. Existing account data is used as an order draft and is not overwritten implicitly.

9. Testing & visual regression
- Unit tests: none enforced in frontend; recommend jest + react-testing-library for unit and integration tests.
- E2E: recommend Playwright for critical flows (checkout, login, product lifecycle).

10. Developer notes
- Environment: VITE_BACKEND_URL used in frontend; ensure CORS origins match backend .env FRONTEND_URL.
- Styling: prefer Tailwind utility classes; extract repeated patterns into small component variants.
- Performance: lazy-load product images and code-split admin routes.

-- End of UI_SYSTEM.md --
