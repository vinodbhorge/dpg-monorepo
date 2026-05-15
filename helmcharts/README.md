# DPG Helm Charts

This directory holds charts for deploying the DPG monorepo on Kubernetes.

## Data services (vendored Bitnami charts)

| Service | Chart | Chart version | App version |
| --- | --- | --- | --- |
| PostgreSQL | `bitnami/postgresql` | `18.6.6` | `18.4.0` |
| Redis | `bitnami/redis` | `19.6.4` | `7.2.5` |

Use the DPG override files to keep the deployment close to the compose setup.

```bash
helm upgrade --install dpg-postgres ./helmcharts/postgresql \
  -f ./helmcharts/dpg-postgresql-values.yaml

helm upgrade --install dpg-redis ./helmcharts/redis \
  -f ./helmcharts/dpg-redis-values.yaml
```

Create the referenced Kubernetes secrets (`dpg-postgres`, `dpg-redis`)
separately in the target namespace.

## Application charts

| App | Chart | Image |
| --- | --- | --- |
| API (Fastify/Node) | `./api` | `ghcr.io/<org>/dpg-monorepo/api` |
| UI (Vite/React + nginx) | `./ui` | `ghcr.io/<org>/dpg-monorepo/ui` |

### API

```bash
helm upgrade --install dpg-api ./helmcharts/api \
  --set image.tag=<tag> \
  --set secrets.data.AUTH_SECRET=<random> \
  --set secrets.data.POSTGRES_PASSWORD=<pg-password> \
  --set secrets.data.REDIS_PASSWORD=<redis-password> \
  --set config.API_DOMAIN=https://api.example.com
```

Non-secret env lives under `config.*` (rendered into a ConfigMap). Secrets
land in a Secret rendered from `secrets.data.*`; set `secrets.create=false`
and `secrets.existingSecret=<name>` to bring your own. Postgres/Redis hosts
default to the bundled `dpg-postgres-postgresql` / `dpg-redis-master`
services — toggle `postgres.enabled` / `redis.enabled` or override
`config.POSTGRES_HOST` / `config.REDIS_HOST` for external clusters.

### UI

```bash
helm upgrade --install dpg-ui ./helmcharts/ui \
  --set image.tag=<tag> \
  --set runtimeConfig.VITE_API_URL=https://api.example.com
```

The chart mounts a `config.js` ConfigMap at
`/usr/share/nginx/html/config.js`, populating `window.__DPG_UI_CONFIG__` at
runtime — no rebuild needed to retarget API URLs.
