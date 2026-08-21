# TCP → gRPC

Every inter-service call runs over `@nestjs/microservices` TCP transport today. This is the
plan for moving one service to gRPC, and the reasoning behind each choice.

Nothing here is implemented yet. `.proto` files: 0. `@grpc/grpc-js`: not installed.

---

## What TCP transport actually is

Not raw TCP with a schema — Nest's own JSON protocol over a socket. A `send()` serialises
`{pattern, data}` to JSON, length-prefixes it, and the server matches `pattern` against a
`@MessagePattern` string. That is the whole contract.

Consequences worth being able to state out loud:

- **The contract is a string.** Nothing checks that a caller's payload matches what the
  handler reads. A typo'd pattern doesn't fail — it hangs until timeout, because no handler
  claims the message.
- **Types are a lie in both directions.** `@Payload() dto: AddToCartDto` is a compile-time
  annotation over `JSON.parse` output. No `ValidationPipe` runs on any microservice in this
  repo, so the DTO class is documentation, not enforcement.
- **Nest-only.** No other language can call these services.

gRPC replaces the string with a `.proto` file, checked at build time, and the JSON with
protobuf over HTTP/2.

---

## Current surface

| Service | Handlers | `RpcException` throws | TCP port |
| --- | --- | --- | --- |
| auth-service | 8 | 9+ | 3001 |
| product-service | 10 | 7 | 3002 |
| cart-service | 4 | 4 | 3003 |
| orders-service | 5 | 8 | 3004 |
| payment-service | 5 | 1 | 3005 |
| user-service | 7 | — | 3006 |

39 `@MessagePattern` handlers. **0** `@EventPattern`, **0** `.emit()` — everything is unary
request/response, so no streaming to design around.

**42 `.send()` call sites**: 35 in the gateway, 7 service-to-service. Every one is a bare
`firstValueFrom(...)` — no `.pipe()`, `timeout()`, `catchError()`, or retry anywhere. That
cuts both ways: the migration is mechanical, and there is no resilience today to preserve.

**11 client registrations across 9 files.** Grep for `ClientsModule`, not `Transport.TCP` —
`products.module.ts` and `cart.module.ts` omit the `transport` key entirely and rely on the
TCP default, so a `Transport.TCP` grep finds only 9 of 11.

No microservice-side interceptors, pipes, or guards exist. All validation is at the gateway,
which stays HTTP and is unaffected.

---

## Estimate

**~6–8 focused hours for cart-service end-to-end.** ~2–3 days for all six, since the
foundation is paid once and each further service is ~1.5–3 h.

| Step | Est. |
| --- | --- |
| Add `@grpc/grpc-js` + `@grpc/proto-loader`, solve the webpack asset problem | 30–45 min |
| Decide proto location, wire into build + jest | 30 min |
| Author `cart.proto` | 45–60 min |
| Server: add gRPC listener, `@MessagePattern` → `@GrpcMethod` ×4 | 30 min |
| Gateway: gRPC client, `getService<T>()`, rewrite 3 call sites | 45 min |
| Error mapping, HTTP status ↔ gRPC status | 1–1.5 h |
| Dockerfile + Helm port naming | 45 min |
| Round-trip debugging | 1–1.5 h |

The transport swap is the cheap part. The hours go into payload shape and error semantics —
see Gotchas.

---

## Why cart-service first

4 handlers, the smallest surface, no Stripe or JWT entanglement, own database. It also has
both directions of traffic, which is what makes it worth doing first:

- **Inbound**, 3 gateway routes → `cart.addToCart`, `cart.getCart`, `cart.removeFromCart`.
- **Inbound from another service** — `cart.clearCart` has *no* gateway route. orders-service
  calls it, along with `cart.getCart`.
- **Outbound** — `cart.service.ts` calls `product.findOne` on product-service.

Do **not** convert product-service first: 10 handlers, and its `PRODUCT_MESSAGES` mixes
`product.*` and `product.category.*` into one constant object and one listener, so it should
split into two gRPC services in one package. More decisions, same lessons.

---

## Approach

### 1. Keep TCP running

`apps/cart-service/src/main.ts` is already a hybrid app — it calls `connectMicroservice()`
for TCP *and* `listen()` for the HTTP health port. Add a **second**
`connectMicroservice({ transport: Transport.GRPC, ... })` next to the TCP one. Both listen
at once.

This is not a transitional hack, it's the point:

- orders-service keeps calling cart over TCP with no coordinated change.
- The same handler can be hit both ways and the responses diffed.
- Rollback is deleting a block, not a revert.

Drop the TCP listener only once gRPC is verified.

### 2. Contract

Put `cart.proto` in `libs/common/src/proto/`, **not** a new `libs/proto` library. `libs/`
currently holds exactly one library wired as `@app/common` across `nest-cli.json`,
`tsconfig.json`, and the jest `moduleNameMapper`; a second lib means touching all three for
no benefit yet.

The existing constants map almost 1:1 — `cart.addToCart` → `cart.CartService/AddToCart`.
Keep `CART_MESSAGES` as the naming source so the two transports stay legible side by side.

Use `@grpc/proto-loader` at runtime rather than `ts-proto` codegen, and hand-write the TS
interface for four methods. Codegen is the right call at 39 handlers; it's ceremony at 4.
Note this means the interface is a *promise*, not a *guarantee* — change the proto and the
interface in the same commit or TypeScript will confidently lie to you.

### 3. Server

Annotate the four handlers with `@GrpcMethod('CartService', 'AddToCart')`. Bodies don't
change. Leave the `@MessagePattern` decorators in place — a method can carry both.

### 4. Client

In `apps/api-gateway/src/cart/cart.module.ts`, register with `transport: Transport.GRPC` and
resolve in `onModuleInit`:

```ts
this.cartService = this.client.getService<CartServiceClient>('CartService');
```

gRPC methods also return Observables, so the three call sites stay `firstValueFrom(...)` and
the controller bodies barely move.

### 5. Deployment

- `apps/cart-service/Dockerfile` — `EXPOSE 3003` and the "TCP microservice" header comment.
- `k8s/ecommerce/templates/cart-service/{service,deployment}.yaml` — the port is **named
  `tcp`**. Rename to `grpc` and add `appProtocol: kubernetes.io/h2c`.
- `k8s/ecommerce/values.yaml` — `services.cart.port`.
- `docker-compose-dev.yaml` needs no change; it maps only DB and Redis ports.

Keep the HTTP `/health/live` and `/health/ready` from `libs/common/src/health/`. Adopting
`grpc.health.v1.Health` means reworking the probes and dropping the 8080 listener — real
work, no learning payoff.

---

## Gotchas

**`webpack: true` is global, and `.proto` files are not code.** `nest-cli.json` bundles every
project, so a `.proto` is not emitted unless listed in that project's `assets`. Worse, it
lands next to the bundle in `dist/apps/cart-service/`, not in a mirrored
`libs/common/src/proto/` tree — so `join(__dirname, 'cart.proto')` resolves differently under
`nest start`, `nest build`, and jest. Resolve against a candidate list and throw a real error
when none exists; a missing proto otherwise surfaces as an opaque grpc-js
`Service not found` at first call. This is the same webpack-bundling trap that forces manual
migration imports — see [MIGRATIONS.md](MIGRATIONS.md).

**proto3 has no `undefined`, and absent ≠ null.** An omitted `string` arrives as `''`, an
omitted number as `0`, an omitted message as undefined-but-not-null. `AddToCartDto.cartId`
is `@IsOptional()`, and `addToCart` branches on `if (cartId)` — `''` is falsy so that
particular case survives, but the pattern is fragile. Check every optional field, and test
an **empty cart** specifically: `items: []` and absent timestamps are exactly where proto3
defaults diverge from the JSON the gateway returns today.

**`productPrice` is a Postgres `decimal`, which TypeORM returns as a `string`.** Declaring it
`double` in the proto invites a silent `Number()` coercion at the boundary and a precision
bug in a money field. Declare it `string` and keep it a string end to end. This is the kind
of mismatch that TCP's JSON pass-through hides indefinitely.

**Error shape does not survive.** `libs/common/src/filters/rpc-exception.filter.ts` is
`@Catch()`-all and returns HTTP-flavoured `{statusCode, message, error}`; the gateway reads
that `statusCode`. gRPC carries only a numeric status plus a string, so the object flattens
into `details` and **every error becomes a 500** unless mapped both ways:

| HTTP | gRPC |
| --- | --- |
| 400 | `INVALID_ARGUMENT` (3) |
| 401 | `UNAUTHENTICATED` (16) |
| 404 | `NOT_FOUND` (5) |
| 409 | `ALREADY_EXISTS` (6) |
| 500 | `INTERNAL` (13) |

Cart has four throw sites in `cart.service.ts`; enumerate their codes before writing the
filter. Repo-wide it's ~40 sites.

**HTTP/2 multiplexing breaks ClusterIP load balancing.** TCP transport opens a connection
per call, so ClusterIP balances it by accident. gRPC holds **one** long-lived HTTP/2
connection and multiplexes every request over it — so at `replicas > 1` all traffic pins to
whichever pod it first connected to. Not biting yet (every service is `replicas: 1`), but
scaling later needs a headless Service plus `'round_robin'` in `loadBalancingConfig`, or a
mesh. This is the single most common gRPC-on-Kubernetes surprise.

**Set deadlines.** gRPC gives you per-call deadlines, which TCP transport never had. Since
no call site has a `timeout()` today, this is a free reliability win — don't skip it.

---

## Verify

```bash
pnpm run start:cart      # expect BOTH a TCP and a gRPC listener in the log
pnpm run start:gateway
```

- Exercise all 3 cart routes through `api/v1` with a real JWT. Responses must match TCP
  byte for byte — especially an empty cart.
- Confirm orders-service can still reach `cart.clearCart` and `cart.getCart` over TCP while
  gateway traffic goes over gRPC. That mixed state is the thing to understand.
- Confirm cart's outbound `product.findOne` still works — it's unchanged, but it proves the
  client and server sides are independent.
- Force all four error paths and confirm the gateway returns the right HTTP status, not 500.
- `grpcurl -plaintext localhost:<port> list` — introspecting a running service without
  writing a client is the payoff, and the most demo-able part.

```bash
pnpm test
nest build cart-service && ls dist/apps/cart-service/   # cart.proto must be there
```

---

## Pre-existing bugs this will surface

Deliberately out of scope — fixing them balloons the spike. But they're the concrete answer
to "what does a typed contract actually buy you", because gRPC turns all of them into build
or startup failures:

- The gateway sends `payment.findOne` / `payment.update` / `payment.remove`, but
  payment-service registers `findOnePayment` / `updatePayment` / `removePayment`. **Three
  routes hang today.** Plus a literal placeholder `{ id: 'hii' }` sent to a
  `PAYMENT_MESSAGES.FIND_BY_ORDER` handler that was never written.
- payment-service bypasses `PAYMENT_MESSAGES` with 4 hardcoded pattern strings, and 4 of its
  declared constants have no handler. One handler takes `@Payload() createPaymentDto: any`;
  two take a bare `id: number`, which has no protobuf equivalent — scalars need a wrapper
  message.
- Service-to-service clients hardcode `host: 'localhost'` with no env fallback (cart→product,
  orders→cart, orders→user, payment→order). **These only work locally, never in-cluster.**
  Fix during the migration by moving all 11 registrations to `registerAsync` + `ConfigService`.
- The response contract is inconsistent: only product-service wraps in `ApiResponse<T>`, and
  its `meta?: Record<string, any>` has no clean proto equivalent (needs
  `google.protobuf.Struct` or a redesign). The other five return bare objects. Standardise
  before writing protos for more than cart.
- `auth.validateToken` and `order.updateStatus` have handlers and zero callers.
  `INVENTORY_SERVICE` and `NOTIFICATION_SERVICE` are constants with no service.

---

## Not done yet

Nothing is implemented. Cart is the pilot; the other five stay on TCP.

Worth knowing this migration is not all-or-nothing and does not have to finish. gRPC earns
its keep on hot internal paths; a service called once per checkout is fine on TCP forever.
The reason to do cart properly is to have the option — and to be able to explain the
tradeoff rather than assert that gRPC is faster.
