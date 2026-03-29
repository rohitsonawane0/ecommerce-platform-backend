# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NestJS monorepo for an ecommerce platform using a microservices architecture. Services communicate via TCP transport (`@nestjs/microservices`). The API gateway is the single HTTP entry point (port 3000) that proxies requests to backend microservices.

## Commands

```bash
pnpm install                          # Install dependencies
pnpm run start:gateway                # Start API gateway (watch mode)
pnpm run start:auth                   # Start auth service (watch mode)
pnpm run start:all                    # Start gateway + auth concurrently
nest start <project-name> --watch     # Start any service by project name
nest build <project-name>             # Build a specific service
pnpm run lint                         # ESLint with auto-fix
pnpm run format                       # Prettier format
pnpm test                             # Run all unit tests
pnpm test -- --testPathPattern=<pat>  # Run a single test file
pnpm run test:e2e                     # Run e2e tests
docker compose up -d                  # Start Postgres (auth on 5433, product on 5434) and Redis (6379)
```

## Architecture

- **`apps/`** — Each microservice is a separate NestJS app. Project names are defined in `nest-cli.json`.
  - **`api-gateway`** — HTTP server (Express), global prefix `api/v1`. Routes requests to microservices via `ClientsModule` TCP clients. Uses helmet, CORS, and `ValidationPipe` (whitelist + transform). Each backend service gets its own sub-module in the gateway (e.g., `apps/api-gateway/src/auth/`).
  - **`auth-service`** — TCP microservice on port 3001. Handles authentication (register, login, JWT, password reset). Has nested `auth/` feature module with DTOs, entities, and strategies.
  - **`product-service`**, **`cart-service`** — Scaffolded but minimal (placeholder HTTP apps, not yet converted to TCP microservices).
  - **`inventory-service`**, **`order-service`**, **`payment-service`**, **`notification-service`**, **`user-service`** — Defined in `nest-cli.json` but not yet scaffolded.

- **`libs/common/`** — Shared library, imported as `@app/common`. Contains:
  - Service name constants (`AUTH_SERVICE`, `CART_SERVICE`, etc.) used for `ClientsModule` registration.
  - Message pattern constants (e.g., `AUTH_MESSAGES`) for type-safe microservice messaging.

## Key Patterns

- **Inter-service communication flow**: Gateway REST controller → `@Inject(SERVICE_NAME)` ClientProxy → `firstValueFrom(client.send(MESSAGE_PATTERN, payload))` → microservice `@MessagePattern()` handler. Message pattern strings and service names come from `@app/common` constants.
- **Adding a new service**: Define it in `nest-cli.json`, create `apps/<service-name>/`, add its service constant to `libs/common/src/constants/services.ts`, add message constants to `libs/common/src/constants/messages.ts`, create a gateway sub-module in `apps/api-gateway/src/<service>/` with `ClientsModule.register()`, and set up `@MessagePattern()` handlers in the new service.
- **Shared code**: Add to `libs/common/src/` and re-export from `libs/common/src/index.ts`. Import as `@app/common` or `@app/common/<path>`.
- **Environment**: Uses `process.env` directly (no `@nestjs/config` in gateway yet). Gateway port via `GATEWAY_PORT` env var (default 3000). Microservice TCP ports are hardcoded in both the service's `main.ts` and the gateway's client registration.
- **Testing**: Unit tests use `*.spec.ts` co-located with source. E2E tests live in `apps/<service>/test/app.e2e-spec.ts`. Jest is configured at root `package.json` with roots in `apps/` and `libs/`. Module path alias `@app/common` is mapped in Jest's `moduleNameMapper`.

## Code Style

- Prettier: single quotes, trailing commas (`all`)
- ESLint: `@typescript-eslint/no-explicit-any` is off, floating promises and unsafe arguments are warnings
- TypeScript: `strictNullChecks` enabled, `noImplicitAny` disabled, target ES2023, module `nodenext`
