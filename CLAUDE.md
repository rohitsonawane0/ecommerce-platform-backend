# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NestJS monorepo for an ecommerce platform using a microservices architecture. Services communicate via TCP transport (`@nestjs/microservices`). The API gateway is the single HTTP entry point (port 3000) that proxies requests to backend microservices over TCP.

## Commands

```bash
pnpm install                          # Install dependencies
pnpm run start:gateway                # Start API gateway (watch)
pnpm run start:auth                   # Start auth service (watch, TCP 3001)
pnpm run start:product                # Start product service (watch, TCP 3002)
pnpm run start:cart                   # Start cart service (watch, TCP 3003)
pnpm run start:all                    # Run gateway + auth + product + cart concurrently
nest start <project-name> --watch     # Start any service by project name
nest build <project-name>             # Build a specific service
pnpm run lint                         # ESLint with --fix
pnpm run format                       # Prettier format
pnpm test                             # All unit tests (Jest)
pnpm test -- --testPathPattern=<pat>  # Single test file/pattern
pnpm run test:e2e                     # E2E tests
docker compose up -d                  # Postgres (auth 5433, product 5435, cart 5436) + Redis (6379)
```

## Architecture

- **`apps/`** — Each microservice is a separate NestJS app; project names are declared in `nest-cli.json`.
  - **`api-gateway`** — HTTP server (Express), global prefix `api/v1`. Routes requests to backend services via `ClientsModule` TCP clients. Uses helmet, CORS, and `ValidationPipe` (whitelist + transform). Each backend service has a sub-module under `apps/api-gateway/src/<service>/` (auth, products, cart) that registers its `ClientProxy` and exposes REST controllers.
  - **`auth-service`** — TCP microservice, port 3001. Handles register, login, refresh, logout, me, forgot/reset-password, and `validateToken`. Uses Postgres (`auth_db`, port 5433) and Redis for refresh-token storage.
  - **`product-service`** — TCP microservice, port 3002. Products + categories. Postgres `product_db` on 5435.
  - **`cart-service`** — TCP microservice, port 3003. Postgres `cart_db` on 5436.
  - **`orders-service`**, **`order-service`**, **`inventory-service`**, **`payment-service`**, **`notification-service`**, **`user-service`** — Declared in `nest-cli.json` but not yet implemented. Note `nest-cli.json` has both `order-service` and `orders-service` entries; only `apps/orders-service/` exists on disk.

- **`libs/common/`** — Shared library, imported as `@app/common`. Contains:
  - **constants** — `services.ts` (service-name tokens like `AUTH_SERVICE`) and `messages.ts` (`AUTH_MESSAGES`, `PRODUCT_MESSAGES`, `CART_MESSAGES`) for type-safe TCP messaging.
  - **guards** — `AccessTokenGuard` (registered globally in the gateway via `APP_GUARD`).
  - **decorators** — `@Public()` to bypass the global auth guard, `@CurrentUser()` to extract the JWT payload.
  - **interceptors** — `ResponseInterceptor` wrapping responses as `ApiResponse<T>`.
  - **helpers**, **interface** (`JwtPayload`, `ApiResponse`), **enums**.

## Key Patterns

- **Inter-service communication**: gateway controller → `@Inject(SERVICE_NAME) ClientProxy` → `firstValueFrom(client.send(MESSAGE_PATTERN, payload))` → microservice `@MessagePattern()` handler. Both `SERVICE_NAME` and `MESSAGE_PATTERN` come from `@app/common` constants — never hardcode strings.
- **Authentication**: `AccessTokenGuard` is registered as a global `APP_GUARD` in `ApiGatewayModule`. All routes are protected by default. Annotate public routes with `@Public()` from `@app/common`. The guard verifies the JWT (using `JWT_SECRET`) and attaches the payload to `request.user`; controllers read it via `@CurrentUser()`.
- **Adding a new service**: register it in `nest-cli.json`, scaffold `apps/<service>/` with a TCP `main.ts`, add a service-name token to `libs/common/src/constants/services.ts` and message patterns to `messages.ts`, create a gateway sub-module under `apps/api-gateway/src/<service>/` that does `ClientsModule.register([{ name, transport: TCP, options: { host, port } }])`, and import it into `ApiGatewayModule`.
- **Shared code**: add to `libs/common/src/<area>/`, re-export from the area's `index.ts`, and ensure the area is exported from `libs/common/src/index.ts`. Import as `@app/common` or `@app/common/<path>`.
- **Environment**: Gateway and most services read directly from `process.env` (no `ConfigModule` wiring yet despite `@nestjs/config` being installed). Gateway port via `GATEWAY_PORT` (default 3000). Microservice TCP ports are hardcoded in both the service's `main.ts` and the gateway's `ClientsModule.register()` call — keep them in sync. JWT signing/verification uses `JWT_SECRET` (falls back to `'jwt-secret'`).
- **TypeORM**: Each service owns its own Postgres database; `synchronize: true` is enabled (dev-only). `autoLoadEntities: true` is set, so entities only need to be registered via `TypeOrmModule.forFeature([...])` in their feature modules.
- **Testing**: Unit tests are `*.spec.ts` co-located with sources. E2E tests live in `apps/<service>/test/`. Jest config is at the root `package.json`; roots are `apps/` and `libs/`, and `@app/common` is mapped via `moduleNameMapper`.

## Code Style

- Prettier: single quotes, trailing commas (`all`).
- ESLint: `@typescript-eslint/no-explicit-any` is off; floating promises and unsafe arguments are warnings.
- TypeScript: `strictNullChecks` on, `noImplicitAny` off, target ES2023, module `nodenext`.
