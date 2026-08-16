import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersModule } from './orders/orders.module';
import { HealthModule } from '@app/common';

@Module({
  imports: [
    HealthModule,
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.ORDER_DB_HOST || 'localhost',
      port: parseInt(process.env.ORDER_DB_PORT || '5437', 10),
      username: process.env.ORDER_DB_USERNAME || 'postgres',
      password: process.env.ORDER_DB_PASSWORD || 'postgres',
      database: process.env.ORDER_DB_NAME || 'order_db',
      autoLoadEntities: true,
      synchronize: true,
    }),
    OrdersModule,
  ],
})
export class OrdersServiceModule {}
