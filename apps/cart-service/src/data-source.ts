import { DataSource, DataSourceOptions } from 'typeorm';
import { Cart } from './cart/entities/cart.entity';
import { CartItem } from './cart/entities/cart-item.entity';

/**
 * Single source of truth for cart-service's database connection.
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

export const buildCartDataSourceOptions = (
  get: EnvGetter = fromProcessEnv,
): DataSourceOptions => ({
  type: 'postgres',
  host: get('CART_DB_HOST') || 'localhost',
  port: parseInt(get('CART_DB_PORT') || '5436', 10),
  username: get('CART_DB_USERNAME') || 'postgres',
  password: get('CART_DB_PASSWORD') || 'postgres',
  database: get('CART_DB_NAME') || 'cart_db',
  entities: [Cart, CartItem],
  migrations: [],
  synchronize: false,
  migrationsRun: false,
});

// Default export is what `typeorm -d apps/cart-service/src/data-source.ts` loads.
export default new DataSource(buildCartDataSourceOptions());
