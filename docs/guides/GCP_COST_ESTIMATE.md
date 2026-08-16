# GCP Monthly Cost Estimate

Cost breakdown for hosting this platform's databases (and later, its services) on Google Cloud.

**Priced August 2026.** All figures are approximations — `asia-south1` (Mumbai) runs roughly
10–20% above `us-central1`. Confirm your exact configuration in the
[pricing calculator](https://cloud.google.com/products/calculator) before committing.

---

## 1. Chosen setup: ~$11–14/month

One Cloud SQL instance holding all five databases; NestJS services and Redis still running
locally on the dev machine.

| Item | Cost/month |
| --- | --- |
| `db-f1-micro` instance (24/7) | ~$8–10 |
| 10 GB SSD storage | ~$2.20 |
| Automated backups (small DB) | <$1 |
| Egress to laptop (dev traffic) | <$1 |
| Redis (local, unchanged) | $0 |
| **Total** | **~$11–14** |

The instance fee dominates; the data volume is negligible at this scale.

**Easy saving:** `--storage-type=HDD` cuts the $2.20 storage line to about $0.90. For
dev-sized data the performance difference isn't noticeable.

---

## 2. Alternatives that were considered

| Option | Cost/month | Note |
| --- | --- | --- |
| Cloud SQL × 5 instances | **~$50–60** | True database-per-service isolation. Five instance fees, same trivial data volume. |
| Memorystore Redis, 1 GB Basic | **~$36** | At $0.049/GiB-hr — nearly 3× the database bill, for a refresh-token store. |
| Compute Engine VM (whole compose file) | **~$7–25** | `e2-micro` is always-free, but **only in `us-west1`, `us-central1`, `us-east1`** — not Mumbai. |

### Why Redis stays local

$36/month for Memorystore is disproportionate here — auth-service uses Redis only for refresh
tokens. Cheaper routes when it does need hosting:

- Keep it local during development — $0
- A free Upstash / Redis Cloud tier — $0
- Redis on the always-free `e2-micro` VM (US regions only) — $0

---

## 3. When the services move to GCP

| Item | Cost/month |
| --- | --- |
| Cloud Run, 7 services, scale-to-zero | **~$0–5** |
| Artifact Registry (7 images × ~400 MB ≈ 2.8 GB) | ~$0.25 |
| Docker Hub instead of Artifact Registry | $0 (public repos) |

Cloud Run's free tier is 2M requests, 180,000 vCPU-seconds and 360,000 GiB-seconds per month.
A dev-traffic project stays inside it.

> **The trap: `--min-instances=1`.**
> Setting it on all 7 services to avoid cold starts means paying for 7 always-on containers,
> turning a ~$0 bill into one well past the database. Leave it at 0 until something genuinely
> needs warm starts.

---

## 4. Summary

| Scenario | Cost/month |
| --- | --- |
| Today — DB on GCP, services local | **~$12** |
| Everything on GCP, dev-scale traffic | **~$15–20** |
| Had we picked 5 instances + Memorystore | ~$90 |

---

## 5. Keeping it there

### Stop the instance when not working

Kills compute billing; storage (~$2/month) continues.

```bash
gcloud sql instances patch ecommerce-db --activation-policy=NEVER    # stop
gcloud sql instances patch ecommerce-db --activation-policy=ALWAYS   # start
```

### Set a budget alert

```bash
gcloud billing budgets create --billing-account=01E43A-284B9C-9E1520 \
  --display-name="ecommerce-dev" --budget-amount=25USD \
  --threshold-rule=percent=0.5 --threshold-rule=percent=0.9
```

### Free trial credit

New accounts get **$300 valid for 90 days**, which covers all of the above for the trial
period. It expires on time, not on spend — don't plan around it lasting.

### Watch for

- **Shared-core tiers (`db-f1-micro`, `db-g1-small`) carry no SLA** and aren't eligible for
  committed-use discounts. Fine for dev, not for production.
- **Storage auto-increase is one-way.** `--storage-auto-increase` (enabled on this instance)
  grows storage automatically and can never shrink it. A runaway table permanently raises the
  monthly floor.
- **Deleting the instance is the only way to stop storage charges** — stopping it is not
  enough. Take an export first if the data matters.

---

## Sources

- [Cloud SQL pricing](https://cloud.google.com/sql/pricing)
- [Cloud SQL pricing 2026 breakdown](https://www.usage.ai/blogs/gcp/cloud-sql/pricing/)
- [Cloud SQL machine-type costs](https://www.bytebase.com/dbcost/cloudsql-pricing/)
- [Memorystore Redis pricing](https://www.dragonflydb.io/guides/google-cloud-redis-pricing)
- [Artifact Registry pricing](https://cloud.google.com/artifact-registry/pricing)
- [GCP free tier](https://cloud.google.com/free)
