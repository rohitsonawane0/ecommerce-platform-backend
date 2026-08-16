# Action Plan — Deploy First, Then Improve

> Context locked in: **Target = Kubernetes**, **Gateway = keep the custom NestJS gateway** (defer Kong/Keycloak), **Purpose = portfolio / learning**.
> Read top to bottom. **Phase 0 is the only thing standing between you and a live deploy.** Everything after it is optional polish, ordered by payoff.

---

## TL;DR — the honest verdict

Your **code is in better shape than your repo is.** The services work; auth is genuinely well-built (bcrypt, token blacklist in Redis, hashed reset tokens, no user-existence leak). What's missing is **everything that makes it deployable**: containers, externalized networking, health checks, secrets, manifests.

**The "several plans" question — answered directly:**

| Plan you've been exploring | Needed to deploy? | Verdict |
|---|---|---|
| Kong API gateway (3 guide files, docker-compose) | ❌ No | **Defer.** Your NestJS gateway already does routing + auth. Kong is a *later* learning exercise, not a blocker. |
| Keycloak (identity) | ❌ No | **Defer.** Your auth-service already issues/validates JWTs. |
| ELK (Elasticsearch/Kibana/Logstash) | ❌ No | **Defer.** k8s gives you `kubectl logs` for free on day one. |
| Prometheus / Grafana / Zipkin / Konga | ❌ No | **Defer.** Add when you have traffic to observe. |
| Custom NestJS gateway | ✅ Yes | **Keep.** It's done and working. |

You have **17 markdown files** and **two competing gateway architectures** half-built. That's analysis paralysis. **Cut all of it from the critical path.** Ship the thing that works, *then* add Kong as "Phase 3, because I wanted to learn it" — which is a much stronger portfolio story than a half-finished Kong config that never deployed.

---

## What you actually have (ground truth)

7 deployable apps, all real code:

| Service | Transport | Port | DB | Status |
|---|---|---|---|---|
| `api-gateway` | HTTP (Express) | 3000 | — | ✅ Works, global auth guard, helmet, CORS, validation |
| `auth-service` | TCP | 3001 | `auth_db` + Redis | ✅ Solid (register/login/refresh/logout/reset/validate) |
| `product-service` | TCP | 3002 | `product_db` | ✅ Products + categories |
| `cart-service` | TCP | 3003 | `cart_db` | ✅ |
| `orders-service` | TCP | 3004 | `order_db` | ✅ |
| `payment-service` | TCP | 3005 | Stripe | ✅ (verify DB config is externalized) |
| `user-service` | TCP | 3006 | `user_db` | ✅ Addresses |

**Hard blockers found (all fixed in Phase 0):**

1. 🔴 **Every service binds to `host: 'localhost'`** in `main.ts`, and **the gateway connects to `localhost`** in every `apps/api-gateway/src/*/*.module.ts`. In k8s, services must bind `0.0.0.0` and the gateway must reach them by **Service DNS name**, not localhost. *This is why it currently only runs on one machine.*
2. 🔴 **No Dockerfiles anywhere.** Nothing to build into an image.
3. 🔴 **No health/readiness endpoints.** k8s needs probes to know a pod is alive.
4. 🟠 **Secrets are weak/inline:** `JWT_SECRET` falls back to the string `'jwt-secret'` in ~4 places; a real Stripe test key sits in plaintext `.env`.
5. 🟠 **`synchronize: true`** in every TypeORM config — fine for a dev DB, data-loss risk if pointed at a DB you care about.
6. 🟠 **Broken prod scripts:** `start:prod` → `node dist/apps/ecommerce-platform-backend/main` (that app doesn't exist); `test:e2e` points at the same ghost path.
7. 🟡 **No graceful shutdown** (`enableShutdownHooks` not called) — rolling deploys will drop in-flight requests.
8. 🟡 **`@nestjs/throttler` installed but never used** — no rate limiting on login/register.

---

# PHASE 0 — MUST DO (deploy to Kubernetes)

> Goal: a public URL hitting `api-gateway`, which routes over TCP to the 6 backend services, each with its own Postgres + shared Redis, all in k8s. Do these **in order** — each unblocks the next.

### 0.1 — Kill `localhost` (make services network-portable) 🔴

This is the single most important change. Without it, nothing works in k8s.

**Backend services** — bind to `0.0.0.0` and read host/port from env. In every `apps/*/src/main.ts`:

```ts
const app = await NestFactory.createMicroservice(AuthServiceModule, {
  transport: Transport.TCP,
  options: {
    host: process.env.SERVICE_HOST || '0.0.0.0',          // was 'localhost'
    port: parseInt(process.env.SERVICE_PORT || '3001', 10),
  },
});
app.enableShutdownHooks();                                  // see 0.4
await app.listen();
```

**Gateway** — connect to each service by env-driven host. In every `apps/api-gateway/src/<svc>/<svc>.module.ts`:

```ts
ClientsModule.register([{
  name: AUTH_SERVICE,
  transport: Transport.TCP,
  options: {
    host: process.env.AUTH_SERVICE_HOST || 'localhost',    // k8s Service name in prod
    port: parseInt(process.env.AUTH_SERVICE_PORT || '3001', 10),
  },
}]),
```

In k8s, `AUTH_SERVICE_HOST=auth-service` (the Service name resolves via cluster DNS). Locally it still defaults to `localhost`, so `pnpm run start:all` keeps working.

> Tip: prefer `ClientsModule.registerAsync` so the values are read at runtime, not bundled at build time.

### 0.2 — Centralize config & secrets, fail fast 🟠

- Create **`.env.example`** (see appendix) committed to git; keep real `.env` ignored (it already is).
- **Rotate the Stripe key** that's currently in `.env` — it's been on disk in plaintext; treat it as compromised. Generate a fresh test key in the Stripe dashboard.
- Add a startup guard so prod can't boot with default secrets:

```ts
// in each service's bootstrap, before listen()
if (process.env.NODE_ENV === 'production') {
  for (const k of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
    if (!process.env[k] || process.env[k]!.startsWith('jwt-')) {
      throw new Error(`${k} must be set to a strong value in production`);
    }
  }
}
```

- Generate real secrets: `openssl rand -base64 48` for each JWT secret.

### 0.3 — Dockerize (one multi-stage Dockerfile for all apps) 🔴

A single parametrized Dockerfile builds any service via `--build-arg APP=`:

```dockerfile
# Dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG APP
RUN pnpm exec nest build ${APP}

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
ARG APP
COPY --from=builder /app/dist/apps/${APP} ./dist
EXPOSE 3000
CMD ["node", "dist/main"]
```

Build each: `docker build --build-arg APP=auth-service -t <registry>/auth-service:0.1 .`

Add **`.dockerignore`**:
```
node_modules
dist
.git
*.md
.env
coverage
data
```

### 0.4 — Health checks + graceful shutdown 🔴

- **Gateway (HTTP):** add a public `GET /api/v1/health` returning `{ status: 'ok' }`. Mark it `@Public()`. (Optional: `@nestjs/terminus` to also ping Redis/downstream.)
- **Backend services (TCP):** they have no HTTP port, so use a **k8s `tcpSocket` probe** on the service port — no code change needed.
- **Graceful shutdown:** call `app.enableShutdownHooks()` in every `main.ts` (added in 0.1) and set `terminationGracePeriodSeconds: 30` in each Deployment.

### 0.5 — Fix the build/run scripts 🟠

In `package.json`:
```jsonc
"build:all": "for a in api-gateway auth-service product-service cart-service orders-service payment-service user-service; do nest build $a; done",
"start:prod:gateway": "node dist/apps/api-gateway/main",
// delete the broken "start:prod" and "test:e2e" (they point at a non-existent app)
```

### 0.6 — Kubernetes manifests

Create `k8s/`. Per backend service you need a **Deployment + Service**; for the gateway add an **Ingress**; plus **Secret**, **ConfigMap**, and a Postgres per service + one Redis.

**Backend service (Deployment + ClusterIP) — pattern, repeat ×6:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: auth-service }
spec:
  replicas: 1
  selector: { matchLabels: { app: auth-service } }
  template:
    metadata: { labels: { app: auth-service } }
    spec:
      terminationGracePeriodSeconds: 30
      containers:
        - name: auth-service
          image: <registry>/auth-service:0.1
          ports: [{ containerPort: 3001 }]
          envFrom:
            - configMapRef: { name: app-config }
            - secretRef: { name: app-secrets }
          env:
            - { name: SERVICE_PORT, value: "3001" }
          readinessProbe: { tcpSocket: { port: 3001 }, initialDelaySeconds: 5 }
          livenessProbe:  { tcpSocket: { port: 3001 }, periodSeconds: 10 }
          resources:
            requests: { cpu: "50m", memory: "128Mi" }
            limits:   { cpu: "500m", memory: "512Mi" }
---
apiVersion: v1
kind: Service
metadata: { name: auth-service }          # <-- this name is the DNS host the gateway uses
spec:
  selector: { app: auth-service }
  ports: [{ port: 3001, targetPort: 3001 }]
```

**Gateway** — same shape but: HTTP probe on `/api/v1/health`, a `Service` of type ClusterIP on 3000, and an **Ingress** (nginx-ingress or your cloud LB) routing your domain → gateway:3000. Set its env: `AUTH_SERVICE_HOST=auth-service`, `PRODUCT_SERVICE_HOST=product-service`, etc.

**Datastores (start simple):**
- Postgres: one `StatefulSet` + `PersistentVolumeClaim` per service DB (or, easier and more production-real, a managed Postgres and just point env at it). For portfolio, in-cluster Postgres via the Bitnami Helm chart is the fastest honest option.
- Redis: one Deployment/Service or the Bitnami Redis chart.

**Secret + ConfigMap:**
```yaml
apiVersion: v1
kind: Secret
metadata: { name: app-secrets }
type: Opaque
stringData:
  JWT_SECRET: "<openssl rand -base64 48>"
  JWT_REFRESH_SECRET: "<openssl rand -base64 48>"
  STRIPE_KEY: "<fresh test key>"
  DB_PASSWORD: "<strong>"
  # ...per-service DB passwords
---
apiVersion: v1
kind: ConfigMap
metadata: { name: app-config }
data:
  NODE_ENV: "production"
  REDIS_HOST: "redis"
  AUTH_SERVICE_HOST: "auth-service"
  PRODUCT_SERVICE_HOST: "product-service"
  CART_SERVICE_HOST: "cart-service"
  ORDER_SERVICE_HOST: "orders-service"
  PAYMENT_SERVICE_HOST: "payment-service"
  USER_SERVICE_HOST: "user-service"
  DB_HOST: "postgres-auth"
  PRODUCT_DB_HOST: "postgres-product"
  # ...etc
```

> **Don't commit raw secrets to git.** For a portfolio repo, commit the manifests with placeholder values and apply real ones via `kubectl create secret` or [Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets) (itself a nice portfolio touch).

### 0.7 — Deploy checklist (definition of done for Phase 0)
- [ ] `localhost` gone from all `main.ts` and gateway client modules
- [ ] `.env.example` committed, real secrets rotated & generated
- [ ] All 7 images build and push to a registry (GHCR is free)
- [ ] `/api/v1/health` returns 200; tcpSocket probes pass
- [ ] `kubectl apply -k k8s/` brings up all pods `Running` and `Ready`
- [ ] Ingress URL → register → login → list products → add to cart works end-to-end
- [ ] `kubectl rollout restart` drains cleanly (no dropped requests)

**When this checklist is green, you are deployed. Stop and ship. Everything below is improvement.**

---

# PHASE 1 — IMPROVE: security & correctness (do right after deploy)

1. **Close the token-revocation gap at the gateway** 🟠 — The gateway's `AccessTokenGuard` verifies the JWT **locally** and never checks the Redis blacklist. So a *logged-out* access token is still accepted at the edge until it expires (~15 min). Either (a) have the gateway call auth-service `validateToken` (which already checks the blacklist), or (b) give the gateway read access to the same Redis to check `bl:<token>`. Option (a) is cleaner.
2. **Turn on rate limiting** 🟠 — `@nestjs/throttler` is installed but unused. Add `ThrottlerModule` globally and `@Throttle` the auth routes (login/register/forgot-password) to blunt brute-force/credential-stuffing.
3. **Fail-fast secret validation** — ship the 0.2 guard if you deferred it.
4. **Stop using `synchronize: true`** — generate TypeORM migrations per service and run them as an init step / k8s Job. Keeps your schema from silently mutating.
5. **Pin the Stripe API version** — `new Stripe(key, { apiVersion: '2025-...' })` so Stripe-side upgrades don't break you; remove the `!` non-null assertion in favor of the startup check.

---

# PHASE 2 — IMPROVE: reliability & ops

1. **CI pipeline (GitHub Actions)** — on PR: `pnpm lint` + `pnpm test` + `nest build` for all apps; on main: build & push all 7 images to GHCR tagged by SHA. Biggest "this person ships real software" signal in a portfolio.
2. **Structured logging + request IDs** — swap `console.log` (e.g. the reset-link log in auth) for Nest's logger or `pino`; add a correlation-ID interceptor so you can trace a request across services in `kubectl logs`.
3. **DB persistence & backups** — confirm PVCs survive pod restarts; add a `pg_dump` CronJob if any data matters.
4. **Inter-service timeouts** — wrap `firstValueFrom(client.send(...))` with an RxJS `timeout()` so one slow service doesn't hang the gateway.
5. **Resource limits & PodDisruptionBudgets** — you have requests/limits from 0.6; add liveness tuning so flapping pods don't thrash.

---

# PHASE 3 — IMPROVE: the "big plans" (only now, and only if you want to learn them)

These are the deferred items. They're **legitimate portfolio upgrades** — just not before you're live.

1. **Kong as edge gateway** — put Kong in front of your NestJS gateway for rate limiting, API keys, request transformation. Frame it as "edge concerns at Kong, business routing at the app gateway." (Your `KONG_*.md` guides become real.)
2. **Keycloak** — only if you want OIDC/social login/multi-realm. Your hand-rolled JWT auth is fine without it; adopting Keycloak means deleting auth-service logic, which is a big swing.
3. **Observability stack** — Prometheus (`@willsoto/nestjs-prometheus`) + Grafana dashboards; Zipkin/OTel tracing across the TCP hops; ELK only if `kubectl logs` stops being enough.
4. **Event-driven backbone** — your services talk over **request/response TCP**, which is tight coupling. For orders→payment→inventory, move to **NATS or RabbitMQ** events + a **saga** for the checkout flow. This is the highest-value *architecture* upgrade and a great talking point.
5. **Autoscaling** — HPA on CPU/RPS once you have metrics (needs Phase 3.3).

---

# PHASE 4 — Polish (portfolio presentation)

1. **Real README** — current one is the default NestJS boilerplate. Add: one-paragraph what-it-is, an **architecture diagram** (gateway → 6 services → DBs/Redis), local-dev quickstart, and the live URL. This is the first thing a reviewer reads.
2. **Consolidate the docs** — you have 17 root `.md` files (3 Kong guides, `ADDRESS_PLAN`/`ADDRESS_FEATURE_REVIEW`, `order_service_create_guide`, `payment_service_create_guide`, `migration_guide`, `cart.md`, `scratch.ts`, `PROJECT_STATUS`, `ROADMAP`, `CODE_REVIEW`…). Move design notes into `docs/`, delete the dead ones, keep `README.md` + `CLAUDE.md` + this file at root.
3. **API docs** — add Swagger (`@nestjs/swagger`) at the gateway. Auto-generated, looks professional, replaces the hand-written `API_ENDPOINTS.md`/`FRONTEND_API_DOCS.md`.
4. **Repo hygiene** — delete `scratch.ts`; fix the duplicate `order-service`/`orders-service` entries in `nest-cli.json` (only `orders-service` exists on disk).

---

## Quick wins (under ~30 min each, do anytime)
- [ ] Delete `scratch.ts`
- [ ] Remove duplicate `order-service` from `nest-cli.json`
- [ ] Write `.env.example`
- [ ] Fix/delete broken `start:prod` & `test:e2e` scripts
- [ ] Replace the boilerplate README intro
- [ ] Rotate the Stripe key

## Priority vs effort (where to spend energy)
| Item | Impact | Effort | When |
|---|---|---|---|
| Kill `localhost` (0.1) | 🔴 Blocker | S | Now |
| Dockerfiles (0.3) | 🔴 Blocker | S | Now |
| Health + shutdown (0.4) | 🔴 Blocker | S | Now |
| k8s manifests (0.6) | 🔴 Blocker | M | Now |
| Secrets/rotate (0.2) | 🟠 High | S | Now |
| Token revocation gap (P1.1) | 🟠 High | S | Post-deploy |
| Rate limiting (P1.2) | 🟠 High | S | Post-deploy |
| Migrations (P1.4) | 🟠 Med | M | Post-deploy |
| CI (P2.1) | 🟢 Portfolio gold | M | Soon |
| Event-driven + saga (P3.4) | 🟢 Architecture flex | L | Later |
| Kong / Keycloak / ELK (P3.1-3) | 🟢 Nice-to-have | L | Later |

---

## Appendix — `.env.example` (matches the env vars your code actually reads)

```dotenv
NODE_ENV=development
GATEWAY_PORT=3000

# Secrets — generate with: openssl rand -base64 48
JWT_SECRET=
JWT_REFRESH_SECRET=

# Service discovery (localhost for dev; k8s Service names in prod)
AUTH_SERVICE_HOST=localhost
PRODUCT_SERVICE_HOST=localhost
CART_SERVICE_HOST=localhost
ORDER_SERVICE_HOST=localhost
PAYMENT_SERVICE_HOST=localhost
USER_SERVICE_HOST=localhost

# Auth DB
DB_HOST=localhost
DB_PORT=5433
DB_USERNAME=postgres
DB_PASSWORD=
DB_NAME=auth_db

# Product DB
PRODUCT_DB_HOST=localhost
PRODUCT_DB_PORT=5435
PRODUCT_DB_USERNAME=postgres
PRODUCT_DB_PASSWORD=
PRODUCT_DB_NAME=product_db

# Cart DB
CART_DB_HOST=localhost
CART_DB_PORT=5436
CART_DB_USERNAME=postgres
CART_DB_PASSWORD=
CART_DB_NAME=cart_db

# Order DB
ORDER_DB_HOST=localhost
ORDER_DB_PORT=5437
ORDER_DB_USERNAME=postgres
ORDER_DB_PASSWORD=
ORDER_DB_NAME=order_db

# User DB
USER_DB_HOST=localhost
USER_DB_PORT=5448
USER_DB_USERNAME=postgres
USER_DB_PASSWORD=
USER_DB_NAME=user_db

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Stripe (test key — rotate the one currently committed in .env)
STRIPE_KEY=
```
