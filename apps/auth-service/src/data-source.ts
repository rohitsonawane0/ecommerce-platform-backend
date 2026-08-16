import { DataSource, DataSourceOptions } from 'typeorm';
import { User } from './auth/entities/user.entity';

/**
 * Single source of truth for auth-service's database connection.
 *
 * Used two ways:
 *   - `TypeOrmModule.forRoot(authDataSourceOptions)` at runtime
 *   - `typeorm -d apps/auth-service/src/data-source.ts` for the migration CLI
 *
 * Entities and migrations are imported EXPLICITLY, never via glob: nest-cli
 * builds with webpack, so there are no individual .entity.js files on disk for
 * a glob to match. Every new migration must be added to the array below or the
 * CLI will not see it.
 */
export const authDataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5433', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'auth_db',
  entities: [User],
  migrations: [],
  synchronize: false,
  migrationsRun: false,
};

export default new DataSource(authDataSourceOptions);
