import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { ORDER_MESSAGES } from '@app/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order.dto';

@Controller()
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @MessagePattern(ORDER_MESSAGES.CREATE)
  create(@Payload() payload: { userId: string } & CreateOrderDto) {
    const { userId, ...dto } = payload;
    return this.ordersService.create(userId, dto);
  }

  @MessagePattern(ORDER_MESSAGES.FIND_ALL)
  findAll(
    @Payload() payload: { userId: string; page?: number; limit?: number },
  ) {
    return this.ordersService.findAllForUser(
      payload.userId,
      payload.page,
      payload.limit,
    );
  }

  @MessagePattern(ORDER_MESSAGES.FIND_ONE)
  findOne(@Payload() payload: { userId: string; id: string }) {
    return this.ordersService.findOneForUser(payload.userId, payload.id);
  }

  @MessagePattern(ORDER_MESSAGES.UPDATE_STATUS)
  updateStatus(@Payload() dto: UpdateOrderStatusDto) {
    return this.ordersService.updateStatus(dto.id, dto.status);
  }

  @MessagePattern(ORDER_MESSAGES.CANCEL)
  cancel(@Payload() payload: { userId: string; id: string }) {
    return this.ordersService.cancelOrder(payload.userId, payload.id);
  }
}
