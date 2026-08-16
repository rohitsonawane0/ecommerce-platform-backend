# syntax=docker/dockerfile:1
#
# Payment service (TCP microservice, port 3005).
# Build from the REPO ROOT (it imports @app/common from libs/):
#   docker build -f apps/payment-service/Dockerfile -t ecommerce/payment-service .

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

# ---- full deps (needed for the nest/webpack build) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# ---- build: nest build payment-service -> dist/apps/payment-service/main.js ----
FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY libs ./libs
COPY apps/payment-service ./apps/payment-service
RUN pnpm exec nest build payment-service

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
COPY --from=build /app/dist/apps/payment-service ./dist/apps/payment-service
COPY package.json ./

USER node
EXPOSE 3005
CMD ["node", "dist/apps/payment-service/main"]
