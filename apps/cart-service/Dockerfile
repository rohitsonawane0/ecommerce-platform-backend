# syntax=docker/dockerfile:1
#
# Cart service (TCP microservice, port 3003).
# Build from the REPO ROOT (it imports @app/common from libs/):
#   docker build -f apps/cart-service/Dockerfile -t ecommerce/cart-service .

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

# ---- full deps (needed for the nest/webpack build) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# ---- build: nest build cart-service -> dist/apps/cart-service/main.js ----
FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY libs ./libs
COPY apps/cart-service ./apps/cart-service
RUN pnpm exec nest build cart-service

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
COPY --from=build /app/dist/apps/cart-service ./dist/apps/cart-service
COPY package.json ./

USER node
EXPOSE 3003
CMD ["node", "dist/apps/cart-service/main"]
