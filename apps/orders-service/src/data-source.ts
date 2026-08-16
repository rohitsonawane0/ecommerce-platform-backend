import { DataSource, DataSourceOptions } from 'typeorm';
import { Order } from './orders/entities/order.entity';
import { OrderItem } from './orders/entities/order-item.entity';

/**
 * Single source of truth for orders-service's database connection.
 * Note the env prefix is ORDER_* (singular), not ORDERS_*.
 *
 * Read through an injected getter rather than `process.env` directly, so the
 * same definition serves both callers:
 *   - Nest passes ConfigService.get  (loads .env via ConfigModule)
 *   - the TypeORM CLI passes process.env, since DI does not exist there
 *
 * Entities and migrations are imported EXPLICITLY, never via glob: nest-cli
 * builds with webpack, so there are no individual .entity.js files on disk for
 * a glob to match. Every new migration must be added to the array below.
 */
export type EnvGetter = (key: string) => string | undefined;

const fromProcessEnv: EnvGetter = (key) => process.env[key];

export const buildOrderDataSourceOptions = (
  get: EnvGetter = fromProcessEnv,
): DataSourceOptions => ({
  type: 'postgres',
  host: get('ORDER_DB_HOST') || 'localhost',
  port: parseInt(get('ORDER_DB_PORT') || '5437', 10),
  username: get('ORDER_DB_USERNAME') || 'postgres',
  password: get('ORDER_DB_PASSWORD') || 'postgres',
  database: get('ORDER_DB_NAME') || 'order_db',
  entities: [Order, OrderItem],
  migrations: [],
  synchronize: false,
  migrationsRun: false,
});

// Default export is what `typeorm -d apps/orders-service/src/data-source.ts` loads.
export default new DataSource(buildOrderDataSourceOptions());
