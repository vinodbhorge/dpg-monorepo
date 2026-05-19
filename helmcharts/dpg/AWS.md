# Deploy DPG to AWS EKS

End-to-end guide for shipping the umbrella chart to an EKS cluster. Same
chart as the local guide ([README.md](./README.md)) — the only
difference is the `values-aws.yaml` overlay (ALB ingress, public TLS,
larger PVCs).

## 0. Cluster prerequisites

You need an EKS cluster with these add-ons in place:

| Add-on | Why |
| --- | --- |
| AWS Load Balancer Controller | Renders the UI Ingress as an ALB |
| EBS CSI driver | Provisions PVCs for Postgres + Redis |
| Default StorageClass (`gp3` recommended) | Backing for the PVCs |
| ACM certificate | TLS for the public hostname |
| Route53 hosted zone (or external-dns) | Resolves `dpg.example.com` to the ALB |

If any of these are missing, install them first:

```bash
# AWS Load Balancer Controller via Helm
helm repo add eks https://aws.github.io/eks-charts
helm upgrade --install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system --set clusterName=<your-cluster>

# EBS CSI driver (usually installed as an EKS-managed add-on)
aws eks create-addon --cluster-name <your-cluster> --addon-name aws-ebs-csi-driver
```

Confirm the StorageClass:

```bash
kubectl get storageclass
# look for one annotated as default; gp3 strongly preferred over gp2
```

## 1. Request / locate the ACM certificate

```bash
aws acm list-certificates --query 'CertificateSummaryList[?DomainName==`dpg.example.com`].CertificateArn' --output text
```

Note the ARN — you'll pass it to Helm in step 4.

## 2. Local prep

```bash
git clone <fork>
cd dpg-monorepo

# Point kubectl at the EKS cluster
aws eks update-kubeconfig --region <region> --name <cluster>
kubectl get nodes  # sanity check
```

## 3. Generate credentials

The chart's `install.sh` only handles the local-deploy path. For AWS you
run the same `generate_passwords` step against `values.yaml`, but skip
the `helm install` line it contains and run a real `helm upgrade` with
the AWS overlay (next step).

```bash
# Writes PG_PW / REDIS_PW / AUTH_SECRET into values.yaml if empty.
# Idempotent — re-runs keep existing values.
bash -c 'source <(grep -A 30 "^generate_passwords()" helmcharts/dpg/install.sh); generate_passwords helmcharts/dpg/values.yaml'
```

Verify the three lines are now populated:

```bash
grep -E "# (PG_PW|REDIS_PW|AUTH_SECRET)$" helmcharts/dpg/values.yaml
```

> `values.yaml` now contains plaintext passwords. **Do not commit it.**
> `git update-index --assume-unchanged helmcharts/dpg/values.yaml`
> keeps it out of `git diff` / `git add -A`.

## 4. Install

```bash
RELEASE=dpg
NAMESPACE=dpg
HOST=dpg.example.com
CERT_ARN=arn:aws:acm:us-east-1:123456789012:certificate/abcd-1234

kubectl create namespace $NAMESPACE 2>/dev/null || true

helm upgrade --install $RELEASE ./helmcharts/dpg \
  -n $NAMESPACE \
  -f ./helmcharts/dpg/values.yaml \
  -f ./helmcharts/dpg/values-aws.yaml \
  --set "ui.ingress.hosts[0].host=$HOST" \
  --set "api.config.ALLOWED_ORIGINS=https://$HOST" \
  --set "ui.ingress.annotations.alb\.ingress\.kubernetes\.io/certificate-arn=$CERT_ARN" \
  --wait --timeout 10m
```

What this produces:

| Resource | Type | Notes |
| --- | --- | --- |
| `dpg-api` Pod | 1 replica | ClusterIP only; never exposed |
| `dpg-ui` Pod | 1 replica | ClusterIP; backed by the ALB Ingress |
| `dpg-postgresql-0` StatefulSet pod | 1 replica | EBS-backed PVC (20Gi by default) |
| `dpg-redis-master-0` StatefulSet pod | 1 replica | EBS-backed PVC (8Gi) |
| `dpg-schemas` Pod | 1 replica | nginx serving the network.json ConfigMap |
| `dpg-api-migrate` Job | hook | Applies schema.sql once Postgres is reachable |
| `dpg-ui` Ingress | ALB | DNS target after the controller provisions it |

Wait for the ALB to come up:

```bash
kubectl -n $NAMESPACE get ingress dpg-ui -w
# wait until ADDRESS shows a *.elb.amazonaws.com hostname
```

## 5. DNS

Point `dpg.example.com` at the ALB. Two options:

**Route53 alias (manual):**

```bash
ALB=$(kubectl -n $NAMESPACE get ingress dpg-ui -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
echo "Create an A-ALIAS for dpg.example.com → $ALB"
```

**external-dns (automatic):** if external-dns is installed and the
Ingress carries `external-dns.alpha.kubernetes.io/hostname=dpg.example.com`,
the record is created for you. Add that annotation to
`ui.ingress.annotations` in your overlay.

## 6. Verify

```bash
curl -sI https://$HOST/                              # 200 from nginx
curl -s https://$HOST/api/v1/network/schemas | jq -r '[.[].network] | unique[]'
# yellow_dot
# blue_dot
```

Open `https://$HOST` in a browser; the UI should render the network
selector with the configured networks.

## 7. Day-2 ops

**Update images:**

```bash
helm upgrade $RELEASE ./helmcharts/dpg -n $NAMESPACE \
  -f ./helmcharts/dpg/values.yaml \
  -f ./helmcharts/dpg/values-aws.yaml \
  --set api.image.tag=v1.0.3 \
  --set ui.image.tag=v1.0.3 \
  --reuse-values  # ← only safe after the initial install; see Caveats
```

**Add or edit a network:** drop / edit the JSON under
`helmcharts/dpg/files/networks/`, append the name to `schemas.networks`,
extend `api.config.NETWORK_CONFIG_URLS` and `api.config.SERVED_DOMAINS`
in `values.yaml`, then re-run the install command from step 4.

**Rotate AUTH_SECRET:** edit `credentials.api.authSecret` in
`values.yaml`, re-run the install command. All existing sessions are
invalidated.

**Rotate Postgres / Redis passwords:** Bitnami stores the password
inside the data volume on first boot — changing it in `values.yaml`
alone won't take. You must either:

1. `ALTER USER dpg WITH PASSWORD '<new>'` from inside the pod, then
   update `values.yaml`, then upgrade; or
2. Delete the PVC (destroys data) and reinstall.

**Uninstall:**

```bash
helm uninstall $RELEASE -n $NAMESPACE
kubectl -n $NAMESPACE delete pvc --all   # only if you want to drop data
kubectl delete ns $NAMESPACE
```

## Caveats

- The umbrella centralises values via YAML anchors (`*api_image`,
  `*pg_password`, ...). `--set images.api.tag=...` does NOT propagate —
  override `api.image.tag` (and `ui.image.tag`) directly.
- `helm upgrade --reuse-values` ignores edits to `values.yaml`. To pick
  up changes (new networks, new tokens), drop `--reuse-values` and pass
  `-f values.yaml -f values-aws.yaml` again.
- The migrate Job needs the Postgres admin password to create
  `pgcrypto`, `cube`, `earthdistance`. The chart already wires
  `postgres.adminPasswordKey` to the `dpg-postgres` Secret — nothing to
  configure, but if you switch Postgres to an external RDS instance,
  point that block at the corresponding secret keys.
- API stays `ClusterIP`. The UI's nginx proxies `/api/*` to it, so the
  ALB only fronts the UI. If you want the API exposed directly, add a
  second Ingress against `dpg-api` and bump `ALLOWED_ORIGINS`.
- For private clusters, swap the ALB annotations to
  `alb.ingress.kubernetes.io/scheme: internal` and skip the ACM bits.
