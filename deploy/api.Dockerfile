# syntax=docker/dockerfile:1.7
#
# ChopNow API image. Build from the repository root:
#   docker build -f deploy/api.Dockerfile -t chopnow-api:$(git rev-parse --short HEAD) --build-arg RELEASE=$(git rev-parse --short HEAD) .
#
# Targets:
#   runtime (default)  the API. PROCESS_ROLE=all|web|worker picks what it runs (see DEPLOYMENT.md).
#   migrate            one-shot `prisma migrate deploy`, run before each release. It carries the
#                      Prisma CLI, which the runtime image deliberately does not.

ARG NODE_IMAGE=node:22.13.1-bookworm-slim

# ---- install: every workspace manifest, so `npm ci` matches the lockfile exactly ----
FROM ${NODE_IMAGE} AS install
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
# Only the API and the packages it uses; the apps' dependencies are never installed here.
RUN npm ci -w @chopnow/shared-utils -w @chopnow/shared-schemas -w @chopnow/api --no-audit --no-fund

# ---- build: shared packages, Prisma client, API ----
FROM install AS build
COPY tsconfig.base.json ./
COPY packages/shared-utils packages/shared-utils
COPY packages/shared-schemas packages/shared-schemas
COPY database/prisma database/prisma
COPY services/api services/api
RUN npm run build -w @chopnow/shared-utils -w @chopnow/shared-schemas \
 && npm run build -w @chopnow/api

# ---- migrate: one-shot job (needs DATABASE_URL with DDL rights, i.e. the migrator role) ----
FROM build AS migrate
WORKDIR /app/services/api
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

# ---- production dependencies only ----
FROM install AS prod-deps
RUN npm ci -w @chopnow/shared-utils -w @chopnow/shared-schemas -w @chopnow/api --omit=dev --no-audit --no-fund

# ---- runtime ----
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/packages/shared-utils/package.json packages/shared-utils/
COPY --from=build /app/packages/shared-utils/dist packages/shared-utils/dist
COPY --from=build /app/packages/shared-schemas/package.json packages/shared-schemas/
COPY --from=build /app/packages/shared-schemas/dist packages/shared-schemas/dist
COPY --from=build /app/services/api/package.json services/api/
COPY --from=build /app/services/api/dist services/api/dist
ARG RELEASE=unknown
ENV RELEASE=${RELEASE}
# Unprivileged; the image holds no secrets (all configuration comes from the environment).
USER node
WORKDIR /app/services/api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# SIGTERM triggers a graceful shutdown (jobs stop, sockets close, requests drain; 10 s cap).
STOPSIGNAL SIGTERM
CMD ["node", "dist/server.js"]
