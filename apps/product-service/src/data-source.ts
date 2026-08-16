import { DataSource, DataSourceOptions } from 'typeorm';
import { Product } from './products/entities/product.entity';
import { Category } from './categories/entities/category.entity';

/**
 * Single source of truth for product-service's database connection.
 * See apps/auth-service/src/data-source.ts for why entities and migrations are
 * imported explicitly rather than globbed.
 */
export const productDataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.PRODUCT_DB_HOST || 'localhost',
  port: parseInt(process.env.PRODUCT_DB_PORT || '5435', 10),
  username: process.env.PRODUCT_DB_USERNAME || 'postgres',
  password: process.env.PRODUCT_DB_PASSWORD || 'postgres',
  database: process.env.PRODUCT_DB_NAME || 'product_db',
  entities: [Product, Category],
  migrations: [],
  synchronize: false,
  migrationsRun: false,
};

export default new DataSource(productDataSourceOptions);
