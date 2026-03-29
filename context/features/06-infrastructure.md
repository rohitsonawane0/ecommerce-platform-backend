# Infrastructure

## Docker Compose

### Current State
- `postgres-auth` -- Postgres 16, port 5433, db: `auth_db`
- `postgres-product` -- Postgres 16, port 5434, db: `product_db`
- `redis` -- Redis 7, port 6379

### Add
- `postgres-cart` -- Postgres 16, port 5435, db: `cart_db`, user: `postgres`, password: `postgres`

## Package.json Scripts

### Add

```json
{
  "start:product": "nest start product-service --watch",
  "start:cart": "nest start cart-service --watch",
  "start:all": "concurrently \"pnpm run start:gateway\" \"pnpm run start:auth\" \"pnpm run start:product\" \"pnpm run start:cart\""
}
```

## Environment Variables

### .env.example

```env
# API Gateway
GATEWAY_PORT=3000

# Auth Service
AUTH_SERVICE_HOST=localhost
AUTH_SERVICE_PORT=3001
AUTH_DB_HOST=localhost
AUTH_DB_PORT=5433
AUTH_DB_NAME=auth_db
AUTH_DB_USER=postgres
AUTH_DB_PASSWORD=postgres

# JWT
JWT_ACCESS_SECRET=your-access-secret-change-in-production
JWT_REFRESH_SECRET=your-refresh-secret-change-in-production
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# Product Service
PRODUCT_SERVICE_HOST=localhost
PRODUCT_SERVICE_PORT=3002
PRODUCT_DB_HOST=localhost
PRODUCT_DB_PORT=5434
PRODUCT_DB_NAME=product_db
PRODUCT_DB_USER=postgres
PRODUCT_DB_PASSWORD=postgres

# Cart Service
CART_SERVICE_HOST=localhost
CART_SERVICE_PORT=3003
CART_DB_HOST=localhost
CART_DB_PORT=5435
CART_DB_NAME=cart_db
CART_DB_USER=postgres
CART_DB_PASSWORD=postgres

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
```

## TypeORM Configuration (per service)

Each service configures TypeORM in its root module:

```typescript
TypeOrmModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    type: 'postgres',
    host: config.get('XX_DB_HOST'),
    port: config.get<number>('XX_DB_PORT'),
    username: config.get('XX_DB_USER'),
    password: config.get('XX_DB_PASSWORD'),
    database: config.get('XX_DB_NAME'),
    entities: [__dirname + '/**/*.entity{.ts,.js}'],
    synchronize: true, // dev only -- use migrations in production
  }),
})
```

## Running Locally

```bash
# 1. Start infrastructure
docker compose up -d

# 2. Copy env
cp .env.example .env

# 3. Install dependencies
pnpm install

# 4. Start all services
pnpm run start:all

# Or start individually:
pnpm run start:gateway   # port 3000
pnpm run start:auth      # port 3001
pnpm run start:product   # port 3002
pnpm run start:cart      # port 3003
```
