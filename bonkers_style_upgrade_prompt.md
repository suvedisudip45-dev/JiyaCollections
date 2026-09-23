# Bonkers-Style Fashion Commerce UI + Backend Upgrade Prompt

## Role

You are a senior full-stack engineer, UI/UX designer, and software architect working inside an existing clothing-commerce + distributed-manufacturing project.

Your job is to **upgrade the existing project in-place**, not replace it blindly.

The target experience should be strongly inspired by the current **Bonkers Corner** ecommerce experience:
https://www.bonkerscorner.com/

Important: reproduce the *interaction patterns, information architecture, density, visual hierarchy, responsive behavior, merchandising patterns, and feature set*—but do **not** copy Bonkers' proprietary assets, logos, text, exact artwork, or brand identity. Use the project's own brand, product data, images, colors, and assets.

---

# 1. NON-NEGOTIABLE OBJECTIVES

Priority order:

1. **Preserve all existing business functionality.**
2. **Deeply inspect the existing frontend and backend architecture before changing code.**
3. **Upgrade the customer-facing UI to a premium modern streetwear/fashion ecommerce experience strongly inspired by Bonkers.**
4. Add/upgrade ecommerce features such as:
   - Wishlist
   - Product carousels
   - New Arrivals
   - Best Sellers
   - Category merchandising
   - Search
   - Filtering/sorting
   - Product quick actions
   - Product detail gallery
   - Related/recommended products
   - Recently viewed products
   - Promotional banners
   - Responsive mobile navigation
5. Make the necessary backend/admin changes to support those features.
6. **Remove the existing website sound feature completely** from the customer-facing experience.
7. **Do not break Admin or Manufacturer workflows.**
8. Test every task before moving to the next major task.
9. Do not invent APIs, models, routes, fields, or framework conventions without inspecting the repository first.
10. Prefer extending existing architecture over introducing duplicate systems.

---

# 2. EXISTING BUSINESS MODEL — MUST BE PRESERVED

The project has three major user roles:

## Customer
Customer-facing ecommerce functionality.

Possible existing functionality includes:
- Browse products
- Product details
- Cart
- Checkout
- Orders
- Account/profile
- Address management
- Payments
- Product browsing/search
- Other existing customer features

Do not remove existing functionality.

## Admin

Admin controls the ecommerce and distributed-manufacturing operation.

Preserve all existing Admin capabilities.

Any new ecommerce functionality must be controllable/configurable from Admin where appropriate.

## Manufacturer

Manufacturers are responsible for the manufacturing workflow through packaging and handoff/delivery to the delivery partner.

Preserve the complete existing manufacturer workflow.

Do NOT redesign manufacturing logic simply because the customer storefront is being redesigned.

Do NOT change manufacturing states, order ownership, production tracking, packaging, dispatch, or delivery-partner handoff unless a change is explicitly required by an existing ecommerce feature and is proven safe.

---

# 3. FIRST TASK — ARCHITECTURE AUDIT BEFORE CODING

Before changing anything, inspect the complete repository.

Do not start by editing UI components.

Determine:

## Frontend

Identify:

- Framework
- Router
- Entry points
- Layout architecture
- Pages
- Components
- Shared components
- Design system
- CSS/Tailwind/styling architecture
- State management
- API layer
- Authentication handling
- Customer role handling
- Admin role handling
- Manufacturer role handling
- Existing product components
- Existing cart implementation
- Existing search
- Existing product filters
- Existing image handling
- Existing responsive/mobile implementation
- Existing sound/audio implementation
- Existing navigation/header/footer
- Existing carousel/slider libraries
- Existing loading/error states

## Backend

Identify:

- Framework
- Server entry point
- Routes
- Controllers
- Services
- Models/entities
- Database
- Migrations/schema
- Authentication
- Authorization/RBAC
- Product APIs
- Category APIs
- Inventory APIs
- Cart APIs
- Order APIs
- User APIs
- Admin APIs
- Manufacturer APIs
- File/image upload APIs
- Existing notification systems
- Existing background jobs/events

## Admin

Map:

- Product management
- Product variants
- Inventory
- Categories
- Orders
- Manufacturers
- Manufacturing assignments
- Packaging
- Dispatch
- Delivery-partner workflow
- Users
- Promotions
- Existing dashboard modules

## Manufacturer

Map:

- Assigned production orders
- Production status
- Manufacturing steps
- Packaging
- Ready-to-dispatch
- Dispatch/handoff
- Existing permissions

### Architecture rule

Create an internal dependency map before implementation:

```text
Customer UI
    ↓
Frontend API/service layer
    ↓
Backend routes/controllers/services
    ↓
Database/models
    ↓
Admin configuration

Manufacturer workflow
    ↓
Existing backend manufacturing/order logic
```

Do not modify manufacturer logic unless required.

---

# 4. BONKERS EXPERIENCE TO USE AS UX REFERENCE

Study the live reference before implementation:

https://www.bonkerscorner.com/

The current Bonkers homepage contains a promotional announcement area, Women/Men/Accessories navigation, large promotional hero sections, Shop Men/Shop Women areas, New In product merchandising, Best Seller merchandising, category/collection discovery, newsletter signup, brand/service highlights, blog/news, and a large multi-column footer.

The current navigation contains categories such as:

### Women
- New Arrivals
- Oversized T-Shirts
- Bottoms
- Tanks
- Cargos
- Joggers
- Gym Wear
- Tops
- Hoodies
- Sweatshirts
- Jeans
- Basics
- Jackets
- Oversized Jersey
- Dresses
- Oversized Shirts
- Co-ord Sets
- Signature
- Special Prices
- Shorts
- Pyjama Sets

### Men
- New Arrivals
- Oversized T-Shirts
- Bottoms
- Knit
- Tanks
- Cargos
- Joggers
- Gym Wear
- Shorts
- Jeans
- Hoodies
- Sweatshirts
- Basics
- Jackets
- Oversized Jersey
- Oversized Shirts
- Relaxed Fit Shirts
- Signature
- Polo
- Special Prices
- Pyjama Sets

### Accessories
Examples:
- Socks
- Tote
- Bags
- Bag Charms
- Caps
- Rugs
- Stickers
- Scarves

### Collections
Examples include:
- New Arrivals
- Premium
- Signature
- Seasonal collections
- Streetwear collections
- Limited collections
- Collaboration collections

Use these as **information-architecture inspiration only**. Adapt categories to the actual project's inventory rather than creating fake categories that have no products.

---

# 5. TARGET HOMEPAGE EXPERIENCE

Rebuild the customer homepage around this structure:

```text
Announcement / Promotion Bar
        ↓
Header
        ↓
Primary Navigation
        ↓
Hero Carousel
        ↓
Featured Collection / Drop
        ↓
Shop Men / Shop Women / Accessories
        ↓
New Arrivals Carousel
        ↓
Collection / Editorial Banner
        ↓
Best Sellers Carousel
        ↓
Category Discovery
        ↓
Brand / Service Benefits
        ↓
Testimonials / Social Proof (if existing data supports it)
        ↓
Latest News / Blog (if existing feature exists)
        ↓
Newsletter / Membership
        ↓
Footer
```

---

# 6. HEADER / NAVIGATION

Create a polished fashion-store header.

Desktop:

- Announcement strip
- Brand logo
- Men
- Women
- Accessories
- New Arrivals
- Best Sellers
- Collections
- Search
- Account
- Wishlist
- Cart

Navigation should support mega-menu behavior.

Mega menu should be visually organized into:

```text
MEN
  Clothing
  Bottoms
  Activewear
  Collections

WOMEN
  Clothing
  Bottoms
  Activewear
  Collections

ACCESSORIES
  Bags
  Caps
  Socks
  Other

FEATURED
  New Arrivals
  Best Sellers
  Special Prices
```

Do not hard-code product categories if categories already exist in the database.

Make the menu data-driven.

---

# 7. WISHLIST — FULL FEATURE, NOT A MOCK BUTTON

Implement a real wishlist system.

## Customer behavior

A customer should be able to:

- Add product to wishlist
- Remove product from wishlist
- Toggle wishlist from product cards
- Toggle wishlist from product detail page
- View wishlist page
- See wishlist item count
- Move wishlist product to cart
- Handle out-of-stock products
- Handle deleted/unavailable products
- Persist wishlist after logout/login where authentication exists
- Prevent duplicates

For authenticated users, wishlist must be persisted in backend/database.

For guest users, if the current application supports guest shopping:

- Store wishlist locally where appropriate
- Merge guest wishlist into authenticated wishlist after login
- Do not duplicate items

## Backend

Create/extend a model similar to:

```text
Wishlist
- id
- customer/user_id
- created_at
- updated_at

WishlistItem
- id
- wishlist_id
- product_id
- variant_id (nullable if the architecture is product-level)
- created_at
```

Use the project's existing model conventions if an equivalent already exists.

Required API capabilities:

```text
GET    /wishlist
POST   /wishlist
DELETE /wishlist/:itemId
POST   /wishlist/:itemId/move-to-cart
```

Adapt route naming to the existing API convention.

Add authorization so a customer can only access their own wishlist.

## Admin

Admin should be able to see wishlist analytics if the project has analytics/dashboard infrastructure:

- Wishlist count
- Most-wishlisted products
- Wishlist-to-cart opportunities

Do not expose private customer data unnecessarily.

---

# 8. PRODUCT CARD

Product cards should be visually close in interaction style to modern Bonkers-style fashion cards.

Each card should support:

- Large product image
- Optional hover image
- Wishlist heart
- Sale/discount badge
- Product name
- Current price
- Original price
- Discount percentage
- Optional color variants
- Quick add
- Quick view if compatible with existing architecture
- Out-of-stock state

Example hierarchy:

```text
┌──────────────────────────────┐
│                     ♡        │
│                              │
│       PRODUCT IMAGE          │
│                              │
│ [20% OFF]                    │
└──────────────────────────────┘
Product Name
₹1,499   ₹1,799
[Quick Add]
```

Avoid clutter.

Use image-first merchandising.

---

# 9. PRODUCT CAROUSELS

Implement reusable carousel components.

Required reusable carousel types:

- HeroCarousel
- ProductCarousel
- CategoryCarousel
- CollectionCarousel
- EditorialCarousel
- RecentlyViewedCarousel

Features:

- Touch/swipe on mobile
- Drag/swipe where supported
- Arrow controls desktop
- Pagination indicators where appropriate
- Responsive item counts
- Keyboard accessibility
- Reduced-motion support
- Lazy loading
- Smooth transitions
- No layout shift
- Proper empty state
- Loading skeleton

Desktop example:

```text
<    Product  Product  Product  Product    >
```

Mobile:

```text
<    Product  Product  >
```

Use an existing carousel library if the project already has one.

Do not add a second carousel library unnecessarily.

---

# 10. HOMEPAGE PRODUCT SECTIONS

Create reusable sections:

## New Arrivals

Heading:

```text
New In
Upgrade your closet with the latest drops
```

Data source:
- Products sorted by creation/published date
- Admin-configurable if possible

CTA:

```text
Shop New Arrivals
```

## Best Sellers

Heading:

```text
Best Sellers
The pieces customers keep coming back for
```

Use actual sales/order data if available.

Fallback to admin-selected products.

## Trending / Featured

Allow Admin to select featured products/collections.

---

# 11. CATEGORY / COLLECTION SYSTEM

Do not build category logic purely in frontend.

Categories should be database-driven.

Recommended structure:

```text
Category
- id
- name
- slug
- parent_id
- gender
- description
- image
- banner_image
- sort_order
- is_active
- is_featured
- created_at
- updated_at
```

Only add fields that are compatible with the existing schema.

Support hierarchical categories:

```text
Women
 ├── Tops
 │    ├── T-Shirts
 │    ├── Tanks
 │    └── Hoodies
 ├── Bottoms
 │    ├── Cargos
 │    ├── Joggers
 │    └── Jeans
 └── Dresses

Men
 ├── Tops
 ├── Bottoms
 ├── Activewear
 └── Outerwear

Accessories
 ├── Bags
 ├── Caps
 └── Socks
```

---

# 12. COLLECTIONS

Add a collection concept if the existing project does not already have one.

Example:

```text
Collection
- id
- name
- slug
- description
- hero_image
- thumbnail
- is_active
- is_featured
- sort_order
- start_at
- end_at
```

Examples:

- New Drop
- Summer Edit
- Street Essentials
- Premium
- Activewear
- Limited Drop

Admin must be able to manage collections.

---

# 13. PRODUCT LISTING PAGE

Build a premium PLP.

Required:

- Breadcrumb
- Collection/category title
- Description
- Product count
- Filter
- Sort
- Product grid
- Pagination or infinite scroll
- Wishlist
- Responsive filter drawer

Filters should be data-driven:

```text
Availability
Price
Size
Category
Gender
Color
Collection
Material
Fit
Discount
```

Only expose filters for data that actually exists.

Desktop:

```text
┌──────────────┬──────────────────────────────┐
│ FILTERS      │ Sort                         │
│              │                              │
│ Category     │ Product Product Product      │
│ Size         │ Product Product Product      │
│ Color        │ Product Product Product      │
│ Price        │ Product Product Product      │
└──────────────┴──────────────────────────────┘
```

Mobile:

```text
[ FILTER ] [ SORT ]

Product
Product
Product
...
```

---

# 14. SEARCH

Upgrade search to a modern ecommerce search experience.

Requirements:

- Search icon in header
- Search overlay/drawer
- Debounced search
- Product suggestions
- Category suggestions
- Recent searches where appropriate
- Empty state
- Search results page
- Mobile-friendly UI

Do not add expensive search infrastructure unless the current project requires it.

Use the existing backend search capabilities first.

---

# 15. PRODUCT DETAIL PAGE

Target structure:

```text
Breadcrumb

Product image gallery       Product information
                            Product title
                            Rating/reviews
                            Price
                            Discount
                            Color
                            Size selector
                            Size guide
                            Quantity
                            Add to cart
                            Buy now
                            Wishlist
                            Delivery checker
                            Product benefits

Product description
Specifications
Size & fit
Fabric & care
Reviews

Related products
Recently viewed
```

Image gallery should support:

- Multiple images
- Thumbnail navigation
- Main image
- Mobile swipe
- Zoom if feasible
- Lazy loading

Variant selection must be connected to real inventory.

Never allow Add to Cart for an unavailable variant.

---

# 16. DELIVERY CHECKER

If delivery/pincode functionality already exists, retain it.

If Bonkers-style product delivery checking is being introduced:

```text
Enter postal code
[ CHECK ]

Delivery estimate
Availability
```

Do not break existing delivery partner logic.

---

# 17. CART

Preserve the existing cart behavior.

Improve UI toward a modern fashion ecommerce experience:

- Slide-out cart
- Product image
- Product title
- Variant/size
- Quantity
- Remove
- Wishlist/move to wishlist if compatible
- Price
- Discount
- Subtotal
- Shipping information
- Checkout CTA

Do not rewrite payment/order logic unnecessarily.

---

# 18. ADMIN CHANGES

Extend Admin without breaking existing modules.

Add:

## Product merchandising

Admin should be able to set:

- Featured
- New Arrival
- Best Seller
- Trending
- Collection
- Category
- Sort priority
- Hero/banner placement if supported
- Promotional badge
- Discount display

## Category management

CRUD:

- Create
- Edit
- Delete/archive
- Activate/deactivate
- Reorder
- Parent category
- Image/banner

## Collection management

CRUD:

- Create
- Edit
- Activate/deactivate
- Assign products
- Reorder
- Hero image
- Featured status

## Homepage merchandising

Admin should be able to control:

```text
Hero slides
Featured collections
New arrivals
Best sellers
Trending products
Category tiles
Promotional banners
```

Prefer references to existing products/categories rather than duplicating product records.

## Wishlist analytics

If analytics architecture exists:

- Total wishlist items
- Top wishlisted products
- Wishlist activity
- Wishlist → cart conversion if events exist

---

# 19. MANUFACTURER SAFETY RULES

This is critical.

The Manufacturer workflow must continue to work exactly as before.

Before backend changes:

1. Identify every manufacturer route.
2. Identify every manufacturer controller/service.
3. Identify every manufacturer model.
4. Identify every manufacturer status.
5. Identify all order/manufacturing relationships.
6. Identify all permissions.

When modifying Product/Order/Inventory models:

- Check all manufacturer queries.
- Check all manufacturer serializers/DTOs.
- Check status transitions.
- Check production quantities.
- Check packaging quantities.
- Check dispatch quantities.
- Check inventory reservations.
- Check order fulfillment.

Never rename or remove existing manufacturer fields without a migration plan and compatibility handling.

---

# 20. ADMIN SAFETY RULES

Admin authentication and permissions must remain intact.

Never:

- Remove existing admin routes
- Change existing role IDs casually
- Bypass authorization
- Expose manufacturer/customer private data
- Change order ownership rules
- Break existing dashboards

Run Admin regression tests after backend modifications.

---

# 21. REMOVE SOUND FEATURE

Completely remove the existing website sound/audio feature from the customer storefront.

Search the entire project for:

```text
audio
sound
music
ambient
autoplay
Audio()
HTMLAudioElement
Howler
Howler.js
<audio>
backgroundMusic
soundEnabled
volume
mute
unmute
```

Remove:

- Sound buttons
- Sound toggles
- Audio initialization
- Audio files loaded only for the feature
- Audio state
- Audio hooks
- Audio event listeners
- Autoplay behavior
- Sound settings
- Sound-related localStorage/sessionStorage
- Unused dependencies

Do NOT remove unrelated notification sounds or backend audio functionality if another business workflow genuinely depends on it.

Primary requirement:

**No storefront sound should play automatically or be required for the UI.**

---

# 22. VISUAL DESIGN SYSTEM

Create a consistent fashion/streetwear design system.

Characteristics:

- Strong typography
- Large editorial imagery
- Clean white/neutral surfaces unless the brand identity requires otherwise
- Bold section headings
- Tight spacing
- Large product imagery
- Minimal borders
- Strong CTA buttons
- Subtle hover effects
- Premium feel
- High visual density without feeling crowded

Avoid:

- Generic dashboard-looking ecommerce UI
- Excessive rounded cards
- Excessive shadows
- Tiny product images
- Overuse of gradients
- Generic Bootstrap appearance
- Random colors
- Unnecessary animations

The storefront should feel like a fashion brand, not a CRUD application.

---

# 23. RESPONSIVE DESIGN

Desktop, tablet, and mobile must be designed independently.

Mobile priorities:

- Sticky/mobile header
- Search
- Hamburger menu
- Wishlist
- Cart
- Horizontal product carousels
- Two-column product grid where appropriate
- Bottom-sheet filters
- Touch-friendly controls
- Large product images
- Fast loading

Test at:

```text
360x800
390x844
768x1024
1024x768
1280x800
1440x900
1920x1080
```

---

# 24. ACCESSIBILITY

Implement:

- Semantic HTML
- Keyboard navigation
- Focus states
- ARIA labels for icon buttons
- Accessible carousel controls
- Accessible dialogs/drawers
- Screen-reader labels
- Color contrast
- Reduced motion
- Form labels

Wishlist icon must have an accessible label such as:

```text
Add Baseline Black Pants to wishlist
```

---

# 25. PERFORMANCE

Do not sacrifice performance for visuals.

Use:

- Lazy-loaded images
- Responsive image sizes
- Proper image aspect ratios
- Skeleton loading
- Code splitting where appropriate
- Memoization where actually useful
- Avoid unnecessary API calls
- Debounced search
- Paginated products
- Efficient database queries
- Proper indexes for new wishlist/category/collection queries

Avoid N+1 queries.

---

# 26. DATABASE / BACKEND SAFETY

Before migration:

1. Inspect current schema.
2. Identify existing equivalent tables.
3. Reuse existing entities where possible.
4. Create migrations.
5. Never silently drop production data.
6. Make migrations reversible when practical.
7. Add indexes.
8. Validate foreign keys.
9. Add uniqueness constraints where appropriate.

Wishlist should have a unique constraint preventing duplicate user/product/variant entries.

---

# 27. API CONTRACT

Follow the project's existing API naming conventions.

Do not blindly implement the following exact paths if the project uses another convention:

```text
GET /products
GET /products/:id
GET /categories
GET /collections
GET /wishlist
POST /wishlist
DELETE /wishlist/:itemId
GET /homepage
GET /search
```

Instead, adapt them to the existing architecture.

All protected endpoints must enforce authentication and role authorization.

---

# 28. DATA-DRIVEN HOMEPAGE

Do NOT hard-code the homepage.

Homepage should consume configurable data.

Recommended response shape:

```json
{
  "heroSlides": [],
  "featuredCollections": [],
  "newArrivals": [],
  "bestSellers": [],
  "trendingProducts": [],
  "categories": [],
  "promotions": []
}
```

Adapt to existing backend conventions.

---

# 29. IMAGE / ASSET RULE

Do not copy Bonkers images.

Use:

- Existing project product images
- Existing brand assets
- Admin-uploaded assets
- Generated placeholders only during development

If assets are missing, create a clear placeholder system rather than hotlinking Bonkers.

---

# 30. IMPLEMENTATION TASK CHECKLIST

Work sequentially.

## PHASE 0 — Audit

- [ ] Inspect repository structure
- [ ] Identify frontend framework
- [ ] Identify backend framework
- [ ] Identify database
- [ ] Identify frontend routes
- [ ] Identify backend routes
- [ ] Identify Customer features
- [ ] Identify Admin features
- [ ] Identify Manufacturer features
- [ ] Identify product model
- [ ] Identify category model
- [ ] Identify order model
- [ ] Identify inventory model
- [ ] Identify cart
- [ ] Identify existing search
- [ ] Identify existing sound feature
- [ ] Identify existing carousel
- [ ] Identify existing authentication/RBAC

### TEST GATE

Do not continue until:

- Project starts
- Frontend starts
- Backend starts
- Database connects
- Existing login works
- Customer flow works
- Admin login works
- Manufacturer login works

---

# PHASE 1 — Remove Sound

- [ ] Locate all sound/audio code
- [ ] Remove storefront audio
- [ ] Remove sound UI
- [ ] Remove sound state
- [ ] Remove unused dependencies
- [ ] Remove unused assets
- [ ] Verify no autoplay
- [ ] Verify no console errors

### TEST GATE

- [ ] Homepage has no sound
- [ ] Navigation has no sound
- [ ] Product page has no sound
- [ ] Cart has no sound
- [ ] No audio network requests for removed feature
- [ ] Existing unrelated functionality still works

---

# PHASE 2 — Design System

- [ ] Typography
- [ ] Spacing
- [ ] Buttons
- [ ] Cards
- [ ] Badges
- [ ] Icons
- [ ] Form controls
- [ ] Responsive breakpoints
- [ ] Loading skeletons
- [ ] Empty states
- [ ] Error states

### TEST GATE

Check visual consistency across:
- [ ] Homepage
- [ ] PLP
- [ ] PDP
- [ ] Cart
- [ ] Account
- [ ] Admin
- [ ] Manufacturer

Admin/manufacturer should retain their appropriate application styling unless intentionally sharing primitives.

---

# PHASE 3 — Header / Navigation

- [ ] Announcement bar
- [ ] Desktop header
- [ ] Mobile header
- [ ] Mega menu
- [ ] Search
- [ ] Account
- [ ] Wishlist
- [ ] Cart
- [ ] Responsive behavior

### TEST GATE

- [ ] All links work
- [ ] Men categories work
- [ ] Women categories work
- [ ] Accessories work
- [ ] Search opens
- [ ] Wishlist opens
- [ ] Cart opens
- [ ] Mobile navigation works

---

# PHASE 4 — Homepage

- [ ] Hero carousel
- [ ] Shop Men
- [ ] Shop Women
- [ ] Accessories
- [ ] New Arrivals carousel
- [ ] Featured collections
- [ ] Best Sellers carousel
- [ ] Category discovery
- [ ] Benefits section
- [ ] Existing blog/news if applicable
- [ ] Newsletter
- [ ] Footer

### TEST GATE

- [ ] All API data loads
- [ ] Empty states work
- [ ] Loading states work
- [ ] Carousels work
- [ ] Mobile works
- [ ] No layout overflow
- [ ] No console errors

---

# PHASE 5 — Wishlist

- [ ] Backend model
- [ ] Migration
- [ ] API
- [ ] Authorization
- [ ] Frontend state
- [ ] Product-card heart
- [ ] Product-page heart
- [ ] Wishlist page
- [ ] Move to cart
- [ ] Duplicate protection
- [ ] Guest behavior if applicable
- [ ] Login merge if applicable
- [ ] Admin analytics if applicable

### TEST GATE

Test:

```text
Customer A adds Product A
Customer A sees Product A
Customer A removes Product A
Customer B cannot see Customer A's wishlist
Duplicate add does not create duplicate item
Out-of-stock product behaves correctly
Move to cart works
Logout/login persistence works
```

---

# PHASE 6 — Product Listing

- [ ] Filters
- [ ] Sort
- [ ] Product grid
- [ ] Wishlist
- [ ] Sale badges
- [ ] Pagination/infinite scroll
- [ ] Mobile filter drawer
- [ ] Search results

### TEST GATE

Test each filter and combination.

---

# PHASE 7 — Product Detail

- [ ] Image gallery
- [ ] Variant selection
- [ ] Size selection
- [ ] Wishlist
- [ ] Quantity
- [ ] Add to cart
- [ ] Buy now if existing
- [ ] Delivery check
- [ ] Product details
- [ ] Reviews
- [ ] Related products
- [ ] Recently viewed

### TEST GATE

- [ ] Invalid variant cannot be purchased
- [ ] Inventory respected
- [ ] Correct price shown
- [ ] Cart receives correct variant
- [ ] Wishlist receives correct product
- [ ] Manufacturer workflow unaffected

---

# PHASE 8 — Admin Merchandising

- [ ] Category management
- [ ] Collection management
- [ ] Product merchandising flags
- [ ] Hero slide management
- [ ] Homepage sections
- [ ] Product ordering
- [ ] Wishlist analytics if applicable

### TEST GATE

Admin can:

```text
Create category
Edit category
Archive category
Create collection
Assign product
Mark product as new
Mark product as bestseller
Configure hero
```

Then verify customer UI updates correctly.

---

# PHASE 9 — Manufacturer Regression

Run a complete manufacturer regression.

- [ ] Login
- [ ] Dashboard
- [ ] Assigned orders
- [ ] Production
- [ ] Status changes
- [ ] Quantity tracking
- [ ] Packaging
- [ ] Ready for dispatch
- [ ] Delivery-partner handoff
- [ ] Existing notifications
- [ ] Existing permissions

### HARD RULE

No storefront enhancement is considered complete if manufacturer functionality regresses.

---

# PHASE 10 — Admin Regression

- [ ] Login
- [ ] Dashboard
- [ ] Product management
- [ ] Inventory
- [ ] Orders
- [ ] Users
- [ ] Manufacturer management
- [ ] Existing reports
- [ ] Existing permissions
- [ ] New merchandising tools

---

# PHASE 11 — FINAL QA

Run:

## Functional

- [ ] Customer registration/login
- [ ] Product browsing
- [ ] Search
- [ ] Filters
- [ ] Wishlist
- [ ] Cart
- [ ] Checkout
- [ ] Orders
- [ ] Admin
- [ ] Manufacturer

## Visual

- [ ] Desktop
- [ ] Tablet
- [ ] Mobile
- [ ] 360px
- [ ] 390px
- [ ] 768px
- [ ] 1024px
- [ ] 1280px
- [ ] 1440px

## Technical

- [ ] No TypeScript errors
- [ ] No build errors
- [ ] No lint errors where linting exists
- [ ] No console errors
- [ ] No broken routes
- [ ] No broken images
- [ ] No unauthorized API access
- [ ] No N+1 query introduced
- [ ] No sound feature remains
- [ ] Database migrations succeed
- [ ] Existing tests pass
- [ ] New tests pass

---

# 31. TESTING STRATEGY

For each implementation task:

1. Change the smallest necessary set of files.
2. Run relevant unit/integration tests.
3. Run frontend build/typecheck.
4. Run backend tests/typecheck.
5. Manually verify the feature.
6. Check browser console.
7. Check network requests.
8. Check responsive layout.
9. Run regression tests for affected Admin/Manufacturer functionality.
10. Only then move to the next task.

Do not implement the entire project and test only at the end.

---

# 32. GIT / CHANGE SAFETY

Before large changes:

- Identify current working tree state.
- Avoid destructive rewrites.
- Preserve existing code where possible.
- Keep changes modular.
- Prefer small commits if Git is available.

Suggested logical commits:

```text
audit
remove-sound
design-system
header-navigation
homepage
wishlist-backend
wishlist-frontend
product-listing
product-detail
admin-merchandising
qa
```

---

# 33. IMPORTANT IMPLEMENTATION RULE

When existing functionality and the Bonkers-style requirement conflict:

### Existing business logic wins.

Change the presentation layer first.

Only change backend behavior when the new feature genuinely requires it.

For example:

```text
Existing manufacturer workflow
        ↓
KEEP

New Bonkers-style product card
        ↓
ADD

Existing order lifecycle
        ↓
KEEP

New wishlist
        ↓
ADD

Existing admin permissions
        ↓
KEEP

New merchandising controls
        ↓
ADD
```

---

# 34. DEFINITION OF DONE

The project is complete only when:

- [ ] Customer storefront has a polished Bonkers-inspired fashion ecommerce experience.
- [ ] Homepage has large editorial sections and product carousels.
- [ ] Header/navigation has fashion-store mega menus.
- [ ] Wishlist is fully functional and persistent.
- [ ] Product cards have wishlist and ecommerce actions.
- [ ] Product listing has modern filtering/sorting.
- [ ] Product detail has a rich gallery and related products.
- [ ] Search works well.
- [ ] Admin can manage merchandising.
- [ ] Categories/collections are data-driven.
- [ ] Existing customer features continue working.
- [ ] Existing Admin features continue working.
- [ ] Existing Manufacturer features continue working.
- [ ] Manufacturer production → packaging → delivery-partner workflow remains intact.
- [ ] Existing sound feature is completely removed from the storefront.
- [ ] Responsive UI works.
- [ ] Accessibility requirements are met.
- [ ] Performance is acceptable.
- [ ] Tests pass.
- [ ] No known regression remains.

---

# 35. FINAL REPORT REQUIRED FROM THE CODING AGENT

At the end, provide:

## Architecture discovered

```text
Frontend:
Backend:
Database:
Authentication:
Admin:
Manufacturer:
```

## Files changed

List every changed file.

## Backend changes

List:
- Models
- Migrations
- Routes
- Controllers
- Services
- Permissions

## Frontend changes

List:
- Pages
- Components
- Hooks
- State
- Styles

## New features

Checklist of completed features.

## Removed sound feature

List what was removed.

## Testing

Provide:

```text
Frontend build: PASS/FAIL
Backend tests: PASS/FAIL
Frontend tests: PASS/FAIL
Admin regression: PASS/FAIL
Manufacturer regression: PASS/FAIL
Customer regression: PASS/FAIL
Responsive QA: PASS/FAIL
```

## Known issues

List anything remaining.

Do not claim a test passed unless it was actually run.

---

# 36. MOST IMPORTANT INSTRUCTION

**Do not start coding until you have inspected the existing project architecture.**

First understand.

Then plan.

Then implement.

Then test.

Then continue.

The final result should feel like a **real modern streetwear fashion brand ecommerce store**, strongly inspired by the UX patterns of Bonkers Corner, while preserving the project's existing customer, admin, and distributed-manufacturing business logic.

The storefront should be visually prioritized over the existing storefront implementation, but the Admin and Manufacturer systems must remain stable.

