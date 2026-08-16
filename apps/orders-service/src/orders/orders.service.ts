import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { DataSource, Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import {
  CART_MESSAGES,
  CART_SERVICE,
  USER_SERVICE,
  ADDRESS_MESSAGES,
} from '@app/common';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { CreateOrderDto } from './dto/create-order.dto';

interface CartItemSnapshot {
  productId: string;
  productName: string;
  productPrice: number | string;
  quantity: number;
}

interface CartSnapshot {
  items: CartItemSnapshot[];
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(CART_SERVICE) private readonly cartClient: ClientProxy,
    @Inject(USER_SERVICE) private readonly userClient: ClientProxy,
  ) {}

  async create(userId: string, dto: CreateOrderDto): Promise<Order> {
    const cart = await firstValueFrom<CartSnapshot>(
      this.cartClient.send(CART_MESSAGES.GET_CART, { userId }),
    );

    if (!cart?.items?.length) {
      throw new RpcException({ statusCode: 400, message: 'Cart is empty' });
    }
    console.log(dto);
    let shippingAddress = null;
    if (dto.shippingAddressId !== null) {
      try {
        shippingAddress = await firstValueFrom(
          this.userClient.send(ADDRESS_MESSAGES.GET, {
            userId,
            id: dto.shippingAddressId,
          }),
        );
      } catch (err) {
        console.log(err);
        throw new RpcException({
          statusCode: 400,
          message: 'Invalid shipping address 1',
        });
      }
    } else {
      try {
        shippingAddress = await firstValueFrom(
          this.userClient.send(ADDRESS_MESSAGES.GET_FOR_ORDER, {
            userId,
            id: dto.shippingAddressId,
          }),
        );
      } catch (err) {
        throw new RpcException({
          statusCode: 400,
          message: 'Invalid shipping address',
        });
      }
    }

    let billingAddress = null;
    if (dto.billingAddressId) {
      try {
        billingAddress = await firstValueFrom(
          this.userClient.send(ADDRESS_MESSAGES.GET_FOR_ORDER, {
            userId,
            id: dto.billingAddressId,
          }),
        );
      } catch (err) {
        throw new RpcException({
          statusCode: 400,
          message: 'Invalid billing address',
        });
      }
    } else {
      billingAddress = shippingAddress;
    }

    const order = await this.dataSource.transaction(async (manager) => {
      const items = cart.items.map((ci) =>
        manager.create(OrderItem, {
          productId: ci.productId,
          productName: ci.productName,
          price: Number(ci.productPrice),
          quantity: ci.quantity,
        }),
      );

      const totalAmount = items.reduce(
        (sum, i) => sum + Number(i.price) * i.quantity,
        0,
      );

      return manager.save(
        manager.create(Order, {
          userId,
          totalAmount,
          status: OrderStatus.PENDING,
          shippingAddress,
          billingAddress,
          items,
        }),
      );
    });

    try {
      await firstValueFrom(
        this.cartClient.send(CART_MESSAGES.CLEAR_CART, { userId }),
      );
    } catch (err) {
      this.logger.error(
        `Order ${order.id} created but cart clear failed for user ${userId}`,
        err as Error,
      );
    }

    return order;
  }

  async findAllForUser(userId: string, page: number = 1, limit: number = 10) {
    const [data, total] = await this.orderRepo.findAndCount({
      where: { userId },
      relations: ['items'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { meta: { total, page, limit }, data };
  }

  async findOneForUser(userId: string, id: string) {
    const order = await this.orderRepo.findOne({
      where: { id, userId },
      relations: ['items'],
    });
    if (!order) {
      throw new RpcException({ statusCode: 404, message: 'Order not found' });
    }
    return order;
  }

  async updateStatus(id: string, status: OrderStatus) {
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) {
      throw new RpcException({ statusCode: 404, message: 'Order not found' });
    }
    order.status = status;
    return this.orderRepo.save(order);
  }

  async cancelOrder(userId: string, id: string) {
    const order = await this.orderRepo.findOne({ where: { id, userId } });
    if (!order) {
      throw new RpcException({ statusCode: 404, message: 'Order not found' });
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new RpcException({
        statusCode: 400,
        message: 'Only pending orders can be cancelled',
      });
    }
    order.status = OrderStatus.CANCELLED;
    return this.orderRepo.save(order);
  }
}
