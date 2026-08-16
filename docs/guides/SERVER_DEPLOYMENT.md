# Server Deployment (Hetzner + k3s)

Deploying the platform to the Hetzner VM: images → cluster → firewall → domain → HTTPS.

**The server**

| | |
| --- | --- |
| Host | `ubuntu-4gb-hel1-2` |
| IPv4 | `204.168.254.151` |
| Specs | 2 vCPU, 4 GB RAM, 38 GB disk, **x86_64** |
| OS | Ubuntu 26.04 LTS |
| Kubernetes | k3s v1.36.3 (single node, control-plane) |
| Cost | ~€4.29/month incl. IPv4 |

---

## Which machine runs what

This trips people up constantly. Get it wrong and you see
`The connection to the server localhost:8080 was refused`.

| Command | Where | Notes |
| --- | --- | --- |
| `helm ...` | **Mac only** | not installed on the server |
| `kubectl ...` (Mac) | Mac | needs `export KUBECONFIG=~/.kube/hetzner.yaml` |
| `kubectl ...` (server) | server | works only with `KUBECONFIG` **unset** — k3s auto-detects `/etc/rancher/k3s/k3s.yaml` |
| `ufw ...` | server | |
| `docker build/push` | Mac | |

Switching your Mac's terminal between clusters:

```bash
export KUBECONFIG=~/.kube/hetzner.yaml   # target the server
unset KUBECONFIG                          # back to orbstack
```

---

## 1. Push images (Mac)

**The server is x86_64 and a Mac builds arm64.** An arm64 image fails there with
`exec format error`, so images must be built for `linux/amd64`.

```bash
cd /path/to/ecommerce-platform-backend
docker login
./scripts/push-images.sh          # builds linux/amd64, pushes to docker.io/rohitf116
```

Slow — cross-building under emulation, and auth-service compiles `bcrypt` from source.
Budget 15–30 minutes for the first run.

Verify:

```bash
curl -s "https://hub.docker.com/v2/repositories/rohitf116/cart-service/tags" \
  | grep -o '"name":"[^"]*"'
```

> **Why amd64-only is deliberate.** orbstack holds locally-built arm64 images under the same
> `0.2.0` tag, and `imagePullPolicy: IfNotPresent` means it keeps using those. One tag serves
> both clusters without a slow multi-arch build.

---

## 2. Deploy (Mac)

```bash
export KUBECONFIG=~/.kube/hetzner.yaml
kubectl get nodes                 # expect ubuntu-4gb-hel1-2  Ready

cd k8s/ecommerce
helm upgrade --install ecommerce . -f values.yaml -f values-server.yaml
kubectl get pods -w
```

`values-server.yaml` differs from local in exactly these ways:

- Postgres and Redis run **in-cluster** (StatefulSets + PVCs) instead of on the host
- one Postgres holding all five databases, at `postgres:5432`
- no `host.docker.internal` — that only exists on orbstack
- per-service `dbPort` overrides deleted (`null`), since one instance serves all five

### Do not recreate the secret

`ecommerce-secrets` already exists on the server, and **Postgres was initialized with that
password**. The init only runs on first boot, so replacing the secret leaves the services
using a password the database never had. To rotate it you must also change it inside Postgres
(`ALTER USER postgres WITH PASSWORD ...`) or delete the PVC and start over.

---

## 3. Firewall (server)

```bash
ufw allow 3000/tcp       # gateway via k3s ServiceLB
ufw allow 80/tcp         # Traefik, once you add Ingress
ufw allow 443/tcp
```

If you use Hetzner's Cloud Firewall in the console instead, add the same rules there — and
remember both layers must allow traffic.

## 4. Verify

```bash
curl http://204.168.254.151:3000/api/v1/categories
```

---

## 5. Add a domain

### Test with no purchase

`nip.io` resolves IP-embedded hostnames automatically:

```
http://api.204.168.254.151.nip.io
```

Good enough to get Ingress working before buying anything. Won't get a real TLS certificate.

### Buy and point it

Porkbun or Cloudflare, ~$10/year. Then in the DNS panel:

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| A | `api` | `204.168.254.151` | 300 |
| A | `@` | `204.168.254.151` | 300 |
| A | `*` | `204.168.254.151` | 300 (optional wildcard) |

Verify:

```bash
dig +short api.yourdomain.com     # should print 204.168.254.151
```

Propagation is usually minutes, occasionally up to an hour.

---

## 6. Ingress + HTTPS

Without Ingress the API lives at `http://<ip>:3000`. With it, `https://api.yourdomain.com`.

**Traefik is already running** — k3s bundles it, listening on 80 and 443. No installation, no
cloud load balancer, no monthly fee.

The switch is:

1. Gateway Service → `ClusterIP` (Traefik reaches it internally)
2. An **Ingress** resource mapping the hostname to that Service
3. **cert-manager** + a Let's Encrypt ClusterIssuer for automatic certificates

The chart has no Ingress template yet — that's the next piece of work.

Alternative: if the domain sits on Cloudflare, enabling the proxy (orange cloud) gives TLS at
their edge with no cluster changes. Simpler, but traffic routes through Cloudflare and the
origin still needs protecting.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `connection to server localhost:8080 refused` | `KUBECONFIG` points at a file that doesn't exist. On the server: `unset KUBECONFIG`. |
| `helm: command not found` | You're on the server. Helm runs from the Mac. |
| `exec format error` | arm64 image on the x86_64 server. Rebuild with `--platform linux/amd64`. |
| `ImagePullBackOff` | Tag not on Docker Hub yet, or repo is private. Check the tags URL in step 1. |
| `CreateContainerConfigError` | `ecommerce-secrets` missing a key the Deployment references. |
| `ENOTFOUND <service>` | The Service doesn't exist — DNS resolves via Services, not pods. |
| `password authentication failed` | Secret changed after Postgres was initialized (see step 2). |
| Pods `Running` but nothing works | Check `/health/ready`, not just pod status. |

---

## Cost

| Item | Monthly |
| --- | --- |
| Hetzner CX22 + IPv4 | ~$4.70 |
| Domain | ~$0.85 (~$10/yr) |
| Docker Hub (public repos) | $0 |
| TLS via Let's Encrypt | $0 |
| Ingress via bundled Traefik | $0 |
| **Total** | **~$5.55** |

For comparison: the same workload on GKE with a cloud load balancer was ~$46/month, and the
load balancer alone (~$18) costs more than this entire server.

### Cleanup once this is live

- Delete the Cloud SQL instance — Postgres now runs in-cluster (~$2.25/mo → $0)
- Delete the seven junk `<service>atest` repos in Artifact Registry
