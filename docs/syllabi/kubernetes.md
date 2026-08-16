# 📚 Learning Roadmap: Kubernetes (Architect-Level, From Zero)

> **Profile:** Goal = architect-level mastery · Start = no prior K8s · Depth = expert (internals, control plane, networking, failure modes) · Timeline = no rush (depth over speed)
> **Build vehicle:** This repo's NestJS ecommerce microservices backend (api-gateway, auth/product/cart services, Postgres, Redis).

**Progress legend:** `- [ ]` not started · `- [/]` in progress · `- [x]` completed
**Total:** 48 concepts across 6 levels · est. ~40–46 sessions (no-rush pace, 1 concept per session is the default rhythm).

---

## Level 1 — Foundations
*Est. 5–6 sessions. The mental model everything else hangs on.*

- [x] **1.1 Containers & why orchestration exists**
  - **Prereq:** None
  - **Why now:** K8s orchestrates containers; you can't reason about it without knowing what it's managing and what pain it removes.
  - **Success signal:** Can explain what a container is vs a VM, and name 4 concrete problems orchestration solves that `docker run` alone doesn't.

- [x] **1.2 The core K8s idea: declarative desired-state reconciliation**
  - **Prereq:** 1.1
  - **Why now:** This single principle ("you declare desired state, controllers make reality match") is THE thing that explains every later behavior.
  - **Success signal:** Can explain the difference between imperative and declarative orchestration, and why reconciliation makes the system self-healing.

- [x] **1.3 Cluster anatomy: control plane vs worker nodes**
  - **Prereq:** 1.2
  - **Why now:** You need the physical/logical map before placing any object on it.
  - **Success signal:** Can draw the cluster: API server, etcd, scheduler, controller-manager, kubelet, kube-proxy, container runtime — and say what each does in one line.

- [x] **1.4 The API server & kubectl as the front door**
  - **Prereq:** 1.3
  - **Why now:** Every interaction (yours and the system's) flows through the API server; understanding it demystifies "how does anything happen."
  - **Success signal:** Can trace what happens end-to-end when you run `kubectl apply -f deployment.yaml`.

- [x] **1.5 Pods — the atom of scheduling**
  - **Prereq:** 1.3, 1.4
  - **Why now:** The smallest deployable unit; every higher object ultimately produces pods.
  - **Success signal:** Can explain why a pod (not a container) is the unit, when multiple containers belong in one pod, and the pod lifecycle phases.

---

## Level 2 — Core Mechanics
*Est. 7–8 sessions. Internal workings that let you predict behavior.*

- [x] **2.1 Controllers & the reconciliation loop (ReplicaSet)**
  - **Prereq:** 1.2, 1.5
  - **Why now:** Makes 1.2 concrete — watch how a controller drives actual→desired.
  - **Success signal:** Can predict what happens when you delete a pod managed by a ReplicaSet, and explain the watch/reconcile loop.

- [x] **2.2 Deployments & rollout mechanics**
  - **Prereq:** 2.1
  - **Why now:** The object you'll use most; it manages ReplicaSets to do versioned rollouts.
  - **Success signal:** Can explain how a Deployment rolls from v1→v2 without downtime and how rollback works.

- [x] **2.3 Labels, selectors & annotations**
  - **Prereq:** 1.5
  - **Why now:** The glue — how every controller and Service finds the pods it owns. Misunderstanding this causes the most beginner bugs.
  - **Success signal:** Can explain how a Service "knows" which pods to route to, and what breaks if labels mismatch.

- [x] **2.4 Services & in-cluster networking (ClusterIP/NodePort/LoadBalancer)**
  - **Prereq:** 2.3, 1.5
  - **Why now:** Pods are ephemeral with changing IPs; Services give stable addressing. Core to any multi-service app.
  - **Success signal:** Can explain how traffic reaches a pod through a ClusterIP, and pick the right Service type per use case.

- [x] **2.5 Cluster DNS & service discovery**
  - **Prereq:** 2.4
  - **Why now:** How your gateway will find auth/product/cart services by name.
  - **Success signal:** Can resolve why `http://auth-service:3001` works inside the cluster and trace the DNS path.

- [x] **2.6 ConfigMaps & Secrets**
  - **Prereq:** 1.5
  - **Why now:** Config and credentials (JWT_SECRET, DB hosts) must come from outside the image; needed before deploying the real app.
  - **Success signal:** Can inject config two ways (env + volume) and explain why Secrets are NOT actually secure by default.

- [x] **2.7 Namespaces & resource organization**
  - **Prereq:** 1.4
  - **Why now:** Logical partitioning for multi-env, multi-team, and scoping RBAC/quotas later.
  - **Success signal:** Can explain what namespaces isolate and what they do NOT isolate (e.g. nodes, cluster-scoped objects).

- [/] **2.8 Scheduling basics: requests, limits & how pods land on nodes**
  - **Prereq:** 1.3, 1.5
  - **Why now:** Explains placement and resource behavior; prereq for QoS, autoscaling, and failure analysis.
  - **Success signal:** Can predict whether a pod gets scheduled given node capacity and pod requests, and explain what limits enforce.

- [ ] **2.9 etcd & how cluster state is stored**
  - **Prereq:** 1.4
  - **Why now:** The single source of truth; understanding it explains consistency, backup, and control-plane failure.
  - **Success signal:** Can explain what lives in etcd, why it uses Raft/quorum, and what happens if it's lost.

---

## Level 3 — Practical Implementation
*Est. 7–8 sessions. Deploy the real ecommerce backend, hit real problems.*

- [ ] **3.1 Deploy the ecommerce backend to a local cluster**
  - **Prereq:** 2.2, 2.4, 2.5, 2.6
  - **Why now:** First end-to-end win — gateway + one service + Postgres + Redis on kind/minikube.
  - **Success signal:** Can curl the gateway through a Service and have it reach a backend microservice.

- [ ] **3.2 Health checks: liveness, readiness & startup probes**
  - **Prereq:** 3.1
  - **Why now:** Without probes, K8s can't self-heal correctly or route safely; critical for the TCP microservices here.
  - **Success signal:** Can choose the right probe per failure scenario and explain a readiness-vs-liveness mistake that causes outages.

- [ ] **3.3 Ingress & HTTP routing**
  - **Prereq:** 3.1
  - **Why now:** Expose the gateway to the outside world properly instead of NodePort hacks.
  - **Success signal:** Can route external traffic to the gateway via an Ingress controller and explain Ingress vs Service.

- [ ] **3.4 Persistent storage: Volumes, PV, PVC, StorageClasses**
  - **Prereq:** 3.1
  - **Why now:** Postgres/Redis need durable state; pods are ephemeral by default.
  - **Success signal:** Can explain the PV/PVC binding dance and why a pod restart keeps DB data.

- [ ] **3.5 StatefulSets for stateful workloads**
  - **Prereq:** 3.4, 2.1
  - **Why now:** Databases need stable identity/storage/ordering — Deployments aren't enough.
  - **Success signal:** Can explain stable network identity + per-pod storage, and when a StatefulSet is required vs overkill.

- [ ] **3.6 Rolling updates, rollbacks & deployment strategies**
  - **Prereq:** 2.2, 3.2
  - **Why now:** Ship new versions of the gateway/services safely; depends on probes being correct. (Advanced progressive delivery — blue/green, canary — comes in Level 4 once a delivery pipeline exists.)
  - **Success signal:** Can perform and reason about RollingUpdate vs Recreate, maxSurge/maxUnavailable, and a clean rollback.

- [ ] **3.7 Jobs & CronJobs**
  - **Prereq:** 1.5
  - **Why now:** Batch/scheduled work (migrations, cleanup) is a real need in this system.
  - **Success signal:** Can model a DB migration as a Job and a nightly task as a CronJob, with correct restart semantics.

- [ ] **3.8 Packaging with Helm**
  - **Prereq:** 3.1–3.6
  - **Why now:** Hand-managing dozens of YAMLs across services/envs doesn't scale; also the unit GitOps and CI/CD will deploy.
  - **Success signal:** Can template the gateway+services into one chart with values per environment.

- [ ] **3.9 Common mistakes & anti-patterns**
  - **Prereq:** 3.1–3.8
  - **Why now:** Consolidate Level 3 by naming the traps before we automate delivery.
  - **Success signal:** Can list 6+ anti-patterns (latest tag, no probes, no limits, secrets in env, etc.) and why each bites.

---

## Level 4 — Delivery, GitOps & Supply-Chain Security
*Est. 8–9 sessions. How software actually gets into the cluster, safely. Build → scan → enforce → declare → progressively deliver.*

- [ ] **4.1 Container image build pipelines (CI)**
  - **Prereq:** 1.1, 3.1
  - **Why now:** GitOps/CD deploy *images*; you must produce good ones first. Multi-stage builds, deterministic tags, build caching for this repo's services.
  - **Success signal:** Can design a CI pipeline that builds, tags (by git SHA), and pushes images for each microservice, and explain why `:latest` is banned.

- [ ] **4.2 Registry management**
  - **Prereq:** 4.1
  - **Why now:** The handoff point between build and cluster; tagging/immutability/retention shape everything downstream.
  - **Success signal:** Can design a tagging + retention strategy, explain image immutability/digests, and configure pull from a private registry (imagePullSecrets).

- [ ] **4.3 Image scanning & supply-chain security (Trivy, SBOM, signing)**
  - **Prereq:** 4.2
  - **Why now:** Vulnerable images are the #1 production attack surface; scan before anything reaches the cluster.
  - **Success signal:** Can wire Trivy into CI to fail on critical CVEs, explain what an SBOM is, and describe image signing/verification (cosign) at a high level.

- [ ] **4.4 The admission pipeline & Pod Security Standards**
  - **Prereq:** 1.4, 2.7
  - **Why now:** The cluster's gatekeeper — where requests are validated/mutated before persistence. PSS replaces the old PodSecurityPolicy.
  - **Success signal:** Can explain validating vs mutating admission webhooks in the API request flow, and apply the privileged/baseline/restricted PSS levels per namespace.

- [ ] **4.5 Policy-as-code: OPA/Gatekeeper & Kyverno**
  - **Prereq:** 4.4, 4.3
  - **Why now:** Enforce org rules automatically (no latest tag, must have limits, only signed/scanned images) — the architect's guardrails.
  - **Success signal:** Can write a policy rejecting non-compliant pods, and articulate Gatekeeper (Rego) vs Kyverno (YAML) tradeoffs.

- [ ] **4.6 GitOps fundamentals & ArgoCD**
  - **Prereq:** 3.8, 4.2, 1.2
  - **Why now:** Extends 1.2's reconciliation idea to delivery — Git is desired state, a controller reconciles the cluster to it.
  - **Success signal:** Can explain pull-based GitOps vs push-based CD, set up ArgoCD to sync this repo's Helm chart, and say why this beats `kubectl apply` from CI.

- [ ] **4.7 GitOps workflow & drift detection**
  - **Prereq:** 4.6
  - **Why now:** The day-to-day operating model and its core safety feature — catching/repairing out-of-band changes.
  - **Success signal:** Can describe the full PR→merge→sync flow, demonstrate ArgoCD detecting drift after a manual `kubectl edit`, and choose auto-sync vs self-heal vs manual.

- [ ] **4.8 Environment promotion (dev → staging → prod)**
  - **Prereq:** 4.7, 2.7
  - **Why now:** Architect-level release management — same artifact promoted across environments without rebuilds.
  - **Success signal:** Can design a repo/branch/overlay structure that promotes one immutable image through environments and explain config-vs-image separation.

- [ ] **4.9 Deployment automation & progressive delivery (Blue/Green, Canary)**
  - **Prereq:** 3.6, 4.6
  - **Why now:** Risk-minimizing rollouts; build on rolling updates + GitOps (Argo Rollouts / Flagger). Traffic shaping deepens with mesh in Level 5.
  - **Success signal:** Can contrast blue/green vs canary, describe automated canary analysis (metrics-driven promotion/rollback), and pick the right strategy for the gateway vs a backend service.

---

## Level 5 — Production & Scaling
*Est. 9–10 sessions. Run it like it matters.*

- [ ] **5.1 Resource management & QoS classes**
  - **Prereq:** 2.8
  - **Why now:** Determines what gets evicted under pressure; foundational for stability and cost.
  - **Success signal:** Can classify a pod as Guaranteed/Burstable/BestEffort and predict eviction order.

- [ ] **5.2 Autoscaling: HPA, VPA, Cluster Autoscaler**
  - **Prereq:** 5.1, 3.2
  - **Why now:** Handle ecommerce traffic spikes; depends on metrics + correct requests.
  - **Success signal:** Can explain what each autoscaler scales, their interactions, and why HPA needs requests set.

- [ ] **5.3 Networking deep dive: CNI, kube-proxy, iptables/IPVS**
  - **Prereq:** 2.4, 2.5
  - **Why now:** Architect-level requires knowing how the packet actually moves, not just "Services work."
  - **Success signal:** Can trace a packet from external client → ingress → service → pod across nodes, naming each hop.

- [ ] **5.4 Network policies & zero-trust segmentation**
  - **Prereq:** 5.3, 2.7
  - **Why now:** Lock down which services can talk to which (gateway→services, services→DB only).
  - **Success signal:** Can write a policy that isolates the DB to only its owning service and explain default-allow vs default-deny.

- [ ] **5.5 RBAC, ServiceAccounts & the auth model**
  - **Prereq:** 2.7, 1.4
  - **Why now:** Control who/what can do what in the cluster; core production security.
  - **Success signal:** Can grant a CI pipeline least-privilege deploy access and explain Role vs ClusterRole bindings.

- [ ] **5.6 Secrets management for real**
  - **Prereq:** 2.6, 5.5
  - **Why now:** Base64 isn't encryption; production needs encryption-at-rest + external secret stores.
  - **Success signal:** Can explain etcd encryption, and integrate an external secrets manager (e.g. External Secrets / Vault) conceptually.

- [ ] **5.7 Observability: metrics, logs, events, kube-state**
  - **Prereq:** 3.2, 5.1
  - **Why now:** You can't operate or debug what you can't see; foundation for autoscaling, canary analysis, and incident response.
  - **Success signal:** Can describe the metrics pipeline (Prometheus/metrics-server), where logs go, and how to read pod Events for a crash.

- [ ] **5.8 Failure modes, self-healing, disruptions & PDBs**
  - **Prereq:** 2.1, 5.1
  - **Why now:** Architect must reason about node loss, evictions, and voluntary disruptions.
  - **Success signal:** Can explain what happens when a node dies, what a PodDisruptionBudget protects, and graceful termination/preStop.

- [ ] **5.9 Backup & disaster recovery**
  - **Prereq:** 2.9, 3.4, 5.8
  - **Why now:** The "everything is gone" plan — etcd is the cluster's brain and PVs hold your data; both need a tested recovery path.
  - **Success signal:** Can define RPO/RTO for this system, design etcd backup/restore + Velero for app/PV state, and walk through rebuilding a cluster from backups.

- [ ] **5.10 Ingress controllers & service mesh (intro)**
  - **Prereq:** 3.3, 5.3
  - **Why now:** Production routing, TLS, retries, mTLS, and the traffic-shaping that powers canary (4.9) and observability between services.
  - **Success signal:** Can explain what a mesh (Istio/Linkerd) adds over plain Services and the sidecar cost/benefit.

---

## Level 6 — Advanced & Edge Cases
*Est. 5–6 sessions. The architect's depth.*

- [ ] **6.1 Control plane internals & HA**
  - **Prereq:** 1.3, 2.9
  - **Why now:** Architect-level: how the brain stays available; stacked vs external etcd, leader election.
  - **Success signal:** Can design an HA control plane and explain failure tolerance with N etcd members.

- [ ] **6.2 The controller pattern, CRDs & Operators**
  - **Prereq:** 2.1, 6.1
  - **Why now:** Extending K8s is the architect superpower; explains how the platform itself (and ArgoCD, cert-manager, etc.) is built.
  - **Success signal:** Can describe how you'd model "ecommerce-tenant" as a CRD + operator and the reconcile loop you'd write.

- [ ] **6.3 Advanced scheduling: affinity, taints/tolerations, topology spread**
  - **Prereq:** 2.8, 5.1
  - **Why now:** Control placement for HA, cost, and hardware constraints at scale.
  - **Success signal:** Can spread replicas across zones, pin workloads to node pools, and explain taint-based isolation.

- [ ] **6.4 Stateful workloads at scale & data-on-K8s tradeoffs**
  - **Prereq:** 3.5, 5.8, 5.9
  - **Why now:** The hardest production question — should the DB even live in K8s?
  - **Success signal:** Can argue both sides of "run Postgres in K8s vs managed RDS" with concrete failure reasoning.

- [ ] **6.5 Tradeoffs vs alternatives & when NOT to use K8s**
  - **Prereq:** All prior levels
  - **Why now:** Architect-defining judgment — K8s is often the wrong tool.
  - **Success signal:** Can compare K8s vs ECS/Nomad/serverless/plain-VMs and name 3 scenarios where K8s is a mistake.

- [ ] **6.6 Architecture impact at scale: multi-cluster, cost, org**
  - **Prereq:** All prior levels
  - **Why now:** Closes the loop — how K8s shapes system and team architecture.
  - **Success signal:** Can reason about multi-cluster vs multi-tenant, cost drivers, and the operational org cost K8s imposes.

---

## 🎯 Integration Challenges (after Level 3, after Level 4, and after Level 5)
Defined live once we reach them — built on this repo's services. Level 4's challenge will wire build → scan → policy → GitOps for the whole backend.

## 🏁 Mastery Test (after Level 6)
5-question architect test: architecture impact · 2 tradeoffs · what breaks at scale · defend a design decision · when NOT to use it.
