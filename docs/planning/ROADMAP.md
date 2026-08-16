# Roadmap & Improvements — Ecommerce Platform Backend

> Generated: 2026-04-18
> Based on: `context/PROGRESS.md`, `CODE_REVIEW.md`, current source state.

---

## TL;DR

You're at **~65% overall**. Auth, Product, Cart, and Gateway work end-to-end. The remaining work splits into three buckets:

| Bucket | Effort (solo, focused) | Effort (part-time, ~2hr/day) |
| --- | --- | --- |
| **Stabilize what exists** (bug fixes, security, cleanup, tests) | **~2 weeks** | **~4–5 weeks** |
| **Build missing services** (order, payment, inventory, notification, user) | **~4–5 weeks** | **~9–11 weeks** |
| **Production hardening** (migrations, CI/CD, Docker, observability, docs) | **~1.5–2 weeks** | **~3–4 weeks** |
| **TOTAL to v1.0** | **~7.5–9 weeks** | **~16–20 weeks** |

The fastest path to a *demo-able* product (cart → order → mock payment) is **~2.5–3 weeks** focused.

---

## What's Done (~65%)

| Area | % | Notes |
| --- | --- | --- |
| Auth Service | 90% | Register, login, refresh, logout, me, forgot/reset password, JWT + Redis blacklist |
| Product Service | 95% | Products + Categories CRUD, slug, soft-delete, search, pagination |
| Cart Service | 65% | Create, add, get, remove. **No update qty, no clear cart** |
| API Gateway | 80% | All current endpoints wired, helmet, CORS, validation, JWT guard |
| Common Lib | 85% | Constants, guards, decorators, helpers, interceptors |
| Security | 50% | JWT done; **no roles, no rate limit, no gateway blacklist check** |
| Testing | 0% | All specs are `should be defined` stubs |
| Order / Payment / Inventory / Notification / User | 0% | Not scaffolded |

---

## Phase 1 — Stabilize (~2 weeks focused)

Finish what's started and fix the known issues before piling on more services.

### 1.1 Bug fixes (P0) — **~30 min**

| # | Task | File | Effort |
| --- | --- | --- | --- |
| 1 | `CategoriesService.remove()` — pass `id`, not entity, to `softDelete` | `apps/product-service/src/categories/categories.service.ts` | 5 min |
| 2 | `AccessTokenGuard` — throw `UnauthorizedException` on missing token (don't return `false`) | `libs/common/src/guards/access-token.guard.ts` | 5 min |
| 3 | Remove unused `Observable` import in guard | same | 1 min |
| 4 | Cart: add **update quantity** endpoint | cart-service + gateway | 15 min |
| 5 | Cart: add **clear cart** endpoint | cart-service + gateway | 10 min |

### 1.2 Security (P1) — **~1.5 days**

| # | Task | Effort |
| --- | --- | --- |
| 1 | **Gateway blacklist check** — gateway calls `auth.validateToken` over TCP (or hits Redis directly) | 1–2 hr |
| 2 | **Centralize JWT config** — `@nestjs/config` + Joi/Zod schema validation, fail-fast if `JWT_SECRET` missing | 1–2 hr |
| 3 | **Role-based access control** — `@Roles('admin')` + `RolesGuard`, lock down product/category mutations | 2–3 hr |
| 4 | **Rate limiting** — wire `@nestjs/throttler` (already installed) on auth endpoints | 1 hr |
| 5 | **Password strength** — DTO validator (length + complexity) | 30 min |
| 6 | **CORS** — env-driven origin allowlist | 15 min |
| 7 | **`.env.example`** — placeholder file with comments | 15 min |
| 8 | Verify `.env` is in `.gitignore` | 2 min |

### 1.3 Architecture cleanup (P2) — **~1 day**

| # | Task | Effort |
| --- | --- | --- |
| 1 | Move duplicated DTOs (`Register`, `Login`, `ForgotPassword`, `ResetPassword`, `CreateProduct`, `CreateCategory`) into `libs/common/src/dto/` | 1 hr |
| 2 | Extract `generateSlug` helper to `libs/common/src/helpers/slug.helper.ts` | 15 min |
| 3 | Pick **one** response wrapping mechanism — kill `ResponseHelper` calls in controllers, keep only `ResponseInterceptor` | 30 min |
| 4 | `findOne` product — load `categories` relation for shape consistency | 5 min |
| 5 | `@IsAlpha` on category name — replace with `@Matches` or `@IsString` | 5 min |
| 6 | Fix contradictory `@IsOptional` + `@IsNotEmpty` on category description | 5 min |
| 7 | Re-export `guards` from `libs/common/src/index.ts` barrel | 5 min |

### 1.4 Code-quality cleanup (P3) — **~1 day**

| # | Task | Effort |
| --- | --- | --- |
| 1 | Replace `console.log` with NestJS `Logger` (gateway products, auth forgot-password) | 15 min |
| 2 | Delete dead scaffold files (`common.module.ts`, `common.service.ts`, default product-service controller/service, unused `categories.module.ts` in gateway) | 15 min |
| 3 | Remove stale `nest-cli.json` entries for unscaffolded services | 5 min |
| 4 | Strip stray comments (`//d`, `// 🔥`), fix `.env` comment typo (5434 → 5435) | 10 min |
| 5 | Remove or fix `should be defined` stubs that don't compile | 30 min |

### 1.5 Tests (the real ones) — **~3–5 days**

Current coverage is 0%. Realistic goal for v1: **60%+ on services**, **40%+ overall**.

| Layer | Target | Effort |
| --- | --- | --- |
| Auth service unit tests (register, login, refresh, logout, validateToken, forgot/reset) | ~15 tests | 1 day |
| Product service unit tests (CRUD, slug, conflict, search, pagination) | ~12 tests | 0.5 day |
| Cart service unit tests (add/get/remove/update/clear, ownership, product-service mock) | ~10 tests | 0.5 day |
| Common lib unit tests (`AccessTokenGuard`, `CurrentUser`, `ResponseInterceptor`) | ~6 tests | 0.5 day |
| Gateway controller tests (mock ClientProxy, verify message + payload) | ~10 tests | 0.5 day |
| E2E tests for auth flow + happy-path cart flow | 2 suites | 1 day |

**Phase 1 total: ~10–12 working days.**

---

## Phase 2 — Missing Services (~4–5 weeks focused)

Build in this order. Each step adds business value and unblocks the next.

### 2.1 Order Service (port 3004) — **~4–5 days**

The keystone. Without it the cart goes nowhere.

- Postgres `order_db` on a new port (e.g. 5437); add to `docker-compose.yaml`
- Entities: `Order`, `OrderItem`, `OrderStatus` enum (`pending` / `confirmed` / `shipped` / `delivered` / `cancelled`)
- Endpoints (gateway → order-service TCP):
  - `POST /orders` — create from current cart (calls cart-service to fetch + clear cart)
  - `GET /orders` — current user's orders (paginated)
  - `GET /orders/:id` — with ownership check
  - `PATCH /orders/:id/status` — admin only
  - `POST /orders/:id/cancel` — user, only if `pending` / `confirmed`
- Shared totals/snapshot logic — denormalize price like cart does
- Tests: ~12 unit + 1 e2e flow

### 2.2 Payment Service (port 3005) — **~3–4 days**

Mock first; real provider later.

- Entity: `Payment` (orderId, amount, currency, status, providerRef)
- Mock provider with deterministic success/failure (e.g. amount ending in `.99` fails)
- Endpoints:
  - `POST /payments` — initiate for an order (validates order exists + status)
  - `GET /payments/:id`
  - `POST /payments/webhook` — mock webhook → updates order to `confirmed`
- Optional: stub Stripe interface for later swap-in
- Tests: ~8 unit + webhook integration

### 2.3 Inventory Service (port 3006) — **~3 days**

- Entity: `StockItem` (productId, quantity, reserved)
- Endpoints (mostly internal/microservice messages):
  - `GET /inventory/:productId` — public
  - `PATCH /inventory/:productId` — admin (set/adjust)
  - Message: `inventory.reserve` (called by order-service on create)
  - Message: `inventory.release` (called on cancel/timeout)
  - Message: `inventory.commit` (called on payment success)
- Wire into `cart.add` (availability check) and `order.create` (reserve)
- Tests: ~8 unit + race-condition test (use a transaction)

### 2.4 Notification Service (port 3007) — **~2–3 days**

- Async via Redis pub/sub or BullMQ (recommend **BullMQ** — built on Redis you already have)
- Email transport: nodemailer + Mailtrap/Mailhog for dev
- Templates: Handlebars or MJML
- Triggers (via events from other services):
  - `auth.password-reset-requested` → send reset link
  - `order.created` → confirmation email
  - `order.shipped` / `order.delivered` → status email
  - `payment.failed` → notice email
- Tests: ~6 unit, mock transport

### 2.5 User Service (port 3008) — **~2–3 days**

Separate profile data from auth identity.

- Entities: `UserProfile`, `Address`
- Endpoints: profile CRUD, addresses CRUD, default-address logic
- Cross-service: order-service reads default shipping address; cart could too
- Tests: ~8 unit

**Phase 2 total: ~14–18 working days.**

---

## Phase 3 — Production Hardening (~1.5–2 weeks focused)

### 3.1 Database — **~2 days**

- Disable `synchronize: true` everywhere
- Set up TypeORM **migrations** per service (`migration:generate`, `migration:run` scripts in `package.json`)
- Generate baseline migrations from current entities
- Add `migration:run` to service startup or a separate init container

### 3.2 Containerization — **~2 days**

- Multi-stage `Dockerfile` per service (`node:20-alpine` → builder → runner)
- Update `docker-compose.yaml` to build + run all services + DBs + Redis + a reverse proxy (Caddy/Traefik) in front of the gateway
- `.dockerignore`
- Healthchecks per service (`/health` endpoint via `@nestjs/terminus`)

### 3.3 CI/CD — **~1 day**

- GitHub Actions: lint → typecheck → test → build → docker build (matrix per service)
- PR checks: required green CI before merge
- Optional: deploy job to a staging environment (Fly.io / Render / Railway are the cheapest paths)

### 3.4 Observability — **~1.5 days**

- Structured logging — replace `Logger` with `nestjs-pino` (JSON logs)
- Request ID middleware in gateway, propagated to microservices via TCP metadata
- Metrics: `prom-client` + `/metrics` endpoint
- Optional: OpenTelemetry tracing across TCP boundaries (high value for a microservices project, ~1 extra day)

### 3.5 Documentation — **~1 day**

- `@nestjs/swagger` on the gateway → `/api/docs`
- Update `README.md` with run instructions, architecture diagram, env table
- ADRs (Architecture Decision Records) for: TCP transport, dual-token auth, denormalized cart prices, microservice DB-per-service

**Phase 3 total: ~7–9 working days.**

---

## Improvement Suggestions (Beyond the Roadmap)

These are quality-of-life and "next-level" improvements. None are blockers.

### Architecture

1. **Consider message broker over raw TCP.** TCP transport works but has no persistence, no retries, no fan-out. **NATS** or **RabbitMQ** (both first-class in `@nestjs/microservices`) would let order/inventory/notification services consume events instead of being directly RPC'd. Major refactor (~3–4 days) but pays off as services grow.
2. **Event-driven order flow.** `order.created` → emits event → inventory reserves + notification queues email + payment initiates. Decouples services and removes RPC chains.
3. **Saga pattern for checkout.** Order + payment + inventory is the textbook distributed-transaction problem. Implement a simple orchestration saga in the order-service with compensating actions on failure.
4. **API versioning.** Already have `api/v1` prefix — use NestJS's `@Version()` decorator so you can run v1 + v2 side by side.
5. **GraphQL gateway (optional).** If a frontend team starts hitting "I need 5 calls to render this page" pain, consider a GraphQL layer in the gateway that fans out to microservices.

### Security

6. **Refresh-token rotation with reuse detection.** You rotate tokens but don't detect reuse of a revoked refresh token. If an old refresh token is presented, invalidate the entire family — strong indicator of theft.
7. **Argon2id over bcrypt.** Argon2 is the modern recommendation; cost-tunable for memory.
8. **2FA / TOTP.** `speakeasy` or `otplib` + a `user_2fa_secrets` table. Optional per-user.
9. **Audit log.** Append-only table of security-relevant events (login, password change, role change, admin actions).
10. **Secrets manager.** For production: AWS Secrets Manager / Doppler / Infisical instead of `.env`.

### Performance

11. **Cache product reads** in Redis with a short TTL (60s); invalidate on mutate. Massive win for the `/products` list.
12. **DataLoader pattern** if you go GraphQL — solves N+1 in category fetches.
13. **Pagination via cursor** instead of offset for products (offset is slow at scale).
14. **DB indexes audit.** At minimum: `products(slug)` UNIQUE, `categories(slug)` UNIQUE, `orders(userId, createdAt)`, `cart_items(cartId)`, `users(email)` UNIQUE.

### Developer Experience

15. **Husky + lint-staged** — run lint + tests on staged files pre-commit.
16. **Commitlint + conventional commits** — enables auto-changelog later.
17. **Renovate / Dependabot** for dep updates.
18. **`pnpm run start:all` is great — extend it to include all services as you build them, and add `start:dev` that also runs `docker compose up`.**
19. **Seed data scripts** — `pnpm run seed:dev` to populate categories, products, an admin user. Saves hours during testing.
20. **Postman / Bruno collection** committed to repo, kept in sync with `API_ENDPOINTS.md`.

### Testing

21. **Testcontainers** for integration tests — spin up real Postgres + Redis per test suite. Far better signal than mocks for repository code.
22. **Contract tests** between gateway and microservices using Pact — prevents silent message-pattern drift.
23. **Load tests** on auth + product list with `k6` or `autocannon` before going live.

### Observability & Ops

24. **Sentry** (or self-hosted GlitchTip) for error tracking.
25. **Grafana + Prometheus + Loki** stack via docker-compose for local observability — overkill for dev but a good learning project.
26. **Graceful shutdown.** `app.enableShutdownHooks()` + drain TCP/HTTP connections on `SIGTERM`. Critical for k8s deploys.

### Documentation

27. **Mermaid diagrams in markdown.** Architecture, sequence diagrams for register/login, checkout saga.
28. **Onboarding doc.** A junior dev should be able to clone → run → make their first PR in under an hour.

---

## Suggested Sequencing (if you have ~3 weeks)

If you want to ship the most useful version possible in 3 focused weeks:

| Week | Focus |
| --- | --- |
| **Week 1** | Phase 1.1–1.4 (bugs, security, cleanup) + start Phase 2.1 (order service) |
| **Week 2** | Finish order service + payment service (mock) + inventory service basics |
| **Week 3** | Real tests for the critical paths (auth, checkout) + Dockerfiles + Swagger docs + README |

Skip for now: notification service, user service, full observability stack, message broker migration. Add those in v1.1.

---

## Risk Watch

- **Synchronize: true in production = data loss.** Migrations before you deploy.
- **Hardcoded JWT secret fallback = trivial token forgery.** Fix in week 1.
- **No tests + many services = refactoring becomes terrifying.** Add tests as you build new services, not after.
- **TCP transport has no retry/backpressure.** If order-service is down, gateway hangs. Add timeouts on `firstValueFrom` + circuit-breaker pattern (`opossum`).
- **No request tracing across services.** Debugging a checkout failure across 4 services without trace IDs is brutal. Add request IDs early.

---

## Reference

- Detailed status: [`context/PROGRESS.md`](context/PROGRESS.md)
- Open issues: [`CODE_REVIEW.md`](CODE_REVIEW.md)
- Endpoints inventory: [`API_ENDPOINTS.md`](API_ENDPOINTS.md)
