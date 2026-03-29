# Architecture Overview

## Overview

NestJS monorepo with 4 microservices communicating via TCP transport. The API Gateway is the single HTTP entry point (port 3000, prefix `api/v1`) that proxies requests to backend services. Each service has its own Postgres database. Redis is used for JWT token blacklisting.

## Service Map

```
[Client]
   │ HTTP
   ▼
[API Gateway :3000] ──TCP──► [Auth Service :3001] ──► [Postgres auth_db :5433]
   │                                │
   │                                └──► [Redis :6379 (token blacklist)]
   │
   ├──TCP──► [Product Service :3002] ──► [Postgres product_db :5434]
   │                  ▲
   │                  │ TCP (stock validation)
   │                  │
   └──TCP──► [Cart Service :3003] ──► [Postgres cart_db :5435]
```

## Communication Patterns

- **Gateway → Services:** TCP via `@nestjs/microservices` `ClientProxy.send()` with message patterns
- **Cart → Product:** TCP client for stock validation before adding items
- **Auth guard:** Gateway validates JWT tokens by calling auth-service before proxying protected routes
- **Message constants:** Defined in `libs/common/src/constants/messages.ts` for type-safe patterns

## Build Order

Services must be built in dependency order:

1. **Shared library** (`libs/common`) -- constants, types, DTOs used by all services
2. **Infrastructure** -- docker-compose, scripts, env config
3. **Auth service** -- other services depend on JWT validation
4. **Gateway auth** -- JWT guard needed before protected routes
5. **Product service** -- cart depends on stock checks
6. **Gateway product** -- wire product HTTP routes
7. **Cart service** -- depends on product-service for stock validation
8. **Gateway cart** -- wire cart HTTP routes

## API Endpoints Summary

```
Auth     POST /api/v1/auth/register, login, refresh, logout, forgot-password, reset-password
         GET  /api/v1/auth/me

Products GET  /api/v1/products          (public, search/filter/paginate)
         GET  /api/v1/products/:id       (public)
         POST/PATCH/DELETE              (admin only)

Categories GET  /api/v1/categories       (public)
           POST/PATCH/DELETE            (admin only)

Cart     GET    /api/v1/cart             (authenticated)
         POST   /api/v1/cart/items       (authenticated)
         PATCH  /api/v1/cart/items/:id   (authenticated)
         DELETE /api/v1/cart/items/:id   (authenticated)
         DELETE /api/v1/cart             (authenticated, clear)
```
