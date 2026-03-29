# API Gateway

**Type:** HTTP Server (Express, port 3000)
**Prefix:** `api/v1`
**Status:** Existing -- needs new modules (product, cart) and JWT auth guard

## Role

Single HTTP entry point for all client requests. Proxies to backend microservices via TCP. Handles:

- HTTP routing and request validation
- JWT authentication (guard)
- Role-based authorization (admin vs user)
- CORS, helmet, global validation pipe

## Auth Guard

### JWT Auth Guard (`guards/jwt-auth.guard.ts`)

- Extracts Bearer token from `Authorization` header
- Sends token to auth-service via TCP (`AUTH_MESSAGES.VALIDATE_TOKEN`)
- Auth-service validates token, checks Redis blacklist, returns user payload
- Guard attaches user (`{ id, email, role }`) to `request.user`
- Throws `UnauthorizedException` if token is invalid/expired/blacklisted

### Role Guard (`guards/roles.guard.ts`)

- Custom `@Roles('admin')` decorator
- Checks `request.user.role` against required roles
- Used on product/category create, update, delete endpoints

## Route Modules

### Auth Routes (`/api/v1/auth`)

Enhance existing `apps/api-gateway/src/auth/auth.controller.ts`:

```
POST   /register          -- public, proxy to AUTH_MESSAGES.REGISTER
POST   /login             -- public, proxy to AUTH_MESSAGES.LOGIN
POST   /refresh           -- public, proxy to AUTH_MESSAGES.REFRESH
POST   /logout            -- @UseGuards(JwtAuthGuard), proxy to AUTH_MESSAGES.LOGOUT
GET    /me                -- @UseGuards(JwtAuthGuard), proxy to AUTH_MESSAGES.ME
POST   /forgot-password   -- public, proxy to AUTH_MESSAGES.FORGOT_PASSWORD
POST   /reset-password    -- public, proxy to AUTH_MESSAGES.RESET_PASSWORD
```

### Product Routes (`/api/v1/products`)

New module: `apps/api-gateway/src/product/`

```
GET    /                  -- public, proxy to PRODUCT_MESSAGES.FIND_ALL (query params for search/filter/pagination)
GET    /:id               -- public, proxy to PRODUCT_MESSAGES.FIND_ONE
POST   /                  -- @UseGuards(JwtAuthGuard, RolesGuard) @Roles('admin'), proxy to PRODUCT_MESSAGES.CREATE
PATCH  /:id               -- @UseGuards(JwtAuthGuard, RolesGuard) @Roles('admin'), proxy to PRODUCT_MESSAGES.UPDATE
DELETE /:id               -- @UseGuards(JwtAuthGuard, RolesGuard) @Roles('admin'), proxy to PRODUCT_MESSAGES.REMOVE
```

### Category Routes (`/api/v1/categories`)

Part of product module or separate controller:

```
GET    /                  -- public, proxy to CATEGORY_MESSAGES.FIND_ALL
GET    /:id               -- public, proxy to CATEGORY_MESSAGES.FIND_ONE
POST   /                  -- @UseGuards(JwtAuthGuard, RolesGuard) @Roles('admin'), proxy to CATEGORY_MESSAGES.CREATE
PATCH  /:id               -- @UseGuards(JwtAuthGuard, RolesGuard) @Roles('admin'), proxy to CATEGORY_MESSAGES.UPDATE
DELETE /:id               -- @UseGuards(JwtAuthGuard, RolesGuard) @Roles('admin'), proxy to CATEGORY_MESSAGES.REMOVE
```

### Cart Routes (`/api/v1/cart`)

New module: `apps/api-gateway/src/cart/`

```
GET    /                  -- @UseGuards(JwtAuthGuard), proxy to CART_MESSAGES.GET_CART
POST   /items             -- @UseGuards(JwtAuthGuard), proxy to CART_MESSAGES.ADD_ITEM
PATCH  /items/:id         -- @UseGuards(JwtAuthGuard), proxy to CART_MESSAGES.UPDATE_ITEM
DELETE /items/:id         -- @UseGuards(JwtAuthGuard), proxy to CART_MESSAGES.REMOVE_ITEM
DELETE /                  -- @UseGuards(JwtAuthGuard), proxy to CART_MESSAGES.CLEAR_CART
```

## Files to Create/Modify

- `apps/api-gateway/src/guards/jwt-auth.guard.ts`
- `apps/api-gateway/src/guards/roles.guard.ts`
- `apps/api-gateway/src/decorators/roles.decorator.ts`
- `apps/api-gateway/src/decorators/current-user.decorator.ts`
- `apps/api-gateway/src/auth/auth.controller.ts` -- rewrite with all auth endpoints
- `apps/api-gateway/src/auth/auth.module.ts` -- already has TCP client
- `apps/api-gateway/src/product/product.module.ts` -- TCP client to product-service
- `apps/api-gateway/src/product/product.controller.ts` -- product HTTP routes
- `apps/api-gateway/src/product/category.controller.ts` -- category HTTP routes
- `apps/api-gateway/src/cart/cart.module.ts` -- TCP client to cart-service
- `apps/api-gateway/src/cart/cart.controller.ts` -- cart HTTP routes
- `apps/api-gateway/src/api-gateway.module.ts` -- import new modules

## TCP Client Registration

Each module registers its TCP client using constants from `@app/common`:

```typescript
ClientsModule.register([
  { name: AUTH_SERVICE, transport: Transport.TCP, options: { host: 'localhost', port: 3001 } },
  { name: PRODUCT_SERVICE, transport: Transport.TCP, options: { host: 'localhost', port: 3002 } },
  { name: CART_SERVICE, transport: Transport.TCP, options: { host: 'localhost', port: 3003 } },
])
```
