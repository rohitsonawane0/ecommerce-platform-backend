import { DataSource, DataSourceOptions } from 'typeorm';
import { Product } from './products/entities/product.entity';
import { Category } from './categories/entities/category.entity';

/**
 * Single source of truth for product-service's database connection.
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

export const buildProductDataSourceOptions = (
  get: EnvGetter = fromProcessEnv,
): DataSourceOptions => ({
  type: 'postgres',
  host: get('PRODUCT_DB_HOST') || 'localhost',
  port: parseInt(get('PRODUCT_DB_PORT') || '5435', 10),
  username: get('PRODUCT_DB_USERNAME') || 'postgres',
  password: get('PRODUCT_DB_PASSWORD') || 'postgres',
  database: get('PRODUCT_DB_NAME') || 'product_db',
  entities: [Product, Category],
  migrations: [],
  synchronize: false,
  migrationsRun: false,
});

// Default export is what `typeorm -d apps/product-service/src/data-source.ts` loads.
export default new DataSource(buildProductDataSourceOptions());
