# Production Kubernetes Hosting Plan

**Target stack:** self-managed / on-prem Kubernetes · Helm chart + Argo CD GitOps · Kong Ingress Controller · CloudNativePG + Redis in-cluster

**Scope:** everything needed to take this repo from `pnpm run start:all` on a laptop to a self-hosted production cluster you operate yourself — including the application changes that are *prerequisites* (there are several, some are blockers).

**Audience:** you, as the operator and architect. Reference manifests are in the [appendices](#appendix-a--dockerfile-pnpm-nestjs-monorepo); the body is the plan and the reasoning.

---

## Table of contents

1. [Where the repo stands today](#1-where-the-repo-stands-today)
2. [Blockers: app changes required before hosting](#2-blockers-app-changes-required-before-hosting)
3. [Target production topology](#3-target-production-topology)
4. [Cluster build (self-managed)](#4-cluster-build-self-managed)
5. [Namespace & tenancy layout](#5-namespace--tenancy-layout)
6. [Data layer: Postgres, Redis, NATS](#6-data-layer-postgres-redis-nats)
7. [Config & secrets](#7-config--secrets)
8. [Workload spec: resources, probes, disruption](#8-workload-spec-resources-probes-disruption)
9. [Edge: Kong Ingress Controller + TLS](#9-edge-kong-ingress-controller--tls)
10. [Helm chart layout](#10-helm-chart-layout)
11. [Argo CD GitOps](#11-argo-cd-gitops)
12. [Rollouts, migrations & rollback runbook](#12-rollouts-migrations--rollback-runbook)
13. [Observability & SLOs](#13-observability--slos)
14. [Security hardening](#14-security-hardening)
15. [Backup & disaster recovery](#15-backup--disaster-recovery)
16. [Capacity & sizing](#16-capacity--sizing)
17. [Phased delivery plan](#17-phased-delivery-plan)
18. [Production readiness gate](#18-production-readiness-gate)
19. [Appendices (YAML & code)](#appendix-a--dockerfile-pnpm-nestjs-monorepo)

---

## 1. Where the repo stands today

| Component | Project name | Transport | Port | State store |
|---|---|---|---|---|
| API gateway | `api-gateway` | HTTP (Express) | 3000 | — |
| Auth | `auth-service` | TCP | 3001 | Postgres `auth_db` + Redis |
| Product | `product-service` | TCP | 3002 | Postgres `product_db` |
| Cart | `cart-service` | TCP | 3003 | Postgres `cart_db` |
| Orders | `orders-service` | TCP | 3004 | Postgres `order_db` |
| Payment | `payment-service` | TCP | 3005 | none found (Stripe only) |
| User | `user-service` | TCP | 3006 | Postgres `user_db` |

**What is already container/K8s-friendly:**

- Every host, port, credential and secret is read from `process.env` with a fallback — no hardcoded production values. This is the single biggest thing that usually needs rewriting, and it's already done.
- Microservices bind `0.0.0.0` by default (`SERVICE_HOST`), so they work inside a pod without change.
- All six TCP services call `app.enableShutdownHooks()` — SIGTERM handling is wired.
- Gateway is stateless: JWT verification only, no session affinity needed.
- Errors are normalised (`AllExceptionsFilter`, `AllRpcExceptionsFilter`) and responses wrapped (`ResponseInterceptor`).

**What is missing entirely:** Dockerfiles, health/readiness endpoints, DB migrations, metrics, structured logging, and any Kubernetes manifests. Section 2 covers these.

---

## 2. Blockers: app changes required before hosting

Ordered by how badly they hurt in production. **B1–B4 are hard blockers** — deploying without them gives you a cluster that looks healthy and behaves incorrectly.

### B1 — TCP transport does not load-balance behind a ClusterIP ⛔ *highest leverage*

This is the most important architectural issue in the repo, and it is invisible until you scale.

`ClientsModule.register({ transport: Transport.TCP })` opens **one long-lived TCP socket** from the gateway to the target. A Kubernetes ClusterIP does its DNAT **once, at connection establishment**, then pins that connection to the chosen backend pod for its entire lifetime.

```
                  Service ClusterIP picks a backend ONCE, at connect time
                  ↓
  gateway pod A ──┬──────────────────────────────────────▶ auth pod 1   ← receives 100% of A's traffic
                  │
  gateway pod B ──┴──────────────────────────────────────▶ auth pod 1   ← may pick the SAME pod
                                                            auth pod 2   ← idle forever
                                                            auth pod 3   ← idle forever
```

Consequences:

- **Scaling a backend does nothing.** With 2 gateway replicas, at most 2 auth pods ever receive a request, no matter what the HPA does.
- **HPA on backend CPU is meaningless** — most replicas sit at 0% and the loaded ones never trigger a useful scale decision.
- **Rolling a backend breaks in-flight requests.** When the pinned pod terminates, the socket dies; `ClientProxy` reconnects, but requests in flight fail.

**Recommended fix — move inter-service transport to NATS.** It is a config-only change: message patterns, DTOs, controllers and `@MessagePattern` handlers all stay identical.

```ts
// microservice side (apps/*/src/main.ts)
transport: Transport.NATS,
options: { servers: [process.env.NATS_URL], queue: 'auth-service' },

// gateway side (apps/api-gateway/src/*/**.module.ts)
transport: Transport.NATS,
options: { servers: [process.env.NATS_URL], queue: 'api-gateway' },
```

NATS **queue groups** distribute each request across all healthy subscribers, so scaling works, pod churn is invisible to callers, and you can autoscale on queue depth via KEDA. It also removes every `*_SERVICE_HOST` / `*_SERVICE_PORT` variable from the gateway. Cost: one more in-cluster dependency (3-node NATS StatefulSet, ~64Mi/pod).

**If you insist on keeping TCP:** use a headless Service (`clusterIP: None`) per backend and a custom client factory that resolves all pod IPs and round-robins `ClientProxy` instances, re-resolving on `ECONNREFUSED`. This is real code you must write, test and maintain, and it still doesn't fix in-flight request loss cleanly. Do not ship plain TCP + ClusterIP + `replicas > 1` and assume it balances.

> Everything else in this document works with either transport. Where a section differs, the NATS path is marked ✅ and the TCP path ⚠️.

### B2 — No Dockerfiles ⛔

Nothing to deploy. See [Appendix A](#appendix-a--dockerfile-pnpm-nestjs-monorepo): one shared multi-stage Dockerfile parameterised by `--build-arg APP=<project-name>`, producing 7 small non-root images from the same build cache.

Also note `package.json` → `"start:prod": "node dist/apps/ecommerce-platform-backend/main"` points at a path that doesn't exist. Delete it; the image `CMD` replaces it.

### B3 — No health or readiness endpoints ⛔

The TCP services expose no HTTP surface at all, so Kubernetes has nothing to probe. A `tcpSocket` probe is *not* an acceptable substitute: it proves a listener accepted a socket, not that Postgres or Redis is reachable. A pod with a dead DB connection would stay `Ready` and keep failing every request.

Fix: turn each microservice into a **hybrid application** — a tiny HTTP server on port 8080 for probes and metrics, plus the TCP/NATS listener. `@nestjs/terminus` gives you `TypeOrmHealthIndicator` out of the box. See [Appendix H](#appendix-h--required-code-changes).

Probe semantics that matter in production:

| Probe | Checks | Why |
|---|---|---|
| `startupProbe` → `/health/live` | process is up | TypeORM connect + entity metadata can take 10–20s on a cold pod. Without this, an aggressive liveness probe kills pods in a boot loop. |
| `livenessProbe` → `/health/live` | event loop responsive **only** | Must **not** check the DB. If it did, a Postgres blip would restart every pod in the fleet simultaneously and turn a recoverable outage into an outage plus a thundering herd. |
| `readinessProbe` → `/health/ready` | DB ping + Redis ping | Correct behaviour: pod is pulled from the Service until its dependencies are back, no restart. |

The gateway also needs `app.enableShutdownHooks()` added (only the six TCP services have it) plus `terminationGracePeriodSeconds` and a preStop sleep, or in-flight HTTP requests are cut at every rollout — see B6.

### B4 — `synchronize: true` in every service ⛔

`apps/*/src/*-service.module.ts` all set `synchronize: true`. In production this lets a deploy silently ALTER or DROP columns to match whatever entity classes shipped in that image. It is the fastest way to lose data in this repo.

Required:

1. `synchronize: process.env.DB_SYNC === 'true'` — default **false**.
2. A TypeORM `DataSource` file per service (none exist today) for the migration CLI.
3. Generate a baseline migration from current schema, then per-change migrations.
4. Run migrations as an Argo CD **PreSync hook Job**, not from the app on boot ([Appendix G](#appendix-g--migration-job-argo-cd-presync-hook)) — with N replicas, boot-time migration means N concurrent schema changes racing.
5. Use a **migration role** with DDL rights for the Job and a **runtime role** with DML-only rights for the app.

Migrations must be backward-compatible (expand → migrate → contract) because a rolling update runs old and new code against one schema simultaneously.

### B5 — Insecure secret defaults ⚠️

`JwtModule.register({ secret: process.env.JWT_SECRET || 'jwt-secret' })` in `apps/api-gateway/src/api-gateway.module.ts`. If the env var is ever unset or misspelled in a ConfigMap, the gateway boots happily and accepts tokens signed with the string `jwt-secret` — a silent, complete auth bypass.

Replace every credential fallback with fail-fast validation at bootstrap (Joi/Zod schema over `ConfigModule`, `validationOptions: { abortEarly: false }`). **Crash on missing secret. Never default it.** The same applies to `JWT_REFRESH_SECRET`, `DB_PASSWORD`, and `STRIPE_KEY`.

Before cutover, rotate everything currently in the local `.env` (it's gitignored, but those values have been on disk in plaintext and the JWT secrets are literally `jwt-secret` / `jwt-refresh-secret`). The `sk_test_…` Stripe key must be swapped for a live key that exists only in Vault.

### B6 — Gateway has no graceful shutdown ⚠️

The six microservices call `enableShutdownHooks()`; the gateway does not. On SIGTERM it exits immediately and drops in-flight HTTP requests — every rollout produces 502s.

Fix: `app.enableShutdownHooks()` + `terminationGracePeriodSeconds: 45` + a `preStop` hook `sleep 10`. The sleep matters: endpoint removal from kube-proxy/Kong is *eventually* consistent, so a pod can receive requests for a second or two after SIGTERM. Sleep first, then drain.

### B7 — Five separate Postgres databases ⚠️

Textbook microservice isolation, but self-hosted it means five HA clusters = 15 Postgres pods, 15 PVCs, 5 backup schedules, 5 restore procedures. That is a lot of operational surface for one operator.

**Recommendation:** one CloudNativePG cluster (3 instances) hosting five logical databases with a separate role per service, and a documented split path when a service outgrows it. You keep schema-level isolation and per-service credentials; you give up independent failure domains. Note this trade-off explicitly in `context/decisions/` — it's a real one, not a free win. Both layouts are in [Appendix D](#appendix-d--postgres-cloudnativepg).

Also confirm whether `payment-service` persists anything — it has no `*_DB_*` env vars, only `STRIPE_KEY`. If payment intents are only written to `order_db`, say so in the docs; if it needs its own store, add it before cutover, not after.

### B8 — No metrics, no structured logging, no correlation IDs ⚠️

`console.log` and default Nest logging. In a cluster with 7 services × 3 replicas you cannot follow one user request across pods.

- Swap in `nestjs-pino` for JSON logs to stdout with `traceId`.
- Have Kong inject `X-Request-Id` (correlation-id plugin), propagate it through the gateway into the RPC payload metadata, and log it everywhere.
- Expose `/metrics` (prom-client) on the 8080 health port: `http_request_duration_seconds`, RPC latency per message pattern, `nodejs_eventloop_lag_seconds`, pool saturation.

---

## 3. Target production topology

```
                                    INTERNET
                                       │
                              ┌────────▼─────────┐
                              │  MetalLB VIP     │  L2/BGP, from your LAN pool
                              │  10.0.30.10:443  │
                              └────────┬─────────┘
                                       │
  ┌────────────────────────────────────▼──────────────────────────────────────┐
  │  namespace: kong                                                          │
  │  ┌─────────────────────────────────────────────────────────────────────┐  │
  │  │ Kong Ingress Controller (DB-less, 2+ replicas)                      │  │
  │  │ TLS termination (cert-manager) · rate-limit · correlation-id · WAF  │  │
  │  └───────────────────────────────┬─────────────────────────────────────┘  │
  └──────────────────────────────────┼────────────────────────────────────────┘
                                     │ HTTP :3000
  ┌──────────────────────────────────▼────────────────────────────────────────┐
  │  namespace: ecommerce-prod            (PSA: restricted, default-deny NP)  │
  │                                                                           │
  │   ┌────────────────────┐                                                  │
  │   │  api-gateway  ×3   │  HTTP :3000 · health :8080 · HPA 3–10            │
  │   │  JWT verify        │                                                  │
  │   └─────────┬──────────┘                                                  │
  │             │  ✅ NATS request/reply (queue groups)                       │
  │   ┌─────────▼────────────────────────────────────────────────────────┐    │
  │   │  NATS cluster ×3   :4222        (namespace: messaging)           │    │
  │   └─┬────┬────┬────┬────┬────┬─────────────────────────────────────┬─┘    │
  │     │    │    │    │    │    │                                     │      │
  │  ┌──▼─┐┌─▼──┐┌▼───┐┌▼───┐┌▼────┐┌▼───┐              cart ─────────┘      │
  │  │auth││prod││cart││ord ││ pay ││user│              (calls product)      │
  │  │ ×3 ││ ×3 ││ ×2 ││ ×2 ││ ×2  ││ ×2 │                                   │
  │  └─┬──┘└─┬──┘└─┬──┘└─┬──┘└──┬──┘└─┬──┘                                   │
  │    │     │     │     │      │     │                                       │
  └────┼─────┼─────┼─────┼──────┼─────┼───────────────────────────────────────┘
       │     │     │     │      │     │                    ┌──────────────────┐
  ┌────▼─────▼─────▼─────▼──────▼─────▼────┐               │ Stripe API       │
  │  namespace: data                       │◀──────────────┤ (egress allowed  │
  │  CloudNativePG  primary + 2 replicas   │   pay only    │  from pay only)  │
  │  auth_db product_db cart_db order_db   │               └──────────────────┘
  │  user_db          :5432 (rw / ro svc)  │
  │  Redis (Sentinel ×3)  :6379  ← auth    │
  │  PVCs: Rook-Ceph RBD (3× replicated)   │
  └────────────────┬───────────────────────┘
                   │ WAL archive + base backups
            ┌──────▼───────┐
            │ MinIO / S3   │  off-cluster, different failure domain
            └──────────────┘

  namespace: observability   Prometheus · Loki · Grafana · Alertmanager
  namespace: argocd          Argo CD (app-of-apps, syncs this repo's /deploy)
```

**Two-layer edge, clear split of duties** — you have both Kong and an `api-gateway` app, so define the boundary or you'll implement everything twice:

| Concern | Kong (edge) | `api-gateway` (app) |
|---|---|---|
| TLS termination | ✅ | ✗ (remove) |
| Rate limiting, IP restriction, request size caps | ✅ | ✗ |
| CORS | ✅ (single source of truth) | ✗ remove `enableCors` — two CORS layers produce duplicate headers browsers reject |
| Correlation ID injection | ✅ | propagate only |
| JWT verification + Redis denylist | ✗ | ✅ (`AccessTokenGuard` needs Redis state Kong can't see) |
| HTTP → RPC translation, response shaping, validation | ✗ | ✅ |

---

## 4. Cluster build (self-managed)

### Node layout (minimum viable production)

| Role | Count | vCPU / RAM / Disk | Notes |
|---|---|---|---|
| Control plane | **3** | 4 / 8Gi / 100Gi SSD | Stacked etcd. 3 is the minimum for quorum — 2 is worse than 1. etcd needs low-latency disk; never put it on spinning rust or a shared NAS. |
| Worker (app) | **3+** | 8 / 32Gi / 200Gi SSD | Runs the 7 services + Kong. |
| Worker (data) | **3** | 8 / 32Gi / 500Gi+ NVMe | Tainted `workload=data:NoSchedule`; Postgres/Redis/Ceph OSDs only. Keeps a noisy app pod from starving your database's IOPS. |
| Load balancer | 2 (or VIP) | 2 / 4Gi | kube-vip or HAProxy + keepalived for the control-plane API VIP. |

Anti-affinity across **physical hosts**, not just nodes — three VMs on one hypervisor is one failure domain wearing a costume.

### Build order

```bash
# 0. Every node: swap off, set kernel params, install containerd + kubeadm/kubelet/kubectl (pinned versions)
swapoff -a && sed -i '/ swap / s/^/#/' /etc/fstab
# 1. Control-plane VIP first (kube-vip static pod or keepalived), THEN:
kubeadm init --control-plane-endpoint "k8s-api.internal:6443" --upload-certs \
             --pod-network-cidr 10.244.0.0/16
# 2. Join the other 2 control-plane nodes, then workers
# 3. CNI — Cilium (eBPF, kube-proxy replacement, NetworkPolicy + Hubble observability)
helm install cilium cilium/cilium -n kube-system \
  --set kubeProxyReplacement=true --set hubble.relay.enabled=true
# 4. MetalLB — gives you real LoadBalancer Services on bare metal
helm install metallb metallb/metallb -n metallb-system --create-namespace
#    then an IPAddressPool from your LAN range + L2Advertisement (BGP if your switches speak it)
# 5. Storage — Rook-Ceph (RBD block for DBs, CephFS for RWX) or Longhorn if you want simpler
# 6. Platform addons: cert-manager, Kong, Prometheus stack, Argo CD, External Secrets, CloudNativePG, NATS
```

`--control-plane-endpoint` must be set **at init time**. Retrofitting an HA endpoint onto a single-node control plane means rebuilding the cluster.

### Self-managed responsibilities a cloud provider would have handled

These are the things that bite on-prem clusters. Put each on a calendar, not a wiki page.

- **etcd backups** — CronJob `etcdctl snapshot save` every 30 min, shipped off-cluster. Lose etcd without a snapshot and you lose the cluster. **Practise the restore.**
- **Certificate rotation** — kubeadm control-plane certs expire after **1 year**. `kubeadm certs check-expiration` monthly; renew during a maintenance window. This is the single most common way self-managed clusters die.
- **Version upgrades** — one minor version at a time, control plane → kubelets, drain each node. Track the version skew policy.
- **Node OS patching** — cordon → drain → patch → reboot → uncordon, one node at a time. PDBs (section 8) make this safe.
- **Capacity headroom** — no autoscaler. Keep ≥1 worker's worth of spare capacity so you survive losing a node.
- **Hardware monitoring** — SMART, ECC errors, PSU, switch ports. Kubernetes cannot tell you a disk is dying; Ceph will, loudly, once it already has.

---

## 5. Namespace & tenancy layout

| Namespace | Contents | PSA level |
|---|---|---|
| `ecommerce-prod` | the 7 application workloads | `restricted` |
| `ecommerce-staging` | same chart, smaller values | `restricted` |
| `data` | CloudNativePG cluster, Redis | `baseline` (operators need some latitude) |
| `messaging` | NATS cluster | `restricted` |
| `kong` | Kong Ingress Controller | `baseline` |
| `observability` | Prometheus, Loki, Grafana, Alertmanager | `baseline` |
| `argocd` | Argo CD | `baseline` |
| `cert-manager`, `external-secrets`, `metallb-system`, `rook-ceph` | platform | per upstream chart |

Every app namespace gets Pod Security Admission enforced at the namespace level, a ResourceQuota, a LimitRange (so a manifest missing `resources` can't consume a node), and a default-deny NetworkPolicy ([Appendix E](#appendix-e--networkpolicies-default-deny)).

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: ecommerce-prod
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: latest
    pod-security.kubernetes.io/warn: restricted
```

Staging and prod in the **same cluster** is acceptable for a single-operator setup (separate namespaces, separate quotas, separate DB clusters). Be honest that it is not real isolation: one bad CRD, one etcd outage, or one Ceph incident takes both. Move staging to its own cluster once the platform stops changing.

---

## 6. Data layer: Postgres, Redis, NATS

### Postgres — CloudNativePG operator

Do not run a hand-written Postgres StatefulSet. CloudNativePG gives you streaming replication, automated failover with a promoted replica, PITR via WAL archiving, backup verification, connection-routing Services, and a rolling minor-version upgrade path. All of that is otherwise your homework.

```
              ┌─── ecommerce-pg-rw ──▶ primary  (writes)
  services ───┤
              └─── ecommerce-pg-ro ──▶ replicas (read-only, optional)

  primary ──WAL stream──▶ replica-1, replica-2       (synchronous: 1)
  primary ──WAL archive──▶ MinIO/S3  + nightly base backup → PITR
```

Key settings ([Appendix D](#appendix-d--postgres-cloudnativepg)):

- `instances: 3`, `synchronous` replication with `minSyncReplicas: 1` — a committed write exists on two nodes before the client is told it succeeded. Costs latency; worth it for orders and payments.
- `storage.storageClass: rook-ceph-block` + `walStorage` on a **separate PVC** so WAL writes don't compete with data writes.
- Pod anti-affinity across the three data nodes.
- `backup.barmanObjectStore` → MinIO, `retentionPolicy: 30d`, plus `scheduledBackup` nightly.
- Per-service roles: `auth_svc`, `product_svc`, … each owning one database; `migration_svc` with DDL rights used only by the migration Job.
- `max_connections` sized deliberately — see the pool math in section 16.

**Connection pooling:** 7 services × 3 replicas × a 10-connection TypeORM pool = 210 connections, each ~10MB of backend RAM in Postgres. Add CNPG's built-in PgBouncer (`Pooler` CRD, transaction mode) in front of the `-rw` service and point apps at it. Note the constraint: transaction-mode pooling forbids session state (`SET`, advisory locks, prepared statements outside a transaction). TypeORM is fine with it; check any raw queries.

### Redis

`auth-service` stores refresh tokens and the JWT denylist in Redis. **This is not a cache — it is auth state.** Flushing Redis logs out every user and, worse, resurrects any revoked token whose denylist entry vanished.

- Redis with **Sentinel, 3 replicas**, AOF persistence (`appendfsync everysec`) on Ceph RBD.
- `maxmemory-policy: noeviction` for this workload. `allkeys-lru` would silently evict denylist entries — a security bug, not a capacity problem.
- If you later add a genuine cache, use a **separate** Redis instance with `allkeys-lru`. Never share an eviction policy between auth state and cache.
- Alert on `redis_connected_clients`, AOF rewrite failures, and replication lag.

### NATS (if you take the B1 fix ✅)

3-replica StatefulSet, no JetStream needed — the services use request/reply, not persistent streams. Enable `nats-server` monitoring on :8222 and scrape it. Watch for **slow consumers**, the signal that a service can't keep up with its queue group.

---

## 7. Config & secrets

Three tiers, and nothing crosses them:

| Tier | Mechanism | Examples |
|---|---|---|
| Non-secret config | Helm values → ConfigMap | `NODE_ENV`, `GATEWAY_PORT`, `NATS_URL`, log level, feature flags |
| Generated credentials | CNPG-managed Secret, mounted directly | `DB_USERNAME`, `DB_PASSWORD`, `DB_HOST` |
| External secrets | HashiCorp Vault → External Secrets Operator → Secret | `JWT_SECRET`, `JWT_REFRESH_SECRET`, `STRIPE_KEY`, Stripe webhook signing secret |

**Plaintext secrets never enter Git.** With Argo CD this needs a deliberate answer, since the whole point of GitOps is that Git holds desired state:

- **Vault + External Secrets Operator (recommended)** — Git holds an `ExternalSecret` *pointer*; ESO fetches the value and writes the `Secret`. Rotation happens in Vault with no commit. You now run Vault (raft storage, 3 replicas, auto-unseal via transit or a documented manual unseal drill).
- **Sealed Secrets (simpler)** — encrypted `SealedSecret` in Git, only the in-cluster controller can decrypt. No Vault. Cost: rotation = a commit, and **losing the controller's private key makes every sealed secret in Git permanently undecryptable**. Back up that key like you back up etcd.

Either way:

- Mount secrets as **files**, not env vars, where feasible — env vars leak into crash dumps, `/proc`, and child processes.
- `automountServiceAccountToken: false` on every app pod; none of them talk to the API server.
- **Fail fast on missing config** (B5). Every one of these must crash the pod when absent, never fall back.
- Rotate JWT signing keys with an overlap window: accept old+new for one refresh-token TTL, then drop old. A hard swap invalidates every live session at once.

---

## 8. Workload spec: resources, probes, disruption

### Resources — and the Node.js heap trap

```yaml
resources:
  requests: { cpu: 100m, memory: 256Mi }
  limits:   { memory: 512Mi }          # no CPU limit — see below
env:
  - name: NODE_OPTIONS
    value: "--max-old-space-size=384"  # ≈75% of the memory limit
```

Three decisions worth understanding rather than copying:

1. **`--max-old-space-size` is mandatory.** Node sizes its heap from *host* memory, not the cgroup limit. A 512Mi container on a 32Gi node will happily grow its heap past 512Mi and get OOMKilled with zero JS-level warning — no heap error, no stack trace, just exit 137. Set it to ~75% of the limit (the rest is native/buffers/stack).
2. **`requests.memory == limits.memory`.** Memory is incompressible; overcommitting it means a random pod dies under node pressure. Burstable memory buys you nothing but nondeterminism.
3. **No CPU limit** (requests only). CFS quota throttles a Node process mid-event-loop and shows up as multi-hundred-millisecond p99 latency that looks like a code problem for a week. CPU is compressible — `requests` already guarantees your share under contention. If you must set a limit for quota reasons, set it ≥4× requests.

Per-service starting points (tune from real data, not this table):

| Service | Replicas | CPU req | Mem req/limit | `max-old-space-size` |
|---|---|---|---|---|
| api-gateway | 3 (HPA 3–10) | 200m | 512Mi | 384 |
| auth-service | 3 (HPA 3–8) | 150m | 512Mi | 384 |
| product-service | 3 (HPA 3–8) | 150m | 512Mi | 384 |
| cart-service | 2 | 100m | 384Mi | 288 |
| orders-service | 2 | 150m | 512Mi | 384 |
| payment-service | 2 | 100m | 384Mi | 288 |
| user-service | 2 | 100m | 384Mi | 288 |

bcrypt in `auth-service` is CPU-heavy and **synchronous work on the libuv threadpool** — under login bursts it saturates threads and delays unrelated requests. Give auth more CPU headroom than the others and set `UV_THREADPOOL_SIZE` to roughly `cpu_requests` cores × 4.

### Probes

```yaml
startupProbe:   { httpGet: { path: /health/live,  port: 8080 }, failureThreshold: 30, periodSeconds: 2 }
livenessProbe:  { httpGet: { path: /health/live,  port: 8080 }, periodSeconds: 10, failureThreshold: 3 }
readinessProbe: { httpGet: { path: /health/ready, port: 8080 }, periodSeconds: 5,  failureThreshold: 2 }
```

`startupProbe` gives 60s to boot, then liveness takes over with tight timings. Liveness checks the process only; readiness checks dependencies (B3).

### Graceful shutdown

```yaml
terminationGracePeriodSeconds: 45
lifecycle:
  preStop:
    exec: { command: ["sh", "-c", "sleep 10"] }
```

The 10s sleep covers the window where the pod is `Terminating` but Kong/kube-proxy endpoints haven't converged. Without it every rollout emits a burst of 502s that you'll spend a day blaming on Kong.

### Disruption & spreading

```yaml
# PDB — makes node drains (patching, upgrades) safe instead of an outage
maxUnavailable: 1

topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: ScheduleAnyway   # DoNotSchedule on a 3-node cluster wedges the scheduler
    labelSelector: { matchLabels: { app.kubernetes.io/name: api-gateway } }
```

Also set `priorityClassName`: gateway and auth above the rest — if the cluster is out of capacity, shed cart before you shed login.

### Autoscaling

✅ With NATS: HPA on CPU for the gateway; KEDA on NATS queue depth for backends (the metric that actually reflects backlog). Set `behavior.scaleDown.stabilizationWindowSeconds: 300` so you don't flap.

⚠️ With TCP: HPA on backends is theatre (B1). Don't configure it and don't trust it.

---

## 9. Edge: Kong Ingress Controller + TLS

Install Kong DB-less via the `kong/ingress` chart in namespace `kong`, `proxy.type: LoadBalancer` with a MetalLB-assigned IP from your pool. 2+ replicas, PDB, spread across nodes.

`cert-manager` issues certs. On-prem you have two paths: **ACME DNS-01** if the domain is public (HTTP-01 won't work without inbound internet to the cluster), or an **internal CA `ClusterIssuer`** whose root you distribute to clients. Pick one and write down which — this is the detail that stalls on-prem TLS for a week.

Plugins, applied via `KongPlugin` CRDs ([Appendix F](#appendix-f--kong-ingress--plugins)):

| Plugin | Scope | Why |
|---|---|---|
| `correlation-id` | global | `X-Request-Id` for cross-service tracing (B8) |
| `prometheus` | global | edge RED metrics, per-route latency |
| `rate-limiting` | global 600/min per IP | baseline abuse protection |
| `rate-limiting` | `/auth/login`, `/auth/forgot-password` — 5/min per IP | credential stuffing and email-bomb defence; the global limit is far too loose for these |
| `request-size-limiting` | global, 1MB | cheap DoS protection |
| `cors` | global | single CORS source of truth (remove `enableCors` from the gateway) |
| `ip-restriction` | `/actuator`, admin routes | internal CIDRs only |

**Two routes need special handling — get these wrong and you'll debug them in production:**

1. **Stripe webhook** (`/api/v1/payments/webhook`) — must be `@Public()` (no JWT), must **not** be rate-limited by client IP (Stripe's IPs are shared and bursty), and the **raw request body must survive intact** for signature verification. Any body-parsing or transforming plugin in the chain breaks `stripe.webhooks.constructEvent`. Verify the signature in `payment-service`, and make it idempotent — Stripe retries, so the same event will arrive more than once.
2. **Health endpoints** — `/health/*` on port 8080 must never be exposed through the Ingress. Probes are in-cluster only.

Timeouts: Kong defaults to 60s. Set `konghq.com/read-timeout: "15000"` on the gateway Ingress. A request the client abandoned should not hold a gateway connection and a backend socket for a minute.

---

## 10. Helm chart layout

Seven near-identical Node services means one shared template and seven value blocks. Duplicating 7 sets of manifests guarantees they drift.

```
deploy/
├── charts/
│   ├── ecommerce/                  # umbrella chart (the app)
│   │   ├── Chart.yaml              # depends on: nest-service (aliased ×7)
│   │   ├── values.yaml             # shared defaults
│   │   ├── values-staging.yaml
│   │   ├── values-prod.yaml
│   │   └── templates/
│   │       ├── configmap-common.yaml
│   │       ├── networkpolicy-default-deny.yaml
│   │       ├── externalsecret-jwt.yaml
│   │       └── migration-job.yaml          # Argo CD PreSync hook
│   └── nest-service/               # ONE library/subchart, used 7×
│       └── templates/
│           ├── deployment.yaml     # probes, resources, security ctx, preStop
│           ├── service.yaml
│           ├── hpa.yaml
│           ├── pdb.yaml
│           ├── networkpolicy.yaml
│           └── servicemonitor.yaml
└── argocd/
    ├── root-app.yaml               # app-of-apps
    └── apps/
        ├── platform-*.yaml         # cert-manager, kong, metallb, cnpg, nats, prometheus, eso
        ├── data-*.yaml             # Postgres Cluster, Redis
        ├── ecommerce-staging.yaml
        └── ecommerce-prod.yaml
```

Rules that keep this maintainable:

- **Image tags are immutable digests**, never `latest`, never a mutable semver tag. `image: registry.internal/ecommerce/auth-service@sha256:…`. Argo CD's diff is only meaningful if the tag pins one artifact.
- Sane chart defaults are `restricted`-compliant: `runAsNonRoot`, `readOnlyRootFilesystem`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`, `seccompProfile: RuntimeDefault`. Then a service physically cannot be deployed insecurely by omission.
- `helm template … | kubeconform -strict` and `helm unittest` in CI. Catch a bad values file before Argo CD applies it.
- **No `helm install` by hand in prod, ever.** Argo CD owns the cluster; a manual release makes it fight you (and `selfHeal` will win at 3am).

See [Appendix B](#appendix-b--shared-nest-service-subchart) and [Appendix C](#appendix-c--values-prodyaml).

---

## 11. Argo CD GitOps

**App-of-apps:** one `root-app.yaml` you apply by hand exactly once; it points at `deploy/argocd/apps/` and every other Application is created from Git thereafter.

### Sync waves

Ordering matters more here than in most stacks, because a schema migration sits between the data layer and the app.

| Wave | Contents |
|---|---|
| `-3` | Namespaces, PSA labels, ResourceQuotas, CRDs |
| `-2` | Operators & platform: cert-manager, CNPG, ESO, MetalLB, Kong |
| `-1` | Secrets (`ExternalSecret`), ConfigMaps, issuers |
| `0` | Data layer: Postgres `Cluster`, Redis, NATS — **wait for ready** |
| `1` | **Migration Job** (PreSync hook) |
| `2` | The 6 backend microservices |
| `3` | api-gateway |
| `4` | Ingress, KongPlugins, ServiceMonitors, PrometheusRules |

Gateway *after* backends so it doesn't serve traffic into services that aren't up. Prometheus rules last so alerts don't fire during a deliberate rollout.

### Sync policy

```yaml
# staging — fully automated, this is where you find out things are broken
syncPolicy:
  automated: { prune: true, selfHeal: true }
  syncOptions: [CreateNamespace=true, ServerSideApply=true]

# production — self-heal on, auto-sync off
syncPolicy:
  automated: { prune: false, selfHeal: true }
```

`selfHeal: true` + `prune: false` in prod is the deliberate combination: drift gets corrected automatically, but a deleted-from-Git resource is never silently removed from production. Promotion to prod is a human clicking Sync (or a CI job on a tagged release) after staging has been green.

Enable **auto-sync windows** so nothing deploys itself during your peak hours.

### Image promotion

CI builds and pushes `service@sha256:…`, then commits the digest to `values-staging.yaml`. Argo CD syncs staging automatically. Promotion to prod is a commit copying that digest into `values-prod.yaml` — **the exact same artifact**, no rebuild. If prod rebuilds from source, you are not shipping what you tested.

Argo CD Image Updater can automate the staging commit. Leave prod manual.

### Argo CD's own resilience

Argo CD is a single point of deployment failure. Back up its `Application` CRs (they're in Git — verify that's actually true, including the root app). Enable SSO + RBAC. Turn on notifications to Slack/email for `OutOfSync` and failed syncs, or you'll learn about a failed prod sync from a user.

---

## 12. Rollouts, migrations & rollback runbook

### Standard deploy

```
commit digest → CI: build, test, scan, push → commit values-staging.yaml
  → Argo auto-syncs staging → smoke tests → PR to promote digest to values-prod.yaml
  → review → merge → Argo CD prod Sync (manual gate)
    → wave 1: migration Job runs to completion (PreSync)
    → wave 2–3: RollingUpdate, maxSurge 1 / maxUnavailable 0
    → readiness gates each new pod before the old one goes
  → watch dashboards for 15 min (error rate, p95, restart count, pool saturation)
```

`maxUnavailable: 0` means capacity never dips below the declared replica count mid-rollout.

### The migration rule you cannot break

A rolling update runs **old and new code against one schema at the same time**. Therefore every migration must be backward-compatible with the currently-deployed version:

```
Expand   → add nullable column / new table / new index (CONCURRENTLY). Old code ignores it.
Migrate  → deploy code that writes both old and new. Backfill in batches.
Contract → in a LATER release, once no running code reads the old column, drop it.
```

Never combine expand and contract in one release. On Postgres, always `CREATE INDEX CONCURRENTLY` (a plain `CREATE INDEX` takes a write lock on the table for its duration) and set a `lock_timeout` on the migration Job so a blocked DDL statement fails fast instead of queueing behind every query on the table.

### Rollback decision tree

```
Something is wrong after deploy
│
├── Code-only change (no migration in this release)?
│     → kubectl rollout undo deploy/<svc>     (fast, seconds)
│     → then revert the digest in Git, or selfHeal re-applies the bad version
│
├── Release included an EXPAND migration (additive)?
│     → roll back code only. Leave the schema. Additive changes are backward-compatible;
│       that is the entire reason expand/contract exists.
│
└── Release included a CONTRACT migration (dropped/renamed something)?
      → code rollback WILL FAIL — old code queries a column that no longer exists.
      → forward-fix, or PITR restore (data loss window = time since the migration).
      → This is why contract migrations ship alone, off-peak, behind a tested restore.
```

Keep `revisionHistoryLimit: 10` so `rollout undo` has somewhere to go.

### Runbooks to write before cutover (not after)

One page each, in `docs/runbooks/`: Postgres failover · PITR restore · Redis loss (all sessions invalidated — what do you tell users?) · certificate expiry · node loss · full PVC · Stripe webhook backlog · Argo CD down · etcd restore. A runbook you haven't rehearsed is fiction; schedule a game day per quarter.

---

## 13. Observability & SLOs

**Metrics** — kube-prometheus-stack. `ServiceMonitor` per service scraping `:8080/metrics`. Also scrape Kong, CNPG, Redis, NATS, Ceph, node-exporter, kube-state-metrics.

**Logs** — Loki + Promtail (lighter than the ELK stack in `docker-compose.yml`; if you prefer to reuse the Elastic knowledge from `docs/guides/`, run ECK instead — just don't run both). JSON logs from `nestjs-pino`, indexed by `namespace`, `app`, `traceId`.

**Traces** — OpenTelemetry SDK in each service → Tempo (or the Zipkin already in compose). A single trace should span Kong → gateway → NATS → service → Postgres. This is what makes "checkout is slow" answerable in minutes instead of days.

### SLOs (define these before the alerts)

| SLO | Target | Window |
|---|---|---|
| Gateway availability (non-5xx / total) | 99.9% | 30d rolling |
| Gateway p95 latency, read paths | < 300ms | 30d |
| Gateway p95 latency, checkout | < 800ms | 30d |
| Payment webhook processing success | 99.95% | 30d |

Alert on **error-budget burn rate**, not raw thresholds — a fast-burn alert (2% of budget in 1h) pages; a slow-burn alert (5% in 6h) files a ticket. Threshold alerts on raw error rate page you at 3am for a blip that's already resolved, and after two weeks of that nobody reads the pages.

### Alerts that must exist

`CrashLoopBackOff` · readiness flapping · PDB at zero allowance · pending pods > 5min · **cert expiry < 14d** · **kubeadm cert expiry < 30d** · PVC > 80% · CNPG replication lag / failover / backup failure · **backup age > 26h** (a backup you never verified is not a backup) · Redis AOF failure · NATS slow consumers · event-loop lag > 100ms · DB pool saturation > 80% · node NotReady · etcd fsync latency · Ceph HEALTH_WARN.

Grafana dashboards: one RED overview (rate/errors/duration per service), one per service, one for the data layer, one for cluster capacity.

---

## 14. Security hardening

**Cluster**

- PSA `restricted` enforced on app namespaces (section 5).
- **Default-deny NetworkPolicy** in every app namespace, then explicit allows only ([Appendix E](#appendix-e--networkpolicies-default-deny)). Without this, any compromised pod can reach Postgres directly. Note the real edges: Kong→gateway, gateway→NATS, services→NATS, **cart→product** (per `context/CART_PRODUCT_INTEGRATION.md`), services→Postgres/Redis, all→kube-dns, **payment→Stripe egress only**.
- Egress default-deny with a documented allowlist. `payment-service` is the only workload that needs the public internet.
- RBAC least privilege; `automountServiceAccountToken: false` on app pods.
- Audit logging on the API server, shipped off-cluster.
- Encryption at rest for etcd (`EncryptionConfiguration`) — on-prem this is on you, and the Secrets in etcd are otherwise base64, not encrypted.

**Images**

- Multi-stage builds, distroless or alpine runtime, non-root UID, `readOnlyRootFilesystem: true` with an `emptyDir` at `/tmp`.
- Trivy/Grype scan in CI; fail the build on fixable HIGH/CRITICAL.
- Private registry with auth; sign images (cosign) and enforce with a policy controller (Kyverno) so only signed images run.
- SBOM per image, retained with the release.

**Application**

- Fail-fast config validation (B5) — a missing `JWT_SECRET` must crash, not default.
- `@nestjs/throttler` is already a dependency; use it as defence in depth behind Kong's rate limiting.
- Confirm password hashing cost (bcrypt rounds ≥ 12) and that `ResponseInterceptor` cannot leak entity internals — check that `User` password/refresh-token fields are `select: false` or excluded.
- `forbidNonWhitelisted: true` is already set on the gateway `ValidationPipe`. Good — keep it.
- Verify Stripe webhook signatures; make handlers idempotent by event ID.

---

## 15. Backup & disaster recovery

| Asset | Method | Frequency | RPO | RTO | Verified how |
|---|---|---|---|---|---|
| Postgres | CNPG base backup + continuous WAL → MinIO | nightly + WAL streaming | ~5 min (PITR) | 30–60 min | monthly restore to scratch namespace |
| Redis (auth state) | AOF on PVC + RDB snapshot to object store | 15 min | 15 min | 15 min | quarterly |
| etcd | `etcdctl snapshot save` CronJob → off-cluster | 30 min | 30 min | 1–2h (cluster rebuild) | **quarterly restore drill — non-negotiable** |
| PVCs (Ceph) | Velero + CSI snapshots | nightly | 24h | 1–2h | monthly |
| Secrets | Vault raft snapshots (or Sealed Secrets key backup) | nightly | 24h | 30 min | quarterly |
| Manifests & charts | Git (this repo) | per commit | 0 | minutes | Argo CD re-sync |

**Backups live off-cluster and off-host.** A snapshot on the same Ceph pool as the data is not a backup; it's a copy in the same failure domain.

**Loss scenarios and the honest answer for each:**

| Scenario | Blast radius | Recovery |
|---|---|---|
| One app pod dies | none | Deployment replaces it |
| One node dies | brief; pods reschedule | drain/replace at leisure — this is why PDBs and spread constraints exist |
| Postgres primary dies | seconds of write errors | CNPG promotes a replica automatically |
| Data node dies | degraded replication | Ceph rebalances; replace the node |
| **Redis lost** | **all sessions invalidated, revoked tokens may resurrect** | restore AOF; if unavailable, **rotate `JWT_SECRET`** to invalidate every outstanding token, and accept that all users are logged out. Write this runbook — it's the ugliest realistic incident in this architecture. |
| etcd quorum lost | cluster control plane down; **running pods keep serving** | restore snapshot on one node, rebuild quorum |
| Whole cluster lost | full outage | rebuild cluster → apply root app → restore Postgres from object store → verify → repoint DNS |

Write the RPO/RTO you can actually *demonstrate*, not the one you'd like. An untested restore path has an RTO of infinity.

---

## 16. Capacity & sizing

**Connection math** (the constraint people hit first):

```
7 services × 3 replicas × pool size 10   = 210 app connections
+ migration job, monitoring, admin        ≈  20
                                          = 230 → Postgres max_connections 300
```

Each Postgres backend costs ~10MB of RAM, so 230 connections ≈ 2.3GB before any query workload. Either size the DB for it or put PgBouncer in front (section 6) and drop `max_connections` to ~100 with a 500-connection pooler in transaction mode.

**Cluster capacity at the sizes in section 8:**

```
app requests ≈ 0.2+0.15+0.15+0.1+0.15+0.1+0.1 = 0.95 CPU · ~3.2Gi   (1 replica each)
at production replica counts (3,3,3,2,2,2,2)   ≈ 2.6 CPU · ~8.5Gi
+ Kong, Prometheus, Loki, Argo CD, Cilium, Ceph ≈ 6 CPU  · ~16Gi
+ Postgres 3 + Redis 3 + NATS 3                ≈ 4 CPU  · ~12Gi
                                        total  ≈ 13 CPU · ~37Gi requested
```

Three 8-CPU/32Gi app workers plus three data workers leaves comfortable headroom — deliberately, because with no cluster autoscaler you must survive losing a node without evicting anything that matters. Target ≤60% requested capacity per node in steady state.

**Storage:** Postgres data 100Gi + WAL 20Gi per instance, ×3 instances, ×3 Ceph replicas = ~1TB raw for the DB alone. Ceph also wants ≥20% free to rebalance safely. Alert at 70%, not 90% — a full Ceph cluster is very unpleasant to recover.

---

## 17. Phased delivery plan

### Phase 0 — Application pre-work (blockers) 🔴 *do this first; no cluster work unblocks it*

- [ ] **B1** Decide the transport question. Migrate to NATS (recommended) or write and test the headless-Service client factory.
- [ ] **B2** Dockerfile + `.dockerignore`; build all 7 images; verify each starts and serves.
- [ ] **B3** Health module (`@nestjs/terminus`) on port 8080 in all 7 apps; hybrid app for the six TCP/NATS services.
- [ ] **B4** `synchronize: false`; DataSource files; baseline migration per DB; migration + runtime DB roles.
- [ ] **B5** Fail-fast config validation; delete every credential fallback; rotate all local secrets.
- [ ] **B6** `enableShutdownHooks()` on the gateway.
- [ ] **B8** `nestjs-pino` JSON logging, correlation-ID propagation, `/metrics`.
- [ ] Housekeeping: delete `scratch.ts`, fix the dead `start:prod` script, refresh `CLAUDE.md` (it still mentions an `order-service` entry that `nest-cli.json` no longer has, and doesn't mention orders/payment/user).
- [ ] Verify locally with `docker compose` against the built images — not `pnpm start:all`.

### Phase 1 — Cluster foundation

- [ ] 3 control-plane + 3 app + 3 data nodes; OS hardened; swap off; versions pinned.
- [ ] `kubeadm init --control-plane-endpoint` behind kube-vip; join all nodes.
- [ ] Cilium; MetalLB pool; Rook-Ceph with StorageClasses.
- [ ] etcd snapshot CronJob → off-cluster. **Do a restore drill now, on an empty cluster, while it's cheap.**
- [ ] Namespaces, PSA labels, quotas, LimitRanges, default-deny NetworkPolicies.

### Phase 2 — Platform addons

- [ ] Argo CD + root app-of-apps; every subsequent addon lands via Git.
- [ ] cert-manager + ClusterIssuer (decide ACME DNS-01 vs internal CA).
- [ ] Kong Ingress Controller on a MetalLB IP; verify TLS end-to-end with a dummy service.
- [ ] External Secrets + Vault (or Sealed Secrets, with the key backed up).
- [ ] kube-prometheus-stack, Loki, Grafana, Alertmanager routing to a real destination you'll see.

### Phase 3 — Data layer

- [ ] CloudNativePG operator; 3-instance Cluster on data nodes; 5 databases + per-service roles.
- [ ] WAL archiving + nightly backup to MinIO; **restore into a scratch namespace and diff.**
- [ ] PgBouncer `Pooler`.
- [ ] Redis + Sentinel, AOF, `noeviction`.
- [ ] NATS cluster (if B1 → NATS).

### Phase 4 — Staging deploy

- [ ] `nest-service` subchart + umbrella chart; `helm template | kubeconform` in CI.
- [ ] Deploy full stack to `ecommerce-staging` via Argo CD auto-sync.
- [ ] Baseline migration Job runs green; app connects; end-to-end smoke test through Kong (register → login → browse → cart → order → Stripe test webhook).
- [ ] Load test. Confirm HPA behaviour and — critically — **that scaling a backend actually distributes load** (this is the test that proves B1 is fixed).
- [ ] Chaos: kill pods, drain a node, fail the Postgres primary, break Redis. Watch what the dashboards tell you.

### Phase 5 — Hardening

- [ ] Trivy in CI gating on HIGH/CRITICAL; cosign signing + Kyverno enforcement.
- [ ] NetworkPolicies verified by *attempting* the connections that must fail (a policy you haven't tested negatively is a policy you don't have).
- [ ] etcd encryption at rest; API audit logging shipped.
- [ ] SLOs + burn-rate alerts live; all runbooks written; one game day run.

### Phase 6 — Production cutover

- [ ] `ecommerce-prod` namespace, prod DB cluster, prod secrets in Vault, **live** Stripe key.
- [ ] Promote the staging digest — same artifact, no rebuild.
- [ ] DNS → MetalLB VIP with a short TTL (make rollback fast).
- [ ] Watch for 24h with someone on call. Backup verification passes on real prod data before you call it done.

---

## 18. Production readiness gate

Do not put real traffic on this until every line is true.

**Application**
- [ ] Inter-service calls demonstrably load-balance across replicas (B1)
- [ ] All 7 images build reproducibly, run as non-root, read-only rootfs
- [ ] `/health/live` + `/health/ready` on all 7, with correct liveness-vs-readiness semantics
- [ ] `synchronize: false` everywhere; migrations run as a PreSync Job; expand/contract documented
- [ ] Missing config crashes the pod; no credential has a fallback value
- [ ] Graceful shutdown verified: rollout under load produces **zero** 5xx
- [ ] JSON logs with a correlation ID traceable end-to-end; `/metrics` scraped

**Platform**
- [ ] 3-node control plane, HA endpoint, etcd snapshots off-cluster, **restore rehearsed**
- [ ] kubeadm cert expiry alerted (< 30d) and renewal documented
- [ ] Ceph healthy with ≥20% free; PVC alerts at 70%
- [ ] MetalLB + Kong + TLS working; cert auto-renewal proven (not just issued once)
- [ ] Default-deny NetworkPolicies, verified negatively
- [ ] PSA `restricted` enforced; etcd encrypted at rest; audit logs shipped

**Data**
- [ ] Postgres 3 instances, sync replication, automated failover tested by killing the primary
- [ ] Backups nightly + WAL; **restore tested end-to-end**; backup-age alert armed
- [ ] Redis persistence + `noeviction`; Redis-loss runbook written
- [ ] Connection count under `max_connections` with headroom; pooler in place

**Delivery**
- [ ] Argo CD app-of-apps in Git; prod is `selfHeal: true` / `prune: false` / manual sync
- [ ] Images pinned by digest; prod runs the exact artifact staging tested
- [ ] `rollout undo` tested; rollback decision tree understood for contract migrations
- [ ] SLOs defined, burn-rate alerts routed to a destination a human sees
- [ ] Runbooks written for every row in the loss-scenario table; one game day completed

---

# Appendices

## Appendix A — Dockerfile (pnpm NestJS monorepo)

One file at the repo root builds all 7 images; `nest build` with `webpack: true` (already set in `nest-cli.json`) emits `dist/apps/<app>/main.js`.

```dockerfile
# syntax=docker/dockerfile:1.7
# Build: docker build --build-arg APP=auth-service -t registry.internal/ecommerce/auth-service:$(git rev-parse --short HEAD) .
ARG NODE_VERSION=22.20-alpine

# ---------- deps: full install for building ----------
FROM node:${NODE_VERSION} AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

# ---------- build ----------
FROM node:${NODE_VERSION} AS build
ARG APP
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN test -n "$APP" || (echo "ERROR: --build-arg APP=<project-name> is required" && exit 1) && \
    pnpm nest build "$APP"

# ---------- prod deps only ----------
FROM node:${NODE_VERSION} AS proddeps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --prod --ignore-scripts

# ---------- runtime ----------
FROM node:${NODE_VERSION} AS runtime
ARG APP
ENV NODE_ENV=production
RUN apk add --no-cache dumb-init && \
    addgroup -g 10001 -S nodejs && adduser -u 10001 -S nodejs -G nodejs
WORKDIR /app
COPY --from=proddeps --chown=root:root /app/node_modules ./node_modules
# copy ONLY this app's bundle, to a fixed path → static CMD, no shell expansion
COPY --from=build --chown=root:root /app/dist/apps/${APP} ./dist
USER 10001:10001
EXPOSE 3000 8080
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
```

Notes on choices that matter:

- **`dumb-init` as PID 1.** Node doesn't reap zombie processes and, as PID 1, doesn't get default signal handlers. Without an init, SIGTERM handling gets subtly wrong and graceful shutdown (B6) silently doesn't work.
- **Copy only `dist/apps/$APP`** to a fixed path so `CMD` is a static exec-form array — no shell, no variable expansion, correct signal delivery.
- **`--chown=root:root` + `USER 10001`** — the app owns nothing it runs, which is what makes `readOnlyRootFilesystem: true` viable.
- **Numeric UID in `USER`** so Kubernetes `runAsNonRoot` can verify it without resolving `/etc/passwd`.
- Pin `NODE_VERSION` to a patch release, not `:22-alpine`. Reproducible builds need reproducible base images.

`.dockerignore`:

```
node_modules
dist
.git
.env*
coverage
docs
context
data
**/*.spec.ts
**/*.e2e-spec.ts
.DS_Store
scratch.ts
```

Build all seven:

```bash
TAG=$(git rev-parse --short HEAD)
for APP in api-gateway auth-service product-service cart-service orders-service payment-service user-service; do
  docker buildx build --build-arg APP=$APP \
    -t registry.internal/ecommerce/$APP:$TAG --push .
done
```

---

## Appendix B — Shared `nest-service` subchart

`deploy/charts/nest-service/templates/deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "nest-service.fullname" . }}
  labels: {{- include "nest-service.labels" . | nindent 4 }}
spec:
  replicas: {{ .Values.replicaCount }}
  revisionHistoryLimit: 10
  strategy:
    type: RollingUpdate
    rollingUpdate: { maxSurge: 1, maxUnavailable: 0 }
  selector:
    matchLabels: {{- include "nest-service.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels: {{- include "nest-service.selectorLabels" . | nindent 8 }}
      annotations:
        checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
    spec:
      automountServiceAccountToken: false
      terminationGracePeriodSeconds: 45
      priorityClassName: {{ .Values.priorityClassName | default "ecommerce-standard" }}
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        fsGroup: 10001
        seccompProfile: { type: RuntimeDefault }
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels: {{- include "nest-service.selectorLabels" . | nindent 14 }}
      containers:
        - name: app
          image: "{{ .Values.image.repository }}@{{ .Values.image.digest }}"
          imagePullPolicy: IfNotPresent
          ports:
            - { name: health, containerPort: 8080 }
            {{- if .Values.service.rpcPort }}
            - { name: rpc, containerPort: {{ .Values.service.rpcPort }} }
            {{- end }}
            {{- if .Values.service.httpPort }}
            - { name: http, containerPort: {{ .Values.service.httpPort }} }
            {{- end }}
          env:
            - { name: NODE_ENV, value: production }
            - { name: HEALTH_PORT, value: "8080" }
            - name: NODE_OPTIONS
              value: "--max-old-space-size={{ .Values.heapSizeMb }}"
            - { name: UV_THREADPOOL_SIZE, value: "{{ .Values.uvThreadpoolSize | default 8 }}" }
            {{- range $k, $v := .Values.env }}
            - { name: {{ $k }}, value: {{ $v | quote }} }
            {{- end }}
          envFrom:
            - configMapRef: { name: ecommerce-common }
            {{- range .Values.secretRefs }}
            - secretRef: { name: {{ . }} }
            {{- end }}
          # startupProbe absorbs slow TypeORM/entity boot so liveness can stay tight
          startupProbe:
            httpGet: { path: /health/live, port: health }
            periodSeconds: 2
            failureThreshold: 30
          # liveness = process only. Never check the DB here (see §2 B3).
          livenessProbe:
            httpGet: { path: /health/live, port: health }
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 3
          # readiness = dependencies. Pulls the pod from the Service without restarting it.
          readinessProbe:
            httpGet: { path: /health/ready, port: health }
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 2
          lifecycle:
            preStop:
              exec: { command: ["sh", "-c", "sleep 10"] }   # let endpoints converge before draining
          resources: {{- toYaml .Values.resources | nindent 12 }}
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
          volumeMounts:
            - { name: tmp, mountPath: /tmp }
      volumes:
        - name: tmp
          emptyDir: { sizeLimit: 64Mi }
```

`service.yaml`, `pdb.yaml`, `servicemonitor.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: {{ include "nest-service.fullname" . }}
  labels: {{- include "nest-service.labels" . | nindent 4 }}
spec:
  type: ClusterIP
  selector: {{- include "nest-service.selectorLabels" . | nindent 4 }}
  ports:
    - { name: health, port: 8080, targetPort: health }
    {{- if .Values.service.httpPort }}
    - { name: http, port: {{ .Values.service.httpPort }}, targetPort: http }
    {{- end }}
    {{- if .Values.service.rpcPort }}
    # ⚠️ TCP transport only: a ClusterIP pins each connection to ONE pod (§2 B1).
    # With NATS, backends need no Service at all — delete this port.
    - { name: rpc, port: {{ .Values.service.rpcPort }}, targetPort: rpc }
    {{- end }}
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ include "nest-service.fullname" . }}
spec:
  maxUnavailable: 1
  selector:
    matchLabels: {{- include "nest-service.selectorLabels" . | nindent 6 }}
---
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: {{ include "nest-service.fullname" . }}
spec:
  selector:
    matchLabels: {{- include "nest-service.selectorLabels" . | nindent 6 }}
  endpoints:
    - { port: health, path: /metrics, interval: 30s }
```

---

## Appendix C — `values-prod.yaml`

```yaml
global:
  imageRegistry: registry.internal/ecommerce
  natsUrl: nats://nats.messaging.svc.cluster.local:4222

common:
  config:
    NODE_ENV: production
    LOG_LEVEL: info
    NATS_URL: nats://nats.messaging.svc.cluster.local:4222
    DB_SYNC: "false"          # NEVER "true" (§2 B4)

api-gateway:
  replicaCount: 3
  image: { repository: registry.internal/ecommerce/api-gateway, digest: "sha256:REPLACE_ME" }
  service: { httpPort: 3000 }
  heapSizeMb: 384
  priorityClassName: ecommerce-critical
  resources:
    requests: { cpu: 200m, memory: 512Mi }
    limits:   { memory: 512Mi }        # deliberately no CPU limit — see §8
  secretRefs: [ecommerce-jwt]
  hpa:
    enabled: true
    minReplicas: 3
    maxReplicas: 10
    targetCPUUtilizationPercentage: 65
    behavior:
      scaleDown: { stabilizationWindowSeconds: 300 }
  ingress:
    enabled: true
    className: kong
    host: api.example.com
    tls: { secretName: api-tls }

auth-service:
  replicaCount: 3
  image: { repository: registry.internal/ecommerce/auth-service, digest: "sha256:REPLACE_ME" }
  service: { rpcPort: 3001 }           # drop entirely once on NATS
  heapSizeMb: 384
  uvThreadpoolSize: 12                 # bcrypt is sync work on the libuv pool (§8)
  priorityClassName: ecommerce-critical
  resources:
    requests: { cpu: 150m, memory: 512Mi }
    limits:   { memory: 512Mi }
  env:
    DB_NAME: auth_db
    REDIS_HOST: redis.data.svc.cluster.local
    REDIS_PORT: "6379"
  secretRefs: [ecommerce-jwt, auth-db-credentials]

product-service:
  replicaCount: 3
  image: { repository: registry.internal/ecommerce/product-service, digest: "sha256:REPLACE_ME" }
  service: { rpcPort: 3002 }
  heapSizeMb: 384
  resources:
    requests: { cpu: 150m, memory: 512Mi }
    limits:   { memory: 512Mi }
  env: { PRODUCT_DB_NAME: product_db }
  secretRefs: [product-db-credentials]

cart-service:
  replicaCount: 2
  image: { repository: registry.internal/ecommerce/cart-service, digest: "sha256:REPLACE_ME" }
  service: { rpcPort: 3003 }
  heapSizeMb: 288
  resources:
    requests: { cpu: 100m, memory: 384Mi }
    limits:   { memory: 384Mi }
  env: { CART_DB_NAME: cart_db }
  secretRefs: [cart-db-credentials]

orders-service:
  replicaCount: 2
  image: { repository: registry.internal/ecommerce/orders-service, digest: "sha256:REPLACE_ME" }
  service: { rpcPort: 3004 }
  heapSizeMb: 384
  resources:
    requests: { cpu: 150m, memory: 512Mi }
    limits:   { memory: 512Mi }
  env: { ORDER_DB_NAME: order_db }
  secretRefs: [order-db-credentials]

payment-service:
  replicaCount: 2
  image: { repository: registry.internal/ecommerce/payment-service, digest: "sha256:REPLACE_ME" }
  service: { rpcPort: 3005 }
  heapSizeMb: 288
  resources:
    requests: { cpu: 100m, memory: 384Mi }
    limits:   { memory: 384Mi }
  secretRefs: [stripe-credentials]
  egress: { allowInternet: true }       # the ONLY service allowed out (§14)

user-service:
  replicaCount: 2
  image: { repository: registry.internal/ecommerce/user-service, digest: "sha256:REPLACE_ME" }
  service: { rpcPort: 3006 }
  heapSizeMb: 288
  resources:
    requests: { cpu: 100m, memory: 384Mi }
    limits:   { memory: 384Mi }
  env: { USER_DB_NAME: user_db }
  secretRefs: [user-db-credentials]
```

---

## Appendix D — Postgres (CloudNativePG)

**Recommended: one HA cluster, five databases** (§2 B7).

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: ecommerce-pg
  namespace: data
spec:
  instances: 3
  imageName: ghcr.io/cloudnative-pg/postgresql:16.4

  primaryUpdateStrategy: unsupervised
  minSyncReplicas: 1          # a commit exists on 2 nodes before the client hears "ok"
  maxSyncReplicas: 1

  postgresql:
    parameters:
      max_connections: "300"            # see the pool math in §16
      shared_buffers: "2GB"
      effective_cache_size: "6GB"
      work_mem: "16MB"
      maintenance_work_mem: "512MB"
      wal_compression: "on"
      log_min_duration_statement: "500"
      lock_timeout: "5s"
      idle_in_transaction_session_timeout: "60s"
    pg_hba:
      - hostssl all all 10.244.0.0/16 scram-sha-256

  storage:      { size: 100Gi, storageClass: rook-ceph-block }
  walStorage:   { size: 20Gi,  storageClass: rook-ceph-block }   # separate PVC: WAL must not fight data I/O

  resources:
    requests: { cpu: "1",   memory: 4Gi }
    limits:   { cpu: "4",   memory: 8Gi }

  affinity:
    enablePodAntiAffinity: true
    topologyKey: kubernetes.io/hostname
    nodeSelector: { workload: data }
    tolerations:
      - { key: workload, operator: Equal, value: data, effect: NoSchedule }

  bootstrap:
    initdb:
      database: auth_db
      owner: auth_svc
      secret: { name: auth-db-credentials }
      postInitSQL:
        - CREATE ROLE product_svc LOGIN;
        - CREATE ROLE cart_svc LOGIN;
        - CREATE ROLE order_svc LOGIN;
        - CREATE ROLE user_svc LOGIN;
        - CREATE ROLE migration_svc LOGIN;      # DDL rights; used ONLY by the migration Job
        - CREATE DATABASE product_db OWNER product_svc;
        - CREATE DATABASE cart_db    OWNER cart_svc;
        - CREATE DATABASE order_db   OWNER order_svc;
        - CREATE DATABASE user_db    OWNER user_svc;

  backup:
    retentionPolicy: "30d"
    barmanObjectStore:
      destinationPath: s3://ecommerce-pg-backups/
      endpointURL: https://minio.storage.internal:9000
      s3Credentials:
        accessKeyId:     { name: minio-creds, key: ACCESS_KEY_ID }
        secretAccessKey: { name: minio-creds, key: SECRET_ACCESS_KEY }
      wal:  { compression: gzip, maxParallel: 4 }
      data: { compression: gzip, immediateCheckpoint: false }
---
apiVersion: postgresql.cnpg.io/v1
kind: ScheduledBackup
metadata: { name: ecommerce-pg-nightly, namespace: data }
spec:
  schedule: "0 30 2 * * *"          # 6 fields: sec min hour dom mon dow
  backupOwnerReference: self
  cluster: { name: ecommerce-pg }
---
# PgBouncer in transaction mode — see the connection math in §16
apiVersion: postgresql.cnpg.io/v1
kind: Pooler
metadata: { name: ecommerce-pg-pooler, namespace: data }
spec:
  cluster: { name: ecommerce-pg }
  instances: 3
  type: rw
  pgbouncer:
    poolMode: transaction          # no session state: no SET, no advisory locks, no cross-tx prepared stmts
    parameters:
      max_client_conn: "500"
      default_pool_size: "25"
```

Apps then connect to `ecommerce-pg-pooler-rw.data.svc.cluster.local:5432`.

**Restore drill (run it monthly — this is the whole point of having backups):**

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata: { name: pg-restore-test, namespace: data-scratch }
spec:
  instances: 1
  storage: { size: 100Gi, storageClass: rook-ceph-block }
  bootstrap:
    recovery:
      source: ecommerce-pg
      recoveryTarget: { targetTime: "2026-07-25 03:00:00.00000+00" }   # PITR
  externalClusters:
    - name: ecommerce-pg
      barmanObjectStore:
        destinationPath: s3://ecommerce-pg-backups/
        endpointURL: https://minio.storage.internal:9000
        s3Credentials:
          accessKeyId:     { name: minio-creds, key: ACCESS_KEY_ID }
          secretAccessKey: { name: minio-creds, key: SECRET_ACCESS_KEY }
```

> **Per-service clusters instead?** Duplicate the `Cluster` above five times with `instances: 3` each (15 Postgres pods, 30 PVCs, 5 backup schedules). Real failure-domain isolation, roughly 5× the operational load. Defensible once a service's write volume justifies its own cluster — record the decision in `context/decisions/`.

---

## Appendix E — NetworkPolicies (default-deny)

```yaml
# 1. Deny everything in the namespace, both directions. Every allow below is explicit.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny-all, namespace: ecommerce-prod }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
---
# 2. DNS egress — without this, nothing resolves and every symptom looks like a broken app
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: allow-dns, namespace: ecommerce-prod }
spec:
  podSelector: {}
  policyTypes: [Egress]
  egress:
    - to:
        - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: kube-system } }
          podSelector: { matchLabels: { k8s-app: kube-dns } }
      ports: [{ protocol: UDP, port: 53 }, { protocol: TCP, port: 53 }]
---
# 3. Kong → gateway (the only ingress path into the namespace)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: allow-kong-to-gateway, namespace: ecommerce-prod }
spec:
  podSelector: { matchLabels: { app.kubernetes.io/name: api-gateway } }
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: kong } }
      ports: [{ protocol: TCP, port: 3000 }]
---
# 4. All app pods → NATS  (✅ NATS path; replaces every gateway→service TCP rule)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: allow-egress-nats, namespace: ecommerce-prod }
spec:
  podSelector: {}
  policyTypes: [Egress]
  egress:
    - to:
        - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: messaging } }
      ports: [{ protocol: TCP, port: 4222 }]
---
# 4b. ⚠️ TCP path instead: gateway → each backend RPC port
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: allow-gateway-to-services, namespace: ecommerce-prod }
spec:
  podSelector:
    matchExpressions:
      - key: app.kubernetes.io/name
        operator: In
        values: [auth-service, product-service, cart-service, orders-service, payment-service, user-service]
  policyTypes: [Ingress]
  ingress:
    - from:
        - podSelector: { matchLabels: { app.kubernetes.io/name: api-gateway } }
      ports:
        - { protocol: TCP, port: 3001 }
        - { protocol: TCP, port: 3002 }
        - { protocol: TCP, port: 3003 }
        - { protocol: TCP, port: 3004 }
        - { protocol: TCP, port: 3005 }
        - { protocol: TCP, port: 3006 }
---
# 5. cart → product (the one service-to-service edge: context/CART_PRODUCT_INTEGRATION.md)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: allow-cart-to-product, namespace: ecommerce-prod }
spec:
  podSelector: { matchLabels: { app.kubernetes.io/name: product-service } }
  policyTypes: [Ingress]
  ingress:
    - from:
        - podSelector: { matchLabels: { app.kubernetes.io/name: cart-service } }
      ports: [{ protocol: TCP, port: 3002 }]
---
# 6. Services → Postgres / Redis
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: allow-egress-data, namespace: ecommerce-prod }
spec:
  podSelector:
    matchExpressions:
      - key: app.kubernetes.io/name
        operator: In
        values: [auth-service, product-service, cart-service, orders-service, user-service]
  policyTypes: [Egress]
  egress:
    - to:
        - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: data } }
      ports: [{ protocol: TCP, port: 5432 }, { protocol: TCP, port: 6379 }]
---
# 7. Prometheus → /metrics on every pod
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: allow-prometheus-scrape, namespace: ecommerce-prod }
spec:
  podSelector: {}
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: observability } }
      ports: [{ protocol: TCP, port: 8080 }]
---
# 8. payment-service → Stripe. The ONLY workload with internet egress.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: allow-payment-internet-egress, namespace: ecommerce-prod }
spec:
  podSelector: { matchLabels: { app.kubernetes.io/name: payment-service } }
  policyTypes: [Egress]
  egress:
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except: [10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.169.254/32]
      ports: [{ protocol: TCP, port: 443 }]
```

**Test these negatively.** A policy you've only confirmed doesn't break the happy path is not a verified policy:

```bash
kubectl -n ecommerce-prod debug -it deploy/cart-service --image=nicolaka/netshoot -- \
  nc -zv ecommerce-pg-pooler-rw.data.svc.cluster.local 5432   # should CONNECT
kubectl -n ecommerce-prod debug -it deploy/user-service --image=nicolaka/netshoot -- \
  nc -zv api.stripe.com 443                                   # should TIME OUT
```

---

## Appendix F — Kong Ingress + plugins

```yaml
apiVersion: configuration.konghq.com/v1
kind: KongClusterPlugin
metadata:
  name: global-correlation-id
  labels: { global: "true" }
config: { header_name: X-Request-Id, generator: uuid, echo_downstream: true }
plugin: correlation-id
---
apiVersion: configuration.konghq.com/v1
kind: KongClusterPlugin
metadata:
  name: global-rate-limit
  labels: { global: "true" }
config: { minute: 600, policy: local, fault_tolerant: true }
plugin: rate-limiting
---
apiVersion: configuration.konghq.com/v1
kind: KongClusterPlugin
metadata:
  name: global-request-size
  labels: { global: "true" }
config: { allowed_payload_size: 1 }        # MB
plugin: request-size-limiting
---
apiVersion: configuration.konghq.com/v1
kind: KongClusterPlugin
metadata:
  name: global-cors
  labels: { global: "true" }
config:
  origins: ["https://app.example.com"]
  methods: [GET, POST, PUT, PATCH, DELETE, OPTIONS]
  headers: [Content-Type, Authorization]
  credentials: true
  max_age: 3600
plugin: cors
# ⚠️ Remove app.enableCors() from apps/api-gateway/src/main.ts — two CORS layers
#    emit duplicate Access-Control-Allow-Origin headers, which browsers reject.
---
# Tight limit on credential endpoints. The global 600/min is useless against credential stuffing.
apiVersion: configuration.konghq.com/v1
kind: KongPlugin
metadata: { name: auth-strict-rate-limit, namespace: ecommerce-prod }
config: { minute: 5, policy: local, limit_by: ip }
plugin: rate-limiting
---
# Main API route
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ecommerce-api
  namespace: ecommerce-prod
  annotations:
    konghq.com/strip-path: "false"
    konghq.com/protocols: "https"
    konghq.com/https-redirect-status-code: "308"
    konghq.com/read-timeout: "15000"          # not Kong's 60s default (§9)
    konghq.com/write-timeout: "15000"
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: kong
  tls:
    - hosts: [api.example.com]
      secretName: api-tls
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /api/v1
            pathType: Prefix
            backend:
              service: { name: api-gateway, port: { number: 3000 } }
---
# Credential endpoints: same backend, stricter plugin
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ecommerce-auth-strict
  namespace: ecommerce-prod
  annotations:
    konghq.com/plugins: auth-strict-rate-limit
    konghq.com/strip-path: "false"
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: kong
  tls: [{ hosts: [api.example.com], secretName: api-tls }]
  rules:
    - host: api.example.com
      http:
        paths:
          - { path: /api/v1/auth/login,           pathType: Exact, backend: { service: { name: api-gateway, port: { number: 3000 } } } }
          - { path: /api/v1/auth/forgot-password, pathType: Exact, backend: { service: { name: api-gateway, port: { number: 3000 } } } }
---
# Stripe webhook — NO rate limit (shared bursty source IPs), NO body transformation
# (raw body must reach stripe.webhooks.constructEvent intact), @Public() in the app.
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ecommerce-stripe-webhook
  namespace: ecommerce-prod
  annotations:
    konghq.com/plugins: ""                    # deliberately empty: no global rate limit here
    konghq.com/strip-path: "false"
    konghq.com/read-timeout: "30000"
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: kong
  tls: [{ hosts: [api.example.com], secretName: api-tls }]
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /api/v1/payments/webhook
            pathType: Exact
            backend:
              service: { name: api-gateway, port: { number: 3000 } }
```

Kong chart values worth setting: `replicaCount: 2`, `podDisruptionBudget.enabled: true`, `proxy.type: LoadBalancer` with the MetalLB annotation for a fixed IP, `ingressController.ingressClass: kong`, `serviceMonitor.enabled: true`.

---

## Appendix G — Migration Job (Argo CD PreSync hook)

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: db-migrate-{{ .Release.Revision }}
  namespace: ecommerce-prod
  annotations:
    argocd.argoproj.io/hook: PreSync              # runs BEFORE app pods roll
    argocd.argoproj.io/hook-delete-policy: HookSucceeded
    argocd.argoproj.io/sync-wave: "1"
spec:
  backoffLimit: 2
  activeDeadlineSeconds: 900
  ttlSecondsAfterFinished: 86400
  template:
    spec:
      restartPolicy: Never
      automountServiceAccountToken: false
      securityContext: { runAsNonRoot: true, runAsUser: 10001, seccompProfile: { type: RuntimeDefault } }
      containers:
        - name: migrate
          image: "registry.internal/ecommerce/auth-service@{{ .Values.migration.digest }}"
          command: ["node", "node_modules/typeorm/cli.js"]
          args: ["migration:run", "-d", "dist/data-source.js"]
          env:
            # migration_svc has DDL rights; the runtime role deliberately does not
            - { name: DB_USERNAME, valueFrom: { secretKeyRef: { name: migration-db-credentials, key: username } } }
            - { name: DB_PASSWORD, valueFrom: { secretKeyRef: { name: migration-db-credentials, key: password } } }
            - { name: DB_HOST, value: ecommerce-pg-rw.data.svc.cluster.local }   # bypass the pooler: DDL needs a session
            - { name: DB_PORT, value: "5432" }
            - { name: PGOPTIONS, value: "-c lock_timeout=5s -c statement_timeout=600s" }
          resources:
            requests: { cpu: 100m, memory: 256Mi }
            limits:   { memory: 512Mi }
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
```

Two details that are easy to get wrong:

- **Connect to `-rw`, not the pooler.** Transaction-mode PgBouncer breaks session-scoped DDL and advisory locks.
- **`lock_timeout=5s`.** A DDL statement that can't get its lock queues *behind every query on that table* and blocks the application. Failing fast and retrying off-peak is strictly better than a self-inflicted outage.

Run one Job per database (5 total), or one Job invoking each service's DataSource in sequence.

---

## Appendix H — Required code changes

### H1. Health module (§2 B3) — `libs/common/src/health/health.module.ts`

```ts
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule.forRoot({ gracefulShutdownTimeoutMs: 10_000 })],
  controllers: [HealthController],
})
export class HealthModule {}
```

```ts
// libs/common/src/health/health.controller.ts
import { Controller, Get, Inject, Optional } from '@nestjs/common';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import type Redis from 'ioredis';
import { Public } from '../decorators';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    @Optional() private readonly db?: TypeOrmHealthIndicator,
    @Optional() @Inject('REDIS_CLIENT') private readonly redis?: Redis,
  ) {}

  // Liveness: process only. Checking the DB here would restart the whole
  // fleet during a Postgres blip — a recoverable outage becomes a stampede.
  @Public()
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  // Readiness: dependencies. Failing here removes the pod from the Service
  // without restarting it, which is exactly the desired behaviour.
  @Public()
  @Get('ready')
  @HealthCheck()
  ready() {
    const checks = [];
    if (this.db) checks.push(() => this.db!.pingCheck('postgres', { timeout: 2000 }));
    if (this.redis)
      checks.push(async () => {
        await this.redis!.ping();
        return { redis: { status: 'up' } };
      });
    return this.health.check(checks);
  }
}
```

### H2. Hybrid app so TCP/NATS services can be probed — e.g. `apps/auth-service/src/main.ts`

```ts
import { NestFactory } from '@nestjs/core';
import { Transport } from '@nestjs/microservices';
import { AllRpcExceptionsFilter } from '@app/common';
import { AuthServiceModule } from './auth-service.module';

async function bootstrap() {
  // HTTP app for /health + /metrics ONLY (never exposed via Ingress)…
  const app = await NestFactory.create(AuthServiceModule);

  // …plus the RPC listener on the same process.
  app.connectMicroservice(
    {
      transport: Transport.NATS,   // ✅ §2 B1. TCP path: Transport.TCP + host/port
      options: {
        servers: [process.env.NATS_URL!],
        queue: 'auth-service',     // queue group → real load balancing across replicas
      },
    },
    { inheritAppConfig: true },
  );

  app.useGlobalFilters(new AllRpcExceptionsFilter());
  app.enableShutdownHooks();

  await app.startAllMicroservices();
  await app.listen(Number(process.env.HEALTH_PORT ?? 8080), '0.0.0.0');
}
void bootstrap();
```

### H3. Fail-fast config (§2 B5) — replaces every `|| 'fallback'`

```ts
// libs/common/src/config/env.validation.ts
import * as Joi from 'joi';

export const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').required(),
  JWT_SECRET: Joi.string().min(32).required(),            // no default. Ever.
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().required(),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  DB_SYNC: Joi.boolean().default(false),                  // §2 B4
  NATS_URL: Joi.string().uri({ scheme: ['nats'] }).required(),
  HEALTH_PORT: Joi.number().port().default(8080),
}).unknown(true);
```

```ts
// in each *-service.module.ts
ConfigModule.forRoot({
  isGlobal: true,
  validationSchema: envSchema,
  validationOptions: { abortEarly: false },   // report ALL missing vars, not just the first
}),
TypeOrmModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (c: ConfigService) => ({
    type: 'postgres',
    host: c.getOrThrow('DB_HOST'),
    port: c.getOrThrow<number>('DB_PORT'),
    username: c.getOrThrow('DB_USERNAME'),
    password: c.getOrThrow('DB_PASSWORD'),
    database: c.getOrThrow('DB_NAME'),
    autoLoadEntities: true,
    synchronize: c.get<boolean>('DB_SYNC') === true,   // false in prod (§2 B4)
    migrationsRun: false,                              // the PreSync Job owns migrations
    ssl: { rejectUnauthorized: false },
    extra: { max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 },
  }),
}),
```

Also in `apps/api-gateway/src/api-gateway.module.ts`, replace:

```diff
- JwtModule.register({ secret: process.env.JWT_SECRET || 'jwt-secret' }),
+ JwtModule.registerAsync({
+   inject: [ConfigService],
+   useFactory: (c: ConfigService) => ({ secret: c.getOrThrow('JWT_SECRET') }),
+ }),
```

### H4. TypeORM DataSource for the migration CLI — `apps/auth-service/src/data-source.ts`

```ts
import { DataSource } from 'typeorm';

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: ['dist/**/*.entity.js'],
  migrations: ['dist/migrations/*.js'],
  migrationsTableName: 'typeorm_migrations',
});
```

```bash
# Baseline from the schema synchronize: true has already created, then review it by hand
pnpm typeorm-ts-node-commonjs migration:generate \
  apps/auth-service/src/migrations/InitialSchema \
  -d apps/auth-service/src/data-source.ts
```

Repeat per service. **Read every generated migration before committing** — TypeORM will cheerfully generate a `DROP COLUMN` from an entity drift you didn't intend, and once it's in a PreSync hook it runs against production without a prompt.

---

## Related documents

- `docs/syllabi/kubernetes.md` — learning roadmap; this plan is its production target
- `docs/syllabi/kubernetes-notes.md` — lessons log
- `context/CART_PRODUCT_INTEGRATION.md` — the cart→product edge in Appendix E
- `docs/guides/KONG_API_GATEWAY_GUIDE.md`, `docs/guides/KONG_KEYCLOAK_SETUP.md` — existing Kong work
- `docs/planning/PAYMENT_FLOW.md` — Stripe webhook path (§9)
- `context/decisions/` — record the B1 transport choice and the B7 database-topology choice here
