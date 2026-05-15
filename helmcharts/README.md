# DPG Helm Charts

This directory vendors upstream Bitnami charts for the data services used by
`docker-compose.yaml`.

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

Create the referenced Kubernetes secrets separately in the target namespace.
