# syntax=docker/dockerfile:1
#
# Auth service (TCP microservice, port 3001).
# Build from the REPO ROOT (it imports @app/common from libs/):
#   docker build -f apps/auth-service/Dockerfile -t ecommerce/auth-service .

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

# ---- full deps (needed for the nest/webpack build) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# ---- build: nest build auth-service -> dist/apps/auth-service/main.js ----
FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY libs ./libs
COPY apps/auth-service ./apps/auth-service
RUN pnpm exec nest build auth-service

# ---- production deps only ----
# bcrypt is a native addon with no musl prebuild, so it is compiled from source
# here (pnpm 10 blocks build scripts unless explicitly allowed).
FROM base AS prod-deps
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts \
 && pnpm rebuild bcrypt

# ---- runtime ----
FROM node:24-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist/apps/auth-service ./dist/apps/auth-service
COPY package.json ./

USER node
EXPOSE 3001
CMD ["node", "dist/apps/auth-service/main"]
