# syntax=docker/dockerfile:1
#
# Orders service (TCP microservice, port 3004).
# Build from the REPO ROOT (it imports @app/common from libs/):
#   docker build -f apps/orders-service/Dockerfile -t ecommerce/orders-service .

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

# ---- full deps (needed for the nest/webpack build) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# ---- build: nest build orders-service -> dist/apps/orders-service/main.js ----
FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY libs ./libs
COPY apps/orders-service ./apps/orders-service
RUN pnpm exec nest build orders-service

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
COPY --from=build /app/dist/apps/orders-service ./dist/apps/orders-service
COPY package.json ./

USER node
EXPOSE 3004
CMD ["node", "dist/apps/orders-service/main"]
