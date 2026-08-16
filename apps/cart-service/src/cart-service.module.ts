import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CartServiceController } from './cart-service.controller';
import { CartServiceService } from './cart-service.service';
import { CartModule } from './cart/cart.module';
import { HealthModule } from '@app/common';
//s
@Module({
  imports: [
    HealthModule,
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.CART_DB_HOST || 'localhost',
      port: parseInt(process.env.CART_DB_PORT || '5436', 10),
      username: process.env.CART_DB_USERNAME || 'postgres',
      password: process.env.CART_DB_PASSWORD || 'postgres',
      database: process.env.CART_DB_NAME || 'cart_db',
      autoLoadEntities: true,
      synchronize: true,
    }),
    CartModule,
  ],
  controllers: [CartServiceController],
  providers: [CartServiceService],
})
export class CartServiceModule {}
