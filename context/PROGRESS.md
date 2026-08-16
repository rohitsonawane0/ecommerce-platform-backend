# Project Progress — Ecommerce Platform Backend

> Last updated: 2026-08-16

---

## Architecture

NestJS monorepo. Microservices talk over TCP. One API Gateway handles all HTTP traffic.
Every service also serves HTTP `/health/live` + `/health/ready` (port 8080 for the TCP services,
the gateway's own port for the gateway) — see [Containerization & Kubernetes](#containerization--kubernetes).

```
[Client]
   │ HTTP :3000
   ▼
[API Gateway] ──TCP──► [Auth Service :3001]    ──► [Postgres auth_db :5433]
   │                          └────────────────► [Redis :6379]
   │
   ├──TCP──► [Product Service :3002] ──► [Postgres product_db :5435]
   │
   ├──TCP──► [Cart Service :3003]    ──► [Postgres cart_db :5436]
   │                                  │
   │                                  └──TCP──► [Product Service :3002]
   │
   ├──TCP──► [Orders Service :3004]  ──► [Postgres order_db :5437]
   │                                  │
   │                                  ├──TCP──► [Cart Service :3003]
   │                                  └──TCP──► [User Service :3006]   (shipping address)
   │
   ├──TCP──► [Payment Service :3005] ──► [Stripe API]   (no DB — see below)
   │                                  │
   │                                  └──TCP──► [Orders Service :3004]
   │
   └──TCP──► [User Service :3006]    ──► [Postgres user_db :5448]
```

---

## Overall: ~75%

| Component              | Status      | Done |
| ---------------------- | ----------- | ---- |
| Auth Service           | Working     | 90%  |
| Product Service        | Working     | 95%  |
| Cart Service           | Working     | 75%  |
| Orders Service         | Working     | 85%  |
| API Gateway            | Working     | 85%  |
| Common Library         | Working     | 95%  |
| Containerization / K8s | Partial     | 60%  |
| User Service           | Partial     | 45%  |
| Payment Service        | Partial     | 40%  |
| Security               | Partial     | 60%  |
| Testing                | **Failing** | 0%   |
| Inventory Service      | Not started | 0%   |
| Notification Svc       | Not started | 0%   |

---

## What's Done & Working

### Auth Service (port 3001) — 90%

| Feature          | Status | Details                                                                                                       |
| ---------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| Register         | Done   | Email uniqueness check, bcrypt (10 rounds), returns access + refresh tokens                                   |
| Login            | Done   | Credential validation in `validateCredentials()`, dual token generation                                       |
| Token refresh    | Done   | Verifies refresh token, blacklists old one in Redis, issues new pair, re-fetches user                         |
| Logout           | Done   | Gateway extracts Bearer token, sends to auth-service, blacklisted in Redis with TTL                           |
| Me               | Done   | Returns sanitized user (no password, no reset tokens)                                                         |
| Forgot password  | Done   | Crypto-random token, SHA256 hashed, 1hr expiry, doesn't leak user existence (always 200)                      |
| Reset password   | Done   | Validates token + expiry via QueryBuilder, hashes new password, clears reset fields                           |
| Token validation | Done   | `validateToken` MessagePattern — verifies JWT signature + checks Redis blacklist, returns `{id, email, role}` |

**JWT setup:** Access token 15m, refresh token 7d, separate secrets (`JWT_SECRET`, `JWT_REFRESH_SECRET`), Redis blacklist with TTL keyed by `bl:<token>`.

**Module wiring:** `JwtModule.register()` configured in `auth.module.ts`. Redis client provided as `'REDIS_CLIENT'` token via `useFactory`. `AllRpcExceptionsFilter` registered globally in `main.ts`.

**Strategies cleanup:** `local.strategy.ts` and `jwt-refresh.strategy.ts` were deleted. `jwt.strategy.ts` still exists on disk but is not registered in any module — token verification is done directly by `jwtService.verify()` (Passport strategies don't fit TCP transport). Spec file still references the dead `JwtStrategy` provider.

### Product Service (port 3002) — 95%

| Feature                    | Status | Details                                                                                                                                     |
| -------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Create product             | Done   | Auto-slug via slugify, timestamp-suffix on conflict, validates category IDs exist, returns product with `categories` relation               |
| List products              | Done   | Pagination (page/limit, defaults 1/10), ILIKE search on name/description, comma-separated category slug filter, ordered by `createdAt DESC` |
| Get product                | Done   | By ID, loads `categories` relation, throws RpcException 404 if missing                                                                      |
| Update product             | Done   | Slug regeneration only when name changes, conflict handling with timestamp suffix                                                           |
| Delete product             | Done   | Soft delete via `@DeleteDateColumn`, 404 check first                                                                                        |
| Create category            | Done   | Name uniqueness check, auto-slug                                                                                                            |
| List categories            | Done   | `findAndCount`, returns `{meta: {total}, data}`                                                                                             |
| Get/Update/Delete category | Done   | Update checks name uniqueness on rename, regenerates slug; delete is soft                                                                   |
| Product-Category relation  | Done   | ManyToMany with `@JoinTable` on Product side                                                                                                |
| Stock check constraint     | Done   | `@Check('"stock" >= 0')` on Product entity                                                                                                  |

**Responses wrapped via `ResponseHelper.success()` in controllers** — gives consistent `{success, message, data, meta?}` shape over the wire. `AllRpcExceptionsFilter` registered globally in `main.ts`.

### Cart Service (port 3003) — 75%

| Feature             | Status   | Details                                                                                                                                                                                  |
| ------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create cart         | Done     | Per-user, idempotent (returns existing cart if found by userId)                                                                                                                          |
| Add to cart         | Done     | Auto-creates cart if no cartId provided, calls product-service via TCP to validate product, stores real name/price snapshot in `cart_items`, increments quantity if item already present |
| Get my cart         | Done     | By userId with `items` relation loaded, 404 if missing                                                                                                                                   |
| Remove from cart    | Done     | Ownership check (`item.cart.userId === dto.userId`), returns refreshed cart                                                                                                              |
| Clear cart          | Done     | `clearCart(userId)` deletes all `cart_items` for the user's cart. MessagePattern `CART_MESSAGES.CLEAR_CART` exposed; consumed by orders-service after successful order create.           |
| Update quantity     | Not done | Can only increment via add; no set/decrement endpoint                                                                                                                                    |
| Sync prices on read | Not done | `getMyCart` returns the snapshot price from time-of-add, not live product price                                                                                                          |

**Cart-Product integration:** Wired up. `CartModule` registers `PRODUCT_SERVICE` ClientProxy on TCP `:3002` (with `transport: Transport.TCP` set explicitly). `cart.service.ts` `findProduct()` calls `PRODUCT_MESSAGES.FIND_ONE`, throws RpcException 404 if no `data` returned. Denormalized in `cart_items` (productName, productPrice) as a price snapshot.

**Constraint:** `@Check('"quantity" >= 1')` on CartItem entity. `AllRpcExceptionsFilter` registered globally in `main.ts`.

**Gateway exposure:** Gateway exposes add/get/remove HTTP endpoints — but **not clearCart**. ClearCart is currently only invokable from another microservice (orders-service).

**Dead code in CartService:** `findAll()`, `update()`, `remove()` still return placeholder strings (`"This action returns all cart"`) at `cart.service.ts:29-43` — leftover from `nest g resource` scaffold, no controller hooks them up.

### Orders Service (port 3004) — 85%

| Feature              | Status   | Details                                                                                                                                                                                       |
| -------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entities             | Done     | `Order` (id, userId, totalAmount, status enum, items, timestamps) and `OrderItem` (productId, productName, price, quantity) with `cascade: true` on the items relation                       |
| Order status enum    | Done     | `PENDING`, `CONFIRMED`, `SHIPPED`, `DELIVERED`, `CANCELLED`                                                                                                                                   |
| Create order         | Done     | Pulls cart via `CART_MESSAGES.GET_CART`, snapshots items + computes total in a single DB transaction (`dataSource.transaction`), then best-effort calls `CART_MESSAGES.CLEAR_CART` (logged on failure) |
| **Shipping address** | **Done** | **NEW** — `create` resolves `dto.shippingAddressId` via `ADDRESS_MESSAGES.GET` against user-service before writing the order                                                                   |
| List orders          | Done     | `findAllForUser` uses `findAndCount` with `relations: ['items']`, ordered by `createdAt DESC`. Returns `{ data, meta: { total, page, limit } }`                                              |
| Get order            | Done     | `findOneForUser` scoped to `(id, userId)`, loads `items`, 404 if missing. Also consumed by payment-service over TCP                                                                          |
| Cancel order         | Done     | `cancelOrder` checks ownership and refuses unless status is `PENDING`                                                                                                                          |
| Update status        | Done     | Admin-only intent (no role guard yet); `updateStatus(id, status)`                                                                                                                              |
| `CreateOrderDto`     | Done     | **NEW** — now validated: `shippingAddressId` (`@IsUUID` + `@IsNotEmpty`), `billingAddressId` (`@IsUUID` + `@IsOptional`)                                                                       |
| `CreateOrderItemDto` | Not done | Still an empty class shell — imports `class-validator` decorators but declares no fields                                                                                                      |
| `UpdateOrderStatusDto` | Not done | Plain typed shape (`{id, status}`), no `class-validator` decorators                                                                                                                          |
| Inventory deduction  | Not done | No call to a future inventory service after order creation                                                                                                                                     |
| Payment integration  | Partial  | Payment-service calls **into** orders (`ORDER_MESSAGES.FIND_ONE`); orders never calls back, and nothing flips `PENDING → CONFIRMED`                                                            |

**Module wiring:** `OrdersModule` imports `TypeOrmModule.forFeature([Order, OrderItem])` and registers **two** ClientProxies — `CART_SERVICE` (TCP `:3003`) and `USER_SERVICE` (TCP `:3006`). `AllRpcExceptionsFilter` registered globally in `main.ts`.

**Source of truth for create:** cart contents are fetched server-side from cart-service; only the address IDs come from the request body.

### Payment Service (port 3005) — 40%

First cut of the Stripe checkout flow. Works end-to-end for the happy path, but has no persistence.

| Feature                 | Status   | Details                                                                                                                              |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Create checkout session | Done     | `PAYMENT_MESSAGES.CREATE` → fetches order via `ORDER_MESSAGES.FIND_ONE`, rejects unless `status === 'pending'`, builds Stripe line items from order items, returns `{url, sessionId}` |
| Stripe line items       | Done     | Multi-product — maps `order.items` to `price_data`, converts to cents via `Math.round(Number(item.price) * 100)`                     |
| Payment-intent metadata | Done     | `orderId` + `userId` attached to the Stripe PaymentIntent, ready for webhook correlation                                             |
| **Persistence**         | Not done | `payment.entity.ts` is literally `export class Payment {}` — no TypeORM, no DB, no `payment_db`. Nothing about a payment is recorded  |
| **Webhook handler**     | Not done | `PAYMENT_MESSAGES.WEBHOOK` constant exists; no handler. Nothing ever confirms the order after Stripe succeeds                        |
| findAll / findOne / update / remove | Not done | `nest g resource` placeholders returning strings; bound to ad-hoc patterns `'findAllPayments'`, `'findOnePayment'`, etc. — **not** the `PAYMENT_MESSAGES` constants |
| Refund                  | Not done | `PAYMENT_MESSAGES.REFUND` constant exists; no handler                                                                                |

**Module wiring:** `HealthModule`, `PaymentsModule`, `StripeModule.forRootAsync()`. Stripe key read as `process.env.STRIPE_KEY` (non-null asserted in the constructor — throws opaquely if unset).

**Hardcoded:** `success_url` / `cancel_url` point at `http://localhost:4000` in `stripe.service.ts` — will break in any deployed environment.

### User Service (port 3006) — 45%

Scoped to **addresses only** so far. No user profiles, no preferences.

| Feature          | Status   | Details                                                                                                            |
| ---------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| Create address   | Done     | Runs in a `dataSource.transaction`; unsets any existing default before setting a new `isDefaultShipping` / `isDefaultBilling` |
| List addresses   | Done     | Scoped by `userId`, ordered defaults-first then `updatedAt DESC`                                                   |
| Get address      | Done     | Scoped `(id, userId)`, throws `NotFoundException` if missing                                                       |
| Update / Delete  | Done     | Ownership-scoped                                                                                                   |
| Set default      | Done     | `ADDRESS_MESSAGES.SET_DEFAULT` with a `'shipping' \| 'billing'` type discriminator                                  |
| Get for order    | Done     | `ADDRESS_MESSAGES.GET` consumed by orders-service during order creation                                            |
| User profiles    | Not done | No `User` entity here — user identity still lives entirely in auth-service                                         |

**DB:** Postgres `user_db` on host port **5448**.

### API Gateway (port 3000) — 85%

**Middleware:** Helmet, CORS (`origin: '*'`), `ValidationPipe` (whitelist + transform + forbidNonWhitelisted + implicit conversion), global prefix `api/v1`.

**Globals (wired in `main.ts`):**

- `ResponseInterceptor` registered globally (no longer per-controller).
- `AllExceptionsFilter` registered globally — catches `HttpException`, RPC-shaped errors `{statusCode, message, error}` propagated from microservices, and unknown exceptions; logs at `warn` (4xx) or `error` (5xx) and returns the `ApiResponse` envelope `{success: false, message, data: null, meta: {statusCode, error, path, timestamp}}`.

**Global guard:** `AccessTokenGuard` registered via `APP_GUARD` in `api-gateway.module.ts`. Verifies JWT signature locally with `jwtService.verifyAsync`, attaches payload to `request.user`. `@Public()` decorator bypasses it.

**Sub-modules:** `auth`, `products` (+ `categories`), `cart`, `orders`, `payments`, `addresses`.

| Endpoint                | Method | Auth      | Status                                                       |
| ----------------------- | ------ | --------- | ------------------------------------------------------------ |
| `/health/live`          | GET    | Public    | Working — shared `HealthController` from `@app/common`       |
| `/health/ready`         | GET    | Public    | Working — `SELECT 1` against the DataSource, 503 on failure  |
| `/auth/register`        | POST   | Public    | Working                                                      |
| `/auth/login`           | POST   | Public    | Working                                                      |
| `/auth/refresh`         | POST   | Public    | Working                                                      |
| `/auth/logout`          | POST   | Protected | Working — extracts Bearer token, sends to auth-service       |
| `/auth/me`              | GET    | Protected | Working — uses `@CurrentUser()`                              |
| `/auth/forgot-password` | POST   | Public    | Working                                                      |
| `/auth/reset-password`  | POST   | Public    | Working                                                      |
| `/products`             | POST   | Public    | Working — should be admin-only                               |
| `/products`             | GET    | Public    | Working — has `console.log(query)` left in                   |
| `/products/:id`         | GET    | Public    | Working                                                      |
| `/products/:id`         | PATCH  | Public    | Working — should be admin-only                               |
| `/products/:id`         | DELETE | Public    | Working — should be admin-only                               |
| `/categories`           | POST   | Public    | Working — should be admin-only                               |
| `/categories`           | GET    | Public    | Working                                                      |
| `/categories/:id`       | GET    | Public    | Working                                                      |
| `/categories/:id`       | PATCH  | Public    | Working — should be admin-only                               |
| `/categories/:id`       | DELETE | Public    | Working — should be admin-only                               |
| `/cart/items`           | POST   | Protected | Working — userId injected from JWT, body uses `any` (no DTO) |
| `/cart`                 | GET    | Protected | Working                                                      |
| `/cart/:id`             | DELETE | Protected | Working — passes cartItemId + userId for ownership check     |
| `/orders`               | POST   | Protected | Working — body carries `shippingAddressId`; cart drives items |
| `/orders`               | GET    | Protected | Working — paginated (`page`, `limit` query params)           |
| `/orders/:id`           | GET    | Protected | Working                                                      |
| `/orders/:id/cancel`    | POST   | Protected | Working — only allowed when order status is `PENDING`        |
| `/addresses`            | POST   | Protected | Working — body typed `any`, has a `console.log(dto, ...)`    |
| `/addresses`            | GET    | Protected | Working                                                      |
| `/addresses/:id`        | GET    | Protected | Working                                                      |
| `/addresses/:id`        | PATCH  | Protected | Working — body typed `any`                                   |
| `/addresses/:id`        | DELETE | Protected | Working                                                      |
| `/addresses/:id/default` | POST  | Protected | Working — `{type: 'shipping' \| 'billing'}`                  |
| `/payments`             | POST   | Protected | Working — returns Stripe checkout URL. Body typed `any`      |
| `/payments`             | GET    | Protected | **Broken** — sends `FIND_BY_ORDER` with a hardcoded `{id: 'hii'}` debug payload |
| `/payments/:id`         | GET    | Protected | Stub — hardcoded pattern string `'payment.findOne'`, backend returns a placeholder |
| `/payments/:id`         | PATCH  | Protected | Stub — hardcoded pattern `'payment.update'`, no matching handler |
| `/payments/:id`         | DELETE | Protected | Stub — hardcoded pattern `'payment.remove'`, no matching handler |

### Common Library (`libs/common`) — 95%

| What              | Details                                                                                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service constants | `AUTH_SERVICE`, `CART_SERVICE`, `INVENTORY_SERVICE`, `NOTIFICATION_SERVICE`, `ORDER_SERVICE` (= `'orders-service'`), `PAYMENT_SERVICE`, `PRODUCT_SERVICE`, `USER_SERVICE`                             |
| Message constants | `AUTH_MESSAGES` (8), `PRODUCT_MESSAGES` (13), `CART_MESSAGES` (4), `ORDER_MESSAGES` (5), `ADDRESS_MESSAGES` (7), `PAYMENT_MESSAGES` (5 — only `CREATE` has a handler)                                 |
| Guards            | `AccessTokenGuard` — global JWT guard, checks `@Public()` metadata, throws `UnauthorizedException` (401) on missing/invalid token                                                                    |
| Decorators        | `@Public()` — sets `IS_PUBLIC_KEY` metadata. `@CurrentUser()` — extracts `request.user` (JWT payload)                                                                                                |
| Helpers           | `ResponseHelper.success()` / `ResponseHelper.error()` — consistent `{success, message, data, meta?}` shape                                                                                           |
| Interceptors      | `ResponseInterceptor` auto-wraps responses. Handles three cases: already-shaped `ApiResponse`, payloads with `data` property, or raw values                                                          |
| Filters           | `AllExceptionsFilter` (HTTP, used in gateway) and `AllRpcExceptionsFilter` (RPC, used in every microservice's `main.ts`). Both normalize errors and log at `warn`/`error`                            |
| **Health**        | **NEW** — `HealthModule` + `HealthController` exporting `/health/live` and `/health/ready`. Readiness runs `SELECT 1` against an `@Optional()`-injected DataSource and sets 503 via `@Res({passthrough})` rather than throwing (the catch-all RPC filter returns an Observable an HTTP response can't consume) |
| Interfaces        | `JwtPayload` (id, email, role), `ApiResponse<T>`                                                                                                                                                     |
| Enums             | `UserRole` (USER, ADMIN)                                                                                                                                                                             |
| DTOs in common    | None yet — every service still owns its own DTOs (decision doc in `context/decisions/shared-dtos.md` says they should move here)                                                                     |

---

## Containerization & Kubernetes

**NEW since the last update.** The stack now runs on Kubernetes locally. It is **not** hosted in the cloud.

### Done

| What                    | Details                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Dockerfiles             | All 7 services (`apps/*/Dockerfile`). Repo root is the build context so `@app/common` resolves                                |
| `.dockerignore` / `.gcloudignore` | Added                                                                                                               |
| Cloud Build             | `cloudbuild.yaml` builds all 7 images in parallel (`waitFor: ['-']`), pushes to Artifact Registry `asia-south1-docker.pkg.dev`. Tagged `$SHORT_SHA` + `latest`; a failed build pushes nothing |
| Health endpoints        | Shared `HealthModule`; TCP services run as hybrid apps exposing HTTP on `healthPort` 8080                                     |
| Helm chart              | `k8s/ecommerce/` — Chart + `values.yaml` + `_helpers.tpl` (labels, image ref, pull secrets) + Deployment & Service per service |
| Probes                  | Liveness + readiness wired on every Deployment                                                                                |
| Resources               | requests `50m` / `128Mi`, limits `500m` / `512Mi` (shared across all services)                                                |
| Secrets                 | Consumed from a `ecommerce-secrets` Secret created out-of-band (`db-password`, `jwt-secret`, `jwt-refresh-secret`, `stripe-key`) |
| Local cluster           | Running on **orbstack**. All 7 pods `Running`. Gateway exposed as a `LoadBalancer` on `localhost:3000`                        |
| Dev compose             | `docker-compose-dev.yaml` — 5 Postgres containers (5433/5435/5436/5437/5448) + Redis 6379. Kong is present but commented out  |

### Gaps

| Gap                        | Impact                                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **TCP doesn't load-balance** | ⛔ **Hard blocker.** A ClusterIP DNATs once at connect time; `Transport.TCP` holds one long-lived socket, so every gateway replica pins to a single backend pod forever. Every `replicas` value in `values.yaml` is currently a lie. See `docs/guides/K8S_PRODUCTION_HOSTING.md` §B1 |
| **State lives outside the cluster** | `db.host` and `redis.host` are `host.docker.internal` — pods reach the Mac's docker-compose containers. Un-hostable as-is |
| No Ingress                 | Gateway is a raw `LoadBalancer`; no TLS, no cert-manager, no single edge                                        |
| No Namespace               | Everything deploys into `default`                                                                               |
| No HPA                     | Blocked by the TCP issue anyway                                                                                 |
| No PodDisruptionBudget     | A node drain takes services fully down                                                                          |
| No NetworkPolicy           | Any pod can reach any other pod                                                                                 |
| No ConfigMap               | Env vars are inlined in every Deployment template                                                               |
| No migrations              | `synchronize: true` in all 5 TypeORM configs — schema drift can drop columns                                    |
| Chart metadata unedited    | `Chart.yaml` still has the scaffold `description`, `version: 0.1.0`, `appVersion: "1.16.0"` (vs `global.tag: 0.2.0`) |
| Cloud SQL unused           | `ecommerce-db` instance is provisioned and idle (~$12/mo) — the chart points at local Postgres instead          |

---

## Known Bugs

| #   | Bug                                                                                                                | File                                                          | Impact                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1   | Gateway doesn't check Redis token blacklist — revoked tokens still pass JWT signature check until JWT expiry (15m) | `libs/common/src/guards/access-token.guard.ts:31`             | Logout doesn't fully prevent gateway access                           |
| 2   | Gateway `ClientsModule.register` missing explicit `transport: Transport.TCP` in 4 sub-modules                       | gateway `cart`, `products`, `payments`, `addresses` modules   | Works only because TCP is the default; should be explicit for clarity |
| 3   | `GET /payments` sends a hardcoded debug payload `{id: 'hii'}`                                                       | `apps/api-gateway/src/payments/payments.controller.ts:34`     | Endpoint is non-functional and ships debug data                       |
| 4   | Payment gateway controller uses hardcoded pattern strings (`'payment.findOne'`, `'payment.update'`, `'payment.remove'`) instead of `PAYMENT_MESSAGES` | `apps/api-gateway/src/payments/payments.controller.ts:40-56` | Violates the project's own constants rule; none match a real handler → silent "no handler" hangs |
| 5   | Payment-service handlers bound to ad-hoc patterns (`'findAllPayments'`, `'findOnePayment'`, …)                      | `apps/payment-service/src/payments/payments.controller.ts:19-35` | Same rule violation from the other side; patterns don't match the gateway's |
| 6   | `Payment` entity is an empty class — payment-service has no database at all                                         | `apps/payment-service/src/payments/entities/payment.entity.ts` | No record of any payment attempt, ever                                |
| 7   | Stripe `success_url`/`cancel_url` hardcoded to `http://localhost:4000`                                              | `apps/payment-service/src/stripe/stripe.service.ts:38-39`     | Breaks in any deployed environment                                    |
| 8   | No Stripe webhook handler — nothing transitions an order `PENDING → CONFIRMED` after payment                        | payment-service                                               | Payment flow is one-way; orders never confirm                         |
| 9   | `console.log` left in production paths (9 non-`main.ts` sites)                                                      | gateway products + addresses controllers, cart-service controller, orders-service `orders.service.ts:46,57`, payment-service controller, `all-exceptions.filter.ts:65` | Noise in production logs                                              |
| 10  | `console.log(\`Password reset link...\`)` in auth-service                                                           | `apps/auth-service/src/auth/auth.service.ts`                  | Acceptable as email-stub, but logs the secret token                   |
| 11  | `CartService.findAll/update/remove` return placeholder strings                                                      | `apps/cart-service/src/cart/cart.service.ts:29-43`            | Dead scaffold code; no callers but misleading                         |
| 12  | Hardcoded JWT secret fallbacks (`'jwt-secret'`, `'jwt-refresh-secret'`) in 8 places                                 | gateway module, auth.service ×4, auth.module, jwt.strategy, access-token.guard | Silent insecurity if env var missing — and the k8s Secret makes this a live footgun |
| 13  | `cart.service.ts updateCartItems` has default values `productName='test product', productPrice=100`                 | `apps/cart-service/src/cart/cart.service.ts:141-142`          | Real callers always pass values, but the defaults are footguns        |
| 14  | `CreateOrderItemDto` empty; `UpdateOrderStatusDto` has no validators                                                | `apps/orders-service/src/orders/dto/*.ts`                     | No validation on status-update payloads                               |
| 15  | Gateway bodies typed `any` on add-to-cart, addresses create/update, payments create                                 | gateway cart / addresses / payments controllers               | Validation only happens server-side; gateway-boundary safety lost     |
| 16  | `STRIPE_KEY` non-null asserted at construction                                                                      | `apps/payment-service/src/stripe/stripe.service.ts:15`        | Opaque crash instead of a clear fail-fast if unset                    |
| 17  | Stale comments `//s` and `//d`                                                                                      | `apps/cart-service/src/cart-service.module.ts:6`, `apps/api-gateway/src/auth/auth.module.ts:19` | Minor, but clutter                                                   |

---

## Security Audit

| Area                      | Status   | Details                                                                                 |
| ------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| Helmet                    | Done     | Security headers in gateway                                                             |
| CORS                      | Partial  | `origin: '*'` — restrict before production                                              |
| Input validation          | Done     | Global `ValidationPipe` with whitelist, transform, forbidNonWhitelisted                 |
| JWT auth                  | Done     | Dual tokens, Redis blacklist, separate secrets, bcrypt 10 rounds                        |
| Global gateway auth guard | Done     | `AccessTokenGuard` wired via `APP_GUARD`, `@Public()` opt-out                           |
| Centralized error handler | Done     | `AllExceptionsFilter` (HTTP, gateway) + `AllRpcExceptionsFilter` (RPC, each service)    |
| Secrets management        | Partial  | K8s Secret (`ecommerce-secrets`) created out-of-band — but every consumer still has an insecure literal fallback |
| Rate limiting             | Not done | `@nestjs/throttler` installed but not wired up — no `Throttler` reference anywhere in `apps/` or `libs/` |
| Role-based access         | Not done | `UserRole` enum exists, but there is **no `@Roles()` decorator or guard** — product/category mutations are public |
| Gateway blacklist check   | Not done | Gateway only verifies JWT signature, doesn't hit Redis or call `auth.validateToken`     |
| Password strength         | Not done | Accepts any 8+ char string                                                              |
| Email verification        | Not done | `isEmailVerified` field exists but never set or checked                                 |
| Stripe webhook signature  | Not done | No webhook endpoint yet — signature verification will be mandatory when added           |
| NetworkPolicy             | Not done | Flat pod network in the cluster                                                         |
| CSRF                      | N/A      | API-only backend, no cookies                                                            |
| SQL injection             | Safe     | TypeORM parameterized queries throughout                                                |

---

## Testing — 0% (suite is RED)

**The test suite no longer passes.** `pnpm test`:

```
Test Suites: 13 failed, 9 passed, 22 total
Tests:       11 failed, 14 passed, 25 total
```

This is a regression, not new coverage. The specs are still almost entirely `it('should be defined')` boilerplate; they broke because services gained constructor dependencies that the scaffold `Test.createTestingModule` never provided.

### Failure causes

| Cause                                                         | Suites affected                                                                                          |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `Nest can't resolve dependencies` — missing repository mocks  | product-service `categories.service`/`.controller`, `products.controller`; cart-service `cart.service`/`.controller` |
| `Nest can't resolve dependencies` — missing `ClientProxy` mocks | gateway `products.controller`, `categories.controller`; payment-service `payments.service`/`.controller` (`orders-service` token) |
| `Cannot find module './cart.service'`                          | `apps/api-gateway/src/cart/cart.controller.spec.ts` — spec imports a file that doesn't exist              |
| `Cannot find module './payments.service'`                      | `apps/api-gateway/src/payments/payments.controller.spec.ts` — same                                        |
| Stripe constructor runs for real (no `STRIPE_KEY`)             | payment-service `stripe.service`/`stripe.controller`                                                      |

### Real coverage

| File                                                | Status      | Tests                                                                                                       |
| --------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| `apps/product-service/.../products.service.spec.ts` | Real        | 6 tests — covers `create` (success, slug-conflict, no categories, missing categories) and `findOne`         |
| Everything else                                     | Boilerplate | `it('should be defined')`, and half of them now fail to even construct                                      |

No spec files for orders-service or user-service. No integration tests. No e2e tests (e2e files are still NestJS scaffold, and `test:e2e` points at `apps/ecommerce-platform-backend/test/` which doesn't exist).

---

## Not Yet Built

Defined in `nest-cli.json` but no source code:

| Service                  | Purpose                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| **inventory-service**    | Stock management, availability checks, decrement on order                                                |
| **notification-service** | Email/SMS — password reset, order confirmation, shipping updates                                         |

`nest-cli.json` also has a stale `order-service` entry alongside `orders-service`; only `apps/orders-service/` exists on disk. (Note `cloudbuild.yaml` pushes orders-service images to an Artifact Registry repo named `order` — singular — which is intentional but easy to misread.)

Also missing from user-service: actual user profiles. Only addresses are implemented.

---

## Code Quality Issues

- Test suite is red (13/22 suites) — see [Testing](#testing--0-suite-is-red)
- `console.log` in production code — 9 non-`main.ts` sites
- Hardcoded message-pattern strings in payment-service and the gateway payments controller, bypassing the `*_MESSAGES` constants the project mandates
- Duplicated `generateSlug()` in `ProductsService` and `CategoriesService` — extract to `@app/common`
- Duplicated DTOs across gateway and microservices — decision doc exists (`context/decisions/shared-dtos.md`) but not yet executed
- `CreateOrderItemDto` imports `class-validator` decorators but declares no fields; `UpdateOrderStatusDto` is a plain typed shape
- Payment-service `findAll/findOne/update/remove` are `nest g resource` placeholders returning strings
- Dead scaffold files: `libs/common/src/{common.module,common.service}.ts`, `apps/*/src/<service-name>.{controller,service}.ts` for product/cart/payment (Hello-World scaffold still wired into `CartServiceModule` and `PaymentServiceModule`)
- Dead scaffold module: `apps/api-gateway/src/products/categories/categories.module.ts` defines `CategoriesModule` but it's never imported
- Dead scaffold methods in `CartService` (`findAll/update/remove` return strings)
- Payment-service `stripe/` folder still carries scaffold `create-stripe.dto.ts`, `update-stripe.dto.ts`, `stripe.entity.ts` that nothing uses
- `synchronize: true` in all five TypeORM configs — must disable for production, use migrations
- Hardcoded JWT secret fallbacks in 8 places — should fail-fast if env vars missing
- No `.env.example` file (only a gitignored `.env`)
- `JwtStrategy` (`apps/auth-service/src/auth/strategies/jwt.strategy.ts`) is dead code — defined but no longer wired into any module. The auth-service spec still references it
- Gateway bodies typed `any` on cart, addresses, and payments endpoints
- Stale `//s` and `//d` comments in `cart-service.module.ts` and gateway `auth.module.ts`
- `ConfigModule.forRoot({ isGlobal: true })` is mounted in multiple places but no service actually uses `ConfigService` — env reads go through `process.env` directly
- `Chart.yaml` still carries scaffold metadata

---

## What to Build Next

**Ordered by what unblocks the most.** Items 1–3 are prerequisites for real hosting.

1. **Fix TCP load-balancing (⛔ blocker)** — `Transport.TCP` + ClusterIP pins one socket to one pod, so every `replicas` value is currently fiction. Options: headless Services + client-side discovery, swap to NATS or Redis transport, or move to gRPC. NATS is the conventional answer for this shape. See `docs/guides/K8S_PRODUCTION_HOSTING.md` §B1
2. **Get state into the cluster** — replace `host.docker.internal` with in-cluster Postgres (CloudNativePG) + Redis, or Cloud SQL via an in-cluster proxy. Decide the fate of the idle `ecommerce-db` instance either way
3. **Green the test suite** — 13 failing suites is worse than no tests, because it makes CI useless. Fix the DI mocks, delete the two specs importing non-existent modules, stub Stripe, drop the dead `JwtStrategy` reference
4. **TypeORM migrations** — kill `synchronize: true` in all 5 services before any data matters
5. **Finish the payment flow** — a real `Payment` entity + `payment_db`, a Stripe webhook handler with signature verification, and the `PENDING → CONFIRMED` order transition. Replace the hardcoded pattern strings with `PAYMENT_MESSAGES` on both sides, and fix `GET /payments`
6. **Role-based access** — `@Roles('admin')` decorator + guard for product/category writes and `orders.updateStatus` (the `UserRole` enum already exists; the guard does not)
7. **Gateway blacklist check** — call `auth.validateToken` from `AccessTokenGuard` or hit Redis directly, so logout takes effect immediately
8. **Rate limiting** — wire the already-installed `@nestjs/throttler` on login/register/forgot-password
9. **Fail-fast on secrets** — remove all 8 `|| 'jwt-secret'` fallbacks and the `STRIPE_KEY!` assertion; throw at boot instead. Add `.env.example`
10. **Chart hardening** — Ingress + cert-manager TLS, a Namespace, ConfigMap, PodDisruptionBudget, NetworkPolicy, per-service resource tuning, HPA (after #1)
11. **Move shared DTOs to `libs/common/src/dto/`** — execute `context/decisions/shared-dtos.md`; type the `any` bodies at the gateway
12. **Cart: update-quantity endpoint** — round out CRUD; expose `clearCart` over HTTP
13. **User profiles in user-service** — currently addresses-only
14. **Inventory service** — stock checks on add-to-cart, decrement on order placement
15. **Notification service** — email for password reset and order events
16. **Cleanup pass** — strip `console.log`s, remove `//s`/`//d`, delete unused `categories.module.ts`, `JwtStrategy`, `CartService` placeholders, payment-service scaffold files, and fix `Chart.yaml` metadata

---

## Lessons Learned

- Passport strategies don't work in TCP microservices — they need HTTP req/res. `JwtStrategy` lingers as dead code; verify directly with `jwtService.verify()`
- `jwtService.decode()` does NOT verify — always use `jwtService.verify()` (decode is fine for blacklist TTL extraction since signature is checked first)
- Hardcoded message pattern strings cause silent "no handler" errors — use shared `*_MESSAGES` constants from `@app/common`. Payment-service is the live counter-example: both sides hardcoded, neither matches
- `softDelete()` requires `@DeleteDateColumn` on the entity, otherwise it silently does nothing
- Variable shadowing in async flows is easy to miss and breaks control flow (was the bug in `addToCart`)
- `ClientsModule.register` defaults to TCP if no `transport` is specified — works but should be explicit
- Wrapping microservice responses in `ResponseHelper.success()` requires the gateway to know data lives at `response.data` (see `cart.service.findProduct`)
- `ResponseInterceptor` must use checks like `hasDataProperty` instead of strict `hasMessageAndData` when intercepting payloads that inherently have a `data` array but don't define a custom `message`
- Cross-service writes need a fallback story — orders-service uses a try/catch around the post-create `CART_MESSAGES.CLEAR_CART` call so a cart failure doesn't roll back a saved order (logged for ops)
- Order creation must run inside a single DB transaction (`dataSource.transaction`) so the parent `Order` and child `OrderItem` rows are atomic
- Setting a "default" row (default shipping address) also needs a transaction — unset-then-set is two writes that must not interleave
- The HTTP `AllExceptionsFilter` needs to recognize the `{statusCode, message, error}` shape that microservices throw via `RpcException`, not just `HttpException`
- **Health endpoints in a hybrid app can't throw.** `AllRpcExceptionsFilter` is `@Catch()`-all and returns an Observable, which an HTTP response can't consume — so readiness sets `res.status(503)` via `@Res({passthrough: true})` instead of throwing
- **A ClusterIP load-balances connections, not requests.** One long-lived TCP socket = one backend pod forever. This is invisible at `replicas: 1` and is the single biggest architectural issue in the repo
- **Adding a constructor dependency silently breaks every scaffold spec** for that class. 13 suites went red without a single test being edited

---

## Running the Project

### Locally (node)

```bash
docker compose -f docker-compose-dev.yaml up -d   # 5 Postgres + Redis
pnpm run start:all                                # All 7 services in watch mode

pnpm test                                          # All unit tests (currently RED)
pnpm test:watch <pattern>                          # Watch a single suite
```

### On Kubernetes (orbstack)

```bash
docker compose -f docker-compose-dev.yaml up -d   # DBs still run on the host
kubectl create secret generic ecommerce-secrets \
  --from-literal=db-password='...' \
  --from-literal=jwt-secret='...' \
  --from-literal=jwt-refresh-secret='...' \
  --from-literal=stripe-key='sk_test_...'
helm upgrade --install ecommerce k8s/ecommerce

kubectl get pods                                   # 7 pods
curl localhost:3000/api/v1/health/live             # gateway via LoadBalancer
```

### Building images

```bash
gcloud builds submit --config cloudbuild.yaml --project=distance-493706
```

| Service             | Type  | Port | Health |
| ------------------- | ----- | ---- | ------ |
| API Gateway         | HTTP  | 3000 | 3000   |
| Auth Service        | TCP   | 3001 | 8080   |
| Product Service     | TCP   | 3002 | 8080   |
| Cart Service        | TCP   | 3003 | 8080   |
| Orders Service      | TCP   | 3004 | 8080   |
| Payment Service     | TCP   | 3005 | 8080   |
| User Service        | TCP   | 3006 | 8080   |
| Postgres auth_db    | DB    | 5433 | —      |
| Postgres product_db | DB    | 5435 | —      |
| Postgres cart_db    | DB    | 5436 | —      |
| Postgres order_db   | DB    | 5437 | —      |
| Postgres user_db    | DB    | 5448 | —      |
| Redis               | Cache | 6379 | —      |
