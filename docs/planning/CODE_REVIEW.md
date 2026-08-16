# Code Review — Ecommerce Platform Backend

> **Date:** April 4, 2026
> **Last updated:** April 4, 2026
> **Scope:** Full codebase review of the NestJS microservices monorepo

---

## Table of Contents

- [Resolved Issues](#resolved-issues)
- [P0 — Bugs (Must Fix)](#p0--bugs-must-fix)
- [P1 — Security Issues](#p1--security-issues)
- [P2 — Architecture & Design](#p2--architecture--design)
- [P3 — Code Quality & Cleanup](#p3--code-quality--cleanup)
- [Summary Table](#summary-table)

---

## Resolved Issues

These issues were identified in the initial review and have since been fixed.

### ~~1. Product search query had a typo and missing parameter binding~~ — FIXED

**File:** `apps/product-service/src/products/products.service.ts` — `findAll()`

**What was wrong:** `:seach` typo and no parameter binding in the ILIKE clause.

**What was done:** Typo corrected to `:search`, parameter binding `{ search: \`%${search}%\` }` added.

---

### ~~2. Gateway product update wasn't sending the `id` to the microservice~~ — FIXED

**File:** `apps/api-gateway/src/products/products.controller.ts` — `update()`

**What was wrong:** The `id` from `@Param('id')` was extracted but never merged into the payload.

**What was done:** Payload now spreads `{ ...updateProductDto, id }`.

---

### ~~4. Auth routes missing `@Public()` decorator~~ — FIXED

**File:** `apps/api-gateway/src/auth/auth.controller.ts`

**What was wrong:** `refresh`, `forgot-password`, and `reset-password` were behind the global `AccessTokenGuard` despite being flows for unauthenticated users.

**What was done:** `@Public()` decorator added to all three endpoints.

---

### ~~6. Auth service spec imported deleted strategy files~~ — FIXED

**File:** `apps/auth-service/src/auth/auth.service.spec.ts`

**What was wrong:** Imports for `LocalStrategy` and `JwtRefreshStrategy` referenced deleted files.

**What was done:** Deleted imports and their provider entries removed. Only `JwtStrategy` remains.

---

### ~~21. Stale project entries in `nest-cli.json`~~ — FIXED

**File:** `nest-cli.json`

**What was wrong:** `nest-cli.json` had phantom entries for `inventory-service`, `notification-service`, `order-service`, `payment-service`, and `user-service`.

**What was done:** The missing services (`orders-service`, `payment-service`, `user-service`) have now been implemented. The remaining phantom entries (`inventory-service`, `notification-service`) have been removed from the file.

---

## P0 — Bugs (Must Fix)

### 3. `softDelete` — `CategoriesService` still passes entity object instead of ID

**File:** `apps/product-service/src/categories/categories.service.ts` — `remove()`

**Status:** Partially fixed. Both entities now have `@DeleteDateColumn` and `ProductsService.remove()` correctly passes the `id`. However, `CategoriesService.remove()` still passes the full entity object.

```typescript
// CURRENT (still broken in categories)
async remove(id: string) {
  const category = await this.findOne(id);
  await this.categoryRepository.softDelete(category);  // should be `id`, not `category`
}

// FIXED
async remove(id: string) {
  await this.findOne(id); // verify it exists
  await this.categoryRepository.softDelete(id);
}
```

**Impact:** Category delete will throw a TypeORM error at runtime because `softDelete()` expects a string ID or `FindOptionsWhere`, not an entity object.

---

### 5. `AccessTokenGuard` — missing token still returns `false` instead of throwing, unused import

**File:** `libs/common/src/guards/access-token.guard.ts`

**Status:** Partially fixed. The `catch` block now correctly throws `UnauthorizedException` and the unreachable `return true` was removed. Two issues remain:

1. **`if (!token)` on line 28-29 still returns `false`** instead of throwing `UnauthorizedException`. This produces a generic 403 with no message when the Authorization header is missing, while an expired/invalid token gets a clear 401. Inconsistent behavior.

2. **`Observable` is still imported on line 8 but never used.**

```typescript
// CURRENT
import { Observable } from 'rxjs'; // unused — remove this import

// ...
if (!token) {
  return false; // produces generic 403
}

// FIXED
if (!token) {
  throw new UnauthorizedException('Missing access token');
}
```

---

## P1 — Security Issues

### 7. Token blacklist is not checked at the gateway

**Files:**

- `libs/common/src/guards/access-token.guard.ts` (gateway-side)
- `apps/auth-service/src/auth/auth.service.ts` — `validateToken()`

**Problem:** The gateway's `AccessTokenGuard` verifies the JWT signature locally using `JwtService.verifyAsync()`, but it never checks whether the token has been blacklisted in Redis. The auth-service maintains a Redis blacklist (`bl:<token>`) for logged-out and rotated tokens, and has a `validateToken()` method that checks it — but the gateway never calls it.

This means: a user logs out → the token is added to the Redis blacklist → the token **still works** at the gateway until it naturally expires.

**Fix options (pick one):**

| Option | Approach | Trade-off |
|--------|----------|-----------|
| A | Gateway calls auth-service `validateToken` via TCP on every request | Adds ~2-5ms latency per request |
| B | Give the gateway a direct Redis connection and check `bl:<token>` | Faster, but couples gateway to Redis |
| C | Use short-lived access tokens (e.g. 2-5 min) and accept the window | Simplest, but revocation has a delay |

**Impact:** Revoked tokens remain valid at the gateway. Users who log out or have their tokens rotated can still access protected resources.

---

### 8. Hardcoded JWT secret fallback in multiple files

**Files:**

- `apps/api-gateway/src/api-gateway.module.ts`
- `apps/auth-service/src/auth/auth.service.ts`
- `apps/auth-service/src/auth/strategies/jwt.strategy.ts`
- `libs/common/src/guards/access-token.guard.ts`

**Problem:** Every file that deals with JWT uses the pattern:

```typescript
secret: process.env.JWT_SECRET || 'jwt-secret'
```

If the `JWT_SECRET` environment variable isn't set, the application silently falls back to the literal string `'jwt-secret'` — a value that's in version control and easily guessable. In production, this would allow anyone to forge valid tokens.

**Recommendation:**

- Use `@nestjs/config` with validation to **fail on startup** if `JWT_SECRET` is missing.
- Centralize the secret in one config module rather than repeating the fallback in 4+ files.

---

### 9. CORS allows all origins

**File:** `apps/api-gateway/src/main.ts`

```typescript
app.enableCors({
  origin: '*',
});
```

This is acceptable during local development but should be restricted to specific origins before any deployment. Consider making it environment-driven:

```typescript
app.enableCors({
  origin: process.env.CORS_ORIGIN?.split(',') || 'http://localhost:3000',
});
```

---

### 10. No `.env.example` file

**Problem:** A `.env` file exists with database credentials, JWT secrets, and Redis config, but there's no `.env.example` to guide other developers. Also verify that `.env` is listed in `.gitignore` — committing real secrets (even dev ones) sets a bad precedent.

**Recommendation:** Create `.env.example` with placeholder values and comments.

---

## P2 — Architecture & Design

### 11. Duplicated DTOs across gateway and microservices

**Problem:** Many DTOs are fully duplicated between the gateway and their respective microservice:

| DTO | Gateway copy | Microservice copy |
|-----|-------------|-------------------|
| `RegisterDto` | `apps/api-gateway/src/auth/dto/register.dto.ts` | `apps/auth-service/src/auth/dto/register.dto.ts` |
| `LoginDto` | `apps/api-gateway/src/auth/dto/login.dto.ts` | `apps/auth-service/src/auth/dto/login.dto.ts` |
| `ForgotPasswordDto` | `apps/api-gateway/src/auth/dto/forgot-password.dto.ts` | `apps/auth-service/src/auth/dto/forgot-password.dto.ts` |
| `ResetPasswordDto` | `apps/api-gateway/src/auth/dto/reset-password.dto.ts` | `apps/auth-service/src/auth/dto/reset-password.dto.ts` |
| `CreateProductDto` | `apps/api-gateway/src/products/dto/create-product.dto.ts` | `apps/product-service/src/products/dto/create-product.dto.ts` |
| `CreateCategoryDto` | `apps/api-gateway/src/products/categories/dto/create-category.dto.ts` | `apps/product-service/src/categories/dto/create-category.dto.ts` |

**Risk:** Changes to one copy won't be reflected in the other, leading to silent validation mismatches.

**Recommendation:** Move shared DTOs to `libs/common/src/dto/` and import from `@app/common`. Keep gateway-only DTOs (query params, request-specific transformations) in the gateway.

---

### 12. `generateSlug` is duplicated

**Files:**

- `apps/product-service/src/products/products.service.ts`
- `apps/product-service/src/categories/categories.service.ts`

Both contain an identical `generateSlug` private method with the same slugify options. Extract this to `libs/common/src/helpers/slug.helper.ts`:

```typescript
import slugify from 'slugify';

export function generateSlug(name: string): string {
  return slugify(name, { lower: true, trim: true });
}
```

---

### 13. Response wrapping may double-wrap

**Problem:** Two mechanisms exist for wrapping responses:

1. **`ResponseHelper.success()`** — called explicitly in every microservice controller method.
2. **`ResponseInterceptor`** — an interceptor in `libs/common` that wraps any response not already wrapped.

If `ResponseInterceptor` is applied globally (or to the gateway), and the microservice already wraps with `ResponseHelper`, the response could be double-wrapped:

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "success": true,
    "message": "Product created successfully",
    "data": { ... }
  }
}
```

The interceptor does check `data?.success !== undefined && data?.message !== undefined` to avoid this, but it's fragile — any response data that happens to have both `success` and `message` fields would bypass wrapping.

**Recommendation:** Pick one approach. Using the interceptor globally is cleaner — remove `ResponseHelper` calls from individual controllers.

---

### 14. `logout` endpoint is a no-op

**File:** `apps/api-gateway/src/auth/auth.controller.ts`

```typescript
@Post('logout')
logout(@CurrentUser() user: JwtPayload) {
  // return firstValueFrom(
  //   this.authClient.send(AUTH_MESSAGES.LOGOUT, { accessToken: token }),
  // );
}
```

The entire RPC call is commented out. The endpoint returns nothing and doesn't actually invalidate the token. The auth-service has a working `logout()` method that blacklists the token — it just needs to be wired up.

---

### 15. `findOne` product doesn't load relations

**File:** `apps/product-service/src/products/products.service.ts`

```typescript
async findOne(id: string) {
  const product = await this.productRepository.findOneBy({ id });
  // ...
}
```

`findOneBy` doesn't load relations. The `create` method returns products with categories loaded, but `findOne` returns products without categories. This gives consumers an inconsistent API shape.

**Fix:**

```typescript
async findOne(id: string) {
  const product = await this.productRepository.findOne({
    where: { id },
    relations: ['categories'],
  });
  // ...
}
```

---

### 16. `@IsAlpha` on category name is too restrictive

**File:** `apps/product-service/src/categories/dto/create-category.dto.ts`

```typescript
@IsAlpha()
@MaxLength(50)
name: string;
```

`@IsAlpha()` only allows letters (a-z, A-Z). Category names like "T-Shirts", "Home & Garden", or "Electronics 2024" would be rejected. Consider using `@Matches(/^[\w\s&-]+$/i)` or just `@IsString()` with `@MaxLength()`.

---

### 17. Contradictory validation on category `description`

**File:** `apps/product-service/src/categories/dto/create-category.dto.ts`

```typescript
@IsString()
@IsNotEmpty()
@MaxLength(250)
@IsOptional()
description: string;
```

`@IsOptional()` + `@IsNotEmpty()` means: "you can omit the field entirely, but if you include it, it cannot be an empty string." This might be intentional — if so, document it. If not, remove `@IsNotEmpty()`.

---

## P3 — Code Quality & Cleanup

### 18. Dead and empty files

| File | Issue |
|------|-------|
| ~~`apps/product-service/src/products/dto/create-category.dto.ts`~~ | ~~Completely empty (0 bytes)~~ — **FIXED (deleted)** |
| `apps/api-gateway/src/products/categories/categories.module.ts` | Exists but unused — controllers are registered directly in `ProductsModule` |
| `apps/product-service/src/product-service.controller.ts` | Default scaffold — not part of the microservice architecture |
| `apps/product-service/src/product-service.service.ts` | Default scaffold with a `getHello()` method |
| `libs/common/src/common.module.ts` | Empty scaffold module |
| `libs/common/src/common.service.ts` | Scaffold service with no real logic |

Delete or repurpose these files to reduce confusion.

---

### 19. `console.log` in production code

**Files:**

- `apps/api-gateway/src/products/products.controller.ts` line 34: `console.log(query)`
- `apps/auth-service/src/auth/auth.service.ts` line 132: `console.log(...)` (password reset stub)

Replace with NestJS's built-in `Logger`:

```typescript
private readonly logger = new Logger(ProductsController.name);

// Then use:
this.logger.debug('Query params', query);
```

---

### 20. All tests are boilerplate stubs

Every `*.spec.ts` file in the project follows this pattern:

```typescript
it('should be defined', () => {
  expect(controller).toBeDefined();
});
```

Several won't even compile because they don't provide required dependencies (e.g., `ProductsController` spec doesn't mock `PRODUCT_SERVICE`). These tests provide zero value and give false confidence.

**Recommendation:**

- Fix compilation errors in existing specs.
- Add meaningful tests for business logic (e.g., `AuthService.register()`, `ProductsService.create()`).
- Or remove the stubs and add tests when you're ready to write real ones.

---

### 22. Minor code noise

| File | Issue |
|------|-------|
| `apps/api-gateway/src/auth/auth.module.ts` line 19 | Stray `//d` comment |
| `apps/api-gateway/src/api-gateway.module.ts` line 9 | Commented-out import (`CategoriesModule`) |
| `apps/api-gateway/src/products/dto/create-product.dto.ts` | Emoji comments (`// 🔥`) |
| `.env` line 16 | Comment says "port 5434" but value is `5435` |

---

### 23. `libs/common/src/index.ts` doesn't re-export guards

**File:** `libs/common/src/index.ts`

The barrel file re-exports decorators, helpers, interceptors, and interfaces — but not guards. This forces consumers to use the deep import path `@app/common/guards/access-token.guard` instead of `@app/common`. Add:

```typescript
export * from './guards';
```

(and create `libs/common/src/guards/index.ts` if it doesn't exist.)

---

## Summary Table

| # | Issue | Priority | Status | Effort | Category |
|---|-------|----------|--------|--------|----------|
| 1 | Search query typo + missing param binding | P0 | **FIXED** | — | Bug |
| 2 | Update endpoint doesn't send `id` | P0 | **FIXED** | — | Bug |
| 3 | `softDelete` — `CategoriesService` still passes entity | **P0** | Partial | 5 min | Bug |
| 4 | Auth routes missing `@Public()` | P0 | **FIXED** | — | Bug |
| 5 | `AccessTokenGuard` — missing token returns false, unused import | **P0** | Partial | 5 min | Bug |
| 6 | Spec imports deleted strategy files | P0 | **FIXED** | — | Bug |
| 7 | Token blacklist not checked at gateway | **P1** | Open | 30 min | Security |
| 8 | Hardcoded JWT secret fallback | **P1** | Open | 20 min | Security |
| 9 | CORS allows all origins | **P1** | Open | 5 min | Security |
| 10 | No `.env.example` | **P1** | Open | 5 min | Security |
| 11 | Duplicated DTOs | **P2** | Open | 1 hr | Architecture |
| 12 | Duplicated `generateSlug` | **P2** | Open | 15 min | Architecture |
| 13 | Response double-wrapping risk | **P2** | Open | 30 min | Architecture |
| 14 | `logout` is a no-op | **P2** | Open | 10 min | Architecture |
| 15 | `findOne` doesn't load relations | **P2** | Open | 5 min | Architecture |
| 16 | `@IsAlpha` too restrictive for categories | **P2** | Open | 5 min | Architecture |
| 17 | Contradictory DTO validation | **P2** | Open | 5 min | Architecture |
| 18 | Dead / empty files | **P3** | Partial | 10 min | Cleanup |
| 19 | `console.log` in production code | **P3** | Open | 10 min | Cleanup |
| 20 | Boilerplate test stubs | **P3** | Open | ongoing | Cleanup |
| 21 | Stale `nest-cli.json` entries | P3 | **FIXED** | — | Cleanup |
| 22 | Minor code noise (comments, typos) | **P3** | Open | 10 min | Cleanup |
| 23 | Guards not re-exported from barrel | **P3** | Open | 5 min | Cleanup |

**Progress: 6 fully resolved, 2 partially resolved, 15 open.**
