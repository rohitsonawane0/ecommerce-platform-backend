# Migrations

`synchronize` is off everywhere. Schema changes happen through TypeORM migrations only.

Env prefix per service — they are **not** uniform:

| Service | Prefix | Database |
| --- | --- | --- |
| auth-service | `DB_` | `auth_db` |
| product-service | `PRODUCT_DB_` | `product_db` |
| cart-service | `CART_DB_` | `cart_db` |
| orders-service | `ORDER_DB_` (singular) | `order_db` |
| user-service | `USER_DB_` | `user_db` |

---

## Add a migration

```bash
# 1. generate — path is a positional arg
pnpm mig:gen:product apps/product-service/src/migrations/AddProductSku

# 2. import it into apps/product-service/src/data-source.ts
#      import { AddProductSku... } from './migrations/...-AddProductSku';
#      migrations: [InitialSchema..., AddProductSku...],

# 3. read the generated SQL, then run it
pnpm mig:run:product
```

**Step 2 is not optional.** `nest build` bundles with webpack, so there are no per-file
migration modules for a glob to match — an unimported migration is invisible to both the
CLI and the app. Every migration adds one import line.

Other commands: `mig:show:*` (`[X]` = applied), `mig:revert:*` (undoes the latest one).
Swap `product` for `auth` / `cart` / `order` / `user`. Note the script suffix is `order`,
not `orders`.

---

## Check what's applied

Against docker-compose, no env needed:

```bash
pnpm mig:show:product
```

Against the cluster, with a port-forward open (see below) — this is the only way to see
**pending** migrations, `[ ]` vs `[X]`:

```bash
PRODUCT_DB_HOST=localhost PRODUCT_DB_PORT=15432 \
PRODUCT_DB_PASSWORD=$(kubectl get secret ecommerce-secrets -o jsonpath='{.data.db-password}' | base64 -d) \
  pnpm mig:show:product
```

Or read the table directly, which needs no port-forward but only shows what has already
been applied — unapplied migrations aren't in the table:

```bash
kubectl exec postgres-0 -- psql -U postgres -d product_db \
  -c 'select id, timestamp, name from migrations order by timestamp'
```

`kubectl exec … migrate` cannot do this — that entrypoint only calls `runMigrations()`.

---

## Run against local docker-compose

Ports match the DataSource defaults, so no env needed:

```bash
docker compose -f docker-compose-dev.yaml up -d
pnpm mig:run:product
```

## Run against Kubernetes

The runtime image has no ts-node and no sources, so the `pnpm mig:*` CLI cannot run
in-cluster. Each service instead ships a second bundle, `migrate.js`, built from
`src/migrate.ts`. The pod already has its `*_DB_*` env, so nothing needs passing:

```bash
kubectl exec deploy/product-service -- node dist/apps/product-service/migrate
```

Output is `no pending migrations` or `applied 1: AddProductSku…`; non-zero exit on failure.

**The image must contain `migrate.js`.** Fastest local loop — orbstack shares the Docker
image store, so no registry round trip:

```bash
docker build -f apps/product-service/Dockerfile -t rohitf116/product-service:dev .
kubectl set image deploy/product-service product-service=rohitf116/product-service:dev
kubectl rollout status deploy/product-service
```

### Or from your laptop over a port-forward

```bash
kubectl port-forward svc/postgres 15432:5432          # NOT 5432 — see gotchas
PGPW=$(kubectl get secret ecommerce-secrets -o jsonpath='{.data.db-password}' | base64 -d)
PRODUCT_DB_HOST=localhost PRODUCT_DB_PORT=15432 PRODUCT_DB_PASSWORD="$PGPW" pnpm mig:run:product
```

---

## Gotchas

**Build order, and `deleteOutDir`.** `main.js` and `migrate.js` land in the *same*
`dist/apps/product-service/` — nest-cli names output after `entryFile` and ignores the
tsconfig `outDir` in monorepo mode. The app project has `deleteOutDir: true` and wipes the
directory, so it must build **first**; the `-migrations` project sets `deleteOutDir: false`
and adds `migrate.js` alongside. Reversed, the image ships without `migrate.js`.

**Reusing an image tag silently runs stale code.** `global.imagePullPolicy` is
`IfNotPresent`, so pushing new content to an existing tag does nothing — the node keeps the
copy it has, and `rollout restart` won't re-pull. Bump `global.tag`, use a fresh tag, or
compare digests:

```bash
kubectl get pod -l app=product-service -o jsonpath='{.items[0].status.containerStatuses[0].imageID}'
docker buildx imagetools inspect docker.io/rohitf116/product-service:0.2.0 | grep Digest
```

Also: `--set global.tag=X` applies to **all seven** services. Set it to a tag only one
service has and the other six go `ImagePullBackOff`.

**Port 5432 is taken** by a local Postgres on the dev Mac. Forward to 15432. If you
forward to 5432 the connection silently reaches the *local* server instead — migrations
could land in the wrong database.

**`uuid-ossp`.** Every table defaults its id to `uuid_generate_v4()`. `synchronize` used to
install the extension implicitly; migrations must ask, so each `up()` starts with
`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`. Keep that in new migrations that create
tables, or the first run against a fresh database fails.

**Generating needs an empty database.** `migration:generate` emits the diff against the
*live* schema. Against an already-migrated database you get
`No changes in database schema were found` — that is correct behaviour, not an error.

---

## Writing migrations that don't cause downtime

During a rolling update, old and new code run against the same schema. Expand → migrate →
contract:

| Goal | Wrong | Right |
| --- | --- | --- |
| Rename a column | one migration renaming it | add new → backfill → deploy code using it → drop old in a later release |
| Add `NOT NULL` | add with the constraint | add nullable with default → backfill → add constraint |
| Drop a column | drop it | stop using it, ship, drop in a later release |
| Add an index | `CREATE INDEX` | `CREATE INDEX CONCURRENTLY`, outside a transaction |

Rule: a migration must be safe against the **previous** release's code.

TypeORM cannot detect renames — it emits drop-then-add, which loses the data. Hand-edit to
`ALTER TABLE … RENAME COLUMN`. And `down()` is generated and frequently wrong; verify it
locally before relying on it. For destructive changes, backups are the real rollback.

---

## Not done yet

Migrations run by hand. Making them automatic on deploy means a Helm `pre-upgrade` Job per
service that runs the same `migrate.js` — a failed Job aborts the upgrade without touching
running pods. Only product-service currently has `src/migrate.ts` and a
`product-service-migrations` project in `nest-cli.json`; the other four still need both.
