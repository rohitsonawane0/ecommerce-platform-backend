# 📚 Learning Roadmap: Scalable Microservices

> **Status:** Active — Not yet started
> **Generated:** 2026-06-07 · **Expanded:** 2026-06-07 (16 → 24 concepts, "don't leave anything")
> **Canonical tracker.** Draft origin: `docs/planning/scalable_microservices.md` (superseded by this file).

---

## 👤 Learner Profile (Phase 1)

| Dimension | Answer | Effect on this syllabus |
|---|---|---|
| **Why** | Curiosity / mastery | Success signals favour *explain / justify / defend / draw* over *ship*. Tradeoffs emphasised everywhere. |
| **Current level (scaling)** | Basics only | Level 1 begins at zero. Added **1.0 Microservices Fundamentals**. Jargon defined on first use. |
| **Depth** | Production-grade | Levels 4–5 are mandatory, not optional. Complete coverage requested. |
| **Timeline** | No rush | ~1 concept / session; meaty ones span 2. Prereqs revisited freely. |
| **Building?** | Reference vehicle | Grounded in this repo (`auth`, `product`, `cart`, `orders`, `payment`, `user` services + `api-gateway`). Learning is the priority over feature delivery. |

---

## 🧭 How to use this file

**Progress legend:** `- [ ]` not started · `- [/]` in progress · `- [x]` completed (passed its success signal).

**Rules of engagement (from the Architect prompt):**
- One concept at a time, in order. No skipping — sequence is load-bearing.
- Each concept unfolds in 5 layers: ① basic idea → ② internal mechanics → ③ real-world usage → ④ production concerns → ⑤ edge cases. Checkpoint question between layers.
- A concept is marked `- [x]` **only** after you pass its success signal.
- Max 1 new concept per response unless you ask for more.

**📊 Progress:** `0 / 24` concepts complete. **Total estimate (no-rush): ~28–31 sessions.**

---

## Level 1 — Foundations (Architecture & Communication)
*Estimate: ~6 sessions*

- [ ] **1.0 Microservices Fundamentals** — monolith vs microservices, scaling axes, the cost of "distributed"
  - **Prereq:** None
  - **Why now:** You rated scaling as "basics only." Before splitting services well, you need *what a microservice actually is*, the **AKF Scale Cube** (X = clone/replicate, Y = split by function, Z = partition/shard data), vertical vs horizontal scaling, and the **8 Fallacies of Distributed Computing**. This is the lens for everything after.
  - **Success signal:** Can explain — using your repo — why splitting into `auth`/`product`/`cart` is Y-axis scaling, what you *gave up* the moment those calls crossed a network boundary, and name a case where a monolith would have been the better call.

- [ ] **1.1 Domain-Driven Design (DDD) & Service Boundaries**
  - **Prereq:** 1.0
  - **Why now:** Bad boundaries create a *distributed monolith* — the worst of both worlds. Bounded contexts decide where the seams go.
  - **Success signal:** Can define the bounded contexts for this app and defend a hard one — e.g. why `cart` and `orders` are separate contexts despite sharing line-item data.

- [ ] **1.2 API Gateway & Backend-for-Frontend (BFF)**
  - **Prereq:** 1.1
  - **Why now:** You already have an `api-gateway`. Its real jobs — routing, auth offload, rate limiting, response aggregation, fan-out — must be understood before scaling traffic.
  - **Success signal:** Can explain how the gateway would aggregate product details + inventory + reviews into one client response, and when you'd add a second (mobile) BFF.

- [ ] **1.3 Synchronous vs. Asynchronous Communication**
  - **Prereq:** 1.2
  - **Why now:** You currently use NestJS **TCP** (synchronous RPC). Scaling forces the REST/gRPC vs message-broker decision, and the difference between *request/response* and *event-driven*.
  - **Success signal:** Can decide, with reasons, when `orders → payment` should be a synchronous call vs an emitted event, and what each choice costs in latency, coupling, and failure handling.

- [ ] **1.4 Message Brokers & Delivery Guarantees** *(added — mechanics behind 1.3)*
  - **Prereq:** 1.3
  - **Why now:** 1.3 was the *decision*; this is *how brokers actually work*. Queues vs logs (RabbitMQ vs Kafka), partitions & ordering, consumer groups, delivery semantics (at-most-once / at-least-once / effectively-once), dead-letter queues, backpressure. Prereq for Sagas and event-driven data.
  - **Success signal:** Can explain why Kafka preserves order only within a partition, what a consumer group buys you, and which delivery guarantee a `payment.succeeded` event needs — and why that forces idempotency downstream (5.3).

---

## Level 2 — Core Mechanics (Data & Consistency)
*Estimate: ~6 sessions (Saga, Outbox, CQRS are heavy)*

- [ ] **2.1 Database per Service & Polyglot Persistence**
  - **Prereq:** Level 1
  - **Why now:** Independent scaling requires services to own their data — no shared tables, no cross-service joins. This is what makes the rest hard (and interesting).
  - **Success signal:** Can justify why `product` might use a search-optimised store while `orders` stays on PostgreSQL, and explain how you'd query data you no longer own.

- [ ] **2.2 Distributed Transactions & the Saga Pattern**
  - **Prereq:** 2.1, 1.4
  - **Why now:** There is no `BEGIN TRANSACTION` across services. When checkout spans cart → order → payment → inventory, how do you stay consistent if payment succeeds but inventory fails?
  - **Success signal:** Can draw both a **choreography** and an **orchestration** saga for your checkout flow, with compensating actions, and argue which fits this repo.

- [ ] **2.3 Transactional Outbox & Change Data Capture (CDC)** *(added — the dual-write problem)*
  - **Prereq:** 2.1, 1.4
  - **Why now:** You **cannot** atomically write to your DB *and* publish an event — one can fail, silently dropping the event. Sagas (2.2) and event-driven reads (2.4) are unreliable without this. The outbox (write event in the same DB transaction, relay later) and CDC (Debezium tailing the WAL) solve it.
  - **Success signal:** Can explain why "save order, then publish `order.created`" can silently lose events, and draw the outbox flow that fixes it for `orders-service`.

- [ ] **2.4 Event Sourcing & CQRS**
  - **Prereq:** 2.2, 2.3
  - **Why now:** Advanced data management for high-read/high-write asymmetry; also the natural home for an audit trail.
  - **Success signal:** Can explain how you'd split the write model (place order) from the read model (order history view), and name when event sourcing is overkill.

---

## Level 3 — Practical Implementation (Resilience, Security, Evolution)
*Estimate: ~4–5 sessions*

- [ ] **3.1 Service Discovery & Load Balancing**
  - **Prereq:** Level 2
  - **Why now:** Your gateway hardcodes `host`/`port` per service. At scale, instances come and go — services must *find* each other dynamically.
  - **Success signal:** Can explain how Kubernetes DNS / a service registry (Consul) replaces those hardcoded ports, and where load balancing happens (client- vs server-side).

- [ ] **3.2 Resiliency Patterns (Circuit Breakers, Retries, Timeouts, Bulkheads, Rate Limiting)**
  - **Prereq:** 3.1
  - **Why now:** Your `RISK WATCH` flags it: TCP `firstValueFrom` has no timeout, so a downed `orders` hangs the gateway. One slow service shouldn't sink the system. Includes rate limiting / backpressure (you already have `@nestjs/throttler`).
  - **Success signal:** Can describe a circuit breaker + fallback in the gateway for a downed `payment-service`, and explain why naive retries can *cause* an outage (retry storms).

- [ ] **3.3 Distributed Authentication & Authorization (OAuth2 / OIDC / JWT)**
  - **Prereq:** 1.2
  - **Why now:** Securing client→service *and* service→service. You already issue JWTs; scaling adds validation strategy, rotation, and inter-service trust.
  - **Success signal:** Can explain how `cart-service` validates a JWT *without* calling `auth-service` per request, and the tradeoff of that choice (revocation lag).

- [ ] **3.4 API Versioning, Contract Testing & Schema Evolution** *(added — requested)*
  - **Prereq:** 1.3 (benefits from 1.4)
  - **Why now:** Services deploy independently, so a payload change in `product-service` can silently break `cart-service`. You need versioning (URI/header/`@Version()`), backward/forward-compatible schema evolution, and consumer-driven contract tests (Pact).
  - **Success signal:** Can describe how to add a required field to the `product` payload without breaking existing consumers, and how a contract test would have caught your current hardcoded `{ id: 'hii' }` payment payload drift.

---

## Level 4 — Production & Scaling (Observability, Infra, Delivery)
*Estimate: ~8 sessions (k8s + mesh are large)*

- [ ] **4.1 Observability I — Logging & Distributed Tracing**
  - **Prereq:** Level 3
  - **Why now:** When checkout spans gateway → order → payment → inventory and fails, logs in 4 places are useless without a correlation/trace ID.
  - **Success signal:** Can trace a request across services with a propagated request-ID, and explain what OpenTelemetry spans give you over plain logs.

- [ ] **4.2 Observability II — Metrics, SLOs/SLIs & Alerting** *(added — the other half of observability)*
  - **Prereq:** 4.1
  - **Why now:** Traces show *where one request* died; metrics show *aggregate health* and when to page someone. RED & USE methods, Prometheus, SLI/SLO/error budgets, alerting on symptoms not causes.
  - **Success signal:** Can define an SLO for the `product` list endpoint, the SLIs that measure it, and an alert that fires on user-visible pain rather than CPU noise.

- [ ] **4.3 Container Orchestration & Autoscaling (Kubernetes)**
  - **Prereq:** 4.1
  - **Why now:** Moving from `pnpm start:all` to infrastructure that auto-scales and self-heals.
  - **Success signal:** Can define a Horizontal Pod Autoscaler for `product-service` on CPU and explain readiness vs liveness probes.
  - **🔗 Cross-ref:** You have a separate, in-progress **[Kubernetes syllabus](kubernetes.md)** (6 concepts done). We'll lean on it here rather than duplicate — and quiz you on the relevant bits (spaced review).

- [ ] **4.4 Service Mesh (sidecars, mTLS, traffic management)** *(added)*
  - **Prereq:** 4.3, 3.1, 3.2
  - **Why now:** Discovery (3.1), resiliency (3.2), mTLS and telemetry are cross-cutting — re-implementing them in every service is waste. A mesh (Istio/Linkerd) pushes them into sidecar proxies, out of app code.
  - **Success signal:** Can explain what moves from your NestJS code into the mesh, how mTLS secures service-to-service traffic without app changes, and the cost (latency, ops complexity) of adding one.

- [ ] **4.5 Configuration, Secrets & Feature Flags** *(added)*
  - **Prereq:** 4.3
  - **Why now:** Your repo reads config straight from `process.env` with a hardcoded `JWT_SECRET` fallback and ports duplicated in two places — a documented risk. At scale you need centralized/validated config, a secrets manager, and feature flags to decouple deploy from release.
  - **Success signal:** Can describe a fail-fast config strategy (schema-validated, no insecure fallback) and how a feature flag lets you ship `payment` webhook code dark, then enable it without redeploy.

- [ ] **4.6 Infrastructure as Code, CI/CD & Deployment Strategies**
  - **Prereq:** 4.3, 4.5
  - **Why now:** Repeatable infra + zero-downtime releases (blue/green, canary, rolling) through an automated pipeline.
  - **Success signal:** Can describe a pipeline that safely rolls out a new `user-service` version with automatic rollback on error-rate spike.

---

## Level 5 — Advanced & Edge Cases (Expert Architect)
*Estimate: ~6 sessions*

- [ ] **5.1 Scaling the Data Layer — Replicas, Sharding, Connection Pooling** *(added)*
  - **Prereq:** 2.1, 4.3
  - **Why now:** DB-per-service (2.1) gave each service its *own* DB; this is scaling that single DB when one service gets hot — read replicas (read/write split), sharding/partitioning (scale-cube Z-axis made concrete), and connection pooling (a real ceiling at many replicas).
  - **Success signal:** Can decide when `product-service` needs read replicas vs sharding, explain the replication-lag consistency hazard, and why 50 pods each holding a pool can exhaust Postgres connections.

- [ ] **5.2 Distributed Caching & Cache Invalidation**
  - **Prereq:** 5.1
  - **Why now:** Essential at scale, famously hard. You already run Redis — caching product reads is the obvious win, stale data the obvious trap.
  - **Success signal:** Can design a caching strategy for `product-service` reads that stays correct under concurrent updates (TTL vs write-through vs invalidation), and name the failure mode of each.

- [ ] **5.3 Idempotency & Effectively-Once Processing**
  - **Prereq:** 1.4
  - **Why now:** Networks retry. Without idempotency you double-charge a card or create duplicate orders — exactly the risk in your unfinished Stripe webhook.
  - **Success signal:** Can implement idempotency keys for `payment-service` and explain why "exactly-once delivery" is a myth but "effectively-once processing" is achievable.

- [ ] **5.4 Distributed Coordination — Locking, Leader Election, Consensus** *(added)*
  - **Prereq:** 5.3, 1.4
  - **Why now:** The moment a service runs N replicas, "run this once" breaks — a scheduled job or stock-reservation must not fire on every replica. Distributed locks (Redlock), leader election, and the consensus basics (quorum, Raft) behind them.
  - **Success signal:** Can explain how to ensure only one replica sends the nightly report, why a naive Redis lock can double-fire, and where idempotency (5.3) is the safety net when coordination fails.

- [ ] **5.5 Chaos Engineering & Failure Injection**
  - **Prereq:** Level 4 observability
  - **Why now:** The only proof a system is resilient is breaking it on purpose and watching it survive.
  - **Success signal:** Can explain how the system should behave when you kill `cart-service`'s primary DB, and which earlier patterns (3.2, 5.3, 5.4) make that survivable.

---

## 🎯 Phase 4 — Integration Challenge *(unlocked after Levels 1–3)*

To be designed once you reach it. Will combine ≥3 concepts (target: **Saga + Outbox + Resiliency + Idempotency**), tie into the real checkout flow in this repo, and carry a production constraint. Acceptance criteria defined at unlock.

---

## 🧪 Phase 5 — Mastery Test *(after all 24 concepts)*

1. Explain the architecture impact of microservices on this platform.
2. Identify ≥2 tradeoffs vs a modular monolith.
3. Describe what breaks first at scale.
4. Defend one design decision (e.g. saga choreography vs orchestration, outbox vs direct publish) under pushback.
5. Explain when NOT to use microservices.

Scoring: 5/5 → topic **Mastered**. 1–2 misses → revisit those layers, retest only those. 3+ → return to Level 2.

---

## 🗂️ Session Log

| Date | Concept | Layers covered | Outcome |
|---|---|---|---|
| _2026-06-07_ | Syllabus generated | — | Phase 1 done |
| _2026-06-07_ | Expanded 16 → 24 ("don't leave anything") | — | Added 1.4, 2.3, 3.4, 4.2, 4.4, 4.5, 5.1, 5.4 |

---

## 🔗 Related syllabi
- [`kubernetes.md`](kubernetes.md) — feeds **4.3**. Spaced-review source.
