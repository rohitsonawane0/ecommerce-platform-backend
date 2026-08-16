# 📓 Kubernetes Lessons Log

Concise recap of each completed concept from [`kubernetes.md`](./kubernetes.md). One entry per concept, added when the syllabus checkbox flips to `[x]`.

---

## 1.1 — Containers & why orchestration exists
*Completed 2026-06-06 · Level 1 Foundations*

**Key takeaways**
- A **container = a normal host process** that the kernel isolates via **namespaces** (what it can *see*: own PID 1, network, filesystem root) and **cgroups** (what it can *use*: CPU/memory limits).
- **Container vs VM:** a VM virtualizes hardware and runs **its own kernel** (heavy, GBs); a container **shares the host kernel** (light, MBs, ms startup) → weaker isolation tradeoff (kernel exploit escapes).
- A container image = **code + all dependencies + filesystem snapshot + run command** — *everything except the kernel*. (Not "just code.")
- **Orchestration** is needed once you have many containers across many machines. Problems `docker run` ignores:
  1. **Self-healing** — declares desired count; replaces dead containers (replace, don't repair — may land on another node).
  2. **Scheduling/placement** — picks a node with capacity.
  3. **Scaling** — `replicas: 3 → 10`, or autoscale on load.
  4. **Service discovery** — stable virtual IP + DNS name in front of ephemeral, churning pod IPs.
  5. Zero-downtime rollouts + auto-rollback; centralized config/secrets.

**Repo tie-in**
- `docker-compose.yml` already does single-machine orchestration (`restart: on-failure`, `healthcheck`, `networks`). Its ceiling: **can't span machines, can't reschedule when a whole machine dies, no rollouts/autoscaling.** K8s = "compose across a fleet that fixes itself."

**Success signal:** ✅ Passed. Correctly nailed shared-kernel distinction and named 4 orchestration problems. Sharpened: image is "everything except kernel" (not just code); pod IPs *churn* (not manually assigned); self-healing = *replace*, not repair.

---

## 1.2 — Declarative desired-state reconciliation
*Completed 2026-06-06 · Level 1 Foundations*

**Key takeaways**
- **Imperative** = you issue every step (`docker run` ×3); system acts once and forgets *why* — no recorded intent, so nothing self-heals.
- **Declarative** = you assert an end state as a **standing truth** (`replicas: 3`); the cluster is responsible for keeping it true forever. (Thermostat, not driving.)
- **Reconciliation loop** (a controller, running forever): **observe** actual → **compare** to desired → **act** to close the gap.
- **Self-healing falls out for free** — nobody codes "if crashed, restart." Crash, node death, manual delete, scale-up are all just "a gap to close." Actual < desired → create.
- Deleting a pod by hand → it comes **back** (desired unchanged). To truly remove: change the **intent** (lower replicas / delete Deployment), not just reality.
- Recreated pod is **brand-new** (new name + IP) — replace, not repair. → motivates Services (2.4).
- Desired state isn't your YAML file — `kubectl apply` → **API server → stored in etcd**; controller reconciles against etcd's copy. YAML just *expresses* intent.

**Repo tie-in**
- `replicas: 3` for `api-gateway` means the cluster keeps 3 alive across crashes/node loss without you watching.

**Forward hook:** GitOps/ArgoCD (4.6) = this exact loop with **Git** as desired state. Same thermostat, bigger scope.

**Success signal:** ✅ Passed all three incl. bonus. Sharpened: recreated pod is new (name+IP); intent lives in etcd via API server, not the file on disk.

---

## 1.3 — Cluster anatomy: control plane vs worker nodes
*Completed 2026-06-06 · Level 1 Foundations*

**Diagram**

```
┌──────────────────────── CONTROL PLANE (the brain) ────────────────────────┐
│   ┌──────────────┐   ┌────────┐   ┌────────────┐   ┌────────────────────┐ │
│   │  API SERVER  │◄─►│  etcd  │   │ SCHEDULER  │   │ CONTROLLER-MANAGER  │ │
│   │ (front door) │   │(memory)│   │(placement) │   │ (the reconcilers)   │ │
│   └──────▲───────┘   └────────┘   └────────────┘   └────────────────────┘ │
│          │  everything talks ONLY through the API server                   │
└──────────┼─────────────────────────────────────────────────────────────-─┘
           │  (API server ↔ each node's kubelet, watch-based)
   ┌───────┼────────────────────┐   ┌────────────────────────────┐
   │       ▼   WORKER NODE 1     │   │        WORKER NODE 2        │
   │  ┌──────────┐  ┌──────────┐ │   │  ┌──────────┐  ┌──────────┐ │
   │  │ kubelet  │  │kube-proxy│ │   │  │ kubelet  │  │kube-proxy│ │
   │  └────┬─────┘  └──────────┘ │   │  └────┬─────┘  └──────────┘ │
   │  ┌────▼──────────────────┐  │   │  ┌────▼──────────────────┐  │
   │  │  Container Runtime     │  │   │  │  Container Runtime     │  │
   │  │  ┌─────┐  ┌─────┐ ...  │  │   │  │  ┌─────┐  ┌─────┐ ...  │  │
   │  │  │ pod │  │ pod │      │  │   │  │  │ pod │  │ pod │      │  │
   │  │  └─────┘  └─────┘      │  │   │  │  └─────┘  └─────┘      │  │
   │  └───────────────────────┘  │   │  └───────────────────────┘  │
   └─────────────────────────────┘   └─────────────────────────────┘
```

**Key takeaways**
- Cluster = **nodes** (Linux boxes), split into **control plane (brain, decides)** + **worker nodes (muscle, run your app)**.
- **Control plane:**
  - **API server** — the front door; the *only* component anyone talks to and the *only* etcd client. Hub of the wheel.
  - **etcd** — distributed key-value store holding **all** cluster state (desired + status). Lose it unbacked-up = brain wiped.
  - **scheduler** — picks *which node* an unassigned pod runs on (capacity + rules); only *decides*, doesn't start it.
  - **controller-manager** — runs the reconcile loops from 1.2 (ReplicaSet, Deployment, node controllers…).
- **Worker nodes:**
  - **kubelet** — node foreman: watches API server for "pods assigned to me," tells runtime to start them, reports real status back.
  - **kube-proxy** — programs node networking so a **Service's stable IP/DNS routes to a live pod** (not all networking — pod-to-pod CNI is separate, see 5.3).
  - **container runtime** (containerd/CRI-O) — actually runs containers: pulls image, sets up namespaces+cgroups, starts process.
- **Two architect truths:** (a) **hub-and-spoke** — nothing talks peer-to-peer; all read/write the API server. (b) **control plane decides, workers do** — decoupled, so a dead worker's pods get rescheduled.
- **Everything is watch-based (pull), not push** — the API server never calls out; components subscribe and react.

**Full motion:** declare `replicas: 3` → API server validates → writes etcd → scheduler picks nodes → controller-manager keeps count at 3 → kubelet (watching) tells runtime to start pods → kube-proxy wires traffic. Every arrow goes through the API server.

**Success signal:** ✅ Passed all three incl. bonus flow. Sharpened: kube-proxy = *Service* routing specifically; kubelet *watches* the API server (pull), it isn't pushed to.

---

## 1.4 — The API server & kubectl as the front door
*Completed 2026-06-06 · Level 1 Foundations*

**Diagram — full trace of `kubectl apply -f deployment.yaml`**

```
   YOU ─ kubectl apply (replicas: 3)
    ▼
┌─────────────────────── API SERVER (does ONLY these 6) ───────────────────┐
│  ① AUTHENTICATION  "who are you?"  (cert/token from kubeconfig)            │
│  ② AUTHORIZATION   "allowed to create Deployments?" (RBAC)                 │
│  ③ ADMISSION       mutate/validate (defaults, policy)                      │
│  ④ VALIDATION      valid schema?                                           │
│  ⑤ WRITE TO etcd  ──►  [ etcd: Deployment replicas:3 ]                     │
│  ⑥ ACK  "deployment created"   ← returns HERE (intent stored, nothing run)│
└──────────────────────────────┬───────────────────────────────────────────┘
                               │  (watchers wake up — async, pull-based)
   ⑦ Deployment controller → creates ReplicaSet
   ⑧ ReplicaSet controller → creates 3 Pod objects (UNSCHEDULED, no nodeName)
   ⑨ Scheduler (watches unscheduled pods) → assigns node → writes back
   ⑩ Kubelet on node (watches its pods) → tells runtime to pull+start
   ⑪ Kubelet reports status Running → API server → etcd
   ⑫ kube-proxy wires Service routing to new pods
```

**Key takeaways**
- The API server is just a **REST API over HTTP(S)**; every object is a resource with a URL + verbs (GET/POST/PATCH/DELETE/WATCH). **`kubectl` is just an authenticated HTTP client** reading `~/.kube/config`. Mental model: *K8s = a database (etcd) with a REST API and a swarm of programs watching it.*
- `apply` = **declarative** (diff to match file); `create` = imperative (fail if exists). Use `apply`.
- **The API server does only 6 things — none is "start a container":** authn → authz → admission → validation → write etcd → ack. It returns success the instant **intent is stored**, not when pods run → this is why `apply` is instant and why a pod can be "created" but `Pending`.
- **Object chain:** Deployment → **ReplicaSet** → Pods (three layers — this is what makes rollbacks work, see 2.2).
- A pod is a **real object in etcd before it has a node** (`nodeName` empty = unscheduled limbo); that's what the scheduler watches for.
- **Everything after step ⑥ is async, watch-driven choreography** — independent control loops reacting to a shared DB, no direct calls between them.
- **Level-triggered, not edge-triggered:** controllers react to "current ≠ desired," not to one-time events → survives component restarts (a controller that was down catches up by reading current state).

**Architect lens:** because all traffic funnels through the API server, it's the home of cross-cutting control — **authn/authz (RBAC, 5.5)**, **admission control (policy guardrails, 4.4/4.5)**, audit, and the single scaling/failure bottleneck (→ HA control plane, 6.1). Steps ①②③ are a request pipeline *inside* the API server = spine of Levels 4 & 5.

**Success signal:** ✅ Passed all three; #3 (watch-based + level-triggered) was spot-on. Sharpened: Deployment→ReplicaSet→Pods (controller doesn't make pods directly); pods exist as unscheduled objects before placement.

---

## 1.5 — Pods: the atom of scheduling
*Completed 2026-06-06 · Level 1 Foundations · 🎉 completes Level 1*

**Diagram**

```
┌──────────────── POD ────────────────┐
│  shared IP: 10.1.3.7                  │
│  ┌──────────────┐  ┌──────────────┐  │
│  │ container A   │  │ container B   │  │
│  │ (app:8080)    │  │ (sidecar)     │  │
│  └──────────────┘  └──────────────┘  │
│     ▲  talk via localhost:8080  ▲     │
│     └────────── shared volume ──┘     │
└──────────────────────────────────────┘
        scheduled together, live & die together

Lifecycle:  Pending ──► Running ──► Succeeded
                │           └─────► Failed
                │           Unknown (node unreachable)
            (in etcd, not
             yet running)
```

**Key takeaways**
- **Pod = 1+ containers that share a network namespace (one IP, talk via `localhost`) and storage volumes, scheduled together onto one node as a single unit.** Like a tiny logical host.
- Containers in the same pod = "processes on one machine" (localhost + shared disk); containers in different pods = "different machines" (must use Service IP/DNS).
- **Why the pod, not the container, is the atom:** K8s needs one indivisible unit for scheduling/IP/lifecycle, and the pod lets tight-coupling be *expressible*. **Default = one app container per pod**; multi-container is the exception.
- **When multiple containers belong together** (true helpers sharing exact lifecycle/net/disk): **sidecar** (log-shipper), **adapter** (metrics reformat), **ambassador** (local outbound proxy), **init container** (runs to completion before app starts — e.g. wait-for-Postgres / migration).
- **Litmus test:** same pod only if you'd scale & kill them as one unit. Want 3 of A and 5 of B → separate pods. **gateway + auth-service → always separate pods** (scale independently). Anti-pattern: bundling independent services in one pod (revisited in 3.9).
- **Lifecycle phases:** **Pending** (accepted/in etcd, not yet running — scheduling or image pull; = the `apply`-returns-instantly state from 1.4) → **Running** → **Succeeded** (exited 0, Jobs) / **Failed** / **Unknown** (node unreachable).
- **Pods are mortal & never resurrected** — disposable, immutable; a dead pod (or dead node) is replaced by a brand-new pod (new name + IP), not repaired. This is *why*: use **Deployments** (something replaces them), **Services** (stable address over churning IPs), **Volumes/PVs** (data outlives the pod) → the bridge into Level 2+.

**Success signal:** ⏭️ Skipped at user's request (strong demonstrated mastery across 1.1–1.4). Concept marked complete.

---

## ✅ Level 1 — Foundations: COMPLETE (5/5)
1.1 containers/orchestration · 1.2 declarative reconciliation · 1.3 cluster anatomy · 1.4 API server/kubectl · 1.5 pods.
**Next:** Level 2 — Core Mechanics, starting 2.1 (Controllers & the reconciliation loop / ReplicaSet).

---

## 2.1 — Controllers & the reconciliation loop (ReplicaSet)
*Completed 2026-06-07 · Level 2 Core Mechanics*

**Diagram**

```
   ┌──────── API SERVER ────────┐
   │   pods (app=auth-service)   │
   └──────┬──────────────▲──────┘
   watch  │ stream       │ create/delete pods (act)
   events │ (fast path)  │
          ▼              │
   ┌─────────────────────────────┐
   │   ReplicaSet controller      │
   │   count matching pods        │ ◄── also: periodic RESYNC
   │   compare to replicas        │     (full re-list, safety net)
   │   create/delete the diff     │
   └─────────────────────────────┘
```

**Key takeaways**
- A **controller** = an infinite loop: read desired → read actual → compute diff → act to close it. The **controller-manager** runs dozens (one per resource type).
- A **ReplicaSet**'s one job: keep exactly **N replicas** of a pod running. Spec = `replicas` (desired count) + `selector` (which pods are "mine", by label) + `template` (pod blueprint to stamp out).
- **CRUX — it counts by label selector, not by identity.** Every reconcile it asks "how many running pods match my selector?" and compares to `replicas`. It keeps **no list of pods it created**.
  - Delete/crash a pod → count drops → stamps a new one (new name+IP).
  - Manually add a pod with the matching label → count too high → **RS deletes one**.
  - Relabel a live pod off the selector → RS thinks it vanished → makes a replacement; the relabeled pod keeps running **orphaned/unmanaged** (this is how you pull a pod out for live debugging).
- **Watch + resync = fast AND reliable:**
  - **Watch** = API server *streams* changes → controller reacts in ms (why self-healing feels instant). It's a *trigger to go check*, not an instruction.
  - **Resync** = periodic full re-list (every few min) → catches anything a dropped/missed watch event lost.
- **Level-triggered, not edge-triggered** (made concrete): controller acts on **current state (the gap)**, not on the **event/history**. So it can crash, miss 100 events, restart hours later, and still converge. *The single most important robustness property in K8s.*
- **You rarely write a ReplicaSet directly** — chain is **Deployment → ReplicaSet → Pods**. RS is *where pod-count reconciliation happens*; Deployment (2.2) sits on top managing *which* RS is active for rollouts/rollbacks.

**Success signal:** ⏭️ Skipped at user's request. Concept marked complete.

---

## 2.2 — Deployments & rollout mechanics
*Completed 2026-06-07 · Level 2 Core Mechanics*

**Diagram**

```
        Deployment: auth-service
                 │
      ┌──────────┴──────────┐
      ▼                     ▼
  ReplicaSet v1         ReplicaSet v2
  image 1.0             image 2.0
  replicas: 0           replicas: 3   ◄── active
  (kept for rollback)        │
                       [P][P][P]

Rolling update (maxSurge:1, maxUnavailable:0):
  v1[P P P] v2[ ]              start (3)
  v1[P P P] v2[P]   +1, wait until READY (4)
  v1[P P ]  v2[P]   -1 (3)
  v1[P P ]  v2[P P] +1 (4)
  v1[P ]    v2[P P] -1 (3)
  v1[P ]    v2[P P P] +1 (4)
  v1[ ]     v2[P P P] -1 ✅ done (3)
  → never below full capacity of READY pods = no downtime
```

**Key takeaways**
- **A Deployment manages ReplicaSets, not pods.** Each **ReplicaSet = one version**. Chain: Deployment → ReplicaSet → Pods.
- **Rollout = gradually shift replicas from old RS → new RS.** New version ramps **up before** old ramps down; traffic only goes to **Ready** pods → zero downtime. Old RS kept at `replicas:0` for instant rollback.
- **Two knobs (shape of the dance):**
  - **`maxSurge`** = how many *extra* pods above desired allowed (higher = faster, more resources).
  - **`maxUnavailable`** = how many *below* desired allowed (`0` = never lose capacity).
  - Prod-safe: `maxSurge:1, maxUnavailable:0` (add-then-remove). Defaults: `25%`/`25%`.
- **Strategies:**
  - **RollingUpdate** (default) — gradual, zero downtime, but **v1 & v2 run simultaneously** (app + DB must tolerate both — matters for schema changes).
  - **Recreate** — kill all v1, then start v2. **Downtime**, but only one version ever runs. Use when versions can't coexist (incompatible migration, singleton).
- **Rollback is instant** because old RS still exists (scaled to 0) — `kubectl rollout undo` just re-activates it; it's *not* a redeploy. Each revision = one kept RS (`revisionHistoryLimit`, default 10).
- Commands: `rollout status` / `rollout history` / `rollout undo [--to-revision=N]`.
- **Depends on readiness probes (3.2)** to know when a new pod can take traffic — without them K8s thinks a pod is ready the instant the container starts → broken-but-"healthy" rollout.

**Forward hook:** blue/green & canary (4.9) go further — shift *traffic* (via Service/mesh), not just pod counts.

**Success signal:** ⏭️ Skipped at user's request. Concept marked complete.

---

## 2.3 — Labels, selectors & annotations
*Completed 2026-06-07 · Level 2 Core Mechanics*

**Diagram**

```
   Service: auth-service     selector: app=auth-service
        │  (controller keeps an Endpoints/EndpointSlice
        │   list of matching pod IPs, fresh via watch;
        │   kube-proxy programs routing from it)
        ▼
   ┌─────────┐  ┌─────────┐  ┌─────────┐
   │  pod    │  │  pod    │  │  pod    │  each labeled app=auth-service
   │ 10.1.1  │  │ 10.1.2  │  │ 10.1.3  │
   └─────────┘  └─────────┘  └─────────┘

   Mental model:  labels = columns,  selector = WHERE clause
```

**Key takeaways**
- **Labels** = queryable, indexed key/value tags on metadata (`app: auth-service`). For *machines* — controllers/Services select by them.
- **Selectors** = a query over labels (`WHERE` clause). `matchLabels` (equality, implicit AND) or `matchExpressions` (set-based: In/NotIn/Exists).
- **Nearly everything couples by label-match, not by name/ID.** This is THE universal coupling mechanism.
- **How a Service "knows" its pods:** it has a **selector**, not a pod list. A controller watches matching pods and maintains an **Endpoints/EndpointSlice** object (live list of their IPs); `kube-proxy` reads it and programs routing. Pod IPs churn, but the **selector is stable** → stable addressing over mortal pods (solves the 1.5 problem).
- **Label mismatch = #1 silent bug** (no error, just nothing works):
  - Service selector ≠ pod labels → **zero endpoints**, requests hang/refuse.
  - Deployment `selector` ≠ its `template.labels` → won't create pods.
  - Two workloads sharing labels → tug-of-war over each other's pods. **Selectors must be unique per workload.**
  - Relabel a pod off the selector → silently drops out of traffic (still running).
- **Debug move:** `kubectl get endpoints <svc>` → **empty = label mismatch 95% of the time.**
- **Annotations** = key/value metadata too, but the *opposite* purpose: **non-identifying, NOT queryable**, can be large/arbitrary. For tools/humans/config (Ingress rules, `prometheus.io/scrape`, `change-cause`).
  - **Rule:** need to *find* the object → **label**. Just *attaching info/config* → **annotation**.

**Success signal:** ⏭️ Skipped at user's request. Concept marked complete.

---

## 2.4 — Services & in-cluster networking (ClusterIP/NodePort/LoadBalancer)
*Completed 2026-06-07 · Level 2 Core Mechanics*

**Diagram — packet through a ClusterIP**

```
  caller (gateway) → "auth-service" → DNS → ClusterIP 10.96.0.10:3001
      ▼
  ┌─── node kernel (iptables/IPVS rules from kube-proxy) ───┐
  │  dest 10.96.0.10:3001 ? → DNAT to a random READY pod:   │
  │     10.1.1.2  │  10.1.1.7  │  10.1.3.4  (Endpoints)     │
  └───────────────┬─────────────────────────────────────────┘
                  ▼ rewritten & forwarded (maybe to another node)
            auth-service pod 10.1.1.7:3001

  Types layer up:  LoadBalancer ⊃ NodePort ⊃ ClusterIP

  Repo architecture:
  Internet → [LB/Ingress] → api-gateway → auth/product/cart → Postgres/Redis
                (only public)            (all ClusterIP, internal-only)
```

**Key takeaways**
- **Service = stable virtual IP + DNS name in front of mortal, churning pods.** Never hardcode a pod IP.
- **A ClusterIP is a "fictional" IP** — not on any NIC/pod/machine; it exists only as **kernel routing rules**. Nothing listens on it.
- **kube-proxy** programs every node's iptables/IPVS: packet to ClusterIP → **DNAT** to a random **Ready** pod from the **Endpoints** list (2.3), forwarded even across nodes.
  - A Service is **not a process/proxy box** → no bottleneck, nothing to "fail"; just packet rewriting replicated on every node.
  - **Load balancing is built in**; works from any node (all have the same rules).
- **Three types (layered, not alternatives):**
  - **ClusterIP** (default) — internal only. **service↔service** (auth/product/cart, Postgres, Redis).
  - **NodePort** — + static port 30000–32767 on **every node IP**. Dev/test, bare-metal. The "NodePort hack" Ingress replaces (3.3).
  - **LoadBalancer** — + cloud-provisioned external LB w/ public IP. Public entrypoint in cloud. One-per-service gets costly → Ingress (3.3) fixes it.
  - **Headless** (`clusterIP: None`) — no VIP/LB; DNS returns individual pod IPs. For addressing *specific* pods → StatefulSets/DBs (3.5).
- **Production principle:** expose exactly **one** thing (gateway via LB/Ingress); **everything else ClusterIP** (internal-only) → foundation for network security (→ 5.4 NetworkPolicies).

**Success signal:** ⏭️ Skipped at user's request. Concept marked complete.

---

## 2.5 — Cluster DNS & service discovery
*Completed 2026-06-07 · Level 2 Core Mechanics*

**Diagram — why `http://auth-service:3001` works**

```
  gateway: fetch("http://auth-service:3001/validate")
   ① OS resolves "auth-service" via /etc/resolv.conf → CoreDNS (10.96.0.10)
        (search domains expand → auth-service.<ns>.svc.cluster.local)
   ② CoreDNS (watches API server) → "auth-service = ClusterIP 10.96.0.12"
   ③ gateway connects to 10.96.0.12:3001
   ④ kube-proxy DNAT → random Ready pod from Endpoints   (this is 2.4)
   ⑤ arrives at auth-pod 10.1.1.7:3001

  Two layers of indirection over mortal pods:
     DNS:        name      → ClusterIP   (2.5)
     kube-proxy: ClusterIP → pod IP      (2.4)

  Name scheme: <service>.<namespace>.svc.cluster.local
     same ns  → auth-service                ✅
     cross ns → auth-service.<namespace>    ✅ (must qualify)
     anywhere → ...svc.cluster.local (FQDN) ✅
```

**Key takeaways**
- ClusterIP is stable once created but **assigned dynamically** → can't hardcode it; reach Services **by name** → service discovery via plain **DNS**.
- **CoreDNS** = the cluster DNS server (runs as pods in `kube-system`, fronted by ClusterIP `kube-dns`, conventionally 10.96.0.10). **Watches the API server** for Services/Endpoints to answer queries.
- Every pod is **auto-configured** to use CoreDNS: kubelet writes `/etc/resolv.conf` with `nameserver`, `search` domains, `ndots:5`. No setup needed.
- **DNS resolves name → ClusterIP** (not pod IPs for normal Services); load balancing stays at kube-proxy. **Exception: Headless** Service → DNS returns individual pod IPs (StatefulSets, 3.5).
- **Namespace is part of the DNS name** → same-namespace calls use the short name; **cross-namespace must qualify** (`auth-service.<ns>`). Concrete reason namespaces matter (→ 2.7).
- **Architect gotchas:** `ndots:5` makes external names (e.g. `api.stripe.com`) try search domains first → extra failed lookups/latency (use trailing dot `api.stripe.com.`). **CoreDNS is a single point of discovery** — down/overwhelmed = cluster-wide name failures despite healthy pods (monitor it, 5.7).

**Success signal:** ⏭️ Skipped at user's request. Concept marked complete.

---

## 2.6 — ConfigMaps & Secrets
*Completed 2026-06-07 · Level 2 Core Mechanics*

**Diagram**

```
  ConfigMap auth-config:  DB_HOST, DB_PORT, LOG_LEVEL, NODE_ENV   (non-sensitive)
  Secret    auth-secret:  JWT_SECRET, DB_PASSWORD, REDIS_PASSWORD (sensitive)
        │
        ▼  two injection methods:
   ① env vars  →  envFrom / configMapKeyRef / secretKeyRef   (set at START, no live update)
   ② volume    →  mountPath; each key = a file              (auto-updates, app must re-read)
        │
        ▼  (NestJS reads process.env → env-var method, no code change)
   auth-service pod
```

**Key takeaways**
- **Principle (12-factor):** build image **once**, configure per environment **at runtime**. Config never in the image. Identical image dev→staging→prod; only ConfigMap/Secret differ.
- **ConfigMap** = non-sensitive key/value bag in etcd. **Secret** = same mechanics, for sensitive data.
- **Two injection methods:**
  - **Env vars** (`envFrom`/`configMapKeyRef`/`secretKeyRef`) — best for NestJS (`process.env`, zero code change). **Set at container start; ConfigMap change does NOT update a running pod** → must `kubectl rollout restart`.
  - **Volume mount** — each key becomes a file; **auto-updates** (with delay) when the ConfigMap changes, but the app must re-read the file.
- **Secrets are NOT secure by default:** `data` is **base64-encoded, not encrypted** (`base64 -d` reverses instantly). By default stored **plaintext in etcd**; readable via `kubectl get secret -o yaml` (RBAC-permitting).
- **What a Secret *does* give:** separate object type → RBAC separately; mounted as **tmpfs (RAM)**, not disk; values hidden in some outputs; integration point for real secret mgmt.
- **Real security = layers on top:** **etcd encryption at rest (5.6)** + **RBAC (5.5)** + **external store** (Vault / AWS SM / External Secrets, 5.6).
- **Anti-patterns (3.9):** secrets in ConfigMaps, hardcoded in image/manifest env, or committing Secret YAML to Git (base64 = plaintext). For GitOps use **Sealed Secrets / SOPS / External Secrets**.
- **Repo:** `JWT_SECRET` (currently falls back to `'jwt-secret'`) → Secret; `DB_HOST`/ports → ConfigMap.

**Success signal:** ⏭️ Skipped at user's request. Concept marked complete.

---

## 2.7 — Namespaces & resource organization
*Completed 2026-06-07 · Level 2 Core Mechanics*

**Diagram — namespaced vs cluster-scoped**

```
  NAMESPACED (inside a namespace)        CLUSTER-SCOPED (no namespace)
  ──────────────────────────────         ─────────────────────────────
  Pods, Deployments, ReplicaSets         Nodes
  Services, Endpoints, Ingress           PersistentVolumes (PV)
  ConfigMaps, Secrets, PVCs              StorageClasses
  ServiceAccounts, Roles, RoleBindings   ClusterRoles, ClusterRoleBindings
  ResourceQuotas, NetworkPolicies        Namespaces themselves, PriorityClasses

  test: kubectl api-resources --namespaced=false
  storage split: PVC namespaced  •  PV cluster-scoped  (→ 3.4)
```

**Key takeaways**
- **Namespace = virtual sub-cluster** scoping object *names* + a handle to attach policy. Like folders / DB schemas. Same name reusable across namespaces.
- Built-ins: `default` (avoid in prod), `kube-system`, `kube-public`, `kube-node-lease`.
- **What they DO give (4):** ① name scoping (= 2.5 DNS: `svc.<ns>.svc.cluster.local`) ② RBAC target (team→one namespace) ③ ResourceQuota/LimitRange target (cap CPU/mem/objects) ④ NetworkPolicy target.
- **What they DON'T isolate (architect-critical):**
  - **Nodes** — pods from different namespaces share the same physical nodes/kernel.
  - **Network traffic** — **by default any pod can reach any pod across all namespaces**; namespaces block nothing on the network without a NetworkPolicy (5.4).
  - **Cluster-scoped objects** — Nodes, PVs, StorageClasses, ClusterRoles, Namespaces aren't in any namespace.
  - **Kernel / strong tenancy** — container escape not stopped; hard multi-tenancy needs separate clusters or VM sandboxing (gVisor/Kata).
- **Mental model:** a namespace is a **policy/organizational boundary, NOT a firewall/VM/node-pool.** "prod in its own namespace = isolated" is **false** until you add NetworkPolicies + RBAC + quotas.
- Cross-namespace refs need qualification; a Deployment can only mount ConfigMaps/Secrets from **its own** namespace → why config is replicated per env (4.8).

**Success signal:** ⏭️ Skipped at user's request. Concept marked complete.

---
