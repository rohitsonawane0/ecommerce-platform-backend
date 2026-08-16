import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersModule } from './orders/orders.module';
import { HealthModule } from '@app/common';
import { orderDataSourceOptions } from './data-source';

@Module({
  imports: [
    HealthModule,
    TypeOrmModule.forRoot(orderDataSourceOptions),
    OrdersModule,
  ],
})
export class OrdersServiceModule {}
