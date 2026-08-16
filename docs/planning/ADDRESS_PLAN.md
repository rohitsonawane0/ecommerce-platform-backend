# Address Feature — Implementation Plan

Add user-managed shipping/billing addresses so customers can save multiple addresses, mark a default, and pick one at checkout instead of re-typing every order.

---

## 1. Goal & Scope

**In scope**
- A user can create, list, update, delete addresses.
- A user can mark one address as the default shipping address (and one as default billing).
- The orders service can fetch a saved address by `addressId` when creating an order.
- Address validation (basic shape, country code, postal code format).

**Out of scope (for v1)**
- Real address autocomplete (Google Places / Loqate) — leave a hook but don't implement.
- Tax-jurisdiction lookup — orders service can layer that later.
- Address book sharing across accounts.

---

## 2. Where It Lives

The address feature belongs to the **`user-service`** (declared in `nest-cli.json`, not yet implemented). Reasons:

- Addresses are **per-user profile data**, not per-order. Orders snapshot the address at purchase time.
- Keeps the `auth-service` focused on credentials only.
- The `orders-service` consumes addresses but does not own them.

If `user-service` won't be built in this sprint, the fallback is a thin **`addresses` module inside `auth-service`** (since it already owns the user table). Mark this as a known shortcut to migrate later.

> **Decision needed:** scaffold `user-service` now, or land addresses inside `auth-service` first? Default to `user-service` if we're touching that scaffolding anyway.

---

## 3. Data Model

### `addresses` table (Postgres, owned by user-service)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `userId` | `uuid` (indexed) | FK reference; no cross-DB FK constraint (microservices) |
| `label` | `varchar(50)` | "Home", "Office", optional |
| `fullName` | `varchar(120)` | required |
| `phone` | `varchar(30)` | required for shipping |
| `line1` | `varchar(200)` | required |
| `line2` | `varchar(200)` | nullable |
| `city` | `varchar(100)` | required |
| `state` | `varchar(100)` | required (or province) |
| `postalCode` | `varchar(20)` | required |
| `country` | `char(2)` | ISO-3166-1 alpha-2 |
| `isDefaultShipping` | `boolean` | default `false` |
| `isDefaultBilling` | `boolean` | default `false` |
| `createdAt` / `updatedAt` | `timestamptz` | TypeORM `@CreateDateColumn` etc. |

**Constraints**
- Composite index `(userId, isDefaultShipping)` partial `WHERE isDefaultShipping = true` to enforce one default per user (optional — easier to enforce in service layer).
- Soft delete (`deletedAt`) so historical orders can still resolve the snapshot reference — actually, prefer **snapshot at order-creation** and allow hard delete here.

---

## 4. API Surface (via API Gateway)

All routes protected by `AccessTokenGuard`. User extracted via `@CurrentUser()`.

| Method | Path | Purpose |
|---|---|---|
| `POST`   | `/api/v1/addresses` | Create a new address |
| `GET`    | `/api/v1/addresses` | List current user's addresses |
| `GET`    | `/api/v1/addresses/:id` | Fetch one (must belong to user) |
| `PATCH`  | `/api/v1/addresses/:id` | Update fields |
| `DELETE` | `/api/v1/addresses/:id` | Delete |
| `POST`   | `/api/v1/addresses/:id/default` | Set as default (body: `{ type: "shipping" \| "billing" }`) |

### Request DTO — Create/Update

```ts
class AddressDto {
  label?: string;
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;          // ISO-3166-1 alpha-2, validated with @Length(2,2)
  isDefaultShipping?: boolean;
  isDefaultBilling?: boolean;
}
```

Use `class-validator` decorators (`@IsString`, `@Length`, `@Matches`, `@IsISO31661Alpha2`).

### Response shape

Wrapped by the existing `ResponseInterceptor`:
```json
{ "success": true, "statusCode": 200, "data": { ...address }, "message": "..." }
```

---

## 5. Service Layer — Key Behaviors

1. **Set default** is transactional: when setting an address as default, unset the previous default in the same TX.
2. **Delete a default** address: clear the default flag; if other addresses exist, optionally promote the most recently updated one.
3. **List** returns default(s) first, then by `updatedAt DESC`.
4. **Ownership check** on every read/update/delete — reject 403/404 if `address.userId !== currentUser.userId`.

---

## 6. Inter-service Contract (TCP)

Add message patterns to `libs/common/src/constants/messages.ts`:

```ts
export const ADDRESS_MESSAGES = {
  CREATE: 'address.create',
  LIST: 'address.list',
  GET: 'address.get',
  UPDATE: 'address.update',
  DELETE: 'address.delete',
  SET_DEFAULT: 'address.setDefault',
  // consumed by orders-service:
  GET_FOR_ORDER: 'address.getForOrder', // returns full snapshot, ignores ownership? no — pass userId
} as const;
```

Add `USER_SERVICE` token to `libs/common/src/constants/services.ts` and register a TCP client in the gateway (`apps/api-gateway/src/addresses/`). The orders-service also injects `USER_SERVICE` to fetch the chosen address when creating an order.

**Order-creation flow update**: orders-service receives `shippingAddressId` + `billingAddressId`, calls `USER_SERVICE.send(GET_FOR_ORDER, { userId, addressId })`, **snapshots** the returned object into the order row (so later edits/deletes don't mutate historical orders).

---

## 7. File Layout

```
apps/user-service/
  src/
    main.ts                        # TCP bootstrap on port 3004
    user-service.module.ts
    addresses/
      address.entity.ts
      address.module.ts
      address.controller.ts        # @MessagePattern handlers
      address.service.ts
      dto/
        create-address.dto.ts
        update-address.dto.ts
        set-default.dto.ts
      address.service.spec.ts

apps/api-gateway/src/addresses/
  addresses.module.ts              # ClientsModule.register USER_SERVICE
  addresses.controller.ts          # REST → ClientProxy.send

libs/common/src/constants/
  messages.ts                      # + ADDRESS_MESSAGES
  services.ts                      # + USER_SERVICE
```

Update `nest-cli.json` if `user-service` entry isn't already correct, and `docker-compose.yaml` for `user_db` on a new port (e.g. **5437**).

---

## 8. Implementation Steps (in order)

1. **Constants** — add `USER_SERVICE` token + `ADDRESS_MESSAGES` to `@app/common`. Re-export.
2. **Scaffold `user-service`** — `nest g app user-service`, convert `main.ts` to TCP (port 3004), add Postgres config (db `user_db`, port 5437), update `docker-compose.yaml`.
3. **Entity + module** — create `Address` entity, register via `TypeOrmModule.forFeature([Address])`.
4. **Service** — CRUD + `setDefault` (transactional) + `getForOrder` (used by orders-service).
5. **Microservice controller** — `@MessagePattern` handlers calling the service.
6. **Gateway sub-module** — `addresses.module.ts` with `ClientsModule.register([{ name: USER_SERVICE, transport: Transport.TCP, options: { host, port: 3004 } }])`. Import into `ApiGatewayModule`.
7. **Gateway REST controller** — six routes from §4, each calling `firstValueFrom(client.send(MESSAGE, payload))`.
8. **Wire orders-service** — inject `USER_SERVICE` client, fetch + snapshot address on order creation, store under `shippingAddress` JSONB column.
9. **Tests** — unit tests for the service (`*.spec.ts`), particularly the default-flip TX and ownership checks.
10. **Add `start:user` script** — in `package.json`, plus include in `start:all`.

---

## 9. Validation & Edge Cases

- Country-specific postal code regex — start with: US `^\d{5}(-\d{4})?$`, GB lenient, fallback `^\S{2,12}$`. Don't over-engineer.
- Phone: store raw, normalize to E.164 only when used (Stripe call, SMS).
- Race on "set default": wrap unset-old + set-new in a single TypeORM transaction.
- Deleting the last default: allow it; checkout will then require user to pick at order time.

---

## 10. Frontend Contract Snippet

```ts
// List
GET /api/v1/addresses
→ { data: Address[] }

// Create
POST /api/v1/addresses { ...AddressDto }
→ { data: Address }

// Set default
POST /api/v1/addresses/:id/default { type: "shipping" | "billing" }
→ { data: Address }
```

Order creation should accept either `shippingAddressId` (preferred) **or** an inline `shippingAddress` object (one-time addresses). Document this in `PAYMENT_FLOW.md` once the address feature ships.

---

## 11. Open Questions

1. Build inside `user-service` or land in `auth-service` first? (default: `user-service`)
2. Hard delete vs soft delete? (default: hard, since orders snapshot)
3. Limit on saved addresses per user? (suggest 20)
4. Do we need separate default-shipping and default-billing flags, or one default? (suggest separate — common ecommerce pattern)
