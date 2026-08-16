import { DataSource, DataSourceOptions } from 'typeorm';
import { Cart } from './cart/entities/cart.entity';
import { CartItem } from './cart/entities/cart-item.entity';

/**
 * Single source of truth for cart-service's database connection.
 * See apps/auth-service/src/data-source.ts for why entities and migrations are
 * imported explicitly rather than globbed.
 */
export const cartDataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.CART_DB_HOST || 'localhost',
  port: parseInt(process.env.CART_DB_PORT || '5436', 10),
  username: process.env.CART_DB_USERNAME || 'postgres',
  password: process.env.CART_DB_PASSWORD || 'postgres',
  database: process.env.CART_DB_NAME || 'cart_db',
  entities: [Cart, CartItem],
  migrations: [],
  synchronize: false,
  migrationsRun: false,
};

export default new DataSource(cartDataSourceOptions);
