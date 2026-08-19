import { DataSource, DataSourceOptions } from 'typeorm';
import { Address } from './addresses/address.entity';
import { InitialSchema1787167782862 } from './migrations/1787167782862-InitialSchema';

/**
 * Single source of truth for user-service's database connection.
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

export const buildUserDataSourceOptions = (
  get: EnvGetter = fromProcessEnv,
): DataSourceOptions => ({
  type: 'postgres',
  host: get('USER_DB_HOST') || 'localhost',
  port: parseInt(get('USER_DB_PORT') || '5448', 10),
  username: get('USER_DB_USERNAME') || 'postgres',
  password: get('USER_DB_PASSWORD') || 'postgres',
  database: get('USER_DB_NAME') || 'user_db',
  entities: [Address],
  migrations: [InitialSchema1787167782862],
  synchronize: false,
  migrationsRun: false,
});

// Default export is what `typeorm -d apps/user-service/src/data-source.ts` loads.
export default new DataSource(buildUserDataSourceOptions());
