# TypeORM Migration Guide for Microservices

In our NestJS microservices architecture, each service operates its own isolated PostgreSQL database (e.g., `auth_db`, `product_db`, `order_db`). Because of this, **migrations must be managed on a per-service basis**. 

This guide outlines the steps to correctly configure, generate, and run TypeORM migrations for each individual service.

---

## 1. Important Prerequisites

Before generating migrations, ensure that you disable automatic synchronization in your production application modules.

In each service's `app.module.ts` (or wherever `TypeOrmModule.forRoot()` is defined):
```typescript
TypeOrmModule.forRoot({
  // ... other configs
  synchronize: false, // THIS MUST BE FALSE IN PRODUCTION
})
```

---

## 2. Create a DataSource Config per Service

TypeORM CLI needs a `DataSource` instance to know which database to connect to and where to find the entities and migrations. 

Create a file like `apps/<service-name>/src/database/data-source.ts`.

**Example: `apps/orders-service/src/database/data-source.ts`**
```typescript
import { DataSource } from 'typeorm';
// Import your entities directly
import { Order } from '../orders/entities/order.entity'; 

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.ORDER_DB_PORT || '5437', 10), // Port specific to this service
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.ORDER_DB_NAME || 'order_db',
  entities: [Order], // Add all entities for this service here
  migrations: ['apps/orders-service/src/database/migrations/*.ts'],
  synchronize: false,
});
```

*(You will need to create a similar file for `auth-service`, `product-service`, `cart-service`, etc.)*

---

## 3. Configure `package.json` Scripts

Instead of typing out the long CLI commands every time, add these helper scripts to your root `package.json`. 

```json
"scripts": {
  "typeorm": "typeorm-ts-node-commonjs",
  
  "migration:generate:orders": "npm run typeorm migration:generate -d apps/orders-service/src/database/data-source.ts apps/orders-service/src/database/migrations/OrdersMigration",
  "migration:run:orders": "npm run typeorm migration:run -d apps/orders-service/src/database/data-source.ts",
  "migration:revert:orders": "npm run typeorm migration:revert -d apps/orders-service/src/database/data-source.ts",

  "migration:generate:auth": "npm run typeorm migration:generate -d apps/auth-service/src/database/data-source.ts apps/auth-service/src/database/migrations/AuthMigration",
  "migration:run:auth": "npm run typeorm migration:run -d apps/auth-service/src/database/data-source.ts"
}
```
*Note: You can change the suffix `OrdersMigration` in the generate command to be more descriptive based on what you are changing (e.g. `AddUserIdToOrder`).*

---

## 4. The Daily Migration Workflow

### Step 1: Write/Update your Entity
Modify your entity code (e.g., `apps/orders-service/src/orders/entities/order.entity.ts`).

### Step 2: Generate the Migration
Run the generate script. TypeORM will compare your entities to your current database schema and generate the required SQL statements.

```bash
npm run migration:generate:orders
```
*This will create a new timestamped file in `apps/orders-service/src/database/migrations/`.*

### Step 3: Review the Generated Code
Always open the newly generated migration file and verify the `up()` and `down()` SQL queries are what you expect. Do not blindly run them!

### Step 4: Run the Migration
Apply the changes to your local database:

```bash
npm run migration:run:orders
```

---

## 5. Docker / CI Deployment

When deploying your services, the application should never use `synchronize: true`. Instead, migrations should be applied before the application starts taking traffic.

In your `Dockerfile` or `docker-compose.yaml` startup script, you can run the migrations:
```bash
# In an entrypoint.sh script or as part of the CI/CD pipeline
npm run migration:run:orders
npm run start:prod orders-service
```
