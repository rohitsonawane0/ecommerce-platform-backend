# Shared DTOs in `libs/common` — Architecture Decision

## Context

In a NestJS microservices monorepo, multiple apps need to agree on the shape of
data exchanged between them. For example, when the API gateway forwards a
registration request to the auth-service, both sides must understand the fields,
types, and validation rules of that request.

## Problem

Without a single source of truth, DTOs end up duplicated across apps:

```
apps/
  api-gateway/src/auth/dto/register.dto.ts   ← copy A
  auth-service/src/auth/dto/register.dto.ts  ← copy B
```

This causes:

1. **Silent drift** — A developer updates the password minimum length in
   auth-service but forgets to update the gateway. The gateway accepts passwords
   that the auth-service rejects, producing confusing 500 errors instead of
   clean 400 validation errors.

2. **Duplicated maintenance** — Every field addition, rename, or validation
   change must be applied in multiple places. With N services consuming the same
   DTO, that means N edits instead of one.

3. **Inconsistent validation** — The gateway might validate email format while
   the auth-service checks password strength. Without a shared DTO, there is no
   guarantee both sides enforce the same rules.

## Decision

Store DTOs that represent inter-service message contracts in `libs/common/src/dto/`.
Both the gateway and backend microservices import them via the `@app/common` alias.

### Directory structure

```
libs/common/src/
  dto/
    auth/
      register.dto.ts
      login.dto.ts
      forgot-password.dto.ts
      reset-password.dto.ts
      refresh-token.dto.ts
      index.ts
    index.ts              ← re-exports all dto barrels
  constants/
  enums/
  index.ts                ← adds `export * from './dto'`
```

### Usage

```typescript
// In api-gateway controller
import { RegisterDto } from '@app/common';

@Post('register')
register(@Body() dto: RegisterDto) { ... }
```

```typescript
// In auth-service message handler
import { RegisterDto } from '@app/common';

@MessagePattern(AUTH_MESSAGES.REGISTER)
register(@Payload() dto: RegisterDto) { ... }
```

## Why this is NOT tight coupling

A common objection is: "Doesn't sharing DTOs couple the gateway to the
auth-service?"

**No.** The DTO is the contract between them, not an implementation detail.

| Concept           | Example                        | Is it coupling? |
|-------------------|--------------------------------|-----------------|
| Shared contract   | `RegisterDto` field shapes     | No — both sides must agree on this regardless |
| Shared interface  | `AUTH_MESSAGES` constants       | No — same reason, already in `@app/common` |
| Shared internals  | Importing `AuthService` class  | **Yes** — ties consumer to implementation |
| Shared entity     | Importing `User` entity        | **Yes** — ties consumer to DB schema |

The gateway does not know *how* the auth-service processes the DTO. It only
knows *what* shape to send. This is equivalent to a protobuf definition or an
OpenAPI schema — a shared interface, not a shared implementation.

## Why NOT skip gateway validation and validate only in the microservice

An alternative is to use `any` at the gateway and let the microservice validate:

```typescript
// Seems simpler, but has problems
@Post('register')
register(@Body() body: any) {
  return firstValueFrom(this.authClient.send(AUTH_MESSAGES.REGISTER, body));
}
```

Problems with this approach:

1. **Wasted network hops** — Invalid requests travel over TCP to the
   microservice, get rejected, and travel back. Validation at the gateway
   catches bad input before it ever hits the network.

2. **Broken error responses** — Microservice validation throws `RpcException`,
   which the gateway must translate back to HTTP 400 with field-level errors.
   Without custom exception filters, the client receives a generic 500.

3. **No whitelisting** — The gateway's `ValidationPipe` is configured with
   `whitelist: true` and `forbidNonWhitelisted: true`, which strips or rejects
   unknown fields. With `any` as the type, there is no class to whitelist
   against, so arbitrary fields pass straight through.

4. **No API documentation** — Swagger/OpenAPI decorators (`@ApiBody`,
   `@ApiProperty`) require a DTO class. Using `any` produces undocumented
   endpoints.

5. **No type safety** — IDE autocompletion, refactoring tools, and compile-time
   checks are lost.

## When to keep a DTO in an individual app

Not all DTOs belong in `libs/common`. Keep a DTO local when:

- It is **unique to one app** (e.g., a gateway-only query param DTO that the
  microservice never sees)
- It **extends** a shared DTO with app-specific fields
- It represents an **internal concern** (e.g., an intermediate transformation
  shape inside a service)

## Summary

| Approach | Duplication | Drift risk | Validation consistency | Type safety |
|----------|-------------|------------|------------------------|-------------|
| DTOs in each app (duplicated) | High | High | Low | Partial |
| DTOs only in microservice (`any` at gateway) | None | None | One-sided | None at gateway |
| **DTOs in `libs/common` (shared)** | **None** | **None** | **Full** | **Full** |
