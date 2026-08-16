# syntax=docker/dockerfile:1
#
# API Gateway image.
# Build from the REPO ROOT (the gateway imports @app/common from libs/):
#   docker build -f apps/api-gateway/Dockerfile -t ecommerce/api-gateway .

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

# ---- full deps (needed for the nest/webpack build) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# ---- build: nest build api-gateway -> dist/apps/api-gateway/main.js ----
FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY libs ./libs
COPY apps/api-gateway ./apps/api-gateway
RUN pnpm exec nest build api-gateway

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
COPY --from=build /app/dist/apps/api-gateway ./dist/apps/api-gateway
COPY package.json ./

USER node
EXPOSE 3000
CMD ["node", "dist/apps/api-gateway/main"]
