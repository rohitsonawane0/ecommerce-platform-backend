# Kong API Gateway — Implementation Guide

This guide walks you through replacing (or augmenting) the current NestJS `api-gateway` with **Kong Gateway** for the ecommerce-platform-backend monorepo.

> Current setup recap
>
> - `apps/api-gateway` — NestJS HTTP server on port `3000`, prefix `/api/v1`. Acts as the only HTTP entry point.
> - Backend microservices use **TCP transport** (`@nestjs/microservices`): `auth-service` (3001), `product-service` (3002), `cart-service` (3003), `orders-service`, `payment-service`, `user-service`.
> - Auth: a global `AccessTokenGuard` validates JWTs in the gateway; `@Public()` opts routes out.
> - Inter-service calls go through `ClientProxy` with constants from `@app/common/constants/services.ts` and `messages.ts`.

---

## 1. Decide on an Architecture First

Kong is a **pure HTTP/HTTPS gateway**. It cannot speak NestJS's TCP transport. So the very first decision is: **what does Kong sit in front of?**

You have three realistic options. Pick one before writing any config.

### Option A — Kong in front of the existing NestJS gateway (Easiest, recommended start)

```
client → Kong (8000) → NestJS api-gateway (3000) → TCP microservices
```

- **Pros**: Zero changes to microservices. You immediately gain Kong's rate limiting, key/JWT auth, logging, CORS, IP restriction, request/response transformation, observability plugins.
- **Cons**: You still have a second hop through the NestJS gateway. JWT validation may end up duplicated (Kong + NestJS guard).
- **When to use**: You want Kong's edge features (rate limiting, analytics, plugin ecosystem) without restructuring the codebase.

### Option B — Kong directly in front of each microservice (Full migration)

```
client → Kong (8000) ──┬──→ auth-service (HTTP 3001)
                       ├──→ product-service (HTTP 3002)
                       ├──→ cart-service (HTTP 3003)
                       ├──→ orders-service (HTTP 3004)
                       └──→ ...
```

- **Pros**: True microservices topology. Kong does routing, auth, and policy at the edge. The NestJS gateway disappears.
- **Cons**: Every microservice must expose **HTTP** (not TCP). You must move all DTO validation, response shaping (`ResponseInterceptor`), and the `@CurrentUser()` pattern into each service. Inter-service comms can stay TCP or switch to HTTP/gRPC.
- **When to use**: You want Kong to *be* the gateway and you're willing to refactor the services.

### Option C — Hybrid

Keep the NestJS gateway for orchestration-heavy routes (e.g. `/orders` which fans out to cart + product + payment) and let Kong route stateless reads (e.g. `GET /products`) directly to the product service over HTTP.

> **Recommendation for this repo**: Start with **Option A** today, then incrementally migrate read-heavy services to **Option B** later. The rest of this guide assumes Option A as the primary path and calls out the extra steps needed for Option B.

---

## 2. Prerequisites

- Docker + Docker Compose (already used in `docker-compose.yaml`)
- The current stack running: `docker compose up -d` and `pnpm run start:all`
- (Optional) `curl` / `httpie` / Postman to exercise routes through Kong
- (Optional, Option B only) Convert services to expose HTTP — see §7

You will use **Kong Gateway OSS** in **DB-less / declarative** mode. It's the simplest mode: a single YAML file (`kong.yaml`) declares all services, routes, and plugins. No Postgres, no migrations, no Admin API writes.

---

## 3. Add Kong to `docker-compose.yaml`

Append the following service to your existing `docker-compose.yaml`:

```yaml
  kong:
    image: kong:3.7
    container_name: kong-gateway
    restart: unless-stopped
    environment:
      KONG_DATABASE: 'off'
      KONG_DECLARATIVE_CONFIG: /kong/declarative/kong.yaml
      KONG_PROXY_ACCESS_LOG: /dev/stdout
      KONG_ADMIN_ACCESS_LOG: /dev/stdout
      KONG_PROXY_ERROR_LOG: /dev/stderr
      KONG_ADMIN_ERROR_LOG: /dev/stderr
      KONG_ADMIN_LISTEN: '0.0.0.0:8001'
      KONG_ADMIN_GUI_URL: http://localhost:8002
      KONG_LOG_LEVEL: notice
    ports:
      - '8000:8000'   # Proxy (HTTP)  ← clients hit this
      - '8443:8443'   # Proxy (HTTPS)
      - '8001:8001'   # Admin API (read-only in DB-less)
      - '8002:8002'   # Kong Manager (web UI, OSS limited)
    volumes:
      - ./kong:/kong/declarative
    extra_hosts:
      - 'host.docker.internal:host-gateway'  # so Kong can reach services on the host
    depends_on:
      - postgres-auth   # only so Kong starts after your databases
```

> **Why `host.docker.internal`?** Your NestJS services run on the host (via `pnpm`), not in Docker. From inside the Kong container, `localhost` means the Kong container itself. Use `host.docker.internal` to reach host processes.
>
> Linux users: the `extra_hosts` line maps that name to the host gateway. On Docker Desktop (macOS/Windows) it works out of the box.

Create the config directory:

```bash
mkdir -p kong
```

---

## 4. Write the Declarative Config — `kong/kong.yaml`

This file is the **single source of truth** for Kong in DB-less mode. Create `kong/kong.yaml` with the content below. It's tailored to your current API surface (`API_ENDPOINTS.md`).

```yaml
_format_version: '3.0'
_transform: true

# ─────────────────────────────────────────────────────────────
# Upstreams (optional — useful when you scale services later)
# ─────────────────────────────────────────────────────────────
upstreams:
  - name: api-gateway-upstream
    targets:
      - target: host.docker.internal:3000
        weight: 100

# ─────────────────────────────────────────────────────────────
# Services & Routes — Option A: everything goes to NestJS gateway
# ─────────────────────────────────────────────────────────────
services:
  - name: api-gateway
    host: api-gateway-upstream    # use upstream so you can add replicas later
    port: 80                      # ignored when host is an upstream name
    protocol: http
    retries: 3
    connect_timeout: 5000
    read_timeout: 30000
    write_timeout: 30000
    routes:
      # Public auth routes — no JWT required
      - name: auth-public
        paths:
          - /api/v1/auth/register
          - /api/v1/auth/login
          - /api/v1/auth/forgot-password
          - /api/v1/auth/reset-password
        strip_path: false
        methods: [POST, OPTIONS]

      # Authenticated auth routes
      - name: auth-private
        paths:
          - /api/v1/auth/refresh
          - /api/v1/auth/logout
          - /api/v1/auth/me
        strip_path: false

      # Products & categories (public reads, currently public writes too)
      - name: products
        paths: ['/api/v1/products', '/api/v1/categories']
        strip_path: false

      # Authenticated business routes
      - name: cart
        paths: ['/api/v1/cart']
        strip_path: false
      - name: orders
        paths: ['/api/v1/orders']
        strip_path: false
      - name: payments
        paths: ['/api/v1/payments']
        strip_path: false
      - name: addresses
        paths: ['/api/v1/addresses']
        strip_path: false

# ─────────────────────────────────────────────────────────────
# Global plugins — applied to ALL services unless overridden
# ─────────────────────────────────────────────────────────────
plugins:
  - name: cors
    config:
      origins: ['*']                 # tighten for prod
      methods: [GET, POST, PUT, PATCH, DELETE, OPTIONS]
      headers: [Content-Type, Authorization]
      credentials: true
      max_age: 3600

  - name: rate-limiting
    config:
      minute: 120
      hour: 5000
      policy: local                  # use 'redis' in prod (multi-node Kong)

  - name: request-size-limiting
    config:
      allowed_payload_size: 10       # MB

  - name: correlation-id
    config:
      header_name: X-Request-Id
      generator: uuid
      echo_downstream: true
```

### Reload Kong after editing the YAML

```bash
docker compose restart kong
# or, without a restart:
docker exec kong-gateway kong reload
```

Verify the config is valid before reloading:

```bash
docker run --rm -v "$PWD/kong:/kong" kong:3.7 kong config parse /kong/kong.yaml
```

---

## 5. Smoke Test

Bring the stack up and hit Kong instead of the NestJS gateway:

```bash
docker compose up -d kong
pnpm run start:all

# Was: curl http://localhost:3000/api/v1/products
curl -i http://localhost:8000/api/v1/products
```

You should see the same JSON response wrapped by your `ResponseInterceptor`, plus extra Kong headers (`X-Kong-Upstream-Latency`, `X-Kong-Proxy-Latency`, `X-Request-Id`).

Check the Admin API:

```bash
curl http://localhost:8001/services | jq
curl http://localhost:8001/routes   | jq
curl http://localhost:8001/plugins  | jq
```

---

## 6. Layer in More Plugins (As Needed)

Add these under the relevant `routes:` or `services:` block, or at the top-level `plugins:` for global behavior.

### 6.1 JWT validation at the edge (offload from NestJS)

Kong can validate JWTs before the request ever reaches your NestJS gateway. This lets you **delete** `AccessTokenGuard` later if you migrate to Option B.

1. Define a consumer:

   ```yaml
   consumers:
     - username: web-client
       jwt_secrets:
         - key: ecommerce-issuer       # must match the JWT 'iss' claim
           algorithm: HS256
           secret: '${JWT_SECRET}'     # same value as JWT_SECRET in your services
   ```

2. Attach the `jwt` plugin to private routes only:

   ```yaml
   - name: cart
     paths: ['/api/v1/cart']
     strip_path: false
     plugins:
       - name: jwt
         config:
           key_claim_name: iss
           claims_to_verify: [exp]
   ```

3. Update your NestJS `JwtService.signAsync(...)` call to include `issuer: 'ecommerce-issuer'` so Kong's `key_claim_name: iss` lookup works.

> Keep `AccessTokenGuard` enabled during the transition — Kong rejects bad tokens early; NestJS still extracts `@CurrentUser()` from the payload. Once stable, you can change the guard to **trust** the upstream Kong by reading the JWT without re-verifying (or remove it and pass user info via headers — see §6.2).

### 6.2 Pass the authenticated user to NestJS without re-verifying

Use the `request-transformer` plugin to forward useful claims:

```yaml
- name: request-transformer
  config:
    add:
      headers:
        - 'X-User-Id:$(jwt_claims.sub)'
        - 'X-User-Email:$(jwt_claims.email)'
```

Then in NestJS, swap `@CurrentUser()` to read from `request.headers['x-user-id']` and skip JWT verification.

### 6.3 Per-route rate limits (e.g. login brute-force protection)

```yaml
- name: auth-public
  paths: ['/api/v1/auth/login']
  methods: [POST]
  plugins:
    - name: rate-limiting
      config:
        minute: 5           # 5 attempts/minute/IP
        policy: local
```

### 6.4 Block IPs / allowlist

```yaml
- name: ip-restriction
  config:
    deny: ['203.0.113.0/24']
```

### 6.5 Request/response logging to a file or HTTP collector

```yaml
- name: http-log
  config:
    http_endpoint: http://your-logging-host:9999
    method: POST
    timeout: 1000
    keepalive: 10000
```

### 6.6 Prometheus metrics

```yaml
- name: prometheus
```

Expose `http://localhost:8001/metrics` — scrape with Prometheus / Grafana.

---

## 7. (Option B only) Convert Microservices to HTTP

If you want Kong to route **directly** to each microservice instead of through NestJS, you must change the services from TCP to HTTP. Per service:

### 7.1 Change the bootstrap

`apps/auth-service/src/main.ts` — replace TCP microservice bootstrap with a normal HTTP app:

```ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AuthServiceModule } from './auth-service.module';
import { AllExceptionsFilter, ResponseInterceptor } from '@app/common';

async function bootstrap() {
  const app = await NestFactory.create(AuthServiceModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.setGlobalPrefix('auth');                 // → Kong route: /api/v1/auth/*
  await app.listen(process.env.AUTH_PORT ?? 3001);
}
bootstrap();
```

### 7.2 Convert `@MessagePattern()` to `@Get/@Post` controllers

Move logic from message-pattern handlers into REST controllers in each service. You can keep DTOs as-is; only the transport changes.

### 7.3 Inter-service calls

If `orders-service` needs to call `product-service`, you have three choices:

1. Keep TCP between services (recommended internally) — only the **edge** is HTTP through Kong.
2. Switch to internal HTTP via Kong upstream URLs (`http://kong:8000/api/v1/products/...`).
3. Switch to gRPC (Kong has a gRPC proxy plugin if needed).

### 7.4 Update `kong/kong.yaml`

Replace the single `api-gateway` service with per-service entries:

```yaml
services:
  - name: auth-service
    url: http://host.docker.internal:3001
    routes:
      - name: auth
        paths: ['/api/v1/auth']
        strip_path: true         # → service receives /register, not /api/v1/auth/register
  - name: product-service
    url: http://host.docker.internal:3002
    routes:
      - name: products
        paths: ['/api/v1/products', '/api/v1/categories']
        strip_path: true
  # ...repeat for cart-service (3003), orders-service, payment-service, user-service
```

### 7.5 Retire the NestJS gateway

Once all routes are migrated and verified, delete the `apps/api-gateway/` project (or keep it as a BFF if it does orchestration).

---

## 8. Production Hardening Checklist

- [ ] **Switch Kong to DB-backed mode** if you need the Admin API to mutate config at runtime, or use **deck** (`decK`) to GitOps the declarative YAML.
- [ ] Put **TLS** at the edge — terminate at Kong (`KONG_SSL_CERT` / `KONG_SSL_CERT_KEY`) or use a TLS terminator (ALB/Cloudflare) in front.
- [ ] Switch the `rate-limiting` plugin to `policy: redis` and point it at your existing Redis (port `6379`) so limits work across Kong replicas.
- [ ] Run **two+ Kong instances** behind a load balancer.
- [ ] Tighten CORS `origins` to your real domains.
- [ ] Use **environment variable references** in `kong.yaml` for secrets (Kong supports `${VAR_NAME}` interpolation with `KONG_VAULT` or shell expansion).
- [ ] Pin Kong to a specific patch version (e.g. `kong:3.7.1`) rather than floating `3.7`.
- [ ] Enable the **`prometheus`** plugin and scrape `:8001/metrics`.
- [ ] Disable / lock down the **Admin API** (`KONG_ADMIN_LISTEN: 127.0.0.1:8001`) so only ops can reach it.

---

## 9. Useful Commands

```bash
# Start/stop Kong
docker compose up -d kong
docker compose stop kong
docker compose logs -f kong

# Validate declarative config without restarting
docker run --rm -v "$PWD/kong:/kong" kong:3.7 \
  kong config parse /kong/kong.yaml

# Hot-reload Kong after editing kong.yaml
docker exec kong-gateway kong reload

# Inspect runtime state (DB-less mode is read-only)
curl http://localhost:8001/services | jq
curl http://localhost:8001/routes   | jq
curl http://localhost:8001/plugins  | jq
curl http://localhost:8001/status   | jq

# Hit a route through Kong
curl -i http://localhost:8000/api/v1/products
curl -i -X POST http://localhost:8000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"john@example.com","password":"password123"}'
```

---

## 10. File-by-File Summary of Changes

When you finish Option A, you will have:

| File | Change |
| --- | --- |
| `docker-compose.yaml` | **Modified** — added `kong` service |
| `kong/kong.yaml` | **New** — declarative config |
| `apps/api-gateway/src/main.ts` | Unchanged (still on :3000) |
| `apps/*/src/main.ts` | Unchanged (still TCP) |
| `libs/common/*` | Unchanged |

For Option B, additionally:

| File | Change |
| --- | --- |
| `apps/auth-service/src/main.ts` | **Modified** — HTTP bootstrap, `setGlobalPrefix('auth')` |
| `apps/product-service/src/main.ts` | **Modified** — HTTP bootstrap, `setGlobalPrefix('products')` |
| `apps/cart-service/src/main.ts` | **Modified** — HTTP bootstrap |
| `apps/orders-service/src/main.ts` | **Modified** — HTTP bootstrap |
| `apps/payment-service/src/main.ts` | **Modified** — HTTP bootstrap |
| `apps/user-service/src/main.ts` | **Modified** — HTTP bootstrap |
| `apps/api-gateway/` | **Deleted** (or repurposed as a BFF) |
| Each service's controllers | `@MessagePattern` → `@Get/@Post/@Patch/@Delete` |
| `libs/common/constants/messages.ts` | Optional — no longer needed for inter-service if all-HTTP |
| `kong/kong.yaml` | One `service:` block per microservice |

---

## 11. Suggested Rollout Order

1. **Day 0** — Add `kong` to `docker-compose.yaml`, write minimal `kong.yaml` with just the catch-all `api-gateway` service. Hit `localhost:8000` and confirm it proxies to NestJS.
2. **Day 1** — Add `cors`, `rate-limiting`, `correlation-id`, `request-size-limiting` plugins. Point your frontend to `localhost:8000`.
3. **Day 2** — Enable the `jwt` plugin on private routes. Keep `AccessTokenGuard` for safety. Verify dashboards.
4. **Day 3** — Add `prometheus` plugin, wire it to Grafana.
5. **Week 2+** (Option B) — Pick the lowest-risk service (likely `product-service`, since reads dominate), convert it to HTTP, route directly from Kong, remove its TCP client from the NestJS gateway.
6. **Iterate** — One service at a time, until the NestJS gateway is empty.

---

## 12. References

- Kong Gateway docs — <https://docs.konghq.com/gateway/latest/>
- DB-less / declarative — <https://docs.konghq.com/gateway/latest/production/deployment-topologies/db-less-and-declarative-config/>
- Plugin hub — <https://docs.konghq.com/hub/>
- decK (GitOps for Kong) — <https://docs.konghq.com/deck/latest/>
- NestJS microservices (your TCP backends) — <https://docs.nestjs.com/microservices/basics>
