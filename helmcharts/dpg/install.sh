#!/usr/bin/env bash
# Install / upgrade the DPG umbrella chart into a Kubernetes cluster.
#
# Single source of truth is values.yaml. Generated passwords are written
# into values.yaml itself (postgresql.password / redis.password /
# api.authSecret under credentials:). Helm renders them into Secrets via
# templates/secrets.yaml; subcharts consume those Secrets by name.
#
# Re-running is safe: existing passwords in values.yaml are kept.
#
# Overridable via env:
#   RELEASE     Helm release name           (default: dpg)
#   NAMESPACE   Kubernetes namespace        (default: dpg)

set -euo pipefail

RELEASE=${RELEASE:-dpg}
NAMESPACE=${NAMESPACE:-dpg}

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CHART_DIR="$SCRIPT_DIR"
VALUES_FILE="$CHART_DIR/values.yaml"

for bin in helm kubectl openssl sed; do
  command -v "$bin" >/dev/null || { echo "missing: $bin" >&2; exit 1; }
done

# -------------------------------------------------------------------------
# generate_passwords
#   Reads the three credential fields from values.yaml. For any that are
#   still the empty placeholder ("") an openssl-generated value is written
#   back in place. Uses sed anchored to the inline `# PG_PW|REDIS_PW|
#   AUTH_SECRET` marker so the surrounding YAML / anchors stay intact.
#   Re-runnable: filled values are preserved.
# -------------------------------------------------------------------------
generate_passwords() {
  local file=$1
  _write_if_empty() {
    local marker=$1 newval=$2
    # Match `password: ""  # MARKER` and `password: &anchor ""  # MARKER`.
    if grep -qE "^[[:space:]]+(password|authSecret):[[:space:]]+(&[A-Za-z_][A-Za-z0-9_]*[[:space:]]+)?\"\"[[:space:]]+# ${marker}\$" "$file"; then
      sed -i -E \
        "s,^([[:space:]]+(password|authSecret)):[[:space:]]+(&[A-Za-z_][A-Za-z0-9_]*[[:space:]]+)?\"\"[[:space:]]+# ${marker}\$,\1: \3\"${newval}\"  # ${marker}," \
        "$file"
      echo "  generated ${marker}"
    else
      echo "  ${marker} already set, keeping"
    fi
  }

  echo "credentials:"
  _write_if_empty PG_PW       "$(openssl rand -hex 16)"
  _write_if_empty REDIS_PW    "$(openssl rand -hex 16)"
  _write_if_empty AUTH_SECRET "$(openssl rand -hex 32)"
}

generate_passwords "$VALUES_FILE"

# --- namespace ------------------------------------------------------------
kubectl get namespace "$NAMESPACE" >/dev/null 2>&1 || kubectl create namespace "$NAMESPACE"

# --- helm install/upgrade -------------------------------------------------
# Everything (images, hosts, ALLOWED_ORIGINS, SERVED_DOMAINS, runtimeConfig,
# password material, ...) is in values.yaml. No --set.
helm upgrade --install "$RELEASE" "$CHART_DIR" \
  --namespace "$NAMESPACE" \
  --wait --timeout 5m

kubectl -n "$NAMESPACE" wait --for=condition=Ready pods --all --timeout=240s || true
kubectl -n "$NAMESPACE" get pods,svc

cat <<EOF

deploy complete.

  release:    $RELEASE
  namespace:  $NAMESPACE
  values:     $VALUES_FILE  (now contains generated passwords — do NOT commit)

next:
  kubectl -n $NAMESPACE port-forward svc/$RELEASE-ui 8080:80
  open http://localhost:8080

uninstall:
  helm uninstall $RELEASE -n $NAMESPACE && kubectl delete ns $NAMESPACE
EOF
