# Kong API Gateway + Keycloak — Combined Setup Guide (No NestJS Gateway, No TCP)

Single end-to-end guide to:

1. Stand up **Keycloak** as the identity provider.
2. Put **Kong Gateway** directly in front of every microservice.
3. **Delete** the `apps/api-gateway` NestJS project.
4. Replace the TCP transport (`@nestjs/microservices` TCP) with:
   - **HTTP** for synchronous request/response (browser → service, occasional service → service reads), and
   - **RabbitMQ** for asynchronous events (order created, payment succeeded, etc.).
5. Adopt an **industry-grade** topology: edge auth at Kong, defence-in-depth JWT verification at each service, circuit breakers + retries on internal HTTP, event-driven flows for cross-service state changes.

> This guide supersedes `KONG_API_GATEWAY_GUIDE.md` and `KEYCLOAK_KONG_GUIDE.md`. It is the only doc you need.

---

## Table of Contents

1. [Current state recap](#1-current-state-recap)
2. [Target architecture](#2-target-architecture)
3. [Design decisions baked in](#3-design-decisions-baked-in)
4. [Prerequisites](#4-prerequisites)
5. [Step 1 — `docker-compose.yaml` (Keycloak, Kong, RabbitMQ)](#5-step-1--docker-composeyaml-keycloak-kong-rabbitmq)
6. [Step 2 — Configure the Keycloak realm](#6-step-2--configure-the-keycloak-realm)
7. [Step 3 — Convert each microservice to HTTP + RabbitMQ hybrid](#7-step-3--convert-each-microservice-to-http--rabbitmq-hybrid)
8. [Step 4 — Shared bootstrap helper in `@app/common`](#8-step-4--shared-bootstrap-helper-in-appcommon)
9. [Step 5 — Per-service JWT guard (defence in depth)](#9-step-5--per-service-jwt-guard-defence-in-depth)
10. [Step 6 — Industry-grade inter-service communication](#10-step-6--industry-grade-inter-service-communication)
11. [Step 7 — Write `kong/kong.yaml` (one service block per microservice)](#11-step-7--write-kongkongyaml-one-service-block-per-microservice)
12. [Step 8 — Move DTOs out of the gateway, then delete it](#12-step-8--move-dtos-out-of-the-gateway-then-delete-it)
13. [Step 9 — Retire the custom `auth-service`](#13-step-9--retire-the-custom-auth-service)
14. [Step 10 — Frontend (SPA) changes](#14-step-10--frontend-spa-changes)
15. [Step 11 — Full smoke test](#15-step-11--full-smoke-test)
16. [Production hardening checklist](#16-production-hardening-checklist)
17. [Rollout plan (10 days)](#17-rollout-plan-10-days)
18. [File-by-file change summary](#18-file-by-file-change-summary)
19. [Troubleshooting](#19-troubleshooting)
20. [References](#20-references)

---

## 1. Current State Recap

| Layer | Today |
| --- | --- |
| Edge | NestJS `api-gateway` on `:3000`, prefix `/api/v1` — to be **deleted** |
| Backend services | TCP via `@nestjs/microservices`: `auth-service` (3001), `product-service` (3002), `cart-service` (3003), `orders-service`, `payment-service`, `user-service` — to be **converted to HTTP + RabbitMQ** |
| Auth | Custom `auth-service`: bcrypt + HS256 + Redis blacklist — to be **replaced by Keycloak** |
| Global guard | `AccessTokenGuard` in `libs/common` re-verifies HS256 — to be **replaced by a per-service Keycloak JWKS verifier** |
| Inter-service | `firstValueFrom(client.send(MESSAGE_PATTERN, payload))` over TCP — to be **replaced by HTTP (sync) + RabbitMQ events (async)** |

---

## 2. Target Architecture

```
                       ┌────────────────────┐
   Browser / SPA ─────►│  Keycloak (:8080)  │ ◄── login UI, OIDC, JWKS, MFA
       │ access_token  └────────────────────┘
       ▼ (RS256)
   ┌──────────────────────────────────────────────────────────────────┐
   │   Kong Gateway (:8000)                                           │
   │   - Validates JWT via Keycloak JWKS                              │
   │   - CORS, rate limiting, request-id, prometheus                  │
   │   - Routes /api/v1/<service>/* → http://<service>:<port>/*       │
   └──────┬───────────┬────────┬────────┬─────────┬────────┬──────────┘
          │           │        │        │         │        │
          ▼           ▼        ▼        ▼         ▼        ▼
     ┌────────┐  ┌────────┐ ┌──────┐ ┌──────┐ ┌───────┐ ┌──────┐
     │product │  │ cart   │ │orders│ │paymnt│ │ user  │ │ ...  │
     │ :3002  │  │ :3003  │ │:3004 │ │:3005 │ │ :3006 │ │      │
     └───┬────┘  └───┬────┘ └──┬───┘ └──┬───┘ └──┬────┘ └──────┘
         │           │         │        │        │
         │      sync HTTP      │   async via     │
         │      (axios +       │   RabbitMQ      │
         │      circuit-       │   (events,      │
         │      breaker)       │   no reply)     │
         │                     │                 │
         └─────────────────────┴─────────────────┘
                             │
                       ┌─────▼──────┐
                       │ RabbitMQ   │
                       │  (:5672,   │
                       │   :15672)  │
                       └────────────┘

Each service:
- HTTP server (Kong-facing)              ← NestJS @Controller
- RabbitMQ subscriber (event-driven)     ← NestJS @EventPattern via hybrid app
- HTTP client (axios) for sync reads     ← NestJS HttpModule + circuit breaker
- Its own Postgres                       ← unchanged
- Its own KeycloakJwtGuard                ← validates RS256 via JWKS
```

---

## 3. Design Decisions Baked In

| Decision | Choice | Why |
| --- | --- | --- |
| Edge gateway | Kong DB-less, declarative | Free, GitOps-friendly, no Postgres for Kong |
| Identity provider | Keycloak (Keycloak owns users, passwords, MFA, SSO) | Stop reinventing auth |
| Edge JWT validation | Kong's bundled `jwt` plugin with Keycloak JWKS | No paid plugin, RS256 |
| Per-service JWT validation | Each service **also** verifies JWT (zero-trust) using `jwks-rsa` | Defence in depth — services don't trust the network |
| URL routing | Kong **strips** `/api/v1/<service>` → service sees clean paths | Services don't know about `/api/v1` versioning |
| Sync inter-service | NestJS `HttpModule` (axios) with **timeout + retry + circuit breaker** | Industry standard for synchronous reads |
| Async inter-service | **RabbitMQ** via `@nestjs/microservices` `RMQ` transport, hybrid app | Decouples producers from consumers, durable, ack semantics |
| Service discovery | Docker DNS in dev (service name), Consul/Kubernetes DNS in prod | Standard |
| Request correlation | `X-Request-Id` propagated by Kong + carried over RabbitMQ message headers | Distributed tracing readiness |
| Validation | Each service owns its DTOs (`apps/<svc>/src/**/dto/`) with `ValidationPipe` | No more cross-service DTO duplication in api-gateway |
| Response shape | `ResponseInterceptor` applied per-service via shared bootstrap | Consistent `{ success, message, data, meta }` everywhere |

---

## 4. Prerequisites

- Docker + Docker Compose
- Node 18+, pnpm
- `curl` + `jq`
- A throwaway browser for the Keycloak admin console
- 30 minutes to read this guide before touching anything

---

## 5. Step 1 — `docker-compose.yaml` (Keycloak, Kong, RabbitMQ)

Append these services + the volume to `docker-compose.yaml`:

```yaml
  # ─── Identity ─────────────────────────────────────────────
  postgres-keycloak:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: keycloak_db
      POSTGRES_USER: keycloak
      POSTGRES_PASSWORD: keycloak
    ports: ['5440:5432']
    volumes:
      - keycloak-pg-data:/var/lib/postgresql/data

  keycloak:
    image: quay.io/keycloak/keycloak:25.0
    container_name: keycloak
    command: ['start-dev']
    environment:
      KC_DB: postgres
      KC_DB_URL: jdbc:postgresql://postgres-keycloak:5432/keycloak_db
      KC_DB_USERNAME: keycloak
      KC_DB_PASSWORD: keycloak
      KEYCLOAK_ADMIN: admin
      KEYCLOAK_ADMIN_PASSWORD: admin
      KC_HOSTNAME: localhost
      KC_HTTP_ENABLED: 'true'
      KC_HEALTH_ENABLED: 'true'
      KC_METRICS_ENABLED: 'true'
    ports: ['8080:8080']
    depends_on: [postgres-keycloak]
    extra_hosts: ['host.docker.internal:host-gateway']

  # ─── Edge gateway ─────────────────────────────────────────
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
      KONG_LOG_LEVEL: notice
    ports:
      - '8000:8000'  # Proxy ← clients hit this
      - '8443:8443'
      - '8001:8001'  # Admin API
    volumes:
      - ./kong:/kong/declarative
    extra_hosts: ['host.docker.internal:host-gateway']
    depends_on: [keycloak]

  # ─── Async messaging ──────────────────────────────────────
  rabbitmq:
    image: rabbitmq:3.13-management-alpine
    container_name: rabbitmq
    environment:
      RABBITMQ_DEFAULT_USER: rabbitmq
      RABBITMQ_DEFAULT_PASS: rabbitmq
    ports:
      - '5672:5672'    # AMQP
      - '15672:15672'  # Management UI
    volumes:
      - rabbitmq-data:/var/lib/rabbitmq

volumes:
  keycloak-pg-data:
  rabbitmq-data:
```

```bash
mkdir -p kong
docker compose up -d postgres-keycloak keycloak rabbitmq
docker compose logs -f keycloak     # wait for: 'Listening on: http://0.0.0.0:8080'
```

RabbitMQ management UI: <http://localhost:15672> (`rabbitmq` / `rabbitmq`).

> **Why `host.docker.internal`?** During the transition, your services may still run on the host via `pnpm`. Once you containerize each service (recommended for prod), switch the Kong upstream URLs to Docker service names like `http://product-service:3002`.

---

## 6. Step 2 — Configure the Keycloak Realm

(Same as the previous guide — included here for completeness.)

Open <http://localhost:8080> → log in as `admin / admin`.

1. **Create realm** → name: `ecommerce`.
2. **Clients → Create client**:
   - `ecommerce-backend` — confidential, Service accounts ON (for server-to-server tokens).
   - `ecommerce-web` — public, Standard flow ON, **PKCE required**, Direct grants ON (dev only). Valid redirect URIs: `http://localhost:5173/*`, Web origins: `+`.
3. **Realm roles → Create**: `customer`, `admin`, `support`.
4. **Client scopes → roles → Mappers** → Add **Audience** mapper, included audience = `ecommerce-backend`, access token: ON.
5. **Users → Add user**: `john` / `john@example.com`, email verified, password `password123` (not temporary), role `customer`.

Export the realm for GitOps:

```bash
docker exec -it keycloak \
  /opt/keycloak/bin/kc.sh export --dir /tmp/export --realm ecommerce --users realm_file
docker cp keycloak:/tmp/export ./keycloak-realm
```

To auto-import on fresh starts, in the `keycloak` service of `docker-compose.yaml`:

```yaml
volumes:
  - ./keycloak-realm:/opt/keycloak/data/import
command: ['start-dev', '--import-realm']
```

Sanity test:

```bash
TOKEN=$(curl -s -X POST \
  'http://localhost:8080/realms/ecommerce/protocol/openid-connect/token' \
  -d 'grant_type=password' -d 'client_id=ecommerce-web' \
  -d 'username=john' -d 'password=password123' \
  -d 'scope=openid profile email' | jq -r .access_token)

echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq
```

Verify `iss`, `sub`, `email`, `preferred_username`, `realm_access.roles`, `alg: RS256`, `kid` in the JWT header.

---

## 7. Step 3 — Convert Each Microservice to HTTP + RabbitMQ Hybrid

Every service becomes a **NestJS hybrid application**: an HTTP server (for Kong-facing traffic) plus an attached RabbitMQ microservice (for async events).

### 7.1 Add dependencies (once, at the monorepo root)

```bash
pnpm add @nestjs/axios axios amqplib amqp-connection-manager opossum jwks-rsa
pnpm add -D @types/amqplib
```

- `@nestjs/axios` + `axios` — sync HTTP between services
- `amqplib` + `amqp-connection-manager` — RabbitMQ transport for `@nestjs/microservices`
- `opossum` — circuit breaker
- `jwks-rsa` — fetch Keycloak signing keys for per-service JWT verification

### 7.2 The new pattern for `main.ts` — example: `apps/cart-service/src/main.ts`

```ts
import { NestFactory } from '@nestjs/core';
import { Transport } from '@nestjs/microservices';
import { CartServiceModule } from './cart-service.module';
import { applyGlobalBootstrap } from '@app/common';   // see §8

async function bootstrap() {
  const app = await NestFactory.create(CartServiceModule);

  app.connectMicroservice({
    transport: Transport.RMQ,
    options: {
      urls: [process.env.RABBITMQ_URL ?? 'amqp://rabbitmq:rabbitmq@localhost:5672'],
      queue: 'cart_events_queue',
      queueOptions: { durable: true },
      noAck: false,
      prefetchCount: 10,
    },
  });

  applyGlobalBootstrap(app);                      // pipes, interceptors, filters, helmet

  await app.startAllMicroservices();
  const port = process.env.CART_PORT ?? 3003;
  await app.listen(port, '0.0.0.0');
  console.log(`cart-service HTTP listening on :${port}, subscribed to cart_events_queue`);
}

bootstrap();
```

Apply the same shape to every service:

| Service | HTTP port (env) | RabbitMQ queue |
| --- | --- | --- |
| `product-service` | `PRODUCT_PORT` (3002) | `product_events_queue` |
| `cart-service` | `CART_PORT` (3003) | `cart_events_queue` |
| `orders-service` | `ORDERS_PORT` (3004) | `orders_events_queue` |
| `payment-service` | `PAYMENT_PORT` (3005) | `payment_events_queue` |
| `user-service` | `USER_PORT` (3006) | `user_events_queue` |
| `auth-service` | (deleted in §13) | — |

> If a service doesn't subscribe to events yet, omit `connectMicroservice` + `startAllMicroservices`.

### 7.3 Convert `@MessagePattern` controllers to REST + `@EventPattern`

**Before** (`apps/cart-service/src/cart/cart.controller.ts` — TCP):

```ts
@MessagePattern(CART_MESSAGES.ADD_ITEM)
addItem(@Payload() dto: AddToCartDto) { return this.cartService.addItem(dto); }
```

**After** — split into HTTP for sync, `@EventPattern` for async:

```ts
import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { KeycloakJwtGuard, CurrentUser, JwtPayload } from '@app/common';
import { CartService } from './cart.service';
import { AddToCartDto } from './dto/add-to-cart.dto';

@Controller('items')                              // Kong strips /api/v1/cart → service sees /items
@UseGuards(KeycloakJwtGuard)                      // per-service JWT verification (§9)
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Post()
  add(@CurrentUser() user: JwtPayload, @Body() dto: AddToCartDto) {
    return this.cartService.addItem(user.id, dto);
  }

  @Get()
  get(@CurrentUser() user: JwtPayload) {
    return this.cartService.getCart(user.id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.cartService.remove(user.id, id);
  }
}

@Controller()
export class CartEventsController {
  constructor(private readonly cartService: CartService) {}

  @EventPattern('order.created')                  // fire-and-forget event from orders-service
  handleOrderCreated(@Payload() event: { orderId: string; userId: string }) {
    return this.cartService.clearCart(event.userId);
  }
}
```

Register both controllers in the service's module.

### 7.4 Controller-path quick reference (after Kong strips `/api/v1/<service>`)

| Public URL (client → Kong) | Service controller path |
| --- | --- |
| `POST /api/v1/cart/items` | `@Controller('items')` → `@Post()` |
| `GET /api/v1/cart` | `@Controller()` → `@Get()` on `CartRootController`, OR mount `CartController` at `''` |
| `GET /api/v1/products` | `@Controller('')` → `@Get()` (lives in product-service) |
| `GET /api/v1/products/:id` | `@Controller('')` → `@Get(':id')` |
| `POST /api/v1/orders` | `@Controller('')` → `@Post()` (in orders-service) |
| `POST /api/v1/orders/:id/cancel` | `@Controller('')` → `@Post(':id/cancel')` |
| `POST /api/v1/categories` | `@Controller('categories')` (in product-service) |

> Two services share the `/api/v1/products` and `/api/v1/categories` namespace? Both live in `product-service` — register both controllers there. Kong sees `product-service` as one upstream.

---

## 8. Step 4 — Shared Bootstrap Helper in `@app/common`

To avoid copy-pasting `ValidationPipe`, `ResponseInterceptor`, `AllExceptionsFilter`, and `helmet` into every service's `main.ts`, add a single helper.

`libs/common/src/bootstrap/apply-global-bootstrap.ts`:

```ts
import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { ResponseInterceptor } from '../interceptors/response.interceptor';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter';

export function applyGlobalBootstrap(app: INestApplication) {
  app.use(helmet());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
}
```

Export it from `libs/common/src/bootstrap/index.ts` and re-export in `libs/common/src/index.ts`.

> **CORS**: Don't enable CORS here. Kong owns CORS. Services should reject browsers reaching them directly — Kong is the only authorized client.

---

## 9. Step 5 — Per-Service JWT Guard (Defence in Depth)

Even though Kong already verified the JWT, each service should re-verify. If an attacker bypasses Kong (misconfig, internal pivot), services must not trust the request blindly.

### 9.1 `libs/common/src/guards/keycloak-jwt.guard.ts`

```ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import jwksClient, { JwksClient } from 'jwks-rsa';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { JwtPayload } from '../interface/jwt-payload.interface';

@Injectable()
export class KeycloakJwtGuard implements CanActivate {
  private readonly logger = new Logger(KeycloakJwtGuard.name);
  private readonly jwks: JwksClient;
  private readonly issuer: string;

  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
  ) {
    this.issuer =
      process.env.KEYCLOAK_ISSUER ??
      'http://localhost:8080/realms/ecommerce';
    this.jwks = jwksClient({
      jwksUri: `${this.issuer}/protocol/openid-connect/certs`,
      cache: true,
      cacheMaxAge: 10 * 60 * 1000,      // 10 min
      rateLimit: true,
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const token = (req.headers.authorization ?? '').split(' ')[1];
    if (!token) throw new UnauthorizedException('Missing bearer token');

    try {
      const decodedHeader = this.jwtService.decode(token, { complete: true }) as
        | { header: { kid: string } }
        | null;
      if (!decodedHeader?.header?.kid) throw new Error('No kid in token header');

      const key = await this.jwks.getSigningKey(decodedHeader.header.kid);
      const publicKey = key.getPublicKey();

      const claims = await this.jwtService.verifyAsync<any>(token, {
        publicKey,
        algorithms: ['RS256'],
        issuer: this.issuer,
      });

      const user: JwtPayload = {
        id: claims.sub,
        email: claims.email,
        username: claims.preferred_username,
        roles: claims.realm_access?.roles ?? [],
      };
      req.user = user;
      return true;
    } catch (err) {
      this.logger.warn(`JWT verification failed: ${(err as Error).message}`);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
```

### 9.2 Update `JwtPayload`

`libs/common/src/interface/jwt-payload.interface.ts`:

```ts
export interface JwtPayload {
  id: string;            // Keycloak 'sub' UUID
  email: string;
  username: string;      // Keycloak 'preferred_username'
  roles: string[];       // realm_access.roles
}
```

### 9.3 Register the guard in each service

Each service registers the guard locally — no more global guard inherited from the gateway.

```ts
// apps/cart-service/src/cart-service.module.ts
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { KeycloakJwtGuard } from '@app/common';

@Module({
  imports: [
    JwtModule.register({}),               // no secret needed — public-key flow
    // ...rest
  ],
  providers: [
    { provide: APP_GUARD, useClass: KeycloakJwtGuard },
  ],
})
export class CartServiceModule {}
```

Use `@Public()` on health checks / public reads in each service.

> **Performance**: `jwks-rsa` caches the signing key in-memory (10 min). After warm-up, JWT verification is pure RSA-verify (~0.3 ms). No call to Keycloak per request.

---

## 10. Step 6 — Industry-Grade Inter-Service Communication

### 10.1 When to use each transport

| Pattern | Transport | Example |
| --- | --- | --- |
| **Synchronous read** (the caller needs the answer to respond to the user) | **HTTP (axios)** with timeout, retry, circuit breaker | `orders-service` reads product price + stock from `product-service` while creating an order |
| **Asynchronous side effect** (fire-and-forget, eventual consistency) | **RabbitMQ event** | `orders-service` publishes `order.created` → `cart-service` clears the cart, `notification-service` sends email |
| **Distributed transaction** | **Saga pattern over RabbitMQ** (choreography) | Place order → reserve inventory → charge payment → mark paid → if any step fails, publish compensating event |
| **Server-to-server with a Keycloak token** | HTTP with a **Client Credentials** token | `orders-service` calls `payment-service` with its own service-account JWT |

### 10.2 Sync HTTP with circuit breaker — example: orders-service reading from product-service

`apps/orders-service/src/clients/product-client.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import CircuitBreaker from 'opossum';

interface ProductSummary {
  id: string;
  name: string;
  price: number;
  stock: number;
}

@Injectable()
export class ProductClient {
  private readonly logger = new Logger(ProductClient.name);
  private readonly breaker: CircuitBreaker<[string], ProductSummary>;
  private readonly baseUrl =
    process.env.PRODUCT_SERVICE_URL ?? 'http://product-service:3002';

  constructor(private readonly http: HttpService) {
    this.breaker = new CircuitBreaker(this.fetch.bind(this), {
      timeout: 2_000,                  // 2s upstream timeout
      errorThresholdPercentage: 50,    // open at 50 % failure rate
      resetTimeout: 10_000,            // half-open after 10s
      rollingCountTimeout: 10_000,
      rollingCountBuckets: 10,
    });
    this.breaker.fallback(() => {
      throw new Error('product-service unavailable');
    });
    this.breaker.on('open', () => this.logger.warn('product-service breaker OPEN'));
    this.breaker.on('halfOpen', () => this.logger.log('product-service breaker HALF-OPEN'));
    this.breaker.on('close', () => this.logger.log('product-service breaker CLOSED'));
  }

  getById(id: string): Promise<ProductSummary> {
    return this.breaker.fire(id);
  }

  private async fetch(id: string): Promise<ProductSummary> {
    const res = await firstValueFrom(
      this.http.get<ProductSummary>(`${this.baseUrl}/${id}`, {
        timeout: 1_500,
        headers: { 'X-Request-Id': this.getCorrelationId() },
      }),
    );
    return res.data;
  }

  private getCorrelationId() {
    return require('node:async_hooks').AsyncLocalStorage   // wire via middleware
      ? '...' : '';
  }
}
```

Register in the module:

```ts
@Module({
  imports: [HttpModule.register({ timeout: 2000, maxRedirects: 0 })],
  providers: [ProductClient],
  exports: [ProductClient],
})
export class ClientsModule {}
```

> **Retry strategy**: 2 retries with exponential backoff (250ms, 500ms) for `5xx` and network errors. Don't retry `4xx`. Use `axios-retry`.

> **Authentication for internal HTTP**: services obtain a Keycloak Client Credentials token at boot (cached, refreshed before expiry) and put it in the `Authorization` header. The callee's `KeycloakJwtGuard` validates it the same way as user tokens — service accounts have `realm_access.roles` like `service-orders`.

### 10.3 Async events with RabbitMQ — example: order created

**Publisher** (`apps/orders-service/src/orders/orders.service.ts`):

```ts
import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

@Injectable()
export class OrdersService {
  constructor(
    @Inject('EVENT_BUS') private readonly events: ClientProxy,
  ) {}

  async createOrder(userId: string, dto: CreateOrderDto) {
    const order = await this.repo.save({ ...dto, userId, status: 'PENDING' });

    this.events.emit('order.created', {
      orderId: order.id,
      userId: order.userId,
      total: order.total,
      occurredAt: new Date().toISOString(),
    });
    return order;
  }
}
```

Register the publisher in the module:

```ts
// orders-service.module.ts
ClientsModule.register([
  {
    name: 'EVENT_BUS',
    transport: Transport.RMQ,
    options: {
      urls: [process.env.RABBITMQ_URL!],
      queue: 'orders_publisher',         // ignored for emit() into exchange
      queueOptions: { durable: true },
    },
  },
]);
```

**Subscriber** (cart-service, notification-service, etc.) — already shown in §7.3 `CartEventsController.handleOrderCreated`.

### 10.4 Event naming convention

Use `<aggregate>.<past-tense-verb>`: `order.created`, `order.cancelled`, `payment.succeeded`, `payment.failed`, `cart.cleared`, `user.registered`.

Always include `occurredAt` (ISO timestamp) and a correlation id (`X-Request-Id`). Document every event in `context/EVENTS.md`.

---

## 11. Step 7 — Write `kong/kong.yaml` (One Service Block per Microservice)

### 11.1 Get Keycloak's signing key as PEM (one-off)

```bash
pnpm dlx jwk-to-pem-cli --help    # or:
npm i -g jwk-to-pem
node -e '
  const jwkToPem = require("jwk-to-pem");
  let data = "";
  process.stdin.on("data", c => data += c);
  process.stdin.on("end", () => {
    const jwks = JSON.parse(data);
    jwks.keys.filter(k => k.use === "sig").forEach(k => {
      console.log("# kid:", k.kid);
      console.log(jwkToPem(k));
    });
  });
' < <(curl -s http://localhost:8080/realms/ecommerce/protocol/openid-connect/certs)
```

Paste the resulting `-----BEGIN PUBLIC KEY-----` block into the YAML below.

### 11.2 `kong/kong.yaml`

```yaml
_format_version: '3.0'
_transform: true

# ─── Consumer + Keycloak signing key(s) ──────────────────────
consumers:
  - username: keycloak-ecommerce
    jwt_secrets:
      - key: 'http://localhost:8080/realms/ecommerce'   # must match JWT 'iss' claim exactly
        algorithm: RS256
        rsa_public_key: |
          -----BEGIN PUBLIC KEY-----
          MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...PASTE-PEM-HERE...
          -----END PUBLIC KEY-----
      # Add a second entry on key rotation; remove the old one once all old tokens expire.

# ─── Services ─────────────────────────────────────────────────
# host.docker.internal works while services run on the host via pnpm.
# Once containerized, swap to the Docker service name.
services:

  - name: auth-passthrough
    # Public-facing passthrough to Keycloak so the SPA can hit a unified /api/v1/auth/* path
    url: http://keycloak:8080
    routes:
      - name: auth-token
        paths: ['/api/v1/auth/token']
        strip_path: true
        plugins:
          - name: request-transformer
            config:
              replace:
                uri: /realms/ecommerce/protocol/openid-connect/token
      - name: auth-logout
        paths: ['/api/v1/auth/logout']
        strip_path: true
        plugins:
          - name: request-transformer
            config:
              replace:
                uri: /realms/ecommerce/protocol/openid-connect/logout
      - name: auth-userinfo
        paths: ['/api/v1/auth/me']
        strip_path: true
        plugins:
          - name: request-transformer
            config:
              replace:
                uri: /realms/ecommerce/protocol/openid-connect/userinfo
          - name: jwt
            config: { key_claim_name: iss, claims_to_verify: [exp] }

  - name: product-service
    url: http://host.docker.internal:3002
    routes:
      - name: products-public
        paths: ['/api/v1/products', '/api/v1/categories']
        methods: [GET, OPTIONS]
        strip_path: true                  # service sees / or /:id, no /api/v1/products prefix
      - name: products-private
        paths: ['/api/v1/products', '/api/v1/categories']
        methods: [POST, PUT, PATCH, DELETE]
        strip_path: true
        plugins:
          - name: jwt
            config: { key_claim_name: iss, claims_to_verify: [exp], run_on_preflight: false }

  - name: cart-service
    url: http://host.docker.internal:3003
    routes:
      - name: cart
        paths: ['/api/v1/cart']
        strip_path: true
        plugins:
          - name: jwt
            config: { key_claim_name: iss, claims_to_verify: [exp], run_on_preflight: false }

  - name: orders-service
    url: http://host.docker.internal:3004
    routes:
      - name: orders
        paths: ['/api/v1/orders']
        strip_path: true
        plugins:
          - name: jwt
            config: { key_claim_name: iss, claims_to_verify: [exp], run_on_preflight: false }

  - name: payment-service
    url: http://host.docker.internal:3005
    routes:
      - name: payments
        paths: ['/api/v1/payments']
        strip_path: true
        plugins:
          - name: jwt
            config: { key_claim_name: iss, claims_to_verify: [exp], run_on_preflight: false }
      - name: payments-webhook
        paths: ['/api/v1/payments/webhook']
        strip_path: true
        methods: [POST]
        # NO jwt plugin — Stripe webhook is signed differently. Validate inside the service.

  - name: user-service
    url: http://host.docker.internal:3006
    routes:
      - name: addresses
        paths: ['/api/v1/addresses']
        strip_path: true
        plugins:
          - name: jwt
            config: { key_claim_name: iss, claims_to_verify: [exp], run_on_preflight: false }
      - name: users-me
        paths: ['/api/v1/users/me']
        strip_path: true
        plugins:
          - name: jwt
            config: { key_claim_name: iss, claims_to_verify: [exp], run_on_preflight: false }

# ─── Global plugins ──────────────────────────────────────────
plugins:
  - name: cors
    config:
      origins: ['http://localhost:5173']        # tighten in prod
      methods: [GET, POST, PUT, PATCH, DELETE, OPTIONS]
      headers: [Content-Type, Authorization, X-Request-Id]
      credentials: true
      max_age: 3600

  - name: rate-limiting
    config:
      minute: 120
      hour: 5000
      policy: local                              # 'redis' in prod

  - name: request-size-limiting
    config:
      allowed_payload_size: 10

  - name: correlation-id
    config:
      header_name: X-Request-Id
      generator: uuid
      echo_downstream: true

  - name: prometheus
    config:
      status_code_metrics: true
      latency_metrics: true
      bandwidth_metrics: true
      upstream_health_metrics: true

  # Forward Keycloak claims as headers — convenient for logging / tracing in services.
  # Per-service KeycloakJwtGuard still validates the token; these headers are
  # informational, not trusted.
  - name: pre-function
    config:
      access:
        - |
          local auth = kong.request.get_header("Authorization")
          if auth then
            local token = auth:match("Bearer%s+(.+)")
            if token then
              local jwt_parser = require "kong.plugins.jwt.jwt_parser"
              local parsed = jwt_parser:new(token)
              if parsed and parsed.claims then
                local roles = ""
                if parsed.claims.realm_access and parsed.claims.realm_access.roles then
                  roles = table.concat(parsed.claims.realm_access.roles, ",")
                end
                kong.service.request.set_header("X-User-Id",    parsed.claims.sub or "")
                kong.service.request.set_header("X-User-Email", parsed.claims.email or "")
                kong.service.request.set_header("X-User-Name",  parsed.claims.preferred_username or "")
                kong.service.request.set_header("X-User-Roles", roles)
              end
            end
          end
```

### 11.3 Start Kong & reload

```bash
docker compose up -d kong
docker compose logs -f kong               # 'Kong started'

# After editing kong/kong.yaml:
docker exec kong-gateway kong reload

# Validate before reload:
docker run --rm -v "$PWD/kong:/kong" kong:3.7 kong config parse /kong/kong.yaml
```

---

## 12. Step 8 — Move DTOs out of the Gateway, Then Delete It

`apps/api-gateway/` currently holds DTOs and proxy controllers. With Kong in front, none of it is needed.

### 12.1 Migrate DTOs

For each subfolder under `apps/api-gateway/src/<area>/dto/`, move (`git mv`) the DTO into the corresponding service:

| From | To |
| --- | --- |
| `apps/api-gateway/src/products/dto/create-product.dto.ts` | `apps/product-service/src/products/dto/` (likely already there — keep the service copy as canonical) |
| `apps/api-gateway/src/products/categories/dto/*` | `apps/product-service/src/categories/dto/` |
| `apps/api-gateway/src/orders/dto/*` | `apps/orders-service/src/orders/dto/` |
| `apps/api-gateway/src/cart/dto/*` (if any) | `apps/cart-service/src/cart/dto/` |
| `apps/api-gateway/src/payments/dto/*` | `apps/payment-service/src/payments/dto/` |

If DTOs are *truly* shared (same shape across services), move them to `libs/common/src/dto/<area>/` and import from `@app/common`. Document each shared DTO in `context/decisions/shared-dtos.md`.

### 12.2 Delete the gateway

Once every endpoint works end-to-end through Kong:

```bash
git rm -r apps/api-gateway
```

Update:

- `nest-cli.json` — remove the `api-gateway` project entry.
- `package.json` — remove the `start:gateway` script (and update `start:all`).

Result: zero NestJS gateway code in the monorepo.

---

## 13. Step 9 — Retire the Custom `auth-service`

| Old endpoint (was on api-gateway → auth-service via TCP) | New behavior |
| --- | --- |
| `POST /api/v1/auth/register` | Keycloak self-registration (Realm → Login → User registration ON), OR a `user-service` proxy that calls Keycloak Admin API |
| `POST /api/v1/auth/login` | Kong route `/api/v1/auth/token` rewrites to Keycloak's `/protocol/openid-connect/token` (already wired in §11.2) |
| `POST /api/v1/auth/refresh` | Same `/api/v1/auth/token` endpoint with `grant_type=refresh_token` |
| `POST /api/v1/auth/logout` | Kong route `/api/v1/auth/logout` → Keycloak logout |
| `GET /api/v1/auth/me` | Kong route `/api/v1/auth/me` → Keycloak userinfo (JWT-protected) |
| `POST /api/v1/auth/forgot-password` | Keycloak login page → "Forgot password?" (requires SMTP in Keycloak) |
| `POST /api/v1/auth/reset-password` | Keycloak email link |

### 13.1 Migrate existing users from `auth_db` → Keycloak

**Preferred — bulk import preserving bcrypt:**

1. Export from `auth_db.user`: `id, email, firstName, lastName, password (bcrypt)`.
2. Build a [partialImport](https://www.keycloak.org/docs-api/latest/rest-api/index.html#_partialimport) payload — one user per entry:

   ```json
   {
     "username": "john@example.com",
     "email": "john@example.com",
     "firstName": "John",
     "lastName": "Doe",
     "enabled": true,
     "emailVerified": true,
     "credentials": [{
       "type": "password",
       "secretData": "{\"value\":\"<bcrypt-hash>\",\"salt\":\"\"}",
       "credentialData": "{\"hashIterations\":10,\"algorithm\":\"bcrypt\"}"
     }]
   }
   ```

3. `POST /admin/realms/ecommerce/partialImport` using an admin token.
4. After import, users log in with their existing password.

**Alternative — just-in-time:** write a Keycloak Custom User Storage SPI that, on first failed login, calls back to the old `auth-service`, verifies the password, and writes it into Keycloak. Users migrate transparently as they sign in.

### 13.2 Delete `auth-service`

After migration is verified in prod for ≥ 1 week:

```bash
git rm -r apps/auth-service
```

Remove `auth-service` from `nest-cli.json`, `package.json` (`start:auth`), `docker-compose.yaml` (drop `postgres-auth` after backing up `auth_db`), and `libs/common/src/constants/services.ts` / `messages.ts` (remove `AUTH_SERVICE` + `AUTH_MESSAGES`).

Also delete:

- `JWT_SECRET`, `JWT_REFRESH_SECRET` env vars
- Redis blacklist code (Keycloak handles revocation via session invalidation)
- `apps/auth-service/src/auth/strategies/` (already partially removed per `git status`)

### 13.3 Keep `user-service` for app-specific profile data

`user-service` becomes the home of:

- Addresses (already there)
- App preferences (currency, language, notifications)
- Role-in-organization (for B2B), loyalty points, etc.

JIT provisioning: on the first request from a new `X-User-Id`, create the row in `user_db.user` keyed by Keycloak's `sub`.

---

## 14. Step 10 — Frontend (SPA) Changes

```bash
npm i keycloak-js
```

```ts
import Keycloak from 'keycloak-js';

export const keycloak = new Keycloak({
  url: 'http://localhost:8080',
  realm: 'ecommerce',
  clientId: 'ecommerce-web',
});

await keycloak.init({
  onLoad: 'check-sso',
  pkceMethod: 'S256',
  silentCheckSsoRedirectUri: window.location.origin + '/silent-check-sso.html',
});

if (!keycloak.authenticated) keycloak.login();

export async function api(path: string, init: RequestInit = {}) {
  await keycloak.updateToken(30);
  return fetch(`http://localhost:8000${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${keycloak.token}`,
    },
  });
}
```

`public/silent-check-sso.html`:

```html
<html><body><script>parent.postMessage(location.href, location.origin)</script></body></html>
```

---

## 15. Step 11 — Full Smoke Test

```bash
# 1) Get a Keycloak token via Kong's passthrough route
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/token \
  -d 'grant_type=password' \
  -d 'client_id=ecommerce-web' \
  -d 'username=john' \
  -d 'password=password123' \
  -d 'scope=openid profile email' | jq -r .access_token)

# 2) Public read — no JWT
curl -i http://localhost:8000/api/v1/products

# 3) Private route without token → 401 from Kong
curl -i http://localhost:8000/api/v1/cart

# 4) Private route WITH token → 200, service sees verified user
curl -i http://localhost:8000/api/v1/cart \
  -H "Authorization: Bearer $TOKEN"

# 5) Add to cart
curl -i -X POST http://localhost:8000/api/v1/cart/items \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"productId":"<uuid>","quantity":2}'

# 6) Create order — orders-service synchronously reads from product-service via circuit breaker,
#    then emits 'order.created' on RabbitMQ → cart-service consumes & clears cart
curl -i -X POST http://localhost:8000/api/v1/orders \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"shippingAddressId":"<uuid>"}'

# 7) Verify the event was processed
docker compose logs cart-service | grep 'order.created'

# 8) Direct-to-service call without going through Kong → should be blocked
curl -i http://localhost:3003/items \
  -H "Authorization: Bearer $TOKEN"
# Goal: rejected unless caller is on the internal network (see §16)
```

Watch the RabbitMQ UI at <http://localhost:15672> to see queues fill and drain.

---

## 16. Production Hardening Checklist

### Keycloak

- [ ] Run with `start` (HTTPS, hostname validation)
- [ ] Real `KC_HOSTNAME` behind TLS terminator
- [ ] Strong admin password, VPN-restricted access
- [ ] **Disable** Direct Access Grants on `ecommerce-web` once SPA is fully on Auth Code + PKCE
- [ ] Token lifespans: access 5–15 min, refresh 30 min idle / 8h max
- [ ] Required actions: Verify Email, Update Profile
- [ ] Brute Force Detection ON
- [ ] SMTP configured for password reset
- [ ] MFA (TOTP) required for `admin` role
- [ ] Daily `keycloak_db` backups
- [ ] Quarterly signing-key rotation; overlap old + new in `kong.yaml`

### Kong

- [ ] Pin to a patch version (`kong:3.7.1`)
- [ ] `KONG_ADMIN_LISTEN: 127.0.0.1:8001` (or firewall to ops)
- [ ] `rate-limiting` plugin → `policy: redis` (cluster-aware)
- [ ] Two+ Kong replicas behind a load balancer
- [ ] TLS at the edge (`KONG_SSL_CERT` / `KONG_SSL_CERT_KEY`)
- [ ] CORS `origins` restricted to real domains
- [ ] **decK** GitOps the `kong.yaml`
- [ ] Cron job auto-rotates JWKS into `kong.yaml` via decK
- [ ] `prometheus` plugin → Grafana dashboards

### Services

- [ ] Each service binds to private network only (no public exposure)
- [ ] Network policy / security group: only Kong's IP can reach service ports
- [ ] Per-service `KeycloakJwtGuard` enabled — never trust Kong alone
- [ ] Service-account tokens (Client Credentials) for service-to-service HTTP, **not** user tokens passed along
- [ ] Circuit breakers + retries (with jitter) on every internal HTTP client
- [ ] Idempotency keys on every event handler (RabbitMQ may redeliver)
- [ ] Dead-letter exchanges for poison messages
- [ ] Distributed tracing: propagate `X-Request-Id` through HTTP and RabbitMQ headers; export OpenTelemetry traces

### Data

- [ ] Backups of every Postgres (auth_db is deletable post-migration)
- [ ] RabbitMQ data persisted to a volume (already in §5)
- [ ] Schema migrations per service via TypeORM migrations (turn off `synchronize: true`)

---

## 17. Rollout Plan (10 days)

| Day | Action | Rollback |
| --- | --- | --- |
| 0 | Add Keycloak + Postgres + RabbitMQ to `docker-compose.yaml`. Realm, clients, test user. Confirm `/token` works. | Drop the new containers. |
| 1 | Add `kong/kong.yaml` with **only one service block**: a catch-all pointing at the existing NestJS gateway (Option A from old guide). All routes open. Verify `:8000` proxies the same as `:3000`. | Stop Kong. |
| 2 | Add `cors`, `rate-limiting`, `correlation-id`, `pre-function`, `prometheus` plugins. Point a SPA copy at `:8000`. | Disable plugins. |
| 3 | Build `KeycloakJwtGuard` and `applyGlobalBootstrap` helper in `libs/common`. Add `RABBITMQ_URL` env to all services. | Library is additive. |
| 4 | Pick **one low-blast-radius service** (e.g. `product-service`). Convert its `main.ts` to HTTP, move DTOs in, register the JWT guard. Add a `product-service` block to `kong.yaml` with `strip_path: true`. Verify `/api/v1/products` works through Kong → product-service directly, bypassing the old gateway. | Re-route Kong's `products` paths back to the api-gateway block. |
| 5 | Repeat for `cart-service`. Add the `order.created` event subscriber as a no-op first to validate RabbitMQ wiring. | Same. |
| 6 | Convert `orders-service` & `payment-service`. Implement `ProductClient` circuit breaker. Replace the TCP cart-clearing call with a RabbitMQ `order.created` event. | Keep TCP handlers in parallel during transition. |
| 7 | Convert `user-service`. Wire `/api/v1/addresses` and `/api/v1/users/me` through Kong. Run user-migration script into Keycloak. | Migration script is idempotent; re-run if needed. |
| 8 | Update the SPA to use `keycloak-js` (PKCE). Coexist: SPA tries Keycloak first, falls back to old `/auth/login` until tomorrow. | Toggle a feature flag in the SPA. |
| 9 | Delete `apps/api-gateway`. Remove its entries from `nest-cli.json`, `package.json`, `docker-compose.yaml`. Strip register/login from `auth-service`. Remove `JWT_SECRET` env vars. | `git revert`. |
| 10 | Delete `apps/auth-service`. Drop `auth_db` (after backup). Update `libs/common/constants/services.ts`. | `git revert`. |

---

## 18. File-by-File Change Summary

| File | Status | Change |
| --- | --- | --- |
| `docker-compose.yaml` | **modified** | Added `postgres-keycloak`, `keycloak`, `kong`, `rabbitmq` + volumes |
| `kong/kong.yaml` | **new** | One service block per microservice with `strip_path: true`; `jwt` plugin on private routes; global `pre-function`, `cors`, `rate-limiting`, `correlation-id`, `prometheus` |
| `keycloak-realm/ecommerce-realm.json` | **new** | Exported realm for reproducible setup |
| `libs/common/src/bootstrap/apply-global-bootstrap.ts` | **new** | Shared `ValidationPipe`/`ResponseInterceptor`/`AllExceptionsFilter`/`helmet` |
| `libs/common/src/guards/keycloak-jwt.guard.ts` | **new** | Per-service RS256 verification via JWKS |
| `libs/common/src/guards/access-token.guard.ts` | **delete** | Obsolete |
| `libs/common/src/interface/jwt-payload.interface.ts` | **modified** | `roles: string[]`, add `username`, `id` = Keycloak `sub` |
| `libs/common/src/constants/services.ts` | **modified** | Remove `AUTH_SERVICE` (and TCP-only service tokens, if any) |
| `libs/common/src/constants/messages.ts` | **modified** | Remove TCP message patterns; add event-name constants (`order.created`, etc.) |
| `apps/<each>-service/src/main.ts` | **modified** | HTTP server + `connectMicroservice(RMQ)` + `applyGlobalBootstrap` |
| `apps/<each>-service/src/**/*.controller.ts` | **modified** | `@MessagePattern` → `@Get/@Post/@Patch/@Delete` REST; add `@EventPattern` event handlers |
| `apps/<each>-service/src/**/dto/*` | **new / moved** | DTOs migrated from `api-gateway` |
| `apps/orders-service/src/clients/product-client.service.ts` | **new** | axios + opossum circuit breaker → product-service |
| `apps/orders-service/src/orders/orders.service.ts` | **modified** | Emit `order.created` event after persisting |
| `apps/cart-service/src/cart/cart-events.controller.ts` | **new** | `@EventPattern('order.created')` → clear cart |
| `apps/api-gateway/**` | **deleted** | Entire project removed |
| `apps/auth-service/**` | **deleted** | After migration window |
| `nest-cli.json` | **modified** | Remove `api-gateway`, `auth-service`, `order-service` duplicate |
| `package.json` | **modified** | Remove `start:gateway`, `start:auth`; update `start:all` |
| `frontend/src/auth/keycloak.ts` | **new** | `keycloak-js` PKCE adapter |
| `frontend/public/silent-check-sso.html` | **new** | Required by `keycloak-js` |
| `context/EVENTS.md` | **new** | Catalogue of all RabbitMQ events |
| `MIGRATION.md` | **new** | User-data migration runbook |

---

## 19. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Kong: `{"message":"No credentials found for given 'iss'"}` | `iss` claim doesn't match the consumer's `key:` | Exact match required, trailing slash counts |
| Kong: `{"message":"Invalid signature"}` | Wrong PEM | Re-extract JWKS → PEM, paste again, `kong reload` |
| Service: `Invalid or expired token` even though Kong accepted it | Service's `KEYCLOAK_ISSUER` env doesn't match the JWT `iss` | Align env across all services |
| `jwks-rsa` calls Keycloak on every request | Cache disabled or `kid` rotates faster than cache | `cache: true, cacheMaxAge: 600000`, configure rate limiting |
| RabbitMQ consumer never receives events | Queue name mismatch between publisher's exchange/queue and subscriber's `queue:` option | NestJS RMQ transport defaults to using the queue name as both queue + routing; verify both sides use the same `queue:` |
| Circuit breaker stays OPEN even after upstream recovers | Health check too slow | Lower `resetTimeout` to 10s; expose `/health` endpoint and check it |
| Direct hit to `:3003` works without a token | Service not bound to private network | Bind to internal network or add an `X-Internal-Secret` header check from Kong |
| Stripe webhook hits Kong → 401 | Webhook has no JWT | Make sure `payments-webhook` route in `kong.yaml` has no `jwt` plugin; verify signature inside payment-service |
| CORS errors from SPA | Kong CORS plugin's `origins` doesn't match SPA URL | Set `origins: ['http://localhost:5173']` (or `+` on Keycloak client) |
| Slow first request after restart | `jwks-rsa` cold cache + axios connection pool warm-up | Pre-warm both at boot (call `getSigningKey` for the first `kid`, open a keep-alive connection to each peer) |
| Events processed twice | RabbitMQ redelivered after a consumer crash | Make handlers idempotent (use the event's `messageId` as a dedupe key in Redis or Postgres) |

---

## 20. References

- Kong Gateway — <https://docs.konghq.com/gateway/latest/>
- Kong DB-less / declarative — <https://docs.konghq.com/gateway/latest/production/deployment-topologies/db-less-and-declarative-config/>
- Kong `jwt` plugin — <https://docs.konghq.com/hub/kong-inc/jwt/>
- Kong `pre-function` — <https://docs.konghq.com/hub/kong-inc/pre-function/>
- decK — <https://docs.konghq.com/deck/latest/>
- Keycloak — <https://www.keycloak.org/documentation>
- Keycloak Admin REST API — <https://www.keycloak.org/docs-api/latest/rest-api/index.html>
- `keycloak-js` — <https://www.keycloak.org/securing-apps/javascript-adapter>
- NestJS microservices (RabbitMQ) — <https://docs.nestjs.com/microservices/rabbitmq>
- NestJS HTTP module — <https://docs.nestjs.com/techniques/http-module>
- Opossum circuit breaker — <https://nodeshift.dev/opossum/>
- `jwks-rsa` — <https://github.com/auth0/node-jwks-rsa>
- 12-Factor on backing services — <https://12factor.net/backing-services>
