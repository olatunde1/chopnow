# syntax=docker/dockerfile:1.7
#
# Static image for one web portal (vendor or admin), served by unprivileged nginx with a strict CSP.
# Build from the repository root, once per portal and environment (the API URL is baked in):
#   docker build -f deploy/web.Dockerfile --build-arg APP=vendor-web \
#     --build-arg API_BASE_URL=https://api.chopnow.example -t chopnow-vendor:<sha> .
# APP is vendor-web or admin-web. API_BASE_URL is public (it ships in the JavaScript); never pass secrets.

ARG NODE_IMAGE=node:22.13.1-bookworm-slim

FROM ${NODE_IMAGE} AS build
ARG APP
ARG API_BASE_URL
RUN test "$APP" = vendor-web -o "$APP" = admin-web || (echo "APP must be vendor-web or admin-web" && exit 1) \
 && case "$API_BASE_URL" in https://*) ;; *) echo "API_BASE_URL must be https://…" && exit 1 ;; esac
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared-utils/package.json packages/shared-utils/
COPY packages/shared-schemas/package.json packages/shared-schemas/
COPY services/api/package.json services/api/
COPY apps/customer-mobile/package.json apps/customer-mobile/
COPY apps/rider-mobile/package.json apps/rider-mobile/
COPY apps/vendor-web/package.json apps/vendor-web/
COPY apps/admin-web/package.json apps/admin-web/
COPY tests/e2e/package.json tests/e2e/
COPY tests/load/package.json tests/load/
RUN npm ci -w @chopnow/shared-utils -w @chopnow/shared-schemas -w @chopnow/$APP --include-workspace-root --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/shared-utils packages/shared-utils
COPY packages/shared-schemas packages/shared-schemas
COPY apps/$APP apps/$APP
RUN npm run build -w @chopnow/shared-utils -w @chopnow/shared-schemas \
 && VITE_API_BASE_URL="$API_BASE_URL" npm run build -w @chopnow/$APP \
 # Source maps help debugging but expose source; keep them out of the public site.
 && find apps/$APP/dist -name '*.map' -delete

FROM nginxinc/nginx-unprivileged:1.27.5-alpine AS runtime
ARG APP
ARG API_BASE_URL
COPY deploy/nginx-spa.conf /etc/nginx/conf.d/default.conf
# The CSP may only talk to this API (https and its wss realtime endpoint).
RUN API_ORIGIN="$(echo "$API_BASE_URL" | sed -E 's#^(https://[^/]+).*#\1#')" \
 && WS_ORIGIN="$(echo "$API_ORIGIN" | sed 's#^https://#wss://#')" \
 && sed -i "s#__API_ORIGIN__#$API_ORIGIN#g; s#__WS_ORIGIN__#$WS_ORIGIN#g" /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/$APP/dist /usr/share/nginx/html
EXPOSE 8080
