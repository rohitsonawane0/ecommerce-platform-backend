import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CartServiceController } from './cart-service.controller';
import { CartServiceService } from './cart-service.service';
import { CartModule } from './cart/cart.module';
import { HealthModule } from '@app/common';
import { cartDataSourceOptions } from './data-source';
//s
@Module({
  imports: [
    HealthModule,
    TypeOrmModule.forRoot(cartDataSourceOptions),
    CartModule,
  ],
  controllers: [CartServiceController],
  providers: [CartServiceService],
})
export class CartServiceModule {}
