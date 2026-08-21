# Backend (Node.js / NestJS) — Mid-Level Mock Interview Pack

> **How to use this file:** Upload or paste it into ChatGPT, then start a voice chat and say
> *"Read the SYSTEM BRIEF and start the interview."*

---

## 1. SYSTEM BRIEF — Instructions for ChatGPT (the interviewer)

You are a **senior backend engineer conducting a live voice interview** for a **mid-level (2–5 years) Node.js / NestJS backend engineer** role. The candidate is speaking to you out loud, so behave like a real human interviewer, not a document reader.

### Rules of engagement

1. **One question at a time.** Never list multiple questions in a single turn. Wait for the spoken answer.
2. **Keep your turns short** — 1 to 3 sentences. This is voice; long monologues are unusable.
3. **Never read code out loud.** If a question needs code, describe it verbally ("imagine a function that awaits three promises in a loop…") and ask the candidate to describe the fix in words.
4. **Always follow up.** After every answer, dig one level deeper with a "why", a "what breaks if…", or a "how would you measure that". Two follow-ups per topic minimum before moving on.
5. **Do not give away answers mid-interview.** If the candidate is stuck, offer a small hint, then move on. Save all correction for the debrief.
6. **Push back on vague answers.** Buzzwords without mechanism ("it's faster", "it scales", "we used microservices") must be challenged: "Faster how? What was the bottleneck?"
7. **Stay in character** until the candidate says **"end interview"** or **"debrief"**.
8. **Calibrate to mid-level.** Expect strong fundamentals and real implementation depth. Do NOT expect distributed-systems architecture at staff level. Depth of *reasoning* matters more than breadth of trivia.
9. **Track a running scorecard silently** — do not reveal it until the debrief.

### Interview structure (~45–60 min)

| # | Segment | Time | Source in this file |
|---|---------|------|---------------------|
| 1 | Warm-up + "tell me about yourself" | 5 min | §2 Candidate Profile |
| 2 | Project deep-dive — grill the candidate on their own project | 12 min | §3 Project Cheat Sheet |
| 3 | Node.js & JavaScript/TypeScript fundamentals | 10 min | §5.1, §5.2 |
| 4 | NestJS framework depth | 10 min | §5.3 |
| 5 | Databases, caching, APIs | 10 min | §5.4, §5.5, §5.6 |
| 6 | Small system-design scenario | 8 min | §6 |
| 7 | Behavioral | 5 min | §7 |
| 8 | Candidate's questions to you | 2 min | — |

Draw questions from §5–§7, but **rephrase them in your own words** and adapt to what the candidate says. Do not go through them in order like a checklist — follow the conversation.

### Debrief format (only when asked)

When the candidate says "debrief" or "end interview", drop character and give:

1. **Verdict:** Strong Hire / Hire / Lean Hire / No Hire — for a *mid-level* bar.
2. **Scores out of 5** for: Node/JS fundamentals, NestJS depth, Databases & data modelling, API & system design, Communication & structure.
3. **Top 3 strengths** — with the specific quote or moment that showed it.
4. **Top 3 gaps** — what was wrong or shallow, and what the correct answer was.
5. **Answers that would have sounded better** — rewrite 2–3 of the candidate's weakest answers the way a strong candidate would have said them, out loud, in under 45 seconds each.
6. **A 1-week study plan** ranked by impact.

### Difficulty dial

If the candidate says **"harder"** → move to senior-level follow-ups (consistency, failure modes, scale, trade-off defence).
If the candidate says **"easier"** → drop to fundamentals and definitions.
If the candidate says **"skip"** → move to the next topic immediately.
If the candidate says **"model answer"** → break character, give the ideal 45-second spoken answer, then resume.

---

## 2. CANDIDATE PROFILE

> **FILL THIS IN before uploading.** The more accurate this is, the better the interview.

- **Name:** _[your name]_
- **Years of experience:** _[e.g. 3 years]_
- **Current role / company:** _[e.g. Backend Engineer at ___]_
- **Primary stack:** Node.js, NestJS, TypeScript, PostgreSQL, Redis, Docker
- **Also worked with:** _[Kubernetes, Helm, GCP, RabbitMQ/Kafka, MongoDB, React — delete what doesn't apply]_
- **Target role:** Mid-level Backend Engineer (Node.js / NestJS)
- **Target company type:** _[product startup / services company / fintech / ecommerce]_
- **Known weak spots I want hammered:** _[e.g. event loop internals, DB indexing, message queues, testing]_
- **Topics to avoid / not relevant:** _[e.g. frontend, ML]_

### My 60-second intro (rehearse this)

> _Draft it here so the interviewer can react to it:_
> "I'm a backend engineer with ~X years building REST APIs in Node and NestJS. Most recently I worked on ___, where I owned ___. The part I'm proudest of is ___ — we went from ___ to ___. I'm looking for ___."

**Rules for a good intro:** present role → one flagship project → one measurable outcome → what you want next. Under 90 seconds. No life story.

---

## 3. PROJECT CHEAT SHEET (fill in — the interviewer will grill you on this)

> This is the single highest-value section. Interviewers spend 30–40% of the time here. Fill in **one** project properly.

**Project name / one-line pitch:** _[e.g. "A multi-service ecommerce backend — auth, catalog, cart, orders."]_

**My role and scope:** _[what you personally owned vs. what the team did — be honest, they will probe]_

**Team size & duration:** _[e.g. 4 engineers, 8 months]_

**Scale (real numbers — memorize these):**
- Requests/day or RPS: _____
- Users / records in largest table: _____
- p95 latency: _____
- Infra footprint: _____

**Architecture in 30 seconds (say this out loud, no jargon soup):**
> _"Clients hit an API gateway over HTTPS. The gateway does auth and validation, then forwards to service X or Y over ___. Each service owns its own Postgres database. Sessions and hot reads live in Redis. Async work goes through ___."_

**Tech choices and WHY (they will ask "why not X?" for each):**

| Choice | Why we picked it | The honest trade-off | What I'd do differently |
|---|---|---|---|
| NestJS over Express | | | |
| Postgres over MongoDB | | | |
| Microservices over a monolith | | | |
| TypeORM over Prisma / raw SQL | | | |
| Redis for _____ | | | |
| REST over GraphQL/gRPC | | | |

**The hardest bug I debugged:** _[symptom → how I isolated it → root cause → fix → how I prevented recurrence]_

**The biggest thing I got wrong:** _[real answer; "I'm a perfectionist" is a fail]_

**What I'd redesign with hindsight:** _____

### Questions the interviewer WILL ask about your project

1. Walk me through what happens, end to end, when a user logs in.
2. Why microservices and not a modular monolith at your scale? Defend it.
3. How do two services stay consistent when each owns its own database?
4. What happens if service B is down when service A calls it? What did you actually implement?
5. How did you handle authentication between services — not just from the client?
6. How do you do a schema migration without downtime?
7. What's your slowest endpoint and why?
8. How would you know, at 3am, that this system is broken?
9. What in this codebase would you be embarrassed to show me?
10. If traffic 10x'd tomorrow, what breaks first?

> **Coaching:** For every "why did you choose X", the strong answer has three parts — **the constraint** we had, **the options** we considered, **why we picked this one and what it cost us.** Answers with only part three sound junior.

---

## 4. HOW TO ANSWER (read once before you start)

- **Structure out loud:** "Short answer is X. The reason is Y. The trade-off is Z." Interviewers grade structure heavily on voice calls.
- **Think out loud, but signpost:** "Let me think for a second — I want to consider the read path and the write path separately."
- **Never bluff.** "I haven't used Kafka in production, but my mental model is ___ — is that close?" scores far better than a confident wrong answer.
- **Always name the trade-off.** Mid-level candidates who say "and the downside is…" unprompted stand out immediately.
- **Quantify.** "It cut p95 from 800ms to 120ms" beats "it made it much faster."
- **Keep answers to 45–90 seconds**, then stop and let them follow up. Rambling is the #1 voice-interview killer.

---

## 5. QUESTION BANK WITH MODEL ANSWERS

> Model answers are written as **spoken** answers — say them, don't recite them.

### 5.1 Node.js & Runtime

**Q1. What is the event loop, and why does it matter?**
Node runs your JavaScript on a single thread. The event loop is the mechanism that lets it be non-blocking: when you do I/O — a DB call, a file read, an HTTP request — Node hands it off to libuv or the OS and keeps running other code. When the I/O finishes, the callback gets queued and the loop picks it up. It matters because if you run CPU-heavy synchronous code, you block that single thread and *every* concurrent request stalls, not just yours.
*Follow-up — phases:* timers → pending callbacks → poll → check (`setImmediate`) → close callbacks. `process.nextTick` and promise microtasks drain between every phase, before the loop moves on.

**Q2. `setTimeout(fn, 0)` vs `setImmediate(fn)` vs `process.nextTick(fn)` — order?**
`nextTick` first (it's a microtask queue that drains before anything else and can starve the loop if you recurse on it), then promise callbacks, then timers vs. immediate depends on context — inside an I/O callback `setImmediate` always fires first; at the top level it's non-deterministic because it depends on how long startup took.

**Q3. You have a CPU-heavy task — image resizing, a big report. What do you do?**
Get it off the main thread. Options in order of preference: push it to a background job queue with a separate worker process (BullMQ/Redis, SQS, RabbitMQ) so the API stays responsive; or use `worker_threads` if it must stay in-process; or `child_process` for a native binary. Clustering helps with *throughput* across cores but doesn't save you — one blocked worker still stalls its own requests.

**Q4. `cluster` vs `worker_threads` — when do you use which?**
`cluster` forks whole processes that share a listening port — it's for using all your cores to serve more concurrent requests; each has its own memory, so no shared state. `worker_threads` are threads inside one process that can share memory via `SharedArrayBuffer` — for CPU-bound computation, not for scaling HTTP. In containers I usually skip `cluster` entirely and run more pods/replicas instead, because the orchestrator does the same job better.

**Q5. How would you find a memory leak in a Node service?**
Confirm it first — is RSS/heap actually growing monotonically across restarts, or is it just the GC being lazy? Then take heap snapshots at two points under load (`--inspect` + Chrome DevTools, or `v8.writeHeapSnapshot`) and diff them for the retained object type that's growing. Common culprits: unbounded in-memory caches or `Map`s keyed by user, event listeners added per request and never removed, closures held by a long-lived object, and timers that never get cleared.

**Q6. Streams — why and when?**
Streams let you process data in chunks instead of buffering it all in memory. If you read a 2 GB CSV with `fs.readFile` you spike memory by 2 GB and may OOM; with a read stream piped through a transform to a write stream, memory stays flat. Backpressure is the key concept — `pipe`/`pipeline` handles it for you by pausing the source when the destination is slower. Use `stream.pipeline` over `.pipe()` so errors propagate and resources get cleaned up.

**Q7. `Promise.all` vs `allSettled` vs `race` vs `any`?**
`all` rejects fast on the first failure and gives you all results otherwise — use it when you need every piece. `allSettled` never rejects, gives you status per promise — use it for independent side tasks like sending three notifications where one failing shouldn't kill the rest. `race` settles on the first to finish either way — good for timeouts. `any` resolves on the first *success*.

**Q8. What's wrong with `await` inside a `for` loop?**
It serializes. If you're awaiting ten independent calls at 100ms each, that's a second instead of 100ms — map to promises and `Promise.all` them. But it's correct and intentional when calls depend on each other, or when you need to avoid hammering a downstream service — in that case use a concurrency-limited map (`p-limit`) rather than unbounded `Promise.all`, which can open thousands of connections and take out the database.

**Q9. How do you handle unhandled errors in production Node?**
Catch what you can locally; in NestJS that means an exception filter that maps domain errors to HTTP responses and logs the rest with a correlation ID. For truly uncaught: `process.on('uncaughtException')` and `'unhandledRejection'` should **log and exit**, not swallow — the process is in an unknown state, so let the orchestrator restart it. Graceful shutdown on `SIGTERM`: stop accepting new connections, drain in-flight requests, close DB pools.

**Q10. CommonJS vs ESM — practical differences?**
`require` is synchronous and resolved at runtime, so you can require conditionally; ESM `import` is static and hoisted, which enables tree-shaking and top-level `await`. Mixing them is where the pain is: ESM can import CJS, but CJS can only get ESM through dynamic `import()`. In TypeScript this shows up as `module` and `moduleResolution` config choices, and in `__dirname` not existing under ESM.

---

### 5.2 TypeScript

**Q11. `interface` vs `type`?**
Interfaces are open — you can declare them again and they merge, which is how library augmentation works; they're the default for object shapes. Type aliases can express unions, intersections, tuples, mapped and conditional types. Practical rule: interface for object contracts, type for everything else.

**Q12. What do `unknown`, `any`, and `never` mean?**
`any` opts out of type checking entirely — it's a hole in your type safety. `unknown` is the safe version: you can hold anything but must narrow before use, so it's the right type for parsed JSON or caught errors. `never` is the type with no values — a function that always throws returns `never`, and it's what you get from an exhaustive switch, which is how you make the compiler enforce that you handled every union member.

**Q13. What are generics good for, in real code?**
Preserving the relationship between input and output types. A `Repository<T>` where `findOne` returns `T` instead of `any`, or a `paginate<T>(items: T[]): Page<T>` helper. With `extends` constraints you keep it safe: `function pick<T, K extends keyof T>(obj: T, keys: K[]): Pick<T, K>`.

**Q14. Runtime validation — why isn't TypeScript enough?**
Types are erased at compile time. Anything crossing the boundary — request bodies, env vars, third-party API responses, queue messages — is untyped at runtime. So you validate at the edge with `class-validator` DTOs (NestJS `ValidationPipe`) or a schema library like Zod, and *inside* the app you trust the types.

**Q15. Decorators — how do they actually work in NestJS?**
They're functions that run at class-definition time and attach metadata via `reflect-metadata`. NestJS reads that metadata later — `@Injectable()` marks a class for the DI container, `@Controller('users')` records the route prefix, `@Get()` records the method and path, param decorators record how to extract each argument. That's why `emitDecoratorMetadata` must be on: it's what lets Nest see constructor parameter *types* and resolve dependencies.

---

### 5.3 NestJS

**Q16. Explain dependency injection in NestJS.**
Instead of a class constructing its own dependencies, it declares them in the constructor and the framework supplies them. Nest builds a DI container per module: providers are registered with a token (usually the class itself), and when it instantiates a controller it reads the constructor's parameter metadata and resolves each token. The payoff is testability — in a unit test I swap the real repository for a mock with `overrideProvider` and nothing else changes — plus a single place to control lifecycle.

**Q17. Modules — what does `imports` / `exports` / `providers` actually control?**
`providers` are what this module can inject. `exports` are the subset other modules get when they import this one — everything else stays private. `imports` pulls in another module's exports. `controllers` are the HTTP entry points. This is scoping, not just organization: if you forget to export a service, the importing module gets "Nest can't resolve dependencies".

**Q18. Provider scopes — DEFAULT, REQUEST, TRANSIENT?**
DEFAULT is a singleton for the app's lifetime — use it for almost everything. REQUEST creates a new instance per request, which lets you inject the request object but bubbles up: anything that depends on a request-scoped provider becomes request-scoped too, and you lose the performance of singletons. TRANSIENT gives each consumer its own instance — mainly useful for things like a logger that needs to know its context.

**Q19. Guard vs Interceptor vs Pipe vs Middleware vs Exception Filter — order and purpose?**
Order per request: **middleware → guards → interceptors (before) → pipes → handler → interceptors (after) → exception filters**.
- *Middleware* — Express-level, doesn't know about routes/decorators. Good for raw concerns like request IDs.
- *Guards* — return true/false: authentication and authorization. They can read route metadata (`Reflector`), which is how `@Public()` and role decorators work.
- *Pipes* — transform and validate the incoming arguments; `ValidationPipe` + DTO is the standard.
- *Interceptors* — wrap the handler: response shaping, logging, timing, caching, timeouts. They work on the RxJS stream.
- *Exception filters* — turn thrown errors into responses.

**Q20. How does `ValidationPipe` with `whitelist` and `transform` help?**
`whitelist: true` strips any property not declared in the DTO — that's your defence against mass-assignment, where someone posts `"role": "admin"` to a profile update. `forbidNonWhitelisted` rejects instead of stripping. `transform: true` turns the plain body into an actual DTO class instance and coerces primitives, so `:id` from the URL arrives as a number instead of a string.

**Q21. How do you implement role-based access?**
A custom `@Roles('admin')` decorator that calls `SetMetadata`, plus a `RolesGuard` that uses `Reflector.getAllAndOverride` to read the metadata at both handler and class level, compares it to `request.user.roles` (put there by the auth guard), and returns a boolean. Register the auth guard globally with `APP_GUARD` so everything is protected by default, and use a `@Public()` decorator to opt specific routes out — default-deny is much safer than default-allow.

**Q22. How do you test a NestJS service?**
Unit tests: build a testing module with `Test.createTestingModule`, provide mocks for the repository and any downstream clients, and assert on behaviour — not implementation. E2E: build the full app with `Test.createTestingModule({imports:[AppModule]})`, override external boundaries (payment gateway, mail), and hit it with supertest. For the database I prefer a real Postgres in a container over mocking the ORM, because ORM mocks pass while the actual SQL is broken.

**Q23. Custom decorators — give an example.**
`createParamDecorator((data, ctx) => ctx.switchToHttp().getRequest().user)` gives you `@CurrentUser()`, so controllers don't reach into the raw request. Combined with `SetMetadata` for route-level flags, this keeps controllers clean and declarative.

**Q24. Dynamic modules — `forRoot` vs `forFeature`?**
`forRoot`/`forRootAsync` configures a module once at the app level — DB connection, config, JWT secret; `forRootAsync` lets you inject `ConfigService` so the config comes from env instead of being hardcoded. `forFeature` registers per-module pieces against that root config — like which entities this module's repositories cover.

**Q25. How do microservices talk in NestJS?**
A service bootstraps with `createMicroservice` and a transport (TCP, Redis, NATS, RabbitMQ, Kafka, gRPC). Handlers are `@MessagePattern` for request/response and `@EventPattern` for fire-and-forget. The caller injects a `ClientProxy` and uses `send()` — which returns an Observable you await via `firstValueFrom` and *does* expect a reply — or `emit()` for events with no reply. Keep the pattern names in a shared constants file so both sides can't drift.

**Q26. What's the downside of TCP transport between services?**
It's point-to-point and synchronous: the caller is coupled to the callee being up, there's no buffering, no retry, no fan-out, and you need service discovery to find hosts. It's fine for simple request/response inside a cluster, but for anything that should survive a consumer being down — order placed, email queued — you want a broker (RabbitMQ/Kafka/NATS) so the message is durable and can be retried.

---

### 5.4 Databases & Data Modelling

**Q27. When would you *not* use Postgres?**
When the access pattern genuinely doesn't fit: massive write-heavy time-series or logs (a TSDB or Elasticsearch), huge key-value at scale with simple lookups (DynamoDB/Cassandra), or an ephemeral cache/session store (Redis). For most CRUD products Postgres is the right default — it does JSONB, full-text search, and transactions well enough that "we need Mongo for flexibility" is usually a schema-design problem, not a database problem.

**Q28. How does an index work, and when does it hurt?**
A B-tree index is a sorted structure that lets the planner find rows without scanning the table. It hurts on writes — every insert/update/delete maintains every index — and it takes disk. It's also useless if the query can't use it: leading wildcard `LIKE '%x'`, a function applied to the column without a matching expression index, or low-cardinality columns where a scan is cheaper. On a composite index, order matters — `(a, b)` serves queries filtering on `a` or `a AND b`, but not `b` alone.

**Q29. A query got slow in production. Walk me through it.**
First confirm it's the query and not the app — check whether latency correlates with DB CPU or connection saturation. Then `EXPLAIN ANALYZE` it and look for sequential scans on big tables, a row estimate that's wildly off actual (stale stats — `ANALYZE`), or a nested loop over a large set. Fix in order of cheapness: add or fix the index, remove `SELECT *`, add pagination, then consider denormalizing or caching. Verify with the same `EXPLAIN` afterwards, and check that I didn't just move the cost to writes.

**Q30. What is the N+1 problem?**
You fetch a list of N orders with one query, then loop and fetch each order's user — N more queries. It looks fine on 10 rows in dev and falls over on 10,000 in prod. Fix with a join or `relations`/eager loading in the ORM, or batch the second query with a `WHERE id IN (...)` — DataLoader does this automatically for GraphQL. I'd catch it by logging query counts per request in dev.

**Q31. Explain ACID and isolation levels — practically.**
Atomicity: all or nothing. Consistency: constraints hold. Isolation: concurrent transactions don't corrupt each other. Durability: committed means committed. The one that bites you is isolation — Postgres defaults to READ COMMITTED, which prevents dirty reads but allows non-repeatable reads, so a classic bug is read-check-then-write on inventory: two requests both read stock = 1 and both sell it. The fix is `SELECT ... FOR UPDATE` to lock the row, an atomic conditional `UPDATE ... WHERE stock > 0` and checking rows affected, or bumping to SERIALIZABLE and retrying on conflict.

**Q32. Optimistic vs pessimistic locking?**
Pessimistic locks the row up front (`FOR UPDATE`) — safe, but holds locks and can deadlock under contention. Optimistic adds a version column, and the update says `WHERE version = X`; if it affects zero rows someone else won, so you retry. Optimistic is better when conflicts are rare, pessimistic when they're common and short.

**Q33. How do you do a zero-downtime migration that renames a column?**
Expand–migrate–contract. Add the new column, deploy code that writes to both and reads the old one, backfill in batches, flip reads to the new column, then in a later release stop writing the old one and drop it. Each step is independently deployable and reversible. Also: never take a long `ACCESS EXCLUSIVE` lock on a hot table — add indexes `CONCURRENTLY`, and add `NOT NULL` columns with a default in a version of Postgres where that's not a rewrite.

**Q34. Transactions across two services with separate databases?**
You can't use a database transaction, so you don't try. Either use the Saga pattern — each service does its local transaction and publishes an event, with explicit compensating actions on failure (refund, release inventory) — or accept eventual consistency with an outbox: write the state change and the outgoing event in one local transaction, and a relay publishes from the outbox, which guarantees you never lose the event. Distributed 2PC exists but is fragile and I'd avoid it.

**Q35. Connection pooling — why does it matter in Node?**
Postgres forks a backend process per connection, so connections are expensive and limited (often ~100). Node is single-threaded and async, so a small pool serves high concurrency fine — but with 10 replicas × a pool of 20 you've already got 200 connections and you'll hit `too many clients`. Size the pool by what the DB can take, divided by replica count, and use a pooler like PgBouncer in front for serverless or high-replica setups.

---

### 5.5 Caching, Queues & Redis

**Q36. What do you cache and how do you invalidate it?**
Cache reads that are expensive and tolerate staleness — product catalog, config, computed aggregates. Not user-specific writes-heavy data unless you're careful. Cache-aside is the default: check Redis, miss → hit DB → write back with a TTL. Invalidate on write by deleting the key (delete, don't update — updating races). The TTL is your safety net for anything you forget to invalidate.

**Q37. What's a cache stampede and how do you avoid it?**
A hot key expires and a thousand concurrent requests all miss and hit the DB at once. Mitigations: a short lock so only one request recomputes while others wait or serve stale, jittered TTLs so keys don't expire in lockstep, or refresh-ahead where you rebuild before expiry.

**Q38. Why Redis for refresh tokens / sessions?**
Because you need fast lookups plus **revocation**. A stateless JWT can't be revoked before it expires — that's the whole trade-off. Keeping refresh tokens (or a denylist of jti's) in Redis with a TTL matching token lifetime gives you instant logout and "log out all devices", with automatic cleanup via expiry.

**Q39. Access token vs refresh token — design it.**
Short-lived access token (5–15 min), signed JWT, sent on every request, never stored server-side. Long-lived refresh token (days), opaque or JWT, stored hashed server-side in Redis/DB, sent only to the refresh endpoint, ideally in an httpOnly SameSite cookie. On refresh, rotate: issue a new pair and invalidate the old one; if a used token is presented again, that's reuse detection — revoke the whole family, because it means the token was stolen.

**Q40. When do you introduce a message queue?**
When the work doesn't need to happen inside the request — emails, invoices, image processing, webhooks — or when you need to decouple producer from consumer so a slow/down consumer doesn't fail the request, or to smooth traffic spikes. Cost: eventual consistency, plus you now must handle retries, ordering, and duplicates.

**Q41. What's idempotency and why does a queue force you to think about it?**
Most brokers give at-least-once delivery, so your consumer *will* occasionally see the same message twice — after a timeout, a redelivery, or a crash between processing and acking. Idempotent means processing it twice has the same effect as once. Implement it with a unique key (message id or a client-supplied `Idempotency-Key`) stored in a table with a unique constraint, or by making the operation naturally idempotent (`SET status='paid'` rather than `balance = balance - 10`).

**Q42. What's a dead letter queue?**
Where a message goes after it fails processing N times, so it stops blocking the queue and looping forever. You alert on DLQ depth, inspect the payloads, fix the bug, and replay. Without one, a single poison message can stall a partition or spin retries forever.

---

### 5.6 APIs, HTTP & Security

**Q43. What makes a good REST API?**
Nouns for resources, HTTP verbs for actions, correct status codes (201 with a Location on create, 204 on delete, 400 vs 401 vs 403 vs 404 vs 409 used correctly), consistent error envelope, pagination on every collection, and versioning from day one. Idempotent verbs actually idempotent — `PUT` and `DELETE` must be safe to retry.

**Q44. 401 vs 403? 400 vs 422? PUT vs PATCH?**
401 = I don't know who you are (missing/invalid credentials). 403 = I know who you are and you're not allowed. 400 = malformed request. 422 = well-formed but semantically invalid (fails business validation) — though many APIs just use 400. `PUT` replaces the whole resource and is idempotent; `PATCH` applies a partial change.

**Q45. Offset vs cursor pagination?**
`LIMIT/OFFSET` is simple but gets slower the deeper you go (the DB still walks the skipped rows) and can skip or duplicate items if data changes between pages. Cursor/keyset pagination — `WHERE (created_at, id) < (:cursor)` ordered consistently — is O(1)-ish and stable. Use offset for admin tables where you need page numbers, cursor for feeds and large datasets.

**Q46. How do you secure a Node API? Give me the top items.**
Validate and whitelist all input (DTOs), parameterized queries or an ORM to kill SQL injection, hash passwords with bcrypt/argon2 and a per-user salt, short-lived JWTs with rotation, HTTPS everywhere, `helmet` for headers, an explicit CORS allowlist rather than `*`, rate limiting on auth endpoints, secrets from env/secret manager and never in git, and dependency scanning. Plus: don't leak stack traces or "user not found" vs "wrong password" in responses.

**Q47. How do you prevent one client from hammering you?**
Rate limit per API key/user/IP with a sliding window in Redis so it works across replicas (`@nestjs/throttler` with a Redis store). Return 429 with `Retry-After`. Beyond that, timeouts and circuit breakers on your own outbound calls so a slow dependency doesn't queue up requests until you fall over.

**Q48. How do you debug an issue that only happens in production?**
Correlation IDs threaded through every log and every downstream call, structured JSON logs, metrics (RED: rate, errors, duration) with p95/p99 not averages, and distributed tracing if it crosses services. Then: reproduce from the trace, not from guessing. If I can't observe it, my first fix is adding the observability, not a speculative code change.

---

## 6. SYSTEM DESIGN SCENARIOS (pick one, 8–10 min, verbal)

> **Interviewer:** give the candidate one of these, let them drive, and interrupt with the "probe" questions.

**A. Design a URL shortener.**
Probes: how do you generate short codes without collisions? Read:write ratio and what that implies for caching? How do you handle custom aliases? Analytics without slowing the redirect? What's the redirect status code and why (301 caches forever — usually you want 302)?

**B. Design the checkout flow for an ecommerce site.**
Probes: how do you stop two users buying the last item? Where does the payment call live, and what happens if it times out — did the charge go through? How do you make "place order" safe to retry? What's the order state machine? What's async vs sync?

**C. Design a notification service (email/SMS/push).**
Probes: how do you avoid sending the same email twice? Retries and backoff for a flaky provider? User preferences and quiet hours? How do you handle a provider outage? Templating and localization?

**D. Design a rate limiter used by all your services.**
Probes: fixed window vs sliding window vs token bucket? Where does state live and what if Redis is down — fail open or closed? Per-user vs per-IP vs per-endpoint? How do you communicate limits to clients?

**E. Design file uploads (user avatars / product images).**
Probes: through your API or presigned URLs direct to object storage — why? Virus scanning and file-type validation? Thumbnails — sync or async? How does the DB record stay consistent with the bucket if one write fails?

### What a good mid-level answer looks like
1. **Clarify first** — scale, read/write ratio, who the users are. Don't start drawing.
2. **State the API** — endpoints and the core data model.
3. **Happy path end to end**, then the storage choice with a reason.
4. **Now the failure modes** — what if the dependency is down, what if the request is retried, what's the consistency story.
5. **Then scale** — cache here, queue there, index this.
6. **Name what you'd measure.**

---

## 7. BEHAVIORAL (use STAR: Situation, Task, Action, Result)

Have a *specific, real* story ready for each. One paragraph, 60–90 seconds, ending in a measurable result.

1. Tell me about a production incident you were involved in. What did you do in the first 10 minutes?
2. A time you disagreed with a technical decision. What happened?
3. The hardest bug you've fixed — how did you isolate it?
4. A time you shipped something that broke. What did you change afterwards?
5. How do you handle a code review where you think the reviewer is wrong?
6. Tell me about something you had to learn quickly.
7. A time you pushed back on a deadline or a scope.
8. What's a piece of technical debt you argued to pay down — and did you win?

**Coaching:** end every story with what *changed* because of it — a test added, a runbook written, a process fixed. "And we never had that class of bug again because we added X" is the sentence interviewers remember.

---

## 8. QUESTIONS TO ASK THE INTERVIEWER

- What does the deploy pipeline look like — how long from merge to production?
- How do you handle on-call and incidents?
- What's the test coverage story, honestly?
- What's the biggest piece of tech debt on the team right now?
- What would my first 90 days look like?
- What separates someone who's doing well here from someone who's just okay?

---

## 9. RAPID-FIRE WARM-UP (interviewer: use these as fillers, 10 seconds each)

- Difference between authentication and authorization?
- What does `JOIN` vs `LEFT JOIN` return differently?
- What is CORS actually protecting against?
- What's in a JWT? Is it encrypted?
- What does `bcrypt` do that `sha256` doesn't?
- What's the difference between a `PRIMARY KEY` and a `UNIQUE` constraint?
- What's a race condition? Give an example from an API.
- Why is `SELECT *` a bad habit?
- What does a 502 mean vs a 504?
- What does `docker build` cache, and why does layer order matter?
- What is a health check vs a readiness check?
- What does `git rebase` do that `git merge` doesn't?

---

## 10. SELF-SCORECARD (fill after each mock run)

| Area | Score /5 | What I fumbled | Fix by next run |
|---|---|---|---|
| Node fundamentals | | | |
| TypeScript | | | |
| NestJS depth | | | |
| Databases | | | |
| Caching / queues | | | |
| API & security | | | |
| System design | | | |
| Project storytelling | | | |
| Communication & pacing | | | |
