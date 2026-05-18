# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS base

RUN apk add --no-cache libc6-compat \
  && corepack enable

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV TURBO_TELEMETRY_DISABLED=1
ENV CI=true


FROM base AS pruner

WORKDIR /repo

COPY . .

RUN pnpm dlx turbo@2.9.4 prune ui --docker


FROM base AS deps

WORKDIR /app

COPY --from=pruner /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /repo/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=pruner /repo/out/json/ ./

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile


FROM base AS builder

WORKDIR /app

COPY --from=deps /app/ ./
COPY --from=pruner /repo/out/full/ ./

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm turbo run build --filter=ui


FROM nginxinc/nginx-unprivileged:1.27-alpine AS runner

# Drop the default served at conf.d, ship config as a template so the entrypoint
# (20-envsubst-on-templates.sh) renders ${API_UPSTREAM} from env at startup.
USER root
RUN rm -f /etc/nginx/conf.d/default.conf
USER nginx

COPY --chown=nginx:nginx apps/ui/nginx.conf /etc/nginx/templates/default.conf.template
COPY --chown=nginx:nginx --from=builder /app/apps/ui/dist /usr/share/nginx/html

# Sensible default; chart overrides via env to point at the right release.
ENV API_UPSTREAM=http://dpg-api:2742

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
