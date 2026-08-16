import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersModule } from './orders/orders.module';
import { HealthModule } from '@app/common';
import { buildOrderDataSourceOptions } from './data-source';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    HealthModule,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        buildOrderDataSourceOptions((key) => config.get<string>(key)),
    }),
    OrdersModule,
  ],
})
export class OrdersServiceModule {}
