# Plan — My Orders & Cancel Order

Two endpoints on top of the existing `orders-service`:

1. `GET /api/v1/orders` — current user's orders, paginated
2. `PATCH /api/v1/orders/:id/cancel` — owner cancels a `pending` order

Status update by admin and admin-list are out of scope for this plan.

---

## 1. `GET /api/v1/orders` (My Orders)

### Request
- Auth: required (global `AccessTokenGuard`).
- Query: `?page=1&limit=20&status=pending` (all optional).
  - `page` defaults to `1`, `limit` defaults to `20`, max `100`.
  - `status` filters by `OrderStatus` enum if provided.

### Response (success)
```json
{
  "success": true,
  "message": "Orders retrieved",
  "data": [ { "id": "...", "status": "pending", "totalAmount": "...", "items": [...] } ],
  "meta": { "total": 42, "page": 1, "limit": 20, "pageCount": 3 }
}
```

The `ResponseInterceptor` already passes `{message, data, meta}` through unchanged, so the orders-service can return that exact shape.

### Wiring

**Gateway** (`apps/api-gateway/src/orders/`)
- New DTO `dto/list-orders.query.dto.ts`: `page?`, `limit?`, `status?` with class-validator (`@IsInt @Min(1)`, etc.). `ValidationPipe` with `transform: true` already enabled — `@Type(() => Number)` for the numeric ones.
- Replace existing `findAll` in `orders.controller.ts`:
  ```ts
  @Get()
  findAll(@CurrentUser() user: JwtPayload, @Query() query: ListOrdersQueryDto) {
    return firstValueFrom(
      this.orderClient.send(ORDER_MESSAGES.FIND_ALL, { userId: user.id, ...query }),
    );
  }
  ```

**Microservice** (`apps/orders-service/src/orders/`)
- `dto/list-orders.dto.ts`: `userId`, `page`, `limit`, `status?` (mirrors gateway DTO + `userId`).
- `orders.controller.ts` `@MessagePattern(ORDER_MESSAGES.FIND_ALL)` → `ordersService.findAllForUser(payload)`.
- `orders.service.ts` rewrite `findAllForUser`:
  ```ts
  async findAllForUser({ userId, page = 1, limit = 20, status }: ListOrdersDto) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (Math.max(page, 1) - 1) * safeLimit;
    const where = status ? { userId, status } : { userId };
    const [data, total] = await this.orderRepo.findAndCount({
      where,
      relations: ['items'],
      order: { createdAt: 'DESC' },
      skip,
      take: safeLimit,
    });
    return {
      message: 'Orders retrieved',
      data,
      meta: {
        total,
        page,
        limit: safeLimit,
        pageCount: Math.ceil(total / safeLimit),
      },
    };
  }
  ```

### Decisions
- **Always scope by `userId`.** `userId` comes from the JWT (`@CurrentUser`), never from query — prevents IDOR.
- **`limit` clamp at 100** to bound DB reads.
- **No cursor pagination** — offset is fine at this scale; revisit if `orders` table grows past ~1M rows.
- **Eager `items`** is cheap given each order has a small fixed item count; if order items grow, switch to lazy fetch on `GET /orders/:id` and drop relations from list.

---

## 2. `PATCH /api/v1/orders/:id/cancel`

### Request
- Auth: required.
- Body: empty for now (later: `{ reason?: string }`).
- Allowed only when:
  - The order belongs to the authenticated user (`order.userId === jwt.id`).
  - `order.status === 'pending'`.

### Response (success)
```json
{ "success": true, "message": "Order cancelled", "data": { "id": "...", "status": "cancelled", ... }, "meta": {} }
```

### Errors
| Case | Status | message |
|---|---|---|
| Order not found OR belongs to another user | `404` | `Order not found` |
| Status is not `pending` | `409` | `Only pending orders can be cancelled` |

Returning `404` (not `403`) for not-owned orders avoids leaking existence — same response whether the order exists under another user or doesn't exist at all.

### Wiring

**`@app/common`**
- `ORDER_MESSAGES.CANCEL: 'order.cancel'` in `libs/common/src/constants/messages.ts`.

**Gateway**
- `orders.controller.ts`:
  ```ts
  @Patch(':id/cancel')
  cancel(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return firstValueFrom(
      this.orderClient.send(ORDER_MESSAGES.CANCEL, { userId: user.id, id }),
    );
  }
  ```
  (Add `Patch` to the `@nestjs/common` import.)

**Microservice**
- `orders.controller.ts`:
  ```ts
  @MessagePattern(ORDER_MESSAGES.CANCEL)
  cancel(@Payload() payload: { userId: string; id: string }) {
    return this.ordersService.cancel(payload.userId, payload.id);
  }
  ```
- `orders.service.ts`:
  ```ts
  async cancel(userId: string, id: string) {
    const order = await this.orderRepo.findOne({ where: { id, userId } });
    if (!order) {
      throw new RpcException({ statusCode: 404, message: 'Order not found' });
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new RpcException({
        statusCode: 409,
        message: 'Only pending orders can be cancelled',
      });
    }
    order.status = OrderStatus.CANCELLED;
    const saved = await this.orderRepo.save(order);
    return { message: 'Order cancelled', data: saved };
  }
  ```

### Decisions
- **No transaction needed** — single-row update; status flip is atomic at the DB.
- **Concurrency**: If two cancel calls land at once they both pass the `pending` check, both set `cancelled` — the second is idempotent. Acceptable. If it ever needs to be tighter (e.g. cancel races with `confirm`), use `.update({ id, status: PENDING }, { status: CANCELLED })` and check `affected === 1` instead.
- **No inventory rollback yet** — no inventory reservation exists in phase 1. Add a TODO comment so future work knows to release reserved stock here.
- **No notification yet** — same; mark TODO.
- **DTO empty for now** — keep an empty `CancelOrderDto` class so adding `reason` later doesn't churn the message contract.

---

## 3. Files touched

| File | Change |
|---|---|
| `libs/common/src/constants/messages.ts` | add `ORDER_MESSAGES.CANCEL` |
| `apps/api-gateway/src/orders/dto/list-orders.query.dto.ts` | new |
| `apps/api-gateway/src/orders/dto/cancel-order.dto.ts` | new (empty) |
| `apps/api-gateway/src/orders/orders.controller.ts` | accept `@Query`, add `@Patch(':id/cancel')` |
| `apps/orders-service/src/orders/dto/list-orders.dto.ts` | new |
| `apps/orders-service/src/orders/orders.controller.ts` | new `@MessagePattern(ORDER_MESSAGES.CANCEL)` handler, update FIND_ALL signature |
| `apps/orders-service/src/orders/orders.service.ts` | rewrite `findAllForUser`, add `cancel()` |

No DB migration needed — `synchronize: true` in dev and no schema changes.

---

## 4. Test plan

Manual via curl / REST client (no automated tests scoped here).

**Setup**: log in, add product to cart, `POST /orders` to create one in `pending`.

**My Orders happy path**
- `GET /orders` → 200, `meta.total ≥ 1`, `data[0].id` matches the created order.
- `GET /orders?page=2&limit=1` with two orders → 200, returns the second one.
- `GET /orders?status=pending` → only pending.
- `GET /orders?limit=500` → silently clamped to 100.

**My Orders authorization**
- Hit with no token → 401 from `AccessTokenGuard` (envelope from filter).
- Log in as user B, `GET /orders` → must NOT see user A's orders.

**Cancel happy path**
- `PATCH /orders/:id/cancel` on the pending order → 200, `data.status === 'cancelled'`.
- `GET /orders/:id` → status `cancelled`.

**Cancel error paths**
- Cancel the same order again → 409 `Only pending orders can be cancelled`.
- Cancel an order id that belongs to user B → 404 `Order not found`.
- Cancel a non-existent UUID → 404 `Order not found`.
- Cancel without auth → 401.

---

## 5. Open questions

- Do we want `GET /orders` to *also* support `?from=&to=` date filters? Not in this plan; add later if needed.
- Should cancellation send a `cart.restore` so the user can re-checkout the same items? Out of scope — the cart was cleared at order creation, restore would need cart-service support.
- When admin endpoints come, decide: separate route prefix (`/admin/orders`) or same routes with role-based filtering? Not blocking this plan.
