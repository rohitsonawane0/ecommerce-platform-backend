# SpiceDB Authorization Guide

How to add fine-grained (relationship-based) authorization to this monorepo using
[SpiceDB](https://authzed.com/docs/spicedb/getting-started/discovering-spicedb).

This is a **design + implementation guide**, not a record of what exists. Nothing in
here is wired up yet — every file path marked _(new)_ has to be created.

---

## 0. Read this first: should you do it?

SpiceDB earns its operational cost when permissions depend on **relationships between
resources**, not just on a role claim. Today this codebase has exactly two roles
(`UserRole.USER`, `UserRole.ADMIN` in `libs/common/src/enums/user-role.enum.ts`) and
ownership is enforced by pushing `userId` down into each microservice and filtering in
SQL. For that model alone, a `@Roles()` guard would be cheaper.

SpiceDB becomes the right answer as soon as any of these are on the roadmap:

| Requirement | Why roles can't do it |
| --- | --- |
| Multi-vendor marketplace — a seller edits only their own products | Needs per-resource ownership, not a global role |
| Category managers / merchandisers scoped to part of the catalog | Needs a resource hierarchy with inheritance |
| Org / team accounts sharing a cart or order history | Needs group membership resolved transitively |
| Support agents with time-boxed, per-order access | Needs relationships written and revoked at runtime |
| "Which orders can this user see?" answered without a `WHERE` clause per service | Needs `LookupResources` |

The plan below is written so that phase 1–3 are **useful on their own** (they close a
real hole, see §16) and phases 4–6 are opt-in as the model grows.

---

## 1. Concepts in 60 seconds

SpiceDB is an implementation of Google's Zanzibar paper: a database whose only job is
storing and querying permission relationships.

| Term | Meaning | Example |
| --- | --- | --- |
| **Object** | `type:id` — a resource or a subject | `order:9f3a…`, `user:12` |
| **Relation** | A named edge you store | `order:9f3a#owner@user:12` |
| **Permission** | A computed expression over relations | `permission cancel = owner + platform->admin` |
| **Schema** | The type definitions, written in `.zed` and stored server-side | see §3 |
| **Relationship (tuple)** | One stored edge; the only data SpiceDB holds | `WriteRelationships` |
| **Check** | "Does subject have permission on resource?" → boolean | `CheckPermission` |
| **LookupResources** | "Which resources of type T can subject X do P on?" | replaces `WHERE user_id = ?` |
| **ZedToken** | An opaque revision token returned by every write | used for read-after-write |
| **Consistency** | Per-request freshness knob | `minimizeLatency` / `atLeastAsFresh` / `fullyConsistent` |

Two rules that matter more than anything else:

1. **SpiceDB stores no business data.** It never learns what a product costs. It stores
   `product:X#seller@user:Y` and nothing else. Your Postgres databases stay the source
   of truth.
2. **Relationships are written by whoever creates the resource.** If a write to Postgres
   succeeds and the relationship write fails, that resource is invisible/unmanageable.
   §10 covers how to handle that.

---

## 2. Architecture in this repo

```
                       HTTP
                         │
              ┌──────────▼───────────┐
              │      api-gateway     │   :3000  (only HTTP entry point)
              │  ┌────────────────┐  │
              │  │AccessTokenGuard│  │  1. verifies JWT → request.user
              │  ├────────────────┤  │
              │  │ PermissionGuard│  │  2. CheckPermission ──────┐
              │  └────────────────┘  │                           │
              └──────────┬───────────┘                        gRPC
                         │ TCP                                   │
        ┌────────┬───────┴────┬─────────┬──────────┐      ┌───────▼────────┐
        ▼        ▼            ▼         ▼          ▼      │    SpiceDB     │
     auth     product      cart     orders     payment    │    :50051      │
     :3001     :3002      :3003     :3004       :3005     └───────┬────────┘
        │         │          │         │           │              │
        └─────────┴──────────┴─────────┴───────────┘        postgres-spicedb
              WriteRelationships (gRPC, on create/delete)        :5439
```

The split, stated once:

- **Decisions live in the gateway.** It already has a global `AccessTokenGuard`
  (`libs/common/src/guards/access-token.guard.ts`, registered as `APP_GUARD` in
  `apps/api-gateway/src/api-gateway.module.ts`). Authorization is the second global
  guard in that same chain. One place, one pattern, one round trip per request.
- **Relationship writes live in the owning service.** `orders-service` writes
  `order:*#owner`, `product-service` writes `product:*#category`. The service that owns
  the row owns the tuple, because it's the only place that knows the write succeeded.
- **The client, schema, and constants live in `libs/common`.** Same reasoning as
  `constants/messages.ts`: shared vocabulary that must not drift between services.

---

## 3. The schema

Lives at `libs/common/src/authz/schema/ecommerce.zed` _(new)_.

```zed
/** a person; SpiceDB only needs the id, which is the auth-service user UUID */
definition user {}

/**
 * a singleton tenant object, always platform:main.
 * Gives you one place to hang global admin, and a seam for real multi-tenancy later.
 */
definition platform {
    relation administrator: user
    permission admin = administrator
}

definition category {
    relation platform: platform
    relation manager: user

    // a category manager, or any platform admin
    permission manage = manager + platform->admin
}

definition product {
    relation category: category
    relation seller: user

    // reads are public — deliberately not modelled here, see §8
    permission edit   = seller + category->manage
    permission delete = seller + category->manage
}

definition cart {
    relation owner: user

    permission read   = owner
    permission modify = owner
}

definition address {
    relation owner: user

    permission view   = owner
    permission manage = owner
}

definition order {
    relation owner: user
    relation platform: platform

    permission view          = owner + platform->admin
    permission cancel        = owner + platform->admin
    permission update_status = platform->admin
}

definition payment {
    relation order: order

    // inherit straight from the order — no duplicate ownership edges to keep in sync
    permission view   = order->view
    permission refund = order->platform->admin
}
```

### Reading the syntax

- `relation manager: user` — an edge you may store: `category:books#manager@user:7`.
- `permission manage = manager + platform->admin` — `+` is union. `X->Y` is an *arrow*:
  "follow the `X` relation, then evaluate `Y` on whatever is there". So
  `platform->admin` means "is this user an admin on the platform this category belongs
  to". Arrows are what make the hierarchy work without duplicating tuples.
- `payment` has **no** owner relation. `order->view` walks payment → order → owner.
  One edge (`payment:P#order@order:O`) buys you the whole ownership chain, and if you
  later transfer an order the payment follows automatically.

### Design notes

- **Product reads are absent on purpose.** `GET /products` is public today
  (`@Public()` on the controller) and should stay public. Don't model permissions you
  don't intend to enforce — every modelled permission is a tuple you must maintain.
- **`platform:main` is a hardcoded singleton.** Cheap now, and the day you need real
  tenants you change `platform:main` to `platform:<tenantId>` without touching any
  permission expression.
- **`seller` exists before vendors do.** Writing the relation now costs nothing; the
  first product-service tuple can populate `seller` with the admin who created it, and
  a real vendor flow drops in later with no schema migration.

### Validation

Put a companion `libs/common/src/authz/schema/ecommerce.validation.yaml` _(new)_ next
to it — this is SpiceDB's native test format, a schema plus assertions:

```yaml
schema: |-
  # (paste of ecommerce.zed, or use zed's --schema-file)
relationships: |-
  platform:main#administrator@user:admin1
  order:o1#owner@user:alice
  order:o1#platform@platform:main
  payment:p1#order@order:o1
assertions:
  assertTrue:
    - 'order:o1#view@user:alice'
    - 'order:o1#view@user:admin1'
    - 'order:o1#update_status@user:admin1'
    - 'payment:p1#refund@user:admin1'
  assertFalse:
    - 'order:o1#view@user:bob'
    - 'order:o1#update_status@user:alice'
    - 'payment:p1#refund@user:alice'
```

Run it with `zed validate libs/common/src/authz/schema/ecommerce.validation.yaml`.
Add that to CI. A schema change that silently widens `update_status` is exactly the kind
of bug no unit test in `apps/` will catch.

---

## 4. Relationship inventory

Every tuple in the system, who writes it, and when. Keep this table current — it *is*
the contract between services.

| Tuple | Written by | Trigger | Deleted on |
| --- | --- | --- | --- |
| `platform:main#administrator@user:<id>` | auth-service | register/promote with `role = admin` | demotion, user delete |
| `category:<id>#platform@platform:main` | product-service | `PRODUCT_MESSAGES.CATEGORY_CREATE` | category delete |
| `category:<id>#manager@user:<id>` | product-service | explicit assignment (future) | unassignment |
| `product:<id>#category@category:<id>` | product-service | `PRODUCT_MESSAGES.CREATE`, and on `UPDATE` if the category changed | product delete |
| `product:<id>#seller@user:<id>` | product-service | `PRODUCT_MESSAGES.CREATE` | product delete |
| `cart:<id>#owner@user:<id>` | cart-service | cart row creation | cart delete |
| `address:<id>#owner@user:<id>` | user-service | `ADDRESS_MESSAGES.CREATE` | `ADDRESS_MESSAGES.DELETE` |
| `order:<id>#owner@user:<id>` | orders-service | `ORDER_MESSAGES.CREATE` | never (orders are immutable history) |
| `order:<id>#platform@platform:main` | orders-service | `ORDER_MESSAGES.CREATE` | never |
| `payment:<id>#order@order:<id>` | payment-service | `PAYMENT_MESSAGES.CREATE` | never |

Note `cart`: the gateway's `DELETE /cart/:id` takes a **cart item** id, not a cart id
(`apps/api-gateway/src/cart/cart.controller.ts` sends `cartItemId`). Either model
`cart_item` with a `cart` arrow, or leave cart-item authorization to the service's
existing `userId` filter. Modelling one object per cart and letting the service scope
items is the simpler call.

---

## 5. Infrastructure

### 5.1 docker-compose-dev.yaml

Follows the file's existing one-Postgres-per-concern convention. `5439` is free
(auth 5433, product 5435, cart 5436, order 5437, user 5448).

```yaml
  postgres-spicedb:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: spicedb
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - '5439:5432'

  # one-shot: creates SpiceDB's own tables, then exits
  spicedb-migrate:
    image: authzed/spicedb:v1.35.3
    command: datastore migrate head
    environment:
      SPICEDB_DATASTORE_ENGINE: postgres
      SPICEDB_DATASTORE_CONN_URI: postgres://postgres:postgres@postgres-spicedb:5432/spicedb?sslmode=disable
    depends_on:
      - postgres-spicedb
    restart: on-failure

  spicedb:
    image: authzed/spicedb:v1.35.3
    command: serve
    environment:
      SPICEDB_GRPC_PRESHARED_KEY: dev-only-key
      SPICEDB_DATASTORE_ENGINE: postgres
      SPICEDB_DATASTORE_CONN_URI: postgres://postgres:postgres@postgres-spicedb:5432/spicedb?sslmode=disable
      SPICEDB_DISPATCH_UPSTREAM_ADDR: ''      # single node, no dispatch cluster
    ports:
      - '50051:50051'   # gRPC — what the services use
      - '8443:8443'     # HTTP/JSON gateway — handy for curl-ing a check
      - '9090:9090'     # Prometheus metrics
    depends_on:
      - spicedb-migrate
```

Pin the image tag. `latest` moving under you can change permission-check semantics.

Sanity check once it's up:

```bash
docker run --rm --network host authzed/zed:latest \
  --endpoint localhost:50051 --token dev-only-key --insecure \
  schema read
```

### 5.2 Helm

New `k8s/ecommerce/templates/spicedb/deployment.yaml` _(new)_ + `service.yaml` _(new)_,
shaped like `templates/redis/` — a `.Values.spicedb.enabled` flag so a local orbstack
run can keep pointing at the docker-compose container via `host.docker.internal`, and
`values-server.yaml` runs it in-cluster.

Values to add to `k8s/ecommerce/values.yaml`:

```yaml
# SpiceDB — the authorization database. enabled: false ⇒ use the docker-compose
# container on the host (same pattern as redis above).
spicedb:
  enabled: false
  host: host.docker.internal
  port: '50051'
  image: authzed/spicedb:v1.35.3
  insecure: true                  # plaintext gRPC; set false + mount TLS in prod
  dbHost: host.docker.internal
  dbPort: '5439'
  dbName: spicedb
  replicas: 1
  resources:
    requests: { cpu: 100m, memory: 256Mi }
    limits: { cpu: 1, memory: 1Gi }
```

Two things the deployment template needs that `redis` doesn't:

1. An **init container** running `datastore migrate head` before `serve`. SpiceDB
   refuses to start against an unmigrated datastore.
2. Probes on the HTTP port — `httpGet /healthz` on `8443`, not an `exec`.

The preshared key belongs in the existing `ecommerce-secrets`:

```bash
kubectl create secret generic ecommerce-secrets \
  --from-literal=db-password='...' \
  --from-literal=jwt-secret='...' \
  --from-literal=jwt-refresh-secret='...' \
  --from-literal=stripe-key='sk_test_...' \
  --from-literal=spicedb-token='...'            # ← new
```

### 5.3 Environment variables

Read through `ConfigService` (the pattern commit `debb7bd` established for the DB
config), not `process.env` directly:

| Variable | Default | Notes |
| --- | --- | --- |
| `SPICEDB_ENDPOINT` | `localhost:50051` | `host:port`, no scheme |
| `SPICEDB_TOKEN` | — | required; no fallback, unlike `JWT_SECRET`'s `'jwt-secret'` |
| `SPICEDB_INSECURE` | `true` | plaintext gRPC for local/in-cluster |
| `AUTHZ_ENFORCE` | `false` | shadow mode switch, see §13 |

Every gateway **and** every service that writes tuples needs these three, so they go
into each Helm deployment template. Deliberately give `SPICEDB_TOKEN` no default — a
service that silently starts with a wrong token fails every check at runtime instead of
at boot.

---

## 6. The shared library

```
libs/common/src/authz/                         (new)
├── authz.module.ts                # AuthzModule.forRoot() — the gRPC client provider
├── authz.service.ts               # check / write / delete / lookup
├── authz.constants.ts             # ResourceType + PERMISSIONS, like constants/messages.ts
├── require-permission.decorator.ts
├── permission.guard.ts
├── schema/
│   ├── ecommerce.zed
│   └── ecommerce.validation.yaml
└── index.ts
```

Then add `export * from './authz';` to `libs/common/src/index.ts`.

```bash
pnpm add @authzed/authzed-node
```

### 6.1 authz.constants.ts

Same shape as `constants/messages.ts` — never hardcode a type or permission string at a
call site.

```ts
export const SPICEDB_CLIENT = 'SPICEDB_CLIENT';

export const PLATFORM_ID = 'main';

export enum ResourceType {
  USER = 'user',
  PLATFORM = 'platform',
  CATEGORY = 'category',
  PRODUCT = 'product',
  CART = 'cart',
  ADDRESS = 'address',
  ORDER = 'order',
  PAYMENT = 'payment',
}

export const PERMISSIONS = {
  PLATFORM: { ADMIN: 'admin' },
  CATEGORY: { MANAGE: 'manage' },
  PRODUCT: { EDIT: 'edit', DELETE: 'delete' },
  CART: { READ: 'read', MODIFY: 'modify' },
  ADDRESS: { VIEW: 'view', MANAGE: 'manage' },
  ORDER: { VIEW: 'view', CANCEL: 'cancel', UPDATE_STATUS: 'update_status' },
  PAYMENT: { VIEW: 'view', REFUND: 'refund' },
} as const;

export const RELATIONS = {
  PLATFORM: { ADMINISTRATOR: 'administrator' },
  CATEGORY: { PLATFORM: 'platform', MANAGER: 'manager' },
  PRODUCT: { CATEGORY: 'category', SELLER: 'seller' },
  CART: { OWNER: 'owner' },
  ADDRESS: { OWNER: 'owner' },
  ORDER: { OWNER: 'owner', PLATFORM: 'platform' },
  PAYMENT: { ORDER: 'order' },
} as const;
```

### 6.2 authz.module.ts

One gRPC channel per process — a singleton provider, never a client per request.

```ts
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { v1 } from '@authzed/authzed-node';
import { SPICEDB_CLIENT } from './authz.constants';
import { AuthzService } from './authz.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: SPICEDB_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const token = config.get<string>('SPICEDB_TOKEN');
        if (!token) throw new Error('SPICEDB_TOKEN is required');

        const client = v1.NewClient(
          token,
          config.get<string>('SPICEDB_ENDPOINT') ?? 'localhost:50051',
          config.get('SPICEDB_INSECURE') === 'false'
            ? v1.ClientSecurity.SECURE
            : v1.ClientSecurity.INSECURE_LOCALHOST_ALLOWED,
        );
        return client.promises;           // promise-based facade over the gRPC stubs
      },
    },
    AuthzService,
  ],
  exports: [SPICEDB_CLIENT, AuthzService],
})
export class AuthzModule {}
```

### 6.3 authz.service.ts

Thin wrapper. The point is that no controller or service ever constructs a protobuf
message.

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { v1 } from '@authzed/authzed-node';
import { PLATFORM_ID, ResourceType, SPICEDB_CLIENT } from './authz.constants';

type Client = ReturnType<typeof v1.NewClient>['promises'];

export interface Subject {
  type?: ResourceType;      // defaults to user
  id: string;
}

@Injectable()
export class AuthzService {
  private readonly logger = new Logger(AuthzService.name);

  constructor(@Inject(SPICEDB_CLIENT) private readonly client: Client) {}

  private objectRef(type: string, id: string) {
    return v1.ObjectReference.create({ objectType: type, objectId: id });
  }

  private subjectRef(subject: Subject) {
    return v1.SubjectReference.create({
      object: this.objectRef(subject.type ?? ResourceType.USER, subject.id),
    });
  }

  /** minimizeLatency: serve from cache when possible. Pass a zedToken for read-after-write. */
  private consistency(zedToken?: string) {
    return zedToken
      ? v1.Consistency.create({
          requirement: {
            oneofKind: 'atLeastAsFresh',
            atLeastAsFresh: v1.ZedToken.create({ token: zedToken }),
          },
        })
      : v1.Consistency.create({
          requirement: { oneofKind: 'minimizeLatency', minimizeLatency: true },
        });
  }

  async check(
    subject: Subject,
    permission: string,
    resourceType: ResourceType,
    resourceId: string,
    zedToken?: string,
  ): Promise<boolean> {
    const res = await this.client.checkPermission(
      v1.CheckPermissionRequest.create({
        consistency: this.consistency(zedToken),
        resource: this.objectRef(resourceType, resourceId),
        permission,
        subject: this.subjectRef(subject),
      }),
    );
    return (
      res.permissionship ===
      v1.CheckPermissionResponse_Permissionship.HAS_PERMISSION
    );
  }

  /** TOUCH is idempotent — safe to retry, unlike CREATE. Returns the write's zedToken. */
  async write(
    updates: Array<{
      resourceType: ResourceType;
      resourceId: string;
      relation: string;
      subject: Subject;
    }>,
  ): Promise<string> {
    const res = await this.client.writeRelationships(
      v1.WriteRelationshipsRequest.create({
        updates: updates.map((u) =>
          v1.RelationshipUpdate.create({
            operation: v1.RelationshipUpdate_Operation.TOUCH,
            relationship: v1.Relationship.create({
              resource: this.objectRef(u.resourceType, u.resourceId),
              relation: u.relation,
              subject: this.subjectRef(u.subject),
            }),
          }),
        ),
      }),
    );
    return res.writtenAt?.token ?? '';
  }

  /** Delete every relationship on a resource — call this when the row is deleted. */
  async deleteResource(resourceType: ResourceType, resourceId: string) {
    await this.client.deleteRelationships(
      v1.DeleteRelationshipsRequest.create({
        relationshipFilter: v1.RelationshipFilter.create({
          resourceType,
          optionalResourceId: resourceId,
        }),
      }),
    );
  }

  /** Every resource id of `type` the subject has `permission` on. See §12. */
  async lookupResources(
    subject: Subject,
    permission: string,
    resourceType: ResourceType,
    zedToken?: string,
  ): Promise<string[]> {
    const results = await this.client.lookupResources(
      v1.LookupResourcesRequest.create({
        consistency: this.consistency(zedToken),
        resourceObjectType: resourceType,
        permission,
        subject: this.subjectRef(subject),
      }),
    );
    return results.map((r) => r.resourceObjectId);
  }

  /** Convenience: is this user a platform admin? */
  isAdmin(userId: string) {
    return this.check(
      { id: userId },
      'admin',
      ResourceType.PLATFORM,
      PLATFORM_ID,
    );
  }
}
```

### 6.4 require-permission.decorator.ts

```ts
import { SetMetadata } from '@nestjs/common';
import { ResourceType } from './authz.constants';

export const PERMISSION_KEY = 'authz:permission';

export interface PermissionMeta {
  type: ResourceType;
  permission: string;
  /** route param holding the resource id; omit for singleton resources */
  param?: string;
  /** fixed id, for singletons like platform:main */
  id?: string;
}

export const RequirePermission = (meta: PermissionMeta) =>
  SetMetadata(PERMISSION_KEY, meta);
```

### 6.5 permission.guard.ts

Mirrors `AccessTokenGuard` deliberately — same `Reflector` lookup, same throw style.

```ts
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AuthzService } from './authz.service';
import { PERMISSION_KEY, PermissionMeta } from './require-permission.decorator';
import type { JwtPayload } from '../interface';

@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly authz: AuthzService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<PermissionMeta>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!meta) return true;                       // unannotated → nothing to enforce

    const request = context.switchToHttp().getRequest();
    const user: JwtPayload | undefined = request.user;
    if (!user) throw new ForbiddenException();    // AccessTokenGuard should have run

    const resourceId = meta.id ?? request.params?.[meta.param ?? 'id'];
    if (!resourceId) throw new ForbiddenException('Resource id not resolvable');

    const enforce = this.config.get('AUTHZ_ENFORCE') === 'true';

    let allowed: boolean;
    try {
      allowed = await this.authz.check(
        { id: user.id },
        meta.permission,
        meta.type,
        resourceId,
      );
    } catch (err) {
      // fail CLOSED when enforcing: an authz outage must not become an authz bypass
      this.logger.error(`SpiceDB check failed: ${err}`);
      if (!enforce) return true;
      throw new ServiceUnavailableException('Authorization unavailable');
    }

    if (!enforce) {
      // shadow mode: log the decision, let the request through (§13)
      this.logger.log(
        `[shadow] ${allowed ? 'ALLOW' : 'DENY'} user:${user.id} ` +
          `${meta.permission} ${meta.type}:${resourceId}`,
      );
      return true;
    }

    if (!allowed) throw new ForbiddenException();
    return true;
  }
}
```

**Fail closed, not open.** This is the single most important line in the file. A guard
that returns `true` on a gRPC timeout turns a SpiceDB outage into a total authorization
bypass. In shadow mode it fails open because it isn't enforcing anything anyway.

---

## 7. Gateway wiring

`apps/api-gateway/src/api-gateway.module.ts`:

```ts
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthzModule,                                 // ← new
    HealthModule,
    AuthModule,
    JwtModule.register({ secret: process.env.JWT_SECRET || 'jwt-secret' }),
    ProductsModule,
    CartModule,
    OrdersModule,
    PaymentsModule,
    AddressesModule,
  ],
  controllers: [ApiGatewayController],
  providers: [
    ApiGatewayService,
    { provide: APP_GUARD, useClass: AccessTokenGuard },   // 1st: authentication
    { provide: APP_GUARD, useClass: PermissionGuard },    // 2nd: authorization
  ],
})
export class ApiGatewayModule {}
```

Order matters and is guaranteed: Nest executes global guards in registration order, so
`request.user` is populated before `PermissionGuard` reads it. Don't reverse them.

`@Public()` short-circuits `AccessTokenGuard` but **not** `PermissionGuard` — the guard
returns `true` only because no `@RequirePermission` metadata is present. If you ever put
both on the same handler, the permission check will run without a `request.user` and
403. Keep public routes unannotated.

---

## 8. Endpoint → permission map

| Endpoint | Controller | Annotation |
| --- | --- | --- |
| `GET /products`, `GET /products/:id` | products | `@Public()` — no annotation |
| `POST /products` | products | `@RequirePermission({ type: CATEGORY, permission: 'manage', param: 'categoryId' })` ¹ |
| `PATCH /products/:id` | products | `@RequirePermission({ type: PRODUCT, permission: 'edit' })` |
| `DELETE /products/:id` | products | `@RequirePermission({ type: PRODUCT, permission: 'delete' })` |
| `POST /categories` | categories | `@RequirePermission({ type: PLATFORM, permission: 'admin', id: PLATFORM_ID })` |
| `PATCH/DELETE /categories/:id` | categories | `@RequirePermission({ type: CATEGORY, permission: 'manage' })` |
| `GET /cart`, `POST /cart/items` | cart | none — scoped by `user.id` in the service |
| `DELETE /cart/:id` | cart | none — cart-item id, scoped by the service (§4) |
| `GET /addresses` | addresses | none — list scoped by `user.id` |
| `GET /addresses/:id` | addresses | `@RequirePermission({ type: ADDRESS, permission: 'view' })` |
| `PATCH/DELETE /addresses/:id`, `POST /addresses/:id/default` | addresses | `@RequirePermission({ type: ADDRESS, permission: 'manage' })` |
| `POST /orders` | orders | none — creating for yourself |
| `GET /orders` | orders | none for now; `LookupResources` in §12 |
| `GET /orders/:id` | orders | `@RequirePermission({ type: ORDER, permission: 'view' })` |
| `POST /orders/:id/cancel` | orders | `@RequirePermission({ type: ORDER, permission: 'cancel' })` |
| `GET /payments/:id` | payments | `@RequirePermission({ type: PAYMENT, permission: 'view' })` |
| `POST /payments/:id/refund` | payments | `@RequirePermission({ type: PAYMENT, permission: 'refund' })` |

¹ `POST /products` has no resource in the path — the category comes from the body, which
the param-based guard can't reach. Two clean options: check `platform:main#admin` at the
guard (simple, correct while only admins create products), or call `authz.check()`
directly at the top of the controller method once vendors exist. Don't teach the guard to
read the body; that couples it to DTO shapes.

Applied, an order endpoint looks like:

```ts
@Get(':id')
@RequirePermission({ type: ResourceType.ORDER, permission: PERMISSIONS.ORDER.VIEW })
findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
  return firstValueFrom(
    this.orderClient.send(ORDER_MESSAGES.FIND_ONE, { userId: user.id, id }),
  );
}
```

Note `userId` is still sent downstream and the service still filters on it. **Keep that.**
Defence in depth: the gateway check is the policy, the SQL filter is the backstop, and
during rollout the backstop is what makes shadow mode safe.

---

## 9. Service-side relationship writes

Import `AuthzModule` into each service's root module, then write tuples where rows are
created. `orders-service`:

```ts
// apps/orders-service/src/orders/orders.service.ts
async create(dto: CreateOrderDto & { userId: string }) {
  const order = await this.ordersRepository.save(/* … */);

  await this.authz.write([
    {
      resourceType: ResourceType.ORDER,
      resourceId: order.id,
      relation: RELATIONS.ORDER.OWNER,
      subject: { id: dto.userId },
    },
    {
      resourceType: ResourceType.ORDER,
      resourceId: order.id,
      relation: RELATIONS.ORDER.PLATFORM,
      subject: { type: ResourceType.PLATFORM, id: PLATFORM_ID },
    },
  ]);

  return order;
}
```

`product-service`, on create and on delete:

```ts
await this.authz.write([
  { resourceType: ResourceType.PRODUCT, resourceId: product.id,
    relation: RELATIONS.PRODUCT.CATEGORY,
    subject: { type: ResourceType.CATEGORY, id: product.categoryId } },
  { resourceType: ResourceType.PRODUCT, resourceId: product.id,
    relation: RELATIONS.PRODUCT.SELLER,
    subject: { id: actorUserId } },
]);

// on delete — otherwise you accumulate tuples for rows that no longer exist
await this.authz.deleteResource(ResourceType.PRODUCT, id);
```

`auth-service`, at registration:

```ts
if (user.role === UserRole.ADMIN) {
  await this.authz.write([{
    resourceType: ResourceType.PLATFORM,
    resourceId: PLATFORM_ID,
    relation: RELATIONS.PLATFORM.ADMINISTRATOR,
    subject: { id: user.id },
  }]);
}
```

### On category change

`PRODUCT_MESSAGES.UPDATE` can move a product between categories. The old
`#category` tuple must be deleted, not just the new one written — a product with two
category edges inherits `manage` from both. Delete-then-write, in one
`WriteRelationships` call using a `DELETE` op plus a `TOUCH` op so it's atomic.

---

## 10. Dual-write failure

Postgres and SpiceDB are two databases with no shared transaction. Three failure shapes,
in increasing cost to fix:

| Approach | Behaviour on tuple-write failure | Cost |
| --- | --- | --- |
| **Write tuple after commit, log on failure** | Row exists, unreachable by its owner. Backfill script repairs it. | ~zero — start here |
| **Write tuple inside the DB transaction, roll back on failure** | Order creation fails if SpiceDB is down. Correct, but couples order availability to authz availability. | low |
| **Outbox table + relay** | Row and a pending-tuple record commit atomically; a worker drains the outbox with retries. | real work, but the only fully correct answer |

Recommendation: ship option 1, make the backfill script (§11) idempotent and re-runnable,
and move to an outbox when order volume makes manual repair unacceptable. `TOUCH`
semantics mean re-running a write is always safe, which is what makes repair cheap.

---

## 11. Bootstrap and backfill scripts

Two scripts under `scripts/` _(new)_, matching the existing `scripts/` convention.

### scripts/authz-schema-push.ts

Pushes `ecommerce.zed` to the running SpiceDB. Idempotent — `WriteSchema` replaces the
whole schema. Add `"authz:schema": "ts-node scripts/authz-schema-push.ts"` to
`package.json` and call it from deploy, right where `migration:run` is called.

```ts
const schema = readFileSync('libs/common/src/authz/schema/ecommerce.zed', 'utf8');
await client.promises.writeSchema(v1.WriteSchemaRequest.create({ schema }));
```

Caveat: `WriteSchema` fails if the new schema would orphan existing relationships (e.g.
you removed a relation that still has tuples). That's a feature — it forces you to write
a tuple migration first.

### scripts/authz-backfill.ts

Reads every service's Postgres directly (the per-service `data-source.ts` files already
give you connection config) and writes the tuples from §4 in batches. `WriteRelationships`
caps at ~1000 updates per call, so chunk it.

```
users     → platform:main#administrator  (where role = 'admin')
categories→ category:<id>#platform@platform:main
products  → product:<id>#category@category:<categoryId>
addresses → address:<id>#owner@user:<userId>
orders    → order:<id>#owner@user:<userId>, order:<id>#platform@platform:main
payments  → payment:<id>#order@order:<orderId>
```

Make it re-runnable (all `TOUCH`) and give it a `--dry-run`. You will run it more than
once.

---

## 12. Consistency and ZedTokens

Every write returns a ZedToken — an opaque revision marker. Every read takes a
consistency requirement:

| Requirement | Meaning | Use for |
| --- | --- | --- |
| `minimizeLatency` | Serve from cache; may be slightly stale | Default for all checks |
| `atLeastAsFresh(token)` | No older than this revision | After a write the same user must immediately see |
| `atExactSnapshot(token)` | Exactly this revision | Paginating a `LookupResources` consistently |
| `fullyConsistent` | Bypass all caches | Rare; expensive; audit paths only |

The problem `atLeastAsFresh` solves — Zanzibar calls it the *new enemy problem*: a user
creates an order, immediately GETs it, and the check hits a replica that hasn't seen the
`#owner` tuple yet → a spurious 403.

Practical fix that fits this codebase: after any tuple write, store the returned ZedToken
in Redis (already running, already used by auth-service for refresh tokens) under
`authz:zedtoken:<userId>` with a short TTL — a minute is plenty. The gateway guard reads
it and passes it to `check()`. Cost is one Redis GET per authorized request; benefit is
no stale-denial bugs. Do this in phase 6, not day one — but know that if you see flaky
403s right after a create, this is why.

### List endpoints

`GET /orders` today asks orders-service for `WHERE user_id = ?`. The SpiceDB-native
version is:

```ts
const ids = await this.authz.lookupResources(
  { id: user.id }, PERMISSIONS.ORDER.VIEW, ResourceType.ORDER,
);
// → send ids downstream, service does WHERE id = ANY($1)
```

This is the payoff — an admin's `GET /orders` returns everything, a support agent's
returns only their assigned orders, with no per-role SQL branching. But it's also the
riskiest change: it moves pagination and sorting into a two-step dance, and
`LookupResources` on a user with 100k orders returns 100k ids. Leave list endpoints on
SQL filtering until you actually have a role whose visibility isn't expressible as a
`WHERE` clause.

---

## 13. Shadow mode

`AUTHZ_ENFORCE=false` (the default) makes `PermissionGuard` compute the decision, log it,
and allow the request. That gives you a real-traffic diff between "what SpiceDB thinks"
and "what the app currently does" before anything can 403 a paying customer.

Grep the gateway logs for `[shadow] DENY`. Every hit is either a missing tuple (backfill
gap) or a schema bug. Only flip `AUTHZ_ENFORCE=true` when that line is quiet for a full
day of traffic.

---

## 14. Testing

**Schema tests** — `zed validate` on the validation yaml (§3). Fast, no containers, catches
permission-expression regressions. Put it in CI.

**Unit tests** — mock `AuthzService`. `PermissionGuard` deserves real coverage:
unannotated handler → `true`; missing `request.user` → 403; check `false` + enforce →
403; check throws + enforce → 503; check throws + shadow → `true`.

**E2E** — SpiceDB ships a purpose-built ephemeral server:

```bash
docker run --rm -p 50051:50051 authzed/spicedb serve-testing
```

In-memory, no migrations, and each distinct preshared token gets its own isolated
datastore — so parallel Jest workers can each use their own token and never collide. Point
`SPICEDB_ENDPOINT` at it from `apps/*/test/` and push the schema in a `beforeAll`.

---

## 15. Rollout plan

| Phase | Work | Reversible? |
| --- | --- | --- |
| **1. Infra** | docker-compose services, Helm template, values, secret key, env vars | yes — nothing reads it |
| **2. Library** | `libs/common/src/authz/*`, schema, validation yaml, `authz-schema-push.ts` | yes |
| **3. Shadow** | Register `PermissionGuard`, annotate handlers, `AUTHZ_ENFORCE=false` | yes — allows everything |
| **4. Backfill** | `authz-backfill.ts`, plus tuple writes in each service's create/delete paths | yes — tuples are additive |
| **5. Enforce** | `AUTHZ_ENFORCE=true` once shadow logs are clean. Fix products' class-level `@Public()` at the same time (§16). | env flag flip |
| **6. Optimise** | Redis ZedToken cache, `LookupResources` on list endpoints, real vendor `seller` tuples | incremental |

Phases 1–3 are safe to merge in any order relative to feature work. Phase 5 is the only
one that can break a request.

---

## 16. What this fixes in the current code

Found while surveying the gateway for this plan — worth fixing regardless of whether
SpiceDB ships:

1. **`apps/api-gateway/src/products/products.controller.ts:20` — `@Public()` is on the
   whole class.** `POST`, `PATCH`, and `DELETE /products` are unauthenticated today.
   Anyone can create or delete a product. Move `@Public()` onto `findAll` and `findOne`
   only. This is the highest-value single line in the whole plan.
2. **`apps/api-gateway/src/payments/payments.controller.ts`** — `findOne`, `update`, and
   `remove` never read `@CurrentUser()`, and `findAll` sends a hardcoded
   `{ id: 'hii' }`. Any authenticated user can read any payment by id. The `payment`
   definition in §3 closes this.
3. **`apps/api-gateway/src/orders/orders.controller.ts`** — ownership is enforced only by
   the `userId` the gateway passes down. That's correct today but invisible: nothing in
   the controller says "this is an ownership check", so the next endpoint that forgets to
   pass `userId` silently becomes an IDOR. `@RequirePermission` makes the intent
   declarative and greppable.
4. **`ORDER_MESSAGES.UPDATE_STATUS` has no admin gate** anywhere in the gateway — there's
   no controller route for it yet, but when one is added it needs
   `platform:main#admin`, not a `role === 'admin'` string comparison.

---

## 17. Operational notes

- **Latency** — one `CheckPermission` adds roughly 1–5 ms in-cluster against a warm
  cache. It's one extra gRPC hop on an already multi-hop request (HTTP → gateway → TCP →
  service → Postgres). Annotate only handlers that need it; the guard is free when no
  metadata is present.
- **Connection reuse** — the client is a singleton provider. gRPC multiplexes over one
  HTTP/2 channel; creating a client per request will exhaust file descriptors.
- **Don't cache decisions in the app.** SpiceDB's own cache is revision-aware; yours
  isn't, and a stale allow is a security bug. Cache the ZedToken, never the boolean.
- **Metrics** — SpiceDB exposes Prometheus on `:9090`. Watch `spicedb_check_duration`
  and the dispatch cache hit rate. On the app side, count 403s by
  `permission`/`resourceType`; a spike after a deploy means a tuple write regressed.
- **Backup** — the SpiceDB Postgres is now security-critical state. It belongs in the
  same backup policy as `auth_db`. Losing it locks every user out of their own data.
- **`zed` CLI** is worth installing locally (`brew install authzed/tap/zed`). `zed
  permission check order:<id> view user:<id>` during debugging beats adding log lines.

---

## 18. Reference

- SpiceDB docs: https://authzed.com/docs/spicedb/getting-started/discovering-spicedb
- Schema language: https://authzed.com/docs/spicedb/concepts/schema
- Consistency / ZedTokens: https://authzed.com/docs/spicedb/concepts/consistency
- Zanzibar paper: https://research.google/pubs/pub48190/
- Node client: https://github.com/authzed/authzed-node
- Playground (draft schemas in-browser): https://play.authzed.com
