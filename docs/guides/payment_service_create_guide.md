# Payment Service — Implementation Guide

High-level architecture and concrete steps for building the **payment-service** microservice. Aligned with the conventions already used by `auth-service`, `product-service`, `cart-service`, and `orders-service`.

This guide uses a **webhook-driven** flow: the server creates a Stripe `PaymentIntent`, persists a `pending` row, and returns a `clientSecret`. The client confirms via Stripe.js. **All status transitions happen in the webhook handler** — there is one source of truth, not two.

## 1. Flow

1. **Client** completes checkout → **API Gateway** receives `POST /api/v1/payments` with `{ orderId }`. The global `AccessTokenGuard` runs; `userId` comes from the JWT via `@CurrentUser()` — **never** from the body.
2. **Gateway → Payment Service** sends `PAYMENT_MESSAGES.CREATE` with `{ userId, orderId }` over TCP (port 3005).
3. **Payment Service → Order Service** sends `ORDER_MESSAGES.FIND_ONE` with `{ id: orderId, userId }` to fetch the canonical order and **re-read `totalAmount` server-side**.
4. Payment Service validates: order exists, status is `pending`, not already paid.
5. Payment Service creates a Stripe `PaymentIntent` (with `idempotencyKey: order:<orderId>`), persists a `Payment` row in `pending` state with `providerIntentId` set, and returns `{ paymentId, clientSecret }`.
6. **Client** calls `stripe.confirmCardPayment(clientSecret, ...)` in the browser. 3DS, async methods, etc. are handled there.
7. **Stripe → Gateway → Payment Service** delivers a webhook (`payment_intent.succeeded` / `payment_intent.payment_failed`).
8. Webhook handler verifies the signature, updates the `Payment` row, and on success sends `ORDER_MESSAGES.UPDATE_STATUS` with `{ orderId, status: 'confirmed' }`. On failure, the order stays `pending` so the user can retry.

### Key principles

- **Don't trust client-supplied amounts.** Body carries `orderId` only. Amount, currency, line items are derived from the persisted order.
- **Webhook is the source of truth.** The HTTP response from `POST /payments` only confirms an intent was created — it does *not* mean the customer was charged. Status transitions live in the webhook handler exclusively.
- **Idempotency everywhere.** Stripe retries webhooks; the network retries POSTs. Both paths must be safe to replay.

---

## 2. API Gateway Layer

**Endpoints:**
- `POST /api/v1/payments` — create a PaymentIntent for an order; returns `{ paymentId, clientSecret }`.
- `GET  /api/v1/payments/:id` — fetch a single payment (must belong to caller). Useful for the client to poll status if it doesn't want to listen for the webhook server-side.
- `POST /api/v1/payments/webhook` — Stripe webhook. **Annotate `@Public()`** — webhooks are signed, not JWT-authenticated.

```ts
// apps/api-gateway/src/payments/payments.controller.ts
@Controller('payments')
export class PaymentsController {
  constructor(@Inject(PAYMENT_SERVICE) private readonly paymentClient: ClientProxy) {}

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreatePaymentDto) {
    return firstValueFrom(
      this.paymentClient.send(PAYMENT_MESSAGES.CREATE, { userId: user.id, ...dto }),
    );
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return firstValueFrom(
      this.paymentClient.send(PAYMENT_MESSAGES.FIND_ONE, { id, userId: user.id }),
    );
  }

  @Public()
  @Post('webhook')
  webhook(@Headers('stripe-signature') sig: string, @Req() req: RawBodyRequest<Request>) {
    return firstValueFrom(
      this.paymentClient.send(PAYMENT_MESSAGES.WEBHOOK, {
        signature: sig,
        rawBody: req.rawBody?.toString('utf8'),
      }),
    );
  }
}
```

Register the client in `apps/api-gateway/src/payments/payments.module.ts` via `ClientsModule.register([{ name: PAYMENT_SERVICE, transport: Transport.TCP, options: { host: 'localhost', port: 3005 } }])`, then import `PaymentsModule` in `ApiGatewayModule`.

> **Webhook raw body:** Stripe signature verification needs the **unparsed** request body. In the gateway's `main.ts`, enable Nest's raw-body capture:
> ```ts
> const app = await NestFactory.create(ApiGatewayModule, { rawBody: true });
> ```
> Then read `req.rawBody` in the webhook controller (as above) and forward it to the microservice.

---

## 3. Payment Service Implementation

### 3.1 Entity

```ts
// apps/payment-service/src/payments/entities/payment.entity.ts
@Entity('payments')
@Index('uniq_active_payment_per_order', ['orderId'], {
  unique: true,
  where: `"status" IN ('pending','succeeded')`,
})
export class Payment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() userId: string;
  @Column() orderId: string;
  @Column('decimal', { precision: 10, scale: 2 }) amount: string;
  @Column({ default: 'usd' }) currency: string;
  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.PENDING }) status: PaymentStatus;
  @Column({ default: 'stripe' }) provider: string;
  @Column({ unique: true, nullable: true }) providerIntentId: string;
  @Column({ nullable: true }) failureReason: string;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

export enum PaymentStatus {
  PENDING = 'pending',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  REFUNDED = 'refunded',
}
```

The partial unique index `(orderId) WHERE status IN ('pending','succeeded')` blocks duplicate active payments at the DB layer — application-level checks race under concurrency. `failed` rows are excluded so the user can retry.

### 3.2 Module wiring

`PaymentServiceModule` (root) must:
- Configure `TypeOrmModule.forRoot({ ... })` against `payment_db` (add to `docker-compose.yaml`, e.g. host port 5438).
- Register the order `ClientProxy`:

```ts
ClientsModule.register([
  { name: ORDER_SERVICE, transport: Transport.TCP, options: { host: 'localhost', port: 3004 } },
]),
```

`PaymentsModule` registers `TypeOrmModule.forFeature([Payment])` and owns the controller + service.

### 3.3 Controller (TCP)

```ts
@Controller()
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @MessagePattern(PAYMENT_MESSAGES.CREATE)
  create(@Payload() payload: { userId: string } & CreatePaymentDto) {
    return this.paymentsService.create(payload.userId, payload);
  }

  @MessagePattern(PAYMENT_MESSAGES.FIND_ONE)
  findOne(@Payload() { id, userId }: { id: string; userId: string }) {
    return this.paymentsService.findOne(id, userId);
  }

  @MessagePattern(PAYMENT_MESSAGES.WEBHOOK)
  webhook(@Payload() payload: { signature: string; rawBody: string }) {
    return this.paymentsService.handleWebhook(payload.signature, payload.rawBody);
  }
}
```

### 3.4 Service logic — `create(userId, dto)`

The server's only job here is: validate, create a Stripe intent, persist a `pending` row, hand back the `clientSecret`. **No status transitions, no order updates.**

```ts
async create(
  userId: string,
  dto: CreatePaymentDto,
): Promise<{ paymentId: string; clientSecret: string }> {
  // 1. Fetch the order from order-service
  const order = await firstValueFrom(
    this.orderClient.send(ORDER_MESSAGES.FIND_ONE, { id: dto.orderId, userId }),
  );
  if (!order) throw new RpcException({ status: 404, message: 'Order not found' });
  if (order.status !== 'pending') {
    throw new RpcException({ status: 409, message: 'Order is not payable' });
  }

  // 2. Reuse an existing pending payment if one exists (idempotent retry)
  const existing = await this.paymentRepo.findOne({
    where: { orderId: order.id, status: In([PaymentStatus.PENDING, PaymentStatus.SUCCEEDED]) },
  });
  if (existing?.providerIntentId) {
    const intent = await this.stripe.paymentIntents.retrieve(existing.providerIntentId);
    return { paymentId: existing.id, clientSecret: intent.client_secret! };
  }

  // 3. Create the Stripe PaymentIntent. The idempotency key keys off the order,
  //    so retries on this endpoint never produce a second intent.
  const intent = await this.stripe.paymentIntents.create(
    {
      amount: Math.round(Number(order.totalAmount) * 100),
      currency: 'usd',
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      metadata: { orderId: order.id, userId },
    },
    { idempotencyKey: `order:${order.id}` },
  );

  // 4. Persist the pending row. The partial unique index on (orderId)
  //    enforces "one active payment per order" at the DB layer.
  const payment = await this.paymentRepo.save(
    this.paymentRepo.create({
      userId,
      orderId: order.id,
      amount: order.totalAmount,
      currency: 'usd',
      status: PaymentStatus.PENDING,
      provider: 'stripe',
      providerIntentId: intent.id,
    }),
  );

  return { paymentId: payment.id, clientSecret: intent.client_secret! };
}
```

That's it. No try/catch around Stripe charging the card — we haven't asked Stripe to charge yet. Confirmation happens in the browser:

```ts
// client side
const { clientSecret } = await fetch('/api/v1/payments', { ... }).then(r => r.json());
const result = await stripe.confirmCardPayment(clientSecret, {
  payment_method: { card: cardElement },
});
```

### 3.5 Webhook handler — the only place status changes

```ts
async handleWebhook(signature: string, rawBody: string): Promise<{ received: true }> {
  const event = this.stripe.webhooks.constructEvent(
    rawBody,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!,
  );

  if (
    event.type !== 'payment_intent.succeeded' &&
    event.type !== 'payment_intent.payment_failed'
  ) {
    return { received: true }; // ignore other event types but ack so Stripe stops retrying
  }

  const intent = event.data.object as Stripe.PaymentIntent;

  // Look up by providerIntentId; fall back to metadata for resilience.
  const payment =
    (await this.paymentRepo.findOne({ where: { providerIntentId: intent.id } })) ??
    (intent.metadata?.paymentId
      ? await this.paymentRepo.findOne({ where: { id: intent.metadata.paymentId } })
      : null);

  if (!payment) {
    // Unknown intent — log and ack. Don't 500, or Stripe will retry forever.
    this.logger.warn(`Webhook for unknown intent ${intent.id}`);
    return { received: true };
  }

  // Idempotency: if we've already finalised this payment, no-op.
  if (payment.status === PaymentStatus.SUCCEEDED || payment.status === PaymentStatus.FAILED) {
    return { received: true };
  }

  if (event.type === 'payment_intent.succeeded') {
    payment.status = PaymentStatus.SUCCEEDED;
    await this.paymentRepo.save(payment);
    await firstValueFrom(
      this.orderClient.send(ORDER_MESSAGES.UPDATE_STATUS, {
        orderId: payment.orderId,
        status: 'confirmed',
      }),
    );
  } else {
    payment.status = PaymentStatus.FAILED;
    payment.failureReason = intent.last_payment_error?.message ?? 'unknown';
    await this.paymentRepo.save(payment);
    // Order stays 'pending' — user can retry. The unique index permits a new
    // payment row now that this one is FAILED.
  }

  return { received: true };
}
```

Note the early-return on already-finalised payments: Stripe retries webhooks for up to 3 days, so the same `payment_intent.succeeded` may arrive twice.

---

## 4. Required `@app/common` additions

**`libs/common/src/constants/services.ts`**
```ts
export const PAYMENT_SERVICE = 'payment-service';
```

**`libs/common/src/constants/messages.ts`**
```ts
export const PAYMENT_MESSAGES = {
  CREATE: 'payment.create',
  FIND_ONE: 'payment.findOne',
  FIND_BY_ORDER: 'payment.findByOrder',
  REFUND: 'payment.refund',
  WEBHOOK: 'payment.webhook',
} as const;
```

The order-service must expose `ORDER_MESSAGES.FIND_ONE` and `ORDER_MESSAGES.UPDATE_STATUS`. `FIND_ONE` must scope by `userId` so cross-user lookups return null.

---

## 5. DTO

```ts
// apps/payment-service/src/payments/dto/create-payment.dto.ts
export class CreatePaymentDto {
  @IsUUID()
  orderId: string;
}
```

That's the entire body. No `paymentMethodId` (the client supplies the card to Stripe.js directly), no `amount`, no `currency`, no `userId`.

---

## 6. Setup checklist

- `apps/payment-service/src/main.ts` — `NestFactory.createMicroservice` with `Transport.TCP` on port 3005 (mirror `cart-service/main.ts`).
- `apps/payment-service/src/payment-service.module.ts` — `TypeOrmModule.forRoot({ ... payment_db ... })` + import `PaymentsModule`.
- `apps/payment-service/src/payments/` — `payments.module.ts`, `payments.controller.ts`, `payments.service.ts`, `dto/`, `entities/`.
- `docker-compose.yaml` — add `postgres-payment` on host port 5438 with `payment_db`.
- `apps/api-gateway/src/payments/` — new sub-module mirroring `orders/`.
- `apps/api-gateway/src/main.ts` — pass `{ rawBody: true }` to `NestFactory.create` so `req.rawBody` is available for webhook signature verification.
- `package.json` — add `start:payment` script (`nest start payment-service --watch`) and include it in `start:all`.
- Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. Read directly from `process.env` (consistent with the rest of the repo).
- Local dev: run `stripe listen --forward-to localhost:3000/api/v1/payments/webhook` to forward webhooks to the gateway. The Stripe CLI prints the signing secret to use for `STRIPE_WEBHOOK_SECRET`.

---

## 7. Phase 2+ (out of scope for now)

- **Refunds** — `PAYMENT_MESSAGES.REFUND` triggers `stripe.refunds.create`; webhook flips `status` to `REFUNDED` and emits `payment.refunded` for the order/notification services.
- **Event-driven** — instead of synchronously calling `ORDER_MESSAGES.UPDATE_STATUS` from the webhook, emit `payment.succeeded` to a broker (Redis Streams / NATS / Kafka) and let order, notification, inventory subscribe. Removes the last sync hop.
- **Outbox** — once webhook → order update → notification fan-out is critical, write the outbound events to a `payment_events` table inside the same transaction as the `Payment` save, and ship them with a relay. Avoids "we updated the payment but the order update RPC failed" gaps.
- **Multiple providers** — extract a `PaymentProvider` interface (`createIntent`, `refund`, `verifyWebhook`) so Stripe / PayPal / mock are swappable. The webhook controller then dispatches per-provider.
- **PCI** — never let raw card data touch this service. The client tokenizes via Stripe.js; only `pm_xxx` ids and `pi_xxx` intent ids cross your network.
- **Disputes** — handle `charge.dispute.created` to flag orders for manual review.
