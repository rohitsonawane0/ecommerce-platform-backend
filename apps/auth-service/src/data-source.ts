import { DataSource, DataSourceOptions } from 'typeorm';
import { User } from './auth/entities/user.entity';
import { InitialSchema1787167778086 } from './migrations/1787167778086-InitialSchema';

/**
 * Single source of truth for auth-service's database connection.
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

export const buildAuthDataSourceOptions = (
  get: EnvGetter = fromProcessEnv,
): DataSourceOptions => ({
  type: 'postgres',
  host: get('DB_HOST') || 'localhost',
  port: parseInt(get('DB_PORT') || '5433', 10),
  username: get('DB_USERNAME') || 'postgres',
  password: get('DB_PASSWORD') || 'postgres',
  database: get('DB_NAME') || 'auth_db',
  entities: [User],
  migrations: [InitialSchema1787167778086],
  synchronize: false,
  migrationsRun: false,
});

// Default export is what `typeorm -d apps/auth-service/src/data-source.ts` loads.
export default new DataSource(buildAuthDataSourceOptions());
