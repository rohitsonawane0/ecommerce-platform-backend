# Docker Build & Deploy Guide

How to build the service images, push them to a registry, and run them on a server.

Every service has its own Dockerfile at `apps/<service>/Dockerfile`.

---

## 1. Image layout

All seven Dockerfiles follow the same 4-stage pattern:

| Stage | What it does |
| --- | --- |
| `base` | `node:24-alpine` + pnpm 10.28.0 via corepack |
| `deps` | Full install (devDeps included) — the Nest/webpack build needs them |
| `build` | `nest build <service>` → `dist/apps/<service>/main.js` (single webpack bundle) |
| `prod-deps` | Separate `--prod` install, so no devDeps reach the runtime layer |
| `runner` | Clean `node:24-alpine` + prod `node_modules` + the built bundle, running as the non-root `node` user |

Services and their TCP ports:

| Service | Dockerfile | Port | Notes |
| --- | --- | --- | --- |
| api-gateway | `apps/api-gateway/Dockerfile` | 3000 | The only HTTP service — the public entry point |
| auth-service | `apps/auth-service/Dockerfile` | 3001 | Compiles `bcrypt` from source |
| product-service | `apps/product-service/Dockerfile` | 3002 | |
| cart-service | `apps/cart-service/Dockerfile` | 3003 | |
| orders-service | `apps/orders-service/Dockerfile` | 3004 | |
| payment-service | `apps/payment-service/Dockerfile` | 3005 | Won't boot without `STRIPE_KEY` |
| user-service | `apps/user-service/Dockerfile` | 3006 | |

### Why auth-service is different

`bcrypt` is a native addon with no prebuilt binary for Alpine's musl libc. Its `prod-deps`
stage installs `python3 make g++` and runs `pnpm install --ignore-scripts && pnpm rebuild bcrypt`
to compile it. (pnpm 10 blocks package build scripts by default; the `--allow-build` flag
does not exist in 10.28, so `pnpm rebuild` is the working route.) The toolchain stays in the
build stage — only the compiled `node_modules` is copied into the runtime image.

Practical effect: the auth-service build is noticeably slower than the others.

---

## 2. Building locally

**Always build from the repo root.** The Dockerfile lives under `apps/<service>/`, but the
build context must be the root, because every service imports `@app/common` from `libs/`.

```bash
cd /path/to/ecommerce-platform-backend

docker build -f apps/auth-service/Dockerfile -t ecommerce/auth-service .
```

Build everything:

```bash
for s in api-gateway auth-service product-service cart-service \
         orders-service payment-service user-service; do
  docker build -f apps/$s/Dockerfile -t ecommerce/$s . || echo "FAILED: $s"
done
```

`.dockerignore` at the repo root keeps `node_modules`, `dist`, `.env`, `context/`, `docs/`,
`data/` and test files out of the build context.

---

## 3. Pushing to a registry

### The architecture trap

A Mac builds **arm64**. Most cloud servers (EC2, GCE, DigitalOcean, typical VPS) are
**amd64**. An arm64 image on an amd64 host fails at startup with `exec format error`.

So don't push the image sitting on your laptop — build for the target platform explicitly.
`buildx` does build and push in one step.

**Cloud Run is amd64-only**, so `--platform linux/amd64` is mandatory when deploying there.
Use `linux/arm64` for an ARM server (Graviton, Ampere), or `linux/amd64,linux/arm64` for a
multi-arch manifest that runs on both.

### Artifact Registry (primary)

Images live in GCP project **`distance-493706`**, region `asia-south1`, one repository per
service.

One-time Docker credential setup:

```bash
gcloud auth configure-docker asia-south1-docker.pkg.dev
```

Artifact Registry paths have **four** parts — the repository is not the whole path:

```
asia-south1-docker.pkg.dev/distance-493706/auth/auth-service:0.1.0
└──────── host ─────────┘ └─ project ────┘ └repo┘ └─ image ─┘ └tag┘
```

Repository names do **not** match the app directory names:

| App directory | Repository |
| --- | --- |
| `api-gateway` | `api-gateway` |
| `auth-service` | `auth` |
| `product-service` | `product` |
| `cart-service` | `cart` |
| `orders-service` | `order` — singular |
| `payment-service` | `payment` |
| `user-service` | `user` |

Push one service:

```bash
cd /path/to/ecommerce-platform-backend

docker buildx build --platform linux/amd64 \
  -f apps/auth-service/Dockerfile \
  -t asia-south1-docker.pkg.dev/distance-493706/auth/auth-service:0.1.0 \
  -t asia-south1-docker.pkg.dev/distance-493706/auth/auth-service:latest \
  --push .
```

Push everything:

```bash
cd /path/to/ecommerce-platform-backend
REG=asia-south1-docker.pkg.dev/distance-493706

for pair in "api-gateway:api-gateway" "auth-service:auth" "product-service:product" \
            "cart-service:cart" "orders-service:order" "payment-service:payment" \
            "user-service:user"; do
  svc=${pair%%:*}; repo=${pair##*:}
  echo ">>> $svc -> $REG/$repo/$svc"
  docker buildx build --platform linux/amd64 \
    -f apps/$svc/Dockerfile \
    -t $REG/$repo/$svc:0.1.0 \
    -t $REG/$repo/$svc:latest \
    --push . || echo "FAILED: $svc"
done
```

Verify:

```bash
gcloud artifacts docker images list $REG/auth
```

Don't omit the trailing `.` — that's the build context.

> **Cross-project note.** Images are in `distance-493706` while the Cloud SQL instance is in
> `ecommerce-platform-rs`. That works, but a Cloud Run service in one project pulling images
> from the other needs `roles/artifactregistry.reader` granted on `distance-493706`. Keeping
> both in a single project avoids the extra IAM grant.

### Docker Hub (alternative)

Username `rohitf116`:

```bash
docker login
docker buildx build --platform linux/amd64 \
  -f apps/auth-service/Dockerfile \
  -t rohitf116/auth-service:0.1.0 \
  -t rohitf116/auth-service:latest \
  --push .
```

### GHCR (alternative)

```bash
docker login ghcr.io -u <github-username>   # password = PAT with write:packages
docker buildx build --platform linux/amd64 \
  -f apps/auth-service/Dockerfile \
  -t ghcr.io/<github-username>/auth-service:0.1.0 --push .
```

### Tagging

Always push a real version tag alongside `latest`. `latest` alone leaves you nothing to roll
back to. Bumping the tag per deploy is what makes rollback a one-line change.

---

## 4. Environment variables

Each service reads its own prefix — they are **not** uniform. Taken from the source:

| Service | Variables |
| --- | --- |
| api-gateway | `GATEWAY_PORT` (default 3000), `JWT_SECRET`, plus a host/port pair per backend service (see below) |
| auth-service | `DB_HOST` `DB_PORT` `DB_USERNAME` `DB_PASSWORD` `DB_NAME`, `REDIS_HOST` `REDIS_PORT`, `JWT_SECRET`, `JWT_REFRESH_SECRET` |
| product-service | `PRODUCT_DB_HOST` `PRODUCT_DB_PORT` `PRODUCT_DB_USERNAME` `PRODUCT_DB_PASSWORD` `PRODUCT_DB_NAME` |
| cart-service | `CART_DB_*` (same five suffixes) |
| orders-service | `ORDER_DB_*` — note **ORDER**, singular, not `ORDERS_` |
| user-service | `USER_DB_*` |
| payment-service | `STRIPE_KEY` — the service crashes at boot without it |

All TCP microservices also accept `SERVICE_HOST` (defaults to `0.0.0.0`, already
container-friendly) and `SERVICE_PORT`.

**`DB_PORT` is 5432 in production**, not the 5433/5435/5436 values in the dev compose file.
Those are host-side port mappings to avoid collisions on your laptop; container-to-container
you connect to Postgres's real port.

### Gateway → backend routing

The gateway resolves each backend from env vars that fall back to `localhost`, which is
correct for local dev but wrong in containers. **These must be set explicitly** or the
gateway will try to reach itself and every proxied request will fail:

| Variable | Set to |
| --- | --- |
| `AUTH_SERVICE_HOST` / `AUTH_SERVICE_PORT` | `auth-service` / `3001` |
| `PRODUCT_SERVICE_HOST` / `PRODUCT_SERVICE_PORT` | `product-service` / `3002` |
| `CART_SERVICE_HOST` / `CART_SERVICE_PORT` | `cart-service` / `3003` |
| `ORDER_SERVICE_HOST` / `ORDER_SERVICE_PORT` | `orders-service` / `3004` |
| `PAYMENT_SERVICE_HOST` / `PAYMENT_SERVICE_PORT` | `payment-service` / `3005` |
| `USER_SERVICE_HOST` / `USER_SERVICE_PORT` | `user-service` / `3006` |

The host value is the **compose service name** (Docker's DNS resolves it on the shared
network). Note `ORDER_SERVICE_*` is singular, while the container it points at is
`orders-service`.

`JWT_SECRET` must be identical in the gateway and auth-service — the gateway's
`AccessTokenGuard` verifies tokens that auth-service signed.

---

## 5. Running on the server

### Pull

```bash
docker login                                   # only if the repo is private
docker pull asia-south1-docker.pkg.dev/distance-493706/auth/auth-service:0.1.0
```

### Network

Create one user-defined network so containers can resolve each other by name:

```bash
docker network create ecom
```

### Run

```bash
docker run -d --name auth-service --network ecom --restart unless-stopped \
  -e SERVICE_PORT=3001 \
  -e DB_HOST=postgres-auth -e DB_PORT=5432 \
  -e DB_USERNAME=postgres -e DB_PASSWORD='<real-password>' -e DB_NAME=auth_db \
  -e REDIS_HOST=redis -e REDIS_PORT=6379 \
  -e JWT_SECRET='<real-secret>' -e JWT_REFRESH_SECRET='<real-refresh-secret>' \
  asia-south1-docker.pkg.dev/distance-493706/auth/auth-service:0.1.0
```

**Note the absence of `-p`, deliberately.** auth-service is a TCP microservice, not an HTTP
server — only the API gateway talks to it. Publishing 3001 to the host would expose an
internal service to the internet. It only needs to be reachable inside the `ecom` network.

**The gateway is the only container that publishes a port** (`-p 3000:3000`), because it is
the single public entry point.

### Check

```bash
docker logs -f auth-service
```

---

## 6. Compose (recommended over raw `docker run`)

`docker-compose.prod.yaml` on the server:

```yaml
services:
  postgres-auth:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: auth_db
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - auth-pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --appendonly yes
    volumes:
      - redis-data:/data

  auth-service:
    image: asia-south1-docker.pkg.dev/distance-493706/auth/auth-service:0.1.0
    restart: unless-stopped
    environment:
      SERVICE_PORT: 3001
      DB_HOST: postgres-auth
      DB_PORT: 5432
      DB_USERNAME: postgres
      DB_PASSWORD: ${DB_PASSWORD}
      DB_NAME: auth_db
      REDIS_HOST: redis
      REDIS_PORT: 6379
      JWT_SECRET: ${JWT_SECRET}
      JWT_REFRESH_SECRET: ${JWT_REFRESH_SECRET}
    depends_on: [postgres-auth, redis]

  api-gateway:
    image: asia-south1-docker.pkg.dev/distance-493706/api-gateway/api-gateway:0.1.0
    restart: unless-stopped
    ports:
      - '3000:3000'          # the only published port
    environment:
      GATEWAY_PORT: 3000
      JWT_SECRET: ${JWT_SECRET}      # must match auth-service
      AUTH_SERVICE_HOST: auth-service
      AUTH_SERVICE_PORT: 3001
      # ...and a HOST/PORT pair for every other backend service you deploy
    depends_on: [auth-service]

volumes:
  auth-pgdata:
  redis-data:
```

Secrets go in a `.env` beside it (never committed), then:

```bash
docker compose -f docker-compose.prod.yaml up -d
```

The gateway's `*_SERVICE_HOST` variables default to `localhost`. Set every one of them to the
matching compose service name (see §4) — a missing variable doesn't error at boot, it fails
later at request time when the gateway tries to reach itself.

---

## 7. Deploying a new version

```bash
# on your machine, from the repo root
docker buildx build --platform linux/amd64 \
  -f apps/auth-service/Dockerfile \
  -t asia-south1-docker.pkg.dev/distance-493706/auth/auth-service:0.1.1 --push .

# on the server
# bump the tag in docker-compose.prod.yaml, then:
docker compose -f docker-compose.prod.yaml pull
docker compose -f docker-compose.prod.yaml up -d
```

Rollback = point the tag back to `0.1.0` and re-run those two commands.

---

## 8. Before this is genuinely production-ready

- **`synchronize: true` is on** in every service's TypeORM config. The schema is rewritten
  from the entities at each boot, which can drop columns and lose data on a live database.
  Switch it to `false` and move to migrations.
- **No health endpoints exist**, so none of the images declare `HEALTHCHECK`. Adding
  `/health` to the gateway would let compose, a load balancer, or Kubernetes gate traffic on
  readiness.
- **Secrets are passed as plain env vars.** Fine for a single VPS; move to Docker secrets or
  a secrets manager beyond that.
- **JWT_SECRET falls back to the literal `'jwt-secret'`** when unset. Always set it
  explicitly in production — a missing variable silently yields forgeable tokens rather than
  an error.

---

## 9. Verified

All seven images have been built and smoke-tested on this repo: each boots against a
throwaway Postgres/Redis and binds its TCP port, and `bcrypt` works inside the auth image.
The smoke test used a temporary container network and did not touch the dev compose stack.
