# syntax=docker/dockerfile:1
#
# Product service (TCP microservice, port 3002).
# Build from the REPO ROOT (it imports @app/common from libs/):
#   docker build -f apps/product-service/Dockerfile -t ecommerce/product-service .

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

# ---- full deps (needed for the nest/webpack build) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# ---- build: nest build product-service -> dist/apps/product-service/main.js ----
FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY libs ./libs
COPY apps/product-service ./apps/product-service
# Two bundles land in the SAME dist/apps/product-service dir: main.js (the app) and
# migrate.js (the migration entrypoint) — nest-cli names the output after entryFile and
# ignores the tsconfig outDir in monorepo mode.
#
# Order is load-bearing: the app build has deleteOutDir: true and wipes the directory,
# so it must run FIRST. The migrations project sets deleteOutDir: false, so it adds
# migrate.js without removing main.js. Reversed, the image ships without migrate.js.
RUN pnpm exec nest build product-service \
 && pnpm exec nest build product-service-migrations

# ---- production deps only ----
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts

# ---- runtime ----
FROM node:24-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist/apps/product-service ./dist/apps/product-service
COPY package.json ./

USER node
EXPOSE 3002
CMD ["node", "dist/apps/product-service/main"]
