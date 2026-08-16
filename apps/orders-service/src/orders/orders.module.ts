import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { CART_SERVICE, USER_SERVICE } from '@app/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem]),
    ClientsModule.register([
      {
        name: CART_SERVICE,
        transport: Transport.TCP,
        options: { host: 'localhost', port: 3003 },
      },
      {
        name: USER_SERVICE,
        transport: Transport.TCP,
        options: { host: 'localhost', port: 3006 },
      },
    ]),
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
