# TypeORM Migrations — Plan & Guide

Replacing `synchronize: true` with reviewed, versioned migrations across all five
database-owning services.

**Decisions taken** (see [Decisions](#decisions-and-why) for reasoning):

| Question | Choice |
| --- | --- |
| How migrations run on deploy | **Helm `pre-upgrade` Job per service** |
| Existing schemas | **Drop and recreate** from the initial migration |
| Local development | **Migrations everywhere** — `synchronize: false` in all environments |

---

## Why this matters

`synchronize: true` diffs your entities against the live schema **on every boot** and alters
the database to match. It is convenient and it will eventually destroy data:

- Rename a property → TypeORM drops the old column and creates a new empty one. The data is gone.
- Narrow a type (`text` → `varchar(50)`) → silently truncates or fails mid-startup.
- Two replicas boot simultaneously → both try to alter the same table.
- The change is invisible: no diff, no review, no record of what ran.

Migrations make every schema change an explicit, reviewable, version-controlled file that runs
exactly once and can be rolled back.

**Current state:** `synchronize: true` in all five services, no DataSource files, no migrations
directory, no CLI scripts. Nothing to unwind — this is a clean start.

### Services in scope

| Service | Database | Entities |
| --- | --- | --- |
| auth-service | `auth_db` | `User` |
| product-service | `product_db` | `Product`, `Category` |
| cart-service | `cart_db` | `Cart`, `CartItem` |
| orders-service | `order_db` | `Order`, `OrderItem` |
| user-service | `user_db` | `Address` |

payment-service and api-gateway have no database and are unaffected. (`payment.entity.ts` and
`stripe.entity.ts` are empty scaffold classes — not real entities.)

---

## The one constraint that shapes everything: no globs

Standard TypeORM guides write:

```ts
entities: ['dist/**/*.entity.js'],
migrations: ['dist/migrations/*.js'],
```

**That cannot work here.** `nest-cli.json` sets `webpack: true`, so `nest build` produces a
single bundled `main.js` per service — there are no individual `.entity.js` files on disk for a
glob to find, and webpack cannot resolve a runtime glob at build time.

So every DataSource must use **explicit imports**:

```ts
entities: [User],
migrations: [InitialSchema1730000000000],
```

More verbose, but it works identically under ts-node, under webpack, and in the container. Every
new migration adds one import line — treat that as part of writing the migration.

---

## Step 1 — A DataSource per service

The TypeORM CLI needs a standalone `DataSource` it can import without booting Nest. Create one
per service, and have the Nest module reuse its options so the two can never drift.

`apps/auth-service/src/data-source.ts`:

```ts
import 'dotenv/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import { User } from './auth/entities/user.entity';

export const authDataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5433', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'auth_db',
  entities: [User],
  migrations: [], // add each generated migration here
  synchronize: false, // never true again
  migrationsRun: false, // the Job runs them, not the app
};

export default new DataSource(authDataSourceOptions);
```

Then in `auth-service.module.ts`:

```ts
TypeOrmModule.forRoot(authDataSourceOptions),
```

Repeat per service with its own env prefix (`PRODUCT_DB_*`, `CART_DB_*`, `ORDER_DB_*` — note
singular — and `USER_DB_*`) and its own entities.

Two things to note:

- `import 'dotenv/config'` is required because the CLI runs outside Nest, so `ConfigModule`
  never loads `.env`. `dotenv` is already present as a transitive dependency of `@nestjs/config`;
  add it explicitly to `dependencies` rather than relying on that.
- `autoLoadEntities: true` disappears. It only works through `TypeOrmModule.forFeature()`, and
  the CLI has no such thing. Explicit `entities` arrays are the price of a working CLI.

---

## Step 2 — CLI scripts

`package.json`:

**Already added to `package.json`** — one `typeorm` runner plus five commands each for
`auth`, `product`, `cart`, `order`, `user`:

```json
{
  "scripts": {
    "typeorm": "TS_NODE_COMPILER_OPTIONS='{\"module\":\"commonjs\"}' node -r ts-node/register -r tsconfig-paths/register ./node_modules/typeorm/cli.js",

    "mig:gen:auth":    "pnpm typeorm migration:generate -d apps/auth-service/src/data-source.ts",
    "mig:create:auth": "pnpm typeorm migration:create",
    "mig:run:auth":    "pnpm typeorm migration:run    -d apps/auth-service/src/data-source.ts",
    "mig:revert:auth": "pnpm typeorm migration:revert -d apps/auth-service/src/data-source.ts",
    "mig:show:auth":   "pnpm typeorm migration:show   -d apps/auth-service/src/data-source.ts"
  }
}
```

The output path is passed as a positional argument rather than baked in, because TypeORM takes
it positionally and it changes per migration:

```bash
pnpm mig:gen:auth apps/auth-service/src/migrations/InitialSchema
pnpm mig:show:auth
```

**Verified working** — all five `mig:show:*` connect to their databases successfully.

`TS_NODE_COMPILER_OPTIONS` is not optional: the root `tsconfig.json` sets
`"module": "nodenext"`, which ts-node cannot execute directly for the CLI. Overriding to
`commonjs` for this one command avoids converting the whole project.

`tsconfig-paths/register` is what makes `@app/common` resolve outside Nest.

---

## Step 3 — Turn synchronize off

In all five `*-service.module.ts` files, `TypeOrmModule.forRoot({...})` is replaced by the
shared options object from Step 1, which has `synchronize: false`.

Verify none survive:

```bash
grep -rn "synchronize" apps/ | grep -v node_modules
# every hit must be `synchronize: false`
```

---

## Step 4 — Drop first, then generate

> **Order matters, and it's the opposite of what you'd expect.**
> `migration:generate` emits the *diff* between the entities and the **live** schema. Your
> databases were already built by `synchronize`, so they match the entities exactly and the
> CLI correctly reports:
>
> ```
> No changes in database schema were found - cannot generate a migration.
> ```
>
> To get a full initial schema you must diff against an **empty** database. So drop first,
> then generate, then run.

**Local:**

```bash
docker compose -f docker-compose-dev.yaml down -v    # deletes the volumes
docker compose -f docker-compose-dev.yaml up -d      # empty databases

pnpm mig:gen:auth    apps/auth-service/src/migrations/InitialSchema
pnpm mig:gen:product apps/product-service/src/migrations/InitialSchema
pnpm mig:gen:cart    apps/cart-service/src/migrations/InitialSchema
pnpm mig:gen:order   apps/orders-service/src/migrations/InitialSchema
pnpm mig:gen:user    apps/user-service/src/migrations/InitialSchema
```

Each writes `apps/<svc>/src/migrations/<timestamp>-InitialSchema.ts`. **Import each one into
its DataSource's `migrations` array** — with no globs, an unimported migration is invisible.

### Read every generated migration before committing

This is the habit that makes migrations worth having. Check specifically:

- `DROP COLUMN` / `DROP TABLE` — is that intentional?
- Column renames rendered as drop-then-add (TypeORM cannot detect renames — you must hand-edit
  to `ALTER TABLE ... RENAME COLUMN` or lose the data)
- `NOT NULL` added to a populated table with no default → fails on non-empty data
- Index creation on a large table → locks; use `CREATE INDEX CONCURRENTLY` by hand
- The `down()` method — TypeORM's generated version is often wrong or incomplete

---

## Step 5 — Apply them

The databases are still empty from step 4 — generating a migration does not run it.

```bash
pnpm mig:run:auth && pnpm mig:run:product && pnpm mig:run:cart \
  && pnpm mig:run:order && pnpm mig:run:user
```

**Server** (the databases there are empty anyway):

```bash
export KUBECONFIG=~/.kube/hetzner.yaml
kubectl exec postgres-0 -- psql -U postgres -c "DROP DATABASE auth_db;"
kubectl exec postgres-0 -- psql -U postgres -c "CREATE DATABASE auth_db;"
# …repeat per database, or delete the PVC and let the init script rebuild all five
```

Confirm afterwards:

```bash
pnpm mig:show:auth     # [X] InitialSchema…  — the X means applied
```

---

## Step 6 — Build a migration entrypoint into each image

The Job needs to run migrations inside the cluster, where there is no ts-node, no devDeps, and
no source. So each service gets a second tiny entrypoint that webpack bundles alongside the app.

`apps/auth-service/src/migrate.ts`:

```ts
import dataSource from './data-source';

async function run() {
  await dataSource.initialize();
  const applied = await dataSource.runMigrations();
  console.log(
    applied.length
      ? `applied ${applied.length}: ${applied.map((m) => m.name).join(', ')}`
      : 'no pending migrations',
  );
  await dataSource.destroy();
}

run().catch((err) => {
  console.error(err);
  process.exit(1); // non-zero fails the Job, which aborts the Helm upgrade
});
```

Register it in `nest-cli.json` as its own project:

```json
"auth-service-migrations": {
  "type": "application",
  "root": "apps/auth-service",
  "entryFile": "migrate",
  "sourceRoot": "apps/auth-service/src",
  "compilerOptions": { "tsConfigPath": "apps/auth-service/tsconfig.app.json" }
}
```

And build both in the service's Dockerfile:

```dockerfile
RUN pnpm exec nest build auth-service-migrations \
 && pnpm exec nest build auth-service
```

> **Order matters.** `nest-cli.json` has `"deleteOutDir": true`, so each build wipes `dist/`
> first. Build migrations **first** and the app second, or set `deleteOutDir: false`. Getting
> this backwards produces an image whose migration entrypoint silently doesn't exist.

Then copy both outputs in the runner stage:

```dockerfile
COPY --from=build /app/dist/apps/auth-service ./dist/apps/auth-service
COPY --from=build /app/dist/apps/auth-service-migrations ./dist/apps/auth-service-migrations
```

The migration command in-cluster is then just
`node dist/apps/auth-service-migrations/main.js` — same image, same env vars, same secret.

---

## Step 7 — Helm pre-upgrade Job

`k8s/ecommerce/templates/auth-service/migration-job.yaml`:

```yaml
{{- if .Values.migrations.enabled }}
{{- $svc := .Values.services.auth }}
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ $svc.name }}-migrate-{{ .Release.Revision }}
  annotations:
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-weight": "0"
    "helm.sh/hook-delete-policy": before-hook-creation
spec:
  backoffLimit: 1
  ttlSecondsAfterFinished: 300
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: {{ include "ecommerce.image" (dict "svc" $svc "root" $) }}
          command: ['node', 'dist/apps/auth-service-migrations/main.js']
          env:
            # identical DB env to the Deployment
{{- end }}
```

What each annotation does:

| Annotation | Effect |
| --- | --- |
| `pre-install,pre-upgrade` | Runs **before** the Deployments are updated |
| `hook-weight` | Ordering across hooks; all migrations can share weight `0` since they touch different databases |
| `hook-delete-policy: before-hook-creation` | Deletes the previous Job so the name can be reused |
| `{{ .Release.Revision }}` in the name | A fresh Job per deploy — Jobs are immutable and cannot be patched |
| `backoffLimit: 1` | Fail fast instead of retrying a broken migration |

**If a Job fails, `helm upgrade` aborts and the running pods are never touched.** That property
is the whole reason for choosing this strategy.

Add `migrations.enabled: true` to `values.yaml`, and keep a way to skip it
(`--set migrations.enabled=false`) for the occasions you need to deploy without migrating.

---

## Step 8 — The deploy flow afterwards

```bash
# 1. change an entity
# 2. generate + review
pnpm mig:gen:product --name=AddProductSku
#    → import it into product-service's DataSource migrations array
#    → READ THE SQL
# 3. test locally
pnpm mig:run:product
pnpm mig:revert:product   # prove down() works
pnpm mig:run:product
# 4. commit migration + entity together, build and push images
# 5. deploy — the pre-upgrade Job applies it before pods roll
helm upgrade --install ecommerce . -f values.yaml -f values-server.yaml
```

---

## Writing migrations that don't cause downtime

During a rolling update, **old and new code run against the same schema simultaneously.** A
migration that's valid in isolation can still break the pods that haven't rolled yet.

Use expand → migrate → contract:

| Goal | Wrong | Right |
| --- | --- | --- |
| Rename `name` → `title` | one migration renaming it | ① add `title`, backfill, deploy code writing both ② deploy code reading `title` ③ later migration drops `name` |
| Add a `NOT NULL` column | add with `NOT NULL` | ① add nullable with a default ② backfill ③ add the constraint |
| Drop a column | drop it | ① deploy code that stops using it ② drop it in a later release |
| Add an index | `CREATE INDEX` | `CREATE INDEX CONCURRENTLY` outside a transaction |

Rule of thumb: **a migration should be safe against the previous release's code.** Anything that
isn't needs to be split across two deploys.

### Rollback

```bash
pnpm mig:revert:auth     # reverts the single most recent migration
```

`down()` is generated by TypeORM and is frequently wrong — verify it locally before you ever
need it in anger. Note that some changes cannot be reverted at all: once a `DROP COLUMN` runs,
`down()` recreates an empty column, not your data. **Backups, not `down()`, are the real
rollback for destructive changes.**

---

## Decisions and why

**Helm pre-upgrade Job.** Runs exactly once per deploy regardless of replica count, and a
failure aborts the upgrade with the old pods still serving. The alternatives all couple schema
changes to pod startup: `migrationsRun: true` and initContainers both mean every replica races
to migrate, and a bad migration turns into a CrashLoopBackOff rather than a clean, aborted
deploy.

**Drop and recreate.** Schemas built by `synchronize` often differ subtly from what a generated
migration expects — extra indexes, different constraint names — and baselining those differences
away hides drift you'd rather see now. Your data is reproducible seed data, so the clean history
is worth more.

**Migrations everywhere.** With `synchronize: true` locally, migrations only get exercised at
deploy time, and entity/migration drift is found in production. The cost is one command after an
entity change; the benefit is that broken migrations fail on your laptop.

---

## Gotchas

| Symptom | Cause |
| --- | --- |
| `No migrations are pending` when you know there are | Migration not imported into the DataSource's `migrations` array (no globs here) |
| `Unable to open file: ".../data-source.ts"` | Missing `TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}'` — the root tsconfig is `nodenext` |
| `Cannot find module '@app/common'` in the CLI | `tsconfig-paths/register` missing from the `typeorm` script |
| `migration:generate` produces an empty migration | Entities not listed in the DataSource, or nothing actually changed |
| Generated migration wants to drop everything | The DataSource is pointed at the wrong database — check the env prefix (`ORDER_DB_*`, not `ORDERS_DB_*`) |
| Migration entrypoint missing from the image | `deleteOutDir: true` wiped it — build migrations before the app |
| Job runs but the app still fails on schema | The Job used a different database than the Deployment; the env blocks must match |
| Renamed column lost its data | TypeORM emitted drop+add. Hand-edit to `RENAME COLUMN` |

---

## Checklist

- [ ] `dotenv` added to `dependencies`
- [ ] `data-source.ts` for all 5 services, entities imported explicitly
- [ ] `*-service.module.ts` uses the shared options object
- [ ] `synchronize` is `false` everywhere (`grep` to confirm)
- [ ] `typeorm` + 20 `mig:*` scripts in `package.json`
- [ ] Initial migration generated, **read**, and imported per service
- [ ] Databases dropped and rebuilt from migrations, `mig:show` confirms
- [ ] `migrate.ts` per service, registered in `nest-cli.json`
- [ ] Dockerfiles build the migration entry **first**, then the app
- [ ] Migration Job template per service, `migrations.enabled` in values
- [ ] One full deploy verified end to end, including a deliberately failing migration to prove
      the upgrade aborts cleanly
- [ ] `PROGRESS.md` and `CLAUDE.md` updated — both currently state `synchronize: true`
