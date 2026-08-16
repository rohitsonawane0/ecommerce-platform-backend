import { DataSource, DataSourceOptions } from 'typeorm';
import { Address } from './addresses/address.entity';

/**
 * Single source of truth for user-service's database connection.
 * See apps/auth-service/src/data-source.ts for why entities and migrations are
 * imported explicitly rather than globbed.
 */
export const userDataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.USER_DB_HOST || 'localhost',
  port: parseInt(process.env.USER_DB_PORT || '5448', 10),
  username: process.env.USER_DB_USERNAME || 'postgres',
  password: process.env.USER_DB_PASSWORD || 'postgres',
  database: process.env.USER_DB_NAME || 'user_db',
  entities: [Address],
  migrations: [],
  synchronize: false,
  migrationsRun: false,
};

export default new DataSource(userDataSourceOptions);
