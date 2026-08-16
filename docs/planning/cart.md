Simple cart service — high-level scope

What it is responsible for

Cart: one logical basket per customer (typical pattern: one cart per authenticated userId; guest carts are optional and add session IDs + merge-on-login).

Line items: each row = product reference + quantity (+ optional snapshot of name/price at add time so totals stay stable if catalog prices change).

Operations (minimal set)

Area

Capability

Read

Get cart (create empty cart if missing)

Write

Add (or merge quantity if product already in cart)

Write

Update quantity (or treat quantity 0 as remove)

Write

Remove line

Write

Clear cart

Data & persistence

Postgres (already sketched in your docs: cart_db) with Cart + CartItem entities, or Redis for a truly minimal/ephemeral cart (trade-off: durability vs simplicity).

No cross-DB FK to products: store productId as a reference; consistency with catalog is via calls to product-service (or eventual events later).

Integration (fits your monorepo)

Transport: TCP microservice (like auth/product), e.g. port 3003, with message patterns such as GET_CART, ADD_ITEM, UPDATE_ITEM, REMOVE_ITEM, CLEAR_CART (see context/features/03-cart-service.md).

API gateway: HTTP routes under something like api/v1/cart that proxy to those patterns; JWT supplies userId for ownership checks.

Product service (simple version): optional validate product exists and optionally stock check on add/update; richer flows can defer stock to checkout.

Responses & rules of thumb

Return cart + items + computed subtotal (sum of price \* quantity) on mutations for a simple API.

Enforce authorization: every item operation must belong to the caller’s cart.

What you can skip in “v1 simple”

Coupons, reservations, multi-warehouse allocation, checkout payment, and strong inventory locking (cart usually does not permanently reserve stock).

Your scaffold today is still HTTP on port 3000 (apps/cart-service/src/main.ts); aligning it with createMicroservice + gateway client is the structural step when you implement.
