import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CartServiceController } from './cart-service.controller';
import { CartServiceService } from './cart-service.service';
import { CartModule } from './cart/cart.module';
import { HealthModule } from '@app/common';
import { buildCartDataSourceOptions } from './data-source';
import { ConfigModule, ConfigService } from '@nestjs/config';
//s
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    HealthModule,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        buildCartDataSourceOptions((key) => config.get<string>(key)),
    }),
    CartModule,
  ],
  controllers: [CartServiceController],
  providers: [CartServiceService],
})
export class CartServiceModule {}
