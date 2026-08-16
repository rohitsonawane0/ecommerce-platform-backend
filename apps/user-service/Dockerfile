# syntax=docker/dockerfile:1
#
# User service (TCP microservice, port 3006).
# Build from the REPO ROOT (it imports @app/common from libs/):
#   docker build -f apps/user-service/Dockerfile -t ecommerce/user-service .

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

# ---- full deps (needed for the nest/webpack build) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# ---- build: nest build user-service -> dist/apps/user-service/main.js ----
FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY libs ./libs
COPY apps/user-service ./apps/user-service
RUN pnpm exec nest build user-service

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
COPY --from=build /app/dist/apps/user-service ./dist/apps/user-service
COPY package.json ./

USER node
EXPOSE 3006
CMD ["node", "dist/apps/user-service/main"]
