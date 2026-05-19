# Pre-deploy configuration checklist

Run through these `helmcharts/dpg/values.yaml` settings *before*
`bash helmcharts/dpg/install.sh`. Mistakes in any of these surface as
"failed to send OTP", "not allowed" / CORS errors, blank UI, items not
fetching across networks, or the migrate Job failing.

Section order mirrors `values.yaml`. Values shown are the current
defaults — change only the ones flagged for your environment.

## 1. Images

```yaml
images:
  api:
    repository: ghcr.io/vinodbhorge/dpg-monorepo/api
    tag: "v1.0.3"
    pullPolicy: IfNotPresent
  ui:
    repository: ghcr.io/vinodbhorge/dpg-monorepo/ui
    tag: "v1.0.3"
    pullPolicy: IfNotPresent
```

- Pin a released `tag` per environment (don't deploy `latest`).
- For air-gapped or private clusters, retag and push to a registry the
  cluster can pull from, then update `repository` + add
  `imagePullSecrets`.
- `pullPolicy: Never` only when running a locally-built image on a
  local node (kind, k3s `--docker`, colima).

## 2. Credentials

```yaml
credentials:
  postgresql:
    password: &pg_password ""  # PG_PW          ← install.sh fills
  redis:
    password: &redis_password ""  # REDIS_PW    ← install.sh fills
  api:
    authSecret: ""  # AUTH_SECRET                ← install.sh fills
```

- Leave the three password fields empty before the first install.
  `install.sh`'s `generate_passwords()` fills them with
  `openssl rand` and Helm renders the three Secrets
  (`dpg-postgres`, `dpg-redis`, `dpg-api-secrets`).
- If you're reusing an existing Postgres PVC, paste the *existing*
  password into `credentials.postgresql.password` before installing —
  Bitnami's preflight rejects mismatched values.
- Never commit a populated `values.yaml`. After install:
  ```
  git update-index --assume-unchanged helmcharts/dpg/values.yaml
  ```

## 3. `api.config` — the env that drives the API

| Field | Required? | What to set |
| --- | --- | --- |
| `NODE_ENV` | yes | `production` for any real deploy |
| `INSTANCE_NAME` | yes | Stable per-cluster name; appears in logs |
| `INSTANCE_ENV` | yes | `production` / `staging` / `development` |
| `API_DOMAIN` | yes | Internal API base used to stamp `item_instance_url` on create. Keep `http://api.dpg.local` if you don't expose the API; the value is logically a label and only needs to be stable for the lifetime of the cluster. |
| `API_PORT` | yes | `"2742"` (matches `service.targetPort`) |
| `AUTH_MIDDLEWARE_ENABLED` | yes | `"true"` in prod, `"false"` only for unauthenticated smoke tests |
| `CREATE_TEST_OTP` | yes | `"true"` for local/dev — better-auth logs a fixed `000000` OTP. `"false"` in prod (requires a real notification provider) |
| `ALLOWED_ORIGINS` | **yes — most-common foot-gun** | Comma-separated origins the browser will use. Must include every URL you'll open the UI on: `http://localhost:8080`, `http://localhost:8081`, `https://dpg.example.com`. Empty → fastify-cors rejects everything with "Not allowed" → "failed to send OTP" |
| `SERVED_DOMAINS` | **yes** | Comma-separated `<network>/<domain>` pairs this API will accept create/fetch requests for. Add every domain you'll touch from the UI. Default: `yellow_dot/student,yellow_dot/tutor,yellow_dot/coaching_center,blue_dot/seeker,blue_dot/provider` |
| `NETWORK_CONFIG_SOURCE` | yes | `remote` when using the in-cluster `dpg-schemas` Service (default). `local` only for single-network dev |
| `NETWORK_CONFIG_URLS` | yes (when `SOURCE=remote`) | Comma-separated `<name>=http://dpg-schemas/<name>.json`. Must match `schemas.networks` 1:1 |
| `NETWORK_CONFIG_LOCAL_FILE` | only when `SOURCE=local` | Path inside the API image to a single `network.json` |
| `ALLOW_EXTRA_SCHEMA_DATA` | no | `"true"` lets clients send fields not in the schema |
| `SCHEMA_REGISTRY_URL` | no | Only if you use a remote schema registry instead of the in-cluster ConfigMap |

Notification / scoring keys live under `credentials.api.data` (rendered
into the Secret) — leave empty unless you wire SMS / matching providers.

## 4. `api.postgres` and `api.redis`

```yaml
api:
  postgres:
    host: dpg-postgresql      # change only if external RDS
    port: 5432
    adminSecret: dpg-postgres # required by the migrate Job for CREATE EXTENSION
    adminUser: postgres
    adminPasswordKey: postgres-password
  redis:
    host: dpg-redis-master    # change only if external ElastiCache
    port: 6379
```

If you swap to an external Postgres:
1. Drop `postgresql.enabled: false` to skip the bundled chart.
2. Set `api.postgres.host` to the RDS endpoint.
3. Create the `dpg-postgres` Secret out-of-band with
   `postgres-password` and `password` keys, *or* set
   `credentials.postgresql.password` and let Helm render the Secret.
4. Ensure the user has CREATE EXTENSION privileges (or pre-create
   `pgcrypto`, `cube`, `earthdistance`) and the Job will skip them.

Same shape for Redis if you point at ElastiCache.

## 5. `ui` — service + runtime config

```yaml
ui:
  service:
    type: ClusterIP            # leave ClusterIP unless using LoadBalancer
    port: 80
    targetPort: 8080
  ingress:
    enabled: false             # see values-aws.yaml for ALB defaults
  runtimeConfig:
    VITE_API_URL: ""           # leave empty — axios sends paths verbatim
    VITE_API_URLS: ""
    VITE_DEFAULT_API_URL: ""
    VITE_SHOW_INSTANCE_SELECTOR: "false"
    VITE_NETWORK_NAME: ""      # empty = show every network the API serves
```

`runtimeConfig` is injected as `/config.js` and parsed by the browser —
no rebuild required to change it. Setting `VITE_NETWORK_NAME` to a
specific name (e.g. `yellow_dot`) hides the network selector and locks
the UI to that one network.

## 6. `postgresql` and `redis` (bundled charts)

```yaml
postgresql:
  primary:
    persistence:
      enabled: true
      size: 8Gi                # bump for prod (values-aws.yaml = 20Gi)
      # storageClass: gp3      # set explicitly if no default StorageClass
    initdb:
      scripts:
        00-extensions.sql: |   # pre-creates extensions on first boot
          \connect dpg
          CREATE EXTENSION IF NOT EXISTS pgcrypto;
          CREATE EXTENSION IF NOT EXISTS cube;
          CREATE EXTENSION IF NOT EXISTS earthdistance;
redis:
  master:
    persistence:
      enabled: true
      size: 8Gi
      # storageClass: gp3
  replica:
    replicaCount: 0            # bump for prod replication
```

Required checks:
- Cluster has a default `StorageClass`, **or** you set
  `storageClass:` explicitly.
- `EBS CSI driver` (EKS) or equivalent is installed.
- `8Gi` is enough for dev; raise for prod.

## 7. `schemas` — in-cluster network.json server

```yaml
schemas:
  enabled: true
  image: nginx:1.27-alpine
  publicApiUrl: "http://dpg-api:2742"   # cluster-internal, do NOT change
  networks:
    - yellow_dot
    - blue_dot
```

- `publicApiUrl` is substituted into each `network.json`'s
  `instance_url`. The API uses it for cross-instance item fetches, so
  it must be reachable **from inside the cluster** — keep the in-cluster
  Service URL. Setting it to `http://localhost:8080` will produce
  `ECONNREFUSED` on cross-network fetches.
- Every name in `schemas.networks` needs a matching
  `helmcharts/dpg/files/networks/<name>.json` AND a matching entry in
  `api.config.NETWORK_CONFIG_URLS` AND matching pairs in
  `api.config.SERVED_DOMAINS`.

### Adding a new network

1. `cp helmcharts/dpg/files/networks/blue_dot.json helmcharts/dpg/files/networks/<name>.json`
2. Edit the file; use `__PUBLIC_API_URL__` / `__SCHEMAS_URL__/<peer>.json`
   tokens (Helm substitutes them at render).
3. Append `<name>` to `schemas.networks`.
4. Append `<name>=http://dpg-schemas/<name>.json` to
   `api.config.NETWORK_CONFIG_URLS`.
5. Append `<name>/<domain>` pairs to `api.config.SERVED_DOMAINS`.
6. Re-run `bash helmcharts/dpg/install.sh`.

## 8. Resources

Defaults are empty `{}` — fine for dev / local. For prod, set
`resources.api`, `resources.ui`, `resources.postgresql`,
`resources.redis.master` (and `redis.replica` if scaled out) with real
requests/limits. `values-aws.yaml` ships sensible production defaults.

## 9. Environment-specific overlays

Use a second `-f` file rather than editing `values.yaml` per environment:

```bash
helm upgrade --install dpg ./helmcharts/dpg -n dpg \
  -f ./helmcharts/dpg/values.yaml \
  -f ./helmcharts/dpg/values-aws.yaml         # or your own values-prod.yaml
```

What to put in the overlay:

| Setting | local | EKS / prod |
| --- | --- | --- |
| `api.config.ALLOWED_ORIGINS` | `http://localhost:8080` | `https://dpg.example.com` |
| `api.config.CREATE_TEST_OTP` | `"true"` | `"false"` |
| `ui.ingress.enabled` | `false` (port-forward) | `true` + ALB/NGINX annotations |
| `ui.ingress.hosts[0].host` | n/a | `dpg.example.com` |
| `postgresql.primary.persistence.size` | `8Gi` | `20Gi`+ |
| `redis.master.persistence.size` | `8Gi` | `8–20Gi` |
| `redis.replica.replicaCount` | `0` | `1`+ for HA |
| `resources.*` | `{}` | real requests/limits |

## 10. Pre-flight verification

Before running `install.sh`, run:

```bash
# Cluster reachable + has nodes
kubectl get nodes

# Default StorageClass exists
kubectl get storageclass | grep "(default)"

# Egress reaches ghcr.io for the api/ui images (or your private registry)
kubectl run pull-check --rm -it --restart=Never --image=busybox -- wget -qS \
  https://ghcr.io/v2/vinodbhorge/dpg-monorepo/api/manifests/v1.0.3 2>&1 | head

# Render once and search for the things that bite most often
helm template t ./helmcharts/dpg | grep -E "ALLOWED_ORIGINS|SERVED_DOMAINS|NETWORK_CONFIG_URLS"
```

If any of those don't match this checklist, fix `values.yaml` first.

## Symptoms → likely missed setting

| Symptom | Setting to check |
| --- | --- |
| "Failed to send OTP" / `Not allowed` in API log | `api.config.ALLOWED_ORIGINS` doesn't include the browser URL |
| `Route POST:/auth/... not found` | UI nginx is stripping `/api/` (you edited `apps/ui/nginx.conf` `proxy_pass` line) |
| Blank UI after schema-related call returns `/api/api/...` | `ui.runtimeConfig.VITE_API_URL` is set to `/api` instead of `""` |
| `relation "items" does not exist` on first create | Migrate Job didn't run; check `api.postgres.adminSecret` is set and the cluster has internet (postgres:16-alpine image) |
| `permission denied to create extension "earthdistance"` | `api.postgres.adminPasswordKey` doesn't point at a superuser password |
| Pods stuck `Pending` with PVC events | Missing StorageClass — set `postgresql.primary.persistence.storageClass` + `redis.master.persistence.storageClass` |
| `Failed to fetch items across network instances` / `ECONNREFUSED` | `schemas.publicApiUrl` is browser URL instead of in-cluster URL |
| UI shows only one network even after adding a JSON file | Missed step 3, 4 or 5 of "Adding a new network" |
| Bitnami `PASSWORDS ERROR: ... must not be empty` on upgrade | `credentials.postgresql.password` was wiped; restore it from the existing `dpg-postgres` Secret before upgrading |
