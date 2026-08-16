import { Module } from '@nestjs/common';

import { CartController } from './cart.controller';
import { ClientsModule } from '@nestjs/microservices';
import { CART_SERVICE } from '@app/common';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: CART_SERVICE,
        options: {
          host: process.env.CART_SERVICE_HOST || 'localhost',
          port: parseInt(process.env.CART_SERVICE_PORT || '3003', 10),
        },
      },
    ]),
  ],
  controllers: [CartController],
  providers: [],
})
export class CartModule {}
