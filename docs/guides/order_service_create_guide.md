# Create Order Flow — Implementation Guide

High-level architecture and concrete steps for building **Create Order** in the `orders-service` microservice. Aligned with the conventions already used by `auth-service`, `product-service`, and `cart-service`.

## 1. Flow

The "Create Order" step converts a user's cart into a persisted order.

1. **API Gateway** receives `POST /api/v1/orders` from an authenticated user. The global `AccessTokenGuard` runs; `userId` is extracted from the JWT via `@CurrentUser()` — **never** from the request body.
2. **Gateway → Order Service** sends `ORDER_MESSAGES.CREATE` with `{ userId, ...dto }` over TCP.
3. **Order Service → Cart Service** sends `CART_MESSAGES.GET_CART` with `{ userId }` to fetch the cart.
4. Order Service validates (cart not empty), **re-snapshots** prices/names server-side, computes `totalAmount`.
5. Order Service persists `Order` + `OrderItem`s in a single TypeORM transaction.
6. Order Service sends `CART_MESSAGES.CLEAR_CART` to Cart Service.
7. Order Service returns the saved order with items to the gateway.

### Key principle: don't trust client-supplied items

The client submits `POST /orders` with no items in the body. Items, prices, and names come from the cart (and ultimately product-service), not the request. Otherwise a malicious client can order a $1000 product for $1.

The DTO should only carry fields the client legitimately owns: shipping address, notes, payment method id, etc. For phase 1 it can be empty.

---

## 2. API Gateway Layer

**Endpoint:** `POST /api/v1/orders`

The global `AccessTokenGuard` already protects all gateway routes — no `@UseGuards` needed. Use `@CurrentUser()` to read the JWT payload.

```ts
// apps/api-gateway/src/orders/orders.controller.ts
@Controller('orders')
export class OrdersController {
  constructor(@Inject(ORDER_SERVICE) private readonly orderClient: ClientProxy) {}

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateOrderDto) {
    return firstValueFrom(
      this.orderClient.send(ORDER_MESSAGES.CREATE, { userId: user.id, ...dto }),
    );
  }
}
```

Register the client in `apps/api-gateway/src/orders/orders.module.ts` via `ClientsModule.register([{ name: ORDER_SERVICE, transport: Transport.TCP, options: { host: 'localhost', port: 3004 } }])`, then import `OrdersModule` in `ApiGatewayModule`.

---

## 3. Order Service Implementation

### 3.1 Entities

Already in place at `apps/orders-service/src/orders/entities/`. Recap:

- **Order** — `id` (uuid), `userId`, `totalAmount` (decimal), `status` (enum, default `pending`), `items` (`OneToMany`, `cascade: true`), timestamps.
- **OrderItem** — `id` (uuid), `orderId` FK, `productId`, `productName` (snapshot), `price` (decimal, snapshot), `quantity`.

The denormalized `productName`/`price` snapshot is intentional: past orders must remain stable when product-service mutates the catalog later.

### 3.2 Module wiring

`OrdersServiceModule` (the root module of the service) must:
- Configure `TypeOrmModule.forRoot({ ... })` against `order_db` (add a Postgres entry to `docker-compose.yaml`, e.g. host port 5437).
- Register the cart `ClientProxy` so `OrdersService` can call into cart-service:

```ts
ClientsModule.register([
  { name: CART_SERVICE, transport: Transport.TCP, options: { host: 'localhost', port: 3003 } },
]),
```

`OrdersModule` registers `TypeOrmModule.forFeature([Order, OrderItem])` and re-exports nothing — it owns the controller and service.

### 3.3 Controller (TCP)

Replace the scaffolded raw strings (`'createOrder'`, etc.) with constants from `@app/common`:

```ts
@MessagePattern(ORDER_MESSAGES.CREATE)
create(@Payload() payload: { userId: string } & CreateOrderDto) {
  return this.ordersService.create(payload.userId, payload);
}
```

### 3.4 Service logic — `OrdersService.create(userId, dto)`

```ts
async create(userId: string, dto: CreateOrderDto): Promise<Order> {
  // 1. Fetch cart from cart-service
  const cart = await firstValueFrom(
    this.cartClient.send(CART_MESSAGES.GET_CART, { userId }),
  );
  if (!cart?.items?.length) {
    throw new RpcException('Cart is empty');
  }

  // 2. Snapshot + total (server-side, never trust client/cart-supplied totals blindly)
  const items = cart.items.map((ci) =>
    this.orderItemRepo.create({
      productId: ci.productId,
      productName: ci.productName,
      price: ci.price,
      quantity: ci.quantity,
    }),
  );
  const totalAmount = items.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0);

  // 3. Persist atomically
  const order = await this.dataSource.transaction(async (manager) => {
    const saved = await manager.save(
      manager.create(Order, { userId, totalAmount, items }),
    );
    return saved;
  });

  // 4. Clear cart (best-effort; consider compensating action if it fails)
  await firstValueFrom(
    this.cartClient.send(CART_MESSAGES.CLEAR_CART, { userId }),
  );

  return order;
}
```

Notes:
- `cascade: true` on `Order.items` lets `manager.save(order)` persist the items in the same transaction.
- Throw `RpcException` (not `BadRequestException`) inside microservices so the gateway can map it back to an HTTP error.
- Cart clear runs after the transaction. If it fails the order still exists; that's acceptable for phase 1, but log it loudly.

---

## 4. Required `@app/common` additions

Currently missing — add before wiring anything else.

**`libs/common/src/constants/services.ts`**
```ts
export const ORDER_SERVICE = 'order-service';
```

**`libs/common/src/constants/messages.ts`**
```ts
export const ORDER_MESSAGES = {
  CREATE: 'order.create',
  FIND_ALL: 'order.findAll',
  FIND_ONE: 'order.findOne',
  UPDATE_STATUS: 'order.updateStatus',
} as const;

// add to existing CART_MESSAGES
export const CART_MESSAGES = {
  // ...existing entries
  CLEAR_CART: 'cart.clearCart',
} as const;
```

The cart-service must implement a `@MessagePattern(CART_MESSAGES.CLEAR_CART)` handler that deletes all items for the given `userId`.

---

## 5. DTO

```ts
// apps/orders-service/src/orders/dto/create-order.dto.ts
export class CreateOrderDto {
  // Phase 1: empty. Add shippingAddress, paymentMethodId, notes, etc. as needed.
}
```

The current DTO accepts `userId`, `totalAmount`, and `items` from the body — **remove all three**. They will be derived server-side.

---

## 6. Cleanups required in the existing scaffold

- `apps/orders-service/src/orders/orders.service.ts` — replace stubs with the implementation above.
- `apps/orders-service/src/orders/orders.controller.ts` — swap raw `'createOrder'` strings for `ORDER_MESSAGES.*`.
- `apps/orders-service/src/orders/orders.module.ts` — add `TypeOrmModule.forFeature([Order, OrderItem])` and `ClientsModule.register([{ name: CART_SERVICE, ... }])`.
- `apps/orders-service/src/main.ts` — switch from default scaffold to `NestFactory.createMicroservice` with `Transport.TCP` on port 3004 (mirroring `cart-service/main.ts`).
- `apps/orders-service/src/orders-service.module.ts` — add `TypeOrmModule.forRoot({ ... order_db ... })`.
- `nest-cli.json` — remove the duplicate `order-service` entry; keep only `orders-service` since that's what exists on disk.
- `docker-compose.yaml` — add `postgres-order` on host port 5437 with `order_db`.
- `apps/api-gateway/src/orders/` — new sub-module mirroring `auth/`, `cart/`, `products/`.

---

## 7. Phase 2+ (out of scope for now)

- **Inventory reservation** — call `INVENTORY_SERVICE` before persisting; abort on insufficient stock.
- **Event-driven flow** — emit `order.created` instead of synchronous TCP fan-out; let payment / notification / inventory services subscribe.
- **Payments** — keep status `pending` until `PAYMENT_SERVICE` confirms, then transition to `confirmed`.
- **Notifications** — `NOTIFICATION_SERVICE` consumes `order.created` and sends email.
- **Saga / outbox** — once multiple side effects (clear cart, reserve inventory, charge card) are involved, partial-failure handling needs a real pattern, not best-effort calls.
