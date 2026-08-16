# Address Feature — Implementation Review

**Date:** 2026-05-09
**Status:** Backend scaffolding complete, ready for end-to-end testing.
**Build:** ✅ `nest build user-service` and `nest build api-gateway` both pass.

---

## 1. Completion Snapshot

| Area | Status | Notes |
|---|---|---|
| Shared constants (`USER_SERVICE`, `ADDRESS_MESSAGES`) | ✅ Done | Exported from `@app/common` |
| `user-service` scaffold (TCP 3006, Postgres 5438) | ✅ Done | Mirrors `cart-service` pattern; orders-service already owns 3004 |
| `Address` entity + soft delete | ✅ Done | `@DeleteDateColumn`, indexed on `userId` |
| DTOs (create / update / set-default) | ✅ Done | `class-validator` decorators |
| Service layer (CRUD + transactional default-flip) | ✅ Done | TX wraps unset-old + set-new |
| Microservice controller (`@MessagePattern`) | ✅ Done | Seven patterns wired |
| Gateway sub-module (`apps/api-gateway/src/addresses/`) | ✅ Done | Six REST routes |
| Wired into `ApiGatewayModule` | ✅ Done | `AddressesModule` imported |
| `docker-compose.yaml` — `postgres-user` on 5438 | ✅ Done | |
| `package.json` — `start:user` + added to `start:all` | ✅ Done | |
| Build passes | ✅ Done | webpack OK for both apps |
| Unit tests (`*.spec.ts`) | ⏳ Not done | Skipped — add before merging |
| E2E tests | ⏳ Not done | |
| Orders-service consumes address (`GET_FOR_ORDER`) | ⏳ Not done | Snapshot logic still needed in orders |
| Migration from `synchronize: true` | 🚫 Not for v1 | Matches existing services |

**Rough completion:** ~85% of the address feature itself. Orders integration is a separate next step.

---

## 2. Files Added / Modified

### Added (12)
```
apps/user-service/tsconfig.app.json
apps/user-service/src/main.ts
apps/user-service/src/user-service.module.ts
apps/user-service/src/addresses/address.entity.ts
apps/user-service/src/addresses/address.module.ts
apps/user-service/src/addresses/address.service.ts
apps/user-service/src/addresses/address.controller.ts
apps/user-service/src/addresses/dto/create-address.dto.ts
apps/user-service/src/addresses/dto/update-address.dto.ts
apps/user-service/src/addresses/dto/set-default.dto.ts
apps/api-gateway/src/addresses/addresses.module.ts
apps/api-gateway/src/addresses/addresses.controller.ts
```

### Modified (5)
```
libs/common/src/constants/services.ts        # + USER_SERVICE
libs/common/src/constants/messages.ts        # + ADDRESS_MESSAGES
apps/api-gateway/src/api-gateway.module.ts   # + AddressesModule import
docker-compose.yaml                          # + postgres-user (port 5438)
package.json                                 # + start:user + start:all updated
```

`nest-cli.json` already had the `user-service` entry, so no change required there.

---

## 3. Architecture Recap

```
┌──────────────────────┐
│ Frontend             │
└──────────┬───────────┘
           │ HTTP /api/v1/addresses/*
           ▼
┌──────────────────────┐
│ api-gateway          │  AddressesController (REST)
│ (port 3000)          │  ↓ ClientProxy.send(ADDRESS_MESSAGES.*)
└──────────┬───────────┘
           │ TCP
           ▼
┌──────────────────────┐
│ user-service         │  AddressController (@MessagePattern)
│ (TCP 3006)           │  → AddressService → Postgres user_db (5438)
└──────────────────────┘
```

Auth is enforced by the gateway's global `AccessTokenGuard`. The user-service trusts the `userId` field passed in TCP payloads (gateway extracts it from the JWT via `@CurrentUser`). This matches the pattern already used by `cart-service`.

---

## 4. API Surface Implemented

| Method | Path | Pattern | Auth |
|---|---|---|---|
| `POST` | `/api/v1/addresses` | `address.create` | ✅ Required |
| `GET`  | `/api/v1/addresses` | `address.list` | ✅ Required |
| `GET`  | `/api/v1/addresses/:id` | `address.get` | ✅ Required |
| `PATCH` | `/api/v1/addresses/:id` | `address.update` | ✅ Required |
| `DELETE` | `/api/v1/addresses/:id` | `address.delete` | ✅ Required |
| `POST` | `/api/v1/addresses/:id/default` | `address.setDefault` | ✅ Required |
| (TCP only) | — | `address.getForOrder` | called by orders-service |

### Sample request — create

```http
POST /api/v1/addresses
Authorization: Bearer <token>
Content-Type: application/json

{
  "label": "Home",
  "fullName": "Jane Doe",
  "phone": "+447700900123",
  "line1": "221B Baker Street",
  "city": "London",
  "state": "Greater London",
  "postalCode": "NW1 6XE",
  "country": "GB",
  "isDefaultShipping": true
}
```

### Sample request — set default

```http
POST /api/v1/addresses/:id/default
{ "type": "shipping" }   // or "billing"
```

---

## 5. Data Model

```sql
CREATE TABLE addresses (
  id                  uuid PRIMARY KEY,
  userId              uuid NOT NULL,                    -- indexed
  label               varchar(50),
  fullName            varchar(120) NOT NULL,
  phone               varchar(30)  NOT NULL,
  line1               varchar(200) NOT NULL,
  line2               varchar(200),
  city                varchar(100) NOT NULL,
  state               varchar(100) NOT NULL,
  postalCode          varchar(20)  NOT NULL,
  country             char(2)      NOT NULL,            -- ISO-3166-1 alpha-2
  isDefaultShipping   boolean DEFAULT false,
  isDefaultBilling    boolean DEFAULT false,
  createdAt           timestamptz NOT NULL,
  updatedAt           timestamptz NOT NULL,
  deletedAt           timestamptz                       -- soft delete
);
```

Composite index on `(userId, deletedAt)` for fast list queries.

---

## 6. Service Behavior — What's Worth Noting

- **Default flip is transactional.** Setting an address as default unsets the previous default in the same TX. Same for billing.
- **Ownership check on every read/update/delete.** `userId` from JWT is matched against `address.userId`; missing match returns 404 (not 403, to avoid leaking existence).
- **Soft delete** via TypeORM's `@DeleteDateColumn`. The default `find` calls automatically filter out soft-deleted rows.
- **List ordering**: defaults first (shipping, then billing), then most recently updated.
- **Create allows seeding defaults**: passing `isDefaultShipping: true` on create will atomically promote the new address.

---

## 7. Decisions That Match the Plan

| Decision | Chosen |
|---|---|
| Service location | `user-service` (new app) |
| Order input | `addressId` only (orders fetch + snapshot) |
| Default model | Separate shipping + billing flags |
| Delete strategy | Soft delete (`deletedAt` column) |

---

## 8. Known Gaps & Recommendations

### Must-do before production
1. **Unit tests** — `address.service.spec.ts` should cover:
   - Default-flip transaction (only one default per user per type)
   - Ownership check on get/update/delete
   - Soft delete excludes from `list`
   - `getForOrder` returns same object as `get`
2. **Validation pipe wiring** — confirm gateway-level `ValidationPipe` (whitelist + transform) reaches the address routes. The DTOs are decorated correctly but the gateway must `app.useGlobalPipes(new ValidationPipe(...))` already (per CLAUDE.md it does).
3. **Orders integration** — orders-service needs:
   - Inject `USER_SERVICE` ClientProxy
   - On create: `firstValueFrom(client.send(ADDRESS_MESSAGES.GET_FOR_ORDER, { userId, addressId }))`
   - Snapshot returned address into the order row (e.g. JSONB `shippingAddressSnapshot`)
   - Reject 400 if address fetch returns null/throws

### Nice-to-have
- **Cap addresses per user** (suggest 20) — add a count check in `create`.
- **Phone normalization** — store raw, normalize to E.164 on egress only (Stripe / SMS).
- **Country-specific postal-code regex** — currently any 2–20 char string passes. Add per-country rules in `CreateAddressDto` if quality matters.
- **Promote on default-delete** — when a default address is soft-deleted, the user has no default until they pick one. Optionally promote the most-recent-updated remaining address.
- **Migrations** — currently relying on `synchronize: true` like the rest of the project. Fine for dev, but a `typeorm` migration file should be generated before production.

### Risks
- **No cross-service FK on `userId`.** This is correct for microservices but means an orphaned address row could exist if a user is hard-deleted in `auth-service`. Mitigation: on user delete, publish an event and have user-service soft-delete the user's addresses.
- **Soft delete + unique constraint**: there is no unique constraint on `(userId, isDefaultShipping=true)`. Enforcement is service-layer only. If two requests race, both could end up as default. The transaction reduces but doesn't fully eliminate this — for stronger guarantees, add a partial unique index:
  ```sql
  CREATE UNIQUE INDEX idx_one_default_shipping
    ON addresses (userId)
    WHERE isDefaultShipping = true AND deletedAt IS NULL;
  ```
  (Same for billing.) Not added because `synchronize: true` won't generate it — needs a real migration.

---

## 9. How to Run Locally

```bash
# 1. Bring up the new Postgres
docker compose up -d postgres-user

# 2. Start the new service (in its own terminal, or via start:all)
pnpm run start:user

# 3. Start the gateway if not running
pnpm run start:gateway

# 4. Smoke test
curl -X POST http://localhost:3000/api/v1/addresses \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fullName":"Jane Doe","phone":"+447700900123",
    "line1":"221B Baker Street","city":"London","state":"Greater London",
    "postalCode":"NW1 6XE","country":"GB","isDefaultShipping":true
  }'
```

Or just `pnpm run start:all` — the user-service is now part of it.

---

## 10. Next Steps (priority order)

1. Hook orders-service into `ADDRESS_MESSAGES.GET_FOR_ORDER` and snapshot the address on order create.
2. Write `address.service.spec.ts` unit tests (target: default-flip TX, ownership, soft delete).
3. Update `PAYMENT_FLOW.md` to document `shippingAddressId` / `billingAddressId` on the create-order request.
4. Add the partial unique index via a migration file once migrations are introduced project-wide.
5. Add address-count limit (20) in `AddressService.create`.
