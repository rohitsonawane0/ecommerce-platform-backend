# Keycloak + Kong API Gateway — Implementation Guide

This guide shows how to put **Keycloak** (identity provider, OIDC) in front of your services and use **Kong Gateway** to enforce authentication at the edge, replacing the custom `auth-service` JWT logic.

> Read `KONG_API_GATEWAY_GUIDE.md` first — this guide assumes Kong is already running per Option A (Kong → NestJS gateway → TCP microservices). The same patterns apply to Option B.

---

## 1. What You're Replacing

Your current auth stack (`apps/auth-service`):

- **Local user table** (`User` entity, bcrypt passwords) in `auth_db` (Postgres :5433)
- **HS256** access & refresh tokens signed with `JWT_SECRET` / `JWT_REFRESH_SECRET`
- **Custom flows**: register, login, refresh, logout, forgot/reset password, `me`, `validateToken`
- **Refresh token blacklist** in Redis
- **`AccessTokenGuard`** in `libs/common` re-verifies the HS256 token on every request

After this migration:

- **Keycloak** owns: user storage, login UI, password reset email, MFA, social login, refresh tokens, sessions, token signing (RS256, JWKS).
- **Kong** validates the JWT at the edge using Keycloak's public keys.
- **`AccessTokenGuard`** stops verifying — it just reads the verified claims that Kong forwards as headers (or trusts the upstream JWT).
- **`auth-service`** shrinks to a thin **user-profile sync** service (or disappears entirely if the `user-service` takes over).

```
                       ┌──────────────┐
   Browser/SPA ────────│  Keycloak    │ ◄── login UI, OIDC discovery, JWKS
       │               │  (:8080)     │
       │ JWT (RS256)   └──────────────┘
       ▼
   ┌──────────┐    JWT verified via JWKS    ┌──────────────────┐
   │   Kong   │ ──────────────────────────► │  NestJS gateway  │
   │  (:8000) │                              │     (:3000)      │
   └──────────┘                              └──────────────────┘
                                                     │  TCP
                                                     ▼
                                              microservices
```

---

## 2. Architectural Choices — Decide First

### A. **Full Keycloak takeover (recommended)**

Delete password storage and JWT logic from `auth-service`. Keycloak is the **only** identity provider. The `user-service` keeps an application-side `User` row keyed by Keycloak's `sub` claim for app-specific data (addresses, preferences, role-in-org, etc.). Sync happens on first login via a "just-in-time" provisioning interceptor, or via Keycloak Event Listener SPI.

- **Pros**: One IdP, SSO-ready, MFA, social login, admin console for free, security maintained by Keycloak.
- **Cons**: Migration of existing users (export → bulk import into Keycloak). Need to rewrite the FE login form to redirect to Keycloak (or use Direct Access Grants if you want to keep your own form).

### B. **Hybrid (auth-service stays for legacy, Keycloak for new clients)**

Useful only if you have existing mobile clients you can't update. Both stacks issue JWTs; Kong validates either. Adds complexity — avoid unless forced.

### C. **Keycloak only as a federated IdP behind your existing auth-service**

`auth-service` calls Keycloak via OIDC for social/SSO and issues its own JWT. Keeps your current code intact. Kong continues validating HS256 tokens. Doesn't really benefit from Keycloak's strengths.

> **Recommendation**: pick **A**. The rest of this guide implements A.

---

## 3. Prerequisites

- Kong running per `KONG_API_GATEWAY_GUIDE.md` §3–§5
- Docker + Docker Compose
- A throwaway browser session for the Keycloak admin console
- (Optional) `jq`, `curl`, `httpie`

---

## 4. Add Keycloak to `docker-compose.yaml`

Append to `docker-compose.yaml`:

```yaml
  postgres-keycloak:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: keycloak_db
      POSTGRES_USER: keycloak
      POSTGRES_PASSWORD: keycloak
    ports:
      - '5440:5432'
    volumes:
      - keycloak-pg-data:/var/lib/postgresql/data

  keycloak:
    image: quay.io/keycloak/keycloak:25.0
    container_name: keycloak
    command: ['start-dev']             # use 'start' (no -dev) in prod
    environment:
      KC_DB: postgres
      KC_DB_URL: jdbc:postgresql://postgres-keycloak:5432/keycloak_db
      KC_DB_USERNAME: keycloak
      KC_DB_PASSWORD: keycloak
      KEYCLOAK_ADMIN: admin
      KEYCLOAK_ADMIN_PASSWORD: admin
      KC_HOSTNAME: localhost
      KC_HTTP_ENABLED: 'true'
      KC_HEALTH_ENABLED: 'true'
      KC_METRICS_ENABLED: 'true'
    ports:
      - '8080:8080'                    # Keycloak HTTP
    depends_on:
      - postgres-keycloak
    extra_hosts:
      - 'host.docker.internal:host-gateway'

volumes:
  keycloak-pg-data:
```

Bring it up:

```bash
docker compose up -d postgres-keycloak keycloak
docker compose logs -f keycloak    # wait for 'Listening on: http://0.0.0.0:8080'
```

Admin console: <http://localhost:8080> → log in as `admin / admin`.

---

## 5. Configure the Keycloak Realm

You can do this in the UI or import a JSON realm definition. Do it once in the UI, then export so it's reproducible.

### 5.1 Create the realm

1. Top-left dropdown → **Create realm**
2. **Realm name**: `ecommerce`
3. Save

### 5.2 Create a confidential client for the backend (Kong/services)

Used by Kong/NestJS for token introspection or service-to-service tokens.

1. **Clients** → **Create client**
2. **Client ID**: `ecommerce-backend`
3. **Client type**: OpenID Connect
4. Next → **Client authentication: ON**, **Service accounts roles: ON**, **Authorization: OFF**
5. Next → leave URLs empty → Save
6. Go to **Credentials** tab → copy the **Client secret** (used later in NestJS only if you do introspection).

### 5.3 Create a public client for the SPA / browser

Used by the frontend to do the OIDC Authorization Code + PKCE flow.

1. **Clients** → **Create client**
2. **Client ID**: `ecommerce-web`
3. **Client type**: OpenID Connect
4. Next → **Client authentication: OFF** (public), **Standard flow: ON**, **Direct access grants: ON** (only if you want password-grant for legacy compatibility — disable in prod)
5. Next →
   - **Valid redirect URIs**: `http://localhost:5173/*` (your SPA), `http://localhost:3000/*`
   - **Web origins**: `+` (mirrors redirect URIs, enables CORS)
6. Save

### 5.4 Define roles

1. **Realm roles** → **Create role**: `customer`, `admin`, `support` (mirror your app roles)

### 5.5 Add an audience mapper (so the token's `aud` claim contains `ecommerce-backend`)

Kong's `jwt` plugin doesn't check `aud` by default, but it's good practice.

1. **Client scopes** → **roles** → **Mappers** → **Add mapper** → **By configuration** → **Audience**
2. **Name**: `backend-audience`
3. **Included client audience**: `ecommerce-backend`
4. **Add to access token**: ON

### 5.6 Create a test user

1. **Users** → **Add user**
2. Username: `john`, Email: `john@example.com`, Email verified: ON
3. Save → **Credentials** tab → **Set password** → `password123`, **Temporary: OFF**
4. **Role mapping** tab → **Assign role** → pick `customer`

### 5.7 Export the realm (for reproducibility)

```bash
docker exec -it keycloak \
  /opt/keycloak/bin/kc.sh export --dir /tmp/export --realm ecommerce --users realm_file
docker cp keycloak:/tmp/export ./keycloak-realm
```

Commit `keycloak-realm/ecommerce-realm.json` and import on fresh installs via:

```yaml
# in the keycloak service of docker-compose.yaml
volumes:
  - ./keycloak-realm:/opt/keycloak/data/import
command: ['start-dev', '--import-realm']
```

---

## 6. Verify Keycloak Issues Tokens

Get an access token via the Password Grant (only enabled because we toggled "Direct access grants" — disable in prod and use the auth-code flow from the SPA):

```bash
curl -s -X POST \
  'http://localhost:8080/realms/ecommerce/protocol/openid-connect/token' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=password' \
  -d 'client_id=ecommerce-web' \
  -d 'username=john' \
  -d 'password=password123' \
  -d 'scope=openid profile email' | jq
```

You'll get `access_token`, `refresh_token`, `id_token`. Decode `access_token` at <https://jwt.io>. Note:

- `iss` = `http://localhost:8080/realms/ecommerce`
- `sub` = Keycloak user UUID (this becomes your stable user id)
- `email`, `preferred_username`, `realm_access.roles: ['customer']`
- `alg: RS256`, `kid: <some-id>` (Kong uses `kid` to pick the right key from JWKS)

JWKS endpoint (Kong will fetch keys from here in §7.2):

```bash
curl -s http://localhost:8080/realms/ecommerce/protocol/openid-connect/certs | jq
```

OIDC discovery document:

```bash
curl -s http://localhost:8080/realms/ecommerce/.well-known/openid-configuration | jq
```

---

## 7. Wire Kong to Validate Keycloak JWTs

There are three Kong options. Pick one:

| Option | Plugin | Pros | Cons |
| --- | --- | --- | --- |
| 1 | **`jwt`** (bundled) | Free, ships with Kong OSS, stateless RS256 verify via JWKS | You manually register each Keycloak signing key as a consumer credential (or auto-rotate via a script) |
| 2 | **`kong-oidc`** (community plugin, Lua) | Full OIDC flow: redirects unauthenticated browser users to Keycloak, handles session cookies | Requires custom Kong image, community-maintained, more moving parts |
| 3 | **`openid-connect`** (Kong Enterprise) | Best ergonomics, official | Paid |

The **recommended pattern for API-style traffic** (your case — frontend already has an access token from Keycloak) is **Option 1**. For Option 2, see §10.

### 7.1 Bring in the JWKS to register signing keys

Kong's bundled `jwt` plugin verifies tokens against a **consumer**. Each Keycloak signing key becomes one credential under that consumer.

Fetch Keycloak's JWKS:

```bash
curl -s http://localhost:8080/realms/ecommerce/protocol/openid-connect/certs | jq
```

You need the `kid` (key id) and the **PEM-encoded public key**. Convert JWK → PEM:

```bash
# Install once
npm i -g pem-jwk jwk-to-pem-cli 2>/dev/null || true

# Or use a small Node one-liner:
node -e '
  const jwkToPem = require("jwk-to-pem");
  const jwks = JSON.parse(require("fs").readFileSync(0, "utf8"));
  jwks.keys.filter(k => k.use === "sig").forEach(k => {
    console.log("# kid:", k.kid);
    console.log(jwkToPem(k));
  });
' < <(curl -s http://localhost:8080/realms/ecommerce/protocol/openid-connect/certs)
```

You'll get one or more `-----BEGIN PUBLIC KEY-----` blocks.

### 7.2 Update `kong/kong.yaml`

Add a consumer + JWT credential per signing key, and attach the `jwt` plugin to private routes.

```yaml
consumers:
  - username: keycloak-ecommerce
    jwt_secrets:
      - key: 'http://localhost:8080/realms/ecommerce'    # MUST match the JWT 'iss' claim
        algorithm: RS256
        rsa_public_key: |
          -----BEGIN PUBLIC KEY-----
          MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...
          -----END PUBLIC KEY-----
        # Optional: pin to a specific kid
        # secret: dummy           # unused for RS256
```

> If Keycloak rotates keys, you must add the new key (don't remove the old one until tokens signed with it expire). Automate via a small cron/Job that reads JWKS and patches `kong.yaml` (or use decK).

Attach the plugin to private routes:

```yaml
services:
  - name: api-gateway
    url: http://host.docker.internal:3000
    routes:
      - name: auth-public
        paths:
          - /api/v1/auth/register     # consider removing — Keycloak handles signup
          - /api/v1/auth/forgot-password
          - /api/v1/auth/reset-password
        strip_path: false
      - name: cart
        paths: ['/api/v1/cart']
        strip_path: false
        plugins:
          - name: jwt
            config:
              key_claim_name: iss              # match by 'iss' claim, not the default 'iss' header
              claims_to_verify: [exp]
              run_on_preflight: false          # let CORS preflight through
      - name: orders
        paths: ['/api/v1/orders']
        strip_path: false
        plugins:
          - name: jwt
            config:
              key_claim_name: iss
              claims_to_verify: [exp]
      # ...repeat for payments, addresses, /api/v1/auth/me, /auth/logout
```

Reload Kong:

```bash
docker exec kong-gateway kong reload
```

### 7.3 Forward useful Keycloak claims to NestJS

Use `request-transformer-advanced` (Enterprise) or the bundled `request-transformer` with a custom plugin / Lua, OR — simpler — just trust Kong's pre-verified `Authorization` header in NestJS and decode (don't re-verify) the JWT.

The cleanest no-Enterprise approach: a small **post-jwt** Kong plugin chain that copies claims to headers using the `serverless-functions` plugin:

```yaml
- name: pre-function
  config:
    access:
      - |
        local jwt_header = kong.request.get_header("Authorization")
        if jwt_header then
          local token = jwt_header:match("Bearer%s+(.+)")
          if token then
            local jwt_parser = require "kong.plugins.jwt.jwt_parser"
            local parsed = jwt_parser:new(token)
            if parsed and parsed.claims then
              kong.service.request.set_header("X-User-Id",    parsed.claims.sub or "")
              kong.service.request.set_header("X-User-Email", parsed.claims.email or "")
              kong.service.request.set_header("X-User-Roles", table.concat((parsed.claims.realm_access or {}).roles or {}, ","))
            end
          end
        end
```

Attach this at the global `plugins:` level (after the `jwt` plugin runs). Now every backend request carries `X-User-Id`, `X-User-Email`, `X-User-Roles`.

---

## 8. Adapt NestJS to Trust Kong

### 8.1 Replace `AccessTokenGuard`

Create `KongUserGuard` in `libs/common/src/guards/kong-user.guard.ts`:

```ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class KongUserGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const userId = req.headers['x-user-id'];
    if (!userId) {
      throw new UnauthorizedException('Missing X-User-Id from gateway');
    }

    req.user = {
      id: userId,
      email: req.headers['x-user-email'],
      roles: ((req.headers['x-user-roles'] as string) || '')
        .split(',')
        .filter(Boolean),
    };
    return true;
  }
}
```

Update the `JwtPayload` interface to reflect Keycloak claims:

```ts
// libs/common/src/interface/jwt-payload.interface.ts
export interface JwtPayload {
  id: string;          // Keycloak 'sub' UUID
  email: string;
  roles: string[];     // from realm_access.roles
}
```

In `apps/api-gateway/src/api-gateway.module.ts`, swap the guard:

```ts
import { KongUserGuard } from '@app/common/guards/kong-user.guard';

providers: [
  ApiGatewayService,
  { provide: APP_GUARD, useClass: KongUserGuard },
];
```

Drop the `JwtModule.register(...)` import — the gateway no longer signs/verifies tokens.

### 8.2 Lock down the gateway so it only accepts traffic from Kong

If your NestJS gateway is reachable on `:3000` directly, attackers can bypass Kong. Three mitigations (pick any):

1. **Bind to loopback / private network only** — `app.listen(3000, '127.0.0.1')` if Kong runs on the same host.
2. **Shared secret header** — Kong adds `X-Internal-Secret: <env-var>`, NestJS middleware rejects requests without it.
3. **mTLS** between Kong and upstreams (production).

### 8.3 Decide the fate of `auth-service`

Most endpoints move to Keycloak:

| Endpoint | Replacement |
| --- | --- |
| `POST /auth/register` | Keycloak self-registration (Realm → Realm settings → Login → User registration: ON) OR a thin proxy that hits Keycloak's Admin API |
| `POST /auth/login` | Keycloak's `/realms/ecommerce/protocol/openid-connect/token` (Direct Grants) or Auth Code + PKCE from the SPA |
| `POST /auth/refresh` | Keycloak's `/token` endpoint with `grant_type=refresh_token` |
| `POST /auth/logout` | Keycloak's `/realms/ecommerce/protocol/openid-connect/logout` |
| `GET /auth/me` | Either decode the JWT client-side, or call Keycloak `/userinfo`, or keep a NestJS endpoint that returns app-specific data joined to `X-User-Id` |
| `POST /auth/forgot-password` | Keycloak's built-in "Forgot password?" link on the login page |
| `POST /auth/reset-password` | Keycloak handles via email |

Recommended: rename `auth-service` → keep as a thin **profile sync** service that:

- On the first request from a new `X-User-Id`, creates a local row in `user-service` for app-specific data.
- Optionally listens to Keycloak Events (Keycloak SPI or Admin events webhook) to keep the local user table in sync (deletes, email changes, role changes).

### 8.4 Migrate existing users

Two options:

1. **Bulk export from `auth_db`** → run a script that calls Keycloak Admin API `POST /admin/realms/ecommerce/users` for each user. Passwords are bcrypt — Keycloak supports importing bcrypt as a "custom credential" hash via the import JSON. After import, users keep their existing password.
2. **Just-in-time migration**: enable Keycloak's **Hardcoded Password Policy → Forced password reset** for migrated users, or write a small Keycloak SPI that, on first login failure, calls back to your old `auth-service` to verify the password, then sets it in Keycloak. Smooth for users.

Document this in `MIGRATION.md` before flipping the switch in prod.

---

## 9. Frontend Changes

Your SPA does the Authorization Code + PKCE flow.

```bash
npm i keycloak-js     # or oidc-client-ts
```

```ts
import Keycloak from 'keycloak-js';

export const keycloak = new Keycloak({
  url: 'http://localhost:8080',
  realm: 'ecommerce',
  clientId: 'ecommerce-web',
});

await keycloak.init({
  onLoad: 'check-sso',
  pkceMethod: 'S256',
  silentCheckSsoRedirectUri: window.location.origin + '/silent-check-sso.html',
});

if (!keycloak.authenticated) keycloak.login();

// Send token with every API call
fetch('http://localhost:8000/api/v1/cart', {
  headers: { Authorization: `Bearer ${keycloak.token}` },
});

// Auto refresh
setInterval(() => keycloak.updateToken(30), 60_000);
```

---

## 10. (Alternative) Use the `kong-oidc` Community Plugin

If you want Kong itself to redirect unauthenticated browser users to Keycloak, build a custom Kong image with `kong-oidc`:

```dockerfile
# kong/Dockerfile
FROM kong:3.7
USER root
RUN apk add --no-cache git unzip \
 && luarocks install kong-oidc
USER kong
```

Update `docker-compose.yaml`:

```yaml
kong:
  build: ./kong
  environment:
    KONG_PLUGINS: 'bundled,oidc'
    # ...rest unchanged
```

`kong/kong.yaml`:

```yaml
plugins:
  - name: oidc
    config:
      client_id: ecommerce-backend
      client_secret: '<paste-from-keycloak>'
      discovery: http://keycloak:8080/realms/ecommerce/.well-known/openid-configuration
      bearer_only: 'yes'              # API mode — don't redirect, just 401 on bad token
      realm: ecommerce
      introspection_endpoint_auth_method: client_secret_basic
```

Pros: dynamic key rotation (it reads JWKS itself), supports introspection, supports session cookies for browser flows (`bearer_only: 'no'`).

Cons: third-party Lua plugin, custom image, occasional compatibility lag with new Kong releases.

---

## 11. Production Hardening Checklist

- [ ] Run Keycloak with `start` (not `start-dev`): enables HTTPS, hostname validation, optimized server.
- [ ] Set `KC_HOSTNAME` to your real domain, behind a TLS terminator (ALB / nginx / Cloudflare).
- [ ] Strong `KEYCLOAK_ADMIN_PASSWORD`, restricted by IP/VPN.
- [ ] Disable Direct Access Grants in `ecommerce-web` client once SPA uses the auth-code flow.
- [ ] Token lifespans: access = 5–15 min, refresh = 30 min idle / 8h max — set in **Realm settings → Tokens**.
- [ ] **Required actions** for new users: Verify Email, Update Profile.
- [ ] Enable **Brute Force Detection** in Realm settings → Security defenses.
- [ ] Configure **SMTP** for password reset / email verification.
- [ ] **MFA**: TOTP required for `admin` role users.
- [ ] Back up `keycloak_db` regularly. It's the source of truth for identities.
- [ ] Rotate Keycloak signing keys quarterly; ensure your `kong.yaml` JWKS sync handles overlap.
- [ ] Restrict Kong → upstream to a private network (don't expose `:3000` on the public internet).
- [ ] Audit logs: Keycloak Events → forward to your log aggregator (admin events + login events).
- [ ] Remove the password-grant code path from `auth-service` and delete `auth_db.user.password` after migration.

---

## 12. End-to-End Smoke Test

```bash
# 1) Get a Keycloak token
TOKEN=$(curl -s -X POST \
  http://localhost:8080/realms/ecommerce/protocol/openid-connect/token \
  -d 'grant_type=password' \
  -d 'client_id=ecommerce-web' \
  -d 'username=john' \
  -d 'password=password123' \
  -d 'scope=openid profile email' | jq -r .access_token)

echo "$TOKEN" | cut -c1-40   # sanity: prints first 40 chars

# 2) Call a protected route through Kong
curl -i http://localhost:8000/api/v1/cart \
  -H "Authorization: Bearer $TOKEN"

# 3) Without a token → should be 401 from Kong (not NestJS)
curl -i http://localhost:8000/api/v1/cart

# 4) NestJS should see X-User-Id / X-User-Email / X-User-Roles
#    Verify in NestJS logs or add a temporary controller that returns req.headers
```

---

## 13. File-by-File Summary

| File | Change |
| --- | --- |
| `docker-compose.yaml` | **Modified** — added `postgres-keycloak`, `keycloak`, `keycloak-pg-data` volume |
| `kong/kong.yaml` | **Modified** — added `consumers` with Keycloak JWKS public keys; `jwt` plugin on private routes; `pre-function` plugin to forward claims |
| `keycloak-realm/ecommerce-realm.json` | **New** — exported realm definition for reproducibility |
| `libs/common/src/guards/kong-user.guard.ts` | **New** — replaces `AccessTokenGuard` |
| `libs/common/src/guards/access-token.guard.ts` | **Deleted** (or kept temporarily for fallback) |
| `libs/common/src/interface/jwt-payload.interface.ts` | **Modified** — `role: string` → `roles: string[]`, `id` is Keycloak `sub` |
| `apps/api-gateway/src/api-gateway.module.ts` | **Modified** — swap guard, remove `JwtModule.register` |
| `apps/auth-service/*` | **Shrunk** — register/login/refresh/logout removed; keep only profile-sync logic, or delete the service entirely |
| `apps/user-service/src/users/*` | **New / modified** — JIT user creation keyed on `X-User-Id` |
| `frontend/src/auth/keycloak.ts` | **New** — `keycloak-js` setup, replaces the custom login form |
| `MIGRATION.md` | **New** — document user-data migration steps |

---

## 14. Suggested Rollout Order

1. **Day 0** — Stand up Keycloak + Postgres in `docker-compose.yaml`. Create realm, clients, test user. Confirm `/token` returns a JWT. _No code changes yet._
2. **Day 1** — Add the `jwt` plugin to a single low-risk route in Kong (e.g. `/api/v1/orders`). Manually call it with both an HS256 token and a Keycloak token. Confirm Kong rejects the wrong one.
3. **Day 2** — Add the `pre-function` plugin to forward `X-User-*` headers. Verify NestJS receives them.
4. **Day 3** — Build `KongUserGuard`. Swap it in for one feature module (e.g. `OrdersModule`) behind a feature flag. Keep `AccessTokenGuard` everywhere else.
5. **Day 4** — Run the **migration script** to copy `auth_db.user` rows into Keycloak (preserve bcrypt hashes via Keycloak's import format).
6. **Day 5** — Update the SPA to use `keycloak-js`. Coexist: SPA tries Keycloak first, falls back to old login if needed.
7. **Day 6** — Flip the global guard to `KongUserGuard`. Add the `jwt` plugin to every private route in `kong.yaml`. Remove the fallback login from the SPA.
8. **Day 7** — Strip register/login/refresh/logout from `auth-service`. Delete `JWT_SECRET` / `JWT_REFRESH_SECRET` from environments. Drop the Redis blacklist (Keycloak handles revocation via session invalidation).
9. **Ongoing** — Quarterly key rotation, audit-log review, SMTP and MFA tightening.

---

## 15. References

- Keycloak server admin guide — <https://www.keycloak.org/documentation>
- OIDC discovery & JWKS — <https://www.keycloak.org/securing-apps/oidc-layers>
- Kong JWT plugin — <https://docs.konghq.com/hub/kong-inc/jwt/>
- Kong `pre-function` (serverless) — <https://docs.konghq.com/hub/kong-inc/pre-function/>
- `kong-oidc` (community) — <https://github.com/revomatico/kong-oidc>
- `keycloak-js` adapter — <https://www.keycloak.org/securing-apps/javascript-adapter>
- Bcrypt password import into Keycloak — <https://www.keycloak.org/docs-api/latest/rest-api/index.html#CredentialRepresentation>
