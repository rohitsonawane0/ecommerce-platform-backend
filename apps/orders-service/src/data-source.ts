import { DataSource, DataSourceOptions } from 'typeorm';
import { Order } from './orders/entities/order.entity';
import { OrderItem } from './orders/entities/order-item.entity';

/**
 * Single source of truth for orders-service's database connection.
 * Note the env prefix is ORDER_* (singular), not ORDERS_*.
 * See apps/auth-service/src/data-source.ts for why entities and migrations are
 * imported explicitly rather than globbed.
 */
export const orderDataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.ORDER_DB_HOST || 'localhost',
  port: parseInt(process.env.ORDER_DB_PORT || '5437', 10),
  username: process.env.ORDER_DB_USERNAME || 'postgres',
  password: process.env.ORDER_DB_PASSWORD || 'postgres',
  database: process.env.ORDER_DB_NAME || 'order_db',
  entities: [Order, OrderItem],
  migrations: [],
  synchronize: false,
  migrationsRun: false,
};

export default new DataSource(orderDataSourceOptions);
