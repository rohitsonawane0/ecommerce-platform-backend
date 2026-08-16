# Project Status — Ecommerce Platform Backend

_Last reviewed: 2026-05-10_

A walkthrough of every service, the gateway, the shared lib, `docker-compose.yaml`, and `package.json` scripts.

## Done

### Infrastructure & shared

- Monorepo wired in `nest-cli.json` (8 apps + `@app/common`).
- `docker-compose.yaml`: Postgres for auth/product/cart/order/user + Redis.
- Gateway: helmet, CORS, global `ValidationPipe`, `ResponseInterceptor`, `AllExceptionsFilter`, `api/v1` prefix, global `AccessTokenGuard` via `APP_GUARD`.
- `libs/common`: service tokens, message constants, `JwtPayload` / `ApiResponse`, `@Public` / `@CurrentUser`, response interceptor, RPC + HTTP exception filters.

### auth-service (TCP 3001) — fully implemented

- register, login, refresh (with Redis blacklist), logout, me, forgotPassword (token hashed, 1h expiry, link logged not emailed), resetPassword, validateToken.
- Sanitized user output. `auth.service.spec.ts` exists.

### product-service (TCP 3002) — implemented

- Products: create / findAll (search + category filter + pagination) / findOne / update / softDelete, slug generation with collision suffix.
- Categories module with its own service.
- Gateway sub-module with DTOs.

### cart-service (TCP 3003) — implemented

- get / add / remove / clear cart. Calls product-service over TCP for product lookup.
- Cart + CartItem entities.

### orders-service (TCP 3004) — implemented

- Create from cart snapshot inside a TypeORM transaction, address lookup via user-service, clears cart after creation, findAll / findOne / cancel / updateStatus.

### payment-service (TCP 3005) — partial

- `payments.create` fetches order via `ORDER_SERVICE`, creates Stripe Checkout session with multi-line items and metadata. Gateway controller wired.

### user-service (TCP 3006) — addresses module implemented

- create / list / get / update / remove / setDefault / getForOrder, default-shipping/billing uniqueness enforced inside transactions, soft delete.

## Remaining checklist

### Critical / blocking

- [ ] **Stripe webhook handler** — `stripe.controller.ts` is empty. No `payment_intent.succeeded` / `checkout.session.completed` route, so orders never transition `pending → paid`. No raw-body middleware or signature verification.
- [ ] **Persist payments** — `Payment` entity exists but `PaymentsService` never saves a row. `findAll` / `findOne` / `update` / `remove` are placeholder strings.
- [ ] **Gateway `payments.findAll`** sends a hardcoded `{ id: 'hii' }` payload — stub code.
- [ ] **Cart `updateCartItems`** missing return for the "new item" branch in some paths; `findProduct` is called but inventory/stock is not validated. `findAll` / `update` / `remove` return template strings.
- [ ] **Orders `shippingAddressId` null check is inverted**: `if (dto.shippingAddressId !== null)` calls `ADDRESS_MESSAGES.GET`, the `else` branch calls `GET_FOR_ORDER` with a null id — should be the other way around (default address when not provided).
- [ ] **Inventory decrement** on order creation — not implemented; product stock is never reduced.

### Services declared but not built

- [ ] **inventory-service** — folder doesn't exist; domain needs it (or fold into product-service).
- [ ] **notification-service** — no folder; password-reset and order emails are `console.log` stubs.
- [ ] **`order-service` vs `orders-service`** duplicate entry in `nest-cli.json` — clean up.

### Auth / security

- [ ] Email sending for forgot-password (currently logs the link).
- [ ] Refresh tokens stored only as JWT + blacklist; consider per-user refresh allowlist/rotation tracking.
- [ ] `JWT_SECRET` falls back to literal `'jwt-secret'` — fail-closed in non-dev.
- [ ] No role-based guard usage (admin endpoints for product/category create/update/delete are unrestricted).

### Config & ops

- [ ] No `ConfigModule` despite `@nestjs/config` being installed — service ports, DB creds, Stripe keys, JWT secrets read directly from `process.env`, and ports are hardcoded in two places per service.
- [ ] `synchronize: true` everywhere — TypeORM migrations needed before any prod use.
- [ ] No health checks (`/health`, `@nestjs/terminus`).
- [ ] No global rate limiting (`@nestjs/throttler`).
- [ ] No structured logger (Pino/Winston); leftover `console.log` debug in cart controller, payments controller, addresses gateway, orders service.
- [ ] No Swagger/OpenAPI generation (currently `FRONTEND_API_DOCS.md` only).

### Testing

- [ ] Most `*.spec.ts` files are auto-generated stubs (cart, payments, products controllers). Real coverage exists only for auth-service.
- [ ] No e2e tests under any `apps/*/test/`.

### Cleanup

- [ ] Many uncommitted scratch/planning files at repo root (`scratch.ts`, `cart.md`, `*_guide.md`, `ROADMAP.md`, etc.) — decide what to keep vs ignore.
- [ ] `apps/api-gateway/src/api-gateway.module.ts` has a commented-out `CategoriesModule` import.
- [ ] `StripeController` is empty — either remove or implement the webhook there.

## Suggested next priorities

1. Stripe webhook + payment persistence + order status transition.
2. Fix the inverted shipping-address branch in `orders.service.ts`.
3. Add inventory decrement on order creation.
4. Wire `ConfigModule` and remove hardcoded secrets/ports.
